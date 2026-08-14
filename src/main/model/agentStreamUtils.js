// chatServer 和 textServer 消费 agent.stream() 输出时共用的纯函数。
// 之前这两块逻辑在两个文件里各自维护了一份（textServer 里甚至专门写注释要求手动保持同步），
// 抽到这里之后只有一份真源，避免以后改了一处忘了改另一处。

// message.content 平时（Chat Completions 协议）是纯字符串；但走 Responses API 时（比如触发了
// 原生联网搜索），@langchain/openai 会把它转成内容块数组 [{type:"text", text:"...", annotations:[]}]。
// 这里统一抹平成字符串，避免下游 str += content / 推给前端的逻辑（按字符串写的）拼出 "[object Object]"。
export function extractTextContent(content) {
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

// 把一条 ToolMessage（webSearch/searchLocalKB/parseWebPage 的结果）转成推给前端展示用的事件对象；
// 不是这三种工具、或者内容解析/结构不符合预期时返回 null，调用方直接跳过即可。
export function buildToolResultEvent(toolName, content) {
  if (toolName !== "webSearch" && toolName !== "searchLocalKB" && toolName !== "parseWebPage") {
    return null;
  }
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch (e) {
    return null;
  }
  if (toolName === "webSearch" && parsed?.results?.length) {
    return { type: "tool_result", toolName: "webSearch", results: parsed.results };
  }
  if (toolName === "searchLocalKB" && parsed?.results?.length) {
    return { type: "tool_result", toolName: "searchLocalKB", results: parsed.results };
  }
  if (toolName === "parseWebPage" && parsed?.success) {
    return {
      type: "tool_result",
      toolName: "parseWebPage",
      parseResult: { title: parsed.title, url: parsed.url, markdown: parsed.markdown },
    };
  }
  return null;
}
