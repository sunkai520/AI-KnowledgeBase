// src/spider/browser-manager.ts
import { app, App, BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import pie from 'puppeteer-in-electron';
import puppeteer, { Browser } from 'puppeteer-core';
import { applyProxyToSession } from './proxyConfig';
import icon from '../../../resources/icon.png?asset';

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private connected = false;
  private windows = new Set<BrowserWindow>();
  private appInstance: App | null = null;

  // #1: 空闲页面池，复用窗口避免每次工具调用的冷启动开销
  private idlePool: { page: any; window: BrowserWindow }[] = [];
  private readonly POOL_MAX = 2;

  // #2: 全局窗口并发上限——每个 BrowserWindow 都是一个独立 Chromium 渲染进程，
  // 模型并发调用 webSearch/网页解析等工具时若不设上限，窗口数量会随并发数线性增长，
  // 把内存打满。这里限制"同一时刻最多同时存在 MAX_CONCURRENT_WINDOWS 个窗口"，
  // 超出的 newPage() 请求排队等待，等有窗口关闭腾出名额后再继续。
  private readonly MAX_CONCURRENT_WINDOWS = 4;
  private windowWaitQueue: Array<() => void> = [];
  // 排队等待名额的超时时间：万一出现名额泄漏（理论上不应该再发生，见 newPage 里的兜底关闭），
  // 也不会让请求永久卡死，超时后明确报错，方便定位而不是无限排队
  private readonly QUEUE_TIMEOUT_MS = 90000;

  private async acquireWindowSlot(): Promise<void> {
    if (this.windows.size < this.MAX_CONCURRENT_WINDOWS) return;
    console.log(`[BrowserManager] 窗口数已达上限(${this.MAX_CONCURRENT_WINDOWS})，排队等待空闲窗口...`);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const grant = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.windowWaitQueue.indexOf(grant);
        if (idx !== -1) this.windowWaitQueue.splice(idx, 1);
        reject(new Error(
          `等待可用搜索窗口超时（已排队 ${this.QUEUE_TIMEOUT_MS / 1000}s），当前并发窗口数已达上限(${this.MAX_CONCURRENT_WINDOWS})`
        ));
      }, this.QUEUE_TIMEOUT_MS);
      this.windowWaitQueue.push(grant);
    });
  }

  private releaseWindowSlot(): void {
    const next = this.windowWaitQueue.shift();
    if (next) next();
  }

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * ⚠️ 关键：必须在主进程入口、app ready 之前调用！
   * main.ts 中立即执行：browserManager.setup(app)
   */
  setup(appInstance: App): void {
    if (this.appInstance) return; // 只设置一次

    this.appInstance = appInstance;

    // 立即初始化 pie（必须在 ready 之前）
    pie.initialize(appInstance);
    console.log('[BrowserManager] PIE initialized');
  }

  /** 创建新页面 */
  async newPage(options: any = {}): Promise<any> {
    if (!this.appInstance) {
      throw new Error('BrowserManager.setup(app) must be called before using spider');
    }

    if (!this.connected) {
      //@ts-ignore
      this.browser = await pie.connect(this.appInstance, puppeteer as any);
      this.connected = true;
      console.log('[BrowserManager] Browser connected');
    }

    const {
      headless = true, //是否无头模式 false 开启调试模式，true 无头模式
      width = 1280,
      height = 800,
      offscreen = true,
      preload,
      show = !headless,
      // 代理地址，如 'http://127.0.0.1:7890'；不传则使用系统设置里的代理模式
      proxy,
      // 强制直连：跳过代理探测并显式禁用代理（用于百度等国内站点，避免代理 IP 触发验证码）
      noProxy = false,
      // 持久化分区名，如 'persist:ai-search'；不传则用 Electron 默认（不持久化的）会话，
      // 每次都是全新无 Cookie 的窗口。传同一个 partition 可以让多次调用共享登录态/Cookie。
      partition
    } = options;

    await this.acquireWindowSlot();

    const winConfig: BrowserWindowConstructorOptions = {
      width,
      height,
      show,
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        offscreen: headless && offscreen,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload,
        partition
      }
    };

    // [DEBUG] 定位窗口闪烁：谁创建的、参数是什么、之后是否真的触发了 Electron 的 show 事件
    const caller = new Error().stack?.split('\n').slice(2, 5).join(' | ');
    console.log(`[BrowserManager][DEBUG] newPage 创建窗口 headless=${headless} show=${show} offscreen=${headless && offscreen} partition=${partition} 调用栈: ${caller}`);

    const win = new BrowserWindow(winConfig);
    this.windows.add(win);

    // [DEBUG] 只要 Electron 层面真的触发了 show/focus/可见性变化就打印出来，配合上面的创建日志即可定位是哪次调用弹的窗口
    win.on('show', () => console.log(`[BrowserManager][DEBUG] 窗口 show 事件触发 (headless=${headless}, show参数=${show})`));
    win.on('hide', () => console.log(`[BrowserManager][DEBUG] 窗口 hide 事件触发`));
    win.on('focus', () => console.log(`[BrowserManager][DEBUG] 窗口 focus 事件触发`));
    win.on('ready-to-show', () => console.log(`[BrowserManager][DEBUG] 窗口 ready-to-show 事件触发, isVisible=${win.isVisible()}`));

    win.on('closed', () => {
      this.windows.delete(win);
      // 若该窗口在空闲池中（被外部关闭），同步移除，避免取到死窗口
      const idx = this.idlePool.findIndex(e => e.window === win);
      if (idx !== -1) this.idlePool.splice(idx, 1);
      // 腾出一个并发名额给排队中的下一个请求
      this.releaseWindowSlot();
    });

    // 窗口已经创建、已经占了并发名额（this.windows 里）。下面这些初始化步骤任何一步失败，
    // 调用方都拿不到 win 的引用（newPage 直接 reject），如果不在这里兜底关闭，
    // 这个窗口会永久占着名额却没人能关——排查过一次真实的"并发窗口耗尽"就是这么产生的。
    try {
      const proxyState = await applyProxyToSession(win.webContents.session, {
        explicitProxy: proxy,
        forceDirect: noProxy,
      });
      console.log(`[BrowserManager] 代理模式: ${proxyState.mode}${proxyState.proxyUrl ? ` ${proxyState.proxyUrl}` : ''}`);

      //@ts-ignore
      const page = await pie.getPage(this.browser!, win);

      // 反检测：尽量把无头/自动化特征抹平，伪装成普通 Chrome
      await page.evaluateOnNewDocument(() => {
        // 1. webdriver 标志（自动化最明显的特征）
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // 2. 语言（国内站点会校验，缺失/为空很可疑）
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });

        // 3. plugins：伪造成长度>0 的 PluginArray，数字数组反而是爬虫特征
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const arr: any = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
              { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ];
            try { Object.setPrototypeOf(arr, PluginArray.prototype); } catch {}
            return arr;
          },
        });

        // 4. chrome 运行时对象（无头环境常缺失）
        if (!(window as any).chrome) (window as any).chrome = { runtime: {} };

        // 5. permissions.query 对 notifications 的伪装（headless 会返回 denied，真浏览器是 default/prompt）
        const perms: any = window.navigator.permissions;
        if (perms && perms.query) {
          const orig = perms.query.bind(perms);
          perms.query = (p: any) =>
            p && p.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission } as any)
              : orig(p);
        }

        // 6. WebGL vendor/renderer 伪装：离屏渲染常暴露 SwiftShader 软渲染，改成常见显卡
        try {
          const proto: any = (window as any).WebGLRenderingContext?.prototype;
          if (proto) {
            const getParameter = proto.getParameter;
            proto.getParameter = function (p: number) {
              if (p === 37445) return 'Intel Inc.';                 // UNMASKED_VENDOR_WEBGL
              if (p === 37446) return 'Intel Iris OpenGL Engine';   // UNMASKED_RENDERER_WEBGL
              return getParameter.call(this, p);
            };
          }
        } catch {}
      });

      if (headless) {
        await page.setViewport({ width, height });
      }

      return { page, window: win };
    } catch (err: any) {
      console.error(`[BrowserManager] newPage 初始化失败，关闭窗口以释放并发名额: ${err?.message}`);
      if (!win.isDestroyed()) win.close();
      throw err;
    }
  }

  /**
   * #1: 从页面池获取一个页面，用完必须调用返回的 release() 归还。
   * - debug / show 模式不走池，每次新建独立窗口（保证调试时窗口可见、互不干扰）
   * - 复用前会重置页面状态：清理请求拦截、重新应用代理、导航回空白页
   */
  async acquirePage(
    options: any = {}
  ): Promise<{ page: any; window: BrowserWindow; release: () => Promise<void> }> {
    const isDebug = !!(options.show || options.debug);

    // 调试模式直接新建，不参与池复用
    if (isDebug) {
      const fresh = await this.newPage(options);
      const release = async () => {
        if (!fresh.window.isDestroyed()) fresh.window.close();
      };
      return { page: fresh.page, window: fresh.window, release };
    }

    // 尝试从池中取一个仍然有效的页面
    while (this.idlePool.length > 0) {
      const entry = this.idlePool.pop()!;
      if (entry.window.isDestroyed()) continue;
      try {
        await this._resetPage(entry, options.proxy, options.noProxy);
        console.log(`[BrowserManager] 复用池中页面，剩余空闲: ${this.idlePool.length}`);
        return this._wrap(entry);
      } catch (e: any) {
        console.warn('[BrowserManager] 复用页面重置失败，丢弃:', e?.message);
        if (!entry.window.isDestroyed()) entry.window.close();
      }
    }

    // 池中无可用页面，新建
    const created = await this.newPage(options);
    return this._wrap({ page: created.page, window: created.window });
  }

  /** 把页面包装成带 release 的句柄；release 时归还池或关闭 */
  private _wrap(entry: { page: any; window: BrowserWindow }): {
    page: any;
    window: BrowserWindow;
    release: () => Promise<void>;
  } {
    const release = async () => {
      if (entry.window.isDestroyed()) return;
      if (this.idlePool.length < this.POOL_MAX) {
        this.idlePool.push(entry);
        console.log(`[BrowserManager] 页面归还池，当前空闲: ${this.idlePool.length}`);
      } else {
        entry.window.close();
      }
    };
    return { page: entry.page, window: entry.window, release };
  }

  /** 复用前重置页面：清拦截器、重设代理、回到空白页 */
  private async _resetPage(
    entry: { page: any; window: BrowserWindow },
    explicitProxy?: string,
    noProxy?: boolean
  ): Promise<void> {
    const { page, window: win } = entry;
    // 清理上次可能遗留的请求拦截与监听器
    await page.setRequestInterception(false).catch(() => {});
    page.removeAllListeners('request');

    // 重新应用代理（用户可能在两次调用间改了设置；池中窗口上次可能被设过代理）
    await applyProxyToSession(win.webContents.session, {
      explicitProxy,
      forceDirect: noProxy,
    });

    // 回到空白页，停止上一个页面尚未结束的网络活动
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  }

  async destroy(): Promise<void> {
    // 先清空空闲池
    this.idlePool = [];
    const closePromises = Array.from(this.windows).map(win => {
      return new Promise<void>((resolve) => {
        if (win.isDestroyed()) {
          resolve();
        } else {
          win.once('closed', resolve);
          win.close();
        }
      });
    });

    await Promise.all(closePromises);
    this.windows.clear();
    this.browser = null;
    this.connected = false;
  }

  get activeCount(): number {
    return this.windows.size;
  }
}

export const browserManager = BrowserManager.getInstance();
