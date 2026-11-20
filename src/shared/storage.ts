import { defaultProviders, defaultSettings } from "./defaults";
import { createDeepSeekWebProviderSettings, DEEPSEEK_WEB_PROVIDER_ID } from "./deepseekWeb";
import { readModelThinkingLevels } from "./modelThinking";
import type { ModelInfo, OutputCompressionMode, PageCache, PanelState, ProviderSettings, Settings, SubtitleTranslationTarget } from "./types";

const SETTINGS_KEY = "ym:settings";
const PROVIDERS_KEY = "ym:providers";
const PAGE_CACHE_PREFIX = "ym:pageCache:";
const LEGACY_BUILT_IN_PROVIDERS = new Set(["openai", "claude", "gemini", "gemini-web", "qwen-web", "ima-web"]);
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "spm",
  "from",
  "share_source",
  "shareid",
  "si"
]);
type LegacySettings = Partial<Settings> & {
  chatIncludePageContentDefault?: unknown;
  maxDirectChars?: unknown;
  chunkTargetChars?: unknown;
  summaryTuningVersion?: unknown;
  showSourceStatus?: unknown;
  outputCompressionMode?: OutputCompressionMode;
  imaWebStatus?: unknown;
  imaWebLastCheckedAt?: unknown;
  imaWebModels?: unknown;
  geminiWebStatus?: unknown;
  geminiWebLastCheckedAt?: unknown;
  geminiWebThinkingLevel?: unknown;
  geminiWebModels?: unknown;
  geminiWebModelModes?: unknown;
};

export async function readSettings(): Promise<Settings> {
  const stored = await readLocal<LegacySettings>(SETTINGS_KEY);
  const settings = { ...defaultSettings, ...stored };
  let shouldPersist = false;
  if (settings.defaultProvider === "gemini-web") {
    settings.defaultProvider = "deepseek-web";
    shouldPersist = true;
  }
  if (LEGACY_BUILT_IN_PROVIDERS.has(settings.defaultProvider)) {
    settings.defaultProvider = "";
    shouldPersist = true;
  }
  const normalizedPageCacheLimit = normalizePageCacheLimit(settings.pageCacheLimit);
  if (settings.pageCacheLimit !== normalizedPageCacheLimit) {
    settings.pageCacheLimit = normalizedPageCacheLimit;
    shouldPersist = true;
  }
  const legacyOutputCompressionMode = normalizeOutputCompressionMode(stored?.outputCompressionMode);
  if (stored?.outputCompressionMode && !hasOwn(stored, "summaryOutputCompressionMode")) {
    settings.summaryOutputCompressionMode = legacyOutputCompressionMode;
    shouldPersist = true;
  }
  const normalizedSummaryOutputCompressionMode = normalizeOutputCompressionMode(settings.summaryOutputCompressionMode);
  if (settings.summaryOutputCompressionMode !== normalizedSummaryOutputCompressionMode) {
    settings.summaryOutputCompressionMode = normalizedSummaryOutputCompressionMode;
    shouldPersist = true;
  }
  const normalizedSubtitleTranslationTarget = normalizeSubtitleTranslationTarget(settings.subtitleTranslationTarget);
  if (settings.subtitleTranslationTarget !== normalizedSubtitleTranslationTarget) {
    settings.subtitleTranslationTarget = normalizedSubtitleTranslationTarget;
    shouldPersist = true;
  }
  if ("shortcut" in settings) {
    delete settings.shortcut;
    shouldPersist = true;
  }
  for (const legacyKey of ["chatIncludePageContentDefault", "maxDirectChars", "chunkTargetChars", "summaryTuningVersion", "showSourceStatus", "outputCompressionMode", "imaWebStatus", "imaWebLastCheckedAt", "imaWebModels", "geminiWebStatus", "geminiWebLastCheckedAt", "geminiWebThinkingLevel", "geminiWebModels", "geminiWebModelModes"] as const) {
    if (legacyKey in settings) {
      delete settings[legacyKey];
      shouldPersist = true;
    }
  }
  if (shouldPersist) await writeLocal(SETTINGS_KEY, settings);
  return settings;
}

export async function writeSettings(settings: Settings): Promise<void> {
  await writeLocal(SETTINGS_KEY, settings);
}

export async function readProviders(): Promise<ProviderSettings> {
  const stored = await readLocal<Partial<ProviderSettings>>(PROVIDERS_KEY);
  const settings = await readSettings();
  const { providers, shouldPersist } = sanitizeProviders(stored, settings.deepseekWebModels);
  if (shouldPersist) await writeLocal(PROVIDERS_KEY, providers);
  return providers;
}

export async function writeProviders(providers: ProviderSettings): Promise<void> {
  const settings = await readSettings();
  await writeLocal(PROVIDERS_KEY, sanitizeProviders(providers, settings.deepseekWebModels).providers);
}

