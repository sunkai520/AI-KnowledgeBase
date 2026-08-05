import { Session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings, ProxyMode, SettingManager } from './settingManager';
import { DataPathManager } from './dataPathManager';

export interface AppliedProxyState {
  mode: 'direct' | 'proxy' | 'pac';
  proxyMode: ProxyMode;
  proxyUrl: string;
  pacScript?: string;
}

export interface PacListInfo {
  version: string;
  count: number;
  updatedAt: number | null;
  /** 'none' 表示数据目录里还没有名单文件（还未下载过，或下载失败） */
  source: 'remote' | 'none';
  /** 是否正在自动/手动下载名单 */
  fetching: boolean;
}

const WHITELIST_URL =
  'https://raw.githubusercontent.com/entr0pia/SwitchyOmega-Whitelist/master/white-list.sorl';
const WHITELIST_CACHE_FILE = 'proxy/cn-whitelist.sorl';
const CUSTOM_DOMAINS_FILE = 'proxy/custom-domains.json';

export function normalizeProxyMode(value: unknown): ProxyMode {
  return value === 'global' || value === 'pac' || value === 'direct' ? value : 'global';
}

export function getEffectiveProxyMode(settings: AppSettings): ProxyMode {
  if (!settings.proxyEnabled) return 'direct';
  return normalizeProxyMode(settings.proxyMode);
}

// session.closeAllConnections() 会终止该 session 下所有「正在进行中」的请求，不只是清空闲置连接池
// （Electron 官方文档原话）。持久化分区（如 persist:ai-search）在多次调用间是同一个 Session 对象，
// 如果每次 newPage() 都无条件重新 setProxy + closeAllConnections，一旦短时间内有第二次调用命中
// 同一分区，就会把第一次调用「正在进行中」的请求直接掐断（表现为 net::ERR_CONNECTION_CLOSED），
// 而代理本身其实完全正常。这里按 Session 缓存「上次实际生效的代理配置签名」，配置没变就跳过
// setProxy/closeAllConnections，只有真的变了（用户改了代理设置、或调用方传了不同的显式代理）才重新应用。
const lastAppliedProxySignature = new WeakMap<Session, string>();

export async function applyProxyToSession(
  targetSession: Session,
  options: { explicitProxy?: string; forceDirect?: boolean; proxyMode?: ProxyMode } = {},
): Promise<AppliedProxyState> {
  const target = resolveTargetProxyState(options);
  const signature = JSON.stringify(target);

  if (lastAppliedProxySignature.get(targetSession) === signature) {
    return target;
  }

  if (target.mode === 'pac') {
    await targetSession.setProxy({ mode: 'pac_script', pacScript: target.pacScript });
  } else if (target.mode === 'proxy') {
    await targetSession.setProxy({ proxyRules: target.proxyUrl, proxyBypassRules: '<-loopback>' });
  } else {
    await targetSession.setProxy({ mode: 'direct' });
  }
  await closeSessionConnections(targetSession);
  lastAppliedProxySignature.set(targetSession, signature);
  return target;
}

/** 根据显式参数 / 全局设置，算出这次应该生效的代理状态（纯计算，不产生副作用） */
function resolveTargetProxyState(
  options: { explicitProxy?: string; forceDirect?: boolean; proxyMode?: ProxyMode },
): AppliedProxyState {
  if (options.forceDirect) {
    return { mode: 'direct', proxyMode: 'direct', proxyUrl: '' };
  }

  const explicitProxy = String(options.explicitProxy || '').trim();
  if (explicitProxy) {
    const explicitMode = normalizeProxyMode(options.proxyMode);
    if (explicitMode === 'pac') {
      return { mode: 'pac', proxyMode: 'pac', proxyUrl: explicitProxy, pacScript: ensurePacFile(explicitProxy) };
    }
    return { mode: 'proxy', proxyMode: 'global', proxyUrl: explicitProxy };
  }

  const settings = SettingManager.getInstance().getAll();
  const proxyMode = getEffectiveProxyMode(settings);
  const proxyUrl = String(settings.proxyUrl || '').trim();

  if (proxyMode === 'direct' || !proxyUrl) {
    return { mode: 'direct', proxyMode: 'direct', proxyUrl: '' };
  }
  if (proxyMode === 'pac') {
    return { mode: 'pac', proxyMode: 'pac', proxyUrl, pacScript: ensurePacFile(proxyUrl) };
  }
  return { mode: 'proxy', proxyMode: 'global', proxyUrl };
}

export function shouldForceDirectForSearchEngine(engine?: string, explicitProxy?: string): boolean {
  const cnEngines = ['baidu', 'sogou'];
  if (!cnEngines.includes(String(engine || '').toLowerCase()) || explicitProxy) return false;
  const settings = SettingManager.getInstance().getAll();
  return getEffectiveProxyMode(settings) === 'direct';
}

function ensurePacFile(proxyUrl: string): string {
  const script = buildPacScript(proxyUrl);
  return `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(script)}`;
}

/**
 * PAC 模式策略：默认全部走代理，命中"中国大陆域名白名单"则直连。
 * 用户自定义的强制代理名单优先级最高（用于修正白名单误命中的域名）。
 */
