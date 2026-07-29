/**
 * browser-use-tools.mjs - 浏览器自动化工具模块 (ES Module 版本)
 * 基于原始 browser-use-cli.js 改造，每个操作为独立函数
 * 修改：优先使用本地 Chrome（加载插件），找不到时用 Playwright 自带的 Chromium
 */

 import { chromium, firefox, webkit } from 'playwright';
 import fs from 'fs';
 import fsp from 'fs/promises';
 import path from 'path';
 import os from 'os';
 import { fileURLToPath } from 'url';
 import { execSync } from 'child_process';
 import { SettingManager } from './settingManager';
//  const OSS = require('ali-oss');
// // 初始化 OSS 客户端
// const client = new OSS({
//   region: 'oss-cn-beijing.aliyuncs.com',
//   accessKeyId: process.env.OSS_ACCESS_KEY_ID,
//   accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
//   bucket: 'sktest222'
// });
// console.log('OSS 客户端初始化成功',client);
 // ES Module 中获取 __dirname 的替代方案
 const __filename = fileURLToPath(import.meta.url);
 const __dirname = path.dirname(__filename);
 
 const SESSION_DIR = path.join(os.tmpdir(), 'browser-use-sessions');
 const SESSION_FILE = path.join(SESSION_DIR, 'sessions.json');
 
 // ============ 内部状态管理 ============
 const browserInstances = new Map(); // 用于存储 Playwright 自带的 browser
 const contextInstances = new Map();
 // 每个 session 对应一组 tab：Map<session, Map<tabId, { page, note, createdAt }>>
 const tabInstances = new Map();
 // 每个 session 当前激活的 tabId
 const activeTabId = new Map();
 let tabCounter = 0;

 /**
  * 注册一个新 tab 到指定 session，并设为当前激活 tab。
  * 自动监听 page 的 close 事件：tab 被关闭（无论是模型主动关还是用户手动关）时
  * 从注册表移除；若关掉的正是当前激活 tab，回退到最后一个仍存活的 tab；
  * 若已无任何 tab，视为整个 session 失效，一并清理 context 映射，下次 open 会完整重启浏览器。
  */
 function registerTab(session, page, note) {
   if (!tabInstances.has(session)) tabInstances.set(session, new Map());
   const tabs = tabInstances.get(session);
   const id = `tab-${++tabCounter}`;
   tabs.set(id, { page, note: note || '', createdAt: Date.now() });
   activeTabId.set(session, id);

   page.on('close', () => {
     tabs.delete(id);
     if (activeTabId.get(session) !== id) return;
     const remaining = Array.from(tabs.keys());
     if (remaining.length > 0) {
       activeTabId.set(session, remaining[remaining.length - 1]);
     } else {
       activeTabId.delete(session);
       tabInstances.delete(session);
       contextInstances.delete(session);
     }
   });

   return id;
 }

 // ============ 工具函数 ============

 /**
  * 查找本地安装的 Chrome/Edge 浏览器可执行文件
  * 优先返回 Google Chrome，其次是 Edge
  */
 export function findLocalBrowser() {
   const platform = os.platform();
 
   if (platform === 'win32') {
     const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
     const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
     const localAppData = process.env.LOCALAPPDATA || '';
 
     const paths = [
       path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
       path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
       path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
       path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
       path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
     ];
     for (const p of paths) {
       if (p && fs.existsSync(p)) return p;
     }
   } else if (platform === 'darwin') {
     const paths = [
       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
     ];
     for (const p of paths) {
       if (fs.existsSync(p)) return p;
     }
   } else {
     try {
       const result = execSync('which google-chrome || which chromium-browser || which chromium || which chrome', {
         encoding: 'utf8'
       }).trim();
       return result || null;
     } catch (e) {
       return null;
     }
   }
   return null;
 }
 
 /**
  * 根据可执行文件路径判断浏览器 channel 类型
  */
 function getBrowserChannel(executablePath) {
   if (!executablePath) return null;
   const lower = executablePath.toLowerCase();
   if (lower.includes('chrome') && !lower.includes('edge')) return 'chrome';
   if (lower.includes('msedge') || lower.includes('edge')) return 'msedge';
   return null;
 }
 
 /**
  * 获取系统默认的 Chrome 用户数据目录
  */
 export function getDefaultChromeUserDataDir() {
   const platform = os.platform();
   const home = os.homedir();
 
   if (platform === 'win32') {
     return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
   } else if (platform === 'darwin') {
     return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
   } else {
     return path.join(home, '.config', 'google-chrome');
   }
 }



 
 async function ensureSessionDir() {
   try {
     await fsp.mkdir(SESSION_DIR, { recursive: true });
   } catch (e) {}
 }
 
 export async function loadSessions() {
   try {
     const data = await fsp.readFile(SESSION_FILE, 'utf-8');
     return JSON.parse(data);
   } catch {
     return {};
   }
 }
 
 export async function saveSessions(sessions) {
   await fsp.writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
 }
 
 async function getSession(sessionName = 'default', options = {}) {
   const sessions = await loadSessions();
 
   if (!sessions[sessionName]) {
     sessions[sessionName] = {
       name: sessionName,
       createdAt: new Date().toISOString(),
       browserType: options.browser || 'chromium',
       headless: options.headless !== false,
       executablePath: options.executablePath || null,
       userDataDir: null,
       state: 'closed',
       isUsingLocalChrome: false
     };
     await saveSessions(sessions);
   }
 
   return sessions[sessionName];
 }
 
 async function updateSession(sessionName, updates) {
   const sessions = await loadSessions();
   if (sessions[sessionName]) {
     sessions[sessionName] = {
       ...sessions[sessionName],
       ...updates
     };
     await saveSessions(sessions);
   }
 }
 


 // launchPersistentContext 在 userDataDir 被占用（真实 Chrome 正在运行）时可能长时间不返回，
 // 用超时把它兜住，好让调用方有机会降级到隔离目录，而不是无限等待/无声刷屏用户的真实浏览器
 async function launchWithTimeout(userDataDir, launchOptions, timeoutMs) {
   return await Promise.race([
     chromium.launchPersistentContext(userDataDir, launchOptions),
     new Promise((_, reject) =>
       setTimeout(() => reject(new Error(`启动浏览器超时（${timeoutMs}ms），数据目录可能被正在运行的 Chrome 占用`)), timeoutMs)
     ),
   ]);
 }

 export async function launchBrowser(sessionName, options = {}) {
  const headless = options.headless ?? false;

    // 若该 session 已有存活的浏览器，直接复用当前激活 tab（避免每次 openUrl 都整个关闭重开）
    if (contextInstances.has(sessionName)) {
      const context = contextInstances.get(sessionName);
      const tabs = tabInstances.get(sessionName);
      const activeId = activeTabId.get(sessionName);
      const activeEntry = tabs && activeId ? tabs.get(activeId) : null;

      if (activeEntry && !activeEntry.page.isClosed()) {
        return { context, page: activeEntry.page };
      }

      // context 还在，但没有可用的激活 tab（可能全部被关掉了）——在现有 context 里补开一个 tab，而不是整个重启浏览器
      try {
        const page = await context.newPage();
        registerTab(sessionName, page, options.note);
        return { context, page };
      } catch (e) {
        // context 已失效，清理后走下方重新创建
        contextInstances.delete(sessionName);
        tabInstances.delete(sessionName);
        activeTabId.delete(sessionName);
      }
    }

  // 优先级：选项传入 > 用户设置 > Playwright 自带 Chromium（不再自动探测本地浏览器）
  const settings = SettingManager.getInstance();
  const cfgExePath     = settings.get('browserExePath') || '';
  const cfgUserDataDir = settings.get('browserUserDataDir') || '';

  let executablePath = options.executablePath || (cfgExePath || undefined);
  let channel        = undefined;

  // 只有明确指定了可执行路径时，才判断 channel（避免自动探测占用本地 Chrome 数据目录）
  if (executablePath) {
    channel = getBrowserChannel(executablePath) || undefined;
  }

  // userDataDir：用户配置 > 临时目录（避免与正在运行的 Chrome 产生锁冲突）
  const defaultUserDataDir = path.join(os.tmpdir(), 'playwright-myai-profile', sessionName);
  let userDataDir = options.userDataDir || cfgUserDataDir || defaultUserDataDir;

  const launchOptions = {
    headless,
    channel,
    executablePath,
    viewport: { width: 1920, height: 1080 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  // 用户配置的数据目录如果是真实 Chrome 正在使用的 profile，Chrome 的单实例锁会导致
  // launchPersistentContext 卡住/失败——Chrome 会把这次启动请求转发给已经在跑的那个进程，
  // 表现为用户真实浏览器里不断弹出 about:blank 新标签页，而不是启动一个可被自动化控制的独立实例。
  // 这里加超时兜底：启动不出来就自动降级到隔离临时目录重试，避免刷屏用户的真实浏览器。
  let context;
  try {
    context = await launchWithTimeout(userDataDir, launchOptions, 15000);
  } catch (e) {
    if (userDataDir === defaultUserDataDir) throw e;
    console.warn(`浏览器数据目录启动失败（可能与正在运行的 Chrome 冲突），改用隔离临时目录: ${e.message}`);
    userDataDir = defaultUserDataDir;
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  const page = context.pages()[0] || await context.newPage();
    // 🔥 关键：在这里 set！
    contextInstances.set(sessionName, context);   // ✅ 存 context
    registerTab(sessionName, page, options.note);
  // 可选：基础反检测
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { context, page };
}
 
 export async function getPage(sessionName = 'default') {
   const tabs = tabInstances.get(sessionName);
   const activeId = activeTabId.get(sessionName);
   const entry = tabs && activeId ? tabs.get(activeId) : null;
   if (!entry) {
     throw new Error(`Session "${sessionName}" not found. Run "open" first.`);
   }
   return entry.page;
 }

 export async function closeSession(sessionName = 'default') {
   // 先尝试关闭 context（适用于本地 Chrome）
   const context = contextInstances.get(sessionName);
   if (context) {
     try {
       await context.close();
     } catch (e) {}
     contextInstances.delete(sessionName);
   }
   tabInstances.delete(sessionName);
   activeTabId.delete(sessionName);

   // 再尝试关闭 browser（适用于 Playwright 自带）
   const browser = browserInstances.get(sessionName);
   if (browser) {
     try {
       await browser.close();
     } catch (e) {}
     browserInstances.delete(sessionName);
   }
 
   await updateSession(sessionName, {
     state: 'closed'
   });
 }
 export async function getInteractiveElements(page, {
  highlight = true,
  includeShadowDOM = true,
  includeFrames = true
} = {}) {
  // 清理旧的高亮（移除统一容器 + 遗留单独元素）
  if (highlight) {
    await page.evaluate(() => {
      const container = document.getElementById('__browser_use_container__');
      if (container) container.remove();
      document.querySelectorAll('.__browser_use_highlight__').forEach(el => el.remove());
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          el.shadowRoot.querySelectorAll('.__browser_use_highlight__').forEach(e => e.remove());
        }
      });
    });
  }

  const colors = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FF8000', '#8000FF', '#0080FF', '#FF0080', '#80FF00', '#00FF80'
  ];

  // 主标注逻辑
  const annotateInContext = async (context, startIndex = 0) => {
    return await context.evaluate(([shouldHighlight, idx, colorList]) => {
      const interactiveSelectors = [
        'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
        '[contenteditable="true"]', '[contenteditable=""]',
        'video', 'audio',
        '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="dialog"]',
        '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="slider"]',
        '[role="menuitem"]', '[role="tab"]', '[role="option"]', '[role="switch"]',
        '[onclick]', '[tabindex]:not([tabindex="-1"])',
        'details', 'summary',
        '.modal', '.popup', '.dialog', '[class*="modal"]', '[class*="popup"]'
      ];

      // 用 WeakSet 以 DOM 节点本身做 key，避免 outerHTML 相同的不同元素被误判重复
      const seen = new WeakSet();
      const items = [];
      let index = idx;

      // 创建统一覆盖容器，挂到 <html> 而非 <body>，规避 body 的 CSS transform 破坏 fixed 定位
      let container = null;
      if (shouldHighlight) {
        container = document.getElementById('__browser_use_container__');
        if (!container) {
          container = document.createElement('div');
          container.id = '__browser_use_container__';
          container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 2147483647;
            overflow: visible;
          `;
          document.documentElement.appendChild(container);
        }
      }

      function processElement(el) {
        if (seen.has(el)) return;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.top < 0 || rect.left < 0) return;

        const tag = el.tagName?.toLowerCase() || '';
        const type = el.type || '';
        const text = (el.innerText || el.textContent || el.value || el.placeholder || el.name || '').slice(0, 50);

        const color = colorList[index % colorList.length];

        if (shouldHighlight && container) {
          const highlightDiv = document.createElement('div');
          highlightDiv.className = '__browser_use_highlight__';
          // position: absolute 相对于固定容器，坐标与 getBoundingClientRect 一致
          highlightDiv.style.cssText = `
            position: absolute;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            border: 3px solid ${color};
            background: ${color}20;
            pointer-events: none;
            box-sizing: border-box;
          `;

          const labelDiv = document.createElement('div');
          labelDiv.className = '__browser_use_highlight__';
          labelDiv.textContent = index;
          labelDiv.style.cssText = `
            position: absolute;
            top: ${Math.max(0, rect.top - 20)}px;
            left: ${rect.left}px;
            background: ${color};
            color: white;
            font-size: 12px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            pointer-events: none;
            font-family: monospace;
            line-height: 16px;
          `;

          container.appendChild(highlightDiv);
          container.appendChild(labelDiv);
        }

        items.push({
          index: index++,
          tag,
          type,
          text: text.replace(/\s+/g, ' ').trim(),
          role: el.getAttribute('role') || '',
          href: el.href || '',
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          color
        });

        return index;
      }

      // 跳过无需检查计算样式的标签
      const SKIP_TAGS = new Set([
        'html', 'head', 'body', 'script', 'style', 'meta', 'link',
        'noscript', 'template', 'svg', 'path', 'br', 'hr', 'img',
        'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th'
      ]);

      // 递归搜索包括 Shadow DOM
      function searchInRoot(root) {
        interactiveSelectors.forEach(selector => {
          try {
            root.querySelectorAll(selector).forEach(el => {
              processElement(el);
              if (el.shadowRoot) {
                searchInRoot(el.shadowRoot);
              }
            });
          } catch (e) {
            // 某些选择器在特定 root 中可能不合法，跳过
          }
        });

        // 补充扫描：捕获 Vue/React 等框架事件绑定的可点击元素（cursor: pointer）
        // 这类元素不含 onclick 属性，只能通过计算样式判断
        try {
          const rootNode = root === document ? document.body : root;
          if (!rootNode) return;
          rootNode.querySelectorAll('*').forEach(el => {
            if (seen.has(el)) return;
            const tag = el.tagName?.toLowerCase() || '';
            if (SKIP_TAGS.has(tag)) return;
            const rect = el.getBoundingClientRect();
            // 过滤掉太小的容器（小于 20x20 通常是装饰性元素）
            if (rect.width < 20 || rect.height < 20) return;
            const style = window.getComputedStyle(el);
            if (style.cursor === 'pointer') {
              processElement(el);
            }
          });
        } catch (e) {
          // 忽略
        }
      }

      searchInRoot(document);
      return { items, nextIndex: index };
    }, [highlight, startIndex, colors]);
  };

  let allElements = [];
  let currentIndex = 0;

  // 主文档（frameIndex: 0，对应 page.frames()[0] 即主 frame）
  const mainResult = await annotateInContext(page, currentIndex);
  allElements.push(...mainResult.items.map(it => ({ ...it, frameIndex: 0 })));
  currentIndex = mainResult.nextIndex;

  // 处理 iframes：记录元素所属的 frame 在 page.frames() 中的下标，
  // 供 click/inputText/uploadFile 之后据此在正确的 frame 上下文里做坐标定位，
  // 而不是永远在主文档上 elementFromPoint（否则只能点到 iframe 容器本身，点不进内部）
  if (includeFrames) {
    const frames = page.frames();
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame === page.mainFrame()) continue;
      try {
        const frameResult = await annotateInContext(frame, currentIndex);
        allElements.push(...frameResult.items.map(it => ({ ...it, frameIndex: i })));
        currentIndex = frameResult.nextIndex;
      } catch (e) {
        console.warn('Frame annotation failed:', e.message);
      }
    }
  }

  return allElements;
}

/**
 * 根据元素记录的 frameIndex 解析出对应的 frame 对象；找不到（如页面已导航、frame 变化）
 * 时兜底回退到主 page，避免直接抛错中断操作
 */
function resolveFrameTarget(page, element) {
  if (!element.frameIndex) return page;
  const frames = page.frames();
  return frames[element.frameIndex] || page;
}

/**
 * 校验通过 index 找到的元素文本是否与调用方预期的一致。
 * index 编号是每次 state() 重新扫描后按当前 DOM 顺序临时分配的，只要两次 state() 之间
 * 页面任意位置发生了 DOM 变化（哪怕跟目标元素毫无关系，比如信息流懒加载了一条新内容、
 * 某个计数器多/少了一个可交互元素），后续所有 index 都可能整体错位一位——模型若沿用
 * 旧 index 就会点到别的元素而不自知。调用方可传 expectedText 做二次确认，不一致时
 * 直接报错拦下，而不是无声地点错。
 */
function assertExpectedText(element, expectedText, index) {
  if (!expectedText) return;
  const actual = String(element.text || '').trim().toLowerCase();
  const expected = String(expectedText).trim().toLowerCase();
  if (!expected) return;
  if (actual && (actual.includes(expected) || expected.includes(actual))) return;
  throw new Error(
    `索引 ${index} 处当前元素是「${element.text || element.tag}」，与预期的「${expectedText}」不符，` +
    `索引可能因页面变化已经错位，请重新调用 state 获取最新索引后重试，不要沿用旧索引`
  );
}
//  export async function getInteractiveElements(page, { highlight = true } = {}) {
//    if (highlight) {
//      await page.evaluate(() => {
//        const oldHighlights = document.querySelectorAll('.__browser_use_highlight__');
//        oldHighlights.forEach(el => el.remove());
//      });
//    }
 
//    const elements = await page.evaluate((shouldHighlight) => {
//      const interactiveSelectors = [
//        'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
//        '[role="button"]', '[role="link"]', '[role="textbox"]',
//        '[onclick]', '[tabindex]:not([tabindex="-1"])'
//      ];
 
//      const seen = new Set();
//      const items = [];
//      let index = 0;
 
//      const colors = [
//        '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
//        '#FF8000', '#8000FF', '#0080FF', '#FF0080', '#80FF00', '#00FF80'
//      ];
 
//      interactiveSelectors.forEach(selector => {
//        document.querySelectorAll(selector).forEach(el => {
//          const key = el.outerHTML.slice(0, 200);
//          if (seen.has(key)) return;
//          seen.add(key);
 
//          const rect = el.getBoundingClientRect();
//          if (rect.width === 0 || rect.height === 0) return;
//          if (rect.top < 0 || rect.left < 0) return;
 
//          const tag = el.tagName.toLowerCase();
//          const type = el.type || '';
//          const text = (el.innerText || el.textContent || el.value || el.placeholder || el.name || '').slice(0, 50);
 
//          if (shouldHighlight) {
//            const color = colors[index % colors.length];
//            const highlightDiv = document.createElement('div');
//            highlightDiv.className = '__browser_use_highlight__';
//            highlightDiv.style.cssText = `
//               position: fixed;
//               top: ${rect.top}px;
//               left: ${rect.left}px;
//               width: ${rect.width}px;
//               height: ${rect.height}px;
//               border: 3px solid ${color};
//               background: ${color}20;
//               pointer-events: none;
//               z-index: 2147483647;
//               box-sizing: border-box;
//             `;
 
//            const labelDiv = document.createElement('div');
//            labelDiv.className = '__browser_use_highlight__';
//            labelDiv.textContent = index;
//            labelDiv.style.cssText = `
//               position: fixed;
//               top: ${rect.top - 20}px;
//               left: ${rect.left}px;
//               background: ${color};
//               color: white;
//               font-size: 12px;
//               font-weight: bold;
//               padding: 2px 6px;
//               border-radius: 3px;
//               pointer-events: none;
//               z-index: 2147483647;
//               font-family: monospace;
//               line-height: 16px;
//             `;
 
//            document.body.appendChild(highlightDiv);
//            document.body.appendChild(labelDiv);
//          }
 
//          items.push({
//            index: index++,
//            tag,
//            type,
//            text: text.replace(/\s+/g, ' ').trim(),
//            role: el.getAttribute('role') || '',
//            href: el.href || '',
//            x: Math.round(rect.x),
//            y: Math.round(rect.y),
//            width: Math.round(rect.width),
//            height: Math.round(rect.height),
//            color: colors[index % colors.length]
//          });
//        });
//      });
 
//      return items;
//    }, highlight);
 
//    return elements;
//  }
 
 export async function findElementByIndex(page, index) {
   const elements = await getInteractiveElements(page, { highlight: false });
   const found = elements.find(e => e.index === parseInt(index));
   if (!found) {
     throw new Error(`Element [${index}] not found. Run "state" to see available elements.`);
   }
   return found;
 }
 
 // ============ 独立操作函数 ============
 
 // 同一 session 内的 openUrl 导航加锁：模型有时会在同一轮里并行发起多个 openUrl（同一个 session），
 // 两个 page.goto 同时抢同一个标签页会互相打断（net::ERR_ABORTED）。这里按 session 串行化，
 // 不同 session（不同子Agent）之间互不影响，仍然完全并行。
 const sessionNavLocks = new Map(); // session -> 上一次 openUrl 完成时才会 resolve 的 Promise

 /**
  * 打开浏览器并访问URL
  */
 export async function browserOpen(url, options = {}) {
   const session = options.session || 'default';
   const prevLock = sessionNavLocks.get(session) || Promise.resolve();
   let releaseLock;
   const lock = new Promise((resolve) => { releaseLock = resolve; });
   sessionNavLocks.set(session, prevLock.then(() => lock));
   await prevLock;
   try {
     return await browserOpenInternal(url, options);
   } finally {
     releaseLock();
   }
 }

 async function browserOpenInternal(url, options = {}) {
   const session = options.session || 'default';
   // 本地 Chrome 建议用 headed 模式加载插件
   const headless = options.headed === true ? false : (options.headless !== undefined ? options.headless : true);

   await ensureSessionDir();

   let page;
   if (options.newTab && contextInstances.has(session)) {
     // 显式要求新开一个 tab，而不是复用当前激活 tab
     const context = contextInstances.get(session);
     page = await context.newPage();
     registerTab(session, page, options.note);
   } else {
     const launched = await launchBrowser(session, {
       headless,
       browser: options.browser,
       executablePath: options.executablePath,
       profile: options.profile,
       force: options.force,
       note: options.note
     });
     page = launched.page;
   }

   if (url) {
     // networkidle 要求网络完全空闲，但现在的网站普遍有广告/统计/长轮询等持续后台请求，
     // 几乎永远等不到"空闲"，会导致频繁误报加载超时。改用 domcontentloaded 作为硬性等待条件，
     // 更贴近真实的"页面可交互"时机，几乎不会因为网站本身有后台请求而超时。
     await page.goto(url, {
       waitUntil: 'domcontentloaded',
       timeout: 30000
     });

     // 再尽力等一小段时间让动态内容加载得更完整，但达不到 networkidle 也不算失败
     await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

     // 手动等待关键元素
     await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
   }

   const currentUrl = page.url();
   const title = await page.title();

   // note 未提供时用页面标题兜底，方便后续 listTabs 展示
   const tabs = tabInstances.get(session);
   const activeId = activeTabId.get(session);
   if (tabs && activeId && tabs.has(activeId) && !tabs.get(activeId).note) {
     tabs.get(activeId).note = options.note || title;
   }

   await updateSession(session, {
     lastUrl: currentUrl,
     lastTitle: title
   });

   return {
     success: true,
     session,
     url: currentUrl,
     title,

   };
 }
 
 /**
  * 检测当前页面是否出现验证码或登录表单，需要用户手动处理
  * 返回 null 表示未检测到，否则返回 { reason: "captcha"|"login", message }
  */
 async function detectPageBlocker(page) {
   return page.evaluate(() => {
     const CAPTCHA_KEYWORDS = /验证码|安全验证|人机验证|滑动验证|拖动滑块|极验|geetest|captcha|recaptcha/i;
     const CAPTCHA_SELECTORS = [
       'iframe[src*="captcha" i]',
       'iframe[title*="captcha" i]',
       'iframe[title*="recaptcha" i]',
       '[class*="captcha" i]',
       '[id*="captcha" i]',
       '[class*="geetest" i]',
     ];

     const bodyText = (document.body?.innerText || '').slice(0, 3000);

     const isVisible = (el) => {
       if (!el) return false;
       if (el.offsetParent === null) return false;
       const rect = el.getBoundingClientRect();
       return rect.width > 0 && rect.height > 0;
     };

     // 要求"关键词命中"和"验证控件真的可见"同时成立，而不是任一命中就判定：
     // 单看关键词会被正文里提到"验证码"三个字的新闻/说明文字误伤；
     // 单看选择器会被很多网站预加载但并未展示的隐藏验证组件误伤（用户压根看不到）。
     const hasVisibleCaptchaEl = CAPTCHA_SELECTORS.some(sel => isVisible(document.querySelector(sel)));
     if (hasVisibleCaptchaEl && CAPTCHA_KEYWORDS.test(bodyText)) {
       return { reason: 'captcha', message: '检测到验证码，请在浏览器窗口中手动完成验证' };
     }

     const passwordInput = document.querySelector('input[type="password"]');
     const passwordVisible = passwordInput && passwordInput.offsetParent !== null;
     if (passwordVisible && /登录|登陆|log ?in|sign ?in/i.test(bodyText)) {
       return { reason: 'login', message: '检测到登录表单，请在浏览器窗口中手动完成登录' };
     }

     // 扫码登录没有密码输入框，上面那条规则天然看不见（如抖音网页版）。
     // 用"页面内容很稀疏 + 命中扫码登录关键词"双重条件识别，避免误伤正文里顺带提到"扫码"的正常内容页。
     const QR_LOGIN_KEYWORDS = /扫码登录|扫一扫|微信登录|打开[^。]{0,6}APP|Scan to login|scan.{0,3}qr/i;
     const compactLen = bodyText.replace(/\s+/g, '').length;
     if (compactLen > 0 && compactLen < 300 && QR_LOGIN_KEYWORDS.test(bodyText) && /登录|登陆/.test(bodyText)) {
       return { reason: 'login', message: '检测到扫码登录墙（页面内容很少，主要是登录引导文案），请在浏览器窗口中手动完成登录，或确认该内容是否需要登录才能查看' };
     }

     return null;
   });
 }

 /**
  * 独立于 state/getPageText 之外，供 openUrl/click/inputText 等操作动作完成后
  * 主动探测一次当前页面是否出现验证码/登录拦截，避免必须等到模型恰好调用 state/getPageText 才发现
  */
 export async function browserCheckBlocker(session = 'default') {
   const page = await getPage(session);
   return detectPageBlocker(page).catch(() => null);
 }

 /**
  * 获取当前页面状态和交互元素
  */
 export async function browserState(options = {}) {
   const session = options.session || 'default';

   await ensureSessionDir();
   const page = await getPage(session);

   const currentUrl = page.url();
   const title = await page.title();
   const elements = await getInteractiveElements(page, { highlight: options.highlight !== false });
   const blocker = await detectPageBlocker(page).catch(() => null);

   await updateSession(session, {
     lastUrl: currentUrl,
     lastTitle: title,
     elementCount: elements.length
   });

   return {
     success: true,
     session,
     url: currentUrl,
     title,
     blocker,
     elements: elements.map(e => ({
       index: e.index,
       tag: e.tag,
       type: e.type,
       text: e.text,
       role: e.role,
       href: e.href,
       x: e.x,
       y: e.y,
       width: e.width,
       height: e.height
     }))
   };
 }
 
 /**
  * 点击指定索引的元素（使用更可靠的点击方式）
  */
 export async function browserClick(index, options = {}) {
   const session = options.session || 'default';

   const page = await getPage(session);
   const element = await findElementByIndex(page, index);
   assertExpectedText(element, options.expectedText, index);
   const target = resolveFrameTarget(page, element);

   // 点击前注册新 tab 监听，捕获 target="_blank" 类链接
   const context = contextInstances.get(session);
   const newPagePromise = context
     ? context.waitForEvent('page', { timeout: 3000 }).catch(() => null)
     : Promise.resolve(null);

   await target.evaluate(({ x, y }) => {
     const el = document.elementFromPoint(x, y);
     if (el && typeof el.click === 'function') {
       el.scrollIntoView({ behavior: 'instant', block: 'center' });
       el.click();
     } else {
       console.log('元素未找到或不可点击，请重新找按钮');
     }
   }, { x: element.x + element.width / 2, y: element.y + element.height / 2 });

   // 检查是否打开了新 tab
   const newPage = await newPagePromise;
   if (newPage) {
     await newPage.waitForLoadState('domcontentloaded').catch(() => {});
     // 注册为新 tab 并设为激活，原 tab 仍保留在列表里，可通过 switchTab 切回
     const newTitle = await newPage.title().catch(() => '');
     registerTab(session, newPage, newTitle);
     return {
       success: true,
       session,
       index,
       newTab: true,
       url: newPage.url(),
       element: { tag: element.tag, text: element.text, x: element.x, y: element.y }
     };
   }

   // 无新 tab，等待当前页导航完成
   await Promise.race([
     page.waitForLoadState('networkidle').catch(() => {}),
     new Promise(r => setTimeout(r, 2000))
   ]);

   return {
     success: true,
     session,
     index,
     element: {
       tag: element.tag,
       text: element.text,
       x: element.x,
       y: element.y
     }
   };
 }

 /**
  * 列出当前 session 下所有仍存活的 tab（含用途备注、是否为当前激活 tab）
  */
 export async function browserListTabs(options = {}) {
   const session = options.session || 'default';
   const tabs = tabInstances.get(session);
   const activeId = activeTabId.get(session);

   if (!tabs || tabs.size === 0) {
     return { success: true, session, tabs: [] };
   }

   const list = [];
   for (const [id, entry] of tabs) {
     if (entry.page.isClosed()) continue;
     let url = '';
     let title = '';
     try { url = entry.page.url(); } catch (e) {}
     try { title = await entry.page.title(); } catch (e) {}
     list.push({
       id,
       url,
       title,
       note: entry.note || title,
       active: id === activeId
     });
   }

   return { success: true, session, tabs: list };
 }

 /**
  * 切换当前激活 tab（会把浏览器窗口也切到该 tab，用户能看到画面跟着切换）
  */
 export async function browserSwitchTab(tabId, options = {}) {
   const session = options.session || 'default';
   const tabs = tabInstances.get(session);
   const entry = tabs && tabs.get(tabId);

   if (!entry) {
     throw new Error(`Tab "${tabId}" not found. Run "listTabs" to see available tabs.`);
   }
   if (entry.page.isClosed()) {
     tabs.delete(tabId);
     throw new Error(`Tab "${tabId}" 已被关闭，请重新 listTabs 查看`);
   }

   activeTabId.set(session, tabId);
   await entry.page.bringToFront();

   return {
     success: true,
     session,
     tabId,
     url: entry.page.url(),
     title: await entry.page.title().catch(() => '')
   };
 }

 /**
  * 关闭指定 tab；若关的是当前激活 tab，自动回退到剩余 tab 中最后打开的一个
  */
 export async function browserCloseTab(tabId, options = {}) {
   const session = options.session || 'default';
   const tabs = tabInstances.get(session);
   const entry = tabs && tabs.get(tabId);

   if (!entry) {
     throw new Error(`Tab "${tabId}" not found. Run "listTabs" to see available tabs.`);
   }
   if (!entry.page.isClosed()) {
     await entry.page.close(); // 触发 registerTab 里注册的 close 监听，自动清理/回退激活 tab
   }

   return { success: true, session, tabId, closed: true };
 }

 /**
  * 在指定索引的元素中输入文本
  */
 export async function browserInput(index, text, options = {}) {
   const session = options.session || 'default';

   const page = await getPage(session);
   const element = await findElementByIndex(page, index);
   assertExpectedText(element, options.expectedText, index);
   const target = resolveFrameTarget(page, element);

   // 聚焦并清空：input/textarea 才有 select()，contenteditable 类富文本编辑器没有该方法，
   // 直接调用会抛 TypeError 导致整个输入失败——改用 Range 全选，兼容富文本编辑器
   await target.evaluate(({ x, y }) => {
     const el = document.elementFromPoint(x, y);
     if (!el) return;
     el.scrollIntoView({ behavior: 'instant', block: 'center' });
     el.focus();
     if (typeof el.select === 'function') {
       el.select();
     } else if (el.isContentEditable) {
       const range = document.createRange();
       range.selectNodeContents(el);
       const sel = window.getSelection();
       sel.removeAllRanges();
       sel.addRange(range);
     }
   }, { x: element.x + element.width / 2, y: element.y + element.height / 2 });

   // 输入文本（真实键盘事件，兼容 input/textarea/contenteditable 富文本编辑器；
   // 键盘事件面向当前焦点，与目标是否在 iframe 内无关，仍用顶层 page.keyboard）
   await page.keyboard.type(text);
 
   return {
     success: true,
     session,
     index,
     text,
     element: {
       tag: element.tag,
       text: element.text
     }
   };
 }
 
 /**
  * 在当前焦点处输入文本
  */
 export async function browserType(text, options = {}) {
   const session = options.session || 'default';
 
   const page = await getPage(session);
   await page.keyboard.type(text);
 
   return {
     success: true,
     session,
     text
   };
 }

/**
 * 给指定索引的元素上传本地文件。
 * 两种场景都覆盖：
 * 1. 元素本身就是 <input type="file">：直接对该元素 setInputFiles，不弹系统对话框，最稳定
 * 2. 元素是触发上传的按钮（真实 input 被隐藏，点击后由浏览器弹出系统文件选择框）：
 *    点击前预先监听 'filechooser' 事件，拿到后 setFiles，全程不需要操作系统级 UI
 */
export async function browserUploadFile(index, filePaths, options = {}) {
  const session = options.session || 'default';

  const page = await getPage(session);
  const element = await findElementByIndex(page, index);
  assertExpectedText(element, options.expectedText, index);
  const target = resolveFrameTarget(page, element);

  const files = Array.isArray(filePaths) ? filePaths : [filePaths];
  if (files.length === 0) throw new Error('未提供任何文件路径');
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`文件不存在：${f}`);
  }

  const point = { x: element.x + element.width / 2, y: element.y + element.height / 2 };

  if (element.tag === 'input' && element.type === 'file') {
    const handle = await target.evaluateHandle(
      ({ x, y }) => document.elementFromPoint(x, y),
      point
    );
    const elHandle = handle.asElement();
    if (!elHandle) throw new Error('未能定位到该文件输入框元素，请重新 state 获取最新索引');
    await elHandle.setInputFiles(files);
    return { success: true, session, index, files };
  }

  // 非 file input：按"点击后弹出系统文件选择框"处理
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await target.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (el && typeof el.click === 'function') {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.click();
    }
  }, point);

  const chooser = await chooserPromise;
  if (!chooser) {
    throw new Error('点击该元素未触发文件选择框。若页面里有可见的 <input type="file">，请改用它的索引直接上传');
  }
  await chooser.setFiles(files);

  return { success: true, session, index, files };
}

// 模拟键盘按键，支持单键和组合键（如 Ctrl+C）
export async function browserKeys(key, options = {}) {
  const session = options.session || 'default'; // 获取会话标识

  const page = await getPage(session); // 获取浏览器页面实例

  const keys = key.split('+'); // 拆分按键组合
  if (keys.length > 1) {
    // 组合键：先按下修饰键，再依次按下其他键，最后释放修饰键
    await page.keyboard.down(keys[0]);
    for (let i = 1; i < keys.length; i++) {
      await page.keyboard.press(keys[i]);
    }
    await page.keyboard.up(keys[0]);
  } else {
    // 单键直接按下
    await page.keyboard.press(key);
  }

  return { success: true, session, key };
}
 
 /**
  * 滚动页面
  */
 export async function browserScroll(direction, options = {}) {
   const session = options.session || 'default';
   const amount = options.amount || 500;
 
   const page = await getPage(session);
   const delta = direction === 'up' ? -amount : amount;
 
   await page.evaluate((d) => window.scrollBy(0, d), delta);
 
   return {
     success: true,
     session,
     direction,
     amount
   };
 }
 
 /**
  * 返回上一页
  */
 export async function browserBack(options = {}) {
   const session = options.session || 'default';
 
   const page = await getPage(session);
   await page.goBack();
 
   return {
     success: true,
     session,
     url: page.url()
   };
 }
 
 /**
  * 执行 JavaScript 代码
  */
 export async function browserEval(script, options = {}) {
   const session = options.session || 'default';
 
   const page = await getPage(session);
   const result = await page.evaluate(script);
 
   return {
     success: true,
     session,
     script,
     result
   };
 }
 
 /**
  * 获取指定索引元素的文本
  */
 export async function browserGetText(index, options = {}) {
   const session = options.session || 'default';
 
   const page = await getPage(session);
   const element = await findElementByIndex(page, index);
 
   return {
     success: true,
     session,
     index,
     text: element.text,
     element: {
       tag: element.tag,
       type: element.type
     }
   };
 }

/**
 * 提取页面全部可见正文（过滤导航/脚本，优先取 article/main，最多 8000 字符）
 */
export async function browserGetPageText(options = {}) {
  const session = options.session || 'default';
  const page = await getPage(session);

  const extract = () => page.evaluate(() => {
    const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'iframe']);
    const LIMIT = 8000;

    function extractText(root) {
      const parts = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          let el = node.parentElement;
          while (el) {
            if (SKIP_TAGS.has(el.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        parts.push(node.nodeValue.trim());
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    const priority = document.querySelector('article') || document.querySelector('main');
    const raw = priority ? extractText(priority) : extractText(document.body);
    return raw.slice(0, LIMIT);
  });

  let text = await extract();
  // 内容异常短，大概率是 SPA 还没把真实内容换上来、只读到了骨架/引导文案，等一下再读一次（只重试一次，避免死等）
  if (text.replace(/\s+/g, '').length < 100) {
    await sleep(1500);
    text = await extract();
  }

  const blocker = await detectPageBlocker(page).catch(() => null);

  return { success: true, session, length: text.length, text, blocker };
}


/**
 * 清除页面上所有 state 产生的高亮标注框
 */
export async function browserClearHighlight(options = {}) {
  const session = options.session || 'default';
  const page = await getPage(session);
  await page.evaluate(() => {
    const container = document.getElementById('__browser_use_container__');
    if (container) container.remove();
    document.querySelectorAll('.__browser_use_highlight__').forEach(el => el.remove());
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        el.shadowRoot.querySelectorAll('.__browser_use_highlight__').forEach(e => e.remove());
      }
    });
  });
  return { success: true, session };
}

