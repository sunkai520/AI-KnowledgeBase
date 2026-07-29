import { success, error500 } from "../responseFn";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { contextEditingMiddleware, ClearToolUsesEdit, createMiddleware } from "langchain";
import { ModelFactory } from "../../model/modelFactory";
import { ConfigManager } from "../../config/configmangger";
import { DataPathManager } from "../../utils/dataPathManager";
import { MemorySaver } from "@langchain/langgraph";
import { getSystemPath, getUUid, formatDate, buildMultimodalContent, estimateTokens } from "../../utils/common";
import { doc } from "../../utils/document";
import { setLog } from "../../event/index";
import { Command } from "@langchain/langgraph";
import { browser, clearBrowserFailureTracker, clearOpenUrlAttemptTracker } from "../../model/browserTools";
import { generateWordTool, searchLocalKB } from "../../model/tools";
import { generateImageTool, generateVideoFromImageTool, composeVideoTool, extractLastFrameTool } from "../../model/mediaTools";
import { getDB } from "../../utils/getDb";
import { processMemoryExtraction, retrieveRelevantMemories } from "../../model/memoryExtractor";
import {
  resolveSkillMdPath,
  parseSkillMd,
  writeSkillMd,
  updateSkillContent,
  createAgentManagementTools,
  createExecuteTool,
  createWorkdirReadTools,
} from "../../model/agentTools";
import {
  extractFilesFromZip,
  readFilesFromDir,
  fetchFilesFromUrl,
  buildSkillPreview,
  writeImportedSkill,
} from "../../skills/importSkill";

const fs = require("fs-extra");
const path = require("path");
const express = require("express");
const deepChat = express.Router();

