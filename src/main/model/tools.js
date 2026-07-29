import {
  tool
} from "@langchain/core/tools";
import * as z from "zod";
import {
  getDB
} from "../utils/getDb";

import {
  ModelFactory
} from './modelFactory.ts';
import {
  MultiServerMCPClient
} from "@langchain/mcp-adapters";
import { ConfigManager } from '../config/configmangger.ts';
// @ts-ignore
import {
  setLog
} from "../event/index"
//@ts-ignore
import {
  extractUrls,
  parsePage
} from '../modelTools/web-parser';
//@ts-ignore
import {
  webSearch,
  deepSearch,
  quickSearch
} from '../modelTools/search-engine';
import documentGenerator from "../server/docServer/documentGenerator";
import ScriptExecutor from "../skills/executor";
import Shell from "../skills/shell-tool"
import { extractSearchTokens, mergeVectorAndKeywordResults } from "../utils/searchTokens";

//执行shell命令行
export const executeShell = tool(
  async (command) => {
    let rr = await Shell.exec(command);
    console.log("执行命令行工具获取到的结果", rr)
    if (rr.success) {
      return `执行命令为:${command},执行结果为:${rr.stdout}`;
    } else {
      return `执行命令为:${command},执行报错:${rr.stdout}`;
    }
  }, {
    name: "executeShell",
    description: "执行本机shell命令行",
    schema: z.string().describe("shell命令"),
  }
)
//执行nodejs脚本
export const executeScript = tool(
  async ({
    script_path,
    args
  }) => {
    console.log("入参", args)
    let rr = await ScriptExecutor.execute({
      script_path: script_path,
      args: args
    });
    console.log("执行nodejs脚本获取到的结果", rr)
    return rr
  }, {
    name: "executeScript",
    description: "执行nodejs脚本",
    schema: z.object({
      script_path: z.string().describe("脚本路径"),
      args: z.array(z.string()).optional().describe("脚本参数"),
    }),
  }
)

//深度解析网站
export const parseWebPage = tool(
  parsePage, {
    name: "parseWebPage",
    description: "需要进一步了解网站详细内容时调用",
    schema: z.string().describe("网页的 URL")
  }
)
//本地知识库搜索
export const searchLocalKB = tool(
  searchRags, {
    name: "searchLocalKB",
    description: "在本地知识库中搜索与问题最相关的内容",
    schema: z.object({
      query: z.string().describe("用户的问题"),
      topK: z.number().optional(),
    }),
  }
);
//生成word||pdf
export const generateWordTool = tool(
  async ({
    markdown,
    filename,
    format,
    options
  }) => {
    console.log({
      markdown,
      filename,
      format,
      options
    }, "参数");
    let result = await documentGenerator.generate(markdown, format, filename, options);
    if (!result.success) {
      return "生成文件失败。"
    }
    console.log(result, "文件已生成");
    // 构建下载 URL（复用你现有的 5120 端口）
    const downloadUrl = `文档下载的url=http://127.0.0.1:5120/doc/download/${result.filename}`;
    return downloadUrl
  }, {
    name: "generateWord",
    description: "文档或者报告生成工具。支持5种模板风格，通过 options.templateId 指定：business(商务蓝，默认)、report(报告红/仿宋/双倍行距)、simple(简约灰/宋体)、academic(学术深蓝/双倍行距)、intel(情报琥珀)。用户若未明确说明风格，使用当前已选模板（由系统提示词指定）。",
    schema: z.object({
      markdown: z.string().describe("markdown"),
      filename: z.string().optional().describe("文件名"),
      format: z.string().describe("文件格式,目前只支持只接受参数 word || pdf"),
      options: z.object({
        title: z.string().optional(),
        templateId: z.enum(['business', 'report', 'simple', 'academic', 'intel']).optional().describe("模板风格，不传则使用系统当前选中模板")
      }).optional()
    }),
  }
)