function sanitizeProviders(stored: Partial<ProviderSettings> | undefined, deepseekWebModels?: ModelInfo[]): { providers: ProviderSettings; shouldPersist: boolean } {
  const next: ProviderSettings = { ...defaultProviders };
  let shouldPersist = false;
  for (const [id, config] of Object.entries(stored ?? {})) {
    if (LEGACY_BUILT_IN_PROVIDERS.has(id)) {
      shouldPersist = true;
      continue;
    }
    if (!config) continue;
    if (id === DEEPSEEK_WEB_PROVIDER_ID) {
      const normalized = createDeepSeekWebProviderSettings(config.selectedModel, deepseekWebModels);
      next[id] = normalized;
      if (JSON.stringify(config) !== JSON.stringify(normalized)) shouldPersist = true;
      continue;
    }
    next[id] = {
      name: config.name?.trim() || id,
      apiKey: config.apiKey ?? "",
      baseUrl: config.baseUrl ?? "",
      selectedModel: config.selectedModel ?? "",
      models: (config.models ?? []).map((model) => {
        const thinkingLevels = readModelThinkingLevels(model.thinkingLevels);
        return {
          id: model.id,
          label: model.label || model.id,
          enabled: Boolean(model.enabled),
          ...(thinkingLevels.length ? { thinkingLevels } : {})
        };
      })
    };
  }
  // Ensure all built-in providers exist
  if (!next[DEEPSEEK_WEB_PROVIDER_ID]) {
    next[DEEPSEEK_WEB_PROVIDER_ID] = createDeepSeekWebProviderSettings(undefined, deepseekWebModels);
    shouldPersist = true;
  }
  return { providers: next, shouldPersist };
}

function normalizePageCacheLimit(value: number | undefined): number {
  return normalizeInteger(value, defaultSettings.pageCacheLimit ?? 100, 1, 500);
}

function normalizeInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function normalizeOutputCompressionMode(value: OutputCompressionMode | undefined): OutputCompressionMode {
  return value === "lite" || value === "full" || value === "ultra" ? value : "off";
}

function normalizeSubtitleTranslationTarget(value: SubtitleTranslationTarget | undefined): SubtitleTranslationTarget {
  return value === "en" ? "en" : "zh-Hans";
}

function hasOwn<T extends object>(value: T | undefined, key: PropertyKey): value is T {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

export async function readPageCache(url: string): Promise<PageCache | undefined> {
  const key = pageCacheKey(url);
  const cache = await readLocal<PageCache>(key);
  if (!cache) return undefined;
  const now = Date.now();
  const next = { ...cache, cacheKey: normalizeCacheUrl(url), lastAccessedAt: now };
  await withStorageLock(key, () => writeLocal(key, next));
  return next;
}

export async function writePageCache(url: string, cache: PageCache): Promise<void> {
  const settings = await readSettings();
  const normalizedUrl = normalizeCacheUrl(url);
  await writeLocal(pageCacheKey(normalizedUrl), {
    ...cache,
    cacheKey: normalizedUrl,
    lastAccessedAt: Date.now()
  });
  await prunePageCaches(settings.pageCacheLimit ?? defaultSettings.pageCacheLimit ?? 100);
}

export async function clearPageCache(url: string): Promise<void> {
  await chrome.storage.local.remove(pageCacheKey(url));
}

export async function clearPageCaches(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith(PAGE_CACHE_PREFIX));
  if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);
}

export async function readPanelState(domain: string): Promise<PanelState | undefined> {
  return readLocal<PanelState>(panelStateKey(domain));
}

export async function writePanelState(domain: string, state: PanelState): Promise<void> {
  await writeLocal(panelStateKey(domain), state);
}

export function normalizeCacheUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = buildNormalizedSearch(url);
    return url.toString();
  } catch {
    return value.split("#", 1)[0] ?? value;
  }
}

function buildNormalizedSearch(url: URL): string {
  const params = Array.from(url.searchParams.entries()).filter(([key]) => !isTrackingQueryKey(key));
  const host = url.hostname.toLowerCase();
  const kept = isYouTubeHost(host)
    ? params.filter(([key]) => ["v", "list", "t"].includes(key))
    : isBilibiliHost(host)
      ? params.filter(([key]) => ["p", "aid", "bvid", "cid"].includes(key))
      : isDouyinHost(host)
        ? params.filter(([key]) => key === "modal_id")
        : params;
  const sorted = kept.sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  return sorted.length ? `?${new URLSearchParams(sorted).toString()}` : "";
}

function isTrackingQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalized);
}

function isYouTubeHost(host: string): boolean {
  return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") || host.endsWith(".youtube-nocookie.com");
}

function isBilibiliHost(host: string): boolean {
  return host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv";
}

function isDouyinHost(host: string): boolean {
  return host === "douyin.com" || host.endsWith(".douyin.com") || host === "v.douyin.com";
}

async function prunePageCaches(limit: number): Promise<void> {
  const safeLimit = normalizePageCacheLimit(limit);
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([key]) => key.startsWith(PAGE_CACHE_PREFIX))
    .map(([key, value]) => ({ key, recency: pageCacheRecency(value) }))
    .sort((a, b) => a.recency - b.recency);
  const extra = entries.length - safeLimit;
  if (extra <= 0) return;
  await chrome.storage.local.remove(entries.slice(0, extra).map((entry) => entry.key));
}

function pageCacheRecency(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const cache = value as Partial<PageCache>;
  return firstFiniteNumber(cache.lastAccessedAt, cache.summaryMeta?.generatedAt, cache.source?.capturedAt);
}

function firstFiniteNumber(...values: Array<number | undefined>): number {
  return values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? 0;
}

function pageCacheKey(url: string): string {
  return `${PAGE_CACHE_PREFIX}${hashString(normalizeCacheUrl(url))}`;
}

function panelStateKey(domain: string): string {
  return `ym:panelState:${domain}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

async function readLocal<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function writeLocal<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ponytail: navigator.locks may be absent in tests/older Chrome; fall back to direct write
async function withStorageLock(key: string, fn: () => Promise<void>): Promise<void> {
  const locks = (globalThis as { navigator?: { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } } }).navigator?.locks;
  if (locks) await locks.request(key, fn);
  else await fn();
}
