// @ts-ignore
import {
  success,
  error500,
  error
} from "../responseFn"
import {
  formatDate,
  createInsertSql,
  getUUid,
  buildMultimodalContent
} from "../../utils/common"
import {
  doc,
  getFormattedHtml
} from "../../utils/document";
import {
  parsePdf
} from "../../utils/pdfParser";
import {
  getDB
} from "../../utils/getDb";
import {
  ModelFactory
} from '../../model/modelFactory';
import {
  writeingPromt
} from "../../model/prompt";
import {
  ElectronTaskManager
} from "../../task-manager";
import {
  createAgent,
  ToolMessage,
  SystemMessage
} from "langchain";
import { createSearchTool, parseWebPage, getNativeSearchTools } from "../../model/tools"
import { ConfigManager } from '../../config/configmangger';
import { searchProfileWritingSamples } from "../writeStyleServer/profileSampleSearch";
import path from "path";
const db = new Proxy({}, { get: (_, prop) => getDB().db[prop] });
const express = require('express');
// id(字符串) -> AbortController：记录正在后台解析/向量化的知识库文件，删除时用来通知任务尽快停下来，
// 避免删除之后任务还在跑、甚至把向量数据在删除之后又重新写回去
const activeProcessing = new Map();
const manager = ElectronTaskManager.getInstance()
// 初始化：3 个并发 Worker
const workerPath = path.join(__dirname, 'workers', 'text-worker.js')
manager.initialize(workerPath, 3)
const textServer = express.Router();
const WRITING_MEMORY_RECENT_LIMIT = 10;
// 写作场景经常一轮就是 2000+ 字的成稿，原先 6000 字预算 2-3 轮就顶满、触发压缩，调大一些
// 给"改上一版"这种反复引用长文的场景多留点原文余量（最近一条消息现在无论如何都不会被压缩，
// 这里只是让"最近一条之前"的上下文也能多撑几轮，不是这次问题的唯一防线）
const WRITING_MEMORY_CHAR_LIMIT = 12000;
const WRITING_MEMORY_SUMMARY_TARGET = 1600;
// 知识库切分粒度：块太大会稀释embedding语义、检索不准；调小后配合混合检索(searchRags)精度更好
const KB_CHUNK_SIZE = 600;
const KB_CHUNK_OVERLAP = 120;

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

// message.content 平时（Chat Completions 协议）是纯字符串；但命中原生联网搜索走 Responses API 时，
// @langchain/openai 会把它转成内容块数组 [{type:"text", text:"...", annotations:[]}]。这里统一抹平成
// 字符串，避免下游 str += content / 推给前端的逻辑（按字符串写的）把数组隐式 toString() 拼出 "[object Object]"。
// 和 chatServer/index.js 里的 extractTextContent 保持一致逻辑。
function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return content ? String(content) : "";
}

// 把上游模型/接口报错转成用户能看懂的中文提示，未识别的错误类型原样把 message 透出
function describeAiTextError(err) {
  const raw = String(err?.message || err || "").trim();
  if (/DataInspectionFailed|inappropriate content|data_inspection_failed/i.test(raw)) {
    return "本次写作内容触发了模型的内容安全审核，被拒绝生成，请调整表述后重试。";
  }
  if (/429|rate limit/i.test(raw)) {
    return "模型接口请求过于频繁，请稍后重试。";
  }
  if (/401|403|invalid api key|unauthorized/i.test(raw)) {
    return "模型接口鉴权失败，请检查模型配置里的 API Key 是否正确。";
  }
  return raw || "写作生成失败，请稍后重试。";
}

