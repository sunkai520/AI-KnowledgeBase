// src/web-parser.ts
import { Page } from 'puppeteer-core';
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { browserManager } from '../utils/browserManager';
import { detectBlocked, escalateToVisibleForManualSolve } from '../utils/antiBot';

// 和 search-engine.ts 保持一致的伪装 UA：Electron 默认 UA 带 "Electron/x.y.z"，很容易被反爬识别拦截
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ParseResult {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  links: string[];
  error?: string;
}

export interface ParseOptions {
  waitTime?: number;
  extractLinks?: boolean;
  debug?: boolean;
  sameDomainOnly?: boolean;
  /** 代理地址，透传给 browserManager */
  proxy?: string;
  /** 持久化会话分区，默认 'persist:ai-parse'；命中验证码需要人工过验证时，必须和弹出的可见窗口共享同一分区才能把 Cookie 带回来 */
  partition?: string;
  /** 命中反爬验证码时是否弹出可见窗口等待人工处理，默认 true；批量并发抓取场景应传 false，避免同时弹多个窗口 */
  allowEscalate?: boolean;
}

/**
 * 提取页面中的所有链接
 */
export async function extractUrls(
  targetUrl: string,
  options: ParseOptions = {}
): Promise<string[]> {
  const isDebug = options.debug || false;

  const { page, window: win } = await browserManager.newPage({
    headless: !isDebug,
    show: isDebug,
    offscreen: !isDebug,
    width: 1280,
    height: 800,
    proxy: options.proxy
  });

  try {
    await page.setUserAgent(DESKTOP_UA);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // 智能等待：内容稳定（连续两轮字数不再增长）即继续，最长等 waitTime
    await waitForContentStable(page, options.waitTime ?? 2000);

    const html = await page.content();
    return extractLinksFromHtml(html, targetUrl, options.sameDomainOnly);
  } finally {
    if (!win.isDestroyed()) {
      if (isDebug) await new Promise(r => setTimeout(r, 3000));
      win.close();
    }
  }
}

/**
 * 解析页面内容为Markdown
 */
