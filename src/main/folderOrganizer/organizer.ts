// 文件夹自动归类：规则匹配为主（按扩展名，零成本、结果稳定），仅对规则识别不了的文件在用户开启
// "AI 辅助"时才打包成一次模型调用去判断分类。与"定时任务"完全独立，不做任何调度，全程手动触发。
import * as fs from 'fs-extra';
import * as path from 'path';
import { getDB } from '../utils/getDb';
import { getUUid, formatDate } from '../utils/common';
import { ModelFactory } from '../model/modelFactory';

const db = new Proxy({}, { get: (_target, prop) => (getDB() as any).db[prop] }) as any;

const CATEGORY_RULES: Record<string, string[]> = {
  图片: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'heic'],
  视频: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'm4v'],
  音频: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  文档: ['doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf'],
  压缩包: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2']
};
const CATEGORY_NAMES = Object.keys(CATEGORY_RULES).concat('其他');
const KNOWN_CATEGORY_DIRS = new Set(CATEGORY_NAMES);

export interface PlanItem {
  from: string;
  to: string;
  category: string;
  method: 'rule' | 'ai';
}

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organize_runs (
      id TEXT PRIMARY KEY,
      folderPath TEXT NOT NULL,
      manifestJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);
}

function extCategory(fileName: string): string | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!ext) return null;
  for (const [cat, exts] of Object.entries(CATEGORY_RULES)) {
    if (exts.includes(ext)) return cat;
  }
  return null;
}

// 顶层跳过已经是分类输出目录（图片/视频/...）的子文件夹，避免重复处理自己整理出来的结果
function collectEntries(folderPath: string, recursive: boolean, root: string = folderPath): string[] {
  const items: string[] = [];
  const dirents = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const d of dirents) {
    const full = path.join(folderPath, d.name);
    if (d.isDirectory()) {
      if (folderPath === root && KNOWN_CATEGORY_DIRS.has(d.name)) continue;
      if (recursive) items.push(...collectEntries(full, recursive, root));
      continue;
    }
    items.push(full);
  }
  return items;
}

async function classifyWithAI(fileNames: string[]): Promise<Record<string, string>> {
  const prompt = `请把下面的文件名按类型归类到这些类别之一：${CATEGORY_NAMES.join('、')}。
只根据文件名/后缀判断，不确定就归到"其他"。
严格按 JSON 对象格式返回（不要输出任何多余文字、不要加代码块标记），键是文件名，值是类别名。
文件列表：
${fileNames.map((f) => `- ${f}`).join('\n')}`;

  try {
    const model = ModelFactory.getChatModel();
    const result = await model.invoke([{ role: 'user', content: prompt }]);
    const text = String((result as any)?.content ?? '').trim();
    const jsonText = text.replace(/^```json\s*|^```\s*|```$/g, '').trim();
    const parsed = JSON.parse(jsonText);
    const out: Record<string, string> = {};
    fileNames.forEach((f) => {
      const cat = parsed[f];
      out[f] = CATEGORY_NAMES.includes(cat) ? cat : '其他';
    });
    return out;
  } catch {
    const fallback: Record<string, string> = {};
    fileNames.forEach((f) => (fallback[f] = '其他'));
    return fallback;
  }
}

function resolveCollisions(plan: PlanItem[]) {
  const used = new Set<string>();
  plan.forEach((item) => {
    if (item.to === item.from) return;
    let target = item.to;
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);
    let counter = 1;
    while (used.has(target) || (target !== item.from && fs.existsSync(target))) {
      target = path.join(dir, `${base} (${counter})${ext}`);
      counter++;
    }
    used.add(target);
    item.to = target;
  });
}

export async function planOrganize(
  folderPath: string,
  options: { recursive?: boolean; useAI?: boolean } = {}
): Promise<PlanItem[]> {
  if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    throw new Error('目录不存在');
  }

  const entries = collectEntries(folderPath, !!options.recursive);
  const plan: PlanItem[] = [];
  const uncertain: { fileName: string; fullPath: string }[] = [];

  entries.forEach((fullPath) => {
    const fileName = path.basename(fullPath);
    const category = extCategory(fileName);
    if (category) {
      plan.push({ from: fullPath, to: path.join(folderPath, category, fileName), category, method: 'rule' });
    } else {
      uncertain.push({ fileName, fullPath });
    }
  });

  if (uncertain.length) {
    if (options.useAI) {
      const aiCategories = await classifyWithAI(uncertain.map((u) => u.fileName));
      uncertain.forEach((u) => {
        const category = aiCategories[u.fileName] || '其他';
        plan.push({ from: u.fullPath, to: path.join(folderPath, category, u.fileName), category, method: 'ai' });
      });
    } else {
      uncertain.forEach((u) => {
        plan.push({ from: u.fullPath, to: path.join(folderPath, '其他', u.fileName), category: '其他', method: 'rule' });
      });
    }
  }

  resolveCollisions(plan);
  return plan;
}

export async function applyOrganize(folderPath: string, plan: PlanItem[]) {
  ensureTable();
  const moved: PlanItem[] = [];
  const errors: { from: string; error: string }[] = [];

  for (const item of plan) {
    if (item.from === item.to) continue;
    try {
      await fs.ensureDir(path.dirname(item.to));
      await fs.move(item.from, item.to);
      moved.push(item);
    } catch (err: any) {
      errors.push({ from: item.from, error: String(err?.message || err) });
    }
  }

  const id = getUUid();
  db.prepare(`INSERT INTO organize_runs (id, folderPath, manifestJson, createdAt) VALUES (?, ?, ?, ?)`).run(
    id,
    folderPath,
    JSON.stringify(moved),
    formatDate(Date.now())
  );

  return { runId: id, moved, errors };
}

export function listOrganizeHistory(folderPath?: string) {
  ensureTable();
  if (folderPath) {
    return db.prepare(`SELECT * FROM organize_runs WHERE folderPath = ? ORDER BY createdAt DESC`).all(folderPath);
  }
  return db.prepare(`SELECT * FROM organize_runs ORDER BY createdAt DESC LIMIT 500`).all();
}

export async function undoOrganize(runId: string) {
  ensureTable();
  const row: { id: string; folderPath: string; manifestJson: string } = db
    .prepare(`SELECT * FROM organize_runs WHERE id = ?`)
    .get(runId);
  if (!row) throw new Error('记录不存在');

  const manifest: PlanItem[] = JSON.parse(row.manifestJson);
  const restored: PlanItem[] = [];
  const errors: { from: string; error: string }[] = [];

  for (const item of manifest) {
    try {
      if (!(await fs.pathExists(item.to))) {
        errors.push({ from: item.to, error: '目标文件不存在，可能已被移动或删除，跳过' });
        continue;
      }
      await fs.ensureDir(path.dirname(item.from));
      await fs.move(item.to, item.from, { overwrite: false });
      restored.push(item);
    } catch (err: any) {
      errors.push({ from: item.to, error: String(err?.message || err) });
    }
  }

  db.prepare(`DELETE FROM organize_runs WHERE id = ?`).run(runId);
  return { restored, errors };
}
