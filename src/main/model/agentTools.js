import { tool } from "@langchain/core/tools";
// 注意：这里必须用 zod/v4，不能用默认的 zod(v3)。
// deepagents 内部（humanInTheLoopMiddleware 等）用的是它自己 node_modules 里嵌套的 zod v4，
// 我们自己这边如果用 zod v3 构造 schema，跨版本的 schema 对象在被 interruptOn 包裹时会被
// 静默处理失败，导致该工具（如 execute）从最终绑定给模型的工具列表里消失，且不报错。
// 现象：execute 工具的 description 明明写了，但模型说"没有这个工具"——因为它确实没被绑上。
import { z } from "zod/v4";
import { getSystemPath } from "../utils/common";
import { showDesktopNotification } from "../utils/notifier";
import documentGenerator from "../server/docServer/documentGenerator";

const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");

const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Skill 配套文件（scripts/references/assets）约束：仅作只读参考用途，不提供直接执行入口，
// 模型需要跑脚本时自己用 run_command 在会话工作目录里重新落地执行。
const SKILL_SUPPORTING_DIRS = ["scripts", "references", "assets"];
const SKILL_SCRIPT_EXT_RE = /\.(js|mjs|cjs|py|sh|ps1)$/i;
const MAX_SKILL_FILE_SIZE = 200 * 1024; // 200KB，纯文本参考资料足够，防止生成失控大文件
const MAX_SKILL_FILES_PER_CALL = 20;

// ─── Skill 文件辅助（人工创建的 REST 路由 与 Agent 自建工具 共用，单一实现）───────

// 返回 skill 目录下的活跃 SKILL.md 路径（优先 SKILL.md，否则 SKILL.md.disabled）
export function resolveSkillMdPath(skillDir) {
  const active = path.join(skillDir, "SKILL.md");
  const disabled = path.join(skillDir, "SKILL.md.disabled");
  if (fs.existsSync(active)) return { mdPath: active, enabled: true };
  if (fs.existsSync(disabled)) return { mdPath: disabled, enabled: false };
  return { mdPath: null, enabled: false };
}

// 解析 SKILL.md frontmatter
export function parseSkillMd(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    const versionMatch = fm.match(/^version:\s*(.+)$/m);
    const builtinMatch = fm.match(/^builtin:\s*(.+)$/m);
    const authorMatch = fm.match(/^author:\s*(.+)$/m);
    return {
      displayName: nameMatch?.[1]?.trim() || "",
      description: descMatch?.[1]?.trim() || "",
      version: versionMatch?.[1]?.trim() || "",
      isBuiltin: builtinMatch?.[1]?.trim() === "true",
      author: authorMatch?.[1]?.trim() || "",
    };
  }
  const lines = content.split("\n");
  const desc = lines.find((l) => l.trim() && !l.startsWith("#")) || "";
  return { displayName: "", description: desc.trim(), version: "", isBuiltin: false, author: "" };
}

// 新建一个 Skill 目录 + SKILL.md（人工表单 / Agent 自建 共用）
// author: 传 "agent" 表示这是 Agent 自己沉淀的 skill，人工创建时不传
export function writeSkillMd({ name, displayName, description, content, author }) {
  if (!name || !SKILL_NAME_RE.test(name)) {
    throw new Error("skill 名称只能包含小写字母、数字和连字符(-)，且不能以连字符开头或结尾");
  }
  const skillDir = path.join(getSystemPath("skills"), name);
  if (fs.existsSync(skillDir)) {
    throw new Error("同名 Skill 已存在");
  }
  fs.mkdirSync(skillDir, { recursive: true });
  const authorLine = author ? `\nauthor: ${author}` : "";
  const skillMd =
    content && content.trim()
      ? content
      : `---
name: ${displayName || name}
description: ${description || "请填写描述"}${authorLine}
---

## 何时使用

描述这个 Skill 适用的场景。

## 使用方法

描述 Agent 应该如何使用这个 Skill 完成任务。
`;
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
  return { name, skillDir };
}

