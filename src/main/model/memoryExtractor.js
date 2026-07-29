// 长期记忆抽取模块：从每轮对话中抽取值得长期记住的用户事实，
// 通过向量检索 + LLM 决策合并进 user_memories 表，供后续会话跨 session 召回。
import * as z from "zod";
import { ModelFactory } from "./modelFactory";
import { getDB } from "../utils/getDb";
// @ts-ignore
import { setLog } from "../event/index";

const TRIVIAL_PATTERN = /^(好的?|谢谢|嗯+|哦+|ok|okay|收到|继续|可以|是的?|没问题|辛苦了|嗯嗯)[。！~!\s]*$/i;
const MIN_MEMORABLE_LENGTH = 6;
// 单用户长期记忆条数达到该阈值时，触发一次批量摘要合并，避免无限膨胀
const MEMORY_COMPACT_THRESHOLD = 50;

// 过滤掉明显不含长期信息的寒暄/确认类轮次，避免每句"好的""继续"都触发一次 LLM 调用
function isTrivialTurn(question) {
  const q = String(question || "").trim();
  if (!q) return true;
  if (q.length < MIN_MEMORABLE_LENGTH && TRIVIAL_PATTERN.test(q)) return true;
  return false;
}

const FactListSchema = z.object({
  facts: z
    .array(z.string())
    .describe(
      "从对话中提取的、值得长期记住的关于用户本人的原子事实（身份、偏好、目标、约定、正在进行的事项等）。" +
      "每条独立成句、不含指代词；如果没有值得记住的信息，返回空数组。"
    ),
});

const MemoryCompactSchema = z.object({
  facts: z
    .array(z.string())
    .describe(
      "整理压缩后的用户长期记忆事实列表，每条独立成句、不含指代词。" +
      "合并重复/高度相关的条目，新旧矛盾时保留更新更具体的一条，去掉已过时或不再有长期价值的内容。"
    ),
});

const MemoryDecisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        action: z.enum(["ADD", "UPDATE", "DELETE", "NONE"]).describe("处理动作"),
        targetId: z.number().nullable().describe("UPDATE/DELETE 时对应的已有记忆 id，ADD/NONE 时为 null"),
      })
    )
    .describe("按输入的新事实顺序逐条给出决策，数量必须和输入的新事实数量一致"),
});

async function extractCandidateFacts(question, answer) {
  const model = ModelFactory.getChatModel({ isNew: true });
  const structured = model.withStructuredOutput(FactListSchema);
  const prompt = `你是一个记忆助手，负责从下面这一轮对话中提取值得长期记住的、关于用户的事实。
要求：
1. 每条事实必须独立、简洁，不含"他/她/这个/那个"等指代词。
2. 只记录身份信息、长期偏好、目标、约定、正在进行的事项等，不要记录寒暄、临时性的操作指令。
3. 没有值得记住的信息时返回空数组，不要为了凑数编造内容。

用户：${question}
助手：${answer}`;

  try {
    const result = await structured.invoke(prompt);
    return (result?.facts || []).map((f) => String(f).trim()).filter(Boolean);
  } catch (e) {
    setLog(`记忆抽取失败: ${e.message}`);
    return [];
  }
}

async function decideMemoryActions(candidateGroups) {
  const model = ModelFactory.getChatModel({ isNew: true });
  const structured = model.withStructuredOutput(MemoryDecisionSchema);
  const context = candidateGroups
    .map((g, i) => {
      const similarText = g.similar.length
        ? g.similar.map((s) => `[id=${s.id}] ${s.content}`).join("；")
        : "无";
      return `${i + 1}. 新事实：${g.fact}\n   相似的已有记忆：${similarText}`;
    })
    .join("\n");

  const prompt = `你是一个记忆管理助手。下面列出了若干条从对话中新提取的事实，以及每条事实在已有记忆库中检索到的相似记录，请逐条决定处理动作：
- ADD：全新信息，已有记忆中没有相关内容
- UPDATE：是对某条已有记忆的补充或修正（比如用户换了工作城市），需要给出对应的 targetId
- DELETE：新事实与某条已有记忆矛盾，旧记忆应作废（新事实会被单独写入），需要给出对应的 targetId
- NONE：与已有记忆重复，无需处理

请严格按输入顺序返回，数量必须和新事实条数一致：
${context}`;

  try {
    const result = await structured.invoke(prompt);
    return result?.decisions || [];
  } catch (e) {
    setLog(`记忆决策失败: ${e.message}`);
    return candidateGroups.map(() => ({ action: "ADD", targetId: null }));
  }
}

/**
 * 单用户长期记忆条数达到 MEMORY_COMPACT_THRESHOLD 时触发：
 * 把该用户当前所有 active 记忆整体丢给 LLM 做一次合并/去重/精简，
 * 旧记录标记为 deleted，合并后的事实作为新记录写入，最后统一重建向量索引。
 */
