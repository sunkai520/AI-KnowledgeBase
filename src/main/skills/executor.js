const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 通用 JavaScript 脚本执行器
 * 支持自定义路径、工作目录和环境变量
 */

class ScriptExecutor {
  
  /**
   * 解析脚本路径（支持绝对路径和相对路径）
   */
  resolveScriptPath(scriptPath, cwd) {
    // 如果是绝对路径，直接使用
    if (path.isAbsolute(scriptPath)) {
      return scriptPath;
    }
    // 相对路径：基于 cwd 或当前工作目录解析
    const baseDir = cwd || process.cwd();
    return path.resolve(baseDir, scriptPath);
  }

  /**
   * 验证脚本安全性
   */
  validateScript(scriptPath) {
    // 检查文件是否存在
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`脚本不存在: ${scriptPath}`);
    }
    
    // 检查是否为文件
    const stats = fs.statSync(scriptPath);
    if (!stats.isFile()) {
      throw new Error(`路径不是文件: ${scriptPath}`);
    }
    
    // 检查扩展名
    const ext = path.extname(scriptPath).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') {
      throw new Error(`不支持的文件类型: ${ext}，仅支持 .js/.mjs/.cjs`);
    }
    
    return true;
  }

  /**
   * 执行 JavaScript 脚本
   * 
   * @param {Object} options
   * @param {string} options.script_path - 脚本路径（绝对或相对）
   * @param {string[]} options.args - 命令行参数
   * @param {string} options.cwd - 工作目录（可选，默认脚本所在目录）
   * @param {Object} options.env - 自定义环境变量
   * @param {number} options.timeout - 超时时间（毫秒）
   * @param {string[]} options.node_options - Node.js 选项
   * 
   * @returns {Promise<Object>} 执行结果
   */
  async execute({
    script_path,
    args = [],
    cwd = null,
    env = {},
    timeout = 30000,
    node_options = []
  }) {
    const startTime = Date.now();
    
    try {
      // 解析路径
      const resolvedPath = this.resolveScriptPath(script_path, cwd);
      
      // 安全验证
      this.validateScript(resolvedPath);
      
      // 确定工作目录
      const workingDir = cwd || path.dirname(resolvedPath);
      
      // 确保工作目录存在
      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
      }

      // 构建环境变量
      const childEnv = {
        ...process.env,
        ...env,
        SCRIPT_EXECUTION: 'true',
        SCRIPT_START_TIME: startTime.toString()
      };

      // 构建命令参数
      const spawnArgs = [
        ...node_options,
        resolvedPath,
        ...args
      ];

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        // 启动子进程
        const child = spawn('node', spawnArgs, {
          cwd: workingDir,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // 收集输出
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        // 超时处理
        const timeoutId = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
          
          // 5秒后强制终止
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }, timeout);

        // 进程结束
        child.on('close', (code, signal) => {
          clearTimeout(timeoutId);
          
          const executionTime = Date.now() - startTime;
          
          resolve({
            success: code === 0 && !killed,
            exit_code: code,
            signal: signal,
            killed: killed,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            execution_time_ms: executionTime,
            script_path: resolvedPath,
            working_dir: workingDir,
            args: args
          });
        });

        // 错误处理
        child.on('error', (err) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            exit_code: -1,
            error: err.message,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            execution_time_ms: Date.now() - startTime,
            script_path: resolvedPath
          });
        });
      });

    } catch (err) {
      return {
        success: false,
        exit_code: -1,
        error: err.message,
        stdout: '',
        stderr: err.stack,
        execution_time_ms: Date.now() - startTime,
        script_path: script_path
      };
    }
  }

  /**
   * 批量执行多个脚本
   */
  async executeBatch(tasks) {
    const results = [];
    for (const task of tasks) {
      const result = await this.execute(task);
      results.push(result);
      // 如果某个脚本失败且配置了中断，可以在这里处理
      if (!result.success && task.abort_on_error) {
        break;
      }
    }
    return results;
  }
}

// 导出实例
export default new ScriptExecutor();

