import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

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
    } catch {}

    // 迁移旧的 data-path.json
    const legacyPath = path.join(app.getPath('userData'), 'data-path.json');
    try {
      if (fs.existsSync(legacyPath)) {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
        const migrated: AppSettings = { ...DEFAULTS, dataDir: legacy.dataDir };
        this.persist(migrated);
        return migrated;
      }
    } catch {}

    return { ...DEFAULTS };
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