function buildPacScript(proxyUrl: string): string {
  const proxyRule = toPacProxyRule(proxyUrl);
  const whitelist = getCnWhitelist();
  const custom = getCustomDomains();
  const forceProxyMap = toDomainMap(custom.forceProxy);
  const forceDirectMap = toDomainMap(custom.forceDirect);

  return `function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();

  if (
    isPlainHostName(host) ||
    shExpMatch(host, "localhost") ||
    shExpMatch(host, "127.*") ||
    shExpMatch(host, "10.*") ||
    shExpMatch(host, "169.254.*") ||
    shExpMatch(host, "172.16.*") ||
    shExpMatch(host, "172.17.*") ||
    shExpMatch(host, "172.18.*") ||
    shExpMatch(host, "172.19.*") ||
    shExpMatch(host, "172.20.*") ||
    shExpMatch(host, "172.21.*") ||
    shExpMatch(host, "172.22.*") ||
    shExpMatch(host, "172.23.*") ||
    shExpMatch(host, "172.24.*") ||
    shExpMatch(host, "172.25.*") ||
    shExpMatch(host, "172.26.*") ||
    shExpMatch(host, "172.27.*") ||
    shExpMatch(host, "172.28.*") ||
    shExpMatch(host, "172.29.*") ||
    shExpMatch(host, "172.30.*") ||
    shExpMatch(host, "172.31.*") ||
    shExpMatch(host, "192.168.*")
  ) {
    return "DIRECT";
  }

  var forceProxyDomains = ${forceProxyMap};
  var forceDirectDomains = ${forceDirectMap};
  var cnWhitelist = ${whitelist.mapJson};

  function matches(host, map) {
    var parts = host.split(".");
    for (var i = 0; i < parts.length; i++) {
      if (map[parts.slice(i).join(".")] === 1) return true;
    }
    return false;
  }

  if (matches(host, forceProxyDomains)) return "${proxyRule}";
  if (matches(host, forceDirectDomains)) return "DIRECT";
  if (matches(host, cnWhitelist)) return "DIRECT";

  return "${proxyRule}";
}
`;
}

function toDomainMap(domains: string[] | undefined): string {
  const map: Record<string, 1> = {};
  (domains || []).forEach((d) => {
    const cleaned = String(d || '').trim().toLowerCase();
    if (cleaned) map[cleaned] = 1;
  });
  return JSON.stringify(map);
}

function toPacProxyRule(proxyUrl: string): string {
  const raw = String(proxyUrl || '').trim();
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    const hostPort = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    if (parsed.protocol.startsWith('socks')) return `SOCKS5 ${hostPort}`;
    return `PROXY ${hostPort}`;
  } catch {
    return `PROXY ${raw.replace(/^[a-z]+:\/\//i, '')}`;
  }
}

async function closeSessionConnections(targetSession: Session): Promise<void> {
  await (targetSession as any).closeAllConnections?.();
}

// ── 用户自定义强制代理/强制直连域名（存放在数据目录，不进 settings.json）───────

interface CustomDomains {
  forceProxy: string[];
  forceDirect: string[];
}

let customDomainsCache: { data: CustomDomains; mtimeMs: number | null } | null = null;

function getCustomDomainsFilePath(): string {
  return DataPathManager.getInstance().getFilePath(CUSTOM_DOMAINS_FILE);
}

export function getCustomDomains(): CustomDomains {
  const filePath = getCustomDomainsFilePath();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {}

  if (!stat) return { forceProxy: [], forceDirect: [] };
  if (customDomainsCache && customDomainsCache.mtimeMs === stat.mtimeMs) return customDomainsCache.data;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const data: CustomDomains = {
      forceProxy: Array.isArray(parsed.forceProxy) ? parsed.forceProxy : [],
      forceDirect: Array.isArray(parsed.forceDirect) ? parsed.forceDirect : [],
    };
    customDomainsCache = { data, mtimeMs: stat.mtimeMs };
    return data;
  } catch {
    return { forceProxy: [], forceDirect: [] };
  }
}

export function setCustomDomains(type: 'forceProxy' | 'forceDirect', domains: string[]): CustomDomains {
  const current = getCustomDomains();
  const next: CustomDomains = { ...current, [type]: Array.isArray(domains) ? domains : [] };

  const filePath = getCustomDomainsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
  customDomainsCache = null; // 下次读取时按新文件的 mtime 重新加载
  return next;
}

// ── 中国大陆域名白名单（PAC 直连名单）───────────────────────────────────────

interface WhitelistCache {
  mapJson: string;
  version: string;
  count: number;
  /** 数据目录下缓存文件的 mtime；为 null 表示本地还没有名单文件 */
  mtimeMs: number | null;
}

let whitelistCache: WhitelistCache | null = null;
/** 名单下载的共享 in-flight promise，避免多个窗口/session 同时触发重复下载 */
let fetchPromise: Promise<{ success: boolean; meta?: any; error?: string }> | null = null;

function emptyWhitelistCache(): WhitelistCache {
  return { mapJson: '{}', version: '', count: 0, mtimeMs: null };
}

