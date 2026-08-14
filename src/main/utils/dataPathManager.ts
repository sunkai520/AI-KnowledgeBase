import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SettingManager } from './settingManager';

function describeFsError(e: any, dir: string, action: string): string {
  const code = e?.code;
  const reasonMap: Record<string, string> = {
    EACCES: '没有权限访问该目录，请更换一个当前用户有读写权限的目录（避免选择“C:\\Program Files”等系统受保护目录）',
    EPERM: '操作被系统拒绝（权限不足或被安全软件拦截），请更换目录或以管理员身份运行后重试',
    ENOSPC: '磁盘空间不足，请清理磁盘空间或更换到空间充足的磁盘',
    EROFS: '目标磁盘为只读，无法写入，请更换目录',
    ENOENT: '路径不存在或上级目录无效，请重新选择一个有效的路径',
    ENAMETOOLONG: '路径过长，请选择层级更浅的目录',
    EEXIST: '该路径下已存在同名文件，无法作为目录使用，请更换目录',
    EBUSY: '该目录正被其他程序占用，请关闭相关程序后重试',
  };
  const reason = (code && reasonMap[code]) || e?.message || '未知错误';
  return `${action}失败（路径：${dir}）：${reason}${code ? `［${code}］` : ''}`;
}

export class DataPathManager {
  private static instance: DataPathManager;

  private constructor() {}

  static getInstance(): DataPathManager {
    if (!DataPathManager.instance) {
      DataPathManager.instance = new DataPathManager();
    }
    return DataPathManager.instance;
  }

  isConfigured(): boolean {
    return !!SettingManager.getInstance().get('dataDir');
  }

  getDataDir(): string | null {
    return SettingManager.getInstance().get('dataDir') || null;
  }

  setDataDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e: any) {
      throw new Error(describeFsError(e, dir, '创建目录'));
    }

    // mkdir 成功不代表可写（目录已存在但权限受限等情况），实际探测一次写权限
    const probe = path.join(dir, `.write-test-${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'test');
      fs.unlinkSync(probe);
    } catch (e: any) {
      throw new Error(describeFsError(e, dir, '写入测试'));
    }

    try {
      SettingManager.getInstance().set('dataDir', dir);
    } catch (e: any) {
      throw new Error(`数据目录“${dir}”创建成功，但保存配置失败：${describeFsError(e, dir, '保存配置')}`);
    }
  }

  getFilePath(fileName: string): string {
    const dir = this.getDataDir() || app.getPath('userData');
    return path.join(dir, fileName);
  }
}