// 覆盖写入已存在 Skill 的内容（无论当前是启用/禁用状态，都写回原文件名）
export function updateSkillContent(name, content) {
  const skillDir = path.join(getSystemPath("skills"), name);
  if (!fs.existsSync(skillDir)) throw new Error("Skill 目录不存在");
  const { mdPath } = resolveSkillMdPath(skillDir);
  const targetPath = mdPath || path.join(skillDir, "SKILL.md");
  fs.writeFileSync(targetPath, content || "", "utf-8");
  return { name, skillDir };
}

// 归一化：去掉大小写/连字符等差异，只保留字母数字，用于粗粒度判断"是不是同一个 Skill 换了个名字"
function normalizeSkillKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// 编辑距离（输入都是很短的 skill 名/显示名，暴力 DP 足够，不需要引入额外依赖）
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// 沉淀新 Skill 前的去重：只在已有的非内置 Skill 里找疑似重复项——内置 Skill 是标准参照，
// 不参与去重合并（避免"沉淀"把内置 Skill 当成合并目标）。命中条件：目录名/显示名归一化后
// 完全一致、互为子串，或编辑距离很近。
export function findSimilarNonBuiltinSkill({ name, description }) {
  const skillsDir = getSystemPath("skills");
  if (!fs.existsSync(skillsDir)) return null;
  const targetKey = normalizeSkillKey(name);
  if (!targetKey) return null;

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of entries) {
    if (entry.name === name) continue; // 完全同名会被 writeSkillMd 的存在性检查单独拦下，不算这里的"相似"
    const skillDir = path.join(skillsDir, entry.name);
    const { mdPath } = resolveSkillMdPath(skillDir);
    if (!mdPath) continue;
    const content = fs.readFileSync(mdPath, "utf-8");
    const parsed = parseSkillMd(content);
    if (parsed.isBuiltin) continue; // 内置 Skill 不参与去重比较

    const candidateKeys = [normalizeSkillKey(entry.name), normalizeSkillKey(parsed.displayName)].filter(Boolean);
    const isSimilarName = candidateKeys.some((key) => {
      if (key === targetKey) return true;
      if (key.length >= 4 && targetKey.length >= 4 && (key.includes(targetKey) || targetKey.includes(key))) return true;
      return levenshtein(key, targetKey) <= 2;
    });
    if (isSimilarName) {
      return { name: entry.name, displayName: parsed.displayName || entry.name, description: parsed.description, content };
    }
  }
  return null;
}

// 校验并写入 Skill 目录下的配套文件（scripts/references/assets）。
// 逐个文件独立校验，某个文件不合规不影响其它文件写入，结果里逐条注明成功/失败原因。
function writeSkillSupportingFiles(skillDir, files) {
  if (!files || files.length === 0) return [];
  if (files.length > MAX_SKILL_FILES_PER_CALL) {
    throw new Error(`一次最多写入 ${MAX_SKILL_FILES_PER_CALL} 个配套文件，本次传了 ${files.length} 个`);
  }
  const results = [];
  for (const f of files) {
    const relPath = String(f?.path || "").trim().replace(/\\/g, "/");
    try {
      if (!relPath) throw new Error("path 不能为空");
      const topDir = relPath.split("/")[0];
      if (!SKILL_SUPPORTING_DIRS.includes(topDir)) {
        throw new Error(`路径必须以 ${SKILL_SUPPORTING_DIRS.map((d) => d + "/").join("、")} 之一开头`);
      }
      if (relPath.includes("..") || path.isAbsolute(relPath)) {
        throw new Error("路径不能包含 .. 或使用绝对路径");
      }
      if (topDir === "scripts" && !SKILL_SCRIPT_EXT_RE.test(relPath)) {
        throw new Error("scripts/ 下文件仅支持 .js/.mjs/.cjs/.py/.sh/.ps1");
      }
      const content = String(f?.content ?? "");
      if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_FILE_SIZE) {
        throw new Error(`文件内容超过 ${MAX_SKILL_FILE_SIZE / 1024}KB 上限`);
      }
      const targetPath = path.join(skillDir, relPath);
      const resolvedRel = path.relative(skillDir, targetPath);
      if (resolvedRel.startsWith("..") || path.isAbsolute(resolvedRel)) {
        throw new Error("路径解析后超出 Skill 目录范围");
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf-8");
      results.push({ path: relPath, ok: true });
    } catch (err) {
      results.push({ path: relPath || "(空路径)", ok: false, error: err.message });
    }
  }
  return results;
}

