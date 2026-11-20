import { DEEPSEEK_WEB_PROVIDER_ID } from "../shared/deepseekWeb";
import type { CompletionThinking } from "./summarizer";
import type { ModelThinkingLevel, ProviderConfig, ProviderId, Settings } from "../shared/types";

export interface ProviderTraits {
  /** 网页端 provider 容量足够整篇直发，跳过分块；分块仅服务自定义 API provider。 */
  readonly skipsChunking: boolean;
  /** provider 自带实时联网（当前运行时只有网页端 provider 具备）。 */
  readonly nativeWebSearch: boolean;
}

/**
 * 内置 provider 的唯一能力定义源。
 *
 * 键必须是字面量（不能用 provider id 常量做计算属性），否则 `keyof typeof` 会退化成 `string`，
 * `BuiltInProviderId` 就失去对 providerAdapters 键集合的约束力。键与
 * DEEPSEEK_WEB_PROVIDER_ID 的取值一致性由 tests/providerCapabilities.test.ts 守护。
 */
export const BUILT_IN_PROVIDER_TRAITS = {
  "deepseek-web": { skipsChunking: true, nativeWebSearch: true }
} as const satisfies Record<string, ProviderTraits>;

export type BuiltInProviderId = keyof typeof BUILT_IN_PROVIDER_TRAITS;

const DEFAULT_PROVIDER_TRAITS: ProviderTraits = { skipsChunking: false, nativeWebSearch: false };

// 用 Map 而不是拿 providerId 直接索引对象：providerId 源自用户存储，
// `__proto__` / `constructor` 这类键会命中原型链。
const TRAITS_BY_PROVIDER_ID = new Map<ProviderId, ProviderTraits>(Object.entries(BUILT_IN_PROVIDER_TRAITS));

/**
 * 静态半部：只依赖 provider id，不依赖 config / settings。
 * 摘要路径（summarizer）消费它决定是否分块，避免再自行判断 provider id。
 */
export function resolveProviderTraits(providerId: ProviderId): ProviderTraits {
  return TRAITS_BY_PROVIDER_ID.get(providerId) ?? DEFAULT_PROVIDER_TRAITS;
}

export interface ProviderCapabilities extends ProviderTraits {
  thinking?: CompletionThinking;
  streaming: boolean;
  modelThinkingLevels?: ModelThinkingLevel[];
}

export function resolveProviderCapabilities(
  providerId: ProviderId,
  config: ProviderConfig,
  settings: Settings
): ProviderCapabilities {
  const selectedModel = config.models.find((model) => model.id === config.selectedModel);
  return {
    ...resolveProviderTraits(providerId),
    thinking: resolveCompletionThinking(providerId, config.selectedModel, settings),
    streaming: true,
    ...(selectedModel?.thinkingLevels?.length ? { modelThinkingLevels: selectedModel.thinkingLevels } : {})
  };
}

function resolveCompletionThinking(providerId: ProviderId, modelId: string, settings: Settings): CompletionThinking | undefined {
  const normalizedModel = modelId.toLowerCase();
  const saved = settings.modelThinkingLevels?.[`${providerId}:${modelId}`];

  if (providerId === DEEPSEEK_WEB_PROVIDER_ID) {
    return { thinking: { type: saved === "disabled" ? "disabled" : "enabled" } };
  }

  if (normalizedModel === "mimo-v2.5" || normalizedModel === "mimo-v2.5-pro") {
    return { thinking: { type: saved === "disabled" ? "disabled" : "enabled" } };
  }

  if (normalizedModel === "deepseek-v4-flash" || normalizedModel === "deepseek-v4-pro") {
    if (saved === "disabled") return { thinking: { type: "disabled" } };
    return {
      thinking: { type: "enabled" },
      reasoningEffort: saved === "max" ? "max" : "high"
    };
  }

  return undefined;
}
