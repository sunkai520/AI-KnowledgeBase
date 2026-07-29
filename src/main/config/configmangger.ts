// config/ConfigManager.ts
import { ModelConfig, defaultConfig } from './model.config';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: ModelConfig;
  private configPath: string;
  private watchers: Set<(config: ModelConfig) => void> = new Set();

  private constructor() {
    this.configPath = path.join(app.getPath('userData'), 'model-config.json');
    this.config = this.loadConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): ModelConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const fileConfig = JSON.parse(fileContent);
        return {
          ...defaultConfig,
          ...fileConfig,
          providers: { ...defaultConfig.providers, ...(fileConfig.providers || {}) },
          // 旧格式文件没有 provider 字段，忽略它，用 defaultConfig 的模型配置
          chat:      fileConfig.chat?.provider      ? { ...defaultConfig.chat,      ...fileConfig.chat }      : defaultConfig.chat,
          embedding: fileConfig.embedding?.provider ? { ...defaultConfig.embedding, ...fileConfig.embedding } : defaultConfig.embedding,
          agent:     fileConfig.agent?.provider
            ? {
                provider: fileConfig.agent.provider || defaultConfig.agent.provider,
                modelName: fileConfig.agent.modelName || defaultConfig.agent.modelName,
                temperature: fileConfig.agent.temperature ?? defaultConfig.agent.temperature,
                contextWindow: fileConfig.agent.contextWindow ?? defaultConfig.agent.contextWindow,
              }
            : defaultConfig.agent,
          media:     fileConfig.media?.imageModel
            ? { ...defaultConfig.media, ...fileConfig.media }
            : defaultConfig.media,
          // 老配置文件缺新增字段时，用 defaultConfig 补齐；旧版文件读取审批开关已废弃，不再写回
          agentPermissions: {
            enableShellExecute: fileConfig.agentPermissions?.enableShellExecute ?? defaultConfig.agentPermissions.enableShellExecute,
          },
        };
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    return { ...defaultConfig };
  }

  saveConfig(newConfig: Partial<ModelConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      // providers 深合并，不因局部更新而丢失其他厂商的 key
      providers: { ...this.config.providers, ...(newConfig.providers || {}) },
      // agent 深合并；子 Agent 不再持久化，复杂任务由 deepagents 的 task 临时委托处理
      agent: newConfig.agent ? {
        provider: newConfig.agent.provider || this.config.agent.provider,
        modelName: newConfig.agent.modelName || this.config.agent.modelName,
        temperature: newConfig.agent.temperature ?? this.config.agent.temperature,
        contextWindow: newConfig.agent.contextWindow ?? this.config.agent.contextWindow,
      } : this.config.agent,
      media: newConfig.media ? { ...this.config.media, ...newConfig.media } : this.config.media,
      // agentPermissions 只保留当前有效开关；文件读取固定免审批，不再做成配置项
      agentPermissions: {
        enableShellExecute: newConfig.agentPermissions?.enableShellExecute ?? this.config.agentPermissions.enableShellExecute,
      },
    };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      this.watchers.forEach(cb => cb(this.config));
    } catch (error) {
      console.error('保存配置失败:', error);
      throw error;
    }
  }

  getConfig(): ModelConfig {
    return { ...this.config };
  }

  onConfigChange(callback: (config: ModelConfig) => void): () => void {
    this.watchers.add(callback);
    return () => this.watchers.delete(callback);
  }

  reset(): void {
    this.config = { ...defaultConfig };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      this.watchers.forEach(cb => cb(this.config));
    } catch (error) {
      console.error('重置配置失败:', error);
    }
  }
}