// 样本内容如果是 PDF/Word 转出来的 Markdown，列表/段落靠换行表达语法，不能像以前那样把所有空白
// （含换行）无差别压成一个空格——只压缩多余的空格/制表符，换行符保留，连续空行最多压成一个空行。
function buildSamplePreview(content = "", limit = 1200) {
  const normalized = String(content || "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function normalizeSampleText(content = "") {
  return String(content || "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWritingRole(role = "") {
  return role === "assistant" || role === "ai" ? "assistant" : "user";
}

function formatWritingMemoryMessages(messages = []) {
  return messages
    .map((item) => {
      const role = normalizeWritingRole(item.role) === "assistant" ? "助手" : "用户";
      return `${role}：${String(item.content || "").trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

function buildMemoryText(compressedMemory = "", recentMessages = []) {
  const parts = [];
  if (String(compressedMemory || "").trim()) {
    parts.push(`压缩历史记忆：\n${String(compressedMemory).trim()}`);
  }
  const recentText = formatWritingMemoryMessages(recentMessages);
  if (recentText) {
    parts.push(`近期对话记忆：\n${recentText}`);
  }
  return parts.join("\n\n").trim();
}

function getWritingSessionRaw(sessionId) {
  if (!sessionId) return null;
  return db.prepare(`SELECT * FROM writing_chat_sessions WHERE sessionId = ?`).get(sessionId);
}

function ensureWritingSession({ sessionId, profileId, name = "" }) {
  const now = formatDate(new Date().getTime());
  const cleanSessionId = String(sessionId || "").trim() || getUUid();
  const existing = getWritingSessionRaw(cleanSessionId);
  if (existing) {
    db.prepare(
      `UPDATE writing_chat_sessions SET profileId = COALESCE(?, profileId), updatedAt = ? WHERE sessionId = ?`
    ).run(profileId || existing.profileId || null, now, cleanSessionId);
    return cleanSessionId;
  }

  db.prepare(
    `INSERT INTO writing_chat_sessions(sessionId, profileId, name, compressedMemory, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?)`
  ).run(
    cleanSessionId,
    profileId || null,
    name || "新写作会话",
    "",
    now,
    now
  );
  return cleanSessionId;
}

function listWritingMessages(sessionId, limit = 200) {
  return db
    .prepare(
      `SELECT id, sessionId, role, content, files, createdAt
       FROM writing_chat_messages
       WHERE sessionId = ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sessionId, limit);
}

function listRecentWritingMessages(sessionId, limit = WRITING_MEMORY_RECENT_LIMIT) {
  return db
    .prepare(
      `SELECT id, sessionId, role, content, createdAt
       FROM writing_chat_messages
       WHERE sessionId = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(sessionId, limit)
    .reverse();
}

function saveWritingMessage(sessionId, role, content, files = "") {
  if (!sessionId || !String(content || "").trim()) return;
  const now = formatDate(new Date().getTime());
  db.prepare(
    `INSERT INTO writing_chat_messages(sessionId, role, content, files, createdAt) VALUES(?,?,?,?,?)`
  ).run(sessionId, normalizeWritingRole(role), content, files, now);
  db.prepare(`UPDATE writing_chat_sessions SET updatedAt = ? WHERE sessionId = ?`).run(now, sessionId);
}

function deleteWritingMessagesByIds(ids = []) {
  if (!ids.length) return;
  const deleteMany = db.transaction((rows) => {
    const stmt = db.prepare(`DELETE FROM writing_chat_messages WHERE id = ?`);
    rows.forEach((id) => stmt.run(id));
  });
  deleteMany(ids);
}

async function summarizeWritingMemory(existingSummary = "", messages = [], targetChars = WRITING_MEMORY_SUMMARY_TARGET) {
  const historyText = formatWritingMemoryMessages(messages);
  if (!String(existingSummary || "").trim() && !historyText) return "";

  const prompt = `请把以下 AI 写作对话压缩成长期记忆，用于后续继续写作时保持上下文。

要求：
1. 保留用户长期偏好、正在写的主题、已确定的事实、约定的口吻、不能忘的修改意见。
2. 删除寒暄、重复内容、无效失败信息和已经不重要的过程。
3. 不要编造没有出现过的信息。
4. 输出中文，控制在 ${targetChars} 字以内。

已有压缩记忆：
${existingSummary || "无"}

需要合并的较早对话：
${historyText || "无"}`;

  try {
    const model = ModelFactory.getChatModel({ isNew: true });
    const result = await model.invoke([{ role: "user", content: prompt }]);
    return String(result?.content || result || "").trim().slice(0, targetChars * 2);
  } catch (err) {
    console.error("summarizeWritingMemory failed", err);
    return null; // null 代表压缩失败，调用方不能据此删除原始消息，等下一轮再重试
  }
}

async function compactWritingMemory(sessionId) {
  const session = getWritingSessionRaw(sessionId);
  if (!session) return;

  let compressedMemory = String(session.compressedMemory || "").trim();
  let messages = listWritingMessages(sessionId, 500);

  if (messages.length > WRITING_MEMORY_RECENT_LIMIT) {
    const older = messages.slice(0, messages.length - WRITING_MEMORY_RECENT_LIMIT);
    const summarized = await summarizeWritingMemory(compressedMemory, older);
    if (summarized === null) return; // 压缩失败：不删原始消息，本轮不落盘，等下一轮再重试
    compressedMemory = summarized;
    deleteWritingMessagesByIds(older.map((item) => item.id));
    messages = messages.slice(messages.length - WRITING_MEMORY_RECENT_LIMIT);
  }

  // messages.length > 1（而不是 > 0）：最近一条消息——通常就是刚生成的成稿，或用户刚发来的
  // 修改反馈——永远保留原文不参与压缩，哪怕它单独一条就超过字数预算。不然"根据反馈改上一版"
  // 这种场景，压缩会把用户下一句话最需要引用的那条原文直接删没，只剩一段面目全非的摘要。
  while (
    messages.length > 1 &&
    buildMemoryText(compressedMemory, messages).length > WRITING_MEMORY_CHAR_LIMIT
  ) {
    const batchSize = Math.min(2, messages.length - 1);
    const batch = messages.slice(0, batchSize);
    const summarized = await summarizeWritingMemory(compressedMemory, batch);
    if (summarized === null) break; // 压缩失败：停止本轮循环，剩余消息保留原样，已成功的部分照常落盘
    compressedMemory = summarized;
    deleteWritingMessagesByIds(batch.map((item) => item.id));
    messages = messages.slice(batchSize);
  }

  if (!messages.length && compressedMemory.length > WRITING_MEMORY_CHAR_LIMIT) {
    const summarized = await summarizeWritingMemory("", [
      { role: "assistant", content: compressedMemory },
    ], WRITING_MEMORY_SUMMARY_TARGET);
    if (summarized !== null) compressedMemory = summarized;
  }

  db.prepare(
    `UPDATE writing_chat_sessions SET compressedMemory = ?, updatedAt = ? WHERE sessionId = ?`
  ).run(compressedMemory, formatDate(new Date().getTime()), sessionId);
}

async function buildWritingMemoryContext(sessionId) {
  const session = getWritingSessionRaw(sessionId);
  if (!session) return "";

  let recentMessages = listRecentWritingMessages(sessionId, WRITING_MEMORY_RECENT_LIMIT);
  let compressedMemory = String(session.compressedMemory || "").trim();

  if (buildMemoryText(compressedMemory, recentMessages).length > WRITING_MEMORY_CHAR_LIMIT) {
    await compactWritingMemory(sessionId);
    const latest = getWritingSessionRaw(sessionId);
    compressedMemory = String(latest?.compressedMemory || "").trim();
    recentMessages = listRecentWritingMessages(sessionId, WRITING_MEMORY_RECENT_LIMIT);
  }

  return buildMemoryText(compressedMemory, recentMessages);
}

function buildWritingSystemPrompt(themeId) {
  if (!themeId) return "";
  const result = db.prepare(`SELECT * FROM articles WHERE id = ?`).get(themeId);
  if (!result) return "";

  const preferredPhrases = safeJsonParse(result.preferredPhrases, []);
  const avoidPhrases = safeJsonParse(result.avoidPhrases, []);
  const styleProfile = safeJsonParse(result.styleProfile, {});
  const writingSample = buildSamplePreview(result.originalContent);

  return `${writeingPromt}

这是用户的个人写作画像，你要优先模仿这种写作方式。
写作场景：${result.scene || "未指定"}

用户身份：${result.identity || "未指定"}

用户常用表达：${preferredPhrases.length ? preferredPhrases.join("、") : "无"}

用户应避免表达：
${avoidPhrases.length ? avoidPhrases.join("、") : "无"}

个人风格画像：${styleProfile.summary || "未指定"}

参考样本摘录：
${writingSample || result.content || ""}

模仿要求：
1. 优先模仿用户的语气、用词、节奏、开头和结尾习惯
2. 可以参考样本的文风，但不要照抄原文
3. 默认优先使用用户常用表达，避免使用用户不喜欢的说法
4. 写出来的内容要像用户自己写的，而不是像在描述用户的风格`;
}

function buildWritingSampleStyleText(item = {}) {
  if (item.analysisProfile) {
    const analysis = item.analysisProfile || {};
    const parts = [];
    if (analysis.summary) parts.push(`摘要：${buildSamplePreview(analysis.summary, 120)}`);
    if (analysis.writingTechniques?.length) {
      parts.push(`写作手法：${analysis.writingTechniques.slice(0, 6).join("、")}`);
    }
    if (analysis.writingStyle) {
      parts.push(`风格：${buildSamplePreview(analysis.writingStyle, 180)}`);
    }
    if (analysis.coreIdea) {
      parts.push(`核心思想：${buildSamplePreview(analysis.coreIdea, 160)}`);
    }
    if (item.structureNote) parts.push(`结构：${item.structureNote}`);
    if (parts.length) return parts.join("\n");
  }

  const text = item.chunkText || item.content || "";
  const preview = buildSamplePreview(text, 160);
  return item.structureNote ? `${preview}\n结构：${item.structureNote}` : preview;
}

function buildRetrievedWritingSamplesText(samples = []) {
  if (!samples.length) return "";
  return samples
    .map((item, index) => {
      const title = item.sourceName ? `【${item.sourceName}】` : "";
      return `${index + 1}. ${title}\n${buildWritingSampleStyleText(item)}`;
    })
    .join("\n");
}

function normalizeSelectedSampleIds(value = []) {
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();

  for (const raw of values) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= 2) break;
  }

  return result;
}

function listSelectedWritingSamples(profileId, sampleIds = []) {
  const cleanProfileId = Number(profileId);
  const cleanIds = normalizeSelectedSampleIds(sampleIds);
  if (!cleanProfileId || !cleanIds.length) return [];

  const placeholders = cleanIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT id, sourceName, content, profileId
           , analysisProfile, styleTemplate
      FROM writingProfileSamples
      WHERE profileId = ?
        AND id IN (${placeholders})
    `
    )
    .all(cleanProfileId, ...cleanIds);

  const byId = new Map(rows.map((item) => [Number(item.id), item]));
  return cleanIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      sourceName: item.sourceName || "写作样本",
      content: item.content || "",
      analysisProfile: safeJsonParse(item.analysisProfile, {}),
      structureNote: safeJsonParse(item.styleTemplate, {}).structureNote,
    }));
}

