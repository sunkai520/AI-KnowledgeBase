import 'dotenv/config';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell, Tray, Menu, nativeImage } from "electron";
import path, { join } from "path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
//@ts-ignore
import icon from "../../resources/icon.png?asset";
// @ts-ignore
import { closeServer } from "../mqtt/index"
// @ts-ignore
import { initServer } from "./server/index"
//事件注册
// @ts-ignore
import { initEvent, setLog } from "./event/index"
// import {closeDB} from "./utils/knexDB"
//@ts-ignore
import PackageJson from '../../package.json'
//@ts-ignore
import { browserManager } from './utils/browserManager';
import { ConfigManager } from './config/configmangger';
import { ScheduledTaskManager } from './scheduledTask/scheduledTaskManager';
import { test} from "./utils/test";
import { ModelFactory } from './model/modelFactory';
// //@ts-ignore
// import { extractUrls, parsePage, ParseOptions } from '../main/modelTools/web-parser';
// //@ts-ignore
// import { webSearch,deepSearch} from '../main/modelTools/search-engine';
const configManager = ConfigManager.getInstance();
// 监听配置变化（热更新）
configManager.onConfigChange((newConfig) => {
  console.log('⚙️ 配置已更新:', newConfig);
  // 可选：通知渲染进程配置已变更
});
console.log(app.getPath('userData'),"path")
browserManager.setup(app);
// // 模拟测试（不启动窗口，直接跑任务）
// async function runTest() {
//   console.log('========================================')
//   console.log('       Worker Threads 测试开始')
//   console.log('========================================\n')
  

  
//   // 等待 Worker 启动
//   await new Promise(r => setTimeout(r, 1000))
  
//   console.log('\n--- 添加 5 个任务 ---\n')
  
//   // 添加 5 个任务（测试并发和队列）
//   const tasks = [
//     { inputFile: 'video1.mp4', quality: '1080p' },
//     { inputFile: 'video2.mp4', quality: '720p' },
//     { inputFile: 'video3.mp4', quality: '1080p' },
//     { inputFile: 'video4.mp4', quality: '4K', shouldFail: true }, // 这个会失败
//     { inputFile: 'video5.mp4', quality: '1080p' }
//   ]
  
//   for (const data of tasks) {
//     const result = manager.addTask(data)
//     console.log(`添加任务: ${result.id} - ${result.status}`)
//     await new Promise(r => setTimeout(r, 200)) // 稍微错开添加时间
//   }
  
//   // 监听事件
//   manager.on('task:progress', ({ taskId, progress, message }) => {
//     console.log(`[TaskManager] 任务 ${taskId} 进度: ${progress}% - ${message}`)
//     // 同一行更新进度
//     process.stdout.write(`\r[${taskId}] ${progress}% - ${message}                    `)
//   })
  
//   manager.on('task:completed', ({ taskId, result }) => {
//     console.log(`\n✅ 任务完成: ${taskId}`, result)
//   })
  
//   manager.on('task:failed', ({ taskId, error }) => {
//     console.log(`\n❌ 任务失败: ${taskId} - ${error}`)
//   })
  
//   // 定时打印状态
//   const statusInterval = setInterval(() => {
//     const status = manager.getStatus()
//     console.log('\n[状态]', 
//       `队列等待: ${status.queueLength},`,
//       `Worker: ${status.workers.map(w => w.busy ? '忙' : '闲').join('/')}`
//     )
//   }, 3000)
  
//   // 30 秒后关闭
//   // setTimeout(async () => {
//   //   clearInterval(statusInterval)
//   //   await manager.closeAll()
//   //   console.log('\n========================================')
//   //   console.log('       测试完成')
//   //   console.log('========================================')
//   //   app.quit()
//   // }, 30000)
// }
/** 从流式累积文本中解析出当前可展示的标题/正文（边生成边解析） */
function parseAiAnalysisChunks(text: string): { title: string; content: string } {
  const bodyIdx = text.indexOf('正文');
  const titlePart = bodyIdx === -1 ? text : text.slice(0, bodyIdx);
  const titleMatch = titlePart.match(/标题[：:]\s*(.*)/);
  const title = (titleMatch ? titleMatch[1] : titlePart).replace(/\r?\n/g, '').trim();
  const content = bodyIdx === -1 ? '' : text.slice(bodyIdx).replace(/^正文[：:]\s*/, '').trim();
  return { title, content };
}

