import type { CompletionRequest } from "./summarizer";
import type { WebProviderStatus } from "../shared/types";
import { DEEPSEEK_WEB_MODELS } from "../shared/deepseekWeb";
import { isRecord, readArray, readRecord } from "../shared/jsonRead";
import { readSettings, writeSettings } from "../shared/storage";
import { solveDeepSeekPow, type DeepSeekPowChallenge } from "../shared/deepseekPow";
import { randomUuid } from "../shared/uuid";
import type { ModelInfo, ProviderConfig } from "../shared/types";

const DEEPSEEK_WEB_APP_URL = "https://chat.deepseek.com/";
const DEEPSEEK_WEB_API_BASE = "https://chat.deepseek.com/api/v0";
const DEEPSEEK_WEB_COMPLETION_URL = `${DEEPSEEK_WEB_API_BASE}/chat/completion`;
const DEEPSEEK_WEB_SESSION_CREATE_URL = `${DEEPSEEK_WEB_API_BASE}/chat_session/create`;
const DEEPSEEK_WEB_POW_URL = `${DEEPSEEK_WEB_API_BASE}/chat/create_pow_challenge`;
const DEEPSEEK_WEB_MODEL_CONFIG_URL = `${DEEPSEEK_WEB_API_BASE}/client/settings`;

const DEEPSEEK_WEB_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "https://chat.deepseek.com",
  referer: "https://chat.deepseek.com/",
  "x-client-version": "2.0.2",
  "x-client-platform": "web"
};

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — token in localStorage rarely expires
const STORAGE_KEY = "deepseekWebTokenCache";

interface DeepSeekWebTokens {
  token: string;
}

interface DeepSeekWebTokenCacheEntry {
  tokens: DeepSeekWebTokens;
  sessionId: string;
  fetchedAt: number;
}

let deepseekWebTokenCache: DeepSeekWebTokenCacheEntry | undefined;

async function loadTokenCacheFromStorage(now: () => number = Date.now): Promise<DeepSeekWebTokenCacheEntry | undefined> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const entry = result[STORAGE_KEY] as DeepSeekWebTokenCacheEntry | undefined;
  if (entry?.tokens?.token && now() - entry.fetchedAt < TOKEN_TTL_MS) {
    deepseekWebTokenCache = entry;
    return entry;
  }
  return undefined;
}

async function saveTokenCacheToStorage(entry: DeepSeekWebTokenCacheEntry): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: entry });
}

async function clearTokenCacheFromStorage(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.remove(STORAGE_KEY);
}

type DeepSeekWebProbeResult =
  | { ok: true; status: Extract<WebProviderStatus, "available">; checkedAt: number; tokens: DeepSeekWebTokens; models?: ModelInfo[] }
  | { ok: false; status: Extract<WebProviderStatus, "unavailable">; checkedAt: number; error: string };

type DeepSeekWebProbeSavedResult =
  | { ok: true; status: "available"; checkedAt: number; models?: ModelInfo[] }
  | { ok: false; status: "unavailable"; checkedAt: number; error: string };

export async function listDeepSeekWebModels(): Promise<ModelInfo[]> {
  return DEEPSEEK_WEB_MODELS;
}