// 文生图/图生视频/视频合成结果不管模型自己怎么措辞，都强制把媒体直接嵌入最终回复内容，
// 保证图片/视频一定在对话内容区域可见，不依赖模型是否记得用 markdown 语法复述地址。
const MEDIA_RESULT_TOOLS = {
  generate_image: "image",
  generate_video_from_image: "video",
  compose_video: "video",
  extract_video_last_frame: "image",
};
function extractMediaMarkdown(toolName, raw) {
  const kind = MEDIA_RESULT_TOOLS[toolName];
  if (!kind) return "";
  const match = String(raw || "").match(/https?:\/\/127\.0\.0\.1:5120\/uploads\/generated\/(?:images|videos)\/[^\s"'<>)]+/);
  if (!match) return ""; // 生成失败时 raw 里没有地址，不注入
  return kind === "image"
    ? `\n\n![生成图片](${match[0]})\n`
    : `\n\n<video controls src="${match[0]}" style="max-width:100%"></video>\n`;
}

// ─── 统一日志函数（同时写控制台 + 日志文件） ──────────────────────────────
function agentLog(tag, ...args) {
  const prefix = `[Agent][${tag}]`;
  const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  console.log(`${prefix} ${msg}`);
  setLog(`${prefix} ${msg}`);
}

// ─── DB 代理 ──────────────────────────────────────────────────────────────
const db = new Proxy({}, { get: (_, prop) => getDB().db[prop] });

// ─── 数据目录根（FilesystemBackend rootDir） ──────────────────────────────
function getDataDir() {
  return DataPathManager.getInstance().getDataDir() || require("electron").app.getPath("userData");
}

// ─── DB 工具函数 ───────────────────────────────────────────────────────────

function listSessions() {
  return db
    .prepare(
      `SELECT s.sessionId, s.name, s.createdAt, s.updatedAt, s.workDir, s.permissionLevel,
              (SELECT content FROM deep_messages WHERE sessionId = s.sessionId
               ORDER BY id DESC LIMIT 1) AS lastMessage
       FROM deep_sessions s ORDER BY s.updatedAt DESC`
    )
    .all();
}

// 获取（必要时懒创建）某个会话的命令执行工作目录：用户没手动选过时，
// 默认落到 dataDir/workspaces/<sessionId>/ 并写回 DB，保证任何会话第一次用 execute 时都有确定的目录
async function getSessionWorkDir(sessionId) {
  if (!sessionId) {
    const fallback = path.join(getDataDir(), "workspaces", "_no_session");
    fs.ensureDirSync(fallback);
    return fallback;
  }
  const row = db.prepare(`SELECT workDir FROM deep_sessions WHERE sessionId = ?`).get(sessionId);
  if (row?.workDir && fs.existsSync(row.workDir)) return row.workDir;

  const defaultDir = path.join(getDataDir(), "workspaces", sessionId);
  fs.ensureDirSync(defaultDir);
  db.prepare(`UPDATE deep_sessions SET workDir = ? WHERE sessionId = ?`).run(defaultDir, sessionId);
  return defaultDir;
}

// 人工在前端指定工作目录：校验目录真实存在后写入 DB
function setSessionWorkDir(sessionId, dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error("目录不存在或不是一个文件夹");
  }
  db.prepare(`UPDATE deep_sessions SET workDir = ? WHERE sessionId = ?`).run(dir, sessionId);
}

// 会话的命令执行审批级别：'auto'（1级，工作目录内 run_command 自动同意）/ 'confirm'（2级，默认，逐次弹窗确认）
function getSessionPermissionLevel(sessionId) {
  if (!sessionId) return "confirm";
  const row = db.prepare(`SELECT permissionLevel FROM deep_sessions WHERE sessionId = ?`).get(sessionId);
  return row?.permissionLevel === "auto" ? "auto" : "confirm";
}

function setSessionPermissionLevel(sessionId, level) {
  const normalized = level === "auto" ? "auto" : "confirm";
  db.prepare(`UPDATE deep_sessions SET permissionLevel = ? WHERE sessionId = ?`).run(normalized, sessionId);
}

function createSessionInDb(name) {
  const sessionId = getUUid();
  const now = formatDate(new Date().getTime());
  db.prepare(
    `INSERT INTO deep_sessions (sessionId, name, createdAt, updatedAt) VALUES (?,?,?,?)`
  ).run(sessionId, name || `会话 ${now}`, now, now);
  return sessionId;
}

function deleteSessionInDb(sessionId) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM deep_messages WHERE sessionId = ?`).run(sessionId);
    db.prepare(`DELETE FROM deep_task_traces WHERE sessionId = ?`).run(sessionId);
    db.prepare(`DELETE FROM deep_sessions WHERE sessionId = ?`).run(sessionId);
  });
  tx();
}

function getSessionMessages(sessionId, limit = 60) {
  return db
    .prepare(
      `SELECT role, content, files, createdAt FROM deep_messages
       WHERE sessionId = ? ORDER BY id ASC LIMIT ?`
    )
    .all(sessionId, limit);
}

// ─── 长上下文管理：压缩摘要 + 跨会话记忆（与 chatServer 的 buildChatMemoryState 一套逻辑，适配 deep_messages/deep_sessions）───
const DEEP_MEMORY_RECENT_LIMIT = 15;
const DEEP_MEMORY_SUMMARY_TARGET = 1600;
const DEEP_MEMORY_USER_ID = 1; // 单用户本地应用，和 chatServer 共用同一份 userId=1 的长期记忆
const DEFAULT_DEEP_CONTEXT_WINDOW = 32000;

// 同 chatServer 的 getChatMemoryTokenBudget：第三方模型没有官方 profile 可自动识别窗口大小，
// 用用户在"超级员工模型配置"里配的 contextWindow（没配就用保守默认值）
function getDeepMemoryTokenBudget() {
  const agentConfig = ConfigManager.getInstance().getConfig()?.agent || {};
  const contextWindow = Number(agentConfig.contextWindow) || DEFAULT_DEEP_CONTEXT_WINDOW;
  return Math.floor(contextWindow * 0.35);
}

// 单次任务内的兜底：超级员工自主模式最多续跑25轮，一轮内工具调用结果（网页内容/命令输出/文件读取等）
// 很容易越堆越大。真正打到模型上下文上限之前，自动清掉较早的工具输出，只保留最近几条。
// 显式 token 数触发（不用 fraction）：fraction 依赖 model.profile 自动识别窗口大小，deepseek/qwen 等第三方模型
// 在 @langchain/openai 内置的 profile 表里查不到，fraction 永远不会触发。
function getDeepContextEditMiddleware() {
  const agentConfig = ConfigManager.getInstance().getConfig()?.agent || {};
  const contextWindow = Number(agentConfig.contextWindow) || DEFAULT_DEEP_CONTEXT_WINDOW;
  return contextEditingMiddleware({
    edits: [
      new ClearToolUsesEdit({
        trigger: { tokens: Math.floor(contextWindow * 0.8) },
        keep: { messages: 3 },
      }),
    ],
  });
}

// 诊断：上一版把诊断补丁打在 ModelFactory 缓存出来的 model.invoke 上，结果没抓到——说明"expected AIMessage or
// Command, got object" 报错时，model.invoke() 本身返回的就是合法消息，问题出在 langchain agent 内部对 wrapModelCall
// 返回值做 Command 归一化的那一层（AgentNode.js 里 handlerWithValidation）。改成直接在 middleware 链路里做诊断：
// 挂在 contextEditingMiddleware 更内层（更靠近 baseHandler），这样它的 handler(request) 拿到的就是 baseHandler
// 经过归一化之后、马上要喂给 contextEditingMiddleware 校验的那个值本身，能精确复现校验失败的现场。
function getRawResponseDiagMiddleware() {
  return createMiddleware({
    name: "RawResponseDiag",
    wrapModelCall: async (request, handler) => {
      try {
        const result = await handler(request);
        // 上一版用 "有没有 _getType 方法" 判断是否合法，太松——真正的校验（AIMessage.isInstance）
        // 还要求 type === "ai"，之前那次没打出日志，大概率就是返回了 type 不是 "ai" 的消息对象，
        // 这版不做"合法性判断"了，无条件把类型信息记下来，下次直接看日志就知道具体是什么类型。
        let preview;
        try {
          preview = JSON.stringify(result, (_k, v) => (typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "...(截断)" : v));
        } catch (stringifyErr) {
          preview = `[无法序列化: ${stringifyErr.message}]`;
        }
        agentLog("模型响应类型", `constructor=${result?.constructor?.name}, type=${result?.type}, _getType=${typeof result?._getType === "function" ? result._getType() : "(无此方法)"}, 内容=${preview}`);
        return result;
      } catch (err) {
        agentLog("模型调用异常", `${err?.message || err}${err?.stack ? "\n" + err.stack : ""}`);
        throw err;
      }
    },
  });
}

function getDeepSessionRaw(sessionId) {
  if (!sessionId) return null;
  return db.prepare(`SELECT * FROM deep_sessions WHERE sessionId = ?`).get(sessionId);
}

function getLastUserMessage(sessionId) {
  const row = db
    .prepare(`SELECT content FROM deep_messages WHERE sessionId = ? AND role = 'user' ORDER BY id DESC LIMIT 1`)
    .get(sessionId);
  return row?.content || "";
}

// 取最近 N 条：DESC 取最新的再 reverse 恢复时间正序——旧版 getSessionMessages(ASC+LIMIT) 取的其实是最早的 N 条，会话变长后上下文永远停在开头
function listRecentDeepMessages(sessionId, limit = DEEP_MEMORY_RECENT_LIMIT) {
  return db
    .prepare(`SELECT id, content, role, createdAt FROM deep_messages WHERE sessionId = ? ORDER BY id DESC LIMIT ?`)
    .all(sessionId, limit)
    .reverse();
}

function listAllDeepMessages(sessionId, limit = 500) {
  return db
    .prepare(`SELECT id, content, role, createdAt FROM deep_messages WHERE sessionId = ? ORDER BY id ASC LIMIT ?`)
    .all(sessionId, limit);
}

function deleteDeepMessagesByIds(ids = []) {
  if (!ids.length) return;
  const deleteMany = db.transaction((rows) => {
    const stmt = db.prepare(`DELETE FROM deep_messages WHERE id = ?`);
    rows.forEach((id) => stmt.run(id));
  });
  deleteMany(ids);
}

function formatDeepMemoryMessages(messages = []) {
  return messages
    .map((item) => `${item.role === "assistant" ? "助手" : "用户"}：${String(item.content || "").trim()}`)
    .filter(Boolean)
    .join("\n");
}

function buildDeepMemoryText(compressedMemory = "", recentMessages = []) {
  const parts = [];
  if (String(compressedMemory || "").trim()) {
    parts.push(`压缩历史记忆：\n${String(compressedMemory).trim()}`);
  }
  const recentText = formatDeepMemoryMessages(recentMessages);
  if (recentText) {
    parts.push(`近期对话记忆：\n${recentText}`);
  }
  return parts.join("\n\n").trim();
}

async function summarizeDeepMemory(existingSummary = "", messages = [], targetChars = DEEP_MEMORY_SUMMARY_TARGET) {
  const historyText = formatDeepMemoryMessages(messages);
  if (!String(existingSummary || "").trim() && !historyText) return "";

  const prompt = `请把以下 AI 超级员工对话压缩成长期记忆，用于后续继续对话时保持上下文。
要求：1. 保留用户长期偏好、明确事实、正在处理的事项、约定、重要结论和不能遗忘的要求。2. 保留曾经尝试但失败的具体方法/网址/操作及失败原因（哪怕简短一句），避免后续重复踩坑；只删除寒暄、重复内容和确实不影响后续任务的过程细节。3. 不要编造没有出现过的信息。4. 输出中文，控制在 ${targetChars} 字以内。
已有压缩记忆：${existingSummary || "无"}

需要合并的较早对话：
${historyText || "无"}`;

  try {
    const model = ModelFactory.getChatModel({ isNew: true });
    const result = await model.invoke([{ role: "user", content: prompt }]);
    return String(result?.content || result || "").trim().slice(0, targetChars * 2);
  } catch (err) {
    agentLog("记忆压缩失败，本轮跳过，原始消息保留待下次重试", err.message);
    return null; // null 代表压缩失败，调用方不能据此删除原始消息
  }
}

async function compactDeepMemory(sessionId) {
  const session = getDeepSessionRaw(sessionId);
  if (!session) return;

  let compressedMemory = String(session.compressedMemory || "").trim();
  let messages = listAllDeepMessages(sessionId, 500);

  if (messages.length > DEEP_MEMORY_RECENT_LIMIT) {
    const older = messages.slice(0, messages.length - DEEP_MEMORY_RECENT_LIMIT);
    const summarized = await summarizeDeepMemory(compressedMemory, older);
    if (summarized === null) return; // 压缩失败：不删原始消息，本轮不落盘，等下一轮再重试
    compressedMemory = summarized;
    deleteDeepMessagesByIds(older.map((item) => item.id));
    messages = messages.slice(messages.length - DEEP_MEMORY_RECENT_LIMIT);
  }

  const tokenBudget = getDeepMemoryTokenBudget();
  while (messages.length && estimateTokens(buildDeepMemoryText(compressedMemory, messages)) > tokenBudget) {
    const batchSize = Math.min(2, messages.length);
    const batch = messages.slice(0, batchSize);
    const summarized = await summarizeDeepMemory(compressedMemory, batch);
    if (summarized === null) break; // 压缩失败：停止本轮循环，剩余消息保留原样，已成功的部分照常落盘
    compressedMemory = summarized;
    deleteDeepMessagesByIds(batch.map((item) => item.id));
    messages = messages.slice(batchSize);
  }

  if (!messages.length && estimateTokens(compressedMemory) > tokenBudget) {
    const summarized = await summarizeDeepMemory("", [{ role: "assistant", content: compressedMemory }], DEEP_MEMORY_SUMMARY_TARGET);
    if (summarized !== null) compressedMemory = summarized;
  }

  db.prepare(`UPDATE deep_sessions SET compressedMemory = ?, updatedAt = ? WHERE sessionId = ?`)
    .run(compressedMemory, formatDate(new Date().getTime()), sessionId);
}

async function buildDeepMemoryState(sessionId) {
  const session = getDeepSessionRaw(sessionId);
  if (!session) return { compressedMemory: "", recentMessages: [] };

  let recentMessages = listRecentDeepMessages(sessionId, DEEP_MEMORY_RECENT_LIMIT);
  let compressedMemory = String(session.compressedMemory || "").trim();

  if (estimateTokens(buildDeepMemoryText(compressedMemory, recentMessages)) > getDeepMemoryTokenBudget()) {
    await compactDeepMemory(sessionId);
    const latest = getDeepSessionRaw(sessionId);
    compressedMemory = String(latest?.compressedMemory || "").trim();
    recentMessages = listRecentDeepMessages(sessionId, DEEP_MEMORY_RECENT_LIMIT);
  }

  return { compressedMemory, recentMessages };
}

function saveMessages(sessionId, userContent, aiContent) {
  const now = formatDate(new Date().getTime());
  const insertMsg = db.prepare(
    `INSERT INTO deep_messages (sessionId, role, content, createdAt) VALUES (?,?,?,?)`
  );
  const updateSession = db.prepare(
    `UPDATE deep_sessions SET updatedAt = ? WHERE sessionId = ?`
  );
  const tx = db.transaction(() => {
    insertMsg.run(sessionId, "user", userContent, now);
    insertMsg.run(sessionId, "assistant", aiContent, now);
    updateSession.run(now, sessionId);
  });
  tx();
}

function saveUserMessage(sessionId, content, files = "") {
  const now = formatDate(new Date().getTime());
  db.prepare(`INSERT INTO deep_messages (sessionId, role, content, files, createdAt) VALUES (?,?,?,?,?)`).run(sessionId, "user", content, files, now);
  db.prepare(`UPDATE deep_sessions SET updatedAt = ? WHERE sessionId = ?`).run(now, sessionId);
}

function saveAssistantMessage(sessionId, content) {
  const now = formatDate(new Date().getTime());
  const result = db
    .prepare(`INSERT INTO deep_messages (sessionId, role, content, createdAt) VALUES (?,?,?,?)`)
    .run(sessionId, "assistant", content, now);
  db.prepare(`UPDATE deep_sessions SET updatedAt = ? WHERE sessionId = ?`).run(now, sessionId);

  // 压缩摘要 + 跨会话记忆抽取都异步进行，不阻塞调用方（流式响应的多个收尾分支都会走到这里）
  compactDeepMemory(sessionId).catch((e) => agentLog("记忆压缩失败", e.message));
  processMemoryExtraction({
    userId: DEEP_MEMORY_USER_ID,
    sessionId,
    sourceMessageId: result?.lastInsertRowid,
    question: getLastUserMessage(sessionId),
    answer: content,
  }).catch((e) => agentLog("记忆抽取触发失败", e.message));
}

// ─── 任务轨迹临时记录（不展示，仅用于完成后复盘沉淀 Skill）───────────────
const TASK_TRACE_RETENTION_DAYS = 5;
const TASK_TRACE_PREVIEW_LIMIT = 2000;
const threadRunIds = new Map();      // thread_id -> runId，供审批 resume 找回同一次任务轨迹
const consumedTraceRunIds = new Set(); // 已沉淀为 Skill / 已使用 Skill 的 run，不再继续写临时轨迹
const reflectedTraceRunIds = new Set(); // 已经做过完成后 Skill 复盘的 run，避免 resume 后重复触发
const executedCommandResults = new Map(); // runId -> Map(signature -> { command, result })

function traceNowText(ts = Date.now()) {
  return formatDate(ts);
}

function traceExpireText() {
  return formatDate(Date.now() + TASK_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function previewText(value, limit = TASK_TRACE_PREVIEW_LIMIT) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!raw) return "";
  return raw.length > limit ? raw.slice(0, limit) + `\n...(已截断，原长度 ${raw.length})` : raw;
}

function sanitizeTraceValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return previewText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return previewText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map(v => sanitizeTraceValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value).slice(0, 40)) {
      out[key] = sanitizeTraceValue(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

function payloadJson(payload) {
  if (payload == null) return null;
  try { return JSON.stringify(sanitizeTraceValue(payload)); }
  catch { return JSON.stringify({ preview: previewText(payload) }); }
}

function cleanupExpiredTaskTraces() {
  try {
    const now = traceNowText();
    const info = db.prepare(`DELETE FROM deep_task_traces WHERE expireAt < ?`).run(now);
    if (info?.changes) agentLog("任务轨迹清理", `已清理过期记录 ${info.changes} 条`);
  } catch (e) {
    agentLog("任务轨迹清理失败", e.message);
  }
}

function nextTraceSeq(runId) {
  try {
    const row = db.prepare(`SELECT COALESCE(MAX(eventSeq), 0) + 1 AS seq FROM deep_task_traces WHERE runId = ?`).get(runId);
    return row?.seq || 1;
  } catch { return 1; }
}

function writeTaskTrace({
  runId,
  sessionId,
  threadId,
  eventSeq,
  round = 1,
  eventType,
  toolName = null,
  toolAction = null,
  title = null,
  content = null,
  payload = null,
  skillName = null,
  skillAction = null,
  status = "active",
}) {
  if (!runId || consumedTraceRunIds.has(runId)) return;
  try {
    db.prepare(`
      INSERT INTO deep_task_traces
        (runId, sessionId, threadId, eventSeq, round, eventType, toolName, toolAction, title, content, payloadJson, skillName, skillAction, status, createdAt, expireAt)
      VALUES
        (@runId, @sessionId, @threadId, @eventSeq, @round, @eventType, @toolName, @toolAction, @title, @content, @payloadJson, @skillName, @skillAction, @status, @createdAt, @expireAt)
    `).run({
      runId,
      sessionId: sessionId || null,
      threadId: threadId || null,
      eventSeq: eventSeq || nextTraceSeq(runId),
      round,
      eventType,
      toolName,
      toolAction,
      title,
      content: content == null ? null : previewText(content),
      payloadJson: payloadJson(payload),
      skillName,
      skillAction,
      status,
      createdAt: traceNowText(),
      expireAt: traceExpireText(),
    });
  } catch (e) {
    agentLog("任务轨迹写入失败", `${eventType}: ${e.message}`);
  }
}

function createTraceWriter({ runId, sessionId, threadId }) {
  let eventSeq = 0;
  return (event) => writeTaskTrace({
    ...event,
    runId,
    sessionId,
    threadId,
    eventSeq: ++eventSeq,
  });
}

function consumeTaskTrace(runId, reason = "consumed") {
  if (!runId) return;
  consumedTraceRunIds.add(runId);
  reflectedTraceRunIds.delete(runId);
  executedCommandResults.delete(runId);
  clearBrowserFailureTracker(runId);
  clearOpenUrlAttemptTracker(runId);
  try {
    const info = db.prepare(`DELETE FROM deep_task_traces WHERE runId = ?`).run(runId);
    agentLog("任务轨迹清理", `run=${runId}, reason=${reason}, deleted=${info?.changes || 0}`);
  } catch (e) {
    agentLog("任务轨迹清理失败", `${runId}: ${e.message}`);
  }
}

function getRunIdByThread(threadId) {
  if (!threadId) return "";
  if (threadRunIds.has(threadId)) return threadRunIds.get(threadId);
  try {
    const row = db.prepare(`
      SELECT runId FROM deep_task_traces
      WHERE threadId = ?
      ORDER BY id DESC LIMIT 1
    `).get(threadId);
    if (row?.runId) threadRunIds.set(threadId, row.runId);
    return row?.runId || "";
  } catch { return ""; }
}

function buildTaskTraceSummary(runId) {
  if (!runId || consumedTraceRunIds.has(runId)) return "（无可用轨迹）";
  try {
    const rows = db.prepare(`
      SELECT eventSeq, round, eventType, toolName, toolAction, title, content, payloadJson, skillName, skillAction
      FROM deep_task_traces
      WHERE runId = ?
      ORDER BY eventSeq ASC
      LIMIT 120
    `).all(runId);
    if (!rows.length) return "（无可用轨迹）";
    return rows.map((r) => {
      const parts = [`${r.eventSeq}. [第${r.round || 1}轮/${r.eventType}]`];
      if (r.toolName) parts.push(`tool=${r.toolName}${r.toolAction ? `:${r.toolAction}` : ""}`);
      if (r.skillName) parts.push(`skill=${r.skillName}${r.skillAction ? `:${r.skillAction}` : ""}`);
      if (r.title) parts.push(r.title);
      if (r.content) parts.push(previewText(r.content, 600));
      if (r.payloadJson) parts.push(previewText(r.payloadJson, 600));
      return parts.join(" | ");
    }).join("\n");
  } catch (e) {
    return `（读取轨迹失败：${e.message}）`;
  }
}

function buildSkillPersistPrompt(traceSummary) {
  return "用户已经明确确认：希望把本次任务沉淀为可复用 Skill。请基于下面的执行轨迹摘要生成或更新 Skill。\n\n规则：\n1. 如果本次任务读取/使用过某个已有 Skill，并且本次经验适合并入它，请调用 update_skill。\n2. 如果这是现有 Skill 没覆盖的新流程，请调用 create_skill。\n3. 不要只回答“无需创建或更新 Skill”；用户已经选择进入沉淀流程。除非轨迹信息确实不足以形成可复用 Skill，才简要说明无法沉淀。\n4. Skill 内容要写成可复用流程，不要记录一次性的时间、绝对临时路径、偶发输出。\n5. SKILL.md 正文只保留导航性摘要和调用方法；如果轨迹里有可复用的命令片段/脚本、篇幅较长的参考资料（如 API 文档摘录）、或模板类内容，用 create_skill/update_skill 的 files 参数分别拆成 scripts/、references/、assets/ 子目录下的文件，并在 SKILL.md 正文里用相对路径引用它们，不要都堆进 SKILL.md 一个文件。\n\n【本次任务执行轨迹摘要】\n" + traceSummary;
}

function shouldAskSkillReflection(runId) {
  return !!runId && !consumedTraceRunIds.has(runId) && !reflectedTraceRunIds.has(runId);
}

function hasSkillReviewMaterial(runId) {
  if (!runId || consumedTraceRunIds.has(runId)) return false;
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM deep_task_traces
      WHERE runId = ?
        AND (
          eventType IN ('skill_read', 'todos_update')
          OR (eventType IN ('tool_start', 'tool_done') AND COALESCE(toolName, '') NOT IN ('searchLocalKB', 'write_todos'))
        )
    `).get(runId);
    return (row?.count || 0) > 0;
  } catch {
    return false;
  }
}