/**
 * 截图并返回 base64 data URL，供多模态模型直接识别
 */
export async function browserScreenshot(options = {}) {
  const session = options.session || 'default';
  const page = await getPage(session);

  // 截图前清除高亮标注
  await page.evaluate(() => {
    const container = document.getElementById('__browser_use_container__');
    if (container) container.remove();
    document.querySelectorAll('.__browser_use_highlight__').forEach(el => el.remove());
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        el.shadowRoot.querySelectorAll('.__browser_use_highlight__').forEach(e => e.remove());
      }
    });
  });

  const buffer = await page.screenshot({ fullPage: false, type: 'png', scale: 'css' });
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
 export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
 /**
  * 等待条件满足
  */
 export async function browserWait(condition, options = {}) {
   const session = options.session || 'default';
   const timeout = options.timeout || 5000;
 
   const page = await getPage(session);
 
   if (condition === 'load') {
     await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
   } else if (condition&&condition.startsWith('selector:')) {
    const selector = condition.slice(9);  // 比 replace 快一点点
      await page.waitForSelector(selector, { timeout, state: 'visible' })
   } else if (condition&&condition.startsWith('text:')) {
     const text = condition.replace('text:', '');
     await page.waitForFunction(
       t => document.body.innerText.includes(t),
       text, { timeout }
     );
   } else {
    // condition 可能是数字字符串或中文描述，统一容错处理
    const parsed = Number(condition);
    const waitMs = Number.isFinite(parsed) && parsed > 0 ? parsed : (1000 + Math.random() * 1000);
    console.log(`Waiting ${Math.round(waitMs)}ms...`);
    await sleep(waitMs);
   }
 
   return {
     success: true,
     session,
     condition,
     timeout
   };
 }
 
 /**
  * 选择下拉框选项
  */
 export async function browserSelect(index, value, options = {}) {
   const session = options.session || 'default';
 
   const page = await getPage(session);
   const element = await findElementByIndex(page, index);
 
   await page.evaluate(({ x, y, val }) => {
     const el = document.elementFromPoint(x, y);
     if (el) {
       el.value = val;
       el.dispatchEvent(new Event('change', { bubbles: true }));
     }
   }, { x: element.x, y: element.y, val: value });
 
   return {
     success: true,
     session,
     index,
     value,
     element: { tag: element.tag }
   };
 }
 
 /**
  * 悬停在指定元素上
  */
 export async function browserHover(index, options = {}) {
   const session = options.session || 'default';

   const page = await getPage(session);
   const element = await findElementByIndex(page, index);
   assertExpectedText(element, options.expectedText, index);

   await page.mouse.move(
     element.x + element.width / 2,
     element.y + element.height / 2
   );
 
   return {
     success: true,
     session,
     index,
     element: {
       tag: element.tag,
       text: element.text
     }
   };
 }
 
 /**
  * 获取所有会话列表
  */
 export async function browserSessions() {
   const sessions = await loadSessions();
   const activeSessions = [];
   for (const [name, sessionData] of Object.entries(sessions)) {
     const isActive = contextInstances.has(name);
     activeSessions.push({
       name: sessionData.name,
       active: isActive,
       browserType: sessionData.browserType || 'chromium',
       headless: sessionData.headless !== false,
       lastUrl: sessionData.lastUrl || null,
       lastTitle: sessionData.lastTitle || null,
       state: sessionData.state || 'closed',
       userDataDir: sessionData.userDataDir || null,
       isUsingLocalChrome: sessionData.isUsingLocalChrome || false,
       isUsingExistingChromeData: sessionData.isUsingExistingChromeData || false,
       channel: sessionData.channel || null,
       createdAt: sessionData.createdAt,
       lastUsed: sessionData.lastUsed || null
     });
   }
   return {
     success: true,
     sessions: activeSessions,
     total: activeSessions.length,
     activeCount: activeSessions.filter(s => s.active).length
   };
 }
 
 /**
  * 关闭会话
  */
 export async function browserClose(options = {}) {
   const session = options.session || 'default';
 
   if (options.all) {
     const closedSessions = [];
     for (const [name] of contextInstances) {
       await closeSession(name);
       closedSessions.push(name);
     }
     return {
       success: true,
       closedAll: true,
       closedSessions
     };
   } else {
     await closeSession(session);
     return {
       success: true,
       session,
       closedAll: false
     };
   }
 }
 
 /**
  * 清理会话数据
  */
 export async function browserClean(options = {}) {
   const session = options.session || 'default';
   const sessions = await loadSessions();
   const sessionData = sessions[session];
 
   if (!sessionData) {
     return {
       success: false,
       error: `Session "${session}" not found`
     };
   }
 
   if (contextInstances.has(session)) {
     await closeSession(session);
   }
 
   const userDataDir = sessionData.userDataDir;
   if (userDataDir && !sessionData.isUsingExistingChromeData) {
     try {
       await fsp.rm(userDataDir, { recursive: true, force: true });
     } catch (e) {
       return {
         success: false,
         error: `Failed to clean data: ${e.message}`
       };
     }
   }
 
   delete sessions[session];
   await saveSessions(sessions);
 
   return {
     success: true,
     session,
     cleaned: true,
     userDataDir: sessionData.isUsingExistingChromeData ? null : userDataDir,
     note: sessionData.isUsingExistingChromeData ? 'System Chrome data was not cleaned' : undefined
   };
 }
 
 /**
  * 系统诊断
  */
 export async function browserDoctor() {
   const localBrowser = findLocalBrowser();
   const defaultChromeDir = getDefaultChromeUserDataDir();
   let playwrightVersion = 'unknown';
   try {
     const pkg = JSON.parse(await fsp.readFile(
       path.join(process.cwd(), 'node_modules/playwright/package.json'), 
       'utf-8'
     ));
     playwrightVersion = pkg.version;
   } catch (e) {}
 
   let chromeDataExists = false;
   try {
     await fsp.access(defaultChromeDir);
     chromeDataExists = true;
   } catch {}
 
   return {
     success: true,
     system: {
       platform: os.platform(),
       nodeVersion: process.version,
       playwrightVersion,
       localBrowser,
       defaultChromeUserDataDir: defaultChromeDir,
       chromeDataExists,
       sessionDir: SESSION_DIR,
       mode: localBrowser ? 'Will use local Chrome with extensions' : 'Will use Playwright bundled Chromium'
     }
   };
 }