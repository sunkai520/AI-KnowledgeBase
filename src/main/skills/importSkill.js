import { getSystemPath } from "../utils/common";
import { parseSkillMd } from "../model/agentTools";
import { SettingManager } from "../utils/settingManager";
import { getEffectiveProxyMode } from "../utils/proxyConfig";

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

// 系统设置里配的代理（直连/全局代理/PAC）只作用于 Electron session（浏览器自动化那条链路），
// 对这里用的裸 axios 请求没有任何影响；这里单独按同一份设置接一个代理 agent，
// 否则国内环境下访问 GitHub 大概率直连失败或被限流（404/429）。
// PAC 模式没法照搬浏览器按域名分流的逻辑，这里退化为把 PAC 的代理地址当全局代理用——
// 反正这些请求本来就是访问 GitHub，海外域名走代理是对的。
function getProxyAgent() {
  try {
    const settings = SettingManager.getInstance().getAll();
    const mode = getEffectiveProxyMode(settings);
    const proxyUrl = String(settings.proxyUrl || "").trim();
    if (mode === "direct" || !proxyUrl) return null;
    const normalized = /^[a-z0-9]+:\/\//i.test(proxyUrl) ? proxyUrl : `http://${proxyUrl}`;
    return /^socks/i.test(normalized) ? new SocksProxyAgent(normalized) : new HttpsProxyAgent(normalized);
  } catch {
    return null;
  }
}

function axiosProxyOptions() {
  const agent = getProxyAgent();
  if (!agent) return {};
  return { httpAgent: agent, httpsAgent: agent, proxy: false };
}

const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// 2MB/300 个文件：按 anthropics/skills 官方仓库实测校准（docx 61 个文件约 1.1MB、
// pptx 59 个约 1.1MB、xlsx 54 个），60 个文件的老上限连官方 docx skill 都放不进去，
// 真正该防的是"体积失控"，文件数上限只是兜底，给足够宽松的余量
const MAX_IMPORT_TOTAL_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_IMPORT_FILES = 300;
const SCRIPT_EXT_RE = /\.(js|mjs|cjs|py|sh|ps1)$/i;
const TEXT_EXT_RE = /\.(md|js|mjs|cjs|py|sh|ps1|json|ya?ml|txt)$/i;

