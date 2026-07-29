// @ts-ignore
import { success, error500 } from "../responseFn";
import { formatDate } from "../../utils/common";
import { doc } from "../../utils/document";
import { HumanMessage, SystemMessage } from "langchain";
import { getDB } from "../../utils/getDb";
import { ModelFactory } from "../../model/modelFactory";
import { indexProfileWritingSamples } from "./profileSampleSearch";
import * as z from "zod";

const db = new Proxy(
  {},
  {
    get: (_, prop) => getDB().db[prop],
  }
);
const express = require("express");
const writeStyleServer = express.Router();
const DEFAULT_PROFILE_TITLE = "我的写作画像";
const PROFILE_HISTORY_LIMIT = 5;

const SampleAnalysisSchema = z.object({
  summary: z.string().describe("单篇样本摘要"),
  writingTechniques: z.array(z.string()).describe("该样本使用的写作手法"),
  writingStyle: z.string().describe("该样本的语气、节奏和风格"),
  coreIdea: z.string().describe("该样本的核心思想或观点"),
});

const FeedbackProfileSuggestionSchema = z.object({
  summarySuggestion: z.string().describe("基于反馈提炼出的总画像候选建议，控制在160字以内"),
  preferredSignals: z
    .array(z.string())
    .default([])
    .describe("从高分或正向反馈中提炼出的稳定偏好，最多5条"),
  avoidSignals: z
    .array(z.string())
    .default([])
    .describe("从低分或修改意见中提炼出的稳定避坑规则，最多5条"),
  preferredPhrases: z
    .array(z.string())
    .default([])
    .describe("建议合并到常用表达的短语，必须短而具体，最多5条"),
  avoidPhrases: z
    .array(z.string())
    .default([])
    .describe("建议合并到避免表达的短语或AI味说法，必须短而具体，最多5条"),
  evidence: z.array(z.string()).default([]).describe("支撑这些建议的反馈依据，最多5条"),
});

const MergedProfileSummarySchema = z.object({
  summary: z
    .string()
    .default("")
    .describe("合并旧画像和反馈建议后的总画像，必须控制在200个中文字符以内"),
});

const SAMPLE_ANALYSIS_PROMPT = `你是个人写作样本分析助手。现在只分析一篇高质量写作样本，用于建设用户的个人写作素材库。

只返回样本中能观察到的事实，不要推断或生成用户的总画像。
重点提取：
1. summary：这篇样本讲了什么，尽量控制在 80 个中文字符以内。
2. writingTechniques：具体写作手法，例如开头方式、结构、例子、对比、节奏、结尾方式。
3. writingStyle：语气、句式节奏、用词习惯、叙述质感。
4. coreIdea：样本背后的中心观点、判断或价值取向。

请使用中文回答，字段要简洁，方便后续复用。
请按结构化输出要求返回 JSON 对象，不要输出 JSON 之外的文本。`;

const FEEDBACK_PROFILE_SUGGESTION_PROMPT = `你是个人写作画像反馈分析助手。你要根据用户在同一个写作会话里对 AI 写作结果的评分和修改意见，判断这里面有没有值得长期保留到总画像的写作偏好。

重要原则：
1. 这些反馈来自同一次写作任务的多轮修改，只代表这一个会话，不代表用户所有写作场景的稳定偏好。如果这个会话里的反馈看起来只是这次任务的临时要求（例如字数、格式、特定素材），而不是可以长期复用的风格偏好，请如实说明，不要为了输出内容而勉强总结或夸大。
2. 低分反馈和修改意见用于发现避坑规则，高分反馈用于发现被用户认可的表达倾向；同一个会话里反复出现的修改意见比只出现一次的更可信。
3. 不要直接改写文章，不要编造反馈里没有出现的信息。
4. summarySuggestion 控制在 160 个中文字符以内，写成可合并进总画像的自然文本；如果这个会话不构成稳定偏好，summarySuggestion 可以为空字符串。
5. preferredSignals、avoidSignals 是规则描述；preferredPhrases、avoidPhrases 是可直接放进"常用表达/避免表达"列表的短词短句。
6. preferredPhrases 和 avoidPhrases 必须短、具体、可复用，不要放整句任务要求。
7. 会给你当前已有的常用表达和避免表达列表。新提炼的表达不能和已有列表里的表达意思矛盾（比如已有"避免总结开头"，这次又根据反馈提炼出"喜欢总结开头"）。如果这次反馈明确推翻了已有的某条表达，就只输出新的判断，不要让两条矛盾的表达同时出现；如果吃不准，就不要输出这条有冲突的表达。
8. 请按结构化输出要求返回 JSON 对象，不要输出 JSON 之外的文本。`;

const MERGE_PROFILE_SUMMARY_PROMPT = `你是个人写作画像合并助手。请把旧总画像和用户确认过的反馈建议合并重写。

要求：
1. 输出一个新的总画像 summary，必须控制在 200 个中文字符以内。
2. 不要简单追加，要归并、去重、压缩，保留最稳定的长期风格。
3. 不要写临时任务要求，不要写"用户反馈显示"这类分析口吻。
4. 总画像要能直接放进写作提示词，帮助 AI 写得更像用户。
5. 请按结构化输出要求返回 JSON 对象，不要输出 JSON 之外的文本。
6. JSON 只能使用字段名 summary，不要使用"总画像"、"画像名称"、"常用表达"等中文字段名。`;

const PHRASE_SPLIT_REGEX = /[\n,;|]+/;
const NOISY_EXTRACTED_PHRASE_KEYWORDS = [
  "page",
  "frontend",
  "backend",
  "requirement",
  "task",
  "issue",
  "bug",
  "metric",
  "target",
  "data",
  "project",
  "system",
  "platform",
  "module",
  "business",
  "tech",
  "test",
  "release",
  "online",
  "daily",
  "weekly",
  "report",
  "meeting",
  "deadline",
  "milestone",
  "api",
  "kpi",
  "okr",
  "roi",
  "gmv",
  "p95",
  "页面",
  "前端",
  "后端",
  "联调",
  "接口",
  "任务",
  "需求",
  "排期",
  "工期",
  "指标",
  "目标",
  "数据",
  "复盘",
  "验收",
  "交付",
  "推进",
  "拆解",
  "评审",
  "方案",
  "项目",
  "系统",
  "平台",
  "模块",
  "业务",
  "技术",
  "测试",
  "发布",
  "上线",
  "日报",
  "周报",
  "汇报",
  "风险",
  "里程碑",
];

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function safeJsonParse(value, fallback = []) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSourceType(type) {
  if (String(type) === "1") return "upload";
  if (String(type) === "2") return "manual";
  if (String(type) === "3") return "website";
  return "manual";
}

function normalizePhraseValue(value) {
  return String(value || "")
    .replace(/^[\s\d\-*.)("']+/, "")
    .replace(/[.,;:)\]"'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsCjk(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function isNoisyExtractedPhrase(value) {
  const lower = String(value || "").toLowerCase();
  if (!lower) return true;
  if (lower.length < 2 || lower.length > 24) return true;
  if (/[\d%<>/=]/.test(lower)) return true;
  if (
    /^(must|need|require|ensure|complete|provide|output|mark|split|promote)/.test(lower) ||
    /^(?:必须|需要|要求|确保|完成|提供|输出|标注)/.test(
      lower
    )
  ) {
    return true;
  }
  if (!containsCjk(lower) && /[a-z]{3,}/.test(lower)) return true;
  if (NOISY_EXTRACTED_PHRASE_KEYWORDS.some((keyword) => lower.includes(keyword))) return true;
  return false;
}

function sanitizePhraseList(list, { strict = false, maxCount = 8 } = {}) {
  const result = [];
  const seen = new Set();

  for (const raw of list || []) {
    const value = normalizePhraseValue(raw);
    if (!value || seen.has(value)) continue;
    if (strict && isNoisyExtractedPhrase(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= maxCount) break;
  }

  return result;
}

// 反馈驱动的常用/避免表达合并，上限从 8 提到 15，且不再是"旧的优先、超了就砍尾巴"，
// 而是按权重（这条表达被反复建议的次数）保留最靠谱的那些；权重只存在 styleProfile 里，
// 不改变 preferredPhrases/avoidPhrases 对外暴露的"字符串数组"形状。
const FEEDBACK_MERGED_PHRASE_MAX_COUNT = 15;

function mergeWeightedPhrases(existingPhrases = [], existingWeights = {}, incomingPhrases = []) {
  const weights = { ...existingWeights };
  const order = [...existingPhrases];

  incomingPhrases.forEach((phrase) => {
    weights[phrase] = (weights[phrase] || 0) + 1;
    if (!order.includes(phrase)) {
      order.push(phrase);
    }
  });

  // sort 是稳定排序，权重相同的情况下会保留 order 里原本的先后顺序——
  // 也就是已经存在的表达优先于这一轮新追加的，符合"先合并去重、最后才追加替换"的顺序。
  const sorted = [...order].sort((a, b) => (weights[b] || 1) - (weights[a] || 1));
  const finalPhrases = sorted.slice(0, FEEDBACK_MERGED_PHRASE_MAX_COUNT);
  const finalWeights = {};
  finalPhrases.forEach((phrase) => {
    finalWeights[phrase] = weights[phrase] || 1;
  });

  return { phrases: finalPhrases, weights: finalWeights };
}

// 兜底：如果同一个短语字面上同时出现在常用和避免两个列表里（明显互斥），两边都剔除，
// 避免"喜欢总结开头"和"避免总结开头"这种矛盾同时存在于总画像里。
// 更细粒度的语义矛盾（措辞不同但意思相反）交给生成建议的 LLM 提前判断，这里只兜底完全同字面的情况。
function resolvePhraseListConflicts(preferredPhrases = [], avoidPhrases = []) {
  const avoidSet = new Set(avoidPhrases);
  const conflictSet = new Set(preferredPhrases.filter((phrase) => avoidSet.has(phrase)));
  if (!conflictSet.size) {
    return { preferredPhrases, avoidPhrases };
  }
  return {
    preferredPhrases: preferredPhrases.filter((phrase) => !conflictSet.has(phrase)),
    avoidPhrases: avoidPhrases.filter((phrase) => !conflictSet.has(phrase)),
  };
}

function parsePhraseInput(value, options = {}) {
  if (!value) return [];

  let values = [];
  if (Array.isArray(value)) {
    values = value;
  } else {
    values = String(value)
      .replace(/[\uFF0C\uFF1B\u3001]/g, ",")
      .split(PHRASE_SPLIT_REGEX)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return sanitizePhraseList(values, options);
}

function buildWritingSample(content = "", limit = 1200) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function buildSamplePreview(content = "", limit = 220) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function buildManualSampleName(content = "", limit = 24) {
  const firstLine = String(content || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!firstLine) return "自定义样本";
  if (firstLine.length <= limit) return firstLine;
  return `${firstLine.slice(0, limit)}...`;
}

function normalizeSampleAnalysis(value = {}) {
  const analysis = value && typeof value === "object" ? value : {};
  return {
    summary: String(analysis.summary || "").trim(),
    writingTechniques: sanitizePhraseList(analysis.writingTechniques || [], {
      maxCount: 8,
    }),
    writingStyle: String(analysis.writingStyle || "").trim(),
    coreIdea: String(analysis.coreIdea || "").trim(),
  };
}

function parseSampleAnalysis(value) {
  return normalizeSampleAnalysis(safeJsonParse(value, {}));
}

function mapSampleRecord(item) {
  if (!item) return null;
  return {
    id: item.id,
    profileId: item.profileId,
    sourceType: item.sourceType,
    sourceName: item.sourceName || "未命名样本",
    createTime: item.createTime,
    updateTime: item.updateTime,
    analysisStatus: item.analysisStatus || "pending",
    analysisUpdateTime: item.analysisUpdateTime || "",
    analysisProfile: parseSampleAnalysis(item.analysisProfile),
    preview: buildSamplePreview(item.content),
    length: String(item.content || "").trim().length,
  };
}

function buildStyleSummary({
  extractedSummary = "",
  title = "",
  scene = "",
  identity = "",
  manualPreferredPhrases = [],
  manualAvoidPhrases = [],
}) {
  const parts = [];

  if (extractedSummary) parts.push(extractedSummary.trim());

  const meta = [];
  if (title) meta.push(`画像名称：${title}`);
  if (identity) meta.push(`用户身份：${identity}`);
  if (scene) meta.push(`写作场景：${scene}`);
  if (meta.length) parts.push(meta.join("; "));

  if (manualPreferredPhrases.length) {
    parts.push(`保留这些常用表达：${manualPreferredPhrases.join("、")}`);
  }
  if (manualAvoidPhrases.length) {
    parts.push(`避免这些表达：${manualAvoidPhrases.join("、")}`);
  }

  if (!parts.length) {
    return "这是一个长期维护的个人写作画像。写作时优先贴近用户自己的语气、节奏和用词习惯。";
  }

  return parts.join("\n");
}

function limitProfileSummary(value = "", limit = 200) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, limit);
}

function buildStoredStyleProfile({
  previousStyleProfile = {},
  extractedSummary = "",
  manualPreferredPhrases = [],
  manualAvoidPhrases = [],
  hasManualPreferred = false,
  hasManualAvoid = false,
  extractedPreferredPhrases = [],
  extractedAvoidPhrases = [],
  finalPreferredPhrases = [],
  finalAvoidPhrases = [],
  title = "",
  scene = "",
  identity = "",
  now = "",
}) {
  const profile = {
    ...previousStyleProfile,
    summary: limitProfileSummary(
      buildStyleSummary({
        extractedSummary,
        title,
        scene,
        identity,
        manualPreferredPhrases: hasManualPreferred ? manualPreferredPhrases : [],
        manualAvoidPhrases: hasManualAvoid ? manualAvoidPhrases : [],
      })
    ),
    extractedSummary,
    extractedPreferredPhrases,
    extractedAvoidPhrases,
    preferredPhrases: finalPreferredPhrases,
    avoidPhrases: finalAvoidPhrases,
    extractedAt: now,
  };

  if (hasManualPreferred) {
    profile.manualPreferredPhrases = manualPreferredPhrases;
  } else {
    delete profile.manualPreferredPhrases;
  }

  if (hasManualAvoid) {
    profile.manualAvoidPhrases = manualAvoidPhrases;
  } else {
    delete profile.manualAvoidPhrases;
  }

  return profile;
}

function buildProfileHistoryEntry(styleProfile = {}, savedAt = "") {
  return {
    summary: styleProfile.summary || "",
    preferredPhrases: Array.isArray(styleProfile.preferredPhrases) ? styleProfile.preferredPhrases : [],
    avoidPhrases: Array.isArray(styleProfile.avoidPhrases) ? styleProfile.avoidPhrases : [],
    preferredPhraseWeights: styleProfile.preferredPhraseWeights || {},
    avoidPhraseWeights: styleProfile.avoidPhraseWeights || {},
    savedAt,
  };
}

// 在覆盖总画像前把旧状态存一份快照，最多保留 PROFILE_HISTORY_LIMIT 条，用于一键恢复。
function pushProfileHistory(nextStyleProfile, previousStyleProfile = {}, now = "") {
  const history = Array.isArray(previousStyleProfile.summaryHistory)
    ? previousStyleProfile.summaryHistory
    : [];
  const entry = buildProfileHistoryEntry(previousStyleProfile, now);

  if (!entry.summary && !entry.preferredPhrases.length && !entry.avoidPhrases.length) {
    nextStyleProfile.summaryHistory = history.slice(0, PROFILE_HISTORY_LIMIT);
    return;
  }

  nextStyleProfile.summaryHistory = [entry, ...history].slice(0, PROFILE_HISTORY_LIMIT);
}

function getCurrentProfileRaw() {
  return db
    .prepare(
      `
    SELECT *
    FROM articles
    WHERE articleType = 'persona'
    ORDER BY updateTime DESC, createTime DESC, id DESC
    LIMIT 1
  `
    )
    .get();
}

function getProfileByIdRaw(id) {
  return db.prepare(`SELECT * FROM articles WHERE id = ? AND articleType = 'persona'`).get(id);
}

function listProfileSamplesRaw(profileId) {
  return db
    .prepare(
      `
    SELECT *
    FROM writingProfileSamples
    WHERE profileId = ?
    ORDER BY createTime DESC, updateTime DESC, id DESC
  `
    )
    .all(profileId);
}

function findProfileSampleRaw(sampleId) {
  return db.prepare(`SELECT * FROM writingProfileSamples WHERE id = ?`).get(sampleId);
}

function buildCombinedOriginalContent(sampleRows = []) {
  return sampleRows
    .map((item) => String(item.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function mapProfileRecord(item, { includeSamples = false } = {}) {
  if (!item) return null;

  const styleProfile = safeJsonParse(item.styleProfile, {});
  const preferredPhrases = parsePhraseInput(safeJsonParse(item.preferredPhrases, []), {
    maxCount: 8,
  });
  const avoidPhrases = parsePhraseInput(safeJsonParse(item.avoidPhrases, []), {
    maxCount: 8,
  });
  const samples = includeSamples ? listProfileSamplesRaw(item.id).map(mapSampleRecord) : [];

  return {
    ...item,
    preferredPhrases,
    avoidPhrases,
    styleProfile,
    samplePreview: buildWritingSample(item.originalContent),
    sampleCount: includeSamples ? samples.length : undefined,
    samples,
  };
}

function insertProfileRecord({
  title,
  content,
  originalContent,
  sourceType,
  scene,
  identity,
  preferredPhrases,
  avoidPhrases,
  styleProfile,
  now,
}) {
  const stmt = db.prepare(`
    INSERT INTO articles(
      title,
      content,
      originalContent,
      sourceType,
      scene,
      identity,
      preferredPhrases,
      avoidPhrases,
      styleProfile,
      articleType,
      updateTime,
      createTime
    ) values(?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  return stmt.run(
    title || DEFAULT_PROFILE_TITLE,
    content || "",
    originalContent || "",
    sourceType || "manual",
    scene || "",
    identity || "",
    JSON.stringify(preferredPhrases || []),
    JSON.stringify(avoidPhrases || []),
    JSON.stringify(styleProfile || {}),
    "persona",
    now,
    now
  );
}

function updateProfileRecord(id, payload) {
  const stmt = db.prepare(`
    UPDATE articles
    SET title = ?,
        content = ?,
        originalContent = ?,
        sourceType = ?,
        scene = ?,
        identity = ?,
        preferredPhrases = ?,
        avoidPhrases = ?,
        styleProfile = ?,
        updateTime = ?
    WHERE id = ?
  `);

  return stmt.run(
    payload.title || DEFAULT_PROFILE_TITLE,
    payload.content || "",
    payload.originalContent || "",
    payload.sourceType || "manual",
    payload.scene || "",
    payload.identity || "",
    JSON.stringify(payload.preferredPhrases || []),
    JSON.stringify(payload.avoidPhrases || []),
    JSON.stringify(payload.styleProfile || {}),
    payload.now,
    id
  );
}

function insertSampleRecord(profileId, sample) {
  const now = formatDate(new Date().getTime());
  return db
    .prepare(
      `
    INSERT INTO writingProfileSamples(
      profileId,
      sourceType,
      sourceName,
      content,
      analysisProfile,
      analysisStatus,
      analysisUpdateTime,
      createTime,
      updateTime
    ) values(?,?,?,?,?,?,?,?,?)
  `
    )
    .run(
      profileId,
      sample.sourceType || "manual",
      sample.sourceName || "未命名样本",
      sample.content || "",
      JSON.stringify(normalizeSampleAnalysis(sample.analysisProfile || {})),
      sample.analysisStatus || "analyzed",
      sample.analysisUpdateTime || now,
      now,
      now
    );
}

function deleteSampleRecord(sampleId) {
  return db.prepare(`DELETE FROM writingProfileSamples WHERE id = ?`).run(sampleId);
}

function deleteProfileSamples(profileId) {
  return db.prepare(`DELETE FROM writingProfileSamples WHERE profileId = ?`).run(profileId);
}

async function loadDocContent(filePath) {
  const docObj = new doc({
    docPath: filePath,
    chunkSize: 15000,
  });
  const text = await docObj.loader.load();
  return text.map((item) => item.pageContent).join("\n");
}

async function extractSamplePayloads({ type, content, url, filePaths }) {
  const sourceType = normalizeSourceType(type);

  if (String(type) === "1") {
    if (!filePaths || filePaths.length === 0) {
      throw new Error("请先选择样本文件");
    }

    const file = filePaths[0];
    const item = {
      sourceType,
      sourceName: file.fileName || "上传样本",
      content: await loadDocContent(file.filePath),
    };

    return [item].filter((item) => String(item.content || "").trim());
  }

  if (String(type) === "2") {
    const manualContent = String(content || "").trim();
    return [
      {
        sourceType,
        sourceName: buildManualSampleName(manualContent),
        content: manualContent,
      },
    ].filter((item) => item.content);
  }

  if (String(type) === "3") {
    const remoteContent = await loadDocContent(url);
    return [
      {
        sourceType,
        sourceName: String(url || "").trim() || "网页样本",
        content: remoteContent,
      },
    ].filter((item) => String(item.content || "").trim());
  }

  return [];
}

async function analyzeWritingSample(content) {
  const model = ModelFactory.getChatModel({ isNew: true });

  const modelWithStructure = model.withStructuredOutput(SampleAnalysisSchema);
  const analysis = await modelWithStructure.invoke([
    new SystemMessage(SAMPLE_ANALYSIS_PROMPT),
    new HumanMessage(String(content || "").trim()),
  ]);

  return normalizeSampleAnalysis(analysis);
}

async function saveIndexedProfile(profileId, originalContent, context = {}) {
  let indexedSampleCount = 0;
  try {
    const indexed = await indexProfileWritingSamples(profileId, originalContent, context);
    indexedSampleCount = indexed.count || 0;
  } catch (indexError) {
    console.error("indexProfileWritingSamples failed", indexError);
  }
  return indexedSampleCount;
}

async function refreshProfileSampleIndex(profileId, contextOverrides = {}) {
  const current = getProfileByIdRaw(profileId);
  if (!current) {
    throw new Error("未找到写作画像");
  }

  const sampleRows = listProfileSamplesRaw(profileId);
  const combinedOriginalContent = buildCombinedOriginalContent(sampleRows);
  const preferredPhrases = parsePhraseInput(safeJsonParse(current.preferredPhrases, []), {
    maxCount: 8,
  });
  const avoidPhrases = parsePhraseInput(safeJsonParse(current.avoidPhrases, []), {
    maxCount: 8,
  });

  const now = formatDate(new Date().getTime());
  updateProfileRecord(profileId, {
    title: current.title || DEFAULT_PROFILE_TITLE,
    content: current.content || "",
    originalContent: combinedOriginalContent,
    sourceType: current.sourceType || "manual",
    scene: current.scene || "",
    identity: current.identity || "",
    preferredPhrases,
    avoidPhrases,
    styleProfile: safeJsonParse(current.styleProfile, {}),
    now,
  });

  if (!combinedOriginalContent) {
    getDB().clearWritingSamples(profileId);
    return 0;
  }

  return saveIndexedProfile(profileId, combinedOriginalContent, {
    title: current.title,
    scene: current.scene,
    identity: current.identity,
    preferredPhrases,
    avoidPhrases,
    ...contextOverrides,
  });
}

function ensureCurrentProfileRecord(options = {}) {
  const current = getCurrentProfileRaw();
  if (current?.id) {
    return current.id;
  }

  const title = String(options.title || "").trim() || DEFAULT_PROFILE_TITLE;
  const scene = String(options.scene || "").trim();
  const identity = String(options.identity || "").trim();
  const hasManualPreferred = hasOwn(options, "manualPreferredPhrases");
  const hasManualAvoid = hasOwn(options, "manualAvoidPhrases");
  const manualPreferredPhrases = hasManualPreferred
    ? parsePhraseInput(options.manualPreferredPhrases, { maxCount: 8 })
    : [];
  const manualAvoidPhrases = hasManualAvoid
    ? parsePhraseInput(options.manualAvoidPhrases, { maxCount: 8 })
    : [];
  const now = formatDate(new Date().getTime());

  const styleProfile = buildStoredStyleProfile({
    previousStyleProfile: {},
    extractedSummary: "",
    manualPreferredPhrases,
    manualAvoidPhrases,
    hasManualPreferred,
    hasManualAvoid,
    extractedPreferredPhrases: [],
    extractedAvoidPhrases: [],
    finalPreferredPhrases: hasManualPreferred ? manualPreferredPhrases : [],
    finalAvoidPhrases: hasManualAvoid ? manualAvoidPhrases : [],
    title,
    scene,
    identity,
    now,
  });

  const result = insertProfileRecord({
    title,
    content: "",
    originalContent: "",
    sourceType: "manual",
    scene,
    identity,
    preferredPhrases: hasManualPreferred ? manualPreferredPhrases : [],
    avoidPhrases: hasManualAvoid ? manualAvoidPhrases : [],
    styleProfile,
    now,
  });

  return Number(result.lastInsertRowid);
}

function updateManualProfileFields(profileId, overrides = {}) {
  const current = getProfileByIdRaw(profileId);
  if (!current) {
    throw new Error("未找到写作画像");
  }

  const currentStyleProfile = safeJsonParse(current.styleProfile, {});
  const hasManualPreferred = hasOwn(overrides, "manualPreferredPhrases")
    ? true
    : hasOwn(currentStyleProfile, "manualPreferredPhrases");
  const hasManualAvoid = hasOwn(overrides, "manualAvoidPhrases")
    ? true
    : hasOwn(currentStyleProfile, "manualAvoidPhrases");
  const manualPreferredPhrases = hasOwn(overrides, "manualPreferredPhrases")
    ? parsePhraseInput(overrides.manualPreferredPhrases, { maxCount: 8 })
    : hasManualPreferred
      ? parsePhraseInput(currentStyleProfile.manualPreferredPhrases || [], { maxCount: 8 })
      : [];
  const manualAvoidPhrases = hasOwn(overrides, "manualAvoidPhrases")
    ? parsePhraseInput(overrides.manualAvoidPhrases, { maxCount: 8 })
    : hasManualAvoid
      ? parsePhraseInput(currentStyleProfile.manualAvoidPhrases || [], { maxCount: 8 })
      : [];

  const finalTitle =
    String(overrides.title ?? current.title ?? DEFAULT_PROFILE_TITLE).trim() || DEFAULT_PROFILE_TITLE;
  const finalScene = String(overrides.scene ?? current.scene ?? "").trim();
  const finalIdentity = String(overrides.identity ?? current.identity ?? "").trim();
  const existingPreferredPhrases = parsePhraseInput(safeJsonParse(current.preferredPhrases, []), {
    maxCount: 8,
  });
  const existingAvoidPhrases = parsePhraseInput(safeJsonParse(current.avoidPhrases, []), {
    maxCount: 8,
  });
  const finalPreferredPhrases = hasManualPreferred ? manualPreferredPhrases : existingPreferredPhrases;
  const finalAvoidPhrases = hasManualAvoid ? manualAvoidPhrases : existingAvoidPhrases;
  const now = formatDate(new Date().getTime());
  const styleProfile = buildStoredStyleProfile({
    previousStyleProfile: currentStyleProfile,
    extractedSummary: currentStyleProfile.extractedSummary || currentStyleProfile.summary || "",
    manualPreferredPhrases,
    manualAvoidPhrases,
    hasManualPreferred,
    hasManualAvoid,
    extractedPreferredPhrases: currentStyleProfile.extractedPreferredPhrases || [],
    extractedAvoidPhrases: currentStyleProfile.extractedAvoidPhrases || [],
    finalPreferredPhrases,
    finalAvoidPhrases,
    title: finalTitle,
    scene: finalScene,
    identity: finalIdentity,
    now,
  });

  updateProfileRecord(profileId, {
    title: finalTitle,
    content: current.content || "",
    originalContent: current.originalContent || "",
    sourceType: current.sourceType || "manual",
    scene: finalScene,
    identity: finalIdentity,
    preferredPhrases: finalPreferredPhrases,
    avoidPhrases: finalAvoidPhrases,
    styleProfile,
    now,
  });

  return mapProfileRecord(getProfileByIdRaw(profileId), { includeSamples: true });
}

// 每个写作会话（sessionId）可能包含好几轮反馈，反馈管理列表以"会话"为一条记录，
// 而不是每条反馈单独一条——这样"从反馈更新画像"时天然只会带上同一次写作任务里的反馈，
// 既符合语义（同一篇稿子的多轮修改本来就该放在一起看），也不需要再靠固定条数上限去控制体量。
const SESSION_FEEDBACK_ROW_LIMIT = 20;

function getFeedbackSessionKey(row) {
  return String(row.sessionId || "").trim() || `row-${row.id}`;
}

function listAllFeedbackRowsForProfile(profileId) {
  return db
    .prepare(
      `
      SELECT id, profileId, sessionId, userPrompt, aiDraft, userFeedback, revisedDraft, score, accepted, status, createTime, updateTime
      FROM writing_feedback_pool
      WHERE profileId = ?
      ORDER BY id ASC
    `
    )
    .all(profileId);
}

function groupFeedbackRowsBySession(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getFeedbackSessionKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

// 已经应用过的反馈会在 applyFeedbackProfileSuggestion 里直接删除，
// 所以这里能查到的会话必然还没被用来更新过总画像，不需要再区分"待处理/已应用"状态。
function buildFeedbackSessionSummary(sessionKey, rows = []) {
  const latest = rows[rows.length - 1];
  const scores = rows.map((item) => Number(item.score || 0)).filter((n) => Number.isFinite(n));

  return {
    sessionKey,
    sessionId: latest.sessionId || "",
    feedbackCount: rows.length,
    avgScore: scores.length
      ? Number((scores.reduce((sum, n) => sum + n, 0) / scores.length).toFixed(1))
      : 0,
    latestScore: latest.score,
    latestPreview:
      buildSamplePreview(latest.userFeedback, 80) || buildSamplePreview(latest.userPrompt, 80),
    createTime: rows[0].createTime,
    updateTime: latest.updateTime || latest.createTime,
  };
}

function listFeedbackSessions(profileId, { page = 1, pageSize = 10 } = {}) {
  const rows = listAllFeedbackRowsForProfile(profileId);
  const grouped = groupFeedbackRowsBySession(rows);
  const summaries = Array.from(grouped.entries())
    .map(([sessionKey, groupRows]) => buildFeedbackSessionSummary(sessionKey, groupRows))
    .sort((a, b) => String(b.updateTime || b.createTime).localeCompare(String(a.updateTime || a.createTime)));

  const total = summaries.length;
  const start = (page - 1) * pageSize;

  return {
    list: summaries.slice(start, start + pageSize),
    total,
  };
}

function getFeedbackRowsForSession(profileId, sessionKey) {
  return listAllFeedbackRowsForProfile(profileId).filter(
    (row) => getFeedbackSessionKey(row) === sessionKey
  );
}

function mapFeedbackDetailRecord(item) {
  return {
    id: item.id,
    profileId: item.profileId,
    sessionId: item.sessionId,
    score: item.score,
    accepted: Boolean(item.accepted),
    status: item.status || "pending_profile_review",
    userPrompt: item.userPrompt || "",
    aiDraft: item.aiDraft || "",
    userFeedback: item.userFeedback || "",
    revisedDraft: item.revisedDraft || "",
    createTime: item.createTime,
    updateTime: item.updateTime,
  };
}

function formatSessionFeedbackRows(rows = []) {
  return rows
    .map((item, index) => {
      const userPrompt = buildSamplePreview(item.userPrompt, 120) || "无";
      const userFeedback = buildSamplePreview(item.userFeedback, 160) || "无";
      const aiDraft = buildSamplePreview(item.aiDraft, 160) || "无";
      return `${index + 1}. 评分：${item.score}/10
原始需求：${userPrompt}
用户修改意见：${userFeedback}
AI草稿摘录：${aiDraft}`;
    })
    .join("\n\n");
}

function normalizeFeedbackSuggestion(value = {}) {
  const suggestion = value && typeof value === "object" ? value : {};
  return {
    summarySuggestion: String(suggestion.summarySuggestion || "").trim().slice(0, 220),
    preferredSignals: sanitizePhraseList(suggestion.preferredSignals || [], { maxCount: 5 }),
    avoidSignals: sanitizePhraseList(suggestion.avoidSignals || [], { maxCount: 5 }),
    preferredPhrases: sanitizePhraseList(suggestion.preferredPhrases || [], {
      strict: true,
      maxCount: 5,
    }),
    avoidPhrases: sanitizePhraseList(suggestion.avoidPhrases || [], {
      strict: true,
      maxCount: 5,
    }),
    evidence: sanitizePhraseList(suggestion.evidence || [], { maxCount: 5 }),
  };
}

function getMergedSummary(value = {}, fallback = "") {
  const result = value && typeof value === "object" ? value : {};
  return String(result.summary || result["总画像"] || fallback || "").trim();
}

function extractJsonObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return {};

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;

  try {
    return JSON.parse(candidate);
  } catch {
    return {};
  }
}

async function invokeMergedProfileSummary(model, messages) {
  try {
    return await model.withStructuredOutput(MergedProfileSummarySchema).invoke(messages);
  } catch (err) {
    console.warn("structured merge profile summary failed, fallback to plain JSON parse", err);
    const result = await model.invoke(messages);
    return extractJsonObject(result?.content || result);
  }
}

async function buildFeedbackProfileSuggestion(profileId, sessionKey) {
  const current = getProfileByIdRaw(profileId);
  if (!current) {
    throw new Error("未找到写作画像");
  }

  const allRows = getFeedbackRowsForSession(profileId, sessionKey);
  if (!allRows.length) {
    throw new Error("未找到该会话的反馈");
  }
  // 一个会话内部理论上也可能有很多轮反馈，这里保留一个宽松上限兜底，
  // 只取最近的 N 轮参与本次建议，并把参与的反馈 id 如实返回，apply 时只标记这些 id。
  const rows = allRows.slice(-SESSION_FEEDBACK_ROW_LIMIT);

  const currentStyleProfile = safeJsonParse(current.styleProfile, {});
  const existingPreferredPhrases = parsePhraseInput(safeJsonParse(current.preferredPhrases, []), {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });
  const existingAvoidPhrases = parsePhraseInput(safeJsonParse(current.avoidPhrases, []), {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });
  const model = ModelFactory.getChatModel();
  const modelWithStructure = model.withStructuredOutput(FeedbackProfileSuggestionSchema);
  const result = await modelWithStructure.invoke([
    new SystemMessage(FEEDBACK_PROFILE_SUGGESTION_PROMPT),
    new HumanMessage(`当前总画像：
${currentStyleProfile.summary || "无"}

画像基础信息：
标题：${current.title || DEFAULT_PROFILE_TITLE}
身份：${current.identity || "未指定"}
场景：${current.scene || "未指定"}

已有常用表达：
${existingPreferredPhrases.length ? existingPreferredPhrases.join("、") : "无"}

已有避免表达：
${existingAvoidPhrases.length ? existingAvoidPhrases.join("、") : "无"}

这个会话里的反馈（共 ${rows.length} 轮）：
${formatSessionFeedbackRows(rows)}`),
  ]);

  return {
    suggestion: normalizeFeedbackSuggestion(result),
    currentSummary: currentStyleProfile.summary || "",
    sessionKey,
    feedbackIds: rows.map((item) => item.id),
  };
}

async function applyFeedbackProfileSuggestion(profileId, sessionKey, feedbackIds = [], suggestionPayload = {}) {
  const current = getProfileByIdRaw(profileId);
  if (!current) {
    throw new Error("未找到写作画像");
  }

  const sessionRows = getFeedbackRowsForSession(profileId, sessionKey);
  if (!sessionRows.length) {
    throw new Error("未找到该会话的反馈");
  }
  const sessionRowIds = new Set(sessionRows.map((item) => item.id));
  // 只允许标记确实属于这个会话、且真正参与过本次建议的反馈，避免误伤其他会话或未分析过的反馈。
  const idsToMark = (Array.isArray(feedbackIds) ? feedbackIds : [])
    .map((id) => Number(id))
    .filter((id) => sessionRowIds.has(id));
  if (!idsToMark.length) {
    throw new Error("没有可标记的反馈，请重新生成建议");
  }

  const suggestion = normalizeFeedbackSuggestion(suggestionPayload);
  if (!suggestion.summarySuggestion) {
    throw new Error("画像建议不能为空");
  }

  const currentStyleProfile = safeJsonParse(current.styleProfile, {});
  const model = ModelFactory.getChatModel();
  const merged = await invokeMergedProfileSummary(model, [
    new SystemMessage(MERGE_PROFILE_SUMMARY_PROMPT),
    new HumanMessage(`旧总画像：
${currentStyleProfile.summary || "无"}

用户确认的候选建议：
${suggestion.summarySuggestion}

偏好信号：
${suggestion.preferredSignals.length ? suggestion.preferredSignals.join("、") : "无"}

避坑信号：
${suggestion.avoidSignals.length ? suggestion.avoidSignals.join("、") : "无"}

建议常用表达：
${suggestion.preferredPhrases.length ? suggestion.preferredPhrases.join("、") : "无"}

建议避免表达：
${suggestion.avoidPhrases.length ? suggestion.avoidPhrases.join("、") : "无"}

画像基础信息：
身份：${current.identity || "未指定"}
场景：${current.scene || "未指定"}`),
  ]);

  const now = formatDate(new Date().getTime());
  const summary = limitProfileSummary(getMergedSummary(merged, suggestion.summarySuggestion));
  const preferredPhrases = parsePhraseInput(safeJsonParse(current.preferredPhrases, []), {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });
  const avoidPhrases = parsePhraseInput(safeJsonParse(current.avoidPhrases, []), {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });
  const preferredMerge = mergeWeightedPhrases(
    preferredPhrases,
    currentStyleProfile.preferredPhraseWeights || {},
    suggestion.preferredPhrases
  );
  const avoidMerge = mergeWeightedPhrases(
    avoidPhrases,
    currentStyleProfile.avoidPhraseWeights || {},
    suggestion.avoidPhrases
  );
  const { preferredPhrases: finalPreferredPhrases, avoidPhrases: finalAvoidPhrases } =
    resolvePhraseListConflicts(preferredMerge.phrases, avoidMerge.phrases);

  const nextStyleProfile = { ...currentStyleProfile };
  pushProfileHistory(nextStyleProfile, currentStyleProfile, now);
  nextStyleProfile.summary = summary;
  nextStyleProfile.extractedSummary = summary;
  nextStyleProfile.preferredPhrases = finalPreferredPhrases;
  nextStyleProfile.avoidPhrases = finalAvoidPhrases;
  nextStyleProfile.preferredPhraseWeights = finalPreferredPhrases.reduce((map, phrase) => {
    map[phrase] = preferredMerge.weights[phrase] || 1;
    return map;
  }, {});
  nextStyleProfile.avoidPhraseWeights = finalAvoidPhrases.reduce((map, phrase) => {
    map[phrase] = avoidMerge.weights[phrase] || 1;
    return map;
  }, {});
  nextStyleProfile.feedbackSuggestionAppliedAt = now;
  nextStyleProfile.lastFeedbackSuggestion = suggestion;

  updateProfileRecord(profileId, {
    title: current.title || DEFAULT_PROFILE_TITLE,
    content: current.content || "",
    originalContent: current.originalContent || "",
    sourceType: current.sourceType || "manual",
    scene: current.scene || "",
    identity: current.identity || "",
    preferredPhrases: finalPreferredPhrases,
    avoidPhrases: finalAvoidPhrases,
    styleProfile: nextStyleProfile,
    now,
  });

  // 已经用来更新过总画像的反馈直接删除，不再保留——避免它们一直躺在会话列表里，
  // 也不用再维护 applied_to_profile 这个状态。
  const removeApplied = db.transaction((ids) => {
    const stmt = db.prepare(`DELETE FROM writing_feedback_pool WHERE id = ? AND profileId = ?`);
    ids.forEach((id) => stmt.run(id, profileId));
  });
  removeApplied(idsToMark);

  return mapProfileRecord(getProfileByIdRaw(profileId), { includeSamples: true });
}

function restoreProfileHistory(profileId, savedAt) {
  const current = getProfileByIdRaw(profileId);
  if (!current) {
    throw new Error("未找到写作画像");
  }

  const currentStyleProfile = safeJsonParse(current.styleProfile, {});
  const history = Array.isArray(currentStyleProfile.summaryHistory)
    ? currentStyleProfile.summaryHistory
    : [];
  const target = history.find((item) => String(item.savedAt) === String(savedAt));
  if (!target) {
    throw new Error("未找到该历史版本");
  }

  const now = formatDate(new Date().getTime());
  const remainingHistory = history.filter((item) => String(item.savedAt) !== String(savedAt));
  const currentEntry = buildProfileHistoryEntry(currentStyleProfile, now);
  const nextHistory = [currentEntry, ...remainingHistory].slice(0, PROFILE_HISTORY_LIMIT);
  const finalPreferredPhrases = sanitizePhraseList(target.preferredPhrases || [], {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });
  const finalAvoidPhrases = sanitizePhraseList(target.avoidPhrases || [], {
    maxCount: FEEDBACK_MERGED_PHRASE_MAX_COUNT,
  });

  const nextStyleProfile = {
    ...currentStyleProfile,
    summary: target.summary || "",
    extractedSummary: target.summary || "",
    preferredPhrases: finalPreferredPhrases,
    avoidPhrases: finalAvoidPhrases,
    preferredPhraseWeights: target.preferredPhraseWeights || {},
    avoidPhraseWeights: target.avoidPhraseWeights || {},
    summaryHistory: nextHistory,
  };

  updateProfileRecord(profileId, {
    title: current.title || DEFAULT_PROFILE_TITLE,
    content: current.content || "",
    originalContent: current.originalContent || "",
    sourceType: current.sourceType || "manual",
    scene: current.scene || "",
    identity: current.identity || "",
    preferredPhrases: finalPreferredPhrases,
    avoidPhrases: finalAvoidPhrases,
    styleProfile: nextStyleProfile,
    now,
  });

  return mapProfileRecord(getProfileByIdRaw(profileId), { includeSamples: true });
}

async function handleAppendSample(req, res) {
  const { type, content, url, filePaths, title = "", scene = "", identity = "" } = req.body;

  try {
    const samplePayloads = await extractSamplePayloads({ type, content, url, filePaths });
    if (!samplePayloads.length) {
      return res.send(error500("样本内容不能为空"));
    }

    const profileId = ensureCurrentProfileRecord({
      title,
      scene,
      identity,
    });

    const analyzedPayloads = await Promise.all(
      samplePayloads.map(async (item) => {
        const analysisProfile = await analyzeWritingSample(buildWritingSample(item.content, 8000));
        return {
          ...item,
          analysisProfile,
          analysisStatus: "analyzed",
          analysisUpdateTime: formatDate(new Date().getTime()),
        };
      })
    );

    const insertMany = db.transaction((items) => {
      items.forEach((item) => insertSampleRecord(profileId, item));
    });
    insertMany(analyzedPayloads);

    const indexedSampleCount = await refreshProfileSampleIndex(profileId, {
      title,
      scene,
      identity,
    });
    const profile = mapProfileRecord(getProfileByIdRaw(profileId), { includeSamples: true });

    return res.send(
      success({
        id: profileId,
        title: profile.title,
        sampleCount: profile.samples?.length || 0,
        analyzedSampleCount: analyzedPayloads.length,
        indexedSampleCount,
      })
    );
  } catch (err) {
    console.error("append profile sample failed", err);
    return res.send(error500(err.message || "追加样本失败"));
  }
}

writeStyleServer.post("/add", handleAppendSample);
writeStyleServer.post("/appendSample", handleAppendSample);

writeStyleServer.get("/current", (req, res) => {
  const current = getCurrentProfileRaw();
  res.send(success(mapProfileRecord(current, { includeSamples: true })));
});

writeStyleServer.put("/current", async (req, res) => {
  const { title = "", scene = "", identity = "", preferredPhrases = "", avoidPhrases = "" } =
    req.body;

  try {
    const profileId = ensureCurrentProfileRecord({
      title,
      scene,
      identity,
      manualPreferredPhrases: preferredPhrases,
      manualAvoidPhrases: avoidPhrases,
    });

    const profile = updateManualProfileFields(profileId, {
      title,
      scene,
      identity,
      manualPreferredPhrases: preferredPhrases,
      manualAvoidPhrases: avoidPhrases,
    });

    return res.send(
      success({
        id: profileId,
        title: profile.title,
      })
    );
  } catch (err) {
    console.error("update current profile failed", err);
    return res.send(error500(err.message || "更新画像失败"));
  }
});

writeStyleServer.get("/feedback/sessions", (req, res) => {
  const { profileId, page = 1, pageSize = 10 } = req.query;
  if (!profileId) {
    return res.send(error500("画像 ID 不能为空"));
  }

  const pageNum = Math.max(1, Number(page));
  const sizeNum = Math.max(1, Number(pageSize));
  const { list, total } = listFeedbackSessions(profileId, {
    page: pageNum,
    pageSize: sizeNum,
  });

  res.send(
    success({
      list,
      total,
      page: pageNum,
      pageSize: sizeNum,
    })
  );
});

writeStyleServer.get("/feedback/session/detail", (req, res) => {
  const { profileId, sessionKey } = req.query;
  if (!profileId || !sessionKey) {
    return res.send(error500("画像 ID 或会话标识不能为空"));
  }

  const rows = getFeedbackRowsForSession(profileId, sessionKey);
  if (!rows.length) {
    return res.send(error500("未找到该会话的反馈"));
  }
  res.send(success(rows.map(mapFeedbackDetailRecord)));
});

writeStyleServer.get("/feedback/session/delete", (req, res) => {
  const { profileId, sessionKey } = req.query;
  if (!profileId || !sessionKey) {
    return res.send(error500("画像 ID 或会话标识不能为空"));
  }

  try {
    const rows = getFeedbackRowsForSession(profileId, sessionKey);
    const deleteMany = db.transaction((ids) => {
      const stmt = db.prepare(`DELETE FROM writing_feedback_pool WHERE id = ?`);
      ids.forEach((id) => stmt.run(id));
    });
    deleteMany(rows.map((item) => item.id));
    return res.send(success());
  } catch (err) {
    console.error("delete feedback session failed", err);
    return res.send(error500(err.message || "删除会话反馈失败"));
  }
});

writeStyleServer.post("/feedback/session/suggest", async (req, res) => {
  const { profileId, sessionKey } = req.body || {};
  if (!profileId || !sessionKey) {
    return res.send(error500("画像 ID 或会话标识不能为空"));
  }

  try {
    const result = await buildFeedbackProfileSuggestion(profileId, sessionKey);
    return res.send(success(result));
  } catch (err) {
    console.error("build feedback profile suggestion failed", err);
    return res.send(error500(err.message || "提炼画像建议失败"));
  }
});

writeStyleServer.post("/feedback/session/apply", async (req, res) => {
  const { profileId, sessionKey, feedbackIds, suggestion } = req.body || {};
  if (!profileId || !sessionKey) {
    return res.send(error500("画像 ID 或会话标识不能为空"));
  }

  try {
    const profile = await applyFeedbackProfileSuggestion(profileId, sessionKey, feedbackIds, suggestion);
    return res.send(success(profile));
  } catch (err) {
    console.error("apply feedback profile suggestion failed", err);
    return res.send(error500(err.message || "应用画像建议失败"));
  }
});

writeStyleServer.post("/history/restore", (req, res) => {
  const { profileId, savedAt } = req.body || {};
  if (!profileId || !savedAt) {
    return res.send(error500("画像 ID 或历史版本标识不能为空"));
  }

  try {
    const profile = restoreProfileHistory(profileId, savedAt);
    return res.send(success(profile));
  } catch (err) {
    console.error("restore profile history failed", err);
    return res.send(error500(err.message || "恢复历史版本失败"));
  }
});

writeStyleServer.get("/sample/delete", async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.send(error500("样本 ID 不能为空"));
  }

  try {
    const sample = findProfileSampleRaw(id);
    if (!sample) {
      return res.send(error500("未找到样本"));
    }

    deleteSampleRecord(id);
    const indexedSampleCount = await refreshProfileSampleIndex(sample.profileId);
    const profile = mapProfileRecord(getProfileByIdRaw(sample.profileId), { includeSamples: true });

    return res.send(
      success({
        id,
        profileId: sample.profileId,
        sampleCount: profile.samples?.length || 0,
        indexedSampleCount,
      })
    );
  } catch (err) {
    console.error("delete profile sample failed", err);
    return res.send(error500(err.message || "删除样本失败"));
  }
});

writeStyleServer.get("/list", (req, res) => {
  const { keyWord = "", page = 1, pageSize = 10 } = req.query;
  const pageNum = Math.max(1, Number(page));
  const sizeNum = Math.max(1, Number(pageSize));
  const offset = (pageNum - 1) * sizeNum;
  const like = `%${keyWord}%`;

  const sql = `
    SELECT *
    FROM articles
    WHERE articleType = 'persona'
      AND (
        title LIKE ?
        OR content LIKE ?
        OR scene LIKE ?
        OR identity LIKE ?
      )
    ORDER BY createTime DESC
    LIMIT ? OFFSET ?
  `;
  const countSql = `
    SELECT COUNT(*) AS total
    FROM articles
    WHERE articleType = 'persona'
      AND (
        title LIKE ?
        OR content LIKE ?
        OR scene LIKE ?
        OR identity LIKE ?
      )
  `;

  const list = db.prepare(sql).all(like, like, like, like, sizeNum, offset);
  const { total } = db.prepare(countSql).get(like, like, like, like);

  res.send(
    success({
      list: list.map((item) => mapProfileRecord(item)),
      page: pageNum,
      pageSize: sizeNum,
      total,
    })
  );
});

writeStyleServer.get("/detail/:id", (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.send(error500("画像 ID 不能为空"));
  }

  const item = getProfileByIdRaw(id);
  if (!item) {
    return res.send(error500("未找到写作画像"));
  }

  res.send(success(mapProfileRecord(item, { includeSamples: true })));
});

writeStyleServer.get("/delete", (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.send(error500("画像 ID 不能为空"));
  }

  try {
    getDB().clearWritingSamples(id);
    deleteProfileSamples(id);
    db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
    return res.send(success());
  } catch (err) {
    console.error("删除画像失败", err);
    return res.send(error500(err.message || "删除画像失败"));
  }
});

export default writeStyleServer;
