import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import * as z from "zod";
import {
  browserOpen,
  browserScreenshot,
  browserGetText,
  browserGetPageText,
  browserInput,
  browserBack,
  browserState,
  browserClick,
  browserScroll,
  browserWait,
  browserKeys,
  browserClearHighlight,
  browserListTabs,
  browserSwitchTab,
  browserCloseTab,
  browserUploadFile,
  browserHover,
  browserCheckBlocker,
} from "../utils/browser-use";

/**
 * 页面出现验证码或登录墙时暂停任务，等待用户在浏览器窗口中手动处理后再决定如何继续。
 * 验证码和登录一视同仁，检测到就直接中断求助人工，不做自动关闭尝试，也不交给模型自行判断是否需要登录。
 * "switch_method" 时不做任何预设逻辑，只把决定权交还模型，由模型自行选择替代方案。
 */
async function handleBlocker(blocker, refetch, session) {
  const screenshot = await browserScreenshot({ session }).catch(() => null);
  const resumeValue = interrupt({
    kind: "browser_blocked",
    reason: blocker.reason,
    message: blocker.message,
    screenshot,
  });
  const decision = resumeValue?.decisions?.[0];

  if (decision?.type === "switch_method") {
    return `用户选择更换方式处理${blocker.reason === "captcha" ? "验证码" : "登录"}问题，请更换网址/入口等替代方案继续任务，不要重复刚才的操作。`;
  }

  // 默认按"用户已手动处理完成"对待，重新获取最新页面状态返回给模型
  return refetch();
}

// ─── 失败熔断：按"运行(runId) + 动作签名"维度记录连续失败次数 ─────────────────
// 只对会"操作/导航"页面的动作熔断（查询类动作如 state/getText 不熔断，本身就是用来确认现状的）。
// 目的：避免模型对着同一个已经失效的 click/inputText 无限重试而不自知。
const BROWSER_MAX_FAILURES = 3;
const CIRCUIT_ACTIONS = new Set(["openUrl", "click", "inputText", "uploadFile", "hover"]);
// 只有这几个动作之后额外主动探测一次验证码/登录拦截（详见 browser-use.js 的 browserCheckBlocker）
const BLOCKER_CHECK_ACTIONS = new Set(["openUrl", "click", "inputText"]);
const browserFailureTracker = new Map(); // runId -> Map<signature, count>

function actionSignature(session, action, { url, index, text }) {
  return `${session}|${action}|${url || ""}|${index ?? ""}|${(text || "").slice(0, 50)}`;
}

function getFailureCount(runId, signature) {
  return browserFailureTracker.get(runId)?.get(signature) || 0;
}

function incFailureCount(runId, signature) {
  let runMap = browserFailureTracker.get(runId);
  if (!runMap) { runMap = new Map(); browserFailureTracker.set(runId, runMap); }
  runMap.set(signature, (runMap.get(signature) || 0) + 1);
}

function clearFailureCount(runId, signature) {
  browserFailureTracker.get(runId)?.delete(signature);
}

/** 请求/审批恢复开始或结束时调用，清理该次运行的失败计数，避免 Map 无限增长 */
export function clearBrowserFailureTracker(runId) {
  if (runId) browserFailureTracker.delete(runId);
}

// ─── 换源硬阀值：同一次运行访问过的不同网址数超过阈值仍未成功，强制模型停下汇报 ───
// 失败熔断（上面那套）按"动作签名"算，网址不同=签名不同，拦不住"每次都换新网址重试"这种模式；
// 这里换成粗粒度的"访问过的不同网址数"计数作为兜底安全阀。按去重后的网址数算，而不是总调用次数——
// 重新打开一个已经试过的网址（比如页面加载不完整，合理重试同一网址）不算新的换源，不受阈值限制，
// 只有真正打开从未访问过的新网址才计数，避免把"同一网址合理重试"和"无限换新网站瞎试"混为一谈。
const OPENURL_MAX_ATTEMPTS = 8;
const openUrlAttemptTracker = new Map(); // `${runId}|${session}` -> Set<url>（已访问过的不同网址）
// 命中硬阀值后模型不一定第一次就会听话——记一下"这次运行已经被拦过几次"，
// 拦第2次及以后语气升级为强制口吻，减少模型反复横跳（先总结、又忍不住再试）的概率
const openUrlBlockedCount = new Map(); // `${runId}|${session}` -> 被拦截次数

/** 请求/审批恢复开始或结束时调用，清理该次运行（含所有子Agent session）的换源相关计数 */
export function clearOpenUrlAttemptTracker(runId) {
  if (!runId) return;
  const prefix = `${runId}|`;
  for (const key of openUrlAttemptTracker.keys()) {
    if (key.startsWith(prefix)) openUrlAttemptTracker.delete(key);
  }
  for (const key of openUrlBlockedCount.keys()) {
    if (key.startsWith(prefix)) openUrlBlockedCount.delete(key);
  }
}

/**
 * 统一浏览器工具
 * 将 10 个独立工具合并为 1 个，通过 action 参数路由
 * 效果：每次请求工具 schema token 从 ~500 降至 ~100
 */
export const browser = tool(
  async ({ action, url, index, text, direction, key, ms, tabId, newTab, note, filePath, expectedText }, config) => {
    const runId = config?.configurable?.run_id || "anon";
    // 并行子Agent（deepagents 的 task 工具）复用同一个 browser 工具实例，
    // 靠 langchain ToolNode 层层透传下来的 config.config.toolCallId（发起这个子Agent的那次 task 调用自身的 id）
    // 区分"谁在用"：同一子Agent全程不变、不同子Agent必然不同、主Agent自己调用时取不到、安全兜底为 'default'
    const subSession = config?.config?.toolCallId;
    const session = subSession ? `sub-${subSession}` : "default";
    const signature = actionSignature(session, action, { url, index, text });
    const openUrlKey = `${runId}|${session}`;

    if (CIRCUIT_ACTIONS.has(action)) {
      const failCount = getFailureCount(runId, signature);
      if (failCount >= BROWSER_MAX_FAILURES) {
        return `该操作（${action}${url ? `：${url}` : ""}${index !== undefined ? `，index=${index}` : ""}）已连续失败 ${BROWSER_MAX_FAILURES} 次，请勿再重复相同操作。请重新调用 state 确认页面真实状态，或更换网址/入口等替代方案。`;
      }
    }

    // 操作成功后：清掉该签名的失败计数；若属于需要探测拦截的动作，顺带检查一次验证码/登录表单，
    // 命中则走正式中断流程，而不是让模型凭一次模糊的"没反应"自己瞎猜、反复重试
    async function afterSuccess(result) {
      clearFailureCount(runId, signature);
      if (BLOCKER_CHECK_ACTIONS.has(action)) {
        const blocker = await browserCheckBlocker(session).catch(() => null);
        if (blocker) {
          return handleBlocker(
            blocker,
            () => `验证码/登录已处理，原操作（${action}）执行前后页面可能已变化，请重新调用 state 确认当前页面状态后继续。`,
            session
          );
        }
      }
      return result;
    }

    try {
      switch (action) {
        case "openUrl": {
          if (!url) return "错误：openUrl 需要 url 参数";
          let visitedUrls = openUrlAttemptTracker.get(openUrlKey);
          if (!visitedUrls) { visitedUrls = new Set(); openUrlAttemptTracker.set(openUrlKey, visitedUrls); }
          // 重新打开一个已经试过的网址（合理重试）不算新换源，不受阈值限制
          if (!visitedUrls.has(url)) {
            if (visitedUrls.size >= OPENURL_MAX_ATTEMPTS) {
              const blockedTimes = (openUrlBlockedCount.get(openUrlKey) || 0) + 1;
              openUrlBlockedCount.set(openUrlKey, blockedTimes);
              if (blockedTimes === 1) {
                return `本次任务已累计尝试访问 ${visitedUrls.size} 个不同网址仍未顺利获取到所需数据，请不要再继续更换网址/入口。请基于已经获取到的信息直接向用户汇报当前情况（哪些拿到了、哪些没拿到及原因），不要再尝试新的信息来源。`;
              }
              return `【强制停止】你已经被提示过不要再更换网址，但仍然尝试了新网址（${url}）。现在立即停止调用 openUrl，不要再做任何形式的网页访问尝试，直接基于已获取到的数据完成任务总结并回复用户，明确说明哪些平台/信息未能获取成功及原因。`;
            }
            visitedUrls.add(url);
          }
          await browserOpen(url, { headless: false, newTab, note, session });
          return await afterSuccess("打开网页成功");
        }

        case "listTabs":
          return await browserListTabs({ session });

        case "switchTab":
          if (!tabId) return "错误：switchTab 需要 tabId 参数（来自 listTabs 返回的 id）";
          return await browserSwitchTab(tabId, { session });

        case "closeTab":
          if (!tabId) return "错误：closeTab 需要 tabId 参数（来自 listTabs 返回的 id）";
          return await browserCloseTab(tabId, { session });

        case "state": {
          const result = await browserState({ session });
          if (result.blocker) return handleBlocker(result.blocker, () => browserState({ session }), session);
          return result;
        }

        case "screenshot": {
          const dataUrl = await browserScreenshot({ session });
          // 以多模态格式返回，模型可直接"看"截图
          return JSON.stringify([
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: "以上是当前页面截图" }
          ]);
        }

        case "click": {
          if (index === undefined) return "错误：click 需要 index 参数";
          const result = await browserClick(Number(index), { expectedText, session });
          return await afterSuccess(result);
        }

        case "inputText": {
          if (index === undefined) return "错误：inputText 需要 index 参数";
          if (text === undefined) return "错误：inputText 需要 text 参数";
          const result = await browserInput(Number(index), text, { expectedText, session });
          return await afterSuccess(result);
        }

        case "uploadFile": {
          if (index === undefined) return "错误：uploadFile 需要 index 参数";
          if (!filePath) return "错误：uploadFile 需要 filePath 参数（本地文件绝对路径，多文件传数组）";
          const result = await browserUploadFile(Number(index), filePath, { expectedText, session });
          clearFailureCount(runId, signature);
          return result;
        }

        case "hover": {
          if (index === undefined) return "错误：hover 需要 index 参数";
          const result = await browserHover(Number(index), { expectedText, session });
          clearFailureCount(runId, signature);
          return result;
        }

        case "getText":
          if (index === undefined) return "错误：getText 需要 index 参数";
          return await browserGetText(Number(index), { session });

        case "getPageText": {
          const result = await browserGetPageText({ session });
          if (result.blocker) return handleBlocker(result.blocker, () => browserGetPageText({ session }), session);
          return result;
        }

        case "scroll":
          if (!direction) return "错误：scroll 需要 direction 参数（up 或 down）";
          return await browserScroll(direction, { session });

        case "keys":
          if (!key) return "错误：keys 需要 key 参数";
          return await browserKeys(key, { session });

        case "wait": {
          const waitMs = ms && Number.isFinite(Number(ms)) ? String(ms) : "1500";
          await browserWait(waitMs, { session });
          return `已等待 ${waitMs}ms`;
        }

        case "back":
          return await browserBack({ session });

        case "clearHighlight":
          return await browserClearHighlight({ session });

        default:
          return `未知操作：${action}。支持：openUrl/state/screenshot/click/inputText/uploadFile/hover/getText/getPageText/scroll/keys/wait/back/listTabs/switchTab/closeTab`;
      }
    } catch (e) {
      if (CIRCUIT_ACTIONS.has(action)) incFailureCount(runId, signature);
      return `操作失败（${action}）：${e.message}。若涉及元素索引，请重新调用 state 获取最新索引后重试。`;
    }
  },
  {
    name: "browser",
    description:
      "浏览器自动化工具。通过 action 参数选择操作类型：" +
      "openUrl(打开页面，默认在当前 tab 跳转；传 newTab:true 则新开一个 tab。【需要交替核对多个不同网站/平台时，建议给每个平台传 newTab:true 各开一个标签页，用 switchTab 切换查看，" +
      "不要在同一个标签页反复换网址来回覆盖，否则每次都要重新打开才能看到之前的内容】) / state(获取可交互元素列表及页面摘要) / " +
      "getPageText(提取整页正文文本，【需要阅读页面内容时首选此项，如查看搜索结果、新闻、文章等】) / " +
      "getText(提取单个元素的文本) / " +
      "click(点击元素，若点击打开了新 tab 会自动切换过去且保留旧 tab) / inputText(输入文本，支持普通输入框及富文本/contenteditable 编辑器) / " +
      "uploadFile(给指定索引的元素上传本地文件：若该元素本身是 <input type=\"file\">，直接绑定文件；" +
      "若是触发上传的按钮，会在点击后自动接管弹出的系统文件选择框，需传 filePath 为本地文件的绝对路径，多文件传路径数组) / " +
      "hover(将鼠标真实移动到指定元素上触发 :hover 效果，【用于点击那些平时隐藏、只有鼠标悬浮到该行/卡片上才会显示出来的按钮】：" +
      "先 hover 目标所在的行/卡片，重新 state 拿到这时才出现的按钮索引，再 click，不要对着还没出现的按钮直接 click) / " +
      "scroll(滚动页面) / keys(模拟按键) / wait(等待加载) / back(返回上页) / " +
      "screenshot(截图，【注意：仅返回图片文件路径，无法用于阅读文字内容，仅在需要查看页面视觉布局时使用】) / " +
      "clearHighlight(清除页面标注) / " +
      "listTabs(列出当前打开的所有 tab 及各自用途备注) / switchTab(切换到指定 tab，需要 tabId) / closeTab(关闭指定 tab，需要 tabId)。" +
      "【重要】index 是每次 state 重新扫描页面后临时分配的编号，只要页面发生任何变化（哪怕跟目标元素无关，比如信息流加载了新内容）" +
      "后续所有 index 都可能整体错位；click/inputText/uploadFile/hover 都建议附带 expectedText 参数（该元素在最近一次 state/截图里看到的文字），" +
      "系统会先核对当前该索引下的元素文字是否仍然一致，不一致会直接报错提示重新 state，避免默默点错。",
    schema: z.object({
      action: z
        .enum(["openUrl", "state", "screenshot", "click", "inputText", "uploadFile", "hover", "getText", "getPageText", "scroll", "keys", "wait", "back", "clearHighlight", "listTabs", "switchTab", "closeTab"])
        .describe("操作类型"),
      url:       z.string().optional().describe("openUrl 时必填：目标网址"),
      index:     z.number().optional().describe("click / inputText / uploadFile / hover / getText 时必填：来自 state 返回的元素索引"),
      text:      z.string().optional().describe("inputText 时必填：要输入的文本"),
      filePath:  z.union([z.string(), z.array(z.string())]).optional().describe("uploadFile 时必填：本地文件的绝对路径，多文件传字符串数组"),
      expectedText: z.string().optional().describe("click / inputText / uploadFile / hover 时可选但推荐：预期该索引元素上的文字（来自最近一次 state），用于二次核对索引是否仍然有效，不一致会报错而不是默默点错"),
      direction: z.enum(["up", "down"]).optional().describe("scroll 时必填：滚动方向"),
      key:       z.string().optional().describe("keys 时必填：按键名，如 Escape、Enter、Control+a"),
      ms:        z.number().optional().describe("wait 时可选：等待毫秒数，默认 1500"),
      tabId:     z.string().optional().describe("switchTab / closeTab 时必填：来自 listTabs 返回的 tab id"),
      newTab:    z.boolean().optional().describe("openUrl 时可选：true 表示新开一个 tab 而不是在当前 tab 跳转，默认 false"),
      note:      z.string().optional().describe("openUrl 时可选：给这个 tab 记录一句用途说明，便于之后 listTabs 时识别，不传则用页面标题兜底"),
    }),
  }
);