// 把配套文件写入结果拼成一段人类可读的追加说明，供工具返回值展示给模型
function summarizeSkillFileResults(results) {
  if (!results || results.length === 0) return "";
  const ok = results.filter((r) => r.ok).map((r) => r.path);
  const failed = results.filter((r) => !r.ok);
  const parts = [];
  if (ok.length) parts.push(`已写入配套文件：${ok.join("、")}`);
  if (failed.length) parts.push(`以下配套文件写入失败：${failed.map((f) => `${f.path}（${f.error}）`).join("；")}`);
  return parts.length ? "\n" + parts.join("\n") : "";
}

// create_skill 的配套文件 schema
const skillFilesSchema = z
  .array(
    z.object({
      path: z
        .string()
        .describe("相对 Skill 目录的路径，必须以 scripts/、references/、assets/ 之一开头，如 scripts/parse.py"),
      content: z.string().describe("文件的完整文本内容"),
    })
  )
  .optional()
  .describe(
    "需要一并生成的配套文件（可复用脚本放 scripts/、长篇参考资料放 references/、模板类文件放 assets/）。" +
      "这些文件只做只读参考用途，不会被系统直接执行；需要用到脚本里的逻辑时，自己用 run_command 重新落地执行。"
  );

// ─── Agent 可调用工具 ───────────────────────────────────────────────────────
// invalidateAgent 由调用方（deepAgentServer）注入，避免与其产生循环引用
export function createAgentManagementTools({ invalidateAgent, onSkillPersisted }) {
  const create_skill = tool(
    async ({ name, displayName, description, content, files }, config) => {
      const rec = writeSkillMd({ name, displayName, description, content, author: "agent" });
      const fileResults = writeSkillSupportingFiles(rec.skillDir, files);
      invalidateAgent();
      onSkillPersisted?.({
        runId: config?.configurable?.run_id,
        skillName: rec.name,
        skillAction: "create",
      });
      return `已创建 Skill「${rec.name}」，将在下一轮对话中生效。${summarizeSkillFileResults(fileResults)}`;
    },
    {
      name: "create_skill",
      description:
        "当你想把这次任务里总结出的、值得复用的操作步骤/知识沉淀下来时调用，把它保存为新 Skill。" +
        "不需要自己判断是否和已有 Skill 重复——哪怕这次任务读取过某个相关的已有 Skill，也照常调用这个工具就行；" +
        "如果系统检测到和已有 Skill 相似，会交给用户决定是合并还是仍然新建，不需要你做任何额外操作。" +
        "SKILL.md 正文只写导航性摘要和调用方法；可复用的命令片段/长脚本、篇幅较长的参考资料、模板类文件，应该通过 files 参数分别拆到 scripts/、references/、assets/ 子目录，不要都堆进 SKILL.md 正文。",
      schema: z.object({
        name: z.string().describe("skill 目录名，仅小写字母/数字/连字符"),
        displayName: z.string().optional().describe("显示名称"),
        description: z.string().describe("这个 skill 适用的场景描述，会影响之后是否被选中使用"),
        content: z.string().optional().describe("完整 SKILL.md 内容（含 frontmatter）；不传则生成默认模板"),
        files: skillFilesSchema,
      }),
    }
  );

  return { create_skill };
}

// ─── 命令执行（弱隔离：限定在会话工作目录内，禁止越权路径）───────────────────
// 注意：这不是真正的沙箱，只是尽力而为的兜底防呆，不能防住刻意绕过。
// 设计原则：cd/chdir 本身不危险（拦不住也没必要拦——工作目录内随便切子目录、
// 甚至 cd 到工作目录自己都应该放行），真正危险的是"某个路径解析后跑到了工作目录外"，
// 所以按 token 逐个做真实路径解析校验，而不是用正则一刀切禁止 cd 关键字。