const AI_ANALYSIS_MAX_LENGTH = 20000;

/** 在 webview 页面上下文中执行：提取正文文本 + 有效图片链接（过滤掉图标/小图/非 http 图片） */
function extractPageDataScript(): string {
  const fn = () => {
    const text = document.body ? document.body.innerText : '';
    const images = Array.from(document.images || [])
      .filter((img) => img.naturalWidth >= 150 && img.naturalHeight >= 150 && /^https?:\/\//.test(img.src))
      .map((img) => img.src);
    return { text, images: Array.from(new Set(images)).slice(0, 6) };
  };
  return `(${fn.toString()})()`;
}

async function analyzePageWithAI(webContents: Electron.WebContents, mainWindow: BrowserWindow): Promise<void> {
  try {
    const pageData = await webContents.executeJavaScript(extractPageDataScript());
    const pageText = String(pageData?.text || '').replace(/\s+/g, ' ').trim();
    const images: string[] = Array.isArray(pageData?.images) ? pageData.images : [];
    if (!pageText) {
      mainWindow.webContents.send('online-search:ai-analyze', { status: 'error', message: '未能提取到页面内容' });
      return;
    }

    let finalText = pageText;
    if (pageText.length > AI_ANALYSIS_MAX_LENGTH) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['继续分析', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '页面内容较长',
        message: `当前页面正文约 ${pageText.length} 字，超过建议上限（${AI_ANALYSIS_MAX_LENGTH} 字），继续分析将只截取前 ${AI_ANALYSIS_MAX_LENGTH} 字。是否继续？`,
      });
      if (response !== 0) return;
      finalText = pageText.slice(0, AI_ANALYSIS_MAX_LENGTH);
    }

    mainWindow.webContents.send('online-search:ai-analyze', { status: 'loading' });

    const prompt = `请阅读以下网页正文内容，用中文对其进行总结。
要求：
1. 第一行输出"标题："，后面跟一个不超过20字的简洁标题；
2. 换行输出"正文："，从下一行开始输出200-300字的总结内容；
3. 不要输出以上两项之外的任何内容。

网页内容：
${finalText}`;

    const model = ModelFactory.getChatModel();
    const stream = await model.stream([{ role: 'user', content: prompt }]);
    let fullText = '';
    for await (const chunk of stream) {
      fullText += String(chunk?.content ?? '');
      const { title, content } = parseAiAnalysisChunks(fullText);
      mainWindow.webContents.send('online-search:ai-analyze', { status: 'streaming', title, content });
    }
    const { title, content } = parseAiAnalysisChunks(fullText);
    mainWindow.webContents.send('online-search:ai-analyze', {
      status: 'done',
      title: title || 'AI 总结',
      content: content || fullText.trim(),
    });
  } catch (error: any) {
    mainWindow.webContents.send('online-search:ai-analyze', { status: 'error', message: error?.message || 'AI 分析失败' });
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : { icon }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
      //渲染环境开启nodejs环境
      // nodeIntegration: true,
      // contextIsolation: false
    },
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 检查是否是外部链接
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  const handleFindShortcut = (event, input) => {
    const key = String(input?.key || '').toLowerCase();
    if ((input?.control || input?.meta) && key === 'f') {
      event.preventDefault();
      mainWindow.webContents.send('online-search:open-find');
    }
  };
  mainWindow.webContents.on('before-input-event', handleFindShortcut);
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.on('before-input-event', handleFindShortcut);
    webContents.setWindowOpenHandler((details) => {
      mainWindow.webContents.send('online-search:new-tab', details.url);
      return { action: 'deny' };
    });
    webContents.on('context-menu', (_e, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.isEditable) {
        template.push(
          { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
          { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
          { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll }
        );
      } else if (params.selectionText) {
        template.push(
          { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
          { type: 'separator' },
          { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll },
          { type: 'separator' },
          { label: 'AI 分析', click: () => analyzePageWithAI(webContents, mainWindow) }
        );
      } else {
        template.push(
          { label: '刷新', click: () => webContents.reload() },
          { type: 'separator' },
          { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { label: 'AI 分析', click: () => analyzePageWithAI(webContents, mainWindow) }
        );
      }
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    });
  });
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("ready-to-show", () => {
    // mainWindow.webContents.openDevTools();
    // mainWindow.maximize();
    mainWindow.show();
    //提取出链接中的所有链接
    // extractUrls('https://www.baidu.com/s?wd=%E4%B8%80%E5%B9%85%E7%94%BB%E9%87%8C%E7%9A%84%E4%B8%A4%E6%9D%A1%E8%B7%AF&usm=3&ie=utf-8&rsv_pq=bc40bcc9000ccbd5&oq=%E6%96%B0%E6%B5%AA&rsv_t=2b40a2lswBeScvK8ijaX3Xg%2B37l6NUk3ibOhV9jfmgZIuI0EGenn3GF%2BSyA&rqid=bc40bcc9000ccbd5&rsf=1f41b75034dc20533adb86c9be4e574f_1_15_1&rsv_dl=0_right_fyb_pchot_20811&sa=0_right_fyb_pchot_20811', {
    //   waitTime: 2000,
    //   sameDomainOnly: false  // 只返回同域名链接
    // })
    //联网搜索
    // let res = webSearch("今日国家大事", { engine: "baidu" }).then((res) => console.log(res,"获取的结果"));
    // test().then((res) => console.log(res, "获取的结果"));
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  // win
  ipcMain.on('ipc:set-window-min', function () {
    mainWindow.minimize();
  })
  ipcMain.on('ipc:set-window-max', function () {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
  })
  ipcMain.on('ipc:set-window-exit', function () {
    mainWindow.hide();
  })
  createTray(mainWindow);
  ipcMain.on('print-html', (event, html, type) => {
    setLog("打印开始")
    const printWindow = new BrowserWindow({ show: false, width: 800, height: 880 });
    printWindow.loadURL(`${html}`);
    printWindow.webContents.on('did-finish-load', async () => {
      printWindow.webContents.print({
        silent: true, scaleFactor: 100, pageSize: type, printBackground: true, margins: { marginType: 'printableArea' },
      }, (success) => {
        printWindow.destroy();
      });

    });
  });
  initEvent(ipcMain, mainWindow)
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  // 监听F12键，并打开开发者工具
  globalShortcut.register('F12', () => {
    mainWindow.webContents.openDevTools();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // mainWindow.webContents.send('render-message', 1)
  });

}

let tray: Tray | null = null;
let isQuiting = false;

function createTray(mainWindow: BrowserWindow): void {
  const img = nativeImage.createFromPath(icon);
  tray = new Tray(img.resize({ width: 32, height: 32 }));
  tray.setToolTip('AI 助手');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true;
        closeServices();
        tray?.destroy();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let server;
const version = PackageJson.version

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(() => {
  // runTest();
  setLog("客户端启动成功!")
  setLog("当前版本：V" + version)
  // Set app user model id for windows
  electronApp.setAppUserModelId("ai");
  // runSpider("https://www.douyin.com/video/7569224313585372431")
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();
  server = initServer();
  ScheduledTaskManager.getInstance().init();
  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  setLog("客户端关闭")
  closeServices();
  if (process.platform !== "darwin") {
    app.quit();
  }

});

// Electron 内部已知的良性竞态：webview 在切换/关闭过程中，其 render frame 已销毁，
// 但窗口可见性同步（如 mainWindow.show()）仍尝试给它发 IPC，导致此错误。
// 不影响应用状态，只记录日志，不能按致命异常处理（否则点一下标签页整个 App 就被杀掉）。
const BENIGN_UNCAUGHT_PATTERNS = [
  'Render frame was disposed before WebFrameMain could be accessed',
];

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  if (BENIGN_UNCAUGHT_PATTERNS.some((p) => error.message?.includes(p))) {
    setLog(`[忽略的良性异常] ${error.message}`);
    return;
  }
  setLog(error.message)
  dialog.showErrorBox('异常', `异常：${error.message}`);
  closeServices();
  app.quit(); // 退出应用程序
});
// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

// 提取关闭服务的函数
function closeServices() {
  server && server.close(() => {
    console.log("服务关闭了呢");
  });
  ScheduledTaskManager.getInstance().stop();
  // closeDB()
  closeServer();
  // db && db.close();
}
