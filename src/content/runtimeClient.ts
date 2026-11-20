import { sendRuntimeMessage } from "./sendMessage";
import type { RuntimeRequest } from "../shared/messages";
import type {
  PanelState,
  ProviderId,
  ProviderSettings,
  Settings,
  SummaryCachePolicy,
  SourcePayload,
  SubtitleSegment,
  SubtitleTranslationTarget
} from "../shared/types";


export function getSettings() {
  return sendRuntimeMessage({ type: "YM_GET_SETTINGS" });
}

export function saveSettings(settings: Settings) {
  return sendRuntimeMessage({ type: "YM_SAVE_SETTINGS", settings });
}

export function probeDeepSeekWeb() {
  return sendRuntimeMessage({ type: "YM_PROBE_DEEPSEEK_WEB" });
}

export function getProviders() {
  return sendRuntimeMessage({ type: "YM_GET_PROVIDERS" });
}

export function saveProviders(providers: ProviderSettings) {
  return sendRuntimeMessage({ type: "YM_SAVE_PROVIDERS", providers });
}

export function listProviderModels(providerId: ProviderId) {
  return sendRuntimeMessage({ type: "YM_LIST_MODELS", providerId });
}

export function getPageCache(url: string) {
  return sendRuntimeMessage({ type: "YM_GET_PAGE_CACHE", url });
}

export function clearPageCache(url: string) {
  return sendRuntimeMessage({ type: "YM_CLEAR_PAGE_CACHE", url });
}

export function generateSummary(source: SourcePayload, requestId?: string, traceId?: string, cachePolicy?: SummaryCachePolicy) {
  const request: Extract<RuntimeRequest, { type: "YM_GENERATE_SUMMARY" }> = {
    type: "YM_GENERATE_SUMMARY",
    source,
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(cachePolicy ? { cachePolicy } : {})
  };
  return sendRuntimeMessage(request);
}

export function clearPageCaches() {
  return sendRuntimeMessage({ type: "YM_CLEAR_PAGE_CACHES" });
}

export function getCommandShortcuts() {
  return sendRuntimeMessage({ type: "YM_GET_COMMAND_SHORTCUTS" });
}

export function getPanelState(domain: string) {
  return sendRuntimeMessage({ type: "YM_GET_PANEL_STATE", domain });
}

export function savePanelState(domain: string, state: PanelState) {
  return sendRuntimeMessage({ type: "YM_SAVE_PANEL_STATE", domain, state });
}

export function fetchSourceBinary(url: string) {
  return sendRuntimeMessage({ type: "YM_FETCH_SOURCE_BINARY", url });
}

export function openExtensionShortcuts() {
  return sendRuntimeMessage({ type: "YM_OPEN_EXTENSION_SHORTCUTS" });
}

export function translateSubtitles(
  sourceTitle: string,
  segments: SubtitleSegment[],
  targetLanguage: SubtitleTranslationTarget
) {
  return sendRuntimeMessage({ type: "YM_TRANSLATE_SUBTITLES", sourceTitle, segments, targetLanguage });
}
