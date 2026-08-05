// src/main/utils/antiBot.ts
// 反爬拦截检测 + 人工过验证升级逻辑，供 search-engine 和 web-parser 共用
import { browserManager } from './browserManager';

/**
 * 检测页面是否命中验证码/安全验证拦截。
 * 只认强信号：URL 跳转、页面 <title>、真实验证码控件标签（id/class/iframe属性），
 * 不再对正文全文做关键词匹配——否则搜索结果里恰好出现"验证码""我不是机器人"之类
 * 字样的摘要/新闻标题也会被误判为拦截页，导致无谓弹出人工处理窗口。
 */
export function detectBlocked(finalUrl: string, html: string): boolean {
  const url = (finalUrl || '').toLowerCase();
  // URL 跳转特征：百度安全验证(wappass/tuxing)、Google sorry 拦截页
  if (url.includes('wappass.baidu.com') ||
      url.includes('/static/captcha') ||
      url.includes('google.com/sorry') ||
      url.includes('/sorry/index')) {
    return true;
  }

  const raw = html || '';

  // 页面标题特征：拦截页标题一般是固定文案，比正文关键词匹配精准得多
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(raw);
  const title = (titleMatch?.[1] || '').trim().toLowerCase();
  if (title === '百度安全验证' || title.includes('unusual traffic from your computer')) {
    return true;
  }

  // 真实验证码控件：作为标签属性出现，而不是正文文案里偶然提到
  if (/id=["']captcha["']/i.test(raw) ||
      /class=["'][^"']*\bg-recaptcha\b/i.test(raw) ||
      /<iframe[^>]+src=["'][^"']*recaptcha/i.test(raw)) {
    return true;
  }

  return false;
}

// 按域名去重 + 全局排队：模型可能在一轮里并行发起多个搜索，若多个同时命中验证码，
// 不做去重的话会同时弹出好几个窗口。这里保证：
//  - 同一域名并发命中 -> 只弹一个窗口，其余调用等待并复用同一个处理结果；
//  - 不同域名命中 -> 排队串行弹出，一次只处理一个，不会同时炸出多个窗口。
const pendingEscalations = new Map<string, Promise<boolean>>();
let escalationQueue: Promise<void> = Promise.resolve();

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 命中验证码时弹出一个可见窗口（复用同一持久化分区），等待用户手动处理完成。
 * 只要分区一致，这里手动过一次验证之后，无头窗口共享同一份 Cookie，后续大概率不会再被拦。
 * 用户中途关掉弹出的窗口视为放弃，直接返回 false。
 */
export function escalateToVisibleForManualSolve(
  url: string,
  partition: string,
  proxy?: string,
  noProxy?: boolean,
  timeoutMs = 120000
): Promise<boolean> {
  const host = getHost(url);

  // 同域名已有窗口在处理中，直接复用其结果，不再新开窗口
  const existing = pendingEscalations.get(host);
  if (existing) {
    console.log(`[AntiBot] ${host} 已有验证窗口在处理，等待其结果复用...`);
    return existing;
  }

  // 不同域名：接到全局队列尾部，保证同一时刻只弹出一个窗口
  const task = escalationQueue.then(() =>
    doEscalate(url, host, partition, proxy, noProxy, timeoutMs)
  );
  // 无论本次任务成功/失败，队列都继续往下走，不被卡死
  escalationQueue = task.then(
    () => undefined,
    () => undefined
  );

  pendingEscalations.set(host, task);
  task.finally(() => {
    if (pendingEscalations.get(host) === task) pendingEscalations.delete(host);
  });

  return task;
}

async function doEscalate(
  url: string,
  host: string,
  partition: string,
  proxy?: string,
  noProxy?: boolean,
  timeoutMs = 120000
): Promise<boolean> {
  const { page: visPage, window: visWin } = await browserManager.newPage({
    headless: false,
    show: true,
    offscreen: false,
    width: 1200,
    height: 900,
    proxy,
    noProxy,
    partition
  });

  try {
    await visPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    visWin.show();
    visWin.focus();
    console.warn(`[AntiBot] 请在弹出的窗口中手动完成验证 (${host})，最长等待 ${Math.round(timeoutMs / 1000)}s`);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (visWin.isDestroyed()) return false;
      await new Promise(r => setTimeout(r, 2000));
      try {
        const curUrl = visPage.url();
        const curHtml = await visPage.content();
        if (!detectBlocked(curUrl, curHtml)) return true;
      } catch {
        // 页面可能正在导航，忽略本轮检测，下一轮重试
      }
    }
    return false;
  } finally {
    if (!visWin.isDestroyed()) visWin.close();
  }
}
