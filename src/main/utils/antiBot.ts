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

/**
 * 命中验证码时弹出一个可见窗口（复用同一持久化分区），等待用户手动处理完成。
 * 只要分区一致，这里手动过一次验证之后，无头窗口共享同一份 Cookie，后续大概率不会再被拦。
 * 用户中途关掉弹出的窗口视为放弃，直接返回 false。
 */
export async function escalateToVisibleForManualSolve(
  url: string,
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
    console.warn(`[AntiBot] 请在弹出的窗口中手动完成验证，最长等待 ${Math.round(timeoutMs / 1000)}s`);

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
