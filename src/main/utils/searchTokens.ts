// 分词 + 关键词提取 + 向量/关键词混合检索的公共工具
// 供 通用知识库检索(model/tools.js) 和 写作风格样本检索(writeStyleServer/profileSampleSearch.js) 共用
//@ts-ignore
import { Jieba, TfIdf } from "@node-rs/jieba";
//@ts-ignore
import { dict, idf } from "@node-rs/jieba/dict";

const jieba = Jieba.withDict(dict);
const tfidf = TfIdf.withDict(idf);

// 常见中文虚词/代词/疑问词：分词后仍是完整词的部分（单字的“我/你/的/了”已经会被 minKeywordLength 过滤掉，这里补的是2字以上的）
const ZH_STOPWORDS = new Set([
  "我们", "你们", "他们", "她们", "它们", "自己", "咱们",
  "这个", "那个", "这些", "那些", "这样", "那样", "这里", "那里", "这儿", "那儿",
  "什么", "怎么", "怎样", "为什么", "哪个", "哪些", "哪儿", "哪里", "多少",
  "因为", "所以", "如果", "虽然", "但是", "不过", "而且", "并且", "或者", "还是",
  "可以", "能够", "应该", "需要", "必须", "一定", "可能", "也许", "大概",
  "一个", "一些", "一下", "一直", "一起", "一样",
  "现在", "已经", "正在", "开始", "继续", "以及", "关于", "对于", "根据",
  "进行", "通过", "由于", "然后", "然而", "所有", "非常", "比较", "有点",
  "知道", "觉得", "希望", "帮我", "帮忙", "麻烦", "谢谢", "请问", "请帮",
]);

// 注意：这个 napi 版本的 setConfig 传 stopWords 会直接抛错（Failed to convert JavaScript value
// `Undefined` into rust type `String`），实测确认过，所以停用词过滤放在下面 JS 侧做，这里只配置能正常工作的两项
tfidf.setConfig({
  minKeywordLength: 2,
  useHmm: true,
});

function normalizeText(value = ""): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 用 TF-IDF 从文本中抽取检索用的关键词 token。
 * IDF 权重会天然压低“我的/你的/这个”这类高频虚词的排名，再叠加显式停用词表兜底。
 */
export function extractSearchTokens(text = "", limit = 12): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  let keywords: Array<{ keyword: string; weight: number }> = [];
  try {
    keywords = tfidf.extractKeywords(jieba, normalized, limit);
  } catch (err) {
    console.error("extractSearchTokens failed", err);
    return [];
  }

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const { keyword } of keywords) {
    const token = normalizeText(keyword).toLowerCase();
    if (!token || token.length < 2 || seen.has(token)) continue;
    if (ZH_STOPWORDS.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= limit) break;
  }
  return tokens;
}

type MergeRow = {
  id: number | string;
  distance?: number;
  keywordScore?: number;
  chunkIndex?: number;
  [key: string]: any;
};

/**
 * 融合向量检索结果和关键词检索结果：
 * - vectorScore = 1 - cosine距离
 * - keywordScore 按候选集里的最大值做 min-max 归一化，和 vectorScore 量纲对齐
 * - 最终分 = vectorScore * vectorWeight + keywordScore * keywordWeight
 */
export function mergeVectorAndKeywordResults(
  vectorRows: MergeRow[] = [],
  keywordRows: MergeRow[] = [],
  topK = 5,
  { vectorWeight = 0.72, keywordWeight = 0.28 } = {}
) {
  const merged = new Map<string | number, any>();

  const upsert = (row: MergeRow, partialScore: { vectorScore?: number; keywordScore?: number }) => {
    if (row?.id === undefined || row?.id === null) return;
    const current = merged.get(row.id) || {
      ...row,
      vectorScore: 0,
      keywordScore: 0,
      score: 0,
    };
    current.vectorScore = Math.max(current.vectorScore, partialScore.vectorScore || 0);
    current.keywordScore = Math.max(current.keywordScore, partialScore.keywordScore || 0);
    current.score = current.vectorScore * vectorWeight + current.keywordScore * keywordWeight;
    merged.set(row.id, current);
  };

  for (const row of vectorRows) {
    const distance = Number(row.distance ?? 1);
    upsert(row, { vectorScore: Math.max(0, 1 - distance) });
  }

  const maxKeywordScore = Math.max(1, ...keywordRows.map((row) => Number(row.keywordScore || 0)));
  for (const row of keywordRows) {
    upsert(row, { keywordScore: Number(row.keywordScore || 0) / maxKeywordScore });
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0);
    })
    .slice(0, topK);
}
