import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
        contextBridge.exposeInMainWorld('electronAPI', {
            selectFile: () => ipcRenderer.invoke('ipc:selctFile'),
            uploadFile:(path)=> ipcRenderer.invoke('ipc:uploadDoc',path),
            // 输入框粘贴/拖拽上传
            resolvePastedFile: (filePath: string) => ipcRenderer.invoke('ipc:resolvePastedFile', filePath),
            savePastedImage: (dataUrl: string) => ipcRenderer.invoke('ipc:savePastedImage', dataUrl),
            // Electron 32 起渲染进程 File 对象不再带 path，需在 preload 里用 webUtils 解析真实路径
            getPathForFile: (file: File) => webUtils.getPathForFile(file),
            // 历史消息回显附件（不拷贝，纯读取已落盘的路径）
            readStoredAttachment: (filePath: string) => ipcRenderer.invoke('ipc:readStoredAttachment', filePath),
            // win 
            setWindowMin: () => ipcRenderer.send('ipc:set-window-min'),
            setWindowMax: () => ipcRenderer.send('ipc:set-window-max'),
            setWindowExit: () => ipcRenderer.send('ipc:set-window-exit'),
            sendLog: (str) => ipcRenderer.send('ipc:log', str),
            //linces激活app
            activeApp: (str) => ipcRenderer.invoke('ipc:activeApp', str),
            getPriviteCode: () => ipcRenderer.invoke('ipc:getPriviteCode'),
            // url
            openUrl: (url) => ipcRenderer.invoke('ipc:open-url', url),
            // config
            getConfigs: () => ipcRenderer.invoke('ipc:get-configs'),
            setConfigs: (config, value) => ipcRenderer.invoke('ipc:set-configs', config, value),
            // net
            setNets: (net) => ipcRenderer.invoke('ipc:set-nets', net),
            // message 
            //向串口发送信息
            sendMessages: (message) => ipcRenderer.invoke('ipc:send-messages', message),
            //接收串口信息
            recvMessages: (callback) => ipcRenderer.on('ipc:recv-messages', callback),
            //获取本机mac
            getmac: () => ipcRenderer.invoke('ipc:getmac'),
            getIp: () => ipcRenderer.invoke('ipc:getIp'),
            speekText: (message) => ipcRenderer.invoke('ipc:speak', message),
            onListenMainProcess: (callback) => ipcRenderer.on('render-message', (_event, value) => {
                ipcRenderer.invoke('ipc:send-view', value)
                callback(value)
            }),
            // 硬件识别人脸信息
            onListenFaceMainProcess: (callback) => ipcRenderer.on('render-message-face', (_event, value) => {
                callback(value)
            }),
            // 靶机断线
            setDisconnect: (callback) => ipcRenderer.on('render-message-disconnect', (_event, value) => {
                callback(value)
            }),
            //获取模型配置
            getModelConfig: () => ipcRenderer.invoke('model:getConfig'),
            updateModelConfig:(config)=> ipcRenderer.invoke('model:updateConfig',config),
            // 数据目录
            getDataPathStatus: () => ipcRenderer.invoke('dataPath:getStatus'),
            setDataDir: (dir: string) => ipcRenderer.invoke('dataPath:setDir', dir),
            selectDataDir: () => ipcRenderer.invoke('dataPath:selectDir'),
            restartApp: () => ipcRenderer.invoke('dataPath:restart'),
            // 用系统文件管理器打开目录/文件
            openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
            // 统一设置
            getAllSettings: () => ipcRenderer.invoke('setting:getAll'),
            getSetting: (key: string) => ipcRenderer.invoke('setting:get', key),
            setSetting: (key: string, value: any) => ipcRenderer.invoke('setting:set', key, value),
            // 代理测试
            testProxy: (proxyUrl: string, proxyMode?: string) => ipcRenderer.invoke('setting:testProxy', proxyUrl, proxyMode),
            configureOnlineSearchProxy: (engine: string) => ipcRenderer.invoke('onlineSearch:configureProxy', engine),
            clearOnlineSearchProxy: () => ipcRenderer.invoke('onlineSearch:clearProxy'),
            // AI 联网搜索会话养号：打开可见窗口，手动搜几次/过验证码，之后无头搜索共享同一分区
            warmupSearchSession: (engine?: string) => ipcRenderer.invoke('search:warmupSession', engine),
            // PAC 名单管理
            getPacListInfo: () => ipcRenderer.invoke('pac:getListInfo'),
            updatePacList: () => ipcRenderer.invoke('pac:updateList'),
            ensurePacListReady: () => ipcRenderer.invoke('pac:ensureListReady'),
            getPacCustomDomains: () => ipcRenderer.invoke('pac:getCustomDomains'),
            setPacForceProxyDomains: (domains: string[]) => ipcRenderer.invoke('pac:setForceProxyDomains', domains),
            setPacForceDirectDomains: (domains: string[]) => ipcRenderer.invoke('pac:setForceDirectDomains', domains),
            onOpenOnlineSearchFind: (callback: () => void) => {
                const listener = () => callback()
                ipcRenderer.on('online-search:open-find', listener)
                return () => ipcRenderer.removeListener('online-search:open-find', listener)
            },
            onOpenOnlineSearchNewTab: (callback: (url: string) => void) => {
                const listener = (_event, url: string) => callback(url)
                ipcRenderer.on('online-search:new-tab', listener)
                return () => ipcRenderer.removeListener('online-search:new-tab', listener)
            },
            onOnlineSearchAiAnalyze: (callback: (payload: any) => void) => {
                const listener = (_event, payload: any) => callback(payload)
                ipcRenderer.on('online-search:ai-analyze', listener)
                return () => ipcRenderer.removeListener('online-search:ai-analyze', listener)
            },
            // 浏览器路径选择
            getBrowserDefaults: () => ipcRenderer.invoke('setting:getBrowserDefaults'),
            selectBrowserExe: () => ipcRenderer.invoke('setting:selectBrowserExe'),
            selectBrowserUserDataDir: () => ipcRenderer.invoke('setting:selectBrowserUserDataDir'),
            // AI 超级员工：选择命令执行的工作目录
            selectAgentWorkDir: () => ipcRenderer.invoke('agent:selectWorkDir'),
            // Skill 一键导入：选择本地文件夹
            selectSkillImportFolder: () => ipcRenderer.invoke('skills:selectImportFolder'),
            // 工具箱：定时任务
            scheduledTaskList: () => ipcRenderer.invoke('scheduledTask:list'),
            scheduledTaskCreate: (input) => ipcRenderer.invoke('scheduledTask:create', input),
            scheduledTaskUpdate: (id: string, input) => ipcRenderer.invoke('scheduledTask:update', id, input),
            scheduledTaskDelete: (id: string) => ipcRenderer.invoke('scheduledTask:delete', id),
            scheduledTaskToggle: (id: string, enabled: boolean) => ipcRenderer.invoke('scheduledTask:toggle', id, enabled),
            scheduledTaskRunNow: (id: string) => ipcRenderer.invoke('scheduledTask:runNow', id),
            selectScheduledTaskWorkDir: () => ipcRenderer.invoke('scheduledTask:selectWorkDir'),
            scheduledTaskListRuns: (taskId: string) => ipcRenderer.invoke('scheduledTask:listRuns', taskId),
            scheduledTaskGetRunSteps: (runId: string) => ipcRenderer.invoke('scheduledTask:getRunSteps', runId),
            scheduledTaskUpdateLearnedNotes: (id: string, notes: string | null) =>
                ipcRenderer.invoke('scheduledTask:updateLearnedNotes', id, notes),
            onScheduledTaskUpdate: (callback: (payload: any) => void) => {
                const listener = (_event, payload: any) => callback(payload)
                ipcRenderer.on('scheduledTask:update', listener)
                return () => ipcRenderer.removeListener('scheduledTask:update', listener)
            },
            // 工具箱：文件夹自动归类
            selectOrganizeFolder: () => ipcRenderer.invoke('toolbox:selectFolder'),
            previewOrganize: (folderPath: string, options) => ipcRenderer.invoke('toolbox:previewOrganize', folderPath, options),
            applyOrganize: (folderPath: string, plan) => ipcRenderer.invoke('toolbox:applyOrganize', folderPath, plan),
            organizeHistory: (folderPath?: string) => ipcRenderer.invoke('toolbox:organizeHistory', folderPath),
            undoOrganize: (runId: string) => ipcRenderer.invoke('toolbox:undoOrganize', runId),
        })
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI
    // @ts-ignore (define in dts)
    window.api = api
}
