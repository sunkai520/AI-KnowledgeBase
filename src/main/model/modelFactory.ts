// models/ModelFactory.ts
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
//@ts-ignore
import { ConfigManager } from '../config/configmangger';
import { ModelConfig, ProviderConfig } from '../config/model.config';
// @ts-ignore
import { setLog } from "../event/index"
// @ts-ignore
import { createResponsesAnnotationFix } from "./patchedFetch";

export interface ModelInstance {
  model: ChatOpenAI | OpenAIEmbeddings;
  config: ModelConfig;
  createdAt: number;
}

/** 从 providers 注册表解析 apiKey / baseUrl */
function resolveProvider(
  providers: Record<string, ProviderConfig>,
  providerName: string,
): { apiKey: string; baseUrl: string } {
  const p = providers[providerName];
  if (!p) throw new Error(`未找到厂商 "${providerName}"，请在模型配置页面添加`);
  return { apiKey: p.apiKey, baseUrl: p.baseUrl };
}

/** getChatModel / getImageModel 的临时覆盖参数 */
export interface ChatOverride {
  provider?: string;
  modelName?: string;
  temperature?: number;
  streaming?: boolean;
  /** 规避部分中转网关 Responses API 流式响应丢 annotations 字段导致崩溃的问题，见 patchedFetch.js 注释 */
  patchResponsesAnnotations?: boolean;
}

/** #7: 包含 apiKey/baseUrl 指纹，确保用户改完配置后立即生效 */
function configFingerprint(apiKey: string, baseUrl: string): string {
  let h = 0;
  const s = apiKey + '|' + baseUrl;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export class ModelFactory {
  private static instances: Map<string, ModelInstance> = new Map();

  /** 获取聊天模型 */
  static getChatModel(options?: {
    isNew?: boolean;
    customConfig?: ChatOverride;
    tag?: string;
  }): ChatOpenAI {
    const baseConfig = ConfigManager.getInstance().getConfig();
    const chat = baseConfig.chat;
    const override = options?.customConfig || {};

    const providerName = override.provider ?? chat.provider;
    const { apiKey, baseUrl } = resolveProvider(baseConfig.providers, providerName);

    const finalConfig = {
      providerName,
      modelName:   override.modelName   ?? chat.modelName,
      temperature: override.temperature ?? chat.temperature,
      streaming:   override.streaming   ?? chat.streaming,
      apiKey,
      baseUrl,
    };

    const cacheKey = options?.tag
      ? `chat-${options.tag}`
      : `chat-${finalConfig.providerName}-${finalConfig.modelName}-${finalConfig.temperature}-${configFingerprint(finalConfig.apiKey, finalConfig.baseUrl)}`;

    if (!options?.isNew) {
      const cached = this.instances.get(cacheKey);
      if (cached) {
        console.log(`✅ 使用缓存的 Chat 模型 [${cacheKey}]`);
        return cached.model as ChatOpenAI;
      }
    }

    setLog(`创建新的 Chat 模型 [${JSON.stringify(finalConfig)}]`);
    const model = new ChatOpenAI({
      model:         finalConfig.modelName,
      temperature:   finalConfig.temperature,
      apiKey:        finalConfig.apiKey,
      configuration: {
        baseURL: finalConfig.baseUrl,
        ...(override.patchResponsesAnnotations ? { fetch: createResponsesAnnotationFix() } : {}),
      },
      streaming:     finalConfig.streaming,
      maxRetries:    2,
    });

    this.instances.set(cacheKey, { model, config: baseConfig, createdAt: Date.now() });
    return model;
  }

  /** 获取 Embedding 模型 */
  static getEmbeddingModel(options?: { isNew?: boolean }): OpenAIEmbeddings {
    const baseConfig = ConfigManager.getInstance().getConfig();
    const emb = baseConfig.embedding;
    const { apiKey, baseUrl } = resolveProvider(baseConfig.providers, emb.provider);

    const cacheKey = `embedding-${emb.provider}-${emb.modelName}-${emb.dimensions}-${emb.batchSize}-${configFingerprint(apiKey, baseUrl)}`;
    if (!options?.isNew) {
      const cached = this.instances.get(cacheKey);
      if (cached) {
        console.log('✅ 使用缓存的 Embedding 模型');
        return cached.model as OpenAIEmbeddings;
      }
    }

    const model = new OpenAIEmbeddings({
      model:         emb.modelName,
      dimensions:    emb.dimensions,
      batchSize:     emb.batchSize,
      apiKey,
      configuration: { baseURL: baseUrl },
    });

    this.instances.set(cacheKey, { model, config: baseConfig, createdAt: Date.now() });
    return model;
  }

  /** 清空特定或全部模型缓存 */
  static clearCache(key?: string): void {
    if (key) this.instances.delete(key);
    else     this.instances.clear();
  }

  /** 获取所有活跃的模型实例（用于监控） */
  static getActiveModels(): Array<{ key: string; model: string; createdAt: number }> {
    return Array.from(this.instances.entries()).map(([key, instance]) => ({
      key,
      model:     (instance.model as any).modelName || 'unknown',
      createdAt: instance.createdAt,
    }));
  }
}
