import type { ProviderSettings, Settings } from "./types";

export const defaultSettings: Settings = {
  defaultProvider: "",
  themeMode: "auto",
  autoSummarize: true,
  deepseekWebStatus: "unknown",
  modelThinkingLevels: {},
  pageCacheLimit: 100,
  summaryOutputCompressionMode: "off",
  subtitleTranslationTarget: "zh-Hans"
};

export const defaultProviders: ProviderSettings = {};
