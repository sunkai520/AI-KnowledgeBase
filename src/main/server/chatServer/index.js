// @ts-ignore
import {
  success,
  error500
} from "../responseFn"
import {
  createAgent,
  createMiddleware,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  dynamicSystemPromptMiddleware,
  contextEditingMiddleware,
  ClearToolUsesEdit
} from "langchain";

import {
  searchLocalKB,
  getOnlinesTools,
  parseWebPage,
  createSearchTool,
  toolsMaps,
  generateWordTool,
  getNativeSearchTools
} from "../../model/tools"

import {
  ragPrompt,
  searchPrompt,
  ragOnlinePrompt,
  offlinePrompt
} from "../../model/prompt"
import {
  getDB
} from "../../utils/getDb";
import {
  getUUid,
  formatDate,
  createInsertSql,
  convertImageToBase64,
  buildMultimodalContent,
  estimateTokens
} from "../../utils/common"
import {
  doc
} from "../../utils/document";
import {
  ModelFactory
} from '../../model/modelFactory';
import { SettingManager } from '../../utils/settingManager';
import { ConfigManager } from '../../config/configmangger';
import { processMemoryExtraction, retrieveRelevantMemories } from '../../model/memoryExtractor';
import { extractTextContent, buildToolResultEvent } from '../../model/agentStreamUtils';
// @ts-ignore
import {
  setLog
} from "../../event/index"
const db = new Proxy({}, { get: (_, prop) => getDB().db[prop] });

const CHAT_MEMORY_RECENT_LIMIT = 15;
const CHAT_MEMORY_SUMMARY_TARGET = 1600;
const DEFAULT_CONTEXT_WINDOW = 32000;

