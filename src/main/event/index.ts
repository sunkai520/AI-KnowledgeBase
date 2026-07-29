import { app, shell, dialog, ipcMain } from "electron";
import { DataPathManager } from '../utils/dataPathManager';
import { SettingManager } from '../utils/settingManager';
import { applyProxyToSession, updateCnWhitelist, getPacListInfo, ensureWhitelistReady, getCustomDomains, setCustomDomains } from '../utils/proxyConfig';
import { publishTop } from "../../mqtt/index"
import { formatDate,selectFile,uploadDoc,getSystemPath,resolvePastedFilePath,savePastedImage,readStoredAttachment } from "../utils/common"
import { ModelFactory } from '../model/modelFactory';
import { ConfigManager } from '../config/configmangger';
import { ScheduledTaskManager } from '../scheduledTask/scheduledTaskManager';
import { planOrganize, applyOrganize, listOrganizeHistory, undoOrganize } from '../folderOrganizer/organizer';
const nettcp = require("net");
const dgram = require("dgram");
var sudo = require('sudo-prompt');
const NODE_ENV = import.meta.env.MODE;
const path = require('path')
const fs = require('fs')
let clientSocket = null as any;
let queue = [] as any;       // 指令队列
let timer = null as any;
let interval = 100;   // 指令间隔（毫秒）
const NetPortList = [] as any;
const WinList = [] as any;
let clients = [] as any
let CONFIG_PATH = path.join(app.getPath('userData'), 'config');
if (NODE_ENV !== 'development') {
    CONFIG_PATH = path.join(app.getPath('userData'), 'config');
}
const tempFileName = formatDate(new Date(),"yyyy-MM-dd_hh-mm-ss");
const logPath =getSystemPath(`logs/${tempFileName}.log`)
const log = require('electron-log');

export function setLog(message) {
    log.transports.file.resolvePathFn = () => logPath; // 设置日志文件路径
    log.info(`${formatDate(new Date())}:${message}`);
}
const tcp_server = nettcp.createServer();
// 监听客户端连接
tcp_server.on("connection", client => {
    // 
    // clientSocket = client
    // todo 轻提示哪台靶机已连接
    clients.push(client)
    client.on('data', (data) => {
        if (client.timer) {
            clearTimeout(client.timer)
        }
        var message = {
            type: 'net_message',
            path: nettcp.name,
            addr: client.remoteAddress,
            port: client.remotePort,
            data: data
        }
        for (var i = 0; i < WinList.length; i++) {
            WinList[i].webContents.send('ipc:recv-messages', message);
        }
        if (Array.from(data).length != 25) {
            return;
        }
        console.log('数据来源', Array.from(data))
        client.targetNum = data[0]
    })
    client.on('close', err => {
        // todo 遍历查询哪台靶机断开连接，并弹框提示
        // console.log("客户端关闭:" + JSON.stringify(client));
    })
    client.on('error', err => {
        for (var i = 0; i < WinList.length; i++) {
            WinList[i].webContents.send('render-message-disconnect', client.targetNum);
        }
       
        let index = clients.findIndex(item => item.targetNum == client.targetNum)
        if (index > -1) {
            clients.splice(index, 1)
        }
    })

})