export async function completeDeepSeekWeb(
  config: ProviderConfig,
  request: CompletionRequest,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const model = config.selectedModel.trim();
  if (!model) throw new Error("DeepSeek 网页端还没有选择模型，请先在设置里选择");
  const thinkingEnabled = request.thinking?.thinking?.type === "enabled";
  const modelType = model === "deepseek-chat" ? "default" : model.replace(/^deepseek-/, "");

  const cached = deepseekWebTokenCache;
  let tokens: DeepSeekWebTokens;

  if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS) {
    tokens = cached.tokens;
  } else {
    // Try loading from storage (survives service worker restart)
    const stored = await loadTokenCacheFromStorage();
    if (stored) {
      tokens = stored.tokens;
    } else {
      const probe = await probeDeepSeekWeb();
    if (!probe.ok) throw new Error("DeepSeek 网页端暂时不可用，请稍后重试");
      tokens = probe.tokens;
      deepseekWebTokenCache = { tokens, sessionId: "", fetchedAt: probe.checkedAt };
      await saveTokenCacheToStorage(deepseekWebTokenCache);
    }
  }

  const prompt = `${request.system}\n\n${request.user}`;
  const searchEnabled = Boolean(request.webSearch);

  let emitted = false;
  const trackChunk = onChunk
    ? (chunk: string) => {
        emitted = true;
        onChunk(chunk);
      }
    : undefined;

  try {
    return await runDeepSeekCompletion(tokens, modelType, prompt, thinkingEnabled, searchEnabled, trackChunk);
  } catch (error) {
    // 思考片段吞掉正文时（最后一个片段仍是 THINK，正文增量被归到思考），协议层已无法区分。
    // 关闭思考重发一次可以从根上消掉歧义：没有 THINK 片段，所有增量都是正文。
    if (!thinkingEnabled || emitted || !(error instanceof DeepSeekThinkingOnlyError)) throw error;
    // 帧证据只进 console：里面可能有页面正文，不进面板报错。
    console.warn("[YouMind] deepseek-web: 只收到思考内容，关闭思考重试一次", { frames: error.frames });
    return runDeepSeekCompletion(tokens, modelType, prompt, false, searchEnabled, onChunk);
  }
}

async function runDeepSeekCompletion(
  tokens: DeepSeekWebTokens,
  modelType: string,
  prompt: string,
  thinkingEnabled: boolean,
  searchEnabled: boolean,
  onChunk?: (chunk: string) => void
): Promise<string> {
  // Always create a fresh session per completion — DeepSeek enforces parallel_chat_limit
  // on same session, so concurrent chunk summarization requests must use separate sessions.
  const sessionId = await createDeepSeekWebSession(tokens.token);

  const powResponse = await fetchDeepSeekPow(tokens, sessionId);
  if (!powResponse) {
    throw new Error("DeepSeek 登录校验失败，请刷新 DeepSeek 页面后重试");
  }

  const body = {
    chat_session_id: sessionId,
    parent_message_id: null,
    prompt,
    ref_file_ids: [] as string[],
    thinking_enabled: thinkingEnabled,
    model_type: modelType,
    search_enabled: searchEnabled
  };

  const headers: Record<string, string> = {
    ...DEEPSEEK_WEB_HEADERS,
    authorization: `Bearer ${tokens.token}`,
    referer: `https://chat.deepseek.com/a/chat/s/${sessionId}`
  };
  headers["x-ds-pow-response"] = powResponse;

  const response = await fetch(DEEPSEEK_WEB_COMPLETION_URL, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body)
  });

  if (response.status === 401) {
    deepseekWebTokenCache = undefined;
    await clearTokenCacheFromStorage();
    throw new Error("DeepSeek 登录已过期，请重新登录后再试");
  }

  if (!response.ok) {
    throw new Error(`DeepSeek 拒绝了这次请求（${response.status}）`);
  }

  return readDeepSeekWebResponse(response, onChunk);
}

