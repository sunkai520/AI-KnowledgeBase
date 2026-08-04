// config/model.config.ts

/** 单个厂商的连接信息 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  label?: string;
}

/** 内置厂商预设（baseUrl 不含 apiKey，仅做参考/UI 提示） */
export const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string }> = {
  alibaba:     { label: '阿里云百炼 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  deepseek:    { label: 'DeepSeek',          baseUrl: 'https://api.deepseek.com/v1' },
  openai:      { label: 'OpenAI',            baseUrl: 'https://api.openai.com/v1' },
  siliconflow: { label: '硅基流动 (SiliconFlow)', baseUrl: 'https://api.siliconflow.cn/v1' },
  xkapi:     { label: '自建',      baseUrl: 'http://localhost:8080/v1' },
};

export interface chatTs {
  provider: string;
  modelName: string;
  temperature: number;
  streaming?: boolean;
  /** 模型的最大输入上下文窗口（token 数）。第三方厂商模型没有官方 profile 可自动识别，需要手动配置，用于动态计算长期记忆压缩阈值 */
  contextWindow?: number;
}

export interface embeddingTs {
  provider: string;
  modelName: string;
  dimensions?: number;
  batchSize?: number;
}

export interface AgentPermissions {
  /** 是否允许 AI 员工执行系统命令（execute 工具）。命令在本机真实执行，无沙箱隔离，默认关闭 */
  enableShellExecute: boolean;
  // 自建/自改 Skill 固定需审批，不做成可配置开关（见 deepAgentServer/index.js 的 interruptOn）
}

export interface AgentModelConfig {
  provider: string;
  modelName: string;
  temperature: number;
  /** 同 chatTs.contextWindow，超级员工独立配置，因为可能用不同的模型 */
  contextWindow?: number;
}

/** 文生图 / 图生视频模型配置。provider 复用 providers 注册表里的 apiKey（目前固定走阿里云百炼-通义万相） */
export interface MediaModelConfig {
  provider: string;
  imageModel: string;
  videoModel: string;
}

export interface ModelConfig {
  /** 厂商注册表：key 为厂商标识，可自由扩展 */
  providers: Record<string, ProviderConfig>;
  chat: chatTs;
  embedding: embeddingTs;
  agentPermissions: AgentPermissions;
  /** 超级AI员工独立模型配置，与全局 chat 模型互不干扰 */
  agent: AgentModelConfig;
  /** 超级AI员工的文生图/图生视频模型配置 */
  media: MediaModelConfig;
}

export const defaultConfig: ModelConfig = {
  providers: {
    alibaba:     { label: '阿里云百炼 (Qwen)',       apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    deepseek:    { label: 'DeepSeek',                apiKey: '', baseUrl: 'https://api.deepseek.com/v1' },
    openai:      { label: 'OpenAI',                  apiKey: '', baseUrl: 'https://api.openai.com/v1' },
    moonshot:    { label: '月之暗面 (Moonshot)',      apiKey: '', baseUrl: 'https://api.moonshot.cn/v1' },
    zhipu:       { label: '智谱 (GLM)',               apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    siliconflow: { label: '硅基流动 (SiliconFlow)',   apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1' },
    xkapi:     { label: '自建',             apiKey: '', baseUrl: 'http://localhost:8080/v1' },
  },
  chat: {
    provider:    'deepseek',
    modelName:   'deepseek-v3.2',
    temperature: 0.7,
    streaming:   true,
    contextWindow: 32000,
  },
  embedding: {
    provider:   'alibaba',
    modelName:  'text-embedding-v4',
    dimensions: 1024,
    batchSize:  10,
  },
  agentPermissions: {
    enableShellExecute: false,
  },
  agent: {
    provider: 'deepseek',
    modelName: 'deepseek-v3.2',
    temperature: 0.7,
    contextWindow: 32000,
  },
  media: {
    provider: 'alibaba',
    imageModel: 'wanx2.1-t2i-turbo',
    videoModel: 'wan2.6-i2v-flash',
  },
};
