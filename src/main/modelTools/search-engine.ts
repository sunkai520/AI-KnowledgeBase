// src/search-engine.ts
import { Page } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { browserManager } from '../utils/browserManager';
import { parsePage, extractUrls, ParseResult } from './web-parser';
import { shouldForceDirectForSearchEngine } from '../utils/proxyConfig';
import { detectBlocked } from '../utils/antiBot';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;      // 摘要/描述
    source?: string;      // 来源网站
}

export interface SearchOptions {
    /** 搜索引擎：bing、google、baidu、duckduckgo、sogou */
    engine?: 'bing' | 'google' | 'baidu' | 'duckduckgo' | 'sogou';
    /** 结果数量 */
    limit?: number;
    /** 是否抓取每个结果的详细内容 */
    fetchContent?: boolean;
    /** 等待时间 */
    waitTime?: number;
    /** 调试模式 */
    debug?: boolean;
    /** 代理地址，如 'http://127.0.0.1:7890'；不传则使用系统设置里的代理模式 */
    proxy?: string;
    /** 持久化会话分区，默认 'persist:ai-search'；同一分区共享 Cookie/登录态，越用越不容易触发验证码 */
    partition?: string;
}

export interface SearchResponse {
    success: boolean;
    query: string;
    results: SearchResult[];
    contents?: ParseResult[];  // 如果 fetchContent=true
    error?: string;
}

/**
 * 联网搜索
 * @param query 搜索关键词
 * @param options 配置选项
 */