function findSourceSampleForChunk(sampleRows = [], chunkText = "") {
  const chunk = normalizeSampleText(chunkText);
  if (!chunk) return null;

  return sampleRows.find((sample) => {
    const content = normalizeSampleText(sample.content);
    return content && (content.includes(chunk) || chunk.includes(content));
  }) || null;
}

function enrichRetrievedWritingSamplesWithAnalysis(profileId, retrievedSamples = []) {
  const cleanProfileId = Number(profileId);
  if (!cleanProfileId || !retrievedSamples.length) return retrievedSamples;

  const sampleRows = db
    .prepare(
      `
      SELECT id, sourceName, content, analysisProfile, styleTemplate
      FROM writingProfileSamples
      WHERE profileId = ?
      ORDER BY createTime DESC, id DESC
    `
    )
    .all(cleanProfileId);
  if (!sampleRows.length) return retrievedSamples;

  const seenSampleIds = new Set();
  const enriched = [];

  for (const item of retrievedSamples) {
    const sourceSample = findSourceSampleForChunk(sampleRows, item.chunkText);
    if (!sourceSample) {
      enriched.push(item);
      continue;
    }
    if (seenSampleIds.has(sourceSample.id)) continue;
    seenSampleIds.add(sourceSample.id);
    enriched.push({
      ...item,
      sampleId: sourceSample.id,
      sourceName: sourceSample.sourceName || "写作样本",
      content: sourceSample.content || "",
      analysisProfile: safeJsonParse(sourceSample.analysisProfile, {}),
      structureNote: safeJsonParse(sourceSample.styleTemplate, {}).structureNote,
    });
  }

  return enriched.length ? enriched : retrievedSamples;
}