export async function parsePage(
  targetUrl: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const opts = {
    waitTime: 3000,
    extractLinks: true,
    partition: 'persist:ai-parse',
    allowEscalate: true,
    ...options
  };
  const isDebug = opts.debug || false;

  const { page, window: win } = await browserManager.newPage({
    headless: !isDebug,
    show: isDebug,
    offscreen: !isDebug,
    width: 1920,
    height: 1080,
    proxy: opts.proxy,
    partition: opts.partition
  });

  try {
    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      const type = req.resourceType();
      if (!isDebug && ['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 伪装成普通桌面 Chrome：Electron 默认 UA 带 "Electron/x.y.z"，很多网站会因此拦截或返回残缺内容
    await page.setUserAgent(DESKTOP_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

    console.log(`[WebParser] ${isDebug ? '【调试】' : ''}解析: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // 智能等待：内容稳定（连续两轮字数不再增长）即继续，最长等 waitTime（调试模式给更长时间观察）
    await waitForContentStable(page, isDebug ? 8000 : (opts.waitTime ?? 3000));
    // 触发滚动懒加载的正文/图片，滚动结束后回到顶部
    await autoScroll(page, Math.min(opts.waitTime ?? 3000, 5000));
    // 给滚动触发的懒加载内容一点点结算时间
    await new Promise(r => setTimeout(r, 300));

    let finalUrl = page.url();
    let html = await page.content();

    // 命中验证码/安全验证拦截：可选升级为可见窗口等待人工处理
    if (detectBlocked(finalUrl, html)) {
      let solved = false;
      if (opts.allowEscalate) {
        console.warn(`[WebParser] 疑似触发反爬验证，弹出可见窗口等待手动处理...`);
        solved = await escalateToVisibleForManualSolve(finalUrl, opts.partition!, opts.proxy, undefined);
        if (solved) {
          await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
          await waitForContentStable(page, opts.waitTime ?? 3000);
          finalUrl = page.url();
          html = await page.content();
        }
      }
      if (!solved || detectBlocked(finalUrl, html)) {
        return {
          success: false,
          url: targetUrl,
          title: '',
          markdown: '',
          links: [],
          error: opts.allowEscalate ? '触发反爬验证，人工处理未通过或超时' : '触发反爬验证，未获取到内容'
        };
      }
    }

    let title = await page.title();

    const links = opts.extractLinks
      ? extractLinksFromHtml(html, targetUrl, true)
      : [];

    // 优先用 Readability（Firefox 阅读模式同款算法）提取正文，比手写的候选选择器更准；
    // 但 Readability 是为"单篇文章"设计的：分类页/列表页里一堆并列的摘要卡片，
    // 它会按兄弟节点打分，只保留分数过线的几个，导致列表被裁剪（比如 10 篇摘要只留 6 篇）。
    // 用启发式候选区块的字数兜底判断：如果 Readability 明显比启发式抓得少，大概率是这种情况，改用启发式的结果。
    const articleContent = await extractWithReadability(page);
    const candidateHtml = selectMainContentHtml(html);
    const candidateTextLength = cheerio.load(candidateHtml).text().trim().length;

    let markdown: string;
    if (articleContent && articleContent.textLength >= candidateTextLength * 0.85) {
      if (articleContent.title) title = articleContent.title;
      markdown = convertToMarkdown(articleContent.content);
      console.log(`[WebParser] Readability 命中正文，正文长度 ${articleContent.textLength}`);
    } else if (candidateHtml) {
      if (articleContent) {
        console.log(`[WebParser] Readability 提取内容（${articleContent.textLength}字）明显少于启发式候选区块（${candidateTextLength}字），疑似列表页被裁剪，改用启发式提取`);
      } else {
        console.log(`[WebParser] Readability 未识别为文章，降级为启发式提取`);
      }
      markdown = convertToMarkdown(candidateHtml);
    } else {
      markdown = extractMarkdown(html);
    }

    return {
      success: true,
      url: targetUrl,
      title,
      markdown,
      links
    };

  } catch (error: any) {
    return {
      success: false,
      url: targetUrl,
      title: '',
      markdown: '',
      links: [],
      error: error.message
    };
  } finally {
    if (!win.isDestroyed()) {
      if (isDebug) await new Promise(r => setTimeout(r, 5000));
      win.close();
    }
  }
}

/**
 * 等待页面内容"稳定"：轮询 body 文本长度，连续两轮（1s）不再增长就提前结束，
 * 比固定字数阈值更适应异步渲染的 SPA —— 静态页面很快通过，慢加载页面等到真正吐完内容为止
 */
async function waitForContentStable(page: Page, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastLength = -1;
  let stableRounds = 0;

  while (Date.now() - start < timeoutMs) {
    const len: number = await page
      .evaluate(() => document.body?.innerText?.trim().length || 0)
      .catch(() => 0);

    if (len > 200 && len === lastLength) {
      stableRounds++;
      if (stableRounds >= 2) return;
    } else {
      stableRounds = 0;
    }
    lastLength = len;
    await new Promise(r => setTimeout(r, 500));
  }
}

/**
 * 自动向下滚动触发懒加载内容（图片/正文常见的滚动到可视区域才加载），
 * scrollHeight 连续几轮不再增长或超时就停止，最后滚回顶部再提取
 */
async function autoScroll(page: Page, maxDurationMs: number): Promise<void> {
  await page
    .evaluate(async (maxDuration: number) => {
      await new Promise<void>((resolve) => {
        const start = Date.now();
        let lastHeight = document.body.scrollHeight;
        let stableRounds = 0;

        const step = () => {
          window.scrollBy(0, window.innerHeight);
          const newHeight = document.body.scrollHeight;

          if (newHeight === lastHeight) {
            stableRounds++;
          } else {
            stableRounds = 0;
            lastHeight = newHeight;
          }

          if (stableRounds >= 3 || Date.now() - start > maxDuration) {
            window.scrollTo(0, 0);
            resolve();
            return;
          }
          setTimeout(step, 300);
        };
        step();
      });
    }, maxDurationMs)
    .catch(() => {});
}

/**
 * 用 @mozilla/readability（Firefox 阅读模式同款算法）在页面里提取正文
 * 直接注入已渲染完的 Puppeteer 页面执行，避免用 jsdom 二次解析 HTML 字符串
 * 判断为"不像文章"（首页/列表页等）或提取失败时返回 null，由调用方降级到启发式提取
 */
async function extractWithReadability(
  page: Page
): Promise<{ title: string; content: string; textLength: number } | null> {
  try {
    await page.addScriptTag({ path: require.resolve('@mozilla/readability/Readability.js') });

    const article = await page.evaluate(() => {
      try {
        // Readability 会破坏性修改传入的 DOM，克隆一份避免污染页面池里被复用的真实页面
        const clone = document.cloneNode(true) as Document;
        // @ts-ignore Readability 由上面注入的脚本挂在全局上
        const reader = new (window as any).Readability(clone);
        return reader.parse();
      } catch (e) {
        return null;
      }
    });

    if (!article || !article.content || !article.textContent || article.textContent.trim().length < 200) {
      return null;
    }

    return { title: article.title || '', content: article.content, textLength: article.textContent.length };
  } catch (e: any) {
    console.warn(`[WebParser] Readability 注入/执行失败，降级启发式提取: ${e.message}`);
    return null;
  }
}

// ============ 纯 Cheerio 实现 ============

function extractLinksFromHtml(html: string, baseUrl: string, sameDomainOnly?: boolean): string[] {
  const $ = cheerio.load(html);
  const urls: Set<string> = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, elem) => {
    const href = $(elem).attr('href');
    if (!href) return;
    
    try {
      const absolute = new URL(href, baseUrl).href;
      const parsed = new URL(absolute);
      
      // 过滤文件
      if (absolute.match(/\.(pdf|jpg|png|gif|zip|exe|mp4|svg)$/i)) return;
      if (sameDomainOnly && parsed.hostname !== base.hostname) return;
      
      urls.add(absolute);
    } catch (e) {}
  });

  return Array.from(urls);
}

/**
 * 启发式选出页面里内容最多的区域（候选选择器打分，取文本最长的一块），返回其内部 HTML。
 * 不负责转 Markdown，方便调用方拿到候选区块后先做字数对比（比如判断 Readability 是否漏抓了内容）。
 */
function selectMainContentHtml(html: string): string {
  const $ = cheerio.load(html);

  // 清理无用标签
  $('script, style, nav, footer, aside, header, .ads, .sidebar, .comments, .advertisement, #cookie-banner').remove();

  // 智能提取正文 - 找到内容最多的区域
  let bestContent = '';
  let maxTextLength = 0;

  const candidates = [
    'article', 'main', '.content', '.post-content', '.entry-content',
    '#content', '.article-body', '[role="main"]', '.main-content',
    '.post', '.entry', '.article'
  ];

  for (const selector of candidates) {
    $(selector).each((_, elem) => {
      const text = $(elem).text().trim();
      if (text.length > maxTextLength && text.length > 500) {
        maxTextLength = text.length;
        bestContent = $(elem).html() || '';
      }
    });
  }

  // 如果没找到，用 body 但清理导航等
  if (!bestContent) {
    $('body > header, body > nav, body > footer').remove();
    bestContent = $('body').html() || html;
  }

  return bestContent;
}

function extractMarkdown(html: string): string {
  return convertToMarkdown(selectMainContentHtml(html));
}

function convertToMarkdown(html: string): string {
  const service:any = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  });

  service.use(turndownPluginGfm.gfm);
  
  // 移除残余的无意义标签
  service.remove(['script', 'style', 'nav', 'footer', 'aside']);

  // 链接格式: [文本 (http://xxx)](http://xxx)
  service.addRule('linkWithUrl', {
    filter: (node: any) => {
      return node.nodeName === 'A' && node.getAttribute('href');
    },
    replacement: (content: string, node: any) => {
      const href = node.getAttribute('href');
      const text = content.trim();
      
      // 如果文本就是URL，简化显示
      if (!text || text === href || text.match(/^https?:\/\//)) {
        return `[${href}](${href})`;
      }
      
      // 否则: 文本 (URL)
      return `[${text} (${href})](${href})`;
    }
  });

  // 图片处理
  service.addRule('image', {
    filter: 'img',
    replacement: (content: string, node: any) => {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return src ? `![${alt}](${src})` : '';
    }
  });

  const $ = cheerio.load(html);
  
  // 移除空标签
  $('*:empty').remove();
  
  // 转换
  let markdown = service.turndown($.html());
  
  // 清理格式
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')      // 多余空行
    .replace(/^\s+|\s+$/g, '')       // 首尾空白
    .trim();

  return markdown;
}