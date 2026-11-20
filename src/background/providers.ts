import type { CompletionProvider, CompletionRequest } from "./summarizer";
import { completeDeepSeekWeb, listDeepSeekWebModels } from "./deepseekWeb";
import { readModelThinkingLevels } from "../shared/modelThinking";
import { readArray, readRecord as readRecordOrUndefined } from "../shared/jsonRead";
import type { ModelInfo, ProviderConfig, ProviderId } from "../shared/types";
import type { BuiltInProviderId } from "./providerCapabilities";

interface ProviderAdapter extends CompletionProvider {
  id: ProviderId;
  listModels(config: ProviderConfig): Promise<ModelInfo[]>;
}

type CustomEndpointShape = "chat-completions" | "messages";
type StreamingResponse = Response & { body: ReadableStream<Uint8Array> };

const CUSTOM_PROVIDER_MAX_RETRY_AFTER_MS = 5_000;

interface CustomProviderEndpoints {
  completionUrl: string;
  modelsUrl: string;
  shape: CustomEndpointShape;
}

export const providerAdapters: Record<BuiltInProviderId, ProviderAdapter> = {
  "deepseek-web": {
    id: "deepseek-web",
    listModels: listDeepSeekWebModels,
    complete: completeDeepSeekWeb
  }
};

export function resolveProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return providerAdapters[providerId as BuiltInProviderId] ?? customProviderAdapter(providerId);
}

function customProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return {
    id: providerId,
    listModels: (config) => listCustomModels(config, customProviderLabel(providerId, config)),
    complete: (config, request, onChunk) => completeCustom(config, request, onChunk, customProviderLabel(providerId, config))
  };
}

function customProviderLabel(providerId: ProviderId, config: ProviderConfig): string {
  return config.name?.trim() || providerId || "服务商";
}

