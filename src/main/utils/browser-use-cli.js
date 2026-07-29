#!/usr/bin/env node
// browser-use-cli.js - Node.js + Playwright CLI (修复 headed 模式)

const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const SESSION_DIR = path.join(os.tmpdir(), 'browser-use-sessions');
const SESSION_FILE = path.join(SESSION_DIR, 'sessions.json');

function findLocalBrowser() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    const paths = [
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const p of paths) {
      try {
        if (require('fs').existsSync(p)) return p;
      } catch (e) {}
    }
  } else if (platform === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const p of paths) {
      try {
        if (require('fs').existsSync(p)) return p;
      } catch (e) {}
    }
  } else {
    try {
      return require('child_process').execSync('which google-chrome || which chromium-browser || which chromium || which chrome', { encoding: 'utf8' }).trim();
    } catch (e) {}
  }
  return null;
}

async function ensureSessionDir() {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (e) {}
}

async function loadSessions() {
  try {
    const data = await fs.readFile(SESSION_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveSessions(sessions) {
  await fs.writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

async function getSession(sessionName = 'default', options = {}) {
  const sessions = await loadSessions();
  
  if (!sessions[sessionName]) {
    sessions[sessionName] = {
      name: sessionName,
      createdAt: new Date().toISOString(),
      browserType: options.browser || 'chromium',
      headless: options.headless !== false,
      executablePath: options.executablePath || findLocalBrowser(),
      profilePath: options.profile ? path.join(SESSION_DIR, `profile-${sessionName}`) : null,
      state: 'closed'
    };
    await saveSessions(sessions);
  }
  
  return sessions[sessionName];
}

async function updateSession(sessionName, updates) {
  const sessions = await loadSessions();
  if (sessions[sessionName]) {
    sessions[sessionName] = { ...sessions[sessionName], ...updates };
    await saveSessions(sessions);
  }
}

const browserInstances = new Map();
const contextInstances = new Map();
const pageInstances = new Map();

async function launchBrowser(sessionName, options = {}) {
  let session = await getSession(sessionName, options);
  
  if (browserInstances.has(sessionName)) {
    await closeSession(sessionName);
    session = await getSession(sessionName, options);
  }

  const browserType = options.browser || session.browserType || 'chromium';
  // 关键修复：正确处理 headed 参数
  const headless = options.headed ? false : (options.headless !== undefined ? options.headless : session.headless);
  const executablePath = options.executablePath || session.executablePath;
  
  const browserMap = { chromium, firefox, webkit };
  const browserLauncher = browserMap[browserType] || chromium;

  // 构建启动选项
  const launchOptions = {
    headless,  // false = 显示窗口，true = 无头
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--start-maximized'  // 启动时最大化窗口
    ]
  };

  // Windows 下显示窗口需要特殊处理
  if (os.platform() === 'win32' && !headless) {
    launchOptions.args.push('--disable-gpu');
    launchOptions.args.push('--disable-software-rasterizer');
  }

  // 使用本地浏览器
  if (executablePath && browserType === 'chromium') {
    console.log(`🌐 Browser: ${executablePath}`);
    launchOptions.executablePath = executablePath;
  } else {
    console.log('📦 Using Playwright bundled browser');
  }

  // 持久化 profile
  const userDataDir = options.profile || session.profilePath;
  if (userDataDir) {
    await fs.mkdir(userDataDir, { recursive: true });
    launchOptions.userDataDir = userDataDir;
    console.log(`📁 Profile: ${userDataDir}`);
  }

  console.log(`🚀 Starting browser (headless: ${headless})...`);
  if (!headless) {
    console.log('👁️  Window should be visible now...');
  }
  
  const browser = await browserLauncher.launch(launchOptions);
  
  // 创建 context 时设置视口（非 headless 时使用实际窗口大小）
  const contextOptions = {
    viewport: headless ? { width: 1280, height: 720 } : null, // null = 使用实际窗口大小
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  browserInstances.set(sessionName, browser);
  contextInstances.set(sessionName, context);
  pageInstances.set(sessionName, page);
  
  await updateSession(sessionName, { 
    state: 'active',
    lastUsed: new Date().toISOString(),
    browserType,
    headless,
    executablePath: launchOptions.executablePath
  });

  console.log('✅ Browser started');
  return { browser, context, page };
}

async function getPage(sessionName = 'default') {
  if (!pageInstances.has(sessionName)) {
    throw new Error(`Session "${sessionName}" not found. Run "open" first.`);
  }
  return pageInstances.get(sessionName);
}

async function closeSession(sessionName = 'default') {
  const browser = browserInstances.get(sessionName);
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
    browserInstances.delete(sessionName);
    contextInstances.delete(sessionName);
    pageInstances.delete(sessionName);
  }
  await updateSession(sessionName, { state: 'closed' });
}
// 在 getInteractiveElements 函数中，添加高亮绘制逻辑
async function getInteractiveElements(page) {
    // 先清除之前的高亮
    await page.evaluate(() => {
      const oldHighlights = document.querySelectorAll('.__browser_use_highlight__');
      oldHighlights.forEach(el => el.remove());
    });
  
    const elements = await page.evaluate(() => {
      const interactiveSelectors = [
        'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="textbox"]',
        '[onclick]', '[tabindex]:not([tabindex="-1"])'
      ];
      
      const seen = new Set();
      const items = [];
      let index = 0;
      
      // 生成鲜艳的颜色
      const colors = [
        '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
        '#FF8000', '#8000FF', '#0080FF', '#FF0080', '#80FF00', '#00FF80'
      ];
      
      interactiveSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const key = el.outerHTML.slice(0, 200);
          if (seen.has(key)) return;
          seen.add(key);
          
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (rect.top < 0 || rect.left < 0) return; // 视口外的元素
          
          const tag = el.tagName.toLowerCase();
          const type = el.type || '';
          const text = (el.innerText || el.textContent || el.value || el.placeholder || el.name || '').slice(0, 50);
          
          // 创建高亮框
          const color = colors[index % colors.length];
          const highlightDiv = document.createElement('div');
          highlightDiv.className = '__browser_use_highlight__';
          highlightDiv.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            border: 3px solid ${color};
            background: ${color}20;
            pointer-events: none;
            z-index: 2147483647;
            box-sizing: border-box;
          `;
          
          // 创建编号标签
          const labelDiv = document.createElement('div');
          labelDiv.className = '__browser_use_highlight__';
          labelDiv.textContent = index;
          labelDiv.style.cssText = `
            position: fixed;
            top: ${rect.top - 20}px;
            left: ${rect.left}px;
            background: ${color};
            color: white;
            font-size: 12px;
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
            pointer-events: none;
            z-index: 2147483647;
            font-family: monospace;
            line-height: 16px;
          `;
          
          document.body.appendChild(highlightDiv);
          document.body.appendChild(labelDiv);
          
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
        });
      });
      
      return items;
    });
    
    return elements;
  }

// async function getInteractiveElements(page) {
//   const elements = await page.evaluate(() => {
//     const interactiveSelectors = [
//       'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
//       '[role="button"]', '[role="link"]', '[role="textbox"]',
//       '[onclick]', '[tabindex]:not([tabindex="-1"])'
//     ];
    
//     const seen = new Set();
//     const items = [];
//     let index = 0;
    
//     interactiveSelectors.forEach(selector => {
//       document.querySelectorAll(selector).forEach(el => {
//         const key = el.outerHTML.slice(0, 200);
//         if (seen.has(key)) return;
//         seen.add(key);
        
//         const rect = el.getBoundingClientRect();
//         if (rect.width === 0 || rect.height === 0) return;
        
//         const tag = el.tagName.toLowerCase();
//         const type = el.type || '';
//         const text = (el.innerText || el.textContent || el.value || el.placeholder || el.name || '').slice(0, 50);
        
//         items.push({
//           index: index++,
//           tag,
//           type,
//           text: text.replace(/\s+/g, ' ').trim(),
//           role: el.getAttribute('role') || '',
//           href: el.href || '',
//           selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : tag,
//           x: Math.round(rect.x),
//           y: Math.round(rect.y),
//           width: Math.round(rect.width),
//           height: Math.round(rect.height)
//         });
//       });
//     });
    
//     return items;
//   });
  
//   return elements;
// }

async function findElementByIndex(page, index) {
  const elements = await getInteractiveElements(page);
  const found = elements.find(e => e.index === parseInt(index));
  if (!found) {
    throw new Error(`Element [${index}] not found. Run "state" to see available elements.`);
  }
  return found;
}

function formatState(url, title, elements) {
  console.log(`\n📍 URL: ${url}`);
  console.log(`📄 Title: ${title}\n`);
  
  if (elements.length === 0) {
    console.log('No interactive elements found.\n');
    return;
  }
  
  console.log('Interactive elements:');
  console.log('-'.repeat(90));
  console.log(`Idx | Tag      | Type     | Text`);
  console.log('-'.repeat(90));
  
  elements.forEach(el => {
    const idx = el.index.toString().padStart(3);
    const tag = el.tag.padEnd(8);
    const type = (el.type || '-').padEnd(8);
    const text = el.text.slice(0, 50).padEnd(50);
    console.log(`${idx} | ${tag} | ${type} | ${text}`);
  });
  
  console.log('-'.repeat(90));
  console.log(`Total: ${elements.length} elements\n`);
}

const commands = {
  async open(url, options = {}) {
    const sessionName = options.session || 'default';
    const { page } = await launchBrowser(sessionName, options);
    
    if (url) {
      console.log(`🌐 Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      console.log(`✅ Opened: ${url}`);
    }
    
    await this.state(options);
  },

  async state(options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const url = page.url();
    const title = await page.title();
    const elements = await getInteractiveElements(page);
    
    formatState(url, title, elements);
    
    await updateSession(sessionName, { 
      lastUrl: url,
      lastTitle: title,
      elementCount: elements.length
    });
  },

  async click(index, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const element = await findElementByIndex(page, index);
    
    await page.mouse.click(
      element.x + element.width / 2,
      element.y + element.height / 2
    );
    
    console.log(`✅ Clicked [${index}]: ${element.tag} "${element.text}"`);
    
    await page.waitForLoadState('networkidle').catch(() => {});
  },

  async input(index, text, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const element = await findElementByIndex(page, index);
    
    await page.mouse.click(
      element.x + element.width / 2,
      element.y + element.height / 2
    );
    
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    
    await page.keyboard.type(text);
    
    console.log(`✅ Input [${index}]: "${text}"`);
  },

  async type(text, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    await page.keyboard.type(text);
    console.log(`✅ Typed: ${text}`);
  },

  async keys(key, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const keys = key.split('+');
    if (keys.length > 1) {
      await page.keyboard.down(keys[0]);
      for (let i = 1; i < keys.length; i++) {
        await page.keyboard.press(keys[i]);
      }
      await page.keyboard.up(keys[0]);
    } else {
      await page.keyboard.press(key);
    }
    
    console.log(`✅ Pressed: ${key}`);
  },

  async scroll(direction, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const amount = parseInt(options.amount) || 500;
    const delta = direction === 'up' ? -amount : amount;
    
    await page.evaluate((d) => window.scrollBy(0, d), delta);
    console.log(`✅ Scrolled ${direction} ${amount}px`);
  },

  async back(options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    await page.goBack();
    console.log('✅ Navigated back');
  },

  async eval(script, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    const result = await page.evaluate(script);
    console.log('Result:', result);
    return result;
  },

  async getText(index, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    const element = await findElementByIndex(page, index);
    console.log(element.text);
    return element.text;
  },

  async screenshot(filepath, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    
    const filename = filepath || `screenshot-${Date.now()}.png`;
    
    await page.screenshot({ 
      path: filename, 
      fullPage: !!options.full 
    });
    
    console.log(`✅ Screenshot: ${filename}`);
  },

  async wait(condition, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    const timeout = parseInt(options.timeout) || 5000;
    
    if (condition === 'load') {
      await page.waitForLoadState('networkidle', { timeout });
    } else if (condition.startsWith('selector:')) {
      const selector = condition.replace('selector:', '');
      await page.waitForSelector(selector, { timeout });
    } else if (condition.startsWith('text:')) {
      const text = condition.replace('text:', '');
      await page.waitForFunction(
        t => document.body.innerText.includes(t),
        text,
        { timeout }
      );
    } else {
      await page.waitForTimeout(parseInt(condition) || 1000);
    }
    
    console.log(`✅ Waited: ${condition}`);
  },

  async select(index, value, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    const element = await findElementByIndex(page, index);
    
    await page.evaluate(({ x, y, val }) => {
      const el = document.elementFromPoint(x, y);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { x: element.x, y: element.y, val: value });
    
    console.log(`✅ Selected [${index}]: "${value}"`);
  },

  async hover(index, options = {}) {
    const sessionName = options.session || 'default';
    const page = await getPage(sessionName);
    const element = await findElementByIndex(page, index);
    
    await page.mouse.move(
      element.x + element.width / 2,
      element.y + element.height / 2
    );
    
    console.log(`✅ Hovered [${index}]`);
  },

  async sessions() {
    const sessions = await loadSessions();
    console.log('\n📋 Sessions:');
    console.log('-'.repeat(80));
    console.log('Status | Name     | Browser  | Headless | Last URL');
    console.log('-'.repeat(80));
    
    Object.values(sessions).forEach(s => {
      const isActive = browserInstances.has(s.name);
      const status = isActive ? '🟢' : '⚪';
      const name = s.name.padEnd(8);
      const browser = (s.browserType || 'chromium').padEnd(8);
      const headless = (s.headless !== false ? 'yes' : 'no').padEnd(8);
      const url = (s.lastUrl || 'N/A').slice(0, 35);
      console.log(`${status}   | ${name} | ${browser} | ${headless} | ${url}`);
    });
    
    if (Object.keys(sessions).length === 0) {
      console.log('No sessions found.');
    }
    console.log('');
  },

  async close(options = {}) {
    if (options.all) {
      for (const [name] of browserInstances) {
        await closeSession(name);
      }
      console.log('✅ Closed all sessions');
    } else {
      const sessionName = options.session || 'default';
      await closeSession(sessionName);
      console.log(`✅ Closed: ${sessionName}`);
    }
  },

  async doctor() {
    console.log('🔍 System Check\n');
    
    const localBrowser = findLocalBrowser();
    console.log(`Local browser: ${localBrowser || 'Not found'}`);
    console.log(`Session dir:   ${SESSION_DIR}`);
    console.log(`Platform:      ${os.platform()}`);
    console.log(`Node.js:       ${process.version}`);
    
    try {
      const pwVersion = require('playwright/package.json').version;
      console.log(`Playwright:    ${pwVersion}`);
    } catch (e) {
      console.log('Playwright:    Not installed');
    }
    
    // 测试启动（headed 模式）
    if (localBrowser) {
      console.log('\n🧪 Testing headed browser launch...');
      console.log('   If you see a browser window, headed mode works!');
      try {
        const browser = await chromium.launch({ 
          executablePath: localBrowser,
          headless: false,  // 测试 headed 模式
          args: ['--no-sandbox', '--start-maximized']
        });
        const page = await browser.newPage();
        await page.goto('about:blank');
        await page.waitForTimeout(2000); // 等待 2 秒让你看到窗口
        await browser.close();
        console.log('✅ Headed test passed');
      } catch (e) {
        console.error('❌ Headed test failed:', e.message);
      }
    }
  },

  help() {
    console.log(`
Browser Use CLI - Node.js + Playwright

Usage: node browser-use-cli.js <command> [options]

Commands:
  open <url>                Open URL (auto-detects local Chrome/Edge)
  state                     Show interactive elements with indices
  click <index>             Click element by index
  input <index> <text>      Input text into element
  type <text>               Type at current focus
  keys <key>                Press key (e.g., Enter, Control+a)
  scroll <up|down>          Scroll page (--amount 500)
  back                      Go back
  eval "<script>"           Execute JavaScript
  get text <index>          Get element text
  screenshot [file]         Screenshot (--full for full page)
  wait <condition>          Wait (ms, selector:xxx, text:xxx, load)
  select <index> <value>    Select dropdown option
  hover <index>             Hover over element
  sessions                  List sessions
  close [--all]             Close session(s)
  doctor                    System check (tests headed mode)
  help                      Show this help

Options:
  --session <name>          Session name (default: "default")
  --headed                  Show browser window (GUI mode)
  --executablePath <path>   Custom browser path
  --profile <path>          User data directory
  --browser <type>          chromium|firefox|webkit

Examples:
  node browser-use-cli.js open https://baidu.com
  node browser-use-cli.js open https://baidu.com --headed
  node browser-use-cli.js state
  node browser-use-cli.js click 5
  node browser-use-cli.js doctor
    `);
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const positional = [];
  const options = {};
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        if (nextArg === 'true') options[key] = true;
        else if (nextArg === 'false') options[key] = false;
        else options[key] = nextArg;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  
  return { command, positional, options };
}

async function main() {
  await ensureSessionDir();
  
  const { command, positional, options } = parseArgs();
  
  if (!command || command === 'help') {
    commands.help();
    return;
  }
  
  try {
    switch (command) {
      case 'open':
        await commands.open(positional[0], options);
        break;
      case 'state':
        await commands.state(options);
        break;
      case 'click':
        await commands.click(positional[0], options);
        break;
      case 'input':
        await commands.input(positional[0], positional.slice(1).join(' '), options);
        break;
      case 'type':
        await commands.type(positional.join(' '), options);
        break;
      case 'keys':
        await commands.keys(positional[0], options);
        break;
      case 'scroll':
        await commands.scroll(positional[0], options);
        break;
      case 'back':
        await commands.back(options);
        break;
      case 'eval':
        await commands.eval(positional.join(' '), options);
        break;
      case 'get':
        if (positional[0] === 'text') {
          await commands.getText(positional[1], options);
        }
        break;
      case 'screenshot':
        await commands.screenshot(positional[0], options);
        break;
      case 'wait':
        await commands.wait(positional[0], options);
        break;
      case 'select':
        await commands.select(positional[0], positional[1], options);
        break;
      case 'hover':
        await commands.hover(positional[0], options);
        break;
      case 'sessions':
        await commands.sessions();
        break;
      case 'close':
        await commands.close(options);
        break;
      case 'doctor':
        await commands.doctor();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        commands.help();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();