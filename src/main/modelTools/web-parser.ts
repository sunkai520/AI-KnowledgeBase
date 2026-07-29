// src/web-parser.ts
import { Page } from 'puppeteer-core';
import TurndownService from 'turndown';
import * as turndownPluginGfm from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { browserManager } from '../utils/browserManager';

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
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // 智能等待：内容可见即继续，最长等 waitTime
    await page.waitForFunction(
      () => document.body && document.body.innerText.trim().length > 100,
      { timeout: options.waitTime ?? 2000 }
    ).catch(() => {});

    const html = await page.content();
    console.log(extractLinksFromHtml(html, targetUrl, options.sameDomainOnly))
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
  const opts = { waitTime: 3000, extractLinks: true, ...options };
  const isDebug = opts.debug || false;

  const { page, window: win } = await browserManager.newPage({
    headless: !isDebug,
    show: isDebug,
    offscreen: !isDebug,
    width: 1920,
    height: 1080,
    proxy: opts.proxy
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

    console.log(`[WebParser] ${isDebug ? '【调试】' : ''}解析: ${targetUrl}`);
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    // 智能等待：内容可见即继续，最长等 waitTime（调试模式给更长时间观察）
    await page.waitForFunction(
      () => document.body && document.body.innerText.trim().length > 200,
      { timeout: isDebug ? 8000 : (opts.waitTime ?? 3000) }
    ).catch(() => {});

    const html = await page.content();
    let title = await page.title();

    const links = opts.extractLinks
      ? extractLinksFromHtml(html, targetUrl, true)
      : [];

    // 优先用 Readability（Firefox 阅读模式同款算法）提取正文，比手写的候选选择器更准
    const articleContent = await extractWithReadability(page);
    let markdown: string;
    if (articleContent) {
      if (articleContent.title) title = articleContent.title;
      markdown = convertToMarkdown(articleContent.content);
      console.log(`[WebParser] Readability 命中正文，正文长度 ${articleContent.textLength}`);
    } else {
      console.log(`[WebParser] Readability 未识别为文章，降级为启发式提取`);
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

function extractMarkdown(html: string): string {
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

  return convertToMarkdown(bestContent);
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