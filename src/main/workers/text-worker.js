// src/main/workers/video-worker.js
const { parentPort, threadId } = require('worker_threads')
const fs = require('fs')
const path = require('path')

// 日志文件（Worker 中 console 看不到，写入文件）
const logFile = path.join(__dirname, '../../worker.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] [Thread-${threadId}] ${msg}\n`
  fs.appendFileSync(logFile, line)
}

// 告诉主线程 Worker 已就绪
parentPort.postMessage({ type: 'ready', threadId })

// 监听主线程发来的任务
parentPort.on('message', async (msg) => {
  if (msg.type === 'task') {
    const { taskId, data } = msg
    
    log(`========== 开始任务 ${taskId} ==========`)
    log(`数据: ${JSON.stringify(data)}`)
    
    try {
      // 模拟视频转码过程
      const steps = [
        { progress: 10, msg: '读取视频文件', delay: 500 },
        { progress: 30, msg: '分析视频流', delay: 800 },
        { progress: 50, msg: '开始转码 H.264', delay: 1000 },
        { progress: 70, msg: '处理音频轨道', delay: 800 },
        { progress: 90, msg: '封装输出文件', delay: 500 },
        { progress: 100, msg: '完成', delay: 200 }
      ]
      
      for (const step of steps) {
        // 发送进度给主线程
        parentPort.postMessage({
          type: 'progress',
          taskId,
          progress: step.progress,
          message: step.msg
        })
        
        log(`${step.msg} (${step.progress}%)`)
        
        // 模拟耗时操作（不会阻塞主进程！）
        await new Promise(resolve => setTimeout(resolve, step.delay))
        
        // 模拟随机失败（测试重试机制）
        if (data.shouldFail && step.progress === 50) {
          throw new Error('模拟转码失败')
        }
      }
      
      // 发送完成结果
      const result = {
        outputFile: data.inputFile.replace('.mp4', '_1080p.mp4'),
        duration: '00:05:30',
        size: '256MB'
      }
      
      parentPort.postMessage({
        type: 'result',
        taskId,
        result
      })
      
      log(`========== 任务 ${taskId} 成功 ==========`)
      
    } catch (error) {
      // 发送错误
      parentPort.postMessage({
        type: 'error',
        taskId,
        error: error.message
      })
      
      log(`========== 任务 ${taskId} 失败: ${error.message} ==========`)
    }
  }
})