export async function webSearch({
    query,
    limit = 10,
    options = {}
}: {
    query: string;
    limit?: number;
    options?: SearchOptions;
}
): Promise<SearchResponse> {
    const opts = {
        engine: 'sogou' as const,
        limit: limit,
        fetchContent: false,
        waitTime: 3000,
        debug: false,
        proxy: undefined as string | undefined,
        partition: 'persist:ai-search',
        ...options
    };
    console.log(opts,"opts");
    // 百度是国内站点：直连模式下保持原来的强制直连；全局/PAC 模式尊重用户设置
    const forceDirect = shouldForceDirectForSearchEngine(opts.engine, opts.proxy);
    const { page, window: win } = await browserManager.newPage({
        headless: !opts.debug,
        show: opts.debug,
        offscreen: !opts.debug,
        width: 1920,
        height: 1080,
        proxy: opts.proxy,
        noProxy: forceDirect,
        partition: opts.partition
    });

    try {
        // 构建搜索URL
        const searchUrl = buildSearchUrl(opts.engine, query);
        console.log(`[Search] 使用 ${opts.engine} 搜索: "${query}"`);

        // 反检测设置（指纹伪装统一在 browserManager.newPage 内注入，这里只补 UA 和请求头）
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

        // Cookie 预热：百度先访问首页拿到 BAIDUID 等 Cookie，再去搜索页，避免空 Cookie 直击 /s 触发验证码
        if (opts.engine === 'baidu') {
            try {
                await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(r => setTimeout(r, 600 + Math.random() * 800)); // 拟人停顿
            } catch (e: any) {
                console.warn(`[Search] 百度首页预热失败（忽略，继续搜索）: ${e.message}`);
            }
        }

        // 访问搜索页面
        try {
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (navErr: any) {
            console.error(`[Search] 导航失败: ${navErr.message}`);
            throw navErr;
        }

        // 智能等待：等搜索结果出现，最长等 waitTime，超时也继续
        const resultSelectors: Record<string, string> = {
            google: 'a[href] h3',
            bing: '.b_algo',
            baidu: '.result, .c-container',
            duckduckgo: '.result, .result__body',
            sogou: '.vrwrap, .rb'
        };
        const waitSelector = resultSelectors[opts.engine];
        if (waitSelector) {
            await page.waitForSelector(waitSelector, { timeout: opts.waitTime }).catch(() => {});
        } else {
            await new Promise(r => setTimeout(r, opts.waitTime));
        }

        let finalUrl = page.url();
        console.log(`[Search] 实际URL: ${finalUrl}`);

        // 处理可能的验证码或弹窗（简单处理）
        await handleAntiBot(page);

        let html = await page.content();
        console.log(`[Search] HTML长度: ${html.length}, 片段: ${html.slice(0, 300).replace(/\s+/g, ' ')}`);

        // 验证码/安全验证检测：人工处理弹窗已禁用，命中后不再弹可见窗口，直接判定失败并建议切换引擎
        if (detectBlocked(finalUrl, html)) {
            const fallbackChain: Record<string, string> = {
                baidu: 'sogou',
                sogou: 'google',
                google: 'duckduckgo',
                duckduckgo: 'bing',
                bing: 'baidu'
            };
            const suggest = fallbackChain[opts.engine] || 'baidu';
            const msg = `${opts.engine} 搜索触发了安全验证（验证码），本次未获取到结果。请改用 ${suggest} 搜索引擎重试：调用本工具时把 engine 参数设为 "${suggest}"。`;
            console.warn(`[Search] ${msg}`);
            return { success: false, query, results: [], error: msg };
        }

        let results = parseSearchResults(html, opts.engine, opts.limit);
        console.log(`[Search] 第1页 找到 ${results.length} 条结果`);

        // Google 专属：提取 AI 概览，合并进 results 首条
        if (opts.engine === 'google') {
            const overview = await extractGoogleAIOverview(page);
            if (overview) {
                results.unshift({
                    title: 'AI 概览',
                    url: searchUrl,
                    snippet: overview,
                    source: 'Google AI Overview',
                });
            }
        }

        // 分页翻页（三个引擎统一逻辑）
        if (results.length < opts.limit) {
            const maxPages = Math.ceil(opts.limit / 10);
            let pageNum = 2;

            while (results.length < opts.limit && pageNum <= maxPages) {
                let nextPageUrl: string | null = null;

                if (opts.engine === 'google') {
                    // Google 需要从 DOM 取含 session token 的 href，不能直接构造
                    nextPageUrl = await page.evaluate(() => {
                        const el = document.querySelector('#pnnext') as HTMLAnchorElement | null;
                        if (el) return el.href;
                        const fb = document.querySelector('a[aria-label="下一页"], a[aria-label="Next"]') as HTMLAnchorElement | null;
                        return fb ? fb.href : null;
                    }).catch(() => null);

                } else if (opts.engine === 'baidu') {
                    // 百度：pn 参数直接构造，每页 10 条
                    nextPageUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${(pageNum - 1) * 10}`;

                } else if (opts.engine === 'bing') {
                    // Bing：first 参数直接构造，每页 10 条
                    nextPageUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${(pageNum - 1) * 10 + 1}`;

                } else if (opts.engine === 'duckduckgo') {
                    // DuckDuckGo（html 版）：s 参数为结果偏移量，每页约 30 条
                    nextPageUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${(pageNum - 1) * 30}`;

                } else if (opts.engine === 'sogou') {
                    // 搜狗：page 参数直接构造，每页 10 条
                    nextPageUrl = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${pageNum}`;
                }

                console.log(`[Search][${opts.engine}] 第${pageNum}页 URL: ${nextPageUrl ?? '未获取到，停止翻页'}`);
                if (!nextPageUrl) break;

                try {
                    await page.goto(nextPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // 各引擎等待结果出现
                    const waitSel = resultSelectors[opts.engine] || 'a[href] h3';
                    await page.waitForSelector(waitSel, { timeout: opts.waitTime }).catch(() => {
                        console.log(`[Search][${opts.engine}] 第${pageNum}页 等待选择器超时，继续解析`);
                    });

                    const nextHtml = await page.content();
                    console.log(`[Search][${opts.engine}] 第${pageNum}页 HTML: ${nextHtml.length} bytes, URL: ${page.url()}`);

                    const needed = opts.limit - results.length;
                    const nextResults = parseSearchResults(nextHtml, opts.engine, needed);

                    const seenUrls = new Set(results.map(r => r.url));
                    const fresh = nextResults.filter(r => !seenUrls.has(r.url));
                    console.log(`[Search][${opts.engine}] 第${pageNum}页 解析 ${nextResults.length} 条，新增 ${fresh.length} 条，累计 ${results.length + fresh.length} 条`);

                    results = [...results, ...fresh];
                } catch (e: any) {
                    console.error(`[Search][${opts.engine}] 第${pageNum}页加载失败: ${e.message}`);
                    break;
                }

                pageNum++;
            }
        }

        console.log(`[Search] 最终结果 ${results.length} 条`);

        // 可选：抓取每个结果的详细内容
        let contents: ParseResult[] | undefined;
        if (opts.fetchContent && results.length > 0) {
            console.log(`[Search] 正在抓取 ${results.length} 个页面的详细内容...`);
            contents = await fetchResultsContent(results, opts);
        }
        console.log(`[Search] 搜索完成`,results);
        return { success: true, query, results, contents };

    } catch (error: any) {
        return {
            success: false,
            query,
            results: [],
            error: error.message
        };
    } finally {
        if (!win.isDestroyed()) {
            if (opts.debug) await new Promise(r => setTimeout(r, 5000));
            win.close();
        }
    }
}

/**
 * 构建搜索引擎URL
 */
function buildSearchUrl(engine: string, query: string): string {
    const encoded = encodeURIComponent(query);

    switch (engine) {
        case 'bing':
            return `https://www.bing.com/search?q=${encoded}`;
        case 'google':
            return `https://www.google.com/search?q=${encoded}`;
        case 'baidu':
            return `https://www.baidu.com/s?wd=${encoded}`;
        case 'duckduckgo':
            return `https://html.duckduckgo.com/html/?q=${encoded}`;
        case 'sogou':
            return `https://www.sogou.com/web?query=${encoded}`;
        default:
            return `https://www.sogou.com/web?query=${encoded}`;
    }
}

/**
 * 解析搜索结果（适配不同搜索引擎）
 */
function parseSearchResults(html: string, engine: string, limit: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    switch (engine) {
        case 'bing':
            // Bing 搜索结果选择器
            $('.b_algo, li.b_algo').each((i, elem) => {
                if (i >= limit) return false;

                const $el = $(elem);
                const titleEl = $el.find('h2 a, .b_title a').first();
                const title = titleEl.text().trim();
                const url = titleEl.attr('href') || '';
                const snippet = $el.find('.b_caption p, p').first().text().trim();

                if (title && url) {
                    results.push({
                        title,
                        url: cleanUrl(url),
                        snippet: snippet || title,
                        source: new URL(cleanUrl(url)).hostname
                    });
                }
                return;
            });
            break;

        case 'google': {
            const seen = new Set<string>();

            // --- Pass 1: 普通搜索结果（含 h3 的链接）---
            $('a[href]').each((_, elem) => {
                if (results.length >= limit) return false;

                const $a = $(elem);
                if (!$a.find('h3').length) return;

                let url = $a.attr('href') || '';
                if (!url.startsWith('http')) return;
                if (/google\.(com|cn|co\.)/.test(url)) return;

                try { url = cleanUrl(url); } catch { return; }
                if (seen.has(url)) return;
                seen.add(url);

                const title = $a.find('h3').text().trim();
                if (!title) return;

                // 纯结构提取 snippet：往上找第一个有多个 div 子节点的祖先，
                // 其中不含 <a> 的兄弟 div 就是描述行
                let snippet = '';
                let $node = $a.parent();
                for (let i = 0; i < 8; i++) {
                    const $parent = $node.parent();
                    if (!$parent.length) break;
                    const $children = $parent.children('div');
                    if ($children.length >= 2) {
                        $children.each((_, sib) => {
                            if ($(sib).find($a).length) return;
                            const t = $(sib).text().replace(/\s+/g, ' ').trim();
                            if (t.length > snippet.length) snippet = t;
                        });
                        if (snippet.length > 20) break;
                    }
                    $node = $parent;
                }

                try {
                    results.push({
                        title,
                        url,
                        snippet: snippet.slice(0, 300),
                        source: new URL(url).hostname
                    });
                } catch { /* 无效 URL 跳过 */ }
                return;
            });

            // --- Pass 2: 新闻卡片（整个 <a> 是卡片容器，无 h3，标题在叶节点 div 内）---
            $('a[href]').each((_, elem) => {
                if (results.length >= limit) return false;

                const $a = $(elem);
                if ($a.find('h3').length) return; // 已被 Pass1 处理

                let url = $a.attr('href') || '';
                if (!url.startsWith('http')) return;
                if (/google\.(com|cn|co\.)/.test(url)) return;

                try { url = cleanUrl(url); } catch { return; }
                if (seen.has(url)) return;

                // 取 <a> 内所有叶节点 div 的文本，最长的就是新闻标题
                let title = '';
                $a.find('div').each((_, el) => {
                    const $el = $(el);
                    if ($el.children('div').length) return; // 只取叶节点
                    const t = $el.text().trim();
                    if (t.length > title.length) title = t;
                });

                // 标题过短说明不是新闻卡片（导航链接/图标等），跳过
                if (title.length < 15) return;

                seen.add(url);
                try {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: new URL(url).hostname
                    });
                } catch { /* 无效 URL 跳过 */ }
                return;
            });

            break;
        }

        case 'baidu':
            $('.result, .c-container').each((i, elem) => {
                if (results.length >= limit) return false;
                const $el = $(elem);

                const titleEl = $el.find('h3 a, .t a').first();
                const title = titleEl.text().trim();
                let url = titleEl.attr('href') || '';
                const snippet = $el.find('.summary-text_560AW, .c-abstract, .content-left_1THTd').first().text().trim();

                if (title) {
                    results.push({
                        title,
                        url: url.startsWith('http') ? cleanUrl(url) : url,
                        snippet: snippet || title,
                        source: 'baidu.com'
                    });
                }
                return;
            });
            break;

        case 'duckduckgo':
            // html.duckduckgo.com/html/ 无 JS 版本，结构简单固定
            $('.result, .web-result').each((i, elem) => {
                if (results.length >= limit) return false;
                const $el = $(elem);

                const titleEl = $el.find('.result__a, .result__title a').first();
                const title = titleEl.text().trim();
                let url = titleEl.attr('href') || '';
                const snippet = $el.find('.result__snippet').first().text().trim();

                if (title && url) {
                    try { url = cleanUrl(url); } catch { /* 保留原始 url */ }
                    results.push({
                        title,
                        url,
                        snippet: snippet || title,
                        source: (() => { try { return new URL(url).hostname; } catch { return 'duckduckgo.com'; } })()
                    });
                }
                return;
            });
            break;

        case 'sogou':
            $('.vrwrap, .rb').each((i, elem) => {
                if (results.length >= limit) return false;
                const $el = $(elem);

                const titleEl = $el.find('.vr-title a, h3 a').first();
                const title = titleEl.text().trim();
                const url = titleEl.attr('href') || '';
                const snippet = $el.find('.str-text-info, .space-txt, .str_info, .fz-mid').first().text().trim();

                if (title && url) {
                    // 搜狗结果链接是站内跳转（/link?url=...），保留原样，交由页面自身重定向
                    const absUrl = url.startsWith('http') ? url : `https://www.sogou.com${url}`;
                    results.push({
                        title,
                        url: absUrl,
                        snippet: snippet || title,
                        source: 'sogou.com'
                    });
                }
                return;
            });
            break;
    }

    return results;
}

