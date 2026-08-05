// model/listModels.js
// 通过 OpenAI 兼容协议的 GET {baseUrl}/models 拉取厂商可用模型列表，供模型配置页下拉展示。
const axios = require("axios");

/**
 * @param {{ baseUrl: string, apiKey: string }} params
 * @returns {Promise<string[]>} 模型 id 列表（已排序）
 */
export async function listModels({ baseUrl, apiKey }) {
  if (!baseUrl) throw new Error("缺少 baseUrl");
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  const res = await axios.get(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    timeout: 10000,
  });
  const list = res.data?.data || res.data?.models || [];
  return list
    .map((m) => (typeof m === "string" ? m : m.id || m.model))
    .filter(Boolean)
    .sort();
}
