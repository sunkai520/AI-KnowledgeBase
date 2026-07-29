// src/main/task-manager.js
const {
  Worker
} = require('worker_threads')
const {
  BrowserWindow
} = require('electron')
const path = require('path')
const EventEmitter = require('events')
export class ElectronTaskManager extends EventEmitter {
  constructor() {
    super()
    if (ElectronTaskManager.instance) {
      return ElectronTaskManager.instance
    }

    this.taskQueue = [] // 等待队列
    this.activeWorkers = new Map() // 工作线程池
    this.maxConcurrency = 2 // 默认并发数
    this.workerScript = null // Worker 文件路径
    this.isRunning = false

    ElectronTaskManager.instance = this
  }

  static getInstance() {
    if (!ElectronTaskManager.instance) {
      ElectronTaskManager.instance = new ElectronTaskManager()
    }
    return ElectronTaskManager.instance
  }

  // 初始化线程池
  initialize(workerPath, concurrency = 2) {
    if (this.isRunning) {
      console.log('[TaskManager] 已经初始化')
      return
    }

    this.workerScript = workerPath
    this.maxConcurrency = concurrency

    console.log(`[TaskManager] 启动 ${concurrency} 个 Worker 线程...`)

    // 创建工作线程池
    for (let i = 0; i < concurrency; i++) {
      this.createWorker(i)
    }

    this.isRunning = true
  }

  createWorker(id) {
    console.log(`[TaskManager] 创建 Worker ${id}...`)

    const worker = new Worker(this.workerScript)

    worker.on('message', (msg) => {
      this.handleWorkerMessage(id, msg)
    })

    worker.on('error', (err) => {
      console.error(`[Worker ${id}] 错误:`, err)
      // 重启 Worker
      this.activeWorkers.delete(id)
      setTimeout(() => this.createWorker(id), 1000)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Worker ${id}] 退出，代码: ${code}`)
        this.activeWorkers.delete(id)
        // 异常退出时重启
        if (this.isRunning) {
          setTimeout(() => this.createWorker(id), 1000)
        }
      }
    })

    this.activeWorkers.set(id, {
      id,
      worker,
      busy: false,
      currentTask: null,
      ready: false
    })
  }

  handleWorkerMessage(workerId, msg) {
    const workerInfo = this.activeWorkers.get(workerId)
    switch (msg.type) {
      case 'ready':
        // console.log(`[Worker ${workerId}] 就绪 (Thread-${msg.threadId})`)
        workerInfo.ready = true
        this.processNext(workerId)
        break

      case 'progress':
        // console.log(`[task:progress] 任务 ${msg.taskId} 进度: ${msg.progress}`)
        // 转发到渲染进程
        this.notifyRenderer('task:progress', {
          taskId: msg.taskId,
          progress: msg.progress,
          message: msg.message
        })
        this.emit('task:progress', {
          taskId: msg.taskId,
          progress: msg.progress,
          message: msg.message
        })
        break

      case 'result':
        // console.log(`[TaskManager] 任务 ${msg.taskId} 完成`)
        //通知渲染进程
        this.notifyRenderer('task:completed', {
          taskId: msg.taskId,
          result: msg.result
        })
        //通知主进程
        this.emit('task:completed', {
          taskId: msg.taskId,
          progress: msg.progress,
          message: msg.message
        })
        this.processNext(workerId)
        break

      case 'error':
        console.error(`[TaskManager] 任务 ${msg.taskId} 失败:`, msg.error)
        //通知渲染进程
        this.notifyRenderer('task:failed', {
          taskId: msg.taskId,
          error: msg.error
        })
        //通知主进程
        this.emit('task:failed', {
          taskId: msg.taskId,
          error: msg.error
        })
        this.processNext(workerId)
        break
    }
  }

  processNext(workerId) {
    const workerInfo = this.activeWorkers.get(workerId)
    if (!workerInfo || !workerInfo.ready) return
    workerInfo.busy = false
    workerInfo.currentTask = null
    // 检查等待队列
    if (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()
      this.executeTask(workerId, task)
    } else {
      console.log(`[Worker ${workerId}] 空闲，等待任务...`)
    }
  }

  executeTask(workerId, task) {
    const workerInfo = this.activeWorkers.get(workerId)
    workerInfo.busy = true
    workerInfo.currentTask = task
    console.log(`[Worker ${workerId}] 开始执行任务 ${task.id}`)
    workerInfo.worker.postMessage({
      type: 'task',
      taskId: task.id,
      data: task.data
    })
  }

  // 添加任务
  addTask(data, opts = {}) {
    const taskId = opts.jobId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const task = {
      id: taskId,
      data,
      addedAt: Date.now()
    }
    // 寻找空闲 Worker
    const idleWorker = Array.from(this.activeWorkers.values())
      .find(w => w.ready && !w.busy)

    if (idleWorker) {
      console.log(`[TaskManager] 立即执行任务 ${taskId}`)
      this.executeTask(idleWorker.id, task)
    } else {
      console.log(`[TaskManager] 任务 ${taskId} 进入等待队列 (前面还有 ${this.taskQueue.length} 个)`)
      this.taskQueue.push(task)
    }

    return {
      id: taskId,
      status: idleWorker ? 'processing' : 'queued'
    }
  }
  // 获取状态
  getStatus() {
    return {
      queueLength: this.taskQueue.length,
      workers: Array.from(this.activeWorkers.values()).map(w => ({
        id: w.id,
        busy: w.busy,
        ready: w.ready,
        currentTask: w.currentTask ?.id || null
      }))
    }
  }

  notifyRenderer(channel, data) {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    })
  }

  // 关闭所有 Worker
  closeAll() {
    console.log('[TaskManager] 正在关闭...')
    this.isRunning = false
    for (const [id, info] of this.activeWorkers) {
      console.log(`[TaskManager] 终止 Worker ${id}`)
      info.worker.terminate()
    }
    this.activeWorkers.clear()
    this.taskQueue = []
  }
}