const DANGEROUS_COMMAND_PATTERNS = [
  /\bformat\b/i, /\bdiskpart\b/i, /\bshutdown\b/i, /\brestart-computer\b/i, /\bstop-computer\b/i,
  /\breg\s+(add|delete)\b/i, /\bnet\s+user\b/i, /\btaskkill\s+\/f\b/i,
  // 禁止创建任何脱离本程序管控、独立于本程序生命周期持续存在的系统级定时任务/计划任务/服务，
  // 这类东西一旦建立，关掉本程序也不会消失，只能靠用户手动去系统里删——真正的"定时提醒"需求
  // 应该走本程序自己的"定时任务"功能，而不是让模型自己跑去操作系统层面建一个我们管不到的任务。
  /\bschtasks\b/i, /\bat\s+\d/i, /new-scheduledtask/i, /register-scheduledtask/i,
  /\bcrontab\b/i, /\bsystemctl\b/i, /\bsc\s+create\b/i, /new-service/i,
];

// 重定向符（>、>>、<）紧贴路径时（如 "echo x>..\evil.bat"，中间没有空格），真实 shell 会把
// 操作符和后面的路径拆开单独解析，但按空白切词会把 ">.." 粘成一个 token——这个 token 不等于 ".."
// 也不以 "../" 开头，会绕过下面的越权路径校验。这里在切词前把操作符和紧跟的内容之间插入空格，
// 让路径部分能被切成独立 token 参与校验；只影响这里的校验逻辑，不改动传给 exec() 的原始命令。
function normalizeShellOperatorSpacing(command) {
  return String(command).replace(/(>>?|<)(?=\S)/g, "$1 ");
}