/**
 * 抓取每个搜索结果的详细内容
 */
async function fetchResultsContent(
    results: SearchResult[],
    options: SearchOptions
): Promise<ParseResult[]> {
    const contents: ParseResult[] = [];

    // 限制并发数，避免被封
    const concurrency = 3;
    const queue = [...results];

    while (queue.length > 0) {
        const batch = queue.splice(0, concurrency);
        const promises = batch.map(r =>
            parsePage(r.url, {
                waitTime: 3000,
                debug: options.debug,
                proxy: options.proxy,
                // 批量并发抓取时不弹可见窗口手动过验证，避免多个弹窗同时冒出来
                allowEscalate: false
            }).catch(e => ({
                success: false,
                url: r.url,
                title: '',
                markdown: '',
                links: [],
                error: e.message
            }))
        );

        const batchResults = await Promise.all(promises);
        contents.push(...batchResults);

        // 延迟，避免请求过快
        if (queue.length > 0) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return contents;
}

/**
 * 验证码/安全验证页检测：命中返回 true，调用方据此提示模型改用其他搜索引擎
 */
/**
 * 处理反爬机制（简单版）
 */
async function handleAntiBot(page: Page): Promise<void> {
    try {
        // 检查是否有验证码提示
        const hasCaptcha = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            // 精确匹配 CAPTCHA 特征，避免误报普通含"验证"文字的页面
            return text.includes('unusual traffic') ||
                text.includes('i\'m not a robot') ||
                text.includes('我不是机器人') ||
                !!document.querySelector('#captcha, .g-recaptcha, iframe[src*="recaptcha"]');
        });

        if (hasCaptcha) {
            console.warn('[Search] 可能遇到验证码，等待手动处理...');
            // 调试模式下等待更久
            await new Promise(r => setTimeout(r, 10000));
        }

        // 尝试关闭弹窗
        await page.evaluate(() => {
            const closeBtns = document.querySelectorAll('button[aria-label="Close"], .close, .dismiss');
            closeBtns.forEach((btn: any) => btn.click());
        });

    } catch (e) {
        // 忽略错误
    }
}

