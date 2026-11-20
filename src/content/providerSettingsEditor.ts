import { createDeepSeekWebProviderSettings, DEEPSEEK_WEB_PROVIDER_ID, DEEPSEEK_WEB_PROVIDER_LABEL } from "../shared/deepseekWeb";
import type { ModelInfo, ProviderId, ProviderSettings, Settings } from "../shared/types";

export function providerLabel(providerId: ProviderId, providers?: ProviderSettings): string {
  const customName = providers?.[providerId]?.name;
  if (customName) return customName;
  if (providerId === DEEPSEEK_WEB_PROVIDER_ID) return DEEPSEEK_WEB_PROVIDER_LABEL;
  return providerId;
}

export function createDeepSeekWebProviderConfig(selectedModel: string, dynamicModels?: ModelInfo[]): ProviderSettings[ProviderId] {
  return createDeepSeekWebProviderSettings(selectedModel, dynamicModels);
}

export function sanitizePanelProviders(providers: ProviderSettings): ProviderSettings {
  const next: ProviderSettings = {};
  for (const [providerId, config] of Object.entries(providers)) {
    if (isLegacyBuiltInProvider(providerId)) continue;
    if (providerId === DEEPSEEK_WEB_PROVIDER_ID) continue;
    next[providerId] = config;
  }
  return next;
}

export interface ProviderDraftEditHost {
  getProviders: () => ProviderSettings | undefined;
  setProviders: (next: ProviderSettings) => void;
  readPanelProviders: (fallback: ProviderSettings) => ProviderSettings;
  savePanelSettings: (options?: { feedback?: boolean; render?: boolean }) => void;
}

/**
 * 按意图改写某个 provider 的模型草稿并落盘。
 *
 * 顺序不变量：草稿先写回宿主 → 调用方 flushDraftToDom 刷进 DOM → 才 savePanelSettings。
 * savePanelSettings 会重读面板 DOM 重建 providers；DOM 未先反映草稿时，草稿会被旧值覆盖。
 *
 * 不缓存任何状态，每次从 host 现取；目标 provider 不在当前 providers 中时不改动任何状态。
 */
export class ProviderDraftEdit {
  constructor(private readonly host: ProviderDraftEditHost) {}

  commit(
    providerId: ProviderId,
    change: (draft: ProviderSettings) => ProviderSettings,
    flushDraftToDom: () => void
  ): boolean {
    const providers = this.host.getProviders();
    if (!providers?.[providerId]) return false;
    const draft = this.host.readPanelProviders(sanitizePanelProviders(providers));
    this.host.setProviders(change(draft));
    flushDraftToDom();
    this.host.savePanelSettings({ feedback: false, render: false });
    return true;
  }
}

export function addCustomProviderDraft(providers: ProviderSettings): { providerId: ProviderId; providers: ProviderSettings } {
  const providerId = nextCustomProviderId(providers);
  return {
    providerId,
    providers: {
      ...providers,
      [providerId]: {
        name: "服务商",
        apiKey: "",
        baseUrl: "",
        selectedModel: "",
        models: [{ id: "", label: "", enabled: true }]
      }
    }
  };
}

export function addProviderModelDraft(providers: ProviderSettings, providerId: ProviderId): ProviderSettings {
  const provider = providers[providerId];
  if (!provider) return providers;
  return {
    ...providers,
    [providerId]: {
      ...provider,
      models: [...provider.models, { id: "", label: "", enabled: true }]
    }
  };
}

export function deleteProviderModelDraft(providers: ProviderSettings, providerId: ProviderId, index: number): ProviderSettings {
  const provider = providers[providerId];
  if (!provider || !Number.isInteger(index)) return providers;
  return {
    ...providers,
    [providerId]: {
      ...provider,
      models: provider.models.filter((_, modelIndex) => modelIndex !== index)
    }
  };
}

export function addFetchedProviderModelDraft(
  providers: ProviderSettings,
  providerId: ProviderId,
  modelId: string,
  candidates?: { providerId: string; models: ModelInfo[] }
): ProviderSettings {
  const provider = providers[providerId];
  if (!provider) return providers;
  const candidate = candidates?.providerId === providerId
    ? candidates.models.find((model) => model.id === modelId)
    : undefined;
  const label = candidate?.label || modelId;
  const fetchedModel = {
    id: modelId,
    label,
    enabled: true,
    ...(candidate?.thinkingLevels ? { thinkingLevels: candidate.thinkingLevels } : {})
  };
  const blankIndex = provider.models.findIndex((model) => model.id.trim() === "");
  const models = blankIndex >= 0
    ? provider.models.map((model, index) => (index === blankIndex ? fetchedModel : model))
    : [...provider.models, fetchedModel];
  return {
    ...providers,
    [providerId]: {
      ...provider,
      selectedModel: provider.selectedModel || modelId,
      models
    }
  };
}

export function settingsWithValidDefaultProvider(settings: Settings, providers: ProviderSettings): Settings {
  return {
    ...settings,
    defaultProvider: providers[settings.defaultProvider] ? settings.defaultProvider : Object.keys(providers)[0] ?? ""
  };
}

export function isProviderId(value: string): value is ProviderId {
  return Boolean(value) && value !== "__add_custom_provider__";
}

export function panelVisibleModels(config: ProviderSettings[ProviderId]): ModelInfo[] {
  return config.models.filter((model) => {
    const id = model.id.trim();
    if (!id) return true;
    if (id === config.selectedModel) return true;
    return model.enabled !== false;
  });
}

export function providerModelListHeight(modelCount: number): number {
  const visibleRows = Math.min(Math.max(modelCount, 0), 5);
  if (visibleRows === 0) return 0;
  return visibleRows * 38 + (visibleRows - 1) * 8;
}

function isLegacyBuiltInProvider(providerId: string): boolean {
  return providerId === "openai" || providerId === "claude" || providerId === "gemini";
}

function nextCustomProviderId(providers: ProviderSettings): string {
  let index = Object.keys(providers).length + 1;
  while (providers[`custom_${index}`]) index += 1;
  return `custom_${index}`;
}
