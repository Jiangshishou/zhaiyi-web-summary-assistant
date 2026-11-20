import { fetchSourceBinary } from "./binaryFetch";
import { fetchBilibiliSubtitle } from "./bilibili";
import { probeAndSaveDeepSeekWeb } from "./deepseekWeb";
import { openPanelInTab } from "./openPanel";
import { resolveProviderCapabilities } from "./providerCapabilities";
import { resolveProviderAdapter } from "./providers";
import { summarizeSource } from "./summarizer";
import { translateSubtitles } from "./translator";
import { fetchYouTubeSubtitle } from "./youtube";
import { fetchYouTubePageTranscript } from "./youtubePage";
import type { RuntimeRequest, RuntimeResponseMap, TabRequest } from "../shared/messages";
import {
  clearPageCaches,
  clearPageCache,
  readPageCache,
  readPanelState,
  readProviders,
  readSettings,
  writePageCache,
  writePanelState,
  writeProviders,
  writeSettings
} from "../shared/storage";
import type { PageCache, ProviderConfig, ProviderId, Settings, SubtitleSegment, SubtitleTranslationTarget, SummaryCachePolicy } from "../shared/types";

export async function getCommandShortcuts(chromeApi: { commands: Pick<typeof chrome.commands, "getAll"> }): Promise<{ shortcuts: Record<string, string> }> {
  const commands = await chromeApi.commands.getAll();
  return {
    shortcuts: Object.fromEntries(commands.map((command) => [command.name ?? "", command.shortcut ?? ""]).filter(([name]) => name))
  };
}

export async function openPanelFromAction(chromeApi: typeof chrome, tab: chrome.tabs.Tab): Promise<void> {
  const settings = await readSettings();
  const autoSummarize = settings.autoSummarize ?? true;
  await openPanelInTab(chromeApi, tab, autoSummarize, true);
}


export async function handleRuntimeCommand(
  request: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
  chromeApi: typeof chrome = chrome
): Promise<RuntimeResponseMap[RuntimeRequest["type"]]> {
  switch (request.type) {
    case "YM_GET_SETTINGS":
      return readSettings();
    case "YM_SAVE_SETTINGS":
      await writeSettings(request.settings);
      return { ok: true };
    case "YM_PROBE_DEEPSEEK_WEB":
      return probeAndSaveDeepSeekWeb();
    case "YM_GET_PROVIDERS":
      return readProviders();
    case "YM_SAVE_PROVIDERS":
      await writeProviders(request.providers);
      return { ok: true };
    case "YM_LIST_MODELS":
      return listModels(request.providerId);
    case "YM_GET_PAGE_CACHE":
      return { cache: await readPageCache(request.url) };
    case "YM_GENERATE_SUMMARY":
      return generateSummary(request.source, await resolveMessageTabId(sender, chromeApi), chromeApi, request.requestId, request.traceId, request.cachePolicy);
    case "YM_CLEAR_PAGE_CACHE":
      await clearPageCache(request.url);
      return { ok: true };
    case "YM_CLEAR_PAGE_CACHES":
      await clearPageCaches();
      return { ok: true };
    case "YM_GET_COMMAND_SHORTCUTS":
      return getCommandShortcuts(chromeApi);
    case "YM_GET_PANEL_STATE":
      return { state: await readPanelState(request.domain) };
    case "YM_SAVE_PANEL_STATE":
      await writePanelState(request.domain, request.state);
      return { ok: true };
    case "YM_FETCH_SOURCE_BINARY":
      return fetchSourceBinary(request.url);
    case "YM_OPEN_EXTENSION_SHORTCUTS":
      await chromeApi.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { ok: true };
    case "YM_FETCH_BILIBILI_SUBTITLE":
      return fetchBilibiliSubtitle(request.hints);
    case "YM_FETCH_YOUTUBE_PAGE_TRANSCRIPT":
      return (await fetchYouTubePageTranscript(chromeApi, await resolveMessageTabId(sender, chromeApi))) ?? {};
    case "YM_FETCH_YOUTUBE_SUBTITLE":
      return (await fetchYouTubeSubtitle(request.pageUrl)) ?? {};
    case "YM_TRANSLATE_SUBTITLES":
      return translateSubtitleRequest(request.sourceTitle, request.segments, request.targetLanguage);
  }
}

async function resolveMessageTabId(sender: chrome.runtime.MessageSender, chromeApi: typeof chrome): Promise<number | undefined> {
  if (sender.tab?.id !== undefined) return sender.tab.id;
  if (typeof chromeApi.tabs.query !== "function") return undefined;
  try {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id;
  } catch {
    return undefined;
  }
}

interface ActiveProvider {
  settings: Settings;
  providerId: ProviderId;
  adapter: ReturnType<typeof resolveProviderAdapter>;
  config: ProviderConfig;
}

async function resolveActiveProvider(providerId?: ProviderId): Promise<ActiveProvider> {
  const settings = await readSettings();
  const providers = await readProviders();
  const resolvedId = providerId ?? settings.defaultProvider;
  const adapter = resolveProviderAdapter(resolvedId);
  const config = providers[resolvedId];
  if (!config) throw new Error("还没有选择服务商，请先在设置里添加");
  return { settings, providerId: resolvedId, adapter, config };
}

async function listModels(providerId: ProviderId): Promise<{ models: RuntimeResponseMap["YM_LIST_MODELS"]["models"] }> {
  const { adapter, config } = await resolveActiveProvider(providerId);
  const models = await adapter.listModels(config);
  return { models };
}

async function generateSummary(
  source: PageCache["source"],
  tabId: number | undefined,
  chromeApi: typeof chrome,
  requestId?: string,
  traceId?: string,
  cachePolicy: SummaryCachePolicy = "write"
): Promise<RuntimeResponseMap["YM_GENERATE_SUMMARY"]> {
  const { settings, providerId, adapter, config } = await resolveActiveProvider();
  const capabilities = resolveProviderCapabilities(providerId, config, settings);

  const onChunk = capabilities.streaming && tabId !== undefined && requestId
    ? (chunk: string) => {
        chromeApi.tabs.sendMessage(tabId, { type: "YM_STREAM_CHUNK", streamKind: "summary", requestId, chunk } satisfies TabRequest)
          .catch(() => { /* Ignore if tab closed */ });
      }
    : undefined;

  const { summary, meta } = await summarizeSource(providerId, adapter, config, source, {
    thinking: capabilities.thinking,
    outputCompressionMode: settings.summaryOutputCompressionMode ?? "off",
    traceId
  }, onChunk);

  const cache: PageCache = {
    source,
    summary,
    summaryMeta: meta
  };
  if (cachePolicy !== "skip") await writePageCache(source.url, cache);

  return { summary, meta, cache };
}

async function translateSubtitleRequest(
  sourceTitle: string,
  segments: SubtitleSegment[],
  targetLanguage: SubtitleTranslationTarget
): Promise<RuntimeResponseMap["YM_TRANSLATE_SUBTITLES"]> {
  const { adapter, config } = await resolveActiveProvider();

  return translateSubtitles(adapter, config, sourceTitle, segments, targetLanguage);
}
