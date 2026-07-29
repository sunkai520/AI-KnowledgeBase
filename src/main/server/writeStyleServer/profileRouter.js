// @ts-ignore
import { success, error500 } from "../responseFn";
import { formatDate } from "../../utils/common";
import { doc } from "../../utils/document";
import { HumanMessage, SystemMessage } from "langchain";
import { getDB } from "../../utils/getDb";
import { ModelFactory } from "../../model/modelFactory";
import { writeProfilePrompt } from "../../model/prompt";
import * as z from "zod";

const db = new Proxy({}, { get: (_, prop) => getDB().db[prop] });
const express = require("express");
const writeStyleServer = express.Router();

const StyleProfileSchema = z.object({
  title: z.string().describe("文章标题"),
  content: z.string().describe("100字以内的文章摘要"),
  preferredPhrases: z.array(z.string()).describe("作者常见表达习惯或高频措辞"),
  avoidPhrases: z.array(z.string()).describe("作者应避免的表达、套话或AI味用语"),
  styleProfile: z.string().describe("可直接用于后续模仿写作的完整个人写作画像"),
});

function normalizeSourceType(type) {
  if (String(type) === "1") return "upload";
  if (String(type) === "2") return "manual";
  if (String(type) === "3") return "website";
  return "manual";
}

function parsePhraseInput(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergePhrases(...groups) {
  const result = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of group || []) {
      const value = String(item || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function buildWritingSample(content = "", limit = 1200) {
  const normalized = String(content).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

async function loadDocContent(filePath) {
  const docObj = new doc({
    docPath: filePath,
    chunkSize: 15000,
  });
  const text = await docObj.loader.load();
  return text.map((item) => item.pageContent).join("\n");
}

async function extractOriginalContent({ type, content, url, filePaths }) {
  if (String(type) === "1") {
    if (!filePaths || filePaths.length === 0) {
      throw new Error("filePaths不能为空");
    }
    const contents = await Promise.all(
      filePaths.map((file) => loadDocContent(file.filePath))
    );
    return contents.filter(Boolean).join("\n\n");
  }

  if (String(type) === "2") {
    return String(content || "").trim();
  }

  if (String(type) === "3") {
    return await loadDocContent(url);
  }

  return "";
}

function safeJsonParse(value, fallback = []) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

writeStyleServer.post("/add", async (req, res) => {
  const {
    type,
    content,
    url,
    filePaths,
    scene = "",
    identity = "",
    preferredPhrases = "",
    avoidPhrases = "",
  } = req.body;

  try {
    const originalContent = await extractOriginalContent({ type, content, url, filePaths });
    if (!originalContent) {
      return res.send(error500("内容不能为空"));
    }

    const model = ModelFactory.getChatModel({ isNew: true });
    const modelWithStructure = model.withStructuredOutput(StyleProfileSchema);
    const profile = await modelWithStructure.invoke([
      new SystemMessage(writeProfilePrompt),
      new HumanMessage(originalContent),
    ]);

    const manualPreferred = parsePhraseInput(preferredPhrases);
    const manualAvoid = parsePhraseInput(avoidPhrases);
    const mergedPreferred = mergePhrases(manualPreferred, profile.preferredPhrases);
    const mergedAvoid = mergePhrases(manualAvoid, profile.avoidPhrases);
    const now = formatDate(new Date().getTime());
    const sourceType = normalizeSourceType(type);
    const styleProfile = {
      summary: profile.styleProfile,
      preferredPhrases: mergedPreferred,
      avoidPhrases: mergedAvoid,
      extractedAt: now,
    };

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

    const result = stmt.run(
      profile.title,
      profile.content,
      originalContent,
      sourceType,
      String(scene || "").trim(),
      String(identity || "").trim(),
      JSON.stringify(mergedPreferred),
      JSON.stringify(mergedAvoid),
      JSON.stringify(styleProfile),
      "persona",
      now,
      now
    );

    return res.send(success({
      id: result.lastInsertRowid,
      title: profile.title,
    }));
  } catch (err) {
    return res.send(error500(err.message || "生成失败"));
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
    WHERE title LIKE ?
       OR content LIKE ?
       OR scene LIKE ?
       OR identity LIKE ?
    ORDER BY createTime DESC
    LIMIT ? OFFSET ?
  `;
  const countSql = `
    SELECT COUNT(*) AS total
    FROM articles
    WHERE title LIKE ?
       OR content LIKE ?
       OR scene LIKE ?
       OR identity LIKE ?
  `;

  const list = db.prepare(sql).all(like, like, like, like, sizeNum, offset);
  const { total } = db.prepare(countSql).get(like, like, like, like);

  const normalizedList = list.map((item) => {
    const preferred = safeJsonParse(item.preferredPhrases, []);
    const avoid = safeJsonParse(item.avoidPhrases, []);
    const styleProfile = safeJsonParse(item.styleProfile, {});
    return {
      ...item,
      preferredPhrases: preferred,
      avoidPhrases: avoid,
      styleProfile,
      samplePreview: buildWritingSample(item.originalContent),
    };
  });

  res.send(success({
    list: normalizedList,
    page: pageNum,
    pageSize: sizeNum,
    total,
  }));
});

writeStyleServer.get("/delete", (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.send(error500("id不能为空"));
  }
  db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
  res.send(success());
});

export default writeStyleServer;