export async function probeDeepSeekWeb(
  now: () => number = Date.now
): Promise<DeepSeekWebProbeResult> {
  const checkedAt = now();
  try {
    // Check storage cache first — avoids opening a tab if token was already persisted
    const stored = await loadTokenCacheFromStorage(now);
    if (stored?.tokens?.token) {
      const models = await fetchDeepSeekModels({ token: stored.tokens.token }).catch(() => undefined);
      return { ok: true, status: "available", checkedAt, tokens: stored.tokens, models };
    }

    // DeepSeek is a SPA — userToken lives in localStorage, not in HTML.
    // Must read it via chrome.scripting.executeScript on a deepseek.com tab.
    const token = await readDeepSeekTokenFromTab();

  if (!token) throw new Error("DeepSeek 登录状态无效，请重新登录");

    const models = await fetchDeepSeekModels({ token }).catch(() => undefined);
    const tokens: DeepSeekWebTokens = { token };
    const entry: DeepSeekWebTokenCacheEntry = { tokens, sessionId: "", fetchedAt: checkedAt };
    await saveTokenCacheToStorage(entry);
    return { ok: true, status: "available", checkedAt, tokens, models };
  } catch (error) {
    return {
      ok: false,
      status: "unavailable",
      checkedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function probeAndSaveDeepSeekWeb(
  now: () => number = Date.now
): Promise<DeepSeekWebProbeSavedResult> {
  const result = await probeDeepSeekWeb(now);
  const settings = await readSettings();
  const dynamicModels = result.ok ? result.models : undefined;
  await writeSettings({
    ...settings,
    deepseekWebStatus: result.status,
    deepseekWebLastCheckedAt: result.checkedAt,
    ...(dynamicModels?.length ? { deepseekWebModels: dynamicModels } : {})
  });

  if (result.ok) {
    const sessionId = await createDeepSeekWebSession(result.tokens.token).catch(() => "");
    deepseekWebTokenCache = { tokens: result.tokens, sessionId, fetchedAt: result.checkedAt };
    await saveTokenCacheToStorage(deepseekWebTokenCache);
    return { ok: true, status: result.status, checkedAt: result.checkedAt, models: result.models };
  }
  return result;
}

export async function clearDeepSeekWebTokenCacheForTests(): Promise<void> {
  deepseekWebTokenCache = undefined;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.remove("deepseekWebTokenCache");
  }
}

export function clearDeepSeekWebTokenMemoryCacheForTests(): void {
  deepseekWebTokenCache = undefined;
}

async function readDeepSeekTokenFromTab(): Promise<string | undefined> {
  if (typeof chrome === "undefined" || !chrome.scripting) return undefined;

  // Find an existing chat.deepseek.com tab
  const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
  let tabId = tabs[0]?.id;

  if (!tabId) {
    // Open a background tab, wait for it to load, then read
    const tab = await chrome.tabs.create({ url: DEEPSEEK_WEB_APP_URL, active: false });
    tabId = tab.id;
    if (!tabId) return undefined;
    await waitForTabComplete(tabId);
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const raw = localStorage.getItem("userToken");
          if (!raw) return null;
          const obj = JSON.parse(raw);
          return obj?.value ?? null;
        } catch {
          return null;
        }
      }
    });
    const token = results?.[0]?.result;
    return typeof token === "string" && token ? token : undefined;
  } finally {
    // Close background tab if we created it (not if it was pre-existing)
    if (!tabs[0]?.id && tabId) {
      chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10_000);
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function createDeepSeekWebSession(token: string): Promise<string> {
  const response = await fetch(DEEPSEEK_WEB_SESSION_CREATE_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      ...DEEPSEEK_WEB_HEADERS,
      authorization: `Bearer ${token}`
    },
    body: "{}"
  });

  if (!response.ok) {
    throw new Error(`DeepSeek 没有建立会话（${response.status}），请重试`);
  }

  const json = await response.json() as unknown;
  const data = readRecord(readRecord(json)?.data);
  const bizData = readRecord(data?.biz_data);
  const chatSession = readRecord(bizData?.chat_session);
  const sessionId = chatSession?.id;
  if (typeof sessionId === "string" && sessionId) return sessionId;
  const bizId = bizData?.id;
  if (typeof bizId === "string" && bizId) return bizId;
    throw new Error("DeepSeek 没有返回会话，请重试");
}

async function fetchDeepSeekPow(tokens: DeepSeekWebTokens, sessionId: string): Promise<string | undefined> {
  const response = await fetch(DEEPSEEK_WEB_POW_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      ...DEEPSEEK_WEB_HEADERS,
      authorization: `Bearer ${tokens.token}`,
      referer: `https://chat.deepseek.com/a/chat/s/${sessionId}`
    },
    body: JSON.stringify({ target_path: "/api/v0/chat/completion" })
  });

  if (!response.ok) {
    console.error("[YouMind] deepseek-web: PoW challenge request failed:", response.status);
    return undefined;
  }

  const json = await response.json() as unknown;
  const data = readRecord(readRecord(json)?.data);
  const bizData = readRecord(data?.biz_data);
  const challenge = readRecord(bizData?.challenge);
  if (!challenge) {
    console.error("[YouMind] deepseek-web: no challenge in response:", JSON.stringify(json).slice(0, 500));
    return undefined;
  }

  const powChallenge: DeepSeekPowChallenge = {
    algorithm: String(challenge.algorithm ?? ""),
    challenge: String(challenge.challenge ?? ""),
    salt: String(challenge.salt ?? ""),
    difficulty: Number(challenge.difficulty ?? 1),
    expire_at: Number(challenge.expire_at ?? 0),
    signature: String(challenge.signature ?? ""),
    target_path: String(challenge.target_path ?? "/api/v0/chat/completion")
  };

  const result = await solveDeepSeekPow(powChallenge);
  return result;
}

