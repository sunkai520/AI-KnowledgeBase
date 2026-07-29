import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SettingManager } from './settingManager';

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
    fs.mkdirSync(dir, { recursive: true });
    SettingManager.getInstance().set('dataDir', dir);
  }

  getFilePath(fileName: string): string {
    const dir = this.getDataDir() || app.getPath('userData');
    return path.join(dir, fileName);
  }
}