tcp_server.on("error", error => {
    console.log("连接异常：" + error);
});
tcp_server.listen(9090, () => {
    console.log('TCP Server listening on 9090');
});
// 监听渲染进程发送的发送指令请求
ipcMain.on('send-command', (event, target, command) => {

    const client = clients.find((item) => item.targetNum == target)

    if (client) {
        setLog(`发送给${client.targetNum}号靶机指令：` + command)
        client.write(command)
    }

    // queue.push(command);
    // if (!timer) {
    //     startProcessing()
    // }
});
export function initEvent(ipcMain, mainWindow) {
    //rag
    ipcMain.handle('ipc:selctFile', selectFile)
    ipcMain.handle('ipc:uploadDoc', uploadDoc)
    // 输入框粘贴上传：真实文件走路径复用，剪贴板图片数据走落盘
    ipcMain.handle('ipc:resolvePastedFile', (_event, filePath: string) => resolvePastedFilePath(filePath))
    ipcMain.handle('ipc:savePastedImage', (_event, dataUrl: string) => savePastedImage(dataUrl))
    // 历史消息回显附件：纯读取，不拷贝
    ipcMain.handle('ipc:readStoredAttachment', (_event, filePath: string) => readStoredAttachment(filePath))
    //mac,ip
    ipcMain.handle('ipc:getmac', getMac)
    ipcMain.handle('ipc:getIp', getIp)
    // url 
    ipcMain.handle('ipc:open-url', openUrl);
    // config
    ipcMain.handle('ipc:get-configs', getConfigs);
    ipcMain.handle('ipc:set-configs', setConfigs);
    // net
    ipcMain.handle('ipc:set-nets', setNets);
    // message
    ipcMain.handle('ipc:send-messages', sendMessages);
    ipcMain.handle('ipc:activeApp', activeApp)
    ipcMain.handle('ipc:getPriviteCode', getPriviteCode)
    ipcMain.handle('ipc:speak', speekText);

    //发送socket
    ipcMain.handle('ipc:send-view', send_view)
    ipcMain.on('ipc:log', (event, message) => {
        console.log(message); // 或者使用 electron-log 记录到文件
        setLog(message)
    });
    // 数据目录配置
    ipcMain.handle('dataPath:getStatus', () => {
      const mgr = DataPathManager.getInstance();
      return {
        isConfigured: mgr.isConfigured(),
        dataDir: mgr.getDataDir(),
      };
    });
    ipcMain.handle('dataPath:setDir', (_event, dir: string) => {
      DataPathManager.getInstance().setDataDir(dir);
      return { success: true };
    });
    ipcMain.handle('dataPath:selectDir', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择数据存储目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    // 用系统文件管理器打开一个目录/文件所在位置
    ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
      if (!targetPath) return { success: false, error: '路径为空' };
      const err = await shell.openPath(targetPath);
      return err ? { success: false, error: err } : { success: true };
    });
    ipcMain.handle('dataPath:restart', () => {
      // @ts-ignore
      app.isQuiting = true;
      app.relaunch();
      app.exit(0);
    });

    // 获取自动检测到的浏览器信息（供 UI 显示）
    ipcMain.handle('setting:getBrowserDefaults', () => {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const platform = os.platform();
      const home = os.homedir();
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

      // 检测 Chrome/Edge 可执行文件
      let exePath = '';
      if (platform === 'win32') {
        const candidates = [
          path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ];
        exePath = candidates.find(p => p && fs.existsSync(p)) || '';
      } else if (platform === 'darwin') {
        const candidates = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ];
        exePath = candidates.find(p => fs.existsSync(p)) || '';
      }

      // 默认用户数据目录
      let userDataDir = '';
      if (platform === 'win32') {
        userDataDir = path.join(localAppData || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
      } else if (platform === 'darwin') {
        userDataDir = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
      } else {
        userDataDir = path.join(home, '.config', 'google-chrome');
      }

      return { exePath, userDataDir };
    });

    // 选择浏览器可执行文件
    ipcMain.handle('setting:selectBrowserExe', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择浏览器可执行文件',
        properties: ['openFile'],
        filters: [
          { name: '可执行文件', extensions: ['exe', 'app', ''] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    });
    // 选择浏览器数据目录
    ipcMain.handle('setting:selectBrowserUserDataDir', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择浏览器用户数据目录（保留登录状态）',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    });
    // 选择 AI 超级员工执行命令的工作目录
    ipcMain.handle('agent:selectWorkDir', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择 AI 员工执行命令的工作目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    });

    // Skill 一键导入：选择本地文件夹（该文件夹应直接包含 SKILL.md，或其唯一子文件夹包含）
    ipcMain.handle('skills:selectImportFolder', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择要导入的 Skill 文件夹',
        properties: ['openDirectory'],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    });

    // 统一设置
    ipcMain.handle('setting:getAll', () => {
      return SettingManager.getInstance().getAll();
    });
    ipcMain.handle('setting:get', (_event, key: string) => {
      return SettingManager.getInstance().get(key as any);
    });
    ipcMain.handle('setting:set', (_event, key: string, value: any) => {
      SettingManager.getInstance().set(key as any, value);
      return { success: true };
    });
    // 测试代理连通性：用独立 session 隔离，不走系统代理/直连
    ipcMain.handle('setting:testProxy', async (_event, proxyUrl: string, proxyMode?: string) => {
      const { session, net } = await import('electron');
      const start = Date.now();

      // 每次用不同分区名，避免复用旧 session 的代理缓存
      const partition = `proxy-test-${Date.now()}`;
      const testSession = session.fromPartition(partition, { cache: false });

      await applyProxyToSession(testSession, {
        explicitProxy: proxyUrl,
        proxyMode: proxyMode === 'pac' ? 'pac' : 'global',
      });

      return new Promise((resolve) => {
        const req = net.request({
          url: 'https://www.google.com',
          session: testSession,
          method: 'HEAD',
        });

        req.on('response', (res: any) => {
          res.resume(); // 消费响应，防止内存泄漏
          resolve({ success: true, latency: Date.now() - start });
        });

        req.on('error', (err: any) => {
          resolve({ success: false, error: err.message });
        });

        // 8 秒超时
        const timer = setTimeout(() => resolve({ success: false, error: '连接超时（8s）' }), 8000);
        req.on('response', () => clearTimeout(timer));
        req.on('error', () => clearTimeout(timer));

        req.end();
      });
    });

    ipcMain.handle('onlineSearch:configureProxy', async (_event, _engine: string) => {
      const { session } = await import('electron');
      const searchSession = session.fromPartition('persist:online-search');
      return applyProxyToSession(searchSession);
    });

    ipcMain.handle('onlineSearch:clearProxy', async () => {
      const { session } = await import('electron');
      const searchSession = session.fromPartition('persist:online-search');
      await applyProxyToSession(searchSession, { forceDirect: true });
      return { success: true };
    });

    // PAC 名单：中国大陆域名白名单（默认走代理，命中白名单则直连）
    ipcMain.handle('pac:getListInfo', () => {
      return getPacListInfo();
    });
    ipcMain.handle('pac:updateList', async () => {
      return updateCnWhitelist();
    });
    // 首次切到 PAC 模式时调用：数据目录下没有名单就下载一次，已存在则直接返回
    ipcMain.handle('pac:ensureListReady', async () => {
      return ensureWhitelistReady();
    });
    // 用户自定义强制代理/强制直连域名：存放在数据目录下，不进 settings.json
    ipcMain.handle('pac:getCustomDomains', () => {
      return getCustomDomains();
    });
    ipcMain.handle('pac:setForceProxyDomains', (_event, domains: string[]) => {
      setCustomDomains('forceProxy', domains);
      return { success: true };
    });
    ipcMain.handle('pac:setForceDirectDomains', (_event, domains: string[]) => {
      setCustomDomains('forceDirect', domains);
      return { success: true };
    });

    //模型相关
    // IPC 处理：获取配置
  ipcMain.handle('model:getConfig', () => {
    return ConfigManager.getInstance().getConfig();
  });

  // IPC 处理：更新配置
  ipcMain.handle('model:updateConfig', (_event, newConfig) => {
    try {
      const manager = ConfigManager.getInstance();
      if (newConfig === null) {
        manager.reset();
      } else {
        manager.saveConfig(newConfig);
      }
      ModelFactory.clearCache();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '保存失败' };
    }
  });

  // IPC 处理：测试连接
  ipcMain.handle('model:testConnection', async (_event, config) => {
    try {
      const testModel = ModelFactory.getChatModel({
        isNew: true,
        customConfig: config
      });
      await testModel.invoke('Hi');
      return { success: true };
    } catch (error:any) {
      return { success: false, error: error.message };
    }
  });

  // IPC 处理：获取模型列表（用于前端展示）
  ipcMain.handle('model:getActiveModels', () => {
    return ModelFactory.getActiveModels();
  });

  // ─── 工具箱：定时任务 ─────────────────────────────────────────────────────
  ipcMain.handle('scheduledTask:list', () => {
    return ScheduledTaskManager.getInstance().list();
  });
  ipcMain.handle('scheduledTask:create', (_event, input) => {
    return ScheduledTaskManager.getInstance().create(input);
  });
  ipcMain.handle('scheduledTask:update', (_event, id: string, input) => {
    ScheduledTaskManager.getInstance().update(id, input);
    return { success: true };
  });
  ipcMain.handle('scheduledTask:delete', (_event, id: string) => {
    ScheduledTaskManager.getInstance().remove(id);
    return { success: true };
  });
  ipcMain.handle('scheduledTask:toggle', (_event, id: string, enabled: boolean) => {
    ScheduledTaskManager.getInstance().toggle(id, enabled);
    return { success: true };
  });
  ipcMain.handle('scheduledTask:runNow', async (_event, id: string) => {
    await ScheduledTaskManager.getInstance().runNow(id);
    return { success: true };
  });
  ipcMain.handle('scheduledTask:selectWorkDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择定时任务的工作目录',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('scheduledTask:listRuns', (_event, taskId: string) => {
    return ScheduledTaskManager.getInstance().listRuns(taskId);
  });
  ipcMain.handle('scheduledTask:getRunSteps', (_event, runId: string) => {
    return ScheduledTaskManager.getInstance().getRunSteps(runId);
  });
  ipcMain.handle('scheduledTask:updateLearnedNotes', (_event, id: string, notes: string | null) => {
    ScheduledTaskManager.getInstance().updateLearnedNotes(id, notes);
    return { success: true };
  });

  // ─── 工具箱：文件夹自动归类 ────────────────────────────────────────────────
  ipcMain.handle('toolbox:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要整理的文件夹',
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('toolbox:previewOrganize', async (_event, folderPath: string, options) => {
    return await planOrganize(folderPath, options || {});
  });
  ipcMain.handle('toolbox:applyOrganize', async (_event, folderPath: string, plan) => {
    return await applyOrganize(folderPath, plan);
  });
  ipcMain.handle('toolbox:organizeHistory', (_event, folderPath?: string) => {
    return listOrganizeHistory(folderPath);
  });
  ipcMain.handle('toolbox:undoOrganize', async (_event, runId: string) => {
    return await undoOrganize(runId);
  });

    WinList.push(mainWindow);
}
export function getResourcesPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'app.asar.unpacked', 'resources');
    } else {
        return path.join(__dirname, '../../', 'resources');
    }
}
function send_view(event, value) {
    console.log(value, "下发战士端信息")
    //发布主题
    if (value.key == 'replayData') {
        publishTop(`shoot${JSON.parse(value.data).bar}`, value)
        return
    }
    if (value.key == 'serverStatus') {
        value.data.forEach(element => {
            publishTop(`shoot${element}`, value)
        });
        return
    }
    // console.log(value, "下发战士端信息")
    //发布主题
    publishTop(`shoot${value.data.barNum}`, value)
}
async function getPriviteCode() {
    const tempPath = path.join(app.getPath('userData'), 'config/core.tiger');
    try {
        let res = fs.readFileSync(tempPath, 'utf-8');
        return res;
    } catch (error) {
        return ""
    }

}
async function getCryptoJS(str) {
    let CryptoJS = require('crypto');
    return CryptoJS.createHash('md5').update(str).digest('hex');
}
const { spawn } = require('child_process');
function speekText(event, str) {
    const child = spawn('espeak-ng', ['-v', 'zh', str]);
    child.on('error', (err) => {
        console.error('espeak-ng 错误:', err);
    });
}
async function getMac(event) {
    const { machineIdSync } = require('node-machine-id');
    console.log(machineIdSync(), "machine");
    let id = machineIdSync();
    // const getMac = require('getmac')
    // const mac = getMac.default()
    // console.log(mac, "当前mac是")
    return id
}
async function getIp(event) {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const iface in interfaces) {
        for (const alias of interfaces[iface]) {
            if (alias.internal === false && alias.family === 'IPv4') {
                return alias.address;
            }
        }
    }
    return '0.0.0.0'; // 如果没有找到合适的IP地址，则返回'0.0.0.0'
}
async function getConfigs() {
    console.log('getConfigs');
    var configs = {
        windowWidth: 0,
        windowHeight: 0,
        softwareConfigsList: [],
        quickCmdParasList: [],
        retransmitParasList: [],
        historyList: [],
        comParasList: [],
        netParasList: []
    };

    // configs.windowWidth = store.get('window.width', widthDefault);
    // configs.windowHeight = store.get('window.height', heightDefault);

    // configs.softwareConfigsList = store.get('datas.softwareConfigsList', softwareConfigsListDefault);
    // configs.quickCmdParasList = store.get('datas.quickCmdParasList', quickCmdParasListDefault);
    // configs.historyList = store.get('datas.historyList', historyListDefault);
    // configs.retransmitParasList = store.get('datas.retransmitParasList', retransmitParasListDefault);
    // configs.comParasList = store.get('datas.comParasList', comParasListDefault);
    // configs.netParasList = store.get('datas.netParasList', netParasListDefault);

    return configs;
}
async function setConfigs(event, config, value) {
    console.log('setConfigs');
    // if (config == "softwareConfigsList") {
    //   store.set('datas.softwareConfigsList', value);
    // }
    // if (config == "quickCmdParasList") {
    //   store.set('datas.quickCmdParasList', value);
    // }
    // if (config == "historyList") {
    //   store.set('datas.historyList', value);
    // }
    // if (config == "retransmitParasList") {
    //   store.set('datas.retransmitParasList', value);
    // }
    // if (config == "comParasList") {
    //   store.set('datas.comParasList', value);
    // }
    // if (config == "netParasList") {
    //   store.set('datas.netParasList', value);
    // }
    return 0;
}
async function openUrl(event, url) {
    shell.openExternal(url);
    return 0;
}
async function sendMessages(event, message) {
    if (message.path == 'ALL') {
        for (var i = 0; i < NetPortList.length; i++) {
            if (NetPortList[i].type == "UDP") {
                NetPortList[i].handle.send(message.data, NetPortList[i].remotePort, NetPortList[i].remoteAddr);
            }
            if (NetPortList[i].type == 'TCP Server') {
                for (var c = 0; c < NetPortList[i].handle.clientList.length; c++) {
                    NetPortList[i].handle.clientList[c].write(message.data);
                }
            }
            if (NetPortList[i].type == 'TCP Client') {
                NetPortList[i].handle.write(message.data);
            }
        }
    } else {
        for (var i = 0; i < NetPortList.length; i++) {
            if (message.path == NetPortList[i].name && NetPortList[i].type == "UDP") {
                NetPortList[i].handle.send(message.data, NetPortList[i].remotePort, NetPortList[i].remoteAddr);
                break;
            }
            if (message.path == NetPortList[i].name && NetPortList[i].type == 'TCP Server') {
                for (var c = 0; c < NetPortList[i].handle.clientList.length; c++) {
                    NetPortList[i].handle.clientList[c].write(message.data);
                }
                break;
            }
            if (message.path == NetPortList[i].name && NetPortList[i].type == 'TCP Client') {
                NetPortList[i].handle.write(message.data);
                break;
            }
        }
    }
    return 1;
}
async function setNets(event, net) {
    console.log('setNets');
    console.log(net);

    /* check if the net has opened */
    var in_list_index = -1;
    for (var i = 0; i < NetPortList.length; i++) {
        if (NetPortList[i].name == net.name) {
            in_list_index = i;
            break;
        }
    }

    /* close the net (not in list means not open berfore)*/
    if (in_list_index != -1) {
        if (NetPortList[in_list_index].type == 'UDP') {
            NetPortList[in_list_index].handle.close();
        }
        if (NetPortList[in_list_index].type == 'TCP Server') {
            NetPortList[in_list_index].handle.close();
        }
        if (NetPortList[in_list_index].type == 'TCP Client') {
            NetPortList[in_list_index].handle.end();
        }

        var message = {
            type: 'net_status',
            path: NetPortList[in_list_index].name,
            data: 0
        }
        for (var i = 0; i < WinList.length; i++) {
            WinList[i].webContents.send('ipc:recv-messages', message);
        }
        NetPortList.splice(in_list_index, 1);
        return 0;
    }

    if (net.type == 'UDP') {
        var udp_socket = dgram.createSocket("udp4");

        udp_socket.on("message", (data, remote) => {
            console.log(data)
            var message = {
                type: 'net_message',
                path: net.name,
                addr: remote.address,
                port: remote.port,
                data: data
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });

        udp_socket.on("listening", () => {
            NetPortList.push(net);
            NetPortList[NetPortList.length - 1].handle = udp_socket;
            var message = {
                type: 'net_status',
                path: net.name,
                data: 1
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });

        udp_socket.on("error", (err) => {
            console.log(err.message);
            var message = {
                type: 'net_status',
                path: net.name,
                data: 0,
                info: err.message
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });

        udp_socket.bind(net.localPort);
    }

    if (net.type == 'TCP Server') {
        var tcp_server = nettcp.createServer((client) => {
            NetPortList[i].handle.clientList.push(client);
            client.on('data', (data => {
                console.log(client)
                console.log(data)
                var message = {
                    type: 'net_message',
                    path: net.name,
                    addr: client.remoteAddress,
                    port: client.remotePort,
                    data: data
                }
                for (var i = 0; i < WinList.length; i++) {
                    WinList[i].webContents.send('ipc:recv-messages', message);
                }
            }));
        });
        tcp_server.on('error', (err => {
            console.log(err.message);
            var message = {
                type: 'net_status',
                path: net.name,
                data: 0,
                info: err.message
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        }));
        tcp_server.listen(net.localPort, () => {
            NetPortList.push(net);
            NetPortList[NetPortList.length - 1].handle = tcp_server;
            NetPortList[NetPortList.length - 1].handle.clientList = [];
            var message = {
                type: 'net_status',
                path: net.name,
                data: 1
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });
    }
    if (net.type == 'TCP Client') {
        var tcp_client = nettcp.Socket();
        tcp_client.connect(net.remotePort, net.remoteAddr, () => {
            NetPortList.push(net);
            NetPortList[NetPortList.length - 1].handle = tcp_client;
            var message = {
                type: 'net_status',
                path: net.name,
                data: 1
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });
        tcp_client.on('data', (data) => {
            console.log(data)
            var message = {
                type: 'net_message',
                path: net.name,
                addr: tcp_client.remoteAddress,
                port: tcp_client.remotePort,
                data: data
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        });
        tcp_client.on('error', (err => {
            console.log(err.message);
            var message = {
                type: 'net_status',
                path: net.name,
                data: 0,
                info: err.message
            }
            for (var i = 0; i < WinList.length; i++) {
                WinList[i].webContents.send('ipc:recv-messages', message);
            }
        }));
    }
    return 0;
}
//app权限鉴权
async function activeApp(event, args) {
    fs.access(CONFIG_PATH, fs.constants.F_OK, (err) => {
        if (err) {
            // 目录不存在，创建目录
            fs.mkdir(CONFIG_PATH, { recursive: true }, (mkdirErr) => {
                if (mkdirErr) {
                    console.error(mkdirErr, "文件创建失败");
                } else {
                    writeCode(args)
                }
            });
        } else {
            writeCode(args)
        }
    });

}

function writeCode(args) {
    fs.writeFile(`${CONFIG_PATH}/core.tiger`, args, function (err) {
        if (err) {
            return console.log(err, '👉👉👉-----------------创建激活码文件失败!')
        }
        // setTimeout(() => {
        //   // 重启
        //   if (NODE_ENV !== 'development') {
        //     app.relaunch()
        //     app.exit()
        //   }
        // }, 2 * 1000);
    })
}
// 人脸识别硬件信息读取
async function getActiveFace(event) {
    const tempPath = path.join(app.getPath('userData'), 'config/face.tiger');
    try {
        let res = fs.readFileSync(tempPath, 'utf-8');
        console.log(123, res)
        return res;
    } catch (error) {
        return ""
    }
}
// 人脸识别硬件信息创建
async function activeFace(event, args) {
    fs.access(CONFIG_PATH, fs.constants.F_OK, (err) => {
        if (err) {
            // 目录不存在，创建目录
            fs.mkdir(CONFIG_PATH, { recursive: true }, (mkdirErr) => {
                if (mkdirErr) {
                    console.error(mkdirErr, "文件创建失败");
                } else {
                    writeFaceData(args)
                }
            });
        } else {
            writeFaceData(args)
        }
    });
}
function writeFaceData(args) {
    fs.writeFile(`${CONFIG_PATH}/face.tiger`, args, function (err) {
        if (err) {
            return console.log(err, '👉👉👉-----------------创建人脸文件失败!')
        }
    })
}

// 开始处理队列
function startProcessing() {
    timer = setInterval(() => {
        if (queue.length) {
            if (!clients.length) {
                return
            }
            clients.forEach(client => {
                if (client && !client.destroyed) {
                    const newTxt = queue.shift()
                    if (newTxt) {
                        console.log("靶机号：" + client.targetNum + '===' + '指令' + newTxt)
                        client.write(newTxt);
                    }

                }
            });
        } else {
            timer = null
            clearInterval(timer)
        }
    }, interval)
}