const axios = require('axios');
export const searchByOnLine = tool(
  ({ query, limit, engine }) => webSearch({ query, limit, options: { engine: engine || 'baidu' } }),
  {
    name: "webSearch",
    description: "在网络中搜索与问题最相关的内容。若用户明确指定了搜索引擎，必须将其映射到 engine 参数传入。重要：当返回结果提示触发了安全验证/验证码（success 为 false 且 error 含’安全验证’）时，请按提示改用其他搜索引擎重试一次，切勿用同一个引擎反复重试。bing 优先级最低，仅在其他引擎都不可用时才作为最后兜底使用。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      limit: z.number().optional().describe("返回结果数量，默认5"),
      engine: z.enum(['bing', 'google', 'baidu', 'duckduckgo', 'sogou'])
               .optional()
               .describe("搜索引擎：用户说'谷歌'传 google，说'百度'传 baidu，说'必应'传 bing，说'DuckDuckGo'传 duckduckgo，说'搜狗'传 sogou，未指定传 baidu。bing 优先级最低，不要在未指定或非 bing 相关请求时主动选用。"),
    }),
  }
);

// 工厂：创建带「调用次数上限」的联网搜索工具。每个请求实例化一次，用闭包计数：
//  - calls   累计总调用数，达到 maxCalls 后停止（不管成功失败，防止模型一直换词反复搜）
//  - failures 累计失败数(空结果/验证码/异常)，达到 maxFailures 后停止（防止死循环重试）
// 两个上限任一触发都直接返回获取失败，终止模型继续调用
export function createSearchTool(maxCalls = 5, maxFailures = 3) {
  let calls = 0;
  let failures = 0;
  const limitMsg = (reason) => ({
    success: false,
    results: [],
    error: `联网搜索${reason}，已达本次对话上限，获取失败。请不要再调用联网搜索，改为基于已有信息作答，或如实告知用户暂时无法联网获取该信息。`,
  });
  return tool(
    async ({ query, limit, engine }) => {
      if (calls >= maxCalls) return limitMsg(`已调用 ${maxCalls} 次`);
      if (failures >= maxFailures) return limitMsg(`连续 ${maxFailures} 次未获取到数据`);
      calls++;
      const res = await webSearch({ query, limit, options: { engine: engine || 'baidu' } });
      const ok = res && res.success && Array.isArray(res.results) && res.results.length > 0;
      if (!ok) {
        failures++;
        if (failures >= maxFailures) return limitMsg(`连续 ${maxFailures} 次未获取到数据`);
      }
      return res;
    },
    {
      name: "webSearch",
      description: "在网络中搜索与问题最相关的内容。若用户明确指定了搜索引擎，必须将其映射到 engine 参数传入。重要：当返回结果提示触发了安全验证/验证码（success 为 false 且 error 含’安全验证’）时，请按提示改用其他搜索引擎重试一次，切勿用同一个引擎反复重试。bing 优先级最低，仅在其他引擎都不可用时才作为最后兜底使用。",
      schema: z.object({
        query: z.string().describe("搜索关键词"),
        limit: z.number().optional().describe("返回结果数量，默认5"),
        engine: z.enum(['bing', 'google', 'baidu', 'duckduckgo', 'sogou'])
                 .optional()
                 .describe("搜索引擎：用户说'谷歌'传 google，说'百度'传 baidu，说'必应'传 bing，说'DuckDuckGo'传 duckduckgo，说'搜狗'传 sogou，未指定传 baidu。bing 优先级最低，不要在未指定或非 bing 相关请求时主动选用。"),
      }),
    }
  );
}

export const getWeather = tool(
  (input) => `It's sunny in ${input.location}.`, {
    name: "get_weather",
    description: "Get the weather at a location.",
    schema: z.object({
      location: z.string().describe("The location to get the weather for"),
    }),
  },
);