async function buildWritingSystemPromptV2(themeId, userPrompt = "", options = {}) {
  if (!themeId) return options.returnContext ? { systemPrompt: "", retrievedSamples: [] } : "";
  const result = db.prepare(`SELECT * FROM articles WHERE id = ?`).get(themeId);
  if (!result) return options.returnContext ? { systemPrompt: "", retrievedSamples: [] } : "";

  const preferredPhrases = safeJsonParse(result.preferredPhrases, []);
  const avoidPhrases = safeJsonParse(result.avoidPhrases, []);
  const styleProfile = safeJsonParse(result.styleProfile, {});
  let retrievedSamples = [];
  const selectedSamples = Array.isArray(options.selectedSamples) ? options.selectedSamples : [];
  const sampleSectionTitle = selectedSamples.length ? "用户指定风格样本" : "相似风格样本片段";

  if (selectedSamples.length) {
    retrievedSamples = selectedSamples;
  } else if (options.includeSamples !== false) {
    try {
      retrievedSamples = await searchProfileWritingSamples({
        profileId: themeId,
        query: userPrompt,
        topK: 4,
        minScore: 0.6,
        fallbackContent: result.originalContent,
        profileContext: {
          title: result.title,
          scene: result.scene,
          identity: result.identity,
          preferredPhrases,
          avoidPhrases,
        },
      });
      retrievedSamples = enrichRetrievedWritingSamplesWithAnalysis(themeId, retrievedSamples);
    } catch (error) {
      console.error("buildWritingSystemPromptV2 search failed", error);
    }
  }
  const writingSample = buildRetrievedWritingSamplesText(retrievedSamples);

  // 通用规则（别解释过程、以用户需求为准、语气自然、Markdown 规范……）都在 writeingPromt 里，
  // 这里只放"这次请求特有、依赖样本内容"的规则，避免和 writeingPromt 说同一件事，
  // 没有样本时 requirementLines 为空，直接不渲染"执行要求"这个空段落。
  //
  // 样本标注的结构规律（"一、二、三"编号还是"第X章"等）不是建议，是硬性要求——
  // 因为导出 Word 时(documentGenerator.parseParagraphs)全靠 markdown 的 #/##/### 语法
  // 识别标题层级，AI 只学"语气"、标题写成正文里的一句话，上传样本时提取好的格式模板就套不上。
  const structureNotes = [...new Set(retrievedSamples.map((item) => item.structureNote).filter(Boolean))];
  const requirementLines = [];
  if (retrievedSamples.length) {
    requirementLines.push(
      "1. 上方样本仅用于学习写作风格（语气、句式、段落节奏、结构推进、开头和结尾方式），不作为事实来源。",
      "2. 不要继承、复述或改写样本里的具体事实、主题、人物、事件、数据和观点。"
    );
  }
  if (structureNotes.length) {
    requirementLines.push(
      `${requirementLines.length + 1}. 样本标注的结构规律为"${structureNotes.join("；")}"。生成内容要按同样的编号方式组织段落层级，并且必须使用 Markdown 标题语法（#、##、### 等）标出对应层级的标题，不要把标题写成正文段落开头的一句话。`
    );
  }
  const executionSection = requirementLines.length ? `\n\n执行要求：\n${requirementLines.join("\n")}` : "";

  const systemPrompt = `${writeingPromt}

用户本次写作需求会作为 user message 传入，必须优先满足。

写作画像：
- 场景：${result.scene || "未指定"}
- 身份：${result.identity || "未指定"}
- 总画像：${styleProfile.summary || "未指定"}
- 常用表达：${preferredPhrases.length ? preferredPhrases.join("、") : "无"}
- 避免表达：${avoidPhrases.length ? avoidPhrases.join("、") : "无"}

${sampleSectionTitle}：
${writingSample || "无"}${executionSection}`;

  if (options.returnContext) {
    return {
      systemPrompt,
      retrievedSamples,
      profileTitle: result.title || "",
    };
  }

  return systemPrompt;
}

textServer.post('/add', (req, res) => {
  const {
    name
  } = req.body;
  if (!name) {
    res.send(error500('name不能为空'));
  }
  let stmt = db.prepare(` INSERT INTO textType (labelType, createTime) VALUES (?, ?)`);
  const result = stmt.run(name, formatDate(new Date().getTime()));
  res.send(success({
    id: result.lastInsertRowid
  }))
});

textServer.get('/writingChat/sessions', (req, res) => {
  const { profileId } = req.query;
  if (!profileId) {
    res.send(success([]));
    return;
  }

  const result = db.prepare(`
    SELECT
      s.sessionId,
      s.profileId,
      s.name,
      s.compressedMemory,
      s.createdAt,
      s.updatedAt,
      (
        SELECT content
        FROM writing_chat_messages m
        WHERE m.sessionId = s.sessionId
          AND m.role = 'user'
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview
    FROM writing_chat_sessions s
    WHERE s.profileId = ?
    ORDER BY s.updatedAt DESC
  `).all(profileId);

  res.send(success(result));
});

textServer.post('/writingChat/sessions', (req, res) => {
  const { profileId, name } = req.body;
  const sessionId = ensureWritingSession({
    profileId,
    name: name || "新写作会话",
  });
  res.send(success({ sessionId }));
});

textServer.get('/writingChat/sessions/:sessionId/messages', (req, res) => {
  const { sessionId } = req.params;
  const result = listWritingMessages(sessionId, 200).map((item) => ({
    ...item,
    role: item.role === "assistant" ? "ai" : "user",
  }));
  res.send(success(result));
});

textServer.delete('/writingChat/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const removeSession = db.transaction((id) => {
    db.prepare(`DELETE FROM writing_chat_messages WHERE sessionId = ?`).run(id);
    db.prepare(`DELETE FROM writing_chat_sessions WHERE sessionId = ?`).run(id);
  });
  removeSession(sessionId);
  res.send(success());
});

textServer.post('/writingFeedback', (req, res) => {
  const {
    profileId,
    sessionId = "",
    userPrompt = "",
    aiDraft = "",
    userFeedback = "",
    revisedDraft = "",
    score,
    accepted = false,
  } = req.body || {};

  const numericScore = Number(score);
  if (!profileId) {
    res.send(error500("profileId不能为空"));
    return;
  }
  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 10) {
    res.send(error500("评分必须是1到10分"));
    return;
  }
  if (!String(aiDraft || "").trim()) {
    res.send(error500("反馈内容不能为空"));
    return;
  }

  const duplicate = db.prepare(`
    SELECT id
    FROM writing_feedback_pool
    WHERE profileId = ?
      AND IFNULL(sessionId, '') = ?
      AND IFNULL(userPrompt, '') = ?
      AND IFNULL(aiDraft, '') = ?
      AND IFNULL(userFeedback, '') = ?
      AND score = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(
    profileId,
    String(sessionId || ""),
    String(userPrompt || ""),
    String(aiDraft || ""),
    String(userFeedback || ""),
    numericScore
  );

  if (duplicate?.id) {
    res.send(success({ id: duplicate.id, duplicated: true }, "反馈已保存"));
    return;
  }

  const now = formatDate(new Date().getTime());
  const result = db.prepare(`
    INSERT INTO writing_feedback_pool(
      profileId,
      sessionId,
      userPrompt,
      aiDraft,
      userFeedback,
      revisedDraft,
      score,
      accepted,
      status,
      createTime,
      updateTime
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    profileId,
    sessionId,
    userPrompt,
    aiDraft,
    userFeedback,
    revisedDraft,
    numericScore,
    accepted ? 1 : 0,
    "pending_profile_review",
    now,
    now
  );

  res.send(success({ id: result.lastInsertRowid }));
});