/**
 * 清理URL（移除跟踪参数）
 */
function cleanUrl(url: string): string {
    try {
        const u = new URL(url);
        // 移除常见跟踪参数
        const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];
        trackingParams.forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch {
        return url;
    }
}

// ============ Google AI 概览提取 ============

/**
 * 提取 Google 搜索结果页的 AI 概览内容
 * 需要在 page 已导航到 Google 结果页后调用
 */
async function extractGoogleAIOverview(page: Page): Promise<string | null> {
    try {
        // 1. 轮询等待流式内容稳定，最多 3 秒
        const deadline = Date.now() + 3000;
        let prevLen = 0;
        let stableCount = 0;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 400));
            const len: number = await page.evaluate(() => {
                const el = document.querySelector('[data-streaming-container]') as HTMLElement | null;
                return el ? el.innerText.length : 0;
            }).catch(() => 0);
            if (len > 30 && Math.abs(len - prevLen) < 10) {
                if (++stableCount >= 2) break; // 连续两次稳定，认为写入完成
            } else {
                stableCount = 0;
            }
            prevLen = len;
        }

        // 超时或什么都没加载到，直接跳过
        if (prevLen < 30) {
            console.log('[AIOverview] 3s 内未获取到内容，跳过');
            return null;
        }

        // 2. 排除错误状态
        const hasContent = await page.evaluate(() => {
            const streaming = document.querySelector('[data-streaming-container]') as HTMLElement | null;
            if (!streaming) return false;
            const txt = streaming.innerText.trim();
            return txt.length > 30 &&
                !txt.includes('无法针对此搜索生成') &&
                !txt.includes('目前无法生成') &&
                !txt.includes('Unable to generate');
        }).catch(() => false);

        if (!hasContent) {
            console.log('[AIOverview] AI 概览不可用，跳过');
            return null;
        }

        // 3. 查找展开按钮（多个备用选择器）
        const expandSelectors = [
            '[aria-controls="m-x-content"]',
            'button[aria-expanded="false"]',
            '[jsname="V3qe9d"] button',
        ];
        let clicked = false;
        for (const sel of expandSelectors) {
            try {
                const btn = await page.$(sel);
                if (btn) {
                    const isVisible = await page.evaluate((el: Element) => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, btn);
                    if (isVisible) {
                        await btn.click();
                        console.log(`[AIOverview] 点击展开按钮: ${sel}`);
                        clicked = true;
                        break;
                    }
                }
            } catch (_) {}
        }
        if (clicked) {
            await new Promise(r => setTimeout(r, 1000)); // 等展开动画
        }

        // 5. 按优先级提取文本，克隆节点后先移除 style/script 避免 CSS 变量混入
        const text: string = await page.evaluate(() => {
            const clean = (el: HTMLElement): string => {
                const clone = el.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('style, script, [aria-hidden="true"], svg').forEach(n => n.remove());
                return clone.innerText.replace(/\s{3,}/g, '\n\n').trim();
            };
            // 优先取展开后的完整内容块
            const expanded = document.getElementById('m-x-content');
            if (expanded && expanded.innerText.trim().length > 50) {
                return clean(expanded);
            }
            // 次选：流式容器
            const streaming = document.querySelector('[data-streaming-container]') as HTMLElement | null;
            if (streaming && streaming.innerText.trim().length > 30) {
                return clean(streaming);
            }
            // 兜底：整个 AI 概览容器
            const overview = document.querySelector('[jsname="V3qe9d"]') as HTMLElement | null;
            return overview ? clean(overview) : '';
        }).catch(() => '');

        if (!text || text.length < 20) return null;
        console.log(`[AIOverview] 提取成功，长度: ${text.length}`);
        return text;
    } catch (e: any) {
        console.warn('[AIOverview] 提取失败:', e.message);
        return null;
    }
}