// 一键导入的 skill 来路不明，这里只做"风险提示"，不做强拦截——
// 命中不代表一定恶意，只是提醒用户在启用前认真看一眼内容。
const RISKY_PATTERNS = [
  { re: /\bcurl\b[^\n]{0,80}\|\s*(sh|bash)\b/i, label: "包含「下载后直接执行」的管道命令（curl | sh）" },
  { re: /\bwget\b[^\n]{0,80}\|\s*(sh|bash)\b/i, label: "包含「下载后直接执行」的管道命令（wget | sh）" },
  { re: /Invoke-WebRequest|Invoke-Expression|IEX\s*\(/i, label: "包含 PowerShell 远程下载/动态执行指令" },
  { re: /rm\s+-rf\s+(\/|~)(?!\S)/i, label: "包含删除根目录/家目录的高危命令" },
  { re: /\.ssh[\/\\]|id_rsa|authorized_keys/i, label: "涉及 SSH 密钥相关路径" },
  { re: /\.aws[\/\\]credentials|AKIA[0-9A-Z]{16}/i, label: "涉及云账号密钥相关内容" },
  { re: /process\.env|os\.environ/i, label: "读取进程环境变量（可能借此获取密钥）" },
  { re: /child_process|subprocess\.(Popen|call|run)/i, label: "包含系统命令执行相关调用" },
  { re: /\beval\s*\(|\bexec\s*\(/i, label: "包含动态代码执行（eval/exec）" },
];

export function scanRiskyContent(text) {
  if (!text) return [];
  const hits = [];
  for (const { re, label } of RISKY_PATTERNS) {
    if (re.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return SKILL_NAME_RE.test(slug) ? slug : "imported-skill";
}

function guardSafeRelPath(entryName) {
  const normalized = String(entryName).replace(/\\/g, "/");
  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`文件路径不安全：${entryName}`);
  }
  return normalized;
}

// ─── zip 导入 ───────────────────────────────────────────────────────────────
// 从压缩包 Buffer 提取出 { 'SKILL.md': Buffer, 'scripts/a.py': Buffer, ... }
// SKILL.md 可能在 zip 根，也可能在唯一的顶层文件夹里（GitHub 下载的 zip 通常如此）
export function extractFilesFromZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("无法解析该文件，请确认是有效的 zip 压缩包");
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0) throw new Error("压缩包为空");
  if (entries.length > MAX_IMPORT_FILES) throw new Error(`压缩包内文件数超过上限 ${MAX_IMPORT_FILES} 个`);

  const rawFiles = {};
  let totalSize = 0;
  for (const entry of entries) {
    const name = guardSafeRelPath(entry.entryName);
    const data = entry.getData();
    totalSize += data.length;
    if (totalSize > MAX_IMPORT_TOTAL_SIZE) {
      throw new Error(`压缩包总大小超过上限 ${MAX_IMPORT_TOTAL_SIZE / 1024 / 1024}MB`);
    }
    rawFiles[name] = data;
  }

  const mdKey = Object.keys(rawFiles).find((k) => /(^|\/)SKILL\.md$/i.test(k));
  if (!mdKey) throw new Error("压缩包内未找到 SKILL.md");
  const rootPrefix = mdKey.slice(0, mdKey.length - "SKILL.md".length);

  const files = {};
  for (const [key, data] of Object.entries(rawFiles)) {
    if (!key.startsWith(rootPrefix)) continue; // 忽略 SKILL.md 所在目录之外的杂项文件
    const rel = key.slice(rootPrefix.length);
    if (rel) files[rel] = data;
  }
  return files;
}

// ─── 本地文件夹导入 ─────────────────────────────────────────────────────────
// 递归读取一个本地目录，规则和 zip 一致：SKILL.md 可以直接在选中的目录里，
// 也可以在它唯一的子文件夹里（用户可能选中了外层的父目录）
export function readFilesFromDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error("目录不存在");
  }

  const rawFiles = {};
  let totalSize = 0;
  let fileCount = 0;

  function walk(currentDir, relPrefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        fileCount += 1;
        if (fileCount > MAX_IMPORT_FILES) throw new Error(`文件夹内文件数超过上限 ${MAX_IMPORT_FILES} 个`);
        const data = fs.readFileSync(abs);
        totalSize += data.length;
        if (totalSize > MAX_IMPORT_TOTAL_SIZE) {
          throw new Error(`文件夹总大小超过上限 ${MAX_IMPORT_TOTAL_SIZE / 1024 / 1024}MB`);
        }
        rawFiles[rel] = data;
      }
    }
  }
  walk(dirPath, "");

  if (Object.keys(rawFiles).length === 0) throw new Error("该文件夹为空");

  const mdKey = Object.keys(rawFiles).find((k) => /(^|\/)SKILL\.md$/i.test(k));
  if (!mdKey) throw new Error("该文件夹（或其子文件夹）内未找到 SKILL.md");
  const rootPrefix = mdKey.slice(0, mdKey.length - "SKILL.md".length);

  const files = {};
  for (const [key, data] of Object.entries(rawFiles)) {
    if (!key.startsWith(rootPrefix)) continue; // 忽略 SKILL.md 所在目录之外的杂项文件
    const rel = key.slice(rootPrefix.length);
    if (rel) files[rel] = data;
  }
  return files;
}

// ─── URL 导入 ───────────────────────────────────────────────────────────────