async function listCustomModels(config: ProviderConfig, label: string): Promise<ModelInfo[]> {
  assertApiKey(config, label);
  const endpoints = resolveCustomProviderEndpoints(config, label);
  const json = await requestJson(endpoints.modelsUrl, {
    headers: { Authorization: `Bearer ${config.apiKey}` }
  });

  const data = readArray(requireRecord(json).data);
  return data
    .map((item) => readRecordOrUndefined(item))
    .filter((item): item is Record<string, unknown> => Boolean(item?.id))
    .map((item) => {
      const id = String(item.id);
      const thinkingLevels = readModelThinkingLevels(item.thinkingLevels ?? item.thinking_levels);
      return {
        id,
        label: id,
        ...(thinkingLevels.length ? { thinkingLevels } : {})
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function completeCustom(
  config: ProviderConfig,
  request: CompletionRequest,
  onChunk: ((chunk: string) => void) | undefined,
  label: string
): Promise<string> {
  assertConfig(config, label);
  const endpoints = resolveCustomProviderEndpoints(config, label);
  return endpoints.shape === "messages"
    ? completeCustomMessages(endpoints.completionUrl, config, request, onChunk, label)
    : completeCustomChatCompletions(endpoints.completionUrl, config, request, onChunk, label);
}

async function completeCustomChatCompletions(
  completionUrl: string,
  config: ProviderConfig,
  request: CompletionRequest,
  onChunk: ((chunk: string) => void) | undefined,
  label: string
): Promise<string> {
  const bodyBase = {
    model: config.selectedModel,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user }
    ],
    temperature: 0.2,
    ...buildOpenAIThinkingPayload(request.thinking),
    ...(request.expectJson && !onChunk ? { response_format: { type: "json_object" } } : {})
  };

  if (!onChunk) {
    const json = await requestJson(completionUrl, {
      method: "POST",
      headers: customJsonHeaders(config),
      body: JSON.stringify(bodyBase)
    });

    const firstChoice = readRecordOrUndefined(readArray(requireRecord(json).choices)[0]);
    const message = readRecordOrUndefined(firstChoice?.message);
    return readRequiredString(message?.content, `${label} 没有返回文字内容`);
  }

  const response = await requestCustomStreamingResponse(completionUrl, {
    method: "POST",
    headers: customJsonHeaders(config),
    body: JSON.stringify({
      ...bodyBase,
      stream: true
    })
  }, label);

  return readStreamingResponse(response.body, readChatCompletionStreamContent, onChunk);
}

async function completeCustomMessages(
  completionUrl: string,
  config: ProviderConfig,
  request: CompletionRequest,
  onChunk: ((chunk: string) => void) | undefined,
  label: string
): Promise<string> {
  const maxTokens = request.expectJson ? 4096 : 2048;
  const bodyBase = {
    model: config.selectedModel,
    max_tokens: maxTokens,
    temperature: 0.2,
    system: request.system,
    messages: [{ role: "user", content: request.user }]
  };

  if (!onChunk) {
    const json = await requestJson(completionUrl, {
      method: "POST",
      headers: customJsonHeaders(config),
      body: JSON.stringify(bodyBase)
    });

    const textPart = readArray(requireRecord(json).content)
      .map((item) => readRecordOrUndefined(item))
      .find((item) => item?.type === "text" && typeof item.text === "string");

    return readRequiredString(textPart?.text, `${label} 没有返回文字内容`);
  }

  const response = await requestCustomStreamingResponse(completionUrl, {
    method: "POST",
    headers: customJsonHeaders(config),
    body: JSON.stringify({
      ...bodyBase,
      stream: true
    })
  }, label);

  return readStreamingResponse(response.body, readMessagesStreamText, onChunk);
}

async function requestCustomStreamingResponse(url: string, init: RequestInit, label: string): Promise<StreamingResponse> {
  let response = await fetch(url, init);
  const retryAfterMs = response.status === 429 ? readRetryAfterMs(response.headers.get("Retry-After")) : undefined;

  if (!response.ok && retryAfterMs !== undefined && retryAfterMs <= CUSTOM_PROVIDER_MAX_RETRY_AFTER_MS) {
    await response.body?.cancel().catch(() => undefined);
    await wait(retryAfterMs);
    response = await fetch(url, init);
  }

  if (!response.ok || !response.body) {
    throw await buildCustomProviderRequestError(response, label);
  }
  return response as StreamingResponse;
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function buildCustomProviderRequestError(response: Response, label: string): Promise<Error> {
  const status = [response.status, response.statusText].filter(Boolean).join(" ");
  const detail = await readCustomProviderErrorDetail(response);
  return new Error(`${label} 请求失败（${status}）${detail ? `：${detail}` : ""}`);
}

async function readCustomProviderErrorDetail(response: Response): Promise<string> {
  const text = (await response.text()).replace(/\s+/gu, " ").trim();
  if (!text) return "";

  try {
    const payload = readRecordOrUndefined(JSON.parse(text));
    const error = readRecordOrUndefined(payload?.error);
    const detail = readOptionalString(error?.message)
      ?? readOptionalString(error?.detail)
      ?? readOptionalString(payload?.message)
      ?? readOptionalString(payload?.detail)
      ?? readOptionalString(payload?.error_description)
      ?? readOptionalString(payload?.error);
    return detail?.slice(0, 300) ?? "服务商返回了错误";
  } catch {
    return text.slice(0, 300);
  }
}

function resolveCustomProviderEndpoints(config: ProviderConfig, label: string): CustomProviderEndpoints {
  const baseUrl = normalizeRequiredBaseUrl(config, label);
  if (/\/v1\/messages$/iu.test(baseUrl)) {
    const root = baseUrl.replace(/\/messages$/iu, "");
    return {
      completionUrl: baseUrl,
      modelsUrl: `${root}/models`,
      shape: "messages"
    };
  }
  if (/\/v1\/chat\/completions$/iu.test(baseUrl)) {
    const root = baseUrl.replace(/\/chat\/completions$/iu, "");
    return {
      completionUrl: baseUrl,
      modelsUrl: `${root}/models`,
      shape: "chat-completions"
    };
  }
  return {
    completionUrl: `${baseUrl}/chat/completions`,
    modelsUrl: `${baseUrl}/models`,
    shape: "chat-completions"
  };
}

async function readStreamingResponse(
  body: ReadableStream<Uint8Array>,
  readContent: (line: string) => string | undefined,
  onChunk: (chunk: string) => void
): Promise<string> {
  let accumulated = "";
  let buffer = "";
  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const content = readContent(line);
        if (content) {
          accumulated += content;
          onChunk(content);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const content = readContent(buffer);
      if (content) {
        accumulated += content;
        onChunk(content);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated;
}

function buildOpenAIThinkingPayload(thinking: CompletionRequest["thinking"]): Record<string, unknown> {
  if (!thinking) return {};
  return {
    ...(thinking.thinking ? { thinking: thinking.thinking } : {}),
    ...(thinking.reasoningEffort ? { reasoning_effort: thinking.reasoningEffort } : {})
  };
}

function readChatCompletionStreamContent(line: string): string | undefined {
  const data = readSseData(line);
  if (!data || data === "[DONE]") return undefined;
  try {
    const json = JSON.parse(data) as Record<string, unknown>;
    const delta = readRecordOrUndefined(readRecordOrUndefined(readArray(json.choices)[0])?.delta);
    return readStreamText(delta?.content);
  } catch {
    return undefined;
  }
}

function readMessagesStreamText(line: string): string | undefined {
  const data = readSseData(line);
  if (!data || data === "[DONE]") return undefined;
  try {
    const json = JSON.parse(data) as Record<string, unknown>;
    if (json.type !== "content_block_delta") return undefined;
    const delta = readRecordOrUndefined(json.delta);
    return readStreamText(delta?.text);
  } catch {
    return undefined;
  }
}

function readSseData(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return undefined;
  return trimmed.replace(/^data:\s*/u, "").trim();
}

function customJsonHeaders(config: ProviderConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json"
  };
}

function assertConfig(config: ProviderConfig, label: string): void {
  assertApiKey(config, label);
  if (!config.selectedModel.trim()) throw new Error(`${label} 还没有选择模型，请先在设置里选择`);
}

function assertApiKey(config: ProviderConfig, label: string): void {
  if (!config.apiKey.trim()) throw new Error(`${label} 还没有填写 API Key，请先在设置里填写`);
}

function normalizeRequiredBaseUrl(config: ProviderConfig, label: string): string {
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) throw new Error(`${label} 还没有填写服务地址，请先在设置里填写`);
  return baseUrl.replace(/\/+$/u, "");
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("服务商返回的数据无法识别");
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStreamText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRequiredString(value: unknown, error: string): string {
  const text = readOptionalString(value);
  if (!text) throw new Error(error);
  return text;
}
