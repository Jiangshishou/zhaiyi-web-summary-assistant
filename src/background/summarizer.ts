import type {
  ProviderConfig,
  ProviderId,
  OutputCompressionMode,
  SourcePayload,
  SummaryMeta,
  SummaryTimingMeta,
  SummaryResult
} from "../shared/types";
import { parseSummaryOutput, isTruncatedStreamOutput, recoverLenientStreamSummary } from "./modelSummary";
import { buildSummaryLengthBudgetGuidance, buildSummaryRequestPlan } from "./summaryRequestPlanner";
import { hasSummaryTree } from "../shared/summaryQuality";
import { resolveProviderTraits } from "./providerCapabilities";

export { parseSummaryJson, parseSummaryOutput } from "./modelSummary";

export interface CompletionRequest {
  system: string;
  user: string;
  expectJson: boolean;
  thinking?: CompletionThinking;
  webSearch?: boolean;
}

export interface CompletionThinking {
  thinking?: { type: "enabled" | "disabled" };
  reasoningEffort?: "high" | "max";
}

export interface CompletionProvider {
  complete(config: ProviderConfig, request: CompletionRequest, onChunk?: (chunk: string) => void): Promise<string>;
}

interface SummaryDiagnosticStage {
  ok: boolean;
  durationMs?: number;
  firstChunkMs?: number;
  count?: number;
  concurrency?: number;
}

interface SummaryDiagnostic {
  traceId?: string;
  ok: boolean;
  mode: SummaryMode;
  sourceKind: SourcePayload["sourceKind"];
  providerId: ProviderId;
  model: string;
  textLength: number;
  totalMs: number;
  stages: {
    provider: SummaryDiagnosticStage;
    chunks?: SummaryDiagnosticStage;
    synthesis?: SummaryDiagnosticStage;
    parse?: SummaryDiagnosticStage;
  };
  error?: string;
}

type SummaryMode = "direct" | "chunk";
type ChunkFailureStage = "splitting" | "chunk summarization" | "synthesis";

// 网页端 provider context 约 30k tokens，14k 字符直接总结仍有余量；旧 9k 阈值给典型长文制造了不必要的分块。
const DIRECT_SUMMARY_MAX_CHARS = 14000;
// chunk target 跟随 direct 阈值上移，减少超长内容的分块数量和 LLM 调用次数。
const CHUNK_TARGET_CHARS = 12000;
const SUMMARY_CHUNK_CONCURRENCY = 3;
// 直连摘要的整轮重发上限：首次失败后再试一次（等价用户点「重试」）。
const DIRECT_SUMMARY_ATTEMPTS = 2;

interface SummaryExecutionTiming {
  mode: SummaryMode;
  chunkCount?: number;
  chunkConcurrency?: number;
  chunkDurationMs?: number;
  synthesisDurationMs?: number;
}