// axios 对 HTTP 错误状态码只给一句"Request failed with status code xxx"，
// 把 GitHub 返回的真实错误信息（限流/404/权限等）透出来，否则用户完全不知道该怎么办
function describeGithubError(err) {
  const status = err?.response?.status;
  const ghMessage = err?.response?.data?.message;
  if (status === 403 && /rate limit/i.test(ghMessage || "")) {
    return "GitHub API 请求频率超限（未认证请求每小时限 60 次，代理出口 IP 可能被其他人共用导致更快耗尽）。" +
      "可以稍等一小时后重试，或改用「导入 zip」方式（浏览器下载仓库 zip 后手动导入）绕开这个限制。";
  }
  if (status === 403) return `GitHub 拒绝了该请求（403）：${ghMessage || "可能是限流或权限问题"}`;
  if (status === 404) return "未找到该路径，请确认链接中的分支名和路径是否正确";
  if (ghMessage) return `GitHub 请求失败（${status}）：${ghMessage}`;
  return err?.message || String(err);
}

function parseGithubUrl(url) {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/i);
  if (m) return { owner: m[1], repo: m[2], branch: m[3], subpath: m[4] };
  const mRoot = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (mRoot) return { owner: mRoot[1], repo: mRoot[2], branch: "", subpath: "" };
  return null;
}

async function fetchGithubDir(owner, repo, branch, subpath, state = { totalSize: 0, fileCount: 0 }, depth = 0) {
  if (depth > 4) throw new Error("目录层级过深（超过 4 层）");
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${subpath}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`;
  let data;
  try {
    ({ data } = await axios.get(api, {
      timeout: 15000,
      headers: { "User-Agent": "myAi-skill-importer", Accept: "application/vnd.github+json" },
      ...axiosProxyOptions(),
    }));
  } catch (err) {
    throw new Error(describeGithubError(err));
  }
  if (!Array.isArray(data)) {
    throw new Error("目标不是一个目录，请提供仓库内某个 skill 文件夹的链接（.../tree/分支/路径）");
  }

  let files = {};
  for (const item of data) {
    if (item.type === "dir") {
      const sub = await fetchGithubDir(owner, repo, branch, item.path, state, depth + 1);
      files = { ...files, ...sub };
    } else if (item.type === "file") {
      state.fileCount += 1;
      if (state.fileCount > MAX_IMPORT_FILES) throw new Error(`目录内文件数超过上限 ${MAX_IMPORT_FILES} 个`);
      if (typeof item.size === "number" && item.size > MAX_IMPORT_TOTAL_SIZE) {
        throw new Error(`文件 ${item.path} 超过大小上限`);
      }
      let resp;
      try {
        resp = await axios.get(item.download_url, { timeout: 15000, responseType: "arraybuffer", ...axiosProxyOptions() });
      } catch (err) {
        throw new Error(describeGithubError(err));
      }
      const content = Buffer.from(resp.data);
      state.totalSize += content.length;
      if (state.totalSize > MAX_IMPORT_TOTAL_SIZE) {
        throw new Error(`目录总大小超过上限 ${MAX_IMPORT_TOTAL_SIZE / 1024 / 1024}MB`);
      }
      const rel = guardSafeRelPath(item.path.slice(subpath ? subpath.length : 0).replace(/^\//, "") || item.name);
      files[rel] = content;
    }
  }
  return files;
}

// 支持两类链接：
// 1) 直接指向某个 SKILL.md 原始文件（raw 链接），只导入单文件，无配套脚本
// 2) GitHub 仓库/子目录链接（.../tree/分支/路径），递归拉取该目录下所有文件
export async function fetchFilesFromUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) throw new Error("请输入 URL");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("请输入完整的 http(s) 链接");

  if (/SKILL\.md(\?.*)?$/i.test(trimmed)) {
    let resp;
    try {
      resp = await axios.get(trimmed, {
        timeout: 15000,
        responseType: "text",
        transformResponse: [(d) => d],
        headers: { "User-Agent": "myAi-skill-importer" },
        ...axiosProxyOptions(),
      });
    } catch (err) {
      throw new Error(describeGithubError(err));
    }
    return { "SKILL.md": Buffer.from(String(resp.data), "utf-8") };
  }

  const gh = parseGithubUrl(trimmed);
  if (gh) return fetchGithubDir(gh.owner, gh.repo, gh.branch, gh.subpath);

  throw new Error("暂不支持该链接格式，请提供 GitHub 仓库/子目录链接，或直接指向 SKILL.md 的原始文件链接");
}

// ─── 预览（校验 + 风险扫描，不落盘）─────────────────────────────────────────
export function buildSkillPreview(files, sourceMeta = {}) {
  const mdBuf = files["SKILL.md"];
  if (!mdBuf) throw new Error("未找到 SKILL.md（必须位于 skill 目录根部）");
  const mdContent = mdBuf.toString("utf-8");
  const parsed = parseSkillMd(mdContent);
  if (!parsed.description) throw new Error("SKILL.md 缺少 description 字段，无法导入");

  let totalSize = 0;
  const fileList = [];
  const textBlobs = [mdContent];
  for (const [rel, buf] of Object.entries(files)) {
    totalSize += buf.length;
    fileList.push({ path: rel, size: buf.length });
    if (TEXT_EXT_RE.test(rel) && rel !== "SKILL.md") {
      try { textBlobs.push(buf.toString("utf-8")); } catch {}
    }
  }
  if (totalSize > MAX_IMPORT_TOTAL_SIZE) throw new Error(`导入内容总大小超过 ${MAX_IMPORT_TOTAL_SIZE / 1024 / 1024}MB 上限`);
  if (fileList.length > MAX_IMPORT_FILES) throw new Error(`文件数超过上限 ${MAX_IMPORT_FILES} 个`);

  const hasScripts = fileList.some((f) => f.path !== "SKILL.md" && SCRIPT_EXT_RE.test(f.path));
  const riskFlags = scanRiskyContent(textBlobs.join("\n---\n"));
  const riskLevel = riskFlags.length > 0 ? "high" : hasScripts ? "medium" : "low";

  return {
    suggestedDirName: slugify(parsed.displayName || sourceMeta.hintName),
    displayName: parsed.displayName,
    description: parsed.description,
    version: parsed.version,
    author: parsed.author,
    skillMdContent: mdContent,
    fileList,
    totalSize,
    hasScripts,
    riskFlags,
    riskLevel,
    source: sourceMeta,
    filesBase64: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")])),
  };
}

// ─── 落盘（默认禁用）────────────────────────────────────────────────────────
export function writeImportedSkill({ dirName, filesBase64, meta }) {
  if (!dirName || !SKILL_NAME_RE.test(dirName)) {
    throw new Error("目录名只能包含小写字母、数字和连字符(-)，且不能以连字符开头或结尾");
  }
  if (!filesBase64 || !filesBase64["SKILL.md"]) throw new Error("缺少 SKILL.md 内容");

  const skillDir = path.join(getSystemPath("skills"), dirName);
  if (fs.existsSync(skillDir)) throw new Error("同名 Skill 已存在");

  fs.ensureDirSync(skillDir);
  for (const [rel, b64] of Object.entries(filesBase64)) {
    const targetRel = rel === "SKILL.md" ? "SKILL.md.disabled" : rel; // 导入后默认禁用，需人工审阅后手动开启
    const targetPath = path.join(skillDir, targetRel);
    const resolvedRel = path.relative(skillDir, targetPath);
    if (resolvedRel.startsWith("..") || path.isAbsolute(resolvedRel)) {
      throw new Error(`路径解析后超出 Skill 目录范围：${rel}`);
    }
    fs.ensureDirSync(path.dirname(targetPath));
    fs.writeFileSync(targetPath, Buffer.from(b64, "base64"));
  }

  fs.writeFileSync(
    path.join(skillDir, "_import.json"),
    JSON.stringify({ ...meta, importedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );

  return { name: dirName, skillDir };
}