// ============ 会话养号 ============

const engineHomepages: Record<string, string> = {
    bing: 'https://www.bing.com',
    google: 'https://www.google.com',
    baidu: 'https://www.baidu.com',
    duckduckgo: 'https://duckduckgo.com',
    sogou: 'https://www.sogou.com'
};

/**
 * 打开一个可见窗口供用户手动"养号"：正常搜索几次、遇到验证码手动过一下。
 * 使用与 webSearch 相同的持久化分区（默认 persist:ai-search），养熟后无头搜索会一并受益。
 * 窗口不自动关闭，用户用完自行关闭即可。
 */
export async function warmupSearchSession(
    engine: SearchOptions['engine'] = 'baidu',
    partition = 'persist:ai-search'
): Promise<{ success: boolean; message: string }> {
    const homepage = engineHomepages[engine as string] || engineHomepages.baidu;
    const { page, window: win } = await browserManager.newPage({
        headless: false,
        show: true,
        offscreen: false,
        width: 1200,
        height: 900,
        partition
    });
    await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    win.show();
    win.focus();
    return {
        success: true,
        message: `已打开 ${engine}，请正常搜索几次、遇到验证码手动过一下，完成后关闭该窗口即可`
    };
}

// ============ 便捷函数 ============

/**
 * 快速搜索（只返回结果，不抓详情）
 */
export async function quickSearch(query: string, limit = 5): Promise<SearchResult[]> {
    const res = await webSearch({ query, limit, options: { limit, fetchContent: false } });
    return res.success ? res.results : [];
}

/**
 * 深度搜索（返回结果+详细内容）
 */
export async function deepSearch(query: string, limit = 3): Promise<SearchResponse> {
    return webSearch({
        query, limit, options: {
            limit,
            fetchContent: true,
            waitTime: 8000
        }
    });
}