function shouldOfferSkillReview(runId) {
  return shouldAskSkillReflection(runId) && hasSkillReviewMaterial(runId);
}

function markSkillReflectionAsked(runId) {
  if (runId) reflectedTraceRunIds.add(runId);
}

function normalizeExecuteCommand(command) {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function executeSignature(command) {
  const normalized = normalizeExecuteCommand(command);
  return normalized ? `run_command:${normalized}` : "";
}

function getExecuteCommand(args = {}) {
  return typeof args.command === "string" ? args.command : "";
}

function getExecutedCommandRecord(runId, command) {
  const signature = executeSignature(command);
  if (!runId || !signature) return null;

  const cached = executedCommandResults.get(runId)?.get(signature);
  if (cached) return cached;

  try {
    const rows = db.prepare(`
      SELECT content, payloadJson FROM deep_task_traces
      WHERE runId = ? AND eventType = 'tool_done' AND toolName = 'run_command'
      ORDER BY id DESC
      LIMIT 50
    `).all(runId);
    for (const row of rows) {
      let payload = null;
      try { payload = row.payloadJson ? JSON.parse(row.payloadJson) : null; } catch {}
      const savedCommand = payload?.args?.command;
      if (executeSignature(savedCommand) === signature) {
        return { command: savedCommand, result: row.content || payload?.resultPreview || "" };
      }
    }
  } catch {}
  return null;
}

function recordExecutedToolResult(runId, toolName, args, result) {
  if (toolName !== "run_command") return;
  const command = getExecuteCommand(args);
  const signature = executeSignature(command);
  if (!runId || !signature) return;
  if (!executedCommandResults.has(runId)) executedCommandResults.set(runId, new Map());
  executedCommandResults.get(runId).set(signature, { command, result: previewText(result, 2000) });
}

function duplicateExecuteDecisions(runId, interruptData) {
  const requests = interruptData?.value?.actionRequests || [];
  if (!requests.length) return null;

  const decisions = [];
  for (const req of requests) {
    if (req?.name !== "run_command") return null;
    const command = getExecuteCommand(req.args);
    const record = getExecutedCommandRecord(runId, command);
    if (!record) return null;
    decisions.push({
      type: "reject",
      message: `该命令本轮任务已经执行过，不能重复执行：${command}\n\n上次执行结果：\n${previewText(record.result, 1500)}\n\n请直接基于上次结果继续完成任务，不要再次调用相同命令。`,
    });
  }
  return decisions;
}

// 1级权限（自动同意）下，把本次中断请求全部批准；仅对 run_command 生效——
// create_skill/update_skill 固定需要人工审批，不受这个开关影响
function autoApproveDecisions(interruptData) {
  const requests = interruptData?.value?.actionRequests || [];
  if (!requests.length) return null;
  if (!requests.every((r) => r?.name === "run_command")) return null;
  return requests.map(() => ({ type: "approve" }));
}

// 清理 MemorySaver 中已完成 thread 的 checkpoint，防止内存泄漏
function cleanupThread(threadId) {
  try {
    delete checkpointer.storage[threadId];
    for (const key of Object.keys(checkpointer.writes || {})) {
      try { if (JSON.parse(key)[0] === threadId) delete checkpointer.writes[key]; } catch {}
    }
  } catch {}
}

// ─── Skills 工具函数 ───────────────────────────────────────────────────────
// parseSkillMd / resolveSkillMdPath / writeSkillMd / updateSkillContent 现在统一在
// ../../model/agentTools 中实现，供本文件的 REST 路由与 Agent 自建 skill 工具共用。

// ─── 内置 Skills 种子 ──────────────────────────────────────────────────────

function isNewerVersion(newVer, oldVer) {
  const parse = v => String(v || "0.0.0").split(".").map(Number);
  const [na, nb, nc] = parse(newVer);
  const [oa, ob, oc] = parse(oldVer);
  return na !== oa ? na > oa : nb !== ob ? nb > ob : nc > oc;
}

function getBuiltinSkillsSourceDir() {
  const { app } = require("electron");
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "builtin-skills");
  }
  // 开发模式：__dirname = out/main，resources 在项目根目录
  return path.join(__dirname, "../../resources/builtin-skills");
}

function seedBuiltinSkills() {
  const sourceDir = getBuiltinSkillsSourceDir();
  if (!fs.existsSync(sourceDir)) {
    agentLog("内置Skills", `资源目录不存在，跳过 (${sourceDir})`);
    return;
  }

  const skillsDir = getSystemPath("skills");
  fs.ensureDirSync(skillsDir);

  // 版本记录文件，存在 skills 目录下
  const versionsFile = path.join(skillsDir, "_builtin_versions.json");
  let deployedVersions = {};
  try {
    if (fs.existsSync(versionsFile)) {
      deployedVersions = JSON.parse(fs.readFileSync(versionsFile, "utf-8"));
    }
  } catch {}

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).filter(e => e.isDirectory());
  let changed = false;

  for (const entry of entries) {
    const name = entry.name;
    const srcMd = path.join(sourceDir, name, "SKILL.md");
    if (!fs.existsSync(srcMd)) continue;

    const { version } = parseSkillMd(fs.readFileSync(srcMd, "utf-8"));
    const ver = version || "1.0.0";
    const deployed = deployedVersions[name];

    const destDir = path.join(skillsDir, name);
    const destMd  = path.join(destDir, "SKILL.md");
    const isNew   = !fs.existsSync(destMd);

    if (isNew) {
      fs.ensureDirSync(destDir);
      fs.copyFileSync(srcMd, destMd);
      deployedVersions[name] = ver;
      agentLog("内置Skills", `新建: ${name} v${ver}`);
      changed = true;
    } else if (deployed && isNewerVersion(ver, deployed)) {
      fs.copyFileSync(srcMd, destMd);
      deployedVersions[name] = ver;
      agentLog("内置Skills", `更新: ${name} v${deployed} → v${ver}`);
      changed = true;
    } else {
      agentLog("内置Skills", `跳过: ${name} (v${ver} 无变化)`);
    }
  }

  if (changed) {
    fs.writeFileSync(versionsFile, JSON.stringify(deployedVersions, null, 2), "utf-8");
  }
}

// 扫描 dataDir/skills/ 目录，返回所有可用 skill 信息
function scanAvailableSkills() {
  const skillsDir = getSystemPath("skills");
  agentLog("Skills扫描", `扫描目录: ${skillsDir}`);
  if (!fs.existsSync(skillsDir)) {
    agentLog("Skills扫描", "skills目录不存在，跳过");
    return [];
  }
  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_builtin_versions.json")
    .map((e) => {
      const skillDir = path.join(skillsDir, e.name);
      const { mdPath, enabled } = resolveSkillMdPath(skillDir);
      // 没有 SKILL.md（如 create_skill 写入中途失败留下的空目录）直接跳过，
      // 不能让它凭目录名伪装成一个"已生成"的 skill 出现在列表里。
      if (!mdPath) {
        agentLog("Skills读取", `${e.name}/SKILL.md 不存在，跳过`);
        return null;
      }
      const parsed = parseSkillMd(fs.readFileSync(mdPath, "utf-8"));
      const displayName = parsed.displayName || e.name;
      agentLog("Skills读取", `${e.name} [${enabled ? "启用" : "禁用"}] → ${displayName}`);

      // 一键导入的 skill 会在目录下留一个 _import.json，记录来源和风险扫描结果，
      // 前端启用时据此弹出安全提示；本地手写/内置 skill 没有这个文件
      let importMeta = null;
      try {
        const importJsonPath = path.join(skillDir, "_import.json");
        if (fs.existsSync(importJsonPath)) importMeta = JSON.parse(fs.readFileSync(importJsonPath, "utf-8"));
      } catch {}

      return {
        name: e.name,
        displayName,
        description: parsed.description,
        version: parsed.version,
        isBuiltin: parsed.isBuiltin,
        author: parsed.author,
        enabled,
        imported: !!importMeta,
        hasScripts: importMeta?.hasScripts || false,
        riskFlags: importMeta?.riskFlags || [],
        riskLevel: importMeta?.riskLevel || "low",
        importSource: importMeta?.source || null,
      };
    })
    .filter(Boolean);
  agentLog("Skills扫描", `共发现 ${skills.length} 个skill`);
  return skills;
}

// 获取所有 skill 状态（enabled 由文件名决定：SKILL.md=启用，SKILL.md.disabled=禁用）
function getSkillsState() {
  const skills = scanAvailableSkills();
  const enabledNames  = skills.filter(s => s.enabled).map(s => s.name);
  const disabledNames = skills.filter(s => !s.enabled).map(s => s.name);
  agentLog("Skills状态", `已启用: [${enabledNames.join(", ") || "无"}]  已禁用: [${disabledNames.join(", ") || "无"}]`);
  return skills;
}

// 检查 skills 目录下是否有任何已启用的 skill
function hasAnyEnabledSkill() {
  const skillsDir = getSystemPath("skills");
  if (!fs.existsSync(skillsDir)) return false;
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .some(e => fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")));
}

// ─── Agent 工厂 ────────────────────────────────────────────────────────────

const checkpointer = new MemorySaver();

async function createAgent() {
  const config = ConfigManager.getInstance().getConfig();
  const agentCfg = config.agent || config.chat;
  const permissions = config.agentPermissions || {};

  // rootDir = dataDir，虚拟路径 /skills/xxx → 真实 dataDir/skills/xxx（文件工具始终覆盖整个 dataDir，不受命令执行开关影响）
  const rootDir = getDataDir();
  const backend = new FilesystemBackend({ rootDir, virtualMode: true });

  // 主 Agent 模型
  const mainModel = ModelFactory.getChatModel({
    customConfig: {
      provider: agentCfg.provider,
      modelName: agentCfg.modelName,
      temperature: agentCfg.temperature,
    },
    tag: "agent-main",
  });

  // 传父目录 /skills/，lib 会自动扫描其中启用的子目录（SKILL.md 存在的）
  const skillsSource = hasAnyEnabledSkill() ? ["/skills/"] : undefined;

  // 主 Agent 自建/自改 Skill 的工具；子 Agent 不持久化，复杂任务使用 deepagents 内置 task 临时委托
  const { create_skill, update_skill } = createAgentManagementTools({
    invalidateAgent,
    onSkillPersisted: ({ runId, skillName, skillAction }) => {
      if (!runId) return;
      writeTaskTrace({
        runId,
        threadId: "",
        eventType: "skill_persisted",
        title: `Skill ${skillAction === "update" ? "已更新" : "已创建"}`,
        skillName,
        skillAction,
        payload: { skillName, skillAction },
      });
      consumeTaskTrace(runId, `skill-${skillAction || "persisted"}`);
    },
  });
  // 命令执行工具：限定在会话工作目录内、禁止切目录/越权路径的弱隔离 run_command（详见 agentTools.js）
  // 注意：工具名不能叫 "execute"——deepagents 的 FilesystemMiddleware 保留了这个名字，
  // 非沙箱 backend 下会把任何叫这个名字的工具（包括我们自己的）从最终请求里过滤掉。
  const { execute } = createExecuteTool({ getSessionWorkDir });
  // 工作目录只读浏览/读取工具：不依赖命令执行开关，只要设置了工作目录就一直可用
  const { list_workdir, read_workdir_file } = createWorkdirReadTools({ getSessionWorkDir });

  agentLog("Agent构建", `主模型: provider=${agentCfg.provider}, model=${agentCfg.modelName}, temperature=${agentCfg.temperature}`);
  agentLog("Agent构建", `Skills源: ${skillsSource ? skillsSource[0] : "（无）"}`);
  agentLog("Agent构建", "子Agent: 使用 deepagents 内置 task 临时委托，不持久化保存");
  agentLog("Agent构建", `命令执行: ${permissions.enableShellExecute ? "已开启（会话目录内、需审批）" : "关闭"}`);

  const finalTools = [
    browser,
    generateWordTool,
    generateImageTool,
    generateVideoFromImageTool,
    composeVideoTool,
    extractLastFrameTool,
    create_skill,
    update_skill,
    list_workdir,
    read_workdir_file,
    ...(permissions.enableShellExecute ? [execute] : []),
  ];

  return await createDeepAgent({
    backend,
    model: mainModel,
    skills: skillsSource,
    interruptOn: {
      read_file: false,
      write_file: false,
      delete_file: false,
      // 命令执行一旦开启，强制人工审批，不受其他开关影响
      ...(permissions.enableShellExecute ? { run_command: true } : {}),
      // 自建/自改 Skill 固定需要审批，不受配置影响
      create_skill: true,
      update_skill: true,
    },
    tools: finalTools,
    checkpointer,
    // 诊断中间件放在数组最后 = 中间件链路里最靠内层（最贴近实际模型调用），
    // 这样它包住的就是 contextEditingMiddleware 校验失败前的那次 handler() 返回值
    middleware: [getDeepContextEditMiddleware(), getRawResponseDiagMiddleware()],
  });
}

let agentInstance = null;
let agentCreating = null;

(async () => {
  seedBuiltinSkills();
  agentCreating = createAgent();
  agentInstance = await agentCreating;
  agentCreating = null;
  console.log("✅ DeepAgent 已初始化");
})();

function invalidateAgent() {
  agentInstance = null;
  agentCreating = null;
  console.log("🔄 Agent 配置已变更，下次请求时重建");
}

async function getAgent() {
  if (agentInstance) return agentInstance;
  if (!agentCreating) {
    agentCreating = createAgent().then(a => {
      agentInstance = a;
      agentCreating = null;
      return a;
    }).catch(err => {
      agentCreating = null;
      throw err;
    });
  }
  return agentCreating;
}

ConfigManager.getInstance().onConfigChange(invalidateAgent);

// ─── SSE 响应头 ────────────────────────────────────────────────────────────

function setupSSE(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // 禁用 socket 超时，防止 LLM 推理期间无数据导致连接被动关闭
  if (req.socket) {
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true, 0);
  }
}

// ─── Session 路由 ──────────────────────────────────────────────────────────

deepChat.get("/sessions", (req, res) => {
  try { res.send(success(listSessions())); }
  catch (e) { res.send(error500(e.message)); }
});

deepChat.post("/sessions", (req, res) => {
  try {
    const sessionId = createSessionInDb(req.body.name);
    res.send(success({ sessionId }));
  } catch (e) { res.send(error500(e.message)); }
});

deepChat.delete("/sessions/:sessionId", (req, res) => {
  try { deleteSessionInDb(req.params.sessionId); res.send(success()); }
  catch (e) { res.send(error500(e.message)); }
});

deepChat.get("/sessions/:sessionId/messages", (req, res) => {
  try { res.send(success(getSessionMessages(req.params.sessionId))); }
  catch (e) { res.send(error500(e.message)); }
});