// 压缩摘要+近期消息 允许占用的 token 预算：按配置的模型上下文窗口的一个比例来算，
// 剩下的窗口留给系统提示词/工具schema/当前输入/模型输出。第三方模型没有官方 profile 可自动识别窗口大小，
// 所以这个值来自用户在模型设置里配的 contextWindow（没配就用保守默认值 32000）。
function getChatMemoryTokenBudget() {
  const chatConfig = ConfigManager.getInstance().getConfig()?.chat || {};
  const contextWindow = Number(chatConfig.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  return Math.floor(contextWindow * 0.35);
}

// 单次请求内（一次 agent.stream 调用期间）的兜底：工具调用结果如果在这一轮里越堆越大，
// 在真正打到模型上下文上限之前，自动清掉较早的工具输出，只保留最近几条。
// 用显式 token 数触发（不用 fraction），因为 fraction 依赖 model.profile 自动识别窗口大小，
// 而 @langchain/openai 内置的 profile 表只收录了 OpenAI 自家模型，deepseek/qwen 等查不到，fraction 永远不会触发。
function getContextEditMiddleware() {
  const chatConfig = ConfigManager.getInstance().getConfig()?.chat || {};
  const contextWindow = Number(chatConfig.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  return contextEditingMiddleware({
    edits: [
      new ClearToolUsesEdit({
        trigger: { tokens: Math.floor(contextWindow * 0.8) },
        keep: { messages: 3 },
      }),
    ],
  });
}

// 诊断：定位 "expected AIMessage or Command, got object" 报错的真实来源——挂在
// contextEditingMiddleware 更内层（更靠近 baseHandler），这样它 handler(request) 拿到的
// 就是 baseHandler 归一化之后、马上要喂给 contextEditingMiddleware 校验的那个值本身，
// 能精确记录校验失败现场的具体类型（做法与 deepAgentServer 里的同名诊断保持一致）。
function getRawResponseDiagMiddleware() {
  return createMiddleware({
    name: "RawResponseDiag",
    wrapModelCall: async (request, handler) => {
      try {
        const result = await handler(request);
        let preview;
        try {
          preview = JSON.stringify(result, (_k, v) => (typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "...(截断)" : v));
        } catch (stringifyErr) {
          preview = `[无法序列化: ${stringifyErr.message}]`;
        }
        setLog(`[对话][模型响应类型] constructor=${result?.constructor?.name}, type=${result?.type}, _getType=${typeof result?._getType === "function" ? result._getType() : "(无此方法)"}, 内容=${preview}`);
        return result;
      } catch (err) {
        setLog(`[对话][模型调用异常] ${err?.message || err}${err?.stack ? "\n" + err.stack : ""}`);
        throw err;
      }
    },
  });
}

function normalizeChatRole(role = "") {
  return role === "assistant" || role === "ai" ? "assistant" : "user";
}

function formatChatMemoryMessages(messages = []) {
  return messages
    .map((item) => {
      const role = normalizeChatRole(item.role) === "assistant" ? "助手" : "用户";
      return `${role}：${String(item.content || "").trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildChatMemoryText(compressedMemory = "", recentMessages = []) {
  const parts = [];
  if (String(compressedMemory || "").trim()) {
    parts.push(`压缩历史记忆：\n${String(compressedMemory).trim()}`);
  }
  const recentText = formatChatMemoryMessages(recentMessages);
  if (recentText) {
    parts.push(`近期对话记忆：\n${recentText}`);
  }
  return parts.join("\n\n").trim();
}
// user.js
const express = require('express');
const chat = express.Router();

function getChatSessionRaw(sessionId) {
  if (!sessionId) return null;
  return db.prepare(`SELECT * FROM chatsIds WHERE sessionId = ?`).get(sessionId);
}

function listChatMessages(sessionId, limit = 200) {
  return db
    .prepare(
      `SELECT id, sessionId, content, role, files, updateTime, createTime
       FROM chat_messages
       WHERE sessionId = ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sessionId, limit);
}

function listRecentChatMessages(sessionId, limit = CHAT_MEMORY_RECENT_LIMIT) {
  return db
    .prepare(
      `SELECT id, sessionId, content, role, files, updateTime, createTime
       FROM chat_messages
       WHERE sessionId = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(sessionId, limit)
    .reverse();
}

function deleteChatMessagesByIds(ids = []) {
  if (!ids.length) return;
  const deleteMany = db.transaction((rows) => {
    const stmt = db.prepare(`DELETE FROM chat_messages WHERE id = ?`);
    rows.forEach((id) => stmt.run(id));
  });
  deleteMany(ids);
}

async function summarizeChatMemory(existingSummary = "", messages = [], targetChars = CHAT_MEMORY_SUMMARY_TARGET) {
  const historyText = formatChatMemoryMessages(messages);
  if (!String(existingSummary || "").trim() && !historyText) return "";

  const prompt = `请把以下 AI 助手对话压缩成长期记忆，用于后续继续对话时保持上下文。
要求：1. 保留用户长期偏好、明确事实、正在处理的事项、约定、重要结论和不能遗忘的要求。2. 删除寒暄、重复内容、无效失败信息和已经不重要的过程。3. 不要编造没有出现过的信息。4. 输出中文，控制在 ${targetChars} 字以内。
已有压缩记忆：${existingSummary || "无"}

需要合并的较早对话：
${historyText || "无"}`;

  try {
    const model = ModelFactory.getChatModel({ isNew: true });
    const result = await model.invoke([{ role: "user", content: prompt }]);
    return String(result?.content || result || "").trim().slice(0, targetChars * 2);
  } catch (err) {
    console.error("summarizeChatMemory failed", err);
    setLog(`记忆压缩失败，本轮跳过，原始消息保留待下次重试: ${err.message}`);
    return null; // null 代表压缩失败，调用方不能据此删除原始消息
  }
}

async function compactChatMemory(sessionId) {
  const session = getChatSessionRaw(sessionId);
  if (!session) return;

  let compressedMemory = String(session.compressedMemory || "").trim();
  let messages = listChatMessages(sessionId, 500);

  if (messages.length > CHAT_MEMORY_RECENT_LIMIT) {
    const older = messages.slice(0, messages.length - CHAT_MEMORY_RECENT_LIMIT);
    const summarized = await summarizeChatMemory(compressedMemory, older);
    if (summarized === null) return; // 压缩失败：不删原始消息，本轮不落盘，等下一轮再重试
    compressedMemory = summarized;
    deleteChatMessagesByIds(older.map((item) => item.id));
    messages = messages.slice(messages.length - CHAT_MEMORY_RECENT_LIMIT);
  }

  const tokenBudget = getChatMemoryTokenBudget();
  while (messages.length && estimateTokens(buildChatMemoryText(compressedMemory, messages)) > tokenBudget) {
    const batchSize = Math.min(2, messages.length);
    const batch = messages.slice(0, batchSize);
    const summarized = await summarizeChatMemory(compressedMemory, batch);
    if (summarized === null) break; // 压缩失败：停止本轮循环，剩余消息保留原样，已成功的部分照常落盘
    compressedMemory = summarized;
    deleteChatMessagesByIds(batch.map((item) => item.id));
    messages = messages.slice(batchSize);
  }

  if (!messages.length && estimateTokens(compressedMemory) > tokenBudget) {
    const summarized = await summarizeChatMemory("", [
      { role: "assistant", content: compressedMemory },
    ], CHAT_MEMORY_SUMMARY_TARGET);
    if (summarized !== null) compressedMemory = summarized;
  }

  db.prepare(
    `UPDATE chatsIds SET compressedMemory = ?, updateTime = ? WHERE sessionId = ?`
  ).run(compressedMemory, formatDate(new Date().getTime()), sessionId);
}

async function buildChatMemoryState(sessionId) {
  const session = getChatSessionRaw(sessionId);
  if (!session) return { compressedMemory: "", recentMessages: [] };

  let recentMessages = listRecentChatMessages(sessionId, CHAT_MEMORY_RECENT_LIMIT);
  let compressedMemory = String(session.compressedMemory || "").trim();

  if (estimateTokens(buildChatMemoryText(compressedMemory, recentMessages)) > getChatMemoryTokenBudget()) {
    await compactChatMemory(sessionId);
    const latest = getChatSessionRaw(sessionId);
    compressedMemory = String(latest?.compressedMemory || "").trim();
    recentMessages = listRecentChatMessages(sessionId, CHAT_MEMORY_RECENT_LIMIT);
  }

  return { compressedMemory, recentMessages };
}

// const imgModel = getImageModel()
// 创建 Memory
// let memory = new DBMemory(dbObj.db, getUUid());
function insertIntoChatMessage({
  sessionId,
  content,
  user,
  role,
  tools,
  toolResults,
  files,
  updateTime = formatDate(new Date().getTime()),
  createTime = formatDate(new Date().getTime()),
}) {
  let columns = {
    sessionId,
    content,
    user,
    role,
    tools,
    toolResults,
    files,
    updateTime,
    createTime
  };
  let sql = createInsertSql(columns, "chat_messages");
  // 插入数据的 SQL 语句
  const insertChatId = db.prepare(sql);
  let result = insertChatId.run(...Object.values(columns));
  db.prepare('UPDATE chatsIds SET updateTime = ? WHERE sessionId = ?').run(updateTime, sessionId);
  return result;
}
chat.get('/delChatSession', (req, res) => {
  const {
    sessionId
  } = req.query;
  const transaction = db.transaction(() => {
    // 1. 删除子表中的订单项
    db.prepare('DELETE FROM chatsIds WHERE sessionId = ?').run(sessionId);
    // 2. 删除主表中的订单
    db.prepare('DELETE FROM chat_messages WHERE sessionId = ?').run(sessionId);
  });
  try {
    // 执行事务
    transaction();
    res.send(success())
  } catch (error) {
    console.error('删除失败', error);
    // 如果有错误，事务会自动回滚
    res.send(error500())
  }
})
chat.get('/createChatSessionId', (req, res) => {
  // 插入数据的 SQL 语句
  const insertChatId = db.prepare(`
        INSERT INTO chatsIds (sessionId,userId, updateTime, createTime) 
        VALUES (?, ?, ?, ?)
    `);
  // 准备插入的数据
  const sessionId = getUUid();
  const userId = 1;
  const updateTime = formatDate(new Date().getTime());
  const createTime = formatDate(new Date().getTime());

  // 执行插入操作
  let result = insertChatId.run(sessionId, userId, updateTime, createTime);
  console.log(result, "result")
  res.send(success({
    sessionId
  }));
})
chat.get('/sessionList', (req, res) => {
  const {
    page = 1,
      pageSize = 10,
      userId
  } = req.query;

  if (!userId) {
    return res.send(error500('userId is required'));
  }

  const pageNum = Math.max(1, Number(page));
  const sizeNum = Math.max(1, Number(pageSize));
  const offset = (pageNum - 1) * sizeNum;
  // Keep the session list light; messages are loaded by session when selected.
  const listChatsStmt = db.prepare(`
        SELECT c.sessionId, c.userId,
        COALESCE((
          SELECT m.updateTime
          FROM chat_messages AS m
          WHERE m.sessionId = c.sessionId
          ORDER BY m.id DESC
          LIMIT 1
        ), c.updateTime) AS updateTime,
        c.createTime,
        (
          SELECT content
          FROM chat_messages AS m
          WHERE m.sessionId = c.sessionId
            AND m.role = 'user'
          ORDER BY m.id DESC
          LIMIT 1
        ) AS preview
        FROM chatsIds AS c
        WHERE userId = ?
        ORDER BY updateTime DESC, c.createTime DESC
        LIMIT ? OFFSET ?
    `);
  const countChatsStmt = db.prepare(`
        SELECT COUNT(*) AS total
        FROM chatsIds
        WHERE userId = ?
    `);

  // 分页列表
  const list = listChatsStmt.all(
    userId,
    sizeNum,
    offset
  );
  // 总数
  const {
    total
  } = countChatsStmt.get(userId);

  res.send(success({
    list,
    page: pageNum,
    pageSize: sizeNum,
    total
  }));
});
chat.get('/sessions/:sessionId/messages', (req, res) => {
  const {
    sessionId
  } = req.params;
  const {
    limit = 200
  } = req.query;
  if (!sessionId) {
    res.send(error500('sessionId is required'));
    return;
  }

  const sizeNum = Math.max(1, Number(limit));
  const result = db.prepare(`
        SELECT id, sessionId, content, role, files, tools, toolResults, updateTime, createTime
        FROM chat_messages
        WHERE sessionId = ?
        ORDER BY id ASC
        LIMIT ?
    `).all(sessionId, sizeNum);

  res.send(success(result));
});
chat.get('/chatListBySessionId', (req, res) => {
  const {
    sessionId,
    page = 1,
    pageSize = 10
  } = req.query;
  if (!sessionId) {
    res.send(error500('sessionId不能为空'));
  }
})
chat.post('/agentChat', async (req, res) => {
  const {
    q,
    sessionId = getUUid(),
    isOnline, //是否联网
    localChecked, //本地知识库搜索
    uploadedDocs = [],
    modelName, //前端对话框上快速切换的模型，不传则用模型配置页的全局设置
  } = req.body;
  // 从 settings 读取用户选定的模板，不走请求体
  const templateId = SettingManager.getInstance().get('activeTemplateId') || 'business';
  let articles = [];
  let imagePaths = [];
  // if(!webTools||webTools.length==0){
  //   webTools = await getOnlinesTools();
  // }
  // console.log(webTools,"tools")
  if (uploadedDocs.length > 0) {
    for (let i = 0; i < uploadedDocs.length; i++) {
      console.log(uploadedDocs[i].type, "type")
      if (uploadedDocs[i].type == 'text' || uploadedDocs[i].type == 'pdf') {
        try {
          let docObj = new doc({
            docPath: uploadedDocs[i].filePath,
            chunkSize: 2000,
            chunkOverlap: 50
          });
          let texts = await docObj.loader.load()
          let str = ""
          texts.forEach(t => {
            str += t.pageContent
          })
          articles.push({
            filePath: uploadedDocs[i].filePath,
            content: `附件${i+1}:${str}`
          })
        } catch (e) {
          setLog(`附件解析失败: ${uploadedDocs[i].filePath} - ${e.message}`);
          articles.push({
            filePath: uploadedDocs[i].filePath,
            content: `附件${i+1}（${uploadedDocs[i].filePath}）解析失败，无法读取其内容。`
          })
        }
      }
      if (uploadedDocs[i].type == 'image') {
        // 图片直接收集路径，随用户问题一起以多模态格式传给主模型
        imagePaths.push(uploadedDocs[i].filePath);
      }
    }
  }
  //   let docObj = new doc({ docPath: path, chunkSize: 2000, chunkOverlap: 50 });
  //   let text = await docObj.loader.load()
  console.log("========start===========");
  setLog("========start===========")
  if (!q) {
    res.send(error500('q不能为空'));
  }
  if (!sessionId) {
    res.send(error500('会话id不能为空'));
  }
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // 历史记忆配置：压缩长期记忆 + 最近原始消息窗口。
  const MULTIMODAL_RECENT_MESSAGES = 2; // 仅最近若干条带图片的消息重建多模态，控制 base64 体积和重复计费（配合 convertImageToBase64 的缩放，双重降本）

  const chatSession = getChatSessionRaw(sessionId);
  const userId = chatSession?.userId || 1;

  const memoryState = await buildChatMemoryState(sessionId);
  const recent = memoryState.recentMessages;
  // 跨会话的用户长期记忆（mem0 式语义召回），失败时静默降级为空数组，不影响本轮对话
  const relevantMemories = await retrieveRelevantMemories(userId, q, 5);

  const trimmed = recent;

  const isImageFile = (p) => /\.(jpe?g|png|gif|bmp|webp)$/i.test(p || "");
  // #3/#7: role 归一化(ai→assistant)；最近若干条带图片的用户消息重建多模态，使多轮可引用图片
  let nesList = trimmed.map((item, idx) => {
    const role = item.role === 'ai' ? 'assistant' : 'user';
    const isRecent = idx >= trimmed.length - MULTIMODAL_RECENT_MESSAGES;
    if (role === 'user' && isRecent && item.files) {
      const imgs = item.files.split(',').map(s => s.trim()).filter(isImageFile);
      if (imgs.length > 0) {
        try {
          return { role, content: buildMultimodalContent(item.content || "", imgs) };
        } catch (e) {
          setLog(`历史图片重建失败，降级为纯文本: ${e.message}`);
        }
      }
    }
    return { role, content: item.content };
  })
  let textContent = q;
  if (articles && articles.length > 0) {
    let str = articles.map(item => item.content).join("\n\n")
    setLog(`${q}\n\n附件内容如下\n\n${str}`)
    textContent = `${q}\n\n附件内容如下\n\n${str}`
  }
  // 有图片时构造多模态 content 数组，无图片时保持纯字符串
  const userContent = buildMultimodalContent(textContent, imagePaths);
  if (imagePaths.length > 0) {
    setLog(`包含 ${imagePaths.length} 张图片，使用多模态格式发送`)
  }
  const memoryMessages = memoryState.compressedMemory
    ? [{
        role: "system",
        content: `以下是本会话的压缩长期记忆。它只用于补充上下文；如果和用户本次输入冲突，优先服从用户本次输入。\n\n${memoryState.compressedMemory}`,
      }]
    : [];
  if (relevantMemories.length > 0) {
    memoryMessages.push({
      role: "system",
      content: `以下是关于用户的长期记忆（跨会话），仅供参考；如果和用户本次输入冲突，优先服从用户本次输入。\n${relevantMemories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    });
  }
  let messages = [...memoryMessages, ...nesList, {
    role: "user",
    content: userContent
  }];
  // console.log(messages, "messagesmessages")
  // 填充占位符
  // const filledPrompt = await searchPrompt.format({
  //     chat_history: nesList,
  // });
  // console.log("Generated Prompt:", filledPrompt);
  //@ts-ignore
  const dynamicModelSelection = createMiddleware({
    name: "DynamicModelSelection",
    wrapModelCall: (request, handler) => {
      // Choose model based on conversation complexity
      const messageCount = request.messages.length;
      // console.log(request,"request.messages")
      return handler({
        ...request,
        // model: messageCount > 10 ? advancedModel : basicModel,
      });
    },
  });

  // #4: 工具按开关组合挂载——报告生成始终可用，联网/知识库分别由 isOnline / localChecked 控制
  const webTools = [generateWordTool];
  // 每个请求创建独立的联网搜索工具，闭包内限制最多 5 次调用、连续失败 3 次后返回获取失败，避免模型反复重试或一直换词搜索
  let usingNativeSearch = false;
  const chatCfg = ConfigManager.getInstance().getConfig()?.chat || {};
  // 对话框上快速切换的模型覆盖全局配置，为空则回退全局默认
  const effectiveModelName = (modelName || '').trim() || chatCfg.modelName;
  const modelOverride = {};
  if (modelName && modelName.trim()) modelOverride.modelName = modelName.trim();
  if (isOnline) {
    // OpenAI/Grok 系列模型优先用厂商自带的原生联网搜索（走中转网关时也按模型名判断，见 getNativeSearchTools 注释），
    // 命中就不再挂自建的爬虫搜索工具，避免两套搜索同时挂给模型导致调用行为不可控——但要用户在模型配置页手动开了
    // nativeSearch 开关才生效，默认关闭，避免这次改动悄悄改变所有人的联网搜索行为
    const nativeSearchTools = chatCfg.nativeSearch ? getNativeSearchTools(effectiveModelName) : [];
    if (nativeSearchTools.length) {
      webTools.push(...nativeSearchTools);
      usingNativeSearch = true;
    } else {
      webTools.push(createSearchTool(5, 3), parseWebPage);
    }
  }
  if (localChecked) webTools.push(searchLocalKB);

  const now = formatDate(new Date().getTime());
  // 提示词按 写作 > 知识库+联网 > 仅知识库 > 仅联网 > 纯离线 选择，与已挂载的工具保持一致
  let promptBody;
  if (localChecked && isOnline) {
    promptBody = ragOnlinePrompt;   // 两个都开：知识库优先，不足自动联网补充
  } else if (localChecked) {
    promptBody = ragPrompt;         // 仅知识库
  } else if (isOnline) {
    promptBody = searchPrompt;      // 仅联网
  } else {
    promptBody = offlinePrompt;     // 都关：纯模型知识，禁止联网
  }
  const templateLabels = { business: '商务蓝', report: '报告红(仿宋)', simple: '简约灰', academic: '学术深蓝', intel: '情报琥珀' };
  const tplNote = templateId ? `\n\n用户当前选择的报告模板为【${templateLabels[templateId] || templateId}】，调用 generateWord 工具时 options.templateId 必须设为 "${templateId}"，除非用户明确要求更换风格。` : '';
  let basePrompt = `当前北京时间：${now}\n\n${promptBody}${tplNote}`;

  setLog(`模型工具${JSON.stringify(webTools.map(t => t.name || t.type))}`)
  console.log(basePrompt, "basePrompt")
  // 1. 实例化：模型名 + 基地址 + 密钥
  // 原生联网搜索场景下用 patchResponsesAnnotations 规避部分中转网关的 Responses API 流式 bug
  // （见 patchedFetch.js 注释），保留正常的逐 token 流式；isNew 避免这个特殊 fetch 配置被缓存到
  // 普通（非原生搜索）请求的模型实例上。
  const llm = ModelFactory.getChatModel(
    usingNativeSearch
      ? { isNew: true, customConfig: { ...modelOverride, patchResponsesAnnotations: true } }
      : (Object.keys(modelOverride).length ? { customConfig: modelOverride } : undefined)
  )
  const agent = createAgent({
    model: llm,
    tools: [...webTools],
    systemPrompt: new SystemMessage(basePrompt),
    middleware: [getContextEditMiddleware(), getRawResponseDiagMiddleware()],
    // middleware: [dynamicSystemPromptMiddleware(async (state, runtime) => {
    //   const localChecked = runtime.context.localChecked;
    //   const themeId = runtime.context.theme;
    //   const basePrompt = searchPrompt;
    //   if (localChecked) {
    //     return new SystemMessage(`${ragPrompt}`)
    //   }
    //   if(themeId){
    //     // 根据id查询写作画像
    //   }
    //   return  new SystemMessage(`${basePrompt}`);
    // })], //请求中间件
  });
  const streamStartTime = Date.now();
  // let tokenCount = 0; // token 计数已关闭
  const runIdToolMap = new Map(); // runId → toolName，用于 handleToolEnd 反查
  let clientAborted = false;
  let responseEnded = false;
  const abortController = new AbortController();
  res.on('close', () => {
    if (!responseEnded) {
      clientAborted = true;
      abortController.abort();
    }
  });

  // #6: 收集已生成内容，使中断/出错时也能落库，保证刷新后 UI 与历史一致
  let str = "";
  let tool = "";
  let turnPersisted = false;
  async function persistTurn(aiContent) {
    if (turnPersisted) return;
    turnPersisted = true;
    // 落库/记忆压缩任何一步出错都只记日志，绝不能让异常冒泡到调用方——
    // 否则调用方后面的 res.write(DONE)/res.end() 永远不会执行，前端会一直卡在"执行中"（发送按钮转圈不停）
    try {
      insertIntoChatMessage({
        sessionId,
        content: q,
        user: 1,
        role: "user",
        files: uploadedDocs.map(item => item.filePath).join(",")
      });
      const aiInsertResult = insertIntoChatMessage({
        sessionId,
        content: aiContent,
        user: 1,
        role: "ai",
        tools: tool
      });
      await compactChatMemory(sessionId);
      // 长期记忆抽取异步进行，不 await——不能拖慢本轮回复的落库/收尾
      processMemoryExtraction({
        userId,
        sessionId,
        sourceMessageId: aiInsertResult?.lastInsertRowid,
        question: q,
        answer: aiContent,
      }).catch((e) => setLog(`记忆抽取触发失败: ${e.message}`));
    } catch (e) {
      console.error("persistTurn failed", e);
      setLog(`对话落库失败: ${e.message}`);
    }
  }

  let stream;
  try {
    stream = await agent.stream({
      messages: messages,
    }, {
      signal: abortController.signal,
    context: {
      localChecked: localChecked
    },
    streamMode: "messages",
    callbacks: [{
      handleLLMStart: (llm, prompts) => {
        // console.log("Prompts sent to LLM:", prompts);
        // console.log("模型开始调用",{
        //    promptCount: prompts.length,
        //     prompts: prompts.map((p, i) => ({
        //     index: i,
        //     role: p.role,
        //     contentLength: p.content?.length || 0,
        //     contentPreview: p.content?.substring(0, 100) + '...'
        //   }))
        // })
        console.log("模型开始调用", llm)
        res.write(`data: ${JSON.stringify({
          type: 'model_call',
          status: 'running',
        })}\n\n`);
      },

      // LLM结束
      handleLLMEnd: (output) => {
        // console.log('LLM_END', { 
        //   totalTokens: tokenCount,
        //   outputLength: output?.generations?.[0]?.text?.length || 'unknown'
        // });
        res.write(`data: ${JSON.stringify({
          type: 'model_call',
          status: 'end',
        })}\n\n`);
      },

      // 工具开始调用 - 关键：通知前端显示loading
      handleToolStart: (tool, input, runId, parentRunId, tags, metadata, name) => {
        const toolName = name || '';
        const displayName = toolsMaps[toolName] || toolName || '执行工具';
        if (runId) runIdToolMap.set(runId, toolName);
        console.log('TOOL_START name:', toolName, 'displayName:', displayName);
        res.write(`data: ${JSON.stringify({
          type: 'tool_start',
          toolName,
          displayName,
          status: 'running',
        })}\n\n`);

        // 🔔 关键：通知前端工具开始执行，显示等待动画
        // res.write(`data: ${JSON.stringify({
        //   type: 'tool_call',
        //   status: 'running',
        //   tool: tool.name,
        //   toolDisplayName: toolsMaps[tool.name] || tool.name,
        //   message: `正在调用 ${toolsMaps[tool.name] || tool.name}...`,
        //   input: input,
        //   timestamp: Date.now(),
        //   progress: 60 + (toolCalls.length * 5) // 每个工具增加5%进度
        // })}\n`);
      },

      // 工具调用结束
      handleToolEnd: (output, runId) => {
        const toolNameDone = runIdToolMap.get(runId) || '';
        runIdToolMap.delete(runId);
        console.log('TOOL_DONE name:', toolNameDone);
        res.write(`data: ${JSON.stringify({
          type: 'tool_done',
          toolName: toolNameDone,
          status: 'end',
        })}\n\n`);
        // const callIndex = toolCalls.findIndex(t => t.name === tool.name && t.status === 'running');
        // if (callIndex !== -1) {
        //   toolCalls[callIndex].status = 'completed';
        //   toolCalls[callIndex].output = output;
        //   toolCalls[callIndex].duration = Date.now() - toolCalls[callIndex].startTime;
        // }

     

        // 🔔 通知前端工具执行完成
        // res.write(`data: ${JSON.stringify({
        //   type: 'tool_call',
        //   status: 'completed',
        //   tool: tool.name,
        //   toolDisplayName: toolsMaps[tool.name] || tool.name,
        //   message: `${toolsMaps[tool.name] || tool.name} 调用完成`,
        //   duration: toolCalls[callIndex]?.duration,
        //   timestamp: Date.now()
        // })}\n`);

        // 工具完成后，回到生成状态
        // res.write(`data: ${JSON.stringify({
        //   type: 'status',
        //   status: 'generating',
        //   message: 'AI正在整理结果...',
        //   step: 'generation',
        //   progress: 70
        // })}\n`);
      },

      // 错误处理
      handleLLMError: (error) => {
        console.log('LLM_ERROR', { error: error.message });
        if (!responseEnded && !clientAborted) {
          responseEnded = true;
          res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          res.write(`data: DONE\n\n`);
        }
      }
    }]
    });
  } catch (err) {
    if (err.name === 'AbortError' || clientAborted) {
      console.log("客户端已断开，agent.stream 已取消");
      await persistTurn(str || '（已停止生成）');
      return;
    }
    if (!responseEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      responseEnded = true;
      res.write(`data: DONE\n\n`);
      res.end();
    }
    return;
  }
  try {
    for await (const chunk of stream) {
      if (chunk[0] instanceof ToolMessage) {
        // 工具完成：把结果推给前端展示
        const toolResultEvent = buildToolResultEvent(chunk[0].name, chunk[0].content);
        if (toolResultEvent) {
          res.write(`data: ${JSON.stringify(toolResultEvent)}\n\n`);
        }
        if (!tool.includes(toolsMaps[chunk[0]?.name] || chunk[0]?.name)) {
          tool += (toolsMaps[chunk[0]?.name] || chunk[0]?.name) + ' | ';
        }
      } else {
        const textContent = extractTextContent(chunk[0]?.content);
        if (textContent) {
          str += textContent;
          res.write(`data: ${JSON.stringify({...chunk[0], content: textContent, tool: tool})}\n\n`);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || clientAborted) {
      console.log("客户端已断开，停止生成");
      await persistTurn(str || '（已停止生成）');
      return;
    }
    if (!responseEnded) {
      responseEnded = true;
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.write(`data: DONE\n\n`);
    }
    res.end();
    return;
  }

  // better-sqlite3 是同步 API，直接写入后立即发 DONE，避免快速关闭应用时丢失最后一轮
  await persistTurn(str);
  responseEnded = true;
  res.write(`data: DONE\n\n`);
  res.end();
});
//用于测试接口
chat.post('/chatComment',async (req, res) =>{
  console.log(req.body)
  res.send(success())
})

export default chat