// 粗略按空白/引号切分命令为 token（不追求完整 shell 语法解析，够用即可）
function tokenizeCommand(command) {
  const matches = normalizeShellOperatorSpacing(command).match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((t) => t.replace(/^["']|["']$/g, ""));
}

// 环境变量引用 / 命令替换（%VAR%、$VAR、${VAR}、$(...)、`...`）在真实 shell 里会被展开成
// 任意路径（比如 %APPDATA%、$HOME 展开后就是工作目录外的绝对路径），这里没法静态求值展开后的
// 结果，与其误判成"看起来在工作目录内"而放行，不如直接拒绝——宁可误杀，不留越权口子。
const SHELL_EXPANSION_RE = /%[A-Za-z_][A-Za-z0-9_]*%|\$\{[^}]*\}|\$\([^)]*\)|\$[A-Za-z_][A-Za-z0-9_]*|`[^`]*`/;

// 空设备（黑洞）：读写都没有真实文件内容，不构成越权访问，无论平台一律放行。
// 只白名单这两个已知的"空设备"，不包括 CON/PRN/AUX 等其他 Windows 保留设备名——那些有真实 I/O 行为，不能一概当无害处理。
const NULL_DEVICE_PATTERNS = [/^\/dev\/null$/i, /^nul$/i];
function isNullDevice(token) {
  return NULL_DEVICE_PATTERNS.some((re) => re.test(token));
}

// 判断一个 token 是否"像路径"，需要做越界校验；尽量避免把 Windows 命令行开关
// （如 /s /b /y）误判成 Unix 绝对路径
function looksLikePath(token) {
  if (/^[A-Za-z]:/.test(token)) return true;        // 盘符路径 / 裸盘符，如 C:\ 或 D:
  if (token.startsWith("\\\\")) return true;        // UNC 路径 \\host\share
  if (token.includes("\\")) return true;            // 含反斜杠基本都是 Windows 路径
  if (token === "..") return true;
  if (token.startsWith("../") || token.startsWith("./")) return true;
  if (/^\/[^/]+\/[^/]*$/.test(token)) return true;  // /a/b 这种多段 Unix 路径，区别于 /s /y 这类单段开关
  return false;
}

// 校验一条命令是否可以在会话工作目录内直接执行；不通过时返回拒绝原因（中文，供模型看）
export function validateConfinedCommand(command, workDir) {
  const cmd = String(command || "");
  if (DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(cmd))) {
    return { ok: false, reason: "命中禁止执行的高风险命令" };
  }
  if (SHELL_EXPANSION_RE.test(cmd)) {
    return { ok: false, reason: "命令中包含环境变量或命令替换（如 %VAR%、$VAR、$(...)、`...`），展开后的实际路径无法静态校验，已拒绝执行" };
  }

  for (const token of tokenizeCommand(cmd)) {
    if (isNullDevice(token)) continue; // /dev/null、NUL 这类空设备，读写都无意义，不算越权
    if (!looksLikePath(token)) continue;
    if (!workDir) continue; // 没传 workDir 时跳过路径解析校验（理论上不会发生）

    const resolved = path.resolve(workDir, token);
    const rel = path.relative(workDir, resolved);
    if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
      return { ok: false, reason: `检测到越权路径「${token}」，命令只能操作工作目录（${workDir}）内的文件，cd 到工作目录内部（含工作目录自身）是允许的` };
    }
  }
  return { ok: true };
}

// 创建限定工作目录的 execute 工具。getSessionWorkDir(sessionId) 由调用方注入，
// 用于在每次调用时（通过 LangChain 透传的 config.configurable.session_id）解析出这次该用哪个目录。
// getPermissionLevel(sessionId) 同样每次调用时查一次（而不是建 Agent 时查一次），保证用户中途切换
// 权限级别时立刻生效，不需要重建 Agent。level === "unrestricted"（3级）时跳过 validateConfinedCommand，
// 命令原样丢给真实 shell 执行——这是用户在切换到该级别时已经过二次确认弹窗明确知情同意的"不设防"模式。
export function createExecuteTool({ getSessionWorkDir, getPermissionLevel }) {
  const execute = tool(
    async ({ command }, config) => {
      const sessionId = config?.configurable?.session_id;
      const workDir = await getSessionWorkDir(sessionId);
      const level = (await getPermissionLevel?.(sessionId)) || "confirm";

      if (level !== "unrestricted") {
        const check = validateConfinedCommand(command, workDir);
        if (!check.ok) {
          return `❌ 命令被拒绝：${check.reason}。当前工作目录：${workDir}`;
        }
      }

      const result = await new Promise((resolve) => {
        exec(
          command,
          { cwd: workDir, timeout: 120000, maxBuffer: 100_000, encoding: "utf-8" },
          (error, stdout, stderr) => {
            resolve({
              exitCode: error ? (error.code ?? 1) : 0,
              output: `${stdout || ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim(),
            });
          }
        );
      });

      return `执行命令：${command}\n工作目录：${workDir}\n退出码：${result.exitCode}\n输出：\n${result.output || "(无输出)"}`;
    },
    {
      name: "run_command",
      description:
        "在当前会话的工作目录内执行 shell 命令（无沙箱，本机真实执行，需人工审批）。只能操作工作目录内部的文件（cd 到工作目录内的子目录、或 cd 回工作目录自身都允许），" +
        "禁止引用工作目录之外的绝对路径/盘符/UNC 路径/上级目录跳转，违反会被拒绝。" +
        "用户说「看看这个目录/文件夹里有什么」「读一下这个文件」等指的是这个工作目录时，应该用本工具执行 dir 或 ls -la 之类的命令查看，" +
        "不要用 read_file/ls/glob 这几个文件工具——它们访问的是程序自己的数据目录，跟这个工作目录是两回事。" +
        "无论是你自己直接调用，还是被上级 Agent 通过 task 工具委托执行，本工具都可以正常使用，同样会走人工审批流程，不需要因此拒绝或回避调用。",
      schema: z.object({
        command: z.string().describe("要执行的 shell 命令；可以 cd 到工作目录内部，但不能引用工作目录之外的路径"),
      }),
    }
  );

  return { execute };
}

// ─── 工作目录只读浏览工具（不依赖"允许执行系统命令"开关，靠真实路径解析校验越界）───
// 只要设置了工作目录就一直可用：只读、且用 path.resolve + relative 做硬校验（不是正则劝退），
// 风险跟内置 read_file/ls 相当，因此不需要人工审批。

export function resolveWithinWorkDir(workDir, relPath) {
  const target = path.resolve(workDir, relPath || ".");
  const rel = path.relative(workDir, target);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(`路径超出工作目录范围：${relPath}`);
  }
  return target;
}