/** 数据目录下没有名单文件时，后台静默拉取一次（不阻塞当前 PAC 脚本生成） */
function triggerBackgroundFetch(): void {
  ensureWhitelistReady()
    .then((result) => {
      if (result.success) console.log('[PAC] 中国大陆域名白名单已就绪', result.meta || '(已存在)');
      else console.warn('[PAC] 自动拉取白名单失败:', result.error);
    })
    .catch(() => {});
}

/** 解析 SwitchyOmega Conditions（AutoProxy 白名单）格式，提取域名和版本号 */
export function parseSwitchyOmegaList(raw: string): { domains: string[]; version: string } {
  const lines = raw.split(/\r?\n/);
  let version = '';
  const domains: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('[')) continue;
    if (t.startsWith(';')) {
      const m = t.match(/Update @ (.+)/);
      if (m) version = m[1].trim();
      continue;
    }
    if (/^[0-9]/.test(t)) continue; // 内网/局域网 IP 段，已在 PAC 里单独处理
    if (t.startsWith('*.')) {
      const d = t.slice(2).toLowerCase();
      if (d && d.indexOf('*') === -1) domains.push(d);
    }
  }
  return { domains: Array.from(new Set(domains)), version };
}

function getWhitelistCacheFilePath(): string {
  return DataPathManager.getInstance().getFilePath(WHITELIST_CACHE_FILE);
}

function getCnWhitelist(): WhitelistCache {
  const filePath = getWhitelistCacheFilePath();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {}

  if (!stat) {
    // 数据目录下还没有名单：先用空名单兜底（等同全部走代理），后台静默拉取一次
    triggerBackgroundFetch();
    return whitelistCache || emptyWhitelistCache();
  }

  if (whitelistCache && whitelistCache.mtimeMs === stat.mtimeMs) return whitelistCache;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { domains, version } = parseSwitchyOmegaList(raw);
    const map: Record<string, 1> = {};
    domains.forEach((d) => {
      map[d] = 1;
    });
    whitelistCache = { mapJson: JSON.stringify(map), version, count: domains.length, mtimeMs: stat.mtimeMs };
    return whitelistCache;
  } catch {
    // 文件存在但解析失败（可能损坏），同样兜底为空名单并尝试重新拉取
    triggerBackgroundFetch();
    return whitelistCache || emptyWhitelistCache();
  }
}

/** 通过独立 session 请求远程名单，显式走当前配置的代理地址（不依赖 PAC，避免鸡生蛋问题） */
async function fetchWhitelistRaw(): Promise<string> {
  const { session, net } = await import('electron');
  const settings = SettingManager.getInstance().getAll();
  const proxyUrl = String(settings.proxyUrl || '').trim();
  const useProxy = !!(settings.proxyEnabled && proxyUrl);

  const fetchSession = session.fromPartition(`pac-list-update-${Date.now()}`, { cache: false });
  if (useProxy) {
    await fetchSession.setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<-loopback>' });
  } else {
    await fetchSession.setProxy({ mode: 'direct' });
  }

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: WHITELIST_URL, session: fetchSession });
    let data = '';
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error('下载超时（15s）'));
    }, 15000);

    req.on('response', (res: any) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf-8');
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve(data);
      });
      res.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

async function performWhitelistFetch(): Promise<{ success: boolean; meta?: any; error?: string }> {
  try {
    const raw = await fetchWhitelistRaw();
    const { domains, version } = parseSwitchyOmegaList(raw);
    if (domains.length === 0) throw new Error('解析结果为空，名单格式可能已变化');

    const filePath = getWhitelistCacheFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, raw, 'utf-8');
    whitelistCache = null; // 强制下次按新文件重新解析

    const meta = { version: version || new Date().toISOString(), count: domains.length, updatedAt: Date.now() };
    return { success: true, meta };
  } catch (e: any) {
    return { success: false, error: e?.message || '更新失败' };
  }
}

/** 手动触发：无条件重新拉取最新名单（设置页"更新名单"按钮用） */
export function updateCnWhitelist(): Promise<{ success: boolean; meta?: any; error?: string }> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = performWhitelistFetch().finally(() => {
    fetchPromise = null;
  });
  return fetchPromise;
}

/** 仅在数据目录下还没有名单文件时才下载：首次切到 PAC 模式 / 懒加载兜底触发用 */
export function ensureWhitelistReady(): Promise<{ success: boolean; meta?: any; error?: string }> {
  const filePath = getWhitelistCacheFilePath();
  if (fs.existsSync(filePath)) return Promise.resolve({ success: true });
  return updateCnWhitelist();
}

/** 名单信息直接从数据目录下的文件读取，不再单独存一份元数据到 settings.json */
export function getPacListInfo(): PacListInfo {
  const fetching = fetchPromise !== null;
  const filePath = getWhitelistCacheFilePath();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {}

  if (!stat) return { version: '', count: 0, updatedAt: null, source: 'none', fetching };
  const whitelist = getCnWhitelist();
  return { version: whitelist.version, count: whitelist.count, updatedAt: stat.mtimeMs, source: 'remote', fetching };
}
