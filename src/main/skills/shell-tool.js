// shell-tool.js
const { exec, execSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');

class ShellTool {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;      // 默认30秒超时
    this.cwd = options.cwd || process.cwd();     // 工作目录
    this.env = { ...process.env, ...options.env }; // 环境变量
    this.shell = options.shell || true;            // 使用系统shell
    this.maxBuffer = options.maxBuffer || 1024 * 1024 * 10; // 10MB输出限制
  }

  /**
   * 执行命令（异步Promise）
   * @param {string} command - 要执行的命令
   * @param {object} options - 覆盖默认配置
   */
  async exec(command, options = {}) {
    const config = this._mergeConfig(options);
    
    return new Promise((resolve, reject) => {
      const child = exec(command, {
        cwd: config.cwd,
        env: config.env,
        shell: config.shell,
        timeout: config.timeout,
        maxBuffer: config.maxBuffer,
        encoding: 'utf-8'
      }, (error, stdout, stderr) => {
        if (error && !config.ignoreError) {
          reject({
            success: false,
            error: error.message,
            code: error.code,
            signal: error.signal,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            command
          });
        } else {
          resolve({
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            code: error?.code || 0,
            command
          });
        }
      });

      // 超时处理
      if (config.timeout > 0) {
        setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
        }, config.timeout);
      }
    });
  }

  /**
   * 执行命令（同步阻塞）
   * @param {string} command - 要执行的命令
   */
  execSync(command, options = {}) {
    const config = this._mergeConfig(options);
    
    try {
      const output = execSync(command, {
        cwd: config.cwd,
        env: config.env,
        shell: config.shell,
        timeout: config.timeout,
        maxBuffer: config.maxBuffer,
        encoding: 'utf-8'
      });
      
      return {
        success: true,
        stdout: output.toString().trim(),
        stderr: '',
        code: 0,
        command
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.toString().trim() || '',
        stderr: error.stderr?.toString().trim() || '',
        code: error.status,
        command
      };
    }
  }

  /**
   * 流式执行（实时输出）
   * @param {string} command - 命令
   * @param {function} onData - 数据回调 (data, type: 'stdout'|'stderr')
   * @param {function} onClose - 结束回调 (code)
   */
  async spawn(command, args = [], options = {}) {
    const config = this._mergeConfig(options);
    
    return new Promise((resolve, reject) => {
      const isWin = os.platform() === 'win32';
      const shellCmd = isWin ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWin ? ['/c', command, ...args] : ['-c', `${command} ${args.join(' ')}`];

      const child = spawn(shellCmd, shellArgs, {
        cwd: config.cwd,
        env: config.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        config.onData?.(chunk, 'stdout');
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        config.onData?.(chunk, 'stderr');
      });

      child.on('close', (code) => {
        const result = {
          success: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command: `${command} ${args.join(' ')}`
        };
        config.onClose?.(code, result);
        resolve(result);
      });

      child.on('error', (err) => {
        reject({
          success: false,
          error: err.message,
          command: `${command} ${args.join(' ')}`
        });
      });

      // 输入支持
      if (config.input) {
        child.stdin.write(config.input);
        child.stdin.end();
      }

      // 超时
      if (config.timeout > 0) {
        setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
        }, config.timeout);
      }
    });
  }

  /**
   * 批量执行多条命令
   * @param {string[]} commands - 命令数组
   * @param {boolean} stopOnError - 出错时停止
   */
  async batch(commands, stopOnError = true) {
    const results = [];
    
    for (const cmd of commands) {
      try {
        const result = await this.exec(cmd);
        results.push(result);
      } catch (error) {
        results.push(error);
        if (stopOnError) break;
      }
    }
    
    return results;
  }

  /**
   * 管道命令 (cmd1 | cmd2 | cmd3)
   */
  async pipe(...commands) {
    const pipedCmd = os.platform() === 'win32'
      ? commands.join(' | ')
      : commands.join(' | ');
    return this.exec(pipedCmd);
  }

  /**
   * 安全执行（白名单校验）
   */
  async safeExec(command, allowedCommands = []) {
    const cmdName = command.split(' ')[0].toLowerCase();
    const isAllowed = allowedCommands.some(allowed => 
      cmdName === allowed.toLowerCase() || 
      command.toLowerCase().startsWith(allowed.toLowerCase())
    );
    
    if (!isAllowed && allowedCommands.length > 0) {
      throw new Error(`命令 "${cmdName}" 不在白名单中`);
    }
    
    return this.exec(command);
  }

  // 内部方法：合并配置
  _mergeConfig(options) {
    return {
      timeout: options.timeout ?? this.timeout,
      cwd: options.cwd ?? this.cwd,
      env: { ...this.env, ...options.env },
      shell: options.shell ?? this.shell,
      maxBuffer: options.maxBuffer ?? this.maxBuffer,
      ignoreError: options.ignoreError || false,
      onData: options.onData,
      onClose: options.onClose,
      input: options.input
    };
  }
}

// 预置实例方法
const shell = new ShellTool();

export default shell