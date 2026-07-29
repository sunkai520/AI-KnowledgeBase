import { ModelFactory } from "../../model/modelFactory";
import { doc } from "../../utils/document";
import { getDB } from "../../utils/getDb";
import { extractSearchTokens, mergeVectorAndKeywordResults } from "../../utils/searchTokens";

const DEFAULT_TOP_K = 4;
const INDEX_CHUNK_SIZE = 900;
const INDEX_CHUNK_OVERLAP = 120;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(list = [], limit = 16) {
  const result = [];
  const seen = new Set();
  for (const item of list) {
    const value = normalizeText(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export { extractSearchTokens };

function buildChunkKeywords(chunkText = "", extraContext = {}) {
  const contextText = [
    extraContext.title,
    extraContext.scene,
    extraContext.identity,
    ...(extraContext.preferredPhrases || []),
    ...(extraContext.avoidPhrases || []),
  ]
    .filter(Boolean)
    .join(" ");
  return uniqueStrings(
    extractSearchTokens(`${chunkText} ${contextText}`, 24),
    24
  ).join(" ");
}

function getKeywordCandidates(profileId, query = "", topK = DEFAULT_TOP_K) {
  const tokens = extractSearchTokens(query, 8);
  if (!tokens.length) return [];

  const scoreParts = [];
  const whereParts = [];
  const scoreParams = [];
  const whereParams = [];

  for (const token of tokens) {
    const likeValue = `%${token}%`;
    scoreParts.push(`CASE WHEN chunkText LIKE ? OR keywords LIKE ? THEN 1 ELSE 0 END`);
    scoreParams.push(likeValue, likeValue);
    whereParts.push(`chunkText LIKE ? OR keywords LIKE ?`);
    whereParams.push(likeValue, likeValue);
  }

  const sql = `
    SELECT id, chunkText, profileId, chunkIndex, keywords,
      (${scoreParts.join(" + ")}) AS keywordScore
    FROM writingSampleEmbeddings
    WHERE profileId = ?
      AND (${whereParts.join(" OR ")})
    ORDER BY keywordScore DESC, chunkIndex ASC
    LIMIT ?
  `;

  return getDB().db.prepare(sql).all(
    ...scoreParams,
    profileId,
    ...whereParams,
    Math.max(topK, DEFAULT_TOP_K)
  );
}

export async function indexProfileWritingSamples(profileId, originalContent, extraContext = {}) {
  const cleanProfileId = Number(profileId);
  const sourceText = normalizeText(originalContent);
  if (!cleanProfileId || !sourceText) {
    return { count: 0 };
  }

  const splitter = new doc({
    chunkSize: INDEX_CHUNK_SIZE,
    chunkOverlap: INDEX_CHUNK_OVERLAP,
  });
  const rawChunks = await splitter.textSplitter.splitText(sourceText);
  const chunks = uniqueStrings(rawChunks.map((item) => normalizeText(item)), 200);
  const vectorDb = getDB();

  vectorDb.clearWritingSamples(cleanProfileId);
  if (!chunks.length) {
    return { count: 0 };
  }

  const embeddingModel = ModelFactory.getEmbeddingModel();
  const embeddings = await embeddingModel.embedDocuments(chunks);
  const insertRows = chunks.map((chunkText, index) => ({
    embedding: embeddings[index],
    chunkText,
    chunkIndex: index,
    keywords: buildChunkKeywords(chunkText, extraContext),
  }));

  const insertMany = vectorDb.db.transaction((rows) => {
    for (const row of rows) {
      vectorDb.insertWritingSample(
        row.embedding,
        row.chunkText,
        cleanProfileId,
        row.chunkIndex,
        row.keywords
      );
    }
  });

  insertMany(insertRows);
  vectorDb.quantizeWritingSamples();
  return { count: insertRows.length };
}

export async function searchProfileWritingSamples({
  profileId,
  query,
  topK = DEFAULT_TOP_K,
  minScore = 0,
  fallbackContent = "",
  profileContext = {},
}) {
  const cleanProfileId = Number(profileId);
  const normalizedQuery = normalizeText(query);
  if (!cleanProfileId || !normalizedQuery) return [];

  const vectorDb = getDB();
  if (!vectorDb.countWritingSamples(cleanProfileId) && normalizeText(fallbackContent)) {
    await indexProfileWritingSamples(cleanProfileId, fallbackContent, profileContext);
  }

  let vectorRows = [];
  try {
    const embeddingModel = ModelFactory.getEmbeddingModel();
    const queryEmbedding = await embeddingModel.embedQuery(normalizedQuery);
    vectorRows = vectorDb.searchWritingSamples(
      queryEmbedding,
      cleanProfileId,
      Math.max(topK * 2, 8)
    );
  } catch (error) {
    console.error("searchProfileWritingSamples vector search failed", error);
  }

  const keywordRows = getKeywordCandidates(
    cleanProfileId,
    normalizedQuery,
    Math.max(topK * 2, 8)
  );

  return mergeVectorAndKeywordResults(vectorRows, keywordRows, Math.max(topK * 2, topK))
    .filter((item) => Number(item.score || 0) >= Number(minScore || 0))
    .slice(0, topK);
}
