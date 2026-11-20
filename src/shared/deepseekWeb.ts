import type { ModelInfo, ProviderId, ProviderSettings } from "./types";

export const DEEPSEEK_WEB_PROVIDER_ID: ProviderId = "deepseek-web";
export const DEEPSEEK_WEB_PROVIDER_LABEL = "DeepSeek 网页端";

export const DEEPSEEK_WEB_MODELS: ModelInfo[] = [
  { id: "deepseek-chat", label: "DeepSeek" }
];

export const DEEPSEEK_WEB_DEFAULT_MODEL_ID = DEEPSEEK_WEB_MODELS[0]?.id ?? "";

export function normalizeDeepSeekWebModelId(modelId: string | undefined, models?: ModelInfo[]): string {
  const list = models?.length ? models : DEEPSEEK_WEB_MODELS;
  const trimmed = modelId?.trim() ?? "";
  return list.some((model) => model.id === trimmed) ? trimmed : (list[0]?.id ?? "");
}

export function createDeepSeekWebProviderSettings(selectedModel?: string, dynamicModels?: ModelInfo[]): ProviderSettings[ProviderId] {
  const models = dynamicModels?.length ? dynamicModels : DEEPSEEK_WEB_MODELS;
  return {
    name: DEEPSEEK_WEB_PROVIDER_LABEL,
    apiKey: "",
    baseUrl: "",
    selectedModel: normalizeDeepSeekWebModelId(selectedModel, models),
    models: models.map((model) => ({ ...model, enabled: true }))
  };
}