// 设置会话的命令执行工作目录（run_command 工具的弱隔离边界）
deepChat.put("/sessions/:sessionId/workdir", (req, res) => {
  try {
    setSessionWorkDir(req.params.sessionId, req.body.workDir);
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// 设置会话的命令执行审批级别：auto=1级自动同意，confirm=2级需人工确认（默认）
deepChat.put("/sessions/:sessionId/permission", (req, res) => {
  try {
    setSessionPermissionLevel(req.params.sessionId, req.body.permissionLevel);
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// ─── Skills 路由 ──────────────────────────────────────────────────────────

deepChat.get("/skills", (req, res) => {
  try { res.send(success(getSkillsState())); }
  catch (e) { res.send(error500(e.message)); }
});

deepChat.put("/skills/:name", (req, res) => {
  try {
    const { name } = req.params;
    const { enabled } = req.body;
    const skillDir  = path.join(getSystemPath("skills"), name);
    const activeMd  = path.join(skillDir, "SKILL.md");
    const disabledMd = path.join(skillDir, "SKILL.md.disabled");
    if (enabled) {
      if (fs.existsSync(disabledMd) && !fs.existsSync(activeMd)) fs.renameSync(disabledMd, activeMd);
    } else {
      if (fs.existsSync(activeMd)) fs.renameSync(activeMd, disabledMd);
    }
    invalidateAgent();
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// 外部 Skill 导入 —— 预览：拉取/解压 + 校验 + 风险扫描，不落盘
deepChat.post("/skills/import/preview", async (req, res) => {
  try {
    const { mode, url, zipBase64, fileName, dirPath } = req.body || {};
    let files;
    if (mode === "url") {
      files = await fetchFilesFromUrl(url);
    } else if (mode === "zip") {
      if (!zipBase64) throw new Error("请选择 zip 文件");
      files = extractFilesFromZip(Buffer.from(zipBase64, "base64"));
    } else if (mode === "folder") {
      if (!dirPath) throw new Error("请选择文件夹");
      files = readFilesFromDir(dirPath);
    } else {
      throw new Error("未知的导入方式");
    }
    const preview = buildSkillPreview(files, {
      mode,
      url: mode === "url" ? url : undefined,
      fileName: mode === "zip" ? fileName : undefined,
      dirPath: mode === "folder" ? dirPath : undefined,
    });
    agentLog("Skills导入", `预览 ${mode} → ${preview.suggestedDirName}，风险等级=${preview.riskLevel}`);
    res.send(success(preview));
  } catch (e) { res.send(error500(e.message)); }
});

// 外部 Skill 导入 —— 确认：落盘，默认写为禁用状态（SKILL.md.disabled）
deepChat.post("/skills/import/confirm", (req, res) => {
  try {
    const { dirName, filesBase64, meta } = req.body || {};
    const rec = writeImportedSkill({ dirName, filesBase64, meta });
    invalidateAgent();
    agentLog("Skills导入", `已导入 ${rec.name}（默认禁用）`);
    res.send(success(rec));
  } catch (e) { res.send(error500(e.message)); }
});

// 创建新 Skill（自动生成 SKILL.md 模板）
deepChat.post("/skills", (req, res) => {
  try {
    const { name, displayName, description } = req.body;
    const rec = writeSkillMd({ name, displayName, description });
    invalidateAgent();
    res.send(success(rec));
  } catch (e) { res.send(error500(e.message)); }
});

// 读取 SKILL.md 原文（编辑器回显用，兼容 .disabled 状态）
deepChat.get("/skills/:name/content", (req, res) => {
  try {
    const skillDir = path.join(getSystemPath("skills"), req.params.name);
    const { mdPath } = resolveSkillMdPath(skillDir);
    if (!mdPath) return res.send(error500("SKILL.md 不存在"));
    res.send(success(fs.readFileSync(mdPath, "utf-8")));
  } catch (e) { res.send(error500(e.message)); }
});

// 保存 SKILL.md 内容（写回到当前实际文件名，无论 active/disabled）
deepChat.put("/skills/:name/content", (req, res) => {
  try {
    updateSkillContent(req.params.name, req.body.content);
    invalidateAgent();
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// 删除 Skill（删除整个目录 + 清理 DB 记录）
deepChat.delete("/skills/:name", (req, res) => {
  try {
    const { name } = req.params;
    const skillDir = path.join(getSystemPath("skills"), name);
    if (!fs.existsSync(skillDir)) return res.send(error500("Skill 不存在"));
    const { mdPath } = resolveSkillMdPath(skillDir);
    if (mdPath) {
      const { isBuiltin } = parseSkillMd(fs.readFileSync(mdPath, "utf-8"));
      if (isBuiltin) return res.send(error500("内置 Skill 不可删除"));
    }
    fs.removeSync(skillDir);
    db.prepare(`DELETE FROM deep_skills WHERE name = ?`).run(name);
    invalidateAgent();
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// ─── Agent 配置路由 ────────────────────────────────────────────────────────

deepChat.get("/agent-config", (req, res) => {
  try {
    const config = ConfigManager.getInstance().getConfig();
    res.send(success(config.agent));
  } catch (e) { res.send(error500(e.message)); }
});

deepChat.put("/agent-config", (req, res) => {
  try {
    const { provider, modelName, temperature } = req.body;
    const config = ConfigManager.getInstance().getConfig();
    ConfigManager.getInstance().saveConfig({
      agent: { ...config.agent, provider, modelName, temperature },
    });
    invalidateAgent();
    res.send(success());
  } catch (e) { res.send(error500(e.message)); }
});

// ─── Chat 路由 ────────────────────────────────────────────────────────────

// 自动续跑安全上限：轮次与总时长任一触及即停止，避免自主模式跑飞
const AUTO_MAX_ROUNDS = 25;
const AUTO_MAX_DURATION_MS = 20 * 60 * 1000;

deepChat.post("/chat", async (req, res) => {
  const { q, session_id, uploadedDocs = [], localChecked, autoMode = true } = req.body;
  const permissionsForChat = ConfigManager.getInstance().getConfig().agentPermissions || {};

  // ★ 每次请求使用独立 thread_id，避免浏览器工具结果在 MemorySaver 里无限累积
  const requestThreadId = `req-${session_id || "anon"}-${Date.now()}`;
  cleanupExpiredTaskTraces();
  const runId = getUUid();
  threadRunIds.set(requestThreadId, runId);
  consumedTraceRunIds.delete(runId);
  reflectedTraceRunIds.delete(runId);
  executedCommandResults.delete(runId);
  clearBrowserFailureTracker(runId);
  clearOpenUrlAttemptTracker(runId);
  const trace = createTraceWriter({ runId, sessionId: session_id || null, threadId: requestThreadId });

  // ★ 从 DB 取最近几轮纯文字对话 + 压缩长期摘要作为上下文注入（不含工具调用细节）
  const memoryState = session_id ? await buildDeepMemoryState(session_id) : { compressedMemory: "", recentMessages: [] };
  const recentHistory = memoryState.recentMessages;
  // 跨会话的用户长期记忆（与普通聊天共用同一份 user_memories），失败时静默降级为空数组
  const relevantMemories = session_id ? await retrieveRelevantMemories(DEEP_MEMORY_USER_ID, q, 5) : [];
  const contextMessages = recentHistory.map(m => ({ role: m.role, content: m.content }));
  if (memoryState.compressedMemory) {
    contextMessages.unshift({
      role: "system",
      content: `以下是本会话的压缩长期记忆。它只用于补充上下文；如果和用户本次输入冲突，优先服从用户本次输入。\n\n${memoryState.compressedMemory}`,
    });
  }
  if (relevantMemories.length > 0) {
    contextMessages.unshift({
      role: "system",
      content: `以下是关于用户的长期记忆（跨会话），仅供参考；如果和用户本次输入冲突，优先服从用户本次输入。\n${relevantMemories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
    });
  }

  // ── 日志：对话开始 ──────────────────────────────────────────────────────
  agentLog("对话开始", `session=${session_id || "无"}, thread=${requestThreadId}, autoMode=${!!autoMode}`);
  agentLog("用户输入", q);
  agentLog("历史上下文", `加载 ${recentHistory.length} 条最近消息 + ${memoryState.compressedMemory ? "1" : "0"} 条压缩摘要 + ${relevantMemories.length} 条跨会话记忆`);
  trace({
    eventType: "user_prompt",
    title: "用户任务",
    content: q,
    payload: {
      autoMode: !!autoMode,
      localChecked: !!localChecked,
      uploadedDocs: uploadedDocs.map(d => ({ type: d.type, filePath: d.filePath })),
    },
  });

  setupSSE(req, res);

  // 用户消息立即落库，保证中断/超时场景下问题不丢失
  if (session_id) {
    try {
      saveUserMessage(session_id, q, uploadedDocs.map(d => d.filePath).join(","));
      agentLog("消息保存", `session=${session_id}, 用户输入已写入DB`);
    } catch {}
  }

  // 立即告知前端本次请求的 thread_id（中断时 resume 需要用它）
  res.write(`data: ${JSON.stringify({ type: "thread_assigned", thread_id: requestThreadId })}\n\n`);

  // ── 后端 AbortController：客户端断开时真正中止 LLM 推理 ─────────────────
  const backendAbort = new AbortController();
  let responseDone = false;
  res.on("close", () => {
    if (!responseDone) {
      backendAbort.abort();
      agentLog("连接断开", `thread=${requestThreadId}, 已中止LLM推理`);
    }
  });

  // ── SSE 心跳：每 10s 发一次注释行，防止 LLM 思考期间 socket 被动超时 ──
  const heartbeat = setInterval(() => {
    if (!backendAbort.signal.aborted && !res.writableEnded) {
      try { res.write(": ping\n\n"); if (res.flush) res.flush(); } catch {}
    } else {
      clearInterval(heartbeat);
    }
  }, 10000);

  // 提前收集图片路径（供 catch 块引用，避免作用域问题）
  const imagePaths = uploadedDocs.filter(d => d.type === 'image').map(d => d.filePath);

  // 跨轮次累积的状态（自动续跑时，多轮共用同一份）
  let accumulatedContent = "";
  let thinkingBuffer = "";
  let interrupted = false;
  let currentTodos = null;       // 最新一次 write_todos 后的 todos 数组
  let reflectionAsked = false;   // 复盘续跑只问一次，避免死循环
  const autoStartedAt = Date.now();
  const commandPermissionLevel = getSessionPermissionLevel(session_id); // 1级auto自动同意 / 2级confirm弹窗确认

  try {
    const agent = await getAgent();
    // 把时间拼入用户消息文本，避免额外 system message 与 deepagents 内置 prompt 冲突
    let userText = `[当前时间：${formatDate(new Date().getTime())}] `;

    // 告知模型本次会话的工作目录，并明确区分「工作目录工具」和「read_file/ls/glob 文件工具」——
    // 后者作用于程序数据目录（技能/知识库所在位置），与用户在对话页选定的工作目录无关。
    // list_workdir/read_workdir_file 始终可用（不依赖命令执行开关）；run_command 仅在开关打开时可用。
    {
      const workDir = await getSessionWorkDir(session_id);
      trace({
        eventType: "workdir",
        title: "本次任务工作目录",
        content: workDir,
      });
      userText += `[本会话工作目录：${workDir}。用户提到"当前目录/这个文件夹/工作目录"时，指的是这个目录。查看里面有什么请用 list_workdir，读取里面的文件请用 read_workdir_file；不要用 read_file/ls/glob 这几个文件工具去找，它们访问的是程序自己的数据目录，跟这个工作目录是两回事。` +
        (permissionsForChat.enableShellExecute
          ? `如需在这个目录里执行命令，调用 run_command 工具即可；如果把任务通过 task 委托给子 Agent 执行，子 Agent 会带有和你完全相同的 run_command 工具与审批权限（同一工作目录、同样需要人工审批），可以放心委托。] `
          : `如需在这里执行命令，需要用户先在设置里开启"允许执行系统命令"。] `);
    }

    // 自主模式：自动续跑循环靠 write_todos 的任务清单驱动——如果模型不建清单，
    // 循环就没有"未完成待办"可续，效果等同没开。这里明确引导模型该建清单时就建。
    if (autoMode) {
      userText += `[自主模式已开启：如果这是一个需要多个步骤才能完成的任务，请先调用 write_todos 列出任务清单，然后按清单持续执行直到全部完成，中间不需要每一步都停下来等用户确认；如果只是一两步就能直接回答的简单问题，正常回答即可，不必勉强列清单。同一个子任务如果连续尝试了多种不同方法/来源仍未成功，请及时停下向用户汇报现状，不要无限制地更换新方法。] `;
    }

    userText += q;

    // 上传的非图片附件（文档/PDF）：把提取到的文本内容直接拼进用户消息，
    // 否则模型只在 trace 元数据里看到文件路径，完全不知道内容，无法回答"看一下这个文件"之类的问题。
    const nonImageDocs = uploadedDocs.filter(d => d.type === 'text' || d.type === 'pdf');
    if (nonImageDocs.length > 0) {
      const docBlocks = [];
      for (let i = 0; i < nonImageDocs.length; i++) {
        const d = nonImageDocs[i];
        try {
          const docObj = new doc({ docPath: d.filePath, chunkSize: 2000, chunkOverlap: 50 });
          const texts = await docObj.loader.load();
          const str = texts.map(t => t.pageContent).join("");
          docBlocks.push(`附件${i + 1}（${d.filePath}）：\n${str}`);
        } catch (e) {
          setLog(`附件解析失败: ${d.filePath} - ${e.message}`);
          docBlocks.push(`附件${i + 1}（${d.filePath}）解析失败，无法读取其内容。`);
        }
      }
      userText += `\n\n附件内容如下\n\n${docBlocks.join("\n\n")}`;
      agentLog("附件", `解析 ${nonImageDocs.length} 个附件并拼入用户消息`);
    }

    // 知识库检索：勾选时先搜索本地知识库，把结果拼入用户消息
    if (localChecked) {
      try {
        agentLog("知识库", "开始检索本地知识库...");
        trace({ eventType: "tool_start", round: 1, toolName: "searchLocalKB", title: "检索本地知识库", payload: { query: q } });
        res.write(`data: ${JSON.stringify({ type: "tool_start", toolName: "searchLocalKB", displayName: "本地知识库" })}\n\n`);
        const kbResult = await searchLocalKB.invoke({ query: q });
        res.write(`data: ${JSON.stringify({ type: "tool_done", toolName: "searchLocalKB" })}\n\n`);
        if (kbResult && kbResult.trim()) {
          // searchLocalKB 现返回结构化 JSON，解析后重建为易读文本拼入 prompt；非 JSON（如未找到内容）按原文处理
          let kbText = kbResult;
          try {
            const parsed = JSON.parse(kbResult);
            if (parsed?.results?.length) {
              kbText = parsed.results
                .map((r) => `【知识 ${r.index}】${r.source ? `（来源：${r.source}）` : ""}\n${r.content}`)
                .join("\n\n");
            }
          } catch (e) { /* 非 JSON，按原文处理 */ }
          userText += `\n\n【本地知识库检索结果】\n${kbText}`;
          trace({ eventType: "tool_done", round: 1, toolName: "searchLocalKB", title: "本地知识库检索结果", content: kbText, payload: { hasResult: true } });
          agentLog("知识库", `检索完成，结果长度=${kbText.length}`);
        } else {
          trace({ eventType: "tool_done", round: 1, toolName: "searchLocalKB", title: "本地知识库无结果", payload: { hasResult: false } });
          agentLog("知识库", "未检索到相关内容");
        }
      } catch (kbErr) {
        trace({ eventType: "error", round: 1, toolName: "searchLocalKB", title: "本地知识库检索失败", content: kbErr.message });
        agentLog("知识库", `检索失败: ${kbErr.message}`);
      }
    }

    // 上传的图片本身只会被转成内联 base64 塞进多模态内容，模型看不到任何可引用的路径/地址；
    // 如果后面要拿这张图去调 generate_video_from_image，模型手上没有真实字符串可传，
    // 只能瞎编一个文件名，必然在 resolveLocalMediaPath 里报"素材文件不存在"。这里把真实路径写进文本，
    // 模型才有东西可以原样传给这个工具（resolveLocalMediaPath 本身已支持本地绝对路径，不需要额外处理）。
    if (imagePaths.length > 0) {
      userText += `\n\n[本次上传的图片文件路径：${imagePaths.map((p, i) => `图片${i + 1}：${p}`).join("；")}]（如果需要基于这些图片生成视频，直接把对应路径作为 generate_video_from_image 的 imagePath 参数，不需要先调用 generate_image）`;
    }

    const userContent = buildMultimodalContent(userText, imagePaths);
    if (imagePaths.length > 0) {
      agentLog("多模态", `包含 ${imagePaths.length} 张图片，使用多模态格式发送`);
    }

    // 第一轮发完整上下文+本次输入；自动续跑的后续轮次只追加一条续跑指令（同一 thread，历史已在 checkpointer 里）
    let inputMessages = [...contextMessages, { role: "user", content: userContent }];
    let round = 0;

    // ── 自动续跑循环：autoMode=false 时只会执行一轮，行为与改造前完全一致 ──
    while (true) {
      round++;
      if (autoMode && round > 1) {
        agentLog("自动续跑", `thread=${requestThreadId}, 第 ${round} 轮`);
        trace({ eventType: "auto_round", round, title: `自动续跑第 ${round} 轮` });
        res.write(`data: ${JSON.stringify({ type: "auto_round", round })}\n\n`);
        if (res.flush) res.flush();
      }

      const agentInput = inputMessages instanceof Command ? inputMessages : { messages: inputMessages };
      const stream = await agent.stream(
        agentInput,
        { configurable: { thread_id: requestThreadId, session_id: session_id || null, run_id: runId }, streamMode: ["updates", "messages"], signal: backendAbort.signal }
      );

      // tool_call_id → { name, args } 用于关联工具结果与调用参数（每轮独立，不跨轮累积）
      const pendingToolCalls = new Map();
      let toolCalledThisRound = false;
      let autoResumedDuplicateExecute = false;

      for await (const [mode, chunk] of stream) {
        if (backendAbort.signal.aborted) break;
        let frontendEvent = null;

        if (mode === "messages") {
          const [msg, metadata] = chunk;
          // ★ 用消息类型过滤（不依赖节点名，更兼容 deepagents 内部结构）
          const msgType = msg?._getType?.() || msg?.type;

          // 工具返回结果（ToolMessage）：关联调用参数，识别 skill 读取
          if (msgType === "tool") {
            const raw = typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);
            const preview = raw.length > 200 ? raw.slice(0, 200) + "..." : raw;

            // 查出这次工具结果对应的调用参数
            const callInfo = pendingToolCalls.get(msg.tool_call_id);
            pendingToolCalls.delete(msg.tool_call_id);
            recordExecutedToolResult(runId, callInfo?.name || msg.name, callInfo?.args || {}, raw);

            const calledPath = callInfo?.args?.path || callInfo?.args?.file_path || "";
            // 判断是否是读取 skill 文件
            const skillMatch = calledPath.match(/\/skills\/([^/]+)\//);
            if (skillMatch) {
              const skillName = skillMatch[1];
              const contentPreview = raw.length > 500 ? raw.slice(0, 500) + "..." : raw;
              trace({
                eventType: "skill_read",
                round,
                toolName: msg.name,
                title: `读取 Skill：${skillName}`,
                content: contentPreview,
                payload: { path: calledPath, resultPreview: raw },
                skillName,
                skillAction: "read",
              });
              agentLog("★Skill内容读取", `模型正在参考skill: [${skillName}]`);
              agentLog("★Skill内容读取", `内容:\n${contentPreview}`);
            } else {
              trace({
                eventType: "tool_done",
                round,
                toolName: msg.name,
                title: "工具执行结果",
                content: raw,
                payload: { args: callInfo?.args || {}, resultPreview: raw },
              });
              agentLog("工具结果", `tool=${msg.name}, result=${preview}`);
            }

            res.write(`data: ${JSON.stringify({ type: "tool_done", toolName: msg.name })}\n\n`);
            if (res.flush) res.flush();

            const mediaMd = extractMediaMarkdown(msg.name, raw);
            if (mediaMd) {
              accumulatedContent += mediaMd;
              res.write(`data: ${JSON.stringify({ type: "message_stream", content: mediaMd })}\n\n`);
              if (res.flush) res.flush();
            }
            continue;
          }

          // AI 消息内容流（tool_start 改由 updates 模式触发，args 更完整）

          if (msg?.additional_kwargs?.reasoning_content) {
            thinkingBuffer += msg.additional_kwargs.reasoning_content;
            frontendEvent = { type: "thinking_stream", content: msg.additional_kwargs.reasoning_content };
          } else if (msg?.content) {
            accumulatedContent += msg.content;
            frontendEvent = { type: "message_stream", content: msg.content };
          }
        } else if (mode === "updates") {
          const nodeName = Object.keys(chunk)[0];
          const nodeData = chunk[nodeName];
          if (!nodeName || !nodeData) continue;

          // 中断处理（updates 流里最可靠）
          if (nodeName === "__interrupt__" && nodeData.length > 0) {
            const duplicateDecisions = duplicateExecuteDecisions(runId, nodeData[0]);
            if (duplicateDecisions) {
              autoResumedDuplicateExecute = true;
              inputMessages = new Command({ resume: { decisions: duplicateDecisions } });
              trace({
                eventType: "duplicate_execute_blocked",
                round,
                toolName: "run_command",
                title: "重复命令已自动拦截",
                payload: { decisions: duplicateDecisions, interruptData: nodeData[0] },
              });
              agentLog("重复命令拦截", `thread=${requestThreadId}, 已把上次执行结果返回给模型继续处理`);
              break;
            }
            const autoDecisions = commandPermissionLevel === "auto" ? autoApproveDecisions(nodeData[0]) : null;
            if (autoDecisions) {
              autoResumedDuplicateExecute = true; // 复用同一个"静默续跑"标记
              inputMessages = new Command({ resume: { decisions: autoDecisions } });
              trace({
                eventType: "auto_approved",
                round,
                toolName: "run_command",
                title: "已自动批准执行（1级权限）",
                payload: { decisions: autoDecisions, interruptData: nodeData[0] },
              });
              agentLog("自动批准", `thread=${requestThreadId}, 1级权限自动同意执行命令`);
              res.write(`data: ${JSON.stringify({ type: "tool_start", toolName: "run_command", toolAction: "auto_approved" })}\n\n`);
              if (res.flush) res.flush();
              break;
            }
            interrupted = true;
            trace({
              eventType: "interrupt",
              round,
              title: "需要人工审批",
              payload: { interruptData: nodeData[0] },
            });
            agentLog("中断事件", `thread=${requestThreadId}, 需要人工审批: ${JSON.stringify(nodeData[0]).slice(0, 200)}`);
            frontendEvent = {
              type: "interrupt",
              node: nodeName,
              thread_id: requestThreadId,
              interruptData: nodeData[0],
            };
            res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
            if (res.flush) res.flush();
            break;
          }

          // 捕获最新 todos 状态（write_todos 执行后状态补丁自带，无需解析工具参数）
          if (nodeData.todos) {
            currentTodos = nodeData.todos;
            trace({ eventType: "todos_update", round, title: "任务清单更新", payload: { todos: currentTodos } });
            res.write(`data: ${JSON.stringify({ type: "todos_update", todos: currentTodos })}\n\n`);
            if (res.flush) res.flush();
          }

          // updates 节点完成后，从完整消息中提取工具调用 → tool_start（args 已完整）
          const nodeMessages = Array.isArray(nodeData?.messages) ? nodeData.messages : [];
          for (const nodeMsg of nodeMessages) {
            if (nodeMsg?.tool_calls?.length > 0) {
              toolCalledThisRound = true;
              for (const tc of nodeMsg.tool_calls) {
                const toolName = tc.name || tc.function?.name;
                if (toolName) {
                  // 存入 pending map，供工具结果回来时关联
                  if (tc.id) pendingToolCalls.set(tc.id, { name: toolName, args: tc.args || {} });

                  const toolAction = tc.args?.action ?? null;
                  const calledPath = tc.args?.path || tc.args?.file_path || "";
                  const skillMatch = calledPath.match(/\/skills\/([^/]+)\//);
                  if (skillMatch) {
                    trace({
                      eventType: "tool_start",
                      round,
                      toolName,
                      toolAction,
                      title: `准备读取 Skill：${skillMatch[1]}`,
                      payload: { args: tc.args || {} },
                      skillName: skillMatch[1],
                      skillAction: "read",
                    });
                    agentLog("★Skill调用", `模型决定读取skill: [${skillMatch[1]}]，路径: ${calledPath}`);
                  } else {
                    const argsPreview = JSON.stringify(tc.args || {}).slice(0, 150);
                    trace({
                      eventType: "tool_start",
                      round,
                      toolName,
                      toolAction,
                      title: "工具调用",
                      payload: { args: tc.args || {} },
                    });
                    agentLog("工具调用", `tool=${toolName}, action=${toolAction}, args=${argsPreview}`);
                  }
                  res.write(`data: ${JSON.stringify({ type: "tool_start", toolName, toolAction })}\n\n`);
                  if (res.flush) res.flush();
                }
              }
            }
          }
        }

        if (frontendEvent) {
          res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
          if (res.flush) res.flush();
        }
      }

      if (autoResumedDuplicateExecute) continue;
      if (backendAbort.signal.aborted || interrupted) break;

      if (!autoMode) break; // 非自动模式：与改造前完全一致，只跑一轮

      const withinBudget = round < AUTO_MAX_ROUNDS && (Date.now() - autoStartedAt) < AUTO_MAX_DURATION_MS;
      const hasTodos = Array.isArray(currentTodos) && currentTodos.length > 0;
      const pendingLeft = hasTodos && currentTodos.some(t => t.status !== "completed");
      const allDone = hasTodos && currentTodos.every(t => t.status === "completed");

      if (withinBudget && pendingLeft && toolCalledThisRound) {
        // 还有未完成待办，且这一轮确实发生了动作 → 继续下一轮
        inputMessages = [{ role: "user", content: "继续执行未完成的任务。" }];
        continue;
      }
      if (withinBudget && allDone && !reflectionAsked) {
        // 任务清单全部完成后不再让模型自行判断是否沉淀 Skill；
        // 统一在本轮结束前通知前端，由用户弹窗决定是否进入沉淀流程。
        reflectionAsked = true;
        break;
      }
      break; // 无待办 / 超出轮次或时长上限 / 本轮无动作：结束自动续跑
    }

    // 循环正常结束，立即标记完成，防止 res.end() 后 close 事件误触发 abort
    responseDone = true;

    // ── 日志：思考摘要（如有） ─────────────────────────────────────────────
    if (thinkingBuffer) {
      const preview = thinkingBuffer.length > 300 ? thinkingBuffer.slice(0, 300) + "..." : thinkingBuffer;
      trace({ eventType: "thinking_summary", title: "模型思考摘要", content: preview });
      agentLog("AI思考", preview);
    }

    // ── 日志：输出摘要 ─────────────────────────────────────────────────────
    agentLog("AI输出", `总长度=${accumulatedContent.length}字符, 内容预览: ${accumulatedContent.slice(0, 200)}${accumulatedContent.length > 200 ? "..." : ""}`);

    if (accumulatedContent && session_id) {
      try {
        saveAssistantMessage(session_id, accumulatedContent);
        trace({ eventType: "final_answer", title: "最终回复", content: accumulatedContent });
        agentLog("消息保存", `session=${session_id}, AI回复已写入DB`);
      } catch {}
    }
    if (!interrupted && shouldOfferSkillReview(runId)) {
      markSkillReflectionAsked(runId);
      const traceSummary = buildTaskTraceSummary(runId);
      trace({ eventType: "skill_review_request", title: "等待用户确认是否沉淀 Skill", content: traceSummary });
      res.write(`data: ${JSON.stringify({
        type: "skill_review_request",
        thread_id: requestThreadId,
        summary: previewText(traceSummary, 1200),
      })}\n\n`);
      if (res.flush) res.flush();
    }
    // 中断时不清理 checkpoint，resume 还需要用它恢复状态
    if (!interrupted) {
      executedCommandResults.delete(runId);
      clearBrowserFailureTracker(runId);
      clearOpenUrlAttemptTracker(runId);
      threadRunIds.delete(requestThreadId);
      cleanupThread(requestThreadId);
    }

    clearInterval(heartbeat);
    agentLog("对话完成", `thread=${requestThreadId}`);
    res.write(`data: ${JSON.stringify({ type: "done", thread_id: requestThreadId })}\n\n`);
    res.end();
  } catch (error) {
    clearInterval(heartbeat);
    if (error.name === "AbortError" || backendAbort.signal.aborted) {
      agentLog("对话中止", `thread=${requestThreadId}, 连接已断开`);
      responseDone = true;
      // 中断时也要把已生成的部分内容落库，避免刷新/重进会话后记录丢失
      if (session_id) {
        try {
          saveAssistantMessage(session_id, accumulatedContent || "（已停止生成）");
          agentLog("消息保存", `session=${session_id}, 中断后的AI回复已写入DB`);
        } catch {}
      }
      agentInstance = null; // agent 状态可能不一致，下次请求重建
      res.end();
      return;
    }
    agentLog("对话异常", `thread=${requestThreadId}, error=${error.message}`);
    trace({ eventType: "error", title: "对话异常", content: error.message, status: "error" });
    console.error("Stream error:", error);
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
    res.end();
  }
});

// ─── Skill 沉淀确认后的执行入口 ───────────────────────────────────────────

deepChat.post("/chat/skill-review", async (req, res) => {
  const { thread_id, session_id } = req.body;
  if (!thread_id) return res.status(400).json({ error: "thread_id is required" });
  const runId = getRunIdByThread(thread_id);
  if (!runId) return res.status(400).json({ error: "run_id not found for thread" });

  threadRunIds.set(thread_id, runId);
  markSkillReflectionAsked(runId);
  agentLog("Skill沉淀确认", `thread=${thread_id}, run=${runId}`);

  setupSSE(req, res);

  const backendAbort = new AbortController();
  let responseDone = false;
  res.on("close", () => {
    if (!responseDone) {
      backendAbort.abort();
      agentLog("连接断开", `skill-review thread=${thread_id}, 已中止LLM推理`);
    }
  });

  const heartbeat = setInterval(() => {
    if (!backendAbort.signal.aborted && !res.writableEnded) {
      try { res.write(": ping\n\n"); if (res.flush) res.flush(); } catch {}
    } else {
      clearInterval(heartbeat);
    }
  }, 10000);

  // 提到 try 外面，中断时的 catch 分支也需要访问已累积的内容
  let reviewContent = "";
  let reviewInterrupted = false;

  try {
    const agent = await getAgent();
    const traceSummary = buildTaskTraceSummary(runId);
    writeTaskTrace({
      runId,
      sessionId: session_id || null,
      threadId: thread_id,
      eventType: "reflection_start",
      title: "用户确认后开始沉淀 Skill",
      content: traceSummary,
    });

    const stream = await agent.stream(
      { messages: [{ role: "user", content: buildSkillPersistPrompt(traceSummary) }] },
      { configurable: { thread_id, session_id: session_id || null, run_id: runId }, streamMode: ["updates", "messages"], signal: backendAbort.signal }
    );

    const pendingToolCalls = new Map();

    for await (const [mode, chunk] of stream) {
      if (backendAbort.signal.aborted) break;
      let frontendEvent = null;

      if (mode === "messages") {
        const [msg] = chunk;
        const msgType = msg?._getType?.() || msg?.type;
        if (msgType === "tool") {
          const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          const callInfo = pendingToolCalls.get(msg.tool_call_id);
          pendingToolCalls.delete(msg.tool_call_id);
          writeTaskTrace({
            runId,
            sessionId: session_id || null,
            threadId: thread_id,
            eventType: "tool_done",
            toolName: msg.name,
            title: "Skill沉淀工具执行结果",
            content: raw,
            payload: { args: callInfo?.args || {}, resultPreview: raw },
          });
          res.write(`data: ${JSON.stringify({ type: "tool_done", toolName: msg.name })}\n\n`);
          if (res.flush) res.flush();
          continue;
        }
        if (msg?.additional_kwargs?.reasoning_content) {
          frontendEvent = { type: "thinking_stream", content: msg.additional_kwargs.reasoning_content };
        } else if (msg?.content) {
          reviewContent += msg.content;
          frontendEvent = { type: "message_stream", content: msg.content, is_skill_review: true };
        }
      } else if (mode === "updates") {
        const nodeName = Object.keys(chunk)[0];
        const nodeData = chunk[nodeName];

        if (nodeName === "__interrupt__" && nodeData?.length > 0) {
          reviewInterrupted = true;
          writeTaskTrace({
            runId,
            sessionId: session_id || null,
            threadId: thread_id,
            eventType: "interrupt",
            title: "Skill沉淀需要用户确认",
            payload: { interruptData: nodeData[0] },
          });
          frontendEvent = { type: "interrupt", node: nodeName, thread_id, interruptData: nodeData[0] };
          res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
          break;
        }

        const nodeMessages = Array.isArray(nodeData?.messages) ? nodeData.messages : [];
        for (const nodeMsg of nodeMessages) {
          if (nodeMsg?.tool_calls?.length > 0) {
            for (const tc of nodeMsg.tool_calls) {
              const toolName = tc.name || tc.function?.name;
              if (!toolName) continue;
              if (tc.id) pendingToolCalls.set(tc.id, { name: toolName, args: tc.args || {} });
              const toolAction = tc.args?.action ?? null;
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "tool_start",
                toolName,
                toolAction,
                title: "Skill沉淀工具调用",
                payload: { args: tc.args || {} },
              });
              res.write(`data: ${JSON.stringify({ type: "tool_start", toolName, toolAction })}\n\n`);
              if (res.flush) res.flush();
            }
          }
        }
      }

      if (frontendEvent) {
        res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
        if (res.flush) res.flush();
      }
    }

    responseDone = true;
    clearInterval(heartbeat);
    if (reviewContent && session_id) {
      try {
        saveAssistantMessage(session_id, reviewContent);
        writeTaskTrace({
          runId,
          sessionId: session_id || null,
          threadId: thread_id,
          eventType: "final_answer",
          title: "Skill沉淀回复",
          content: reviewContent,
        });
      } catch {}
    }
    if (!reviewInterrupted) {
      cleanupThread(thread_id);
      threadRunIds.delete(thread_id);
    }
    res.write(`data: ${JSON.stringify({ type: "done", thread_id })}\n\n`);
    res.end();
  } catch (error) {
    clearInterval(heartbeat);
    if (error.name === "AbortError" || backendAbort.signal.aborted) {
      responseDone = true;
      // 中断时也要把已生成的部分内容落库，避免刷新/重进会话后记录丢失
      if (session_id) {
        try {
          saveAssistantMessage(session_id, reviewContent || "（已停止生成）");
        } catch {}
      }
      agentInstance = null;
      res.end();
      return;
    }
    writeTaskTrace({
      runId,
      sessionId: session_id || null,
      threadId: thread_id,
      eventType: "error",
      title: "Skill沉淀异常",
      content: error.message,
      status: "error",
    });
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
    res.end();
  }
});

// ─── Resume 路由 ──────────────────────────────────────────────────────────

deepChat.post("/chat/resume", async (req, res) => {
  const { thread_id, decisions, session_id } = req.body;
  if (!thread_id) return res.status(400).json({ error: "thread_id is required" });
  const runId = getRunIdByThread(thread_id);
  let resumeSkillTouched = false;

  agentLog("审批恢复", `thread=${thread_id}, decisions=${JSON.stringify(decisions || [{ type: "approve" }])}`);

  setupSSE(req, res);

  const backendAbort = new AbortController();
  let responseDone = false;
  res.on("close", () => {
    if (!responseDone) {
      backendAbort.abort();
      agentLog("连接断开", `resume thread=${thread_id}, 已中止LLM推理`);
    }
  });

  const heartbeat = setInterval(() => {
    if (!backendAbort.signal.aborted && !res.writableEnded) {
      try { res.write(": ping\n\n"); if (res.flush) res.flush(); } catch {}
    } else {
      clearInterval(heartbeat);
    }
  }, 10000);

  // 提到 try 外面，中断时的 catch 分支也需要访问已累积的内容
  let resumeContent = "";
  let resumeInterrupted = false;

  try {
    const finalDecisions = decisions || [{ type: "approve" }];
    writeTaskTrace({
      runId,
      sessionId: session_id || null,
      threadId: thread_id,
      eventType: "approval",
      title: "用户审批决定",
      payload: { decisions: finalDecisions },
    });

    // 用户拒绝：直接终止本轮，不再让模型继续尝试其他方式——不调用 agent.stream 恢复图执行，
    // 直接清理这个 thread 的 checkpoint（图停留在中断点，不会有后续动作），响应一条终止提示
    if (finalDecisions.length > 0 && finalDecisions.every((d) => d.type === "reject")) {
      agentLog("审批拒绝", `thread=${thread_id}, 用户拒绝，直接终止本轮`);
      cleanupThread(thread_id);
      executedCommandResults.delete(runId);
      clearBrowserFailureTracker(runId);
      clearOpenUrlAttemptTracker(runId);
      threadRunIds.delete(thread_id);
      const rejectMsg = "已拒绝，本次操作已取消。";
      if (session_id) {
        try {
          saveAssistantMessage(session_id, rejectMsg);
          writeTaskTrace({
            runId,
            sessionId: session_id || null,
            threadId: thread_id,
            eventType: "final_answer",
            title: "审批拒绝",
            content: rejectMsg,
          });
          agentLog("消息保存", `session=${session_id}, 拒绝提示已写入DB`);
        } catch {}
      }
      clearInterval(heartbeat);
      responseDone = true;
      res.write(`data: ${JSON.stringify({ type: "message_stream", content: rejectMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done", thread_id })}\n\n`);
      res.end();
      return;
    }

    const agent = await getAgent();
    const commandPermissionLevel = getSessionPermissionLevel(session_id);
    let resumeInput = new Command({ resume: { decisions: finalDecisions } });
    // ★ 与 /chat 的自动续跑对齐：审批/验证码恢复后，若 todos 还没做完就继续同一 thread，
    // 不需要用户再发新消息（发新消息会分配新 thread_id，丢失本次恢复的执行状态）
    let currentTodos = null;
    let round = 0;
    const autoStartedAt = Date.now();

    while (resumeInput && !backendAbort.signal.aborted) {
      round++;
      let toolCalledThisRound = false;
      if (round > 1) {
        agentLog("审批后自动续跑", `thread=${thread_id}, 第 ${round} 轮`);
        res.write(`data: ${JSON.stringify({ type: "auto_round", round })}\n\n`);
        if (res.flush) res.flush();
      }
      const stream = await agent.stream(resumeInput, {
        configurable: { thread_id, session_id: session_id || null, run_id: runId },
        streamMode: ["updates", "messages"],
        signal: backendAbort.signal,
      });
      resumeInput = null;
      const pendingToolCalls = new Map();

      for await (const [mode, chunk] of stream) {
        if (backendAbort.signal.aborted) break;
        let frontendEvent = null;

        if (mode === "messages") {
          const [msg, metadata] = chunk;
          const msgType = msg?._getType?.() || msg?.type;
          if (msgType === "tool") {
            const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            const callInfo = pendingToolCalls.get(msg.tool_call_id);
            pendingToolCalls.delete(msg.tool_call_id);
            recordExecutedToolResult(runId, callInfo?.name || msg.name, callInfo?.args || {}, raw);
            const calledPath = callInfo?.args?.path || callInfo?.args?.file_path || "";
            const skillMatch = calledPath.match(/\/skills\/([^/]+)\//);
            if (skillMatch) {
              resumeSkillTouched = true;
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "skill_read",
                toolName: msg.name,
                title: `审批后读取 Skill：${skillMatch[1]}`,
                content: raw,
                payload: { path: calledPath, resultPreview: raw },
                skillName: skillMatch[1],
                skillAction: "read",
              });
            } else {
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "tool_done",
                toolName: msg.name,
                title: "审批后工具执行结果",
                content: raw,
                payload: { args: callInfo?.args || {}, resultPreview: raw },
              });
            }
            res.write(`data: ${JSON.stringify({ type: "tool_done", toolName: msg.name })}\n\n`);
            if (res.flush) res.flush();

            const mediaMd = extractMediaMarkdown(msg.name, raw);
            if (mediaMd) {
              resumeContent += mediaMd;
              res.write(`data: ${JSON.stringify({ type: "message_stream", content: mediaMd })}\n\n`);
              if (res.flush) res.flush();
            }
            continue;
          }
          if (msg?.additional_kwargs?.reasoning_content) {
            frontendEvent = { type: "thinking_stream", content: msg.additional_kwargs.reasoning_content };
          } else if (msg?.content) {
            resumeContent += msg.content;
            frontendEvent = { type: "message_stream", content: msg.content, is_resume: true };
          }
        } else if (mode === "updates") {
          const nodeName = Object.keys(chunk)[0];
          const nodeData = chunk[nodeName];
          if (nodeName === "__interrupt__" && nodeData?.length > 0) {
            const duplicateDecisions = duplicateExecuteDecisions(runId, nodeData[0]);
            if (duplicateDecisions) {
              resumeInput = new Command({ resume: { decisions: duplicateDecisions } });
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "duplicate_execute_blocked",
                toolName: "run_command",
                title: "审批后重复命令已自动拦截",
                payload: { decisions: duplicateDecisions, interruptData: nodeData[0] },
              });
              agentLog("重复命令拦截", `resume thread=${thread_id}, 已把上次执行结果返回给模型继续处理`);
              break;
            }
            const autoDecisions = commandPermissionLevel === "auto" ? autoApproveDecisions(nodeData[0]) : null;
            if (autoDecisions) {
              resumeInput = new Command({ resume: { decisions: autoDecisions } });
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "auto_approved",
                toolName: "run_command",
                title: "审批后已自动批准执行（1级权限）",
                payload: { decisions: autoDecisions, interruptData: nodeData[0] },
              });
              agentLog("自动批准", `resume thread=${thread_id}, 1级权限自动同意执行命令`);
              res.write(`data: ${JSON.stringify({ type: "tool_start", toolName: "run_command", toolAction: "auto_approved" })}\n\n`);
              if (res.flush) res.flush();
              break;
            }
            resumeInterrupted = true;
            agentLog("再次中断", `thread=${thread_id}, 需再次审批`);
            writeTaskTrace({
              runId,
              sessionId: session_id || null,
              threadId: thread_id,
              eventType: "interrupt",
              title: "审批后再次需要人工确认",
              payload: { interruptData: nodeData[0] },
            });
            frontendEvent = { type: "interrupt", node: nodeName, thread_id, interruptData: nodeData[0] };
            res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
            break;
          }

        if (nodeData?.todos) {
          currentTodos = nodeData.todos;
          writeTaskTrace({
            runId,
            sessionId: session_id || null,
            threadId: thread_id,
            eventType: "todos_update",
            title: "审批后任务清单更新",
            payload: { todos: nodeData.todos },
          });
          res.write(`data: ${JSON.stringify({ type: "todos_update", todos: nodeData.todos })}\n\n`);
          if (res.flush) res.flush();
        }

        const nodeMessages = Array.isArray(nodeData?.messages) ? nodeData.messages : [];
        for (const nodeMsg of nodeMessages) {
          if (nodeMsg?.tool_calls?.length > 0) {
            toolCalledThisRound = true;
            for (const tc of nodeMsg.tool_calls) {
              const toolName = tc.name || tc.function?.name;
              if (!toolName) continue;
              if (tc.id) pendingToolCalls.set(tc.id, { name: toolName, args: tc.args || {} });
              const toolAction = tc.args?.action ?? null;
              const calledPath = tc.args?.path || tc.args?.file_path || "";
              const skillMatch = calledPath.match(/\/skills\/([^/]+)\//);
              if (skillMatch) resumeSkillTouched = true;
              writeTaskTrace({
                runId,
                sessionId: session_id || null,
                threadId: thread_id,
                eventType: "tool_start",
                toolName,
                toolAction,
                title: skillMatch ? `审批后准备读取 Skill：${skillMatch[1]}` : "审批后工具调用",
                payload: { args: tc.args || {} },
                skillName: skillMatch?.[1] || null,
                skillAction: skillMatch ? "read" : null,
              });
              res.write(`data: ${JSON.stringify({ type: "tool_start", toolName, toolAction })}\n\n`);
              if (res.flush) res.flush();
            }
          }
        }
      }

      if (frontendEvent) {
        res.write(`data: ${JSON.stringify(frontendEvent)}\n\n`);
        if (res.flush) res.flush();
      }
    }

      if (resumeInterrupted || backendAbort.signal.aborted) break;

      // 本轮正常跑完（没有中断/重复拦截/自动批准把 resumeInput 重新赋值）：
      // 若 todos 还有未完成项且确实调用过工具，自动续跑同一 thread，逻辑对齐 /chat 的自动续跑循环
      if (!resumeInput) {
        const withinBudget = round < AUTO_MAX_ROUNDS && (Date.now() - autoStartedAt) < AUTO_MAX_DURATION_MS;
        const hasTodos = Array.isArray(currentTodos) && currentTodos.length > 0;
        const pendingLeft = hasTodos && currentTodos.some((t) => t.status !== "completed");
        if (withinBudget && pendingLeft && toolCalledThisRound) {
          resumeInput = { messages: [{ role: "user", content: "继续执行未完成的任务。" }] };
        }
      }
    }

    responseDone = true;  // 立即标记，防止 close 事件误触发
    clearInterval(heartbeat);
    agentLog("审批恢复完成", `thread=${thread_id}, 输出长度=${resumeContent.length}字符`);
    if (resumeContent && session_id) {
      try {
        saveAssistantMessage(session_id, resumeContent);
        writeTaskTrace({
          runId,
          sessionId: session_id || null,
          threadId: thread_id,
          eventType: "final_answer",
          title: "审批恢复后的回复",
          content: resumeContent,
        });
        agentLog("消息保存", `session=${session_id}, resume AI回复已写入DB`);
      } catch {}
    }
    if (!resumeInterrupted && shouldOfferSkillReview(runId)) {
      markSkillReflectionAsked(runId);
      const traceSummary = buildTaskTraceSummary(runId);
      writeTaskTrace({
        runId,
        sessionId: session_id || null,
        threadId: thread_id,
        eventType: "skill_review_request",
        title: "审批恢复后等待用户确认是否沉淀 Skill",
        content: traceSummary,
      });
      res.write(`data: ${JSON.stringify({
        type: "skill_review_request",
        thread_id,
        summary: previewText(traceSummary, 1200),
      })}\n\n`);
      if (res.flush) res.flush();
    }
    // 再次中断时保留 checkpoint，供下一次 resume 使用
    if (!resumeInterrupted) {
      executedCommandResults.delete(runId);
      clearBrowserFailureTracker(runId);
      clearOpenUrlAttemptTracker(runId);
      threadRunIds.delete(thread_id);
      cleanupThread(thread_id);
    }
    res.write(`data: ${JSON.stringify({ type: "done", thread_id })}\n\n`);
    res.end();
  } catch (error) {
    clearInterval(heartbeat);
    if (error.name === "AbortError" || backendAbort.signal.aborted) {
      agentLog("审批恢复中止", `thread=${thread_id}, 连接已断开`);
      responseDone = true;
      // 中断时也要把已生成的部分内容落库，避免刷新/重进会话后记录丢失
      if (session_id) {
        try {
          saveAssistantMessage(session_id, resumeContent || "（已停止生成）");
          agentLog("消息保存", `session=${session_id}, 中断后的AI回复已写入DB`);
        } catch {}
      }
      agentInstance = null;
      res.end();
      return;
    }
    agentLog("审批恢复异常", `thread=${thread_id}, error=${error.message}`);
    writeTaskTrace({
      runId,
      sessionId: session_id || null,
      threadId: thread_id,
      eventType: "error",
      title: "审批恢复异常",
      content: error.message,
      status: "error",
    });
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
    res.end();
  }
});

export default deepChat;