textServer.post('/aiText',async (req, res) => {
  const {
    prompt,
    themeId,
    sessionId,
    streamEvents = false,
    selectedSampleIds = [],
    uploadedDocs = [],
    modelName, //前端对话框上快速切换的模型，不传则用模型配置页的全局设置
    reasoningEffort //前端对话框上快速切换的推理强度，不传则用模型配置页的全局设置
  } =  req.body;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const imagePaths = uploadedDocs.filter(d => d.type === 'image').map(d => d.filePath);
  // 联网搜索工具选择逻辑保持和 chatServer 一致：模型配置页勾选了 nativeSearch 且当前模型命中
  // OpenAI/Grok 系列时，优先用厂商自带的原生 web_search，命中就不再挂自建爬虫工具；
  // 否则（开关未开或模型不支持）回退到自建的抓取式搜索——写作对话框本身没有联网开关，
  // 搜索能力始终可用，这里只是决定"用哪种方式搜"，不改变"要不要搜"
  const chatCfg = ConfigManager.getInstance().getConfig()?.chat || {};
  // 对话框上快速切换的模型/推理强度覆盖全局配置，为空则回退全局默认
  const effectiveModelName = (modelName || '').trim() || chatCfg.modelName;
  const modelOverride = {};
  if (modelName && modelName.trim()) modelOverride.modelName = modelName.trim();
  if (['low', 'medium', 'high'].includes(reasoningEffort)) modelOverride.reasoningEffort = reasoningEffort;
  // "none"（对话框上的"极速"）显式强制不带 reasoning 参数，用空字符串写入 override——
  // 和"没传 reasoningEffort"（undefined）区分开，避免 ModelFactory 用 ?? 回退到全局默认强度
  else if (reasoningEffort === 'none') modelOverride.reasoningEffort = '';
  const nativeSearchTools = chatCfg.nativeSearch ? getNativeSearchTools(effectiveModelName) : [];
  const usingNativeSearch = nativeSearchTools.length > 0;
  // 每个请求单独创建抓取式联网搜索工具：闭包内限制最多 5 次调用、连续失败 3 次后停止，避免模型反复换词重试
  const webTools = usingNativeSearch ? [...nativeSearchTools] : [createSearchTool(5, 3), parseWebPage];
  // 原生联网搜索场景下用 patchResponsesAnnotations 规避部分中转网关的 Responses API 流式 bug，
  // 和 chatServer 保持一致；isNew 避免这个特殊 fetch 配置被缓存到普通请求的模型实例上
  const llm = ModelFactory.getChatModel(
    usingNativeSearch
      ? { isNew: true, customConfig: { ...modelOverride, patchResponsesAnnotations: true } }
      : (Object.keys(modelOverride).length ? { customConfig: modelOverride } : undefined)
  );
  let str = "";
  let tool = "";
  const toolsMap = { webSearch: "联网搜索", parseWebPage: "解析网页" };
  const runIdToolMap = new Map(); // runId → toolName，用于 handleToolEnd 反查

  // 客户端中断（点击"停止"或断开连接）时，真正取消后端的模型调用，而不是只让前端停止读取
  const backendAbort = new AbortController();
  let responseEnded = false;
  res.on("close", () => {
    if (!responseEnded) backendAbort.abort();
  });

  const writeEvent = (event) => {
    if (backendAbort.signal.aborted || res.writableEnded) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
  };
  const writeContent = (content) => {
    if (backendAbort.signal.aborted || res.writableEnded) return;
    if (streamEvents) {
      writeEvent({ type: "content", content });
    } else {
      try { res.write(`data: ${content}\n\n`); } catch {}
    }
  };
  let persisted = false;
  const persistWritingTurn = async () => {
    if (persisted) return;
    persisted = true;
    if (writingSessionId && String(prompt || "").trim()) {
      try {
        saveWritingMessage(writingSessionId, "user", prompt, uploadedDocs.map(d => d.filePath).join(","));
        saveWritingMessage(writingSessionId, "assistant", str || "（已停止生成）");
        await compactWritingMemory(writingSessionId);
      } catch (err) {
        console.error("save writing memory failed", err);
      }
    }
  };

  const writingSessionId = sessionId
    ? ensureWritingSession({ sessionId, profileId: themeId, name: "写作会话" })
    : "";
  const writingSession = writingSessionId ? getWritingSessionRaw(writingSessionId) : null;
  const selectedWritingSamples = themeId
    ? listSelectedWritingSamples(themeId, selectedSampleIds)
    : [];
  const hasSelectedSampleIds = normalizeSelectedSampleIds(selectedSampleIds).length > 0;
  const hasSelectedWritingSamples = selectedWritingSamples.length > 0;
  const hasWritingSessionHistory = Boolean(String(writingSession?.compressedMemory || "").trim()) ||
    (writingSessionId ? listWritingMessages(writingSessionId, 1).length > 0 : false);
  const shouldRetrieveWritingSamples = hasSelectedSampleIds
    ? false
    : writingSessionId
    ? !hasWritingSessionHistory
    : Boolean(themeId);

  if (streamEvents && writingSessionId) {
    writeEvent({
      type: "tool_start",
      toolName: "writingMemory",
      displayName: "读取写作记忆",
    });
  }

  const writingMemory = writingSessionId ? await buildWritingMemoryContext(writingSessionId) : "";

  if (streamEvents && writingSessionId) {
    if (writingMemory) {
      writeEvent({
        type: "tool_result",
        toolName: "writingMemory",
        results: [{
          index: 1,
          source: "写作会话记忆",
          content: buildSamplePreview(writingMemory, 180),
        }],
      });
    }
    writeEvent({
      type: "tool_done",
      toolName: "writingMemory",
    });
  }

  if (streamEvents && themeId && (hasSelectedWritingSamples || shouldRetrieveWritingSamples)) {
    writeEvent({
      type: "tool_start",
      toolName: "writingProfile",
      displayName: hasSelectedWritingSamples ? "读取用户指定风格样本" : "读取写作画像与相似风格样本",
    });
  }

  const promptContext = await buildWritingSystemPromptV2(themeId, prompt, {
    returnContext: Boolean(streamEvents),
    includeSamples: shouldRetrieveWritingSamples,
    selectedSamples: selectedWritingSamples,
  });
  const systemPrompt = streamEvents ? promptContext.systemPrompt : promptContext;

  if (streamEvents && themeId && (hasSelectedWritingSamples || shouldRetrieveWritingSamples)) {
    const results = (promptContext.retrievedSamples || []).map((item, index) => ({
      index: index + 1,
      source: hasSelectedWritingSamples ? (item.sourceName || "用户指定风格样本") : "相似风格样本",
      content: buildSamplePreview(buildWritingSampleStyleText(item), 220),
      similarity: item.score != null ? Math.round(Number(item.score) * 100) : undefined,
    }));
    writeEvent({
      type: "tool_result",
      toolName: "writingProfile",
      results,
    });
    writeEvent({
      type: "tool_done",
      toolName: "writingProfile",
    });
  }
  let messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (writingMemory) {
    messages.push({
      role: "system",
      content: `以下是本写作会话的持久记忆。它只用于补充上下文；如果和用户本次输入冲突，优先服从用户本次输入。\n\n${writingMemory}`,
    });
  }
  // 单独作为一条消息、紧挨在用户输入前面，而不是塞进大段系统提示词里，避免被前面的画像/样本内容淹没
  messages.push({
    role: "system",
    content: `当前北京时间：${formatDate(new Date().getTime())}`,
  });
  messages.push({ role: "user", content: buildMultimodalContent(prompt, imagePaths) });
  console.log(systemPrompt,"===");
  
  const agent = createAgent({ model: llm, tools: webTools });
  let stream;
  try {
    stream = await agent.stream({ messages }, {
      streamMode: "messages",
      signal: backendAbort.signal,
      callbacks: [{
        // 工具开始调用：让前端展示对应步骤的 loading 状态
        handleToolStart: (toolDef, input, runId, parentRunId, tags, metadata, name) => {
          const toolName = name || "";
          if (runId) runIdToolMap.set(runId, toolName);
          if (streamEvents) {
            writeEvent({
              type: "tool_start",
              toolName,
              displayName: toolsMap[toolName] || toolName || "执行工具",
            });
          }
        },
        handleToolEnd: (output, runId) => {
          const toolName = runIdToolMap.get(runId) || "";
          runIdToolMap.delete(runId);
          if (streamEvents) {
            writeEvent({ type: "tool_done", toolName });
          }
        },
      }],
    });
  } catch (err) {
    if (err.name === "AbortError" || backendAbort.signal.aborted) {
      responseEnded = true;
      await persistWritingTurn();
      res.end();
      return;
    }
    console.error("aiText agent.stream failed", err);
    const friendlyMsg = describeAiTextError(err);
    if (streamEvents) {
      writeEvent({ type: "error", error: friendlyMsg });
    } else {
      writeContent(`[写作失败：${friendlyMsg}]`);
    }
    res.end();
    return;
  }

  try {
    for await (const chunk of stream) {
      const message = chunk[0];
      if (message instanceof ToolMessage) {
        const toolName = message.name;
        if (!tool.includes(toolsMap[toolName] || toolName)) {
          tool += (toolsMap[toolName] || toolName) + ";";
        }
        if (streamEvents) {
          try {
            const parsed = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
            if (toolName === "webSearch" && parsed?.results?.length) {
              writeEvent({ type: "tool_result", toolName: "webSearch", results: parsed.results });
            } else if (toolName === "parseWebPage" && parsed?.success) {
              writeEvent({
                type: "tool_result",
                toolName: "parseWebPage",
                parseResult: { title: parsed.title, url: parsed.url, markdown: parsed.markdown },
              });
            }
          } catch (e) {
            // 工具结果解析失败时不展示细节，不影响正文继续生成
          }
        }
        continue;
      }
      if (message?.content) {
        const textContent = extractTextContent(message.content);
        if (textContent) {
          str += textContent;
          writeContent(textContent);
        }
      }
    }
  } catch (err) {
    // agent 在流式生成过程中报错（比如上游模型内容审核拦截，或客户端中断触发的 AbortError）：
    // 这里必须捕获并通知前端，否则会变成未处理的 Promise rejection，前端的连接永远收不到结束信号，一直卡在"写作中"
    if (!(err.name === "AbortError" || backendAbort.signal.aborted)) {
      console.error("aiText stream failed", err);
      const friendlyMsg = describeAiTextError(err);
      if (streamEvents) {
        writeEvent({ type: "error", error: friendlyMsg });
      } else {
        writeContent(`\n\n[写作失败：${friendlyMsg}]`);
      }
    }
  }

  responseEnded = true;
  // 无论正常结束还是中途中断，都把已生成的部分内容落库，避免刷新/重进会话后记录丢失
  await persistWritingTurn();
  res.end();
})
textServer.get('/del', (req, res) => {
  const {
    id
  } = req.query;
  if (!id) {
    res.send(error500('id不能为空'));
  }
  let stmt = db.prepare(` DELETE FROM textType WHERE id = ?`);
  const result = stmt.run(id);
  res.send(success({
    id: result.lastInsertRowid
  }))
})
textServer.get('/list', (req, res) => {
  const {
    keyWord = ""
  } = req.query;
  let stmt = db.prepare(` SELECT * FROM textType WHERE labelType LIKE '%${keyWord}%' ORDER BY createTime DESC`);
  const result = stmt.all();
  res.send(success(result))
})
textServer.get('/delText', (req, res) => {
  const {
    id
  } = req.query;
  if (!id) {
    res.send(error500('id不能为空'));
  }
  // 这条记录如果还在后台解析/向量化，先通知它取消，让它在下一个检查点尽快停下来，
  // 不然任务还在跑，删完之后向量数据可能又被写回去
  const controller = activeProcessing.get(String(id));
  if (controller) {
    controller.abort();
    activeProcessing.delete(String(id));
    console.log(`记录 ${id} 处理中被删除，已通知后台任务取消`);
  }
  const transaction = db.transaction(() => {
    // 1. 删除子表中的文本记录
    db.prepare('DELETE FROM texts WHERE id = ?').run(id);

    // 2. 删除主表中的向量记录
    db.prepare('DELETE FROM embdingTable WHERE relateId = ?').run(id);
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
textServer.put('/textDetail/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  // 不允许更新 id 字段
  delete updates.id;
  // 获取所有允许更新的字段
  const allowedFields = ['content', 'title', 'typeId', 'isRag', 'isUpload', 'status','markdownContent'];
  // 过滤出实际需要更新的字段
  const fieldsToUpdate = Object.keys(updates).filter(key => 
    allowedFields.includes(key) && updates[key] !== undefined
  );
  // 如果没有有效字段需要更新
  if (fieldsToUpdate.length === 0) {
    return res.send(error('没有提供需要更新的字段'));
  }
  // 构建动态 SQL
  const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
  const values = fieldsToUpdate.map(field => updates[field]);
  values.push(id); // 添加 id 作为 WHERE 条件
  let stl = db.prepare(`SELECT * FROM texts WHERE id = ?`);
  const detail = stl.get(id);
  // 如果内容变化了，需要删除之前的向量内容并重新向量化
  if((updates.markdownContent&&detail.markdownContent!==updates.markdownContent)&&detail.isRag==1){
    db.prepare('DELETE FROM embdingTable WHERE relateId = ?').run(id);
    let docObj = new doc({
      chunkSize: KB_CHUNK_SIZE,
      chunkOverlap: KB_CHUNK_OVERLAP
    });
    handelText(updates.markdownContent,id,docObj)
  }
  // 如果从非向量化切换为需要向量化
  if((updates.isRag&&updates.isRag==1)&&detail.isRag==2){
    if(detail.markdownContent){
      db.prepare('DELETE FROM embdingTable WHERE relateId = ?').run(id);
      let docObj = new doc({
        chunkSize: KB_CHUNK_SIZE,
        chunkOverlap: KB_CHUNK_OVERLAP
      });
      handelText(detail.markdownContent,id,docObj)
    }
  }
  // 如果取消这篇文章的向量化
  if((updates.isRag&&updates.isRag==2)&&detail.isRag==1){
    console.log("取消向量化",id)
    db.prepare('DELETE FROM embdingTable WHERE relateId = ?').run(id);
  }
  const sql = `UPDATE texts SET ${setClause} WHERE id = ?`;
  try {
    let stmt = db.prepare(sql);
    const result = stmt.run(...values);
    if (result.changes === 0) {
      return res.send(error('未找到该记录或无需更新'));
    }
    res.send(success('更新成功'));
  } catch (err) {
    res.send(error('更新失败: ' + err.message));
  }
});
textServer.get('/textDetail/:id',(req,res)=>{
  const {id} = req.params;
  let stmt = db.prepare(` SELECT * FROM texts WHERE id = ?`);
  const result = stmt.get(id);
  res.send(success(result))
})
textServer.post('/saveText', async (req, res) => {
  const {
    filePaths,
    isRag = 1,
    typeId = "",
    title = "",
    isUpload = 1,
  } = req.body;
  // 文件上传方式处理
  if (isUpload == 1) {
    if (!filePaths || filePaths.length == 0) {
      return res.send(error500('filePaths不能为空'));
    }
    // 先给每个文件插入一条"处理中"占位记录并立刻返回，真正的解析（PDF 多页 + 视觉模型识别耗时明显）
    // 和向量化放到后台异步跑，避免前端长时间转圈等待、甚至撞上 axios 5 分钟超时。
    // 构造 doc 实例这一步是同步的，文件类型不支持时会在这里直接抛错，逐个 try/catch 保证一个文件的
    // 类型错误不影响同批次其他文件。
    const inserted = [];
    const immediateFailed = [];
    for (const path of filePaths) {
      try {
        const docObj = new doc({
          docPath: path.filePath,
          chunkSize: KB_CHUNK_SIZE,
          chunkOverlap: KB_CHUNK_OVERLAP
        });
        let stmt = db.prepare(`INSERT INTO texts(fileName,title,content,markdownContent,size,docType,docPath,typeId,isRag,isUpload,status,process,createTime) values(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const result = stmt.run(path.fileName, title, "", "", path.sizeFormatted, docObj.docType, path.filePath, typeId, isRag, isUpload, 2, 0, formatDate(new Date().getTime()));
        inserted.push({ id: result.lastInsertRowid, path, docObj });
      } catch (error) {
        console.error(`解析文件失败: ${path.fileName}`, error);
        immediateFailed.push({ fileName: path.fileName, errorMsg: error?.message || String(error) });
      }
    }
    if (inserted.length === 0) {
      const detail = immediateFailed.map(f => `${f.fileName}: ${f.errorMsg}`).join('; ');
      return res.send(error500(`文件解析失败 - ${detail}`));
    }
    res.send(success({
      inserted: inserted.map(i => ({ id: i.id, fileName: i.path.fileName })),
      failed: immediateFailed
    }));

    // 响应已经发出去了，后面全部是后台处理，不阻塞请求
    inserted.forEach(({ id, path, docObj }) => {
      processUploadedFile(id, path, docObj, isRag).catch(error => {
        console.error(`处理文件失败: ${path.fileName}`, error);
        db.prepare(`UPDATE texts SET status = 0 WHERE id = ?`).run(id);
      });
    });
  }else{
    let stmt = db.prepare(`INSERT INTO texts(title,content,docType,typeId,isRag,isUpload,status,createTime) values(?,?,?,?,?,?,?,?)`);
    let status = 0;
    if(isRag==2){
      status =1
    }
    const result = stmt.run(title, "","自定义",typeId, isRag ,isUpload, status, formatDate(new Date().getTime()));
    res.send(success(result))
  }
})
// 占位记录插入之后，真正做解析（PDF 逐页抽文字/视觉识别，其它类型走 loader）+ 更新展示内容和向量化，
// 全程通过 process/status 更新进度，前端轮询 /textList 就能看到实时百分比。
async function processUploadedFile(id, path, docObj, isRag) {
  const controller = new AbortController();
  activeProcessing.set(String(id), controller);
  try {
    const progressStmt = db.prepare(`UPDATE texts SET process = ?, status = ? WHERE id = ?`);
    let str = "";
    let displayContent = "";
    if (docObj.docType === 'pdf') {
      // 解析阶段进度占 0-90%，剩下 10% 留给向量化前的收尾；向量化阶段的进度由 handelText 自己接着写
      const parsed = await parsePdf(path.filePath, (page, total) => {
        const pct = Math.min(90, Math.round((page / total) * 90));
        progressStmt.run(pct, 2, id);
      }, controller.signal);
      str = parsed.text;
      displayContent = parsed.html;
    } else {
      let text = await docObj.loader.load();
      text.forEach(t => {
        str += t.pageContent
      })
      // content：展示用，优先带格式的 HTML（目前仅 word 支持），拿不到则回退纯文本
      // markdownContent：向量化专用的干净纯文本，不受格式转换影响
      const html = await getFormattedHtml(path.filePath);
      displayContent = html || str;
    }

    if (controller.signal.aborted) {
      console.log(`记录 ${id} 已在解析过程中被删除，放弃写入解析结果`);
      return;
    }
    db.prepare(`UPDATE texts SET content = ?, markdownContent = ?, process = ? WHERE id = ?`)
      .run(displayContent, str, 90, id);

    if (isRag == 1) {
      if (!str) {
        // handelText 内部靠 `if (text && id)` 判断要不要跑，text 是空字符串时整个函数体会被跳过、
        // 永远不会把 status/process 写到终态，记录会永远停在"处理中 90%"。这里提前拦一道，
        // 明确标记失败并说明原因，而不是让它卡死。
        console.error(`记录 ${id} 解析结果为空文本，无法向量化: ${path.fileName}`);
        progressStmt.run(0, 0, id);
      } else {
        await handelText(str, id, docObj, controller.signal);
      }
    } else {
      progressStmt.run(100, 1, id);
    }
  } finally {
    activeProcessing.delete(String(id));
  }
}
async function handelText(text, id, docObj, signal) {
  let updateStmt = db.prepare(`UPDATE texts SET process = ?,status=? WHERE id = ?`);
  try {
    if (text && id) {
      // signal 只在文件上传后台处理这条路径上会传（对应删除时可能触发取消）；编辑页重新向量化那两处
      // 调用没传 signal，undefined?.aborted 恒为 false，行为跟之前完全一样
      if (signal?.aborted) return;
      let embdingModel = ModelFactory.getEmbeddingModel();
      const vectorDb = getDB();
      updateStmt.run(10, 2, id);
      let texts = await docObj.textSplitter.splitText(text);
      if (signal?.aborted) return;
      updateStmt.run(50, 2, id);
      let vectors = await embdingModel.embedDocuments(texts);
      if (signal?.aborted) return;
      updateStmt.run(60, 2, id);
      for (let i = 0; i < vectors.length; i++) {
        // 逐条检查：即使已经拿到了全部 embedding 结果，中途被取消也不再继续写入向量库，
        // 避免删除记录之后向量数据又被写回去
        if (signal?.aborted) return;
        vectorDb.insert(vectors[i], texts[i], id)
      }
      if (signal?.aborted) return;
      vectorDb.quantize();
      updateStmt.run(100, 1, id);
    }
  } catch (error) {
    console.error('向量化失败', error);
    updateStmt.run(0, 0, id);
  }
}
textServer.get('/textList', (req, res) => {
  const {
      keyWord = "",
      page = 1,
      pageSize = 10,
      typeId = null
  } = req.query;
  const pageNum = Math.max(1, Number(page));
  const sizeNum = Math.max(1, Number(pageSize));
  const offset = (pageNum - 1) * sizeNum;
  let sql = `SELECT * FROM texts 
  WHERE title LIKE ? 
  ${typeId ? 'AND typeId = ?' : ''}
  ORDER BY createTime DESC 
  LIMIT ? OFFSET ?`
  const params = [`%${keyWord}%`];
  const totalPrams = [`%${keyWord}%`];
  if (typeId) {
    params.push(typeId);
    totalPrams.push(typeId);
  }
  params.push(sizeNum, offset);
  let stmt = db.prepare(sql);
  const list = stmt.all(...params);
  let totalSql = `SELECT COUNT(*) AS total FROM texts WHERE title LIKE ? ${typeId ? 'AND typeId = ?' : ''}`

  const totalsmt = db.prepare(totalSql);
  const {
    total
  } = totalsmt.get(...totalPrams);
  res.send(success({
    list,
    page: pageNum,
    pageSize: sizeNum,
    total
  }))
})
export default textServer

void createInsertSql;
void createAgent;
void ToolMessage;
void SystemMessage;