async function compactUserMemories(userId) {
  try {
    const vectorDb = getDB();
    const rows = vectorDb.getActiveMemories(userId);
    if (rows.length < MEMORY_COMPACT_THRESHOLD) return;

    const model = ModelFactory.getChatModel({ isNew: true });
    const structured = model.withStructuredOutput(MemoryCompactSchema);
    const listText = rows.map((r, i) => `${i + 1}. ${r.content}`).join("\n");
    const prompt = `你是一个记忆整理助手。下面是关于同一个用户、目前累积的长期记忆条目，数量已经偏多，需要你做一次整理压缩：
1. 合并重复或高度相关的条目；
2. 如果新旧条目矛盾，保留看起来更新、更具体的一条；
3. 去掉已经过时、不再有长期价值的内容；
4. 在不丢失真正重要信息的前提下，尽量压缩总条数。

现有记忆：
${listText}`;

    const result = await structured.invoke(prompt);
    const facts = (result?.facts || []).map((f) => String(f).trim()).filter(Boolean);
    if (!facts.length) return;

    const embeddingModel = ModelFactory.getEmbeddingModel();
    const embeddings = await embeddingModel.embedDocuments(facts);
    const newEntries = facts.map((fact, i) => ({ fact, embedding: embeddings[i] }));

    vectorDb.replaceUserMemories(userId, rows.map((r) => r.id), newEntries);
    vectorDb.quantizeUserMemories();
    setLog(`长期记忆整理完成：用户 ${userId} 从 ${rows.length} 条压缩至 ${facts.length} 条`);
  } catch (e) {
    console.error("compactUserMemories failed", e);
    setLog(`长期记忆整理失败: ${e.message}`);
  }
}

/**
 * 对话落库后异步调用：抽取本轮值得记住的事实，与已有记忆比对后写入/更新/作废。
 * 内部吞掉所有异常，绝不能影响主对话流程。
 */
export async function processMemoryExtraction({ userId, sessionId, sourceMessageId, question, answer }) {
  try {
    if (isTrivialTurn(question)) return;

    const facts = await extractCandidateFacts(question, answer);
    if (!facts.length) return;

    const vectorDb = getDB();
    const embeddingModel = ModelFactory.getEmbeddingModel();
    const embeddings = await embeddingModel.embedDocuments(facts);

    const hasExisting = vectorDb.countUserMemories(userId) > 0;
    const candidateGroups = facts.map((fact, i) => {
      const similar = hasExisting ? vectorDb.searchUserMemories(embeddings[i], userId, 5) : [];
      return { fact, embedding: embeddings[i], similar };
    });

    const decisions = await decideMemoryActions(candidateGroups);

    for (let i = 0; i < candidateGroups.length; i++) {
      const group = candidateGroups[i];
      const decision = decisions[i] || { action: "ADD", targetId: null };

      if (decision.action === "NONE") continue;

      if (decision.action === "UPDATE" && decision.targetId) {
        vectorDb.updateMemoryContent(decision.targetId, group.embedding, group.fact);
      } else if (decision.action === "DELETE" && decision.targetId) {
        vectorDb.softDeleteMemory(decision.targetId);
        vectorDb.insertMemory(group.embedding, userId, group.fact, sessionId, sourceMessageId);
      } else {
        // ADD 或决策解析异常时的兜底，都按新增处理
        vectorDb.insertMemory(group.embedding, userId, group.fact, sessionId, sourceMessageId);
      }
    }

    if (vectorDb.countUserMemories(userId) >= MEMORY_COMPACT_THRESHOLD) {
      // compactUserMemories 内部会在结束时重建索引，这里就不用再单独 quantize 一次
      await compactUserMemories(userId);
    } else {
      vectorDb.quantizeUserMemories();
    }
  } catch (e) {
    console.error("processMemoryExtraction failed", e);
    setLog(`记忆抽取处理失败: ${e.message}`);
  }
}

/**
 * 对话生成回复前调用：按当前用户输入做语义召回，返回相关的长期记忆文本列表。
 */
export async function retrieveRelevantMemories(userId, queryText, topK = 5) {
  const text = String(queryText || "").trim();
  if (!text) return [];

  try {
    const vectorDb = getDB();
    if (vectorDb.countUserMemories(userId) === 0) return [];

    const embeddingModel = ModelFactory.getEmbeddingModel();
    const queryEmbedding = await embeddingModel.embedQuery(text);
    const rows = vectorDb.searchUserMemories(queryEmbedding, userId, topK);
    return rows.map((row) => row.content);
  } catch (e) {
    console.error("retrieveRelevantMemories failed", e);
    return [];
  }
}
