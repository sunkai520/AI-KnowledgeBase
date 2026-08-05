// 有些"OpenAI 兼容"中转网关在 Responses API 的流式输出里，最终的
// response.completed / response.incomplete 事件中，message 的 content part 会丢失
// annotations 字段（官方协议里必然是数组，至少是 []，这里被中转吞掉变成 undefined）。
// @langchain/openai 的转换器对它无条件 `.map()`，缺了就直接抛异常，导致整轮对话失败
// （实测：同样内容非流式请求没有这个问题，annotations 正常是 []，只有流式的最终事件会丢）。
//
// 这里包一层 fetch，只在检测到 SSE（text/event-stream）响应时逐事件解析、按需补上空数组，
// 其余字节原样透传——不缓冲整个响应，不影响真正的逐 token 流式效果。
export function createResponsesAnnotationFix(baseFetch = fetch) {
  return async function patchedFetch(url, init) {
    const res = await baseFetch(url, init);
    const contentType = res.headers.get("content-type") || "";
    if (!res.body || !contentType.includes("text/event-stream")) return res;
    return new Response(res.body.pipeThrough(createSseAnnotationFixTransform()), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

function fixAnnotationsInResponsePayload(payload) {
  if (!payload || (payload.type !== "response.completed" && payload.type !== "response.incomplete")) return payload;
  const output = payload.response?.output;
  if (!Array.isArray(output)) return payload;
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === "output_text" && part.annotations === undefined) {
        part.annotations = [];
      }
    }
  }
  return payload;
}

function patchSseEventBlock(rawEvent) {
  return rawEvent
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data:")) return line;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") return line;
      try {
        return `data: ${JSON.stringify(fixAnnotationsInResponsePayload(JSON.parse(raw)))}`;
      } catch {
        return line; // 不是合法 JSON，原样返回，不影响其他事件
      }
    })
    .join("\n");
}

// SSE 事件之间用连续两个换行分隔（"\n\n"）；网络分片可能在事件中间断开，
// 用 buffer 攒到一个完整事件再处理，不完整的部分留到下一块继续拼。
function createSseAnnotationFixTransform() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        controller.enqueue(encoder.encode(patchSseEventBlock(rawEvent) + "\n\n"));
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(buffer));
    },
  });
}