export function createWorkdirReadTools({ getSessionWorkDir }) {
  const list_workdir = tool(
    async ({ subPath }, config) => {
      const sessionId = config?.configurable?.session_id;
      const workDir = await getSessionWorkDir(sessionId);
      try {
        const target = resolveWithinWorkDir(workDir, subPath);
        if (!fs.existsSync(target)) return `目录不存在：${target}`;
        const entries = fs.readdirSync(target, { withFileTypes: true }).map((e) => {
          if (e.isDirectory()) return `[目录] ${e.name}/`;
          const size = (() => { try { return fs.statSync(path.join(target, e.name)).size; } catch { return 0; } })();
          return `[文件] ${e.name} (${size} 字节)`;
        });
        return `工作目录：${workDir}\n当前列出：${target}\n${entries.length ? entries.join("\n") : "(空目录)"}`;
      } catch (e) {
        return `❌ ${e.message}`;
      }
    },
    {
      name: "list_workdir",
      description:
        "浏览当前会话工作目录（用户在对话页设置的那个目录，与 execute 使用的是同一个目录）下的文件和子目录。" +
        "用户问「这个目录/文件夹里有什么」时用这个工具，不要用 ls——ls 访问的是程序自己的数据目录，跟工作目录无关。",
      schema: z.object({
        subPath: z.string().optional().describe("工作目录下的相对子路径，不传则列出工作目录根"),
      }),
    }
  );

  const read_workdir_file = tool(
    async ({ filePath }, config) => {
      const sessionId = config?.configurable?.session_id;
      const workDir = await getSessionWorkDir(sessionId);
      try {
        const target = resolveWithinWorkDir(workDir, filePath);
        if (!fs.existsSync(target)) return `❌ 文件不存在：${filePath}`;
        if (fs.statSync(target).isDirectory()) return `❌ ${filePath} 是一个目录，请用 list_workdir 查看`;
        const MAX_BYTES = 200_000;
        const stat = fs.statSync(target);
        const content = fs.readFileSync(target, "utf-8").slice(0, MAX_BYTES);
        const truncated = stat.size > MAX_BYTES ? `\n...(文件较大，已截断，完整大小 ${stat.size} 字节)` : "";
        return `工作目录：${workDir}\n文件：${filePath}\n内容：\n${content}${truncated}`;
      } catch (e) {
        return `❌ ${e.message}`;
      }
    },
    {
      name: "read_workdir_file",
      description:
        "读取当前会话工作目录下某个文件的内容（与 execute 使用的是同一个目录）。" +
        "用户说「读一下这个文件」且指的是工作目录里的文件时用这个工具，不要用 read_file——read_file 访问的是程序自己的数据目录。",
      schema: z.object({
        filePath: z.string().describe("工作目录下的相对文件路径"),
      }),
    }
  );

  return { list_workdir, read_workdir_file };
}

// 工作目录内写文件（新建/覆盖）。跟 execute/list_workdir/read_workdir_file 一样限定在工作目录内，
// 供无人值守场景（如定时任务）安全落地生成文档，不依赖 execute 命令间接写文件。
export function createWorkdirWriteTool({ getSessionWorkDir }) {
  const write_workdir_file = tool(
    async ({ filePath, content }, config) => {
      const sessionId = config?.configurable?.session_id;
      const workDir = await getSessionWorkDir(sessionId);
      try {
        const target = resolveWithinWorkDir(workDir, filePath);
        fs.ensureDirSync(path.dirname(target));
        fs.writeFileSync(target, String(content ?? ""), "utf-8");
        return `已写入工作目录：${workDir}\n文件：${filePath}\n大小：${Buffer.byteLength(String(content ?? ""), "utf-8")} 字节`;
      } catch (e) {
        return `❌ ${e.message}`;
      }
    },
    {
      name: "write_workdir_file",
      description:
        "在当前工作目录下新建或覆盖写入一个文件（与 execute/list_workdir 使用的是同一个目录）。" +
        "用户要求「生成一份文档/写入结果」时用这个工具把内容真正落地成文件，不要只用文字回复假装已完成。",
      schema: z.object({
        filePath: z.string().describe("工作目录下的相对文件路径，例如 report.md"),
        content: z.string().describe("要写入的完整文件内容"),
      }),
    }
  );

  return { write_workdir_file };
}