async function fetchDeepSeekModels(tokens: DeepSeekWebTokens): Promise<ModelInfo[] | undefined> {
  const params = new URLSearchParams({ did: randomUuid(), scope: "model" });
  const response = await fetch(`${DEEPSEEK_WEB_MODEL_CONFIG_URL}?${params}`, {
    method: "GET",
    credentials: "include",
    headers: {
      ...DEEPSEEK_WEB_HEADERS,
      authorization: `Bearer ${tokens.token}`
    }
  });

  if (!response.ok) return undefined;

  const json = await response.json() as unknown;
  const data = readRecord(readRecord(json)?.data);
  const bizData = readRecord(data?.biz_data);
  const settings = readRecord(bizData?.settings);
  const modelConfigsRaw = readRecord(settings?.model_configs);
  const modelConfigs = readArray(modelConfigsRaw?.value);

  const models: ModelInfo[] = [];
  for (const mcRaw of modelConfigs) {
    const mc = readRecord(mcRaw);
    const modelType = typeof mc?.model_type === "string" ? mc.model_type : "";
    const enabled = mc?.enabled !== false;
    if (!modelType || !enabled) continue;
    if (modelType === "vision") continue;

    const baseName = modelType === "default" ? "DeepSeek" : `DeepSeek ${modelType}`;
    const baseId = modelType === "default" ? "deepseek-chat" : `deepseek-${modelType}`;
    models.push({ id: baseId, label: baseName });
  }

  return models.length ? models : undefined;
}

interface DeepSeekFragment {
  id?: number;
  type: string;
  content: string;
}

interface DeepSeekStreamState {
  /** 服务端下发的片段序列：THINK 与 RESPONSE 混排，正文只取非 THINK 片段。 */
  fragments: DeepSeekFragment[];
  /** 不挂在任何片段上的正文补丁（旧版 response/content 流）。 */
  extraText: string;
  /** 不挂在任何片段上的推理补丁（旧版 response/thinking_content 流）。 */
  extraThink: string;
  /** 最近若干原始帧（截断）：协议再变时不必重新挂探针。 */
  recentFrames: string[];
}

const RECENT_FRAME_LIMIT = 8;
const RECENT_FRAME_MAX_CHARS = 200;

function createDeepSeekStreamState(): DeepSeekStreamState {
  return { fragments: [], extraText: "", extraThink: "", recentFrames: [] };
}

function rememberDeepSeekFrame(state: DeepSeekStreamState, raw: string): void {
  const compact = raw.replace(/\s+/g, " ").trim().slice(0, RECENT_FRAME_MAX_CHARS);
  if (!compact) return;
  state.recentFrames.push(compact);
  if (state.recentFrames.length > RECENT_FRAME_LIMIT) state.recentFrames.shift();
}

function lastPathSegment(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}

function isThinkType(type: string | null | undefined): boolean {
  return String(type ?? "").toUpperCase() === "THINK";
}

function fragmentContentText(fragment: Record<string, unknown> | undefined): string {
  if (!fragment) return "";
  if (typeof fragment.content === "string") return fragment.content;
  if (typeof fragment.text === "string") return fragment.text;
  return "";
}

function toDeepSeekFragment(raw: unknown): DeepSeekFragment {
  const record = readRecord(raw);
  const id = typeof record?.id === "number" ? record.id : undefined;
  return {
    ...(id !== undefined ? { id } : {}),
    type: typeof record?.type === "string" ? record.type : "RESPONSE",
    content: fragmentContentText(record)
  };
}

