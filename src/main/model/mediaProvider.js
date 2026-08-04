// 文生图 / 图生视频：阿里云百炼-通义万相(Wanx)客户端。
// DashScope 的这套合成类接口和 chat 用的 OpenAI 兼容模式是两个不同的 base，
// 走异步任务模式：提交任务拿 task_id -> 轮询 -> 拿到结果 url 后下载到本地 uploads 目录，
// 复用 uploadServer 已有的静态托管路由（/uploads/:type/*，:type 支持嵌套子路径，不需要额外开路由）。
import { ConfigManager } from "../config/configmangger.ts";
import { getSystemPath } from "../utils/common";

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1";
// uploadServer 固定监听在这个端口，见 src/main/server/index.ts
const LOCAL_ORIGIN = "http://127.0.0.1:5120";
// AI 生成的图片/视频统一存到 uploads/generated/<type> 下，跟报告编辑器里用户自己上传的素材
// （直接落在 uploads/images|videos|attachments）分开，避免生成的和上传的素材混在同一个文件夹里不好找。
export const GENERATED_DIR = "generated";
// DashScope 是国内直连服务：不能用 proxy:false 之外的默认行为——
// 裸 axios 请求默认会读 HTTP_PROXY/HTTPS_PROXY 环境变量走代理（这套代理只服务于访问海外站点），
// 一旦环境变量里配了代理会导致直连请求被错误转发，出现"200 但空 body"这类诡异失败，
// 这里强制走直连，避免被环境变量里的代理设置影响（见 skills/importSkill.js 里类似的代理说明）。
const NO_PROXY = { proxy: false };

function getMediaAuth() {
  const config = ConfigManager.getInstance().getConfig();
  const apiKey = config.providers?.alibaba?.apiKey;
  if (!apiKey) throw new Error("未配置阿里云百炼 API Key，请到「模型配置 → AI超级员工 → 媒体生成模型」填写");
  return { apiKey, media: config.media || {} };
}

function describeAxiosError(e) {
  const data = e?.response?.data;
  if (data) return typeof data === "string" ? data : (data.message || JSON.stringify(data));
  return e?.message || String(e);
}

async function submitTask(url, apiKey, body) {
  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      timeout: 30000,
      ...NO_PROXY,
    });
    const taskId = res.data?.output?.task_id;
    if (!taskId) throw new Error(`提交任务失败：${JSON.stringify(res.data)}`);
    return taskId;
  } catch (e) {
    throw new Error(`提交生成任务失败：${describeAxiosError(e)}`);
  }
}

async function pollTask(taskId, apiKey, { intervalMs = 3000, maxWaitMs = 180000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    let res;
    try {
      res = await axios.get(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
        ...NO_PROXY,
      });
    } catch (e) {
      throw new Error(`查询生成任务失败：${describeAxiosError(e)}`);
    }
    const output = res.data?.output || {};
    if (output.task_status === "SUCCEEDED") return output;
    if (output.task_status === "FAILED" || output.task_status === "UNKNOWN") {
      throw new Error(`生成任务失败：${output.message || res.data?.message || JSON.stringify(res.data)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("生成任务超时，请稍后重试（可能是排队较久或素材较复杂）");
}

// 把远程结果文件下载到本地 uploads/<subType>，返回本地路径 + 可直接访问的url
async function downloadToUploads(remoteUrl, subType, ext) {
  const dir = path.join(getSystemPath("uploads"), subType);
  fs.ensureDirSync(dir);
  const filename = `wanx-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
  const target = path.join(dir, filename);
  const res = await axios.get(remoteUrl, { responseType: "arraybuffer", timeout: 120000, ...NO_PROXY });
  fs.writeFileSync(target, Buffer.from(res.data));
  return { filePath: target, url: `${LOCAL_ORIGIN}/uploads/${subType}/${filename}` };
}

// 把「本地 uploads 里的文件 / 我们自己域名下的 URL / 外部公网 URL / 本地绝对路径」统一解析成本地文件路径。
// 本机地址（127.0.0.1/localhost）对阿里云来说不可达，所以自己生成的素材一律走本地文件路径读取，不能直接把 url 传出去。
export async function resolveLocalMediaPath(urlOrPath, subType, defaultExt) {
  if (!urlOrPath) throw new Error("素材地址不能为空");
  const str = String(urlOrPath);

  const localMatch = str.match(/^https?:\/\/(127\.0\.0\.1|localhost):5120\/uploads\/(.+)$/);
  if (localMatch) {
    const p = path.join(getSystemPath("uploads"), localMatch[2]);
    if (!fs.existsSync(p)) throw new Error(`本地素材文件不存在：${urlOrPath}`);
    return p;
  }

  if (/^https?:\/\//.test(str)) {
    const dir = path.join(getSystemPath("uploads"), "tmp", subType);
    fs.ensureDirSync(dir);
    let ext = defaultExt;
    try { ext = path.extname(new URL(str).pathname).replace(".", "") || defaultExt; } catch {}
    const target = path.join(dir, `dl-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
    const res = await axios.get(str, { responseType: "arraybuffer", timeout: 60000 });
    fs.writeFileSync(target, Buffer.from(res.data));
    return target;
  }

  if (fs.existsSync(str)) return str;
  throw new Error(`素材文件不存在：${urlOrPath}`);
}

async function imageToBase64DataUri(imagePath) {
  const localPath = await resolveLocalMediaPath(imagePath, "images", "png");
  const buf = fs.readFileSync(localPath);
  const ext = (path.extname(localPath).slice(1).toLowerCase() || "png").replace("jpg", "jpeg");
  return `data:image/${ext};base64,${buf.toString("base64")}`;
}

// DashScope 要求 size 格式是 "宽*高"（星号分隔），模型有时会习惯性传 "宽x高"，这里做一次容错归一化，
// 避免仅仅因为分隔符错误就让整次生成失败重试（实测出现过 "1024x1024" 被拒绝的情况）。
function normalizeImageSize(size) {
  const s = String(size || "").trim().replace(/[xX×]/, "*");
  return /^\d+\*\d+$/.test(s) ? s : "1024*1024";
}

// wanx2.1-t2i-turbo 等老版"文生图"模型（模型名带 x）用 input.prompt + 像素尺寸；
// wan2.x-image-* 等新版"万相"多模态模型（模型名不带 x，如 wan2.7-image-pro）改成了统一的
// input.messages 多模态请求体，size 也换成 1K/2K/4K 档位——两套 body 结构不兼容，
// 拿老格式打新模型，DashScope 内容解析会失败，表现为语焉不详的 "url error, please check url"
// （实测确认：wan2.7-image-pro 用 input.prompt 提交必现此错）。
function isNewWanImageModel(model) {
  return /^wan\d/.test(String(model || "")) && !/^wanx/.test(String(model || ""));
}

function normalizeImageSizeV2(size) {
  const s = String(size || "").trim().toUpperCase();
  if (/^[124]K$/.test(s)) return s;
  const m = String(size || "").match(/(\d+)\s*[*xX×]\s*(\d+)/);
  if (m) {
    const longSide = Math.max(Number(m[1]), Number(m[2]));
    if (longSide <= 1280) return "1K";
    if (longSide <= 2560) return "2K";
    return "4K";
  }
  return "2K";
}

// wan2.6-i2v-flash 的 duration 取值范围是 [2, 15] 整数秒，不传则模型按自己的默认值（5秒）生成——
// 之前代码就是完全没传这个字段，导致用户说要多少秒完全不生效。这里做个容错裁剪，越界值夹到边界而不是报错。
function normalizeDuration(duration, min = 2, max = 15) {
  const n = Math.round(Number(duration));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

// 文生图
export async function generateImageFromText({ prompt, size }) {
  const { apiKey, media } = getMediaAuth();
  const model = media.imageModel || "wanx2.1-t2i-turbo";
  const isV2 = isNewWanImageModel(model);
  // wan2.x 新版模型不光 body 结构变了，服务端点也从老版的 text2image/image-synthesis
  // 换成了 image-generation/generation——两边任何一个用错都会被网关拒掉，报同一个
  // 语焉不详的 "url error, please check url"（实测确认：光改 body 不改端点，一样报这个错）。
  const body = isV2
    ? { model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters: { size: normalizeImageSizeV2(size), n: 1 } }
    : { model, input: { prompt }, parameters: { size: normalizeImageSize(size), n: 1 } };
  const taskId = await submitTask(
    isV2
      ? `${DASHSCOPE_BASE}/services/aigc/image-generation/generation`
      : `${DASHSCOPE_BASE}/services/aigc/text2image/image-synthesis`,
    apiKey,
    body
  );
  const output = await pollTask(taskId, apiKey, { intervalMs: 3000, maxWaitMs: 120000 });
  // wan2.x 新版响应结构是 output.choices[0].message.content[0].image，跟老版 output.results[0].url 不是一回事
  const remoteUrl = isV2
    ? output.choices?.[0]?.message?.content?.find((c) => c.image)?.image
    : output.results?.[0]?.url;
  if (!remoteUrl) throw new Error(`未获取到生成结果：${JSON.stringify(output)}`);
  return downloadToUploads(remoteUrl, `${GENERATED_DIR}/images`, "png");
}

// 图生视频：imagePath 支持本地 uploads 文件 / 我们自己的URL / 外部公网图片URL / 本地绝对路径
export async function generateVideoFromImage({ imagePath, prompt, duration }) {
  const { apiKey, media } = getMediaAuth();
  const model = media.videoModel || "wan2.6-i2v-flash";
  const imgDataUri = await imageToBase64DataUri(imagePath);
  const parameters = { resolution: "720P" };
  const dur = normalizeDuration(duration);
  if (dur) parameters.duration = dur;
  const taskId = await submitTask(
    // 注意：老版 wanx2.1-i2v-* 系列用的 image2video/video-synthesis 端点已废弃，
    // 现在文生视频/图生视频统一走 video-generation/video-synthesis，用 image2video 老端点会报"url error"（实测确认）。
    `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`,
    apiKey,
    { model, input: { img_url: imgDataUri, prompt: prompt || "" }, parameters }
  );
  const output = await pollTask(taskId, apiKey, { intervalMs: 5000, maxWaitMs: 300000 });
  const remoteUrl = output.video_url || output.results?.[0]?.url;
  if (!remoteUrl) throw new Error(`未获取到生成结果：${JSON.stringify(output)}`);
  return downloadToUploads(remoteUrl, `${GENERATED_DIR}/videos`, "mp4");
}

// 首尾帧生视频：给定起始画面 + 结束画面各一张图，模型生成两者之间的过渡视频。
// 用官方文档只说明支持公网URL/oss://，没提base64 data URI；这里先按 img_url 同款套路转 base64 试，
// 是因为它和 generateVideoFromImage 共享同一套 DashScope 网关（虽然端点路径不同），实测若不认再改成走文件上传拿 oss:// 地址。
export async function generateVideoFromFirstLastFrame({ firstImagePath, lastImagePath, prompt, duration }) {
  const { apiKey, media } = getMediaAuth();
  const model = media.kf2vModel || "wan2.2-kf2v-flash";
  const [firstDataUri, lastDataUri] = await Promise.all([
    imageToBase64DataUri(firstImagePath),
    imageToBase64DataUri(lastImagePath),
  ]);
  const parameters = { resolution: "720P" };
  const dur = normalizeDuration(duration);
  if (dur) parameters.duration = dur;
  const taskId = await submitTask(
    `${DASHSCOPE_BASE}/services/aigc/image2video/video-synthesis`,
    apiKey,
    { model, input: { first_frame_url: firstDataUri, last_frame_url: lastDataUri, prompt: prompt || "" }, parameters }
  );
  const output = await pollTask(taskId, apiKey, { intervalMs: 5000, maxWaitMs: 300000 });
  const remoteUrl = output.video_url || output.results?.[0]?.url;
  if (!remoteUrl) throw new Error(`未获取到生成结果：${JSON.stringify(output)}`);
  return downloadToUploads(remoteUrl, `${GENERATED_DIR}/videos`, "mp4");
}

// 参考生视频：最多传5张参考图（角色/场景/道具等），模型把这些元素融合进同一段视频。
// prompt 里用 character1、character2...按传入顺序指代对应第几张参考图。
// duration 范围和 i2v-flash 不一样（官方文档给的是 [2,10]），单独裁剪。
export async function generateVideoFromReferences({ imagePaths, prompt, duration }) {
  const { apiKey, media } = getMediaAuth();
  const model = media.r2vModel || "wan2.6-r2v-flash";
  const list = Array.isArray(imagePaths) ? imagePaths : [];
  if (list.length < 1) throw new Error("至少需要传入1张参考图");
  if (list.length > 5) throw new Error("参考图最多支持5张");
  const referenceUrls = await Promise.all(list.map((p) => imageToBase64DataUri(p)));
  const parameters = { size: "1280*720", audio: false };
  const dur = normalizeDuration(duration, 2, 10);
  if (dur) parameters.duration = dur;
  const taskId = await submitTask(
    `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`,
    apiKey,
    { model, input: { reference_urls: referenceUrls, prompt: prompt || "" }, parameters }
  );
  const output = await pollTask(taskId, apiKey, { intervalMs: 5000, maxWaitMs: 300000 });
  const remoteUrl = output.video_url || output.results?.[0]?.url;
  if (!remoteUrl) throw new Error(`未获取到生成结果：${JSON.stringify(output)}`);
  return downloadToUploads(remoteUrl, `${GENERATED_DIR}/videos`, "mp4");
}