// 关键词候选召回：直接在知识库chunk原文(label)上做LIKE匹配，用于跟向量召回融合，弥补向量检索对专有名词/编号不敏感的问题
function getKnowledgeKeywordCandidates(db, tokens = [], topK = 10) {
  if (!tokens.length) return [];

  const scoreParts = [];
  const whereParts = [];
  const scoreParams = [];
  const whereParams = [];

  for (const token of tokens) {
    const likeValue = `%${token}%`;
    scoreParts.push(`CASE WHEN label LIKE ? THEN 1 ELSE 0 END`);
    scoreParams.push(likeValue);
    whereParts.push(`label LIKE ?`);
    whereParams.push(likeValue);
  }

  const sql = `
    SELECT id, label, relateId,
      (${scoreParts.join(" + ")}) AS keywordScore
    FROM embdingTable
    WHERE ${whereParts.join(" OR ")}
    ORDER BY keywordScore DESC
    LIMIT ?
  `;

  return db.db.prepare(sql).all(...scoreParams, ...whereParams, topK);
}

export async function searchRags({
  query,
  topK = 5
}) {
  const db = getDB();
  // 1. 向量召回：生成 query embedding，SQLite-Vector 相似度搜索（多召回一些候选，留给关键词融合排序）
  const embedding = await ModelFactory.getEmbeddingModel().embedQuery(query);
  const vectorRows = db.search(embedding, Math.max(topK * 2, 10));
  // 2. 关键词召回：用 TF-IDF 分词提取 query 关键词，兜底向量检索漏掉的专有名词/编号类精确匹配
  const tokens = extractSearchTokens(query, 8);
  const keywordRows = getKnowledgeKeywordCandidates(db, tokens, Math.max(topK * 2, 10));
  // 3. 融合：score = vectorScore*0.72 + keywordScore*0.28，两路互相兜底
  const merged = mergeVectorAndKeywordResults(vectorRows, keywordRows, topK);
  // 融合分数阈值：低于此分视为不相关，既不喂模型也不展示；全部低于阈值时返回未找到（双开模式下可触发联网兜底）
  const MIN_SCORE = 0.45;
  const relevant = merged.filter((r) => r.score >= MIN_SCORE);
  if (!relevant.length) {
    return "本地知识库中没有找到相关内容。";
  }
  // 4. 关联来源文档名，拼成结构化结果（与 webSearch 一致：前端可渲染卡片，模型同样可读）
  const results = relevant.map((r, i) => {
    let source = "";
    try {
      const t = db.db.prepare(`SELECT fileName, title FROM texts WHERE id = ?`).get(r.relateId);
      source = (t && (t.title || t.fileName)) || "";
    } catch (e) { /* 来源解析失败忽略 */ }
    return {
      index: i + 1,
      content: r.label,
      source,
      // 融合分数(0~1)转成百分比展示，语义上不再是单纯的余弦相似度，而是向量+关键词的综合相关度
      similarity: Math.max(0, Math.min(100, Math.round(r.score * 100))),
    };
  });
  return JSON.stringify({ results });
}
// 获取在线工具mcp
export async function getOnlinesTools() {
  const toolBaseUrl = process.env.OPENAI_TOOL_BASE_URL
  if (!toolBaseUrl) return []

  // apiKey 从用户配置的 providers 中读取（工具地址是 Dashscope，使用 alibaba key）
  const config = ConfigManager.getInstance().getConfig()
  const toolApiKey = config.providers?.alibaba?.apiKey || ''

  setLog(`${toolBaseUrl} 工具，key: ${toolApiKey ? '已配置' : '未配置'}`)
  if (!toolApiKey) return []

  const client = new MultiServerMCPClient({
    "WebSearch": {
      transport: "sse",
      url: toolBaseUrl,
      "headers": {
        "Authorization": `Bearer ${toolApiKey}`
      }
    }
  });
  const tools = await client.getTools();
  return tools;
}
export const toolsMaps = {
  "searchLocalKB": "本地知识库",
  "webSearch": "联网搜索",
  "bailian_web_search": "MCP联网搜索",
  "parseWebPage": "网站解析",
  "generateWord": "生成文档"
}