/**
 * 片段数组帧消费。两种形态（2026-11 实抓）：
 * - APPEND：v 是新增片段（可能带该片段当前的累计 content），按 id 合并；
 * - SET / 无 o：v 是片段全量快照，以它为准替换整个片段序列。
 * 正文/推理不增量累计，而是每次从片段序列派生，因此重复快照不会重复计入。
 */
function mergeDeepSeekFragments(state: DeepSeekStreamState, fragments: unknown[], append: boolean): void {
  const incoming = fragments.map(toDeepSeekFragment);

  if (!append) {
    // 快照是权威版本：旧的散装增量若保留会与快照正文重复计入。
    state.fragments = incoming;
    state.extraText = "";
    state.extraThink = "";
    return;
  }

  for (const fragment of incoming) {
    const existingIndex = fragment.id === undefined
      ? -1
      : state.fragments.findIndex((current) => current.id === fragment.id);
    if (existingIndex < 0) {
      state.fragments.push({ ...fragment });
      continue;
    }
    const existing = state.fragments[existingIndex];
    if (!existing) continue;
    existing.type = fragment.type;
    if (fragment.content) existing.content = fragment.content;
  }
}

function deepSeekFragmentText(state: DeepSeekStreamState, think: boolean): string {
  return state.fragments
    .filter((fragment) => isThinkType(fragment.type) === think)
    .map((fragment) => fragment.content)
    .join("");
}

function deepSeekResponseText(state: DeepSeekStreamState): string {
  return deepSeekFragmentText(state, false) + state.extraText;
}

function deepSeekThinkingText(state: DeepSeekStreamState): string {
  return deepSeekFragmentText(state, true) + state.extraThink;
}

// 空正文会一路变成「模型返回内容为空」，看不出是流里只有思考。
// 在 SSE 边界就把两种情况分开报，避免再靠猜。
/** 只有思考、没有正文：可识别，供上层关思考重发一次。 */
class DeepSeekThinkingOnlyError extends Error {
  readonly frames: string[];

  constructor(message: string, frames: string[]) {
    super(message);
    this.name = "DeepSeekThinkingOnlyError";
    this.frames = frames;
  }
}

function requireDeepSeekResponseText(state: DeepSeekStreamState): string {
  const text = deepSeekResponseText(state);
  if (text.trim()) return text;
  if (deepSeekThinkingText(state).trim()) {
    throw new DeepSeekThinkingOnlyError("DeepSeek 这次只返回了思考内容，没有正文，请重试", state.recentFrames);
  }
  throw new Error(`DeepSeek 这次没有返回任何内容，请重试（最近帧：${state.recentFrames.join(" | ") || "无"}`);
}

function appendToDeepSeekFragment(state: DeepSeekStreamState, text: string): void {
  const last = state.fragments[state.fragments.length - 1];
  if (last) last.content += text;
  else state.extraText += text;
}

function isDeepSeekResponseTextPath(path: string): boolean {
  if (path !== "response" && !path.startsWith("response/")) return false;
  const segment = lastPathSegment(path);
  return segment === "content" || segment === "text" || segment === "markdown" || segment === "delta";
}