export async function summarizeSource(
  providerId: ProviderId,
  provider: CompletionProvider,
  config: ProviderConfig,
  source: SourcePayload,
  limits: { thinking?: CompletionThinking; outputCompressionMode?: OutputCompressionMode; traceId?: string },
  onChunk?: (chunk: string) => void
): Promise<{ summary: SummaryResult; meta: SummaryMeta }> {
  const totalStartedAt = Date.now();
  const providerStartedAt = Date.now();
  let providerDurationMs: number | undefined;
  let firstChunkMs: number | undefined;
  const diagnosticBase = {
    ...(limits.traceId ? { traceId: limits.traceId } : {}),
    sourceKind: source.sourceKind,
    providerId,
    model: config.selectedModel,
    textLength: source.text.length
  };
  const wrappedOnChunk = onChunk
    ? (chunk: string) => {
        firstChunkMs ??= elapsedMs(providerStartedAt);
        onChunk(chunk);
      }
    : undefined;

  try {
    const mode = resolveSummarizationMode(providerId, source.text);
    const { summary, parseDurationMs, timing: executionTiming } = mode === "direct"
      ? await summarizeDirectSource(providerId, provider, config, source, limits, wrappedOnChunk)
      : await summarizeChunkedSource(provider, config, source, limits, wrappedOnChunk);
    providerDurationMs = elapsedMs(providerStartedAt);
    const totalMs = elapsedMs(totalStartedAt);
    const timing = buildSummaryTiming(
      limits.traceId,
      executionTiming,
      totalMs,
      providerDurationMs,
      firstChunkMs,
      parseDurationMs
    );
    logSummaryDiagnostic({
      ...diagnosticBase,
      ok: true,
      mode,
      totalMs,
      stages: {
        provider: diagnosticStage(true, providerDurationMs, firstChunkMs),
        ...(executionTiming.chunkCount !== undefined
          ? { chunks: diagnosticStage(true, executionTiming.chunkDurationMs, undefined, executionTiming.chunkCount, executionTiming.chunkConcurrency) }
          : {}),
        ...(executionTiming.synthesisDurationMs !== undefined
          ? { synthesis: diagnosticStage(true, executionTiming.synthesisDurationMs, firstChunkMs) }
          : {}),
        parse: diagnosticStage(true, parseDurationMs)
      }
    });
    return {
      summary,
      meta: buildMeta(providerId, config.selectedModel, timing)
    };
  } catch (error) {
    logSummaryDiagnostic({
      ...diagnosticBase,
      ok: false,
      mode: resolveSummarizationMode(providerId, source.text),
      totalMs: elapsedMs(totalStartedAt),
      stages: {
        provider: diagnosticStage(providerDurationMs !== undefined, providerDurationMs, firstChunkMs)
      },
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function summarizeDirectSource(
  providerId: ProviderId,
  provider: CompletionProvider,
  config: ProviderConfig,
  source: SourcePayload,
  limits: { thinking?: CompletionThinking; outputCompressionMode?: OutputCompressionMode },
  onChunk?: (chunk: string) => void
): Promise<{ summary: SummaryResult; parseDurationMs: number; timing: SummaryExecutionTiming }> {
  const request = withThinking(buildSummaryRequest(source, limits.outputCompressionMode), limits.thinking);
  const attempts = canRetryCustomProviderStream(providerId, onChunk) ? DIRECT_SUMMARY_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // 面板会累积流式内容；一旦推过内容就不再整轮重发，否则用户会看到重复正文。
    let emitted = false;
    const trackChunk = onChunk
      ? (chunk: string) => {
          emitted = true;
          onChunk(chunk);
        }
      : undefined;

    try {
      return await runDirectSummaryAttempt(provider, config, request, trackChunk);
    } catch (error) {
      lastError = error;
      // 首次生成拿到不可用输出（空正文/不可解析/只有思考）时，重发一轮等价于用户点「重试」。
      // 网络、鉴权、限流类错误不重发：重发只会让用户多等一轮再失败。
      const retryable = attempt < attempts - 1 && !emitted && isRetryableSummaryOutputFailure(error);
      if (!retryable) throw error;
      console.warn("[YouMind] summary: 首次生成未产出可解析摘要，自动重发一轮", {
        attempt: attempt + 1,
        reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
      });
    }
  }

  throw lastError;
}

async function runDirectSummaryAttempt(
  provider: CompletionProvider,
  config: ProviderConfig,
  request: CompletionRequest,
  onChunk?: (chunk: string) => void
): Promise<{ summary: SummaryResult; parseDurationMs: number; timing: SummaryExecutionTiming }> {
  const raw = await provider.complete(config, request, onChunk);
  let parsed: { summary: SummaryResult; parseDurationMs: number };
  try {
    parsed = parseTimedSummary(raw);
  } catch (error) {
    if (!onChunk) {
      const preview = raw.slice(0, 500);
      throw new Error(
        `${String(error)}. Model response preview: ${preview}${raw.length > 500 ? "..." : ""}`
      );
    }
    const retried = await parseStrictTreeRetryOrRecover(provider, config, request, raw);
    return { ...retried, timing: { mode: "direct" } };
  }
  // 流式场景下树不完整或流被截断时补全一次结构；非流式按解析结果直接用。
  const needsTreeRetry = onChunk !== undefined && (!hasSummaryTree(parsed.summary) || isTruncatedStreamOutput(raw));
  if (!needsTreeRetry) return { ...parsed, timing: { mode: "direct" } };

  const retried = await parseStrictTreeRetryOrRecover(provider, config, request, raw, parsed.summary);
  return {
    summary: retried.summary,
    parseDurationMs: parsed.parseDurationMs + retried.parseDurationMs,
    timing: { mode: "direct" }
  };
}

// 只有「模型没答出来」（空正文/不可解析/只有思考）才值得整轮重发：
// 这类是瞬时失败，用户手动点「重试」就能成功。
// 不在此列的情况：网络/鉴权/限流（重发只会再失败），以及「答了但树太薄」——
// 后者已经过结构补全重试，整轮重发只会让用户多等一轮。
const RETRYABLE_SUMMARY_FAILURE_MARKERS = [
  "模型返回内容为空",
  "没有找到 JSON 对象",
  "模型返回的摘要 JSON 无法解析",
  "模型返回的摘要不是对象",
  "模型仅返回占位摘要",
  "缺少 final.summary",
  "只返回了思考内容",
  "没有返回任何内容"
];

// 结构补全重试已经答过一轮、只是树太薄：不算瞬时失败，不整轮重发。
const NON_RETRYABLE_SUMMARY_FAILURE_MARKERS = ["补全请求仍缺少有效 sections/points"];

function isRetryableSummaryOutputFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (NON_RETRYABLE_SUMMARY_FAILURE_MARKERS.some((marker) => message.includes(marker))) return false;
  if (RETRYABLE_SUMMARY_FAILURE_MARKERS.some((marker) => message.includes(marker))) return true;
  // 未包装的 JSON.parse 错误也算输出不可用。
  return /Unexpected token|Unterminated string|Expected property name|Bad control character/u.test(message);
}

async function parseStrictTreeRetryOrRecover(
  provider: CompletionProvider,
  config: ProviderConfig,
  request: CompletionRequest,
  raw: string,
  firstSummary?: SummaryResult
): Promise<{ summary: SummaryResult; parseDurationMs: number }> {
  try {
    return await parseStrictTreeRetry(provider, config, request);
  } catch (retryError) {
    const recoverStartedAt = Date.now();
    const recovered = recoverLenientStreamSummary(raw);
    const recoverDurationMs = elapsedMs(recoverStartedAt);
    const fallback = recovered ?? (firstSummary && hasSummaryTree(firstSummary) ? firstSummary : undefined);
    if (!fallback) throw retryError;
    // 补全重试失败不应丢弃首次流式已产出的树（3.8 Flash 长内容截断高频复现）。
    console.warn("[YouMind] summary: strict tree retry failed; keeping the first streamed summary", {
      recoveredFrom: recovered ? "event-stream-rebuild" : "first-parse"
    });
    return { summary: fallback, parseDurationMs: recovered ? recoverDurationMs : 0 };
  }
}

async function parseStrictTreeRetry(
  provider: CompletionProvider,
  config: ProviderConfig,
  request: CompletionRequest
): Promise<{ summary: SummaryResult; parseDurationMs: number }> {
  const retryRaw = provider.complete(config, buildStrictTreeRetryRequest(request));
  const retried = parseTimedSummary(await retryRaw);
  if (!hasSummaryTree(retried.summary)) {
    throw new Error("模型返回的摘要 JSON 无法解析：补全请求仍缺少有效 sections/points");
  }
  return retried;
}

function canRetryCustomProviderStream(
  _providerId: ProviderId,
  onChunk: ((chunk: string) => void) | undefined
): boolean {
  return Boolean(onChunk);
}

function buildStrictTreeRetryRequest(request: CompletionRequest): CompletionRequest {
  return {
    ...request,
    system: [
      request.system,
      "这是结构补全重试。只输出一个完整严格 JSON 对象，不要输出 JSONL、Markdown 或解释。",
      "sections 必须包含真实树状要点；不得把 overview 原文复制成 section 或 point。"
    ].join("\n"),
    user: [
      request.user,
      "",
      "上一次响应只返回了 overview 或在 sections 处截断。请重新生成并补全为一份完整摘要。",
      "输出完整的 title、overview、sections；每个 section 必须包含至少一个真实 point。"
    ].join("\n"),
    expectJson: true
  };
}

async function summarizeChunkedSource(
  provider: CompletionProvider,
  config: ProviderConfig,
  source: SourcePayload,
  limits: { thinking?: CompletionThinking; outputCompressionMode?: OutputCompressionMode },
  onChunk?: (chunk: string) => void
): Promise<{ summary: SummaryResult; parseDurationMs: number; timing: SummaryExecutionTiming }> {
  let chunks: string[];
  try {
    chunks = splitContentIntoChunks(source.text);
    if (chunks.length === 0) {
      throw new Error("没有可总结的正文。");
    }
  } catch (error) {
    throw buildChunkFailureError("splitting", 0, 0, error);
  }

  const { summaries: chunkSummaries, chunkDurationMs, concurrency } = await summarizeChunksConcurrently(
    provider,
    config,
    source,
    chunks,
    limits,
    onChunk
  );

  try {
    const synthesisStartedAt = Date.now();
    const request = withThinking(buildSynthesisSummaryRequest(source, chunkSummaries, limits.outputCompressionMode), limits.thinking);
    const raw = await provider.complete(config, request, onChunk);
    const synthesisDurationMs = elapsedMs(synthesisStartedAt);
    let parsed: { summary: SummaryResult; parseDurationMs: number };
    try {
      parsed = parseTimedSummary(raw);
    } catch (parseError) {
      const preview = raw.slice(0, 500);
      const augmentedError = new Error(
        `${String(parseError)}. Model response preview: ${preview}${raw.length > 500 ? "..." : ""}`
      );
      throw augmentedError;
    }
    return {
      ...parsed,
      timing: {
        mode: "chunk",
        chunkCount: chunks.length,
        chunkConcurrency: concurrency,
        chunkDurationMs,
        synthesisDurationMs
      }
    };
  } catch (error) {
    throw buildChunkFailureError("synthesis", chunks.length, chunks.length, error);
  }
}

async function summarizeChunksConcurrently(
  provider: CompletionProvider,
  config: ProviderConfig,
  source: SourcePayload,
  chunks: string[],
  limits: { thinking?: CompletionThinking; outputCompressionMode?: OutputCompressionMode },
  onChunk?: (chunk: string) => void
): Promise<{ summaries: SummaryResult[]; chunkDurationMs: number; concurrency: number }> {
  const startedAt = Date.now();
  const concurrency = Math.min(SUMMARY_CHUNK_CONCURRENCY, chunks.length);
  const summaries: SummaryResult[] = new Array(chunks.length);
  let completed = 0;
  let nextIndex = 0;
  let firstFailure: { index: number; error: unknown } | undefined;

  const runWorker = async () => {
    while (!firstFailure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunks.length) return;

      try {
        const request = withThinking(
          buildChunkSummaryRequest(source, chunks[index] ?? "", index + 1, chunks.length),
          limits.thinking
        );
        const raw = await provider.complete(config, request);
        try {
          summaries[index] = parseSummaryOutput(raw);
          completed += 1;
          if (onChunk) {
            onChunk(JSON.stringify({ type: "chunk_progress", done: completed, total: chunks.length }));
          }
        } catch (parseError) {
          const preview = raw.slice(0, 500);
          const augmentedError = new Error(
            `${String(parseError)}. Model response preview: ${preview}${raw.length > 500 ? "..." : ""}`
          );
          throw augmentedError;
        }
      } catch (error) {
        firstFailure ??= { index, error };
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  if (firstFailure) {
    throw buildChunkFailureError("chunk summarization", firstFailure.index, chunks.length, firstFailure.error);
  }

  return {
    summaries,
    chunkDurationMs: elapsedMs(startedAt),
    concurrency
  };
}

function parseTimedSummary(raw: string): { summary: SummaryResult; parseDurationMs: number } {
  const parseStartedAt = Date.now();
  return {
    summary: parseSummaryOutput(raw),
    parseDurationMs: elapsedMs(parseStartedAt)
  };
}

export function chooseSummarizationMode(text: string, maxDirectChars = DIRECT_SUMMARY_MAX_CHARS): SummaryMode {
  const normalized = normalizeSummarySourceText(text);
  if (!normalized) return "direct";
  if (!Number.isFinite(maxDirectChars) || maxDirectChars <= 0) return "chunk";
  return normalized.length <= Math.floor(maxDirectChars) ? "direct" : "chunk";
}

function resolveSummarizationMode(providerId: ProviderId, text: string): SummaryMode {
  if (resolveProviderTraits(providerId).skipsChunking) return "direct";
  return chooseSummarizationMode(text);
}

export function splitContentIntoChunks(text: string, targetChars = CHUNK_TARGET_CHARS): string[] {
  const normalized = normalizeSummarySourceText(text);
  if (!normalized) return [];

  const target = normalizeChunkTargetChars(targetChars, normalized.length);
  const maxChars = Math.max(target, Math.ceil(target * 1.25));
  const chunks: string[] = [];
  let current = "";

  const appendPiece = (piece: string) => {
    if (!piece) return;
    if (!current) {
      current = piece;
      return;
    }
    if (current.length + 2 + piece.length <= target) {
      current = `${current}\n\n${piece}`;
      return;
    }
    chunks.push(current);
    current = piece;
  };

  for (const paragraph of normalized.split(/\n{2,}/)) {
    const cleanParagraph = paragraph.trim();
    if (!cleanParagraph) continue;
    const pieces = cleanParagraph.length > maxChars
      ? splitLongParagraph(cleanParagraph, target)
      : [cleanParagraph];
    pieces.forEach(appendPiece);
  }

  if (current) chunks.push(current);
  return chunks;
}

export function normalizeSummarySourceText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizeChunkTargetChars(targetChars: number, sourceLength: number): number {
  if (!Number.isFinite(targetChars) || targetChars <= 0) {
    return Math.max(1, sourceLength);
  }
  return Math.max(1, Math.floor(targetChars));
}

function splitLongParagraph(paragraph: string, targetChars: number): string[] {
  const sentenceUnits = paragraph.match(/[^。！？!?；;.]+[。！？!?；;.]?\s*/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current) {
      pieces.push(current.trim());
      current = "";
    }
  };

  for (const unit of sentenceUnits) {
    if (unit.length > targetChars) {
      pushCurrent();
      for (let offset = 0; offset < unit.length; offset += targetChars) {
        const slice = unit.slice(offset, offset + targetChars).trim();
        if (slice) pieces.push(slice);
      }
      continue;
    }
    if (!current || current.length + unit.length <= targetChars) {
      current = `${current}${unit}`;
    } else {
      pushCurrent();
      current = unit;
    }
  }
  pushCurrent();
  return pieces;
}

function buildChunkSummaryRequest(
  source: SourcePayload,
  chunkText: string,
  chunkIndex: number,
  chunkTotal: number
): CompletionRequest {
  // 中间提炼是下游合成的原料：两个 plan 都不应用档位取舍规则。
  // sourcePlan 只用 sourceContext，但同样关掉档位，避免以后加字段时把档位带进原料层。
  const sourcePlan = buildSummaryRequestPlan(source, "off", false);
  const chunkPlan = buildSummaryRequestPlan({ ...source, text: chunkText }, "off", false);
  return {
    system: chunkSummarySystemPrompt(),
    user: [
      `请总结以下长内容的第 ${chunkIndex}/${chunkTotal} 段。`,
      "这是内部中间提炼，不是最终展示给用户的摘要。",
      "输出紧凑 SummaryResult，但必须保留本段中的事实、数字、步骤、例子、限制、结论和可复用细节，供最终合成使用。",
      "",
      sourcePlan.sourceContext,
      `分块：第 ${chunkIndex}/${chunkTotal} 段`,
      chunkPlan.lengthGuidance,
      "",
      chunkText
    ].join("\n"),
    expectJson: true
  };
}

function buildSynthesisSummaryRequest(
  source: SourcePayload,
  chunkSummaries: SummaryResult[],
  outputCompressionMode: OutputCompressionMode = "off"
): CompletionRequest {
  const notes = chunkSummaries
    .map((summary, index) => `## 第 ${index + 1}/${chunkSummaries.length} 段中间摘要\n${JSON.stringify(summary)}`)
    .join("\n\n");
  const plan = buildSummaryRequestPlan(source, outputCompressionMode);
  return {
    system: summarySystemPrompt(outputCompressionMode),
    user: [
      "请把以下分块中间摘要合成为一份最终摘要。",
      "最终结果必须是一个 canonical SummaryResult：一个 title、一段 overview、一棵 tree。",
      "不要输出分块分页，不要按 chunk 单独展示；按全篇主题、时间线或论证链重组。",
      "不要补充来源中没有的信息；不要启用联网搜索。",
      "",
      plan.sourceContext,
      `原文长度约 ${normalizeSummarySourceText(source.text).length} 字符`,
      `分块总数：${chunkSummaries.length}`,
      plan.lengthGuidance,
      "",
      notes
    ].join("\n"),
    expectJson: true
  };
}

function buildChunkFailureError(stage: ChunkFailureStage, position: number, total: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (stage === "chunk summarization") {
    return new Error(`分块失败：${stage}，第 ${position + 1}/${total} 段。${message}`);
  }
  return new Error(`分块失败：${stage}，已处理 ${position}/${total} 段。${message}`);
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function diagnosticStage(
  ok: boolean,
  durationMs?: number,
  firstChunkMs?: number,
  count?: number,
  concurrency?: number
): SummaryDiagnosticStage {
  return {
    ok,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(firstChunkMs !== undefined ? { firstChunkMs } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(concurrency !== undefined ? { concurrency } : {})
  };
}

function buildSummaryTiming(
  traceId: string | undefined,
  executionTiming: SummaryExecutionTiming,
  totalMs: number,
  providerDurationMs: number | undefined,
  providerFirstChunkMs: number | undefined,
  parseDurationMs: number | undefined
): SummaryTimingMeta | undefined {
  if (!traceId) return undefined;
  return {
    traceId,
    mode: executionTiming.mode,
    totalMs,
    ...(providerFirstChunkMs !== undefined ? { providerFirstChunkMs } : {}),
    ...(providerDurationMs !== undefined ? { providerDurationMs } : {}),
    ...(parseDurationMs !== undefined ? { parseDurationMs } : {}),
    ...(executionTiming.chunkCount !== undefined ? { chunkCount: executionTiming.chunkCount } : {}),
    ...(executionTiming.chunkConcurrency !== undefined ? { chunkConcurrency: executionTiming.chunkConcurrency } : {}),
    ...(executionTiming.chunkDurationMs !== undefined ? { chunkDurationMs: executionTiming.chunkDurationMs } : {}),
    ...(executionTiming.synthesisDurationMs !== undefined ? { synthesisDurationMs: executionTiming.synthesisDurationMs } : {})
  };
}

function logSummaryDiagnostic(diagnostic: SummaryDiagnostic): void {
  try {
    console.info("[YouMind] summary diagnostic", diagnostic);
  } catch {
    // Diagnostics must never affect summary generation.
  }
}

function withThinking(request: CompletionRequest, thinking?: CompletionThinking): CompletionRequest {
  return thinking ? { ...request, thinking } : request;
}

export function buildSummaryRequest(source: SourcePayload, outputCompressionMode: OutputCompressionMode = "off"): CompletionRequest {
  const plan = buildSummaryRequestPlan(source, outputCompressionMode);
  return {
    system: summarySystemPrompt(outputCompressionMode),
    user: [
      "请总结以下内容。",
      "",
      plan.sourceContext,
      plan.lengthGuidance,
      ...(plan.extractionStatus ? ["", plan.extractionStatus] : []),
      "",
      source.text
    ].join("\n"),
    expectJson: true
  };
}

// 填充词属于表达层规则，与取舍力度无关：三档共用一份，只写一次。
const FILLER_WORD_RULE =
  "删除填充词：其实、实际上、基本上、需要注意的是、值得注意的是、可以说、总的来说、简单来说。";

// 档位规则定义内容取舍；最终可见篇幅目标由共享的预算规则单独注入。
// 函数名保留历史形态，它现在管的是取舍强度而非输出压缩。
export function outputCompressionSystemGuidance(mode: OutputCompressionMode | undefined): string {
  switch (mode) {
    case "lite":
      return [
        "摘要取舍档位：标准。尽量保留作者论证骨架与主要独立观点；只删重复解释、空泛评价、过渡句。",
        FILLER_WORD_RULE,
        "预算紧张时先缩短表达、合并重复内容，再删次要例子和旁支；保留每个主要观点的独有结论与必要论据。",
        "反例：把观点压成无法区分的空泛标签。正例：合并重复表达，同时保留各主要观点的结论与关键证据。"
      ].join("\n");
    case "full":
      return [
        "摘要取舍档位：精简。只保留读懂这篇必需的内容；同义观点合并，弱例子、作者个人铺垫、与主旨无关的旁支可删。",
        FILLER_WORD_RULE,
        "预算紧张时优先保留结论、支撑结论的必要证据与核心因果链；删去不影响理解的内容。",
        "反例：保留「项目背景」整节介绍作者动机。正例：整节删除，动机已由结论隐含。"
      ].join("\n");
    case "ultra":
      return [
        "摘要取舍档位：极简。先对每个 section / point 问「它在不在都不影响理解？」——在就删。",
        FILLER_WORD_RULE,
        "只留结论、最关键证据、必要动作与关键数字；允许整节删除。",
        "反例：保留「作者写作动机」与「文章发表背景」两个 section。正例：两节都删，只留核心结论与关键数字。"
      ].join("\n");
    default:
      return "";
  }
}

// 三档共用的取舍护栏：与档位强度无关，删掉会让摘要从「更简洁」变成「更错误」。
const PRUNING_GUARDRAIL = [
  "摘要取舍护栏：压表达，不歪曲关键事实。",
  "观点、步骤、方案与证据按理解价值和篇幅目标排序，不因内容类别自动豁免；预算紧张时先压缩表达与次要细节。"
].join("\n");

// 永不砍清单：与档位强度无关的基础约束，所有档位（含「默认」）无条件生效。
// 这五类被砍掉时，摘要会从「更简洁」变成「错误」，所以不放进档位 switch 里。
const NEVER_CUT_RULE = [
  "永不砍清单（与取舍力度无关，任何档位都必须遵守）：",
  "保留数字与单位；保留否定与限定条件（「仅限」「不支持」「除…以外」），不得改写成肯定；",
  "保留因果链的因，不只留结果；保留原文出处与链接；保留错误原文与技术标识符。",
  "上面的「保留关键术语、API 名、参数名、命令、路径、版本号、错误原文和 URL，不要意译」管的是保留原文形态，本清单管的是不许删。"
].join("\n");

// 最终摘要面的档位引导拼接：档位规则 + 共用护栏 + 永不砍清单。
// 「默认」档不做取舍，只带永不砍清单。中间提炼不经过这里（它只带永不砍清单）。
function buildCompressionGuidance(mode: OutputCompressionMode): string[] {
  if (mode === "off") return [NEVER_CUT_RULE];
  return [outputCompressionSystemGuidance(mode), PRUNING_GUARDRAIL, NEVER_CUT_RULE];
}

function chunkSummarySystemPrompt(): string {
  return [
    "你是网页和视频字幕总结助手。当前任务是分段中间提炼，不是最终摘要。",
    "只输出一个严格 JSON 对象，不要输出 JSONL 事件流，不要输出 overview_delta/section/point/child 事件，不要输出 Markdown。",
    "JSON 格式：{\"title\":\"本段主题\",\"overview\":\"一句话概括本段核心\",\"sections\":[{\"title\":\"一级主题\",\"points\":[{\"text\":\"二级主题\",\"children\":[{\"text\":\"具体事实\"}]}]}]}",
    "overview 只写一句话，概括本段核心；不要写多段概览。",
    "保留本段中的事实、数字、步骤、例子、限制、结论和可复用细节，供最终合成使用。",
    "不要输出分块编号或分页标记。",
    "不输出 emoji、免责声明、推测性表述或空泛评价。",
    "只基于给定内容，不要编造、不要补全源中不存在的信息。",
    "保留关键术语、API 名、参数名、命令、路径、版本号、错误原文和 URL，不要意译。",
    "省略广告、赞助内容、产品推销、CTA。",
    NEVER_CUT_RULE
  ].filter(Boolean).join("\n");
}

function summarySystemPrompt(outputCompressionMode: OutputCompressionMode = "off"): string {
  return [
    "你是网页和视频字幕总结助手。",
    "只输出最终摘要；不要输出规划、推理步骤、'最终答案'等前缀或元说明。",
    "输出风格参考 YouMind：先给一段信息密度高的中文概览，再给树状层级要点。",
    "优先输出 JSONL 事件流，每行一个 JSON 对象，不要使用 Markdown，不要输出事件之外的解释。",
    "JSONL 事件格式：{\"type\":\"overview_delta\",\"text\":\"中文概览增量\"}、{\"type\":\"section\",\"index\":0,\"title\":\"一级主题\"}、{\"type\":\"point\",\"section\":0,\"index\":0,\"text\":\"二级主题\"}、{\"type\":\"child\",\"section\":0,\"point\":0,\"index\":0,\"text\":\"具体事实或结论\"}。",
    "最后必须输出 {\"type\":\"final\",\"summary\":{\"title\":\"...\",\"overview\":\"中文概览段落\",\"sections\":[{\"title\":\"一级主题\",\"points\":[{\"text\":\"二级主题\",\"children\":[{\"text\":\"具体事实或结论\"}]}]}]}}，final.summary 必须是完整标准 SummaryResult。",
    "JSONL 草稿事件不是可丢弃预览，而是同一份摘要的增量形态。",
    "final.summary 必须是在已按当前取舍档位选定的内容范围内、所有已输出 JSONL 事件的完整最终快照：section/point 索引要对应，已输出事实可润色修正，但不得变薄。",
    "「不得变薄」约束的是草稿到 final 的一致性，不约束取舍档位本身：档位要求删掉的内容，从草稿阶段就不该输出。",
    "不得在 final.summary 中丢失已经输出过的 overview；如果输出过 overview_delta，final.summary.overview 必须包含同等或更完整的概览。",
    "不得在 final.summary 中丢失已经输出过的 child 三级细节；同一路径已经输出 child 时，final.summary.sections[*].points[*].children 必须保留同等或更完整的具体事实。",
    "如果无法按 JSONL 输出，则必须至少输出同一个 final.summary 结构对应的严格 JSON 摘要对象作为 fallback；fallback 严格 JSON 也必须遵守同一完整性要求。",
    "overview 用一段中文概览，概括主张、因果关系、关键对象和结论；不要以“总结：”“概览：”“总览：”开头，也不要写空泛套话。适当保留 1-2 个原文短摘录（不超过 25 字），用「」括起以增强可信度。",
    "摘要长度由取舍档位与有效信息量共同决定，不与原文长度成比例：原文长不等于摘要必须长。",
    "取舍档位优先于长度信号：档位要求删掉的内容，任何长度提示都不得要求补回。",
    buildSummaryLengthBudgetGuidance(outputCompressionMode),
    "输出顺序是硬约束：先输出某个 section 的 section 事件，紧接着输出该 section 的全部 point 及其 children，全部输出完才允许输出下一个 section。",
    "禁止规划式输出：不得先把后续 section 的标题列出来再回头补内容，也不得预声明尚未展开的 section。",
    "不要固定一级主题、二级主题或具体子点数量；根据取舍档位、信息密度和论证层级自适应展开。",
    "标题和 URL 只作为辅助线索；如果正文内容与标题或 URL 暗示冲突，以正文为准。",
    "页面策略只用于决定关注重点，不得强制固定标题、层级数量或输出模板。",
    "区分已确认事实、作者观点、他人观点和推测；不要把观点改写成事实。",
    "保留关键术语、API 名、参数名、命令、路径、版本号、错误原文和 URL，不要意译。",
    "省略广告、赞助内容、产品推销、折扣码、CTA（号召行动）；不要提及你跳过了什么，不要输出品牌推广语言。",
    "保留重要事实、示例、结论和建议。",
    "忽略导航栏、页脚、推荐阅读、订阅弹窗、版权声明、站点说明和与正文无关的评论区内容。",
    "如果正文明显残缺或只有导航/占位内容，说明可用内容不足，不要根据标题或常识补全。",
    "每个 section 聚焦一个一级主题，标题要具体；point.text 优先写二级主题或判断，不要只写一个模糊名词。",
    "children 是三级细节层，必须写具体：事实、理由、限制、数字、例子、步骤、结论、对比、条件。不要只写标签性短语（如\"使用简单\"），要用最短准确表述保留理解所需的关键链条；次要细节按篇幅目标取舍。",
    "不要删关键事实，也不要用固定模板凑数；摘要层级应服务于内容本身。取舍只压表达，不压事实。",
    "不输出 emoji、免责声明、推测性表述或空泛评价。",
    "只基于给定内容，严格对照原文；不要编造、不要补全残缺内容、不要添加源中不存在的信息。",
    ...buildCompressionGuidance(outputCompressionMode)
  ].filter(Boolean).join("\n");
}

function buildMeta(providerId: ProviderId, model: string, timing?: SummaryTimingMeta): SummaryMeta {
  return {
    providerId,
    model,
    generatedAt: Date.now(),
    ...(timing ? { timing } : {})
  };
}
