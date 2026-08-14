import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const log = require('electron-log');

export interface AppSettings {
  dataDir?: string;
  localChecked?: boolean;
  proxyEnabled?: boolean;
  proxyMode?: ProxyMode;
  proxyUrl?: string;
}

export type ProxyMode = 'direct' | 'global' | 'pac';

const DEFAULTS: AppSettings = {
  localChecked: false,
  proxyEnabled: false,
  proxyMode: 'global',
  proxyUrl: '',
};

export class SettingManager {
  private static instance: SettingManager;
  private readonly settingPath: string;
  private settings: AppSettings;

  private constructor() {
    this.settingPath = path.join(app.getPath('userData'), 'setting.json');
    this.settings = this.load();
  }

  static getInstance(): SettingManager {
    if (!SettingManager.instance) {
      SettingManager.instance = new SettingManager();
    }
    return SettingManager.instance;
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.settingPath)) {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.settingPath, 'utf-8')) };
      }
    } catch (e: any) {
      // setting.json 存在但损坏（写入中途崩溃/断电/被杀软拦截等），不能静默丢弃 dataDir，
      // 否则表现为“重新打开应用后数据丢失”——先备份原文件保留取证/恢复线索，再退回默认值
      log.warn(`[SettingManager] setting.json 解析失败，已损坏，退回默认配置。原因：${e?.message}`);
      this.backupCorruptFile(this.settingPath);
    }

    // 迁移旧的 data-path.json
    const legacyPath = path.join(app.getPath('userData'), 'data-path.json');
    try {
      if (fs.existsSync(legacyPath)) {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
        const migrated: AppSettings = { ...DEFAULTS, dataDir: legacy.dataDir };
        this.persist(migrated);
        return migrated;
      }
    } catch (e: any) {
      log.warn(`[SettingManager] 旧版 data-path.json 解析失败，迁移跳过。原因：${e?.message}`);
      this.backupCorruptFile(legacyPath);
    }

    return { ...DEFAULTS };
  }

  private backupCorruptFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const backupPath = `${filePath}.corrupt-${Date.now()}.bak`;
      fs.copyFileSync(filePath, backupPath);
      log.warn(`[SettingManager] 已备份损坏文件到：${backupPath}`);
    } catch (e: any) {
      log.error(`[SettingManager] 备份损坏文件失败：${e?.message}`);
    }
  }

  private persist(settings: AppSettings): void {
    fs.writeFileSync(this.settingPath, JSON.stringify(settings, null, 2));
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.persist(this.settings);
  }

  getAll(): AppSettings {
    return { ...this.settings };
  }
}