function consumeDeepSeekFrame(frame: unknown, state: DeepSeekStreamState): void {
  const record = readRecord(frame);
  if (!record) return;

  // BATCH：v 是一组子补丁，逐条消费（新版用于 accumulated_token_usage / quasi_status）。
  if (record.o === "BATCH" && Array.isArray(record.v)) {
    for (const child of record.v) consumeDeepSeekFrame(child, state);
    return;
  }

  const path = typeof record.p === "string" ? record.p : "";
  const value = record.v;

  // 片段数组帧：APPEND 为新增片段，SET / 无 o 为全量快照。
  if (lastPathSegment(path) === "fragments" && Array.isArray(value)) {
    mergeDeepSeekFragments(state, value, record.o === "APPEND");
    return;
  }

  // 顶层消息快照：{"v":{"response":{"fragments":[...]}}}（无 p），等价于全量快照。
  if (!path && isRecord(value)) {
    const response = readRecord(readRecord(value)?.response);
    const fragments = readArray(response?.fragments);
    if (fragments.length > 0) mergeDeepSeekFragments(state, fragments, false);
    return;
  }

  // 推理内容补丁（新版 reasoning_content / 旧版 thinking_content）：只进 think。
  if (lastPathSegment(path) === "thinking_content" || lastPathSegment(path) === "reasoning_content") {
    if (typeof value === "string") state.extraThink += value;
    return;
  }

  if (typeof value !== "string") return;

  // 片段正文补丁：response/fragments/<index>/content，-1 表示最后一个片段。
  const fragmentPatch = /^response\/fragments\/(-?\d+)\//.exec(path);
  if (fragmentPatch?.[1] !== undefined && isDeepSeekResponseTextPath(path)) {
    const rawIndex = Number(fragmentPatch[1]);
    const index = rawIndex < 0 ? state.fragments.length - 1 : rawIndex;
    const fragment = state.fragments[index];
    if (fragment) fragment.content += value;
    else state.extraText += value;
    return;
  }

  // 旧版正文补丁：response/content、response/text 等。
  if (isDeepSeekResponseTextPath(path)) {
    state.extraText += value;
    return;
  }

  // 无 p 的增量：追加到最后一个片段；没有片段时按正文处理。
  if (!path) appendToDeepSeekFragment(state, value);
}

function parseDeepSeekFrame(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("event:") || trimmed.startsWith(":")) return undefined;

  const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
  if (!data || data === ":") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    if (trimmed.startsWith("{")) {
      console.error("[YouMind] deepseek-web: SSE skipped line:", trimmed.slice(0, 200));
    }
    return undefined;
  }

  const record = readRecord(parsed);
  if (record?.type === "error") {
    const errorVal = typeof record.v === "string" ? record.v
      : typeof record.msg === "string" ? record.msg
      : typeof record.message === "string" ? record.message
      : JSON.stringify(record).slice(0, 300);
    throw new Error(`生成中断，请重试（${errorVal}）`);
  }

  return parsed;
}

function consumeDeepSeekSseText(text: string): string {
  const state = createDeepSeekStreamState();
  for (const line of text.split(/\r?\n/)) {
    rememberDeepSeekFrame(state, line);
    const frame = parseDeepSeekFrame(line);
    if (frame !== undefined) consumeDeepSeekFrame(frame, state);
  }
  return requireDeepSeekResponseText(state);
}

async function readDeepSeekWebResponse(response: Response, onChunk?: (chunk: string) => void): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") && !contentType.includes("text/plain")) {
    const body = await response.text();
    let errorMsg = `DeepSeek 返回的数据格式无法识别（${contentType}）`;
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      if (typeof obj.code === "number" && obj.code >= 40000) {
        errorMsg = `DeepSeek 返回错误（${obj.code}）：${typeof obj.msg === "string" ? obj.msg : body.slice(0, 300)}`;
      }
    } catch {
      if (body) errorMsg += `：${body.slice(0, 300)}`;
    }
    throw new Error(errorMsg);
  }

  if (!response.body || !onChunk) {
    return consumeDeepSeekSseText(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = createDeepSeekStreamState();
  let buffer = "";
  let emitted = "";

  const flushResponseText = (): void => {
    const current = deepSeekResponseText(state);
    if (current === emitted) return;
    // 仅增量推送新增正文；快照重建为单调增长时等价于追加尾部。
    if (current.startsWith(emitted)) {
      const delta = current.slice(emitted.length);
      if (delta) onChunk(delta);
    }
    emitted = current;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        rememberDeepSeekFrame(state, line);
        const frame = parseDeepSeekFrame(line);
        if (frame === undefined) continue;
        consumeDeepSeekFrame(frame, state);
        flushResponseText();
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      rememberDeepSeekFrame(state, buffer);
      const frame = parseDeepSeekFrame(buffer);
      if (frame !== undefined) {
        consumeDeepSeekFrame(frame, state);
        flushResponseText();
      }
    }

    return requireDeepSeekResponseText(state);
  } finally {
    reader.releaseLock();
  }
}