// 定时任务专用的 generateWord：跟 tools.js 里那个通用版最大的区别是——通用版生成完只返回一个
// http://127.0.0.1:5120/doc/download/xxx 的下载链接，文件实际存在服务端的下载目录，不在任务的工作目录里。
// 之前发生过模型试图用 execute 跑 curl 去重新下载这个链接进工作目录，下载失败时把错误响应当文件存了下来；
// 后来干脆改用 write_workdir_file 写一份 .md 内容"糊弄过去"，导致任务明明要 Word 却总是只生成 md。
// 根本解法是这个工具生成完之后，直接在主进程内用 fs 把文件从服务端目录复制进任务工作目录，
// 不经过 HTTP、不需要模型自己再操心"怎么把文件弄进工作目录"，一步到位。
export function createWorkdirGenerateWordTool({ getSessionWorkDir }) {
  const generateWord = tool(
    async ({ markdown, filename, format, options }, config) => {
      const sessionId = config?.configurable?.session_id;
      const workDir = await getSessionWorkDir(sessionId);
      try {
        const result = await documentGenerator.generate(markdown, format, filename, options);
        if (!result.success) return "❌ 生成文件失败。";
        const sourcePath = await documentGenerator.getFilePath(result.filename);
        if (!sourcePath) return "❌ 文件已生成但找不到落盘路径，可能生成失败。";
        const targetPath = resolveWithinWorkDir(workDir, result.filename);
        fs.ensureDirSync(path.dirname(targetPath));
        fs.copyFileSync(sourcePath, targetPath);
        return `已生成并保存到工作目录：${workDir}\n文件：${result.filename}`;
      } catch (e) {
        return `❌ ${e.message}`;
      }
    },
    {
      name: "generateWord",
      description:
        "文档或者报告生成工具，生成后会自动保存到当前工作目录（不是下载链接，不需要额外下载）。" +
        "支持5种模板风格，通过 options.templateId 指定：business(商务蓝，默认)、report(报告红/仿宋/双倍行距)、simple(简约灰/宋体)、academic(学术深蓝/双倍行距)、intel(情报琥珀)。" +
        "用户若未明确说明风格，使用当前已选模板（由系统提示词指定）。",
      schema: z.object({
        markdown: z.string().describe("markdown"),
        filename: z.string().optional().describe("文件名"),
        format: z.string().describe("文件格式,目前只支持只接受参数 word || pdf"),
        options: z
          .object({
            title: z.string().optional(),
            templateId: z
              .enum(["business", "report", "simple", "academic", "intel"])
              .optional()
              .describe("模板风格，不传则使用系统当前选中模板")
          })
          .optional()
      })
    }
  );

  return { generateWord };
}

// 定时任务专用：让模型自己判断"这件事需要提醒用户"时，主动弹一个系统桌面通知（电脑右下角弹窗，
// 不是应用内提示，哪怕程序被最小化到托盘也能看到）。为后续"闹钟/提醒事项"类需求打基础。
export function createNotifyTool() {
  const send_notification = tool(
    async ({ title, message }) => {
      const ok = showDesktopNotification(title, message);
      return ok ? `已发送桌面通知：${title} - ${message}` : `❌ 当前系统不支持桌面通知，发送失败`;
    },
    {
      name: "send_notification",
      description:
        "给用户发一个系统桌面通知（电脑右下角弹窗提醒），用于任务里需要主动提醒用户注意的场景（比如提醒事项、闹钟类需求、需要用户关注的重要结果）。" +
        "不要滥用，只在确实需要引起用户注意时调用，普通的执行结果不需要额外发通知。" +
        "唯一正确的提醒方式就是调用这个工具——不要用 execute 执行命令行去尝试弹通知（比如 msg、PowerShell 的 toast 通知等），" +
        "这类命令在无人交互的后台进程里经常不会真的弹出任何东西，即使命令本身执行不报错。",
      schema: z.object({
        title: z.string().describe("通知标题，简短"),
        message: z.string().describe("通知正文内容"),
      }),
    }
  );
  return { send_notification };
}
