import { isTranscriptSource } from "./panelSubtitle";
import type { SourcePayload } from "../shared/types";

export type FullChainRoute = "cache-hit" | "generated" | "error";
export type FullChainStageName = "mount" | "settings" | "cache" | "extraction" | "summary" | "render";

export interface FullChainStageRecord {
  ok: boolean;
  durationMs: number;
  hit?: boolean;
  route?: string;
  providerFirstChunkMs?: number;
  providerDurationMs?: number;
  parseDurationMs?: number;
}

export interface FullChainTraceState {
  traceId: string;
  startedAt: number;
  page?: { host: string; pathname: string };
  stages: Partial<Record<FullChainStageName, FullChainStageRecord>>;
  sourceKind?: SourcePayload["sourceKind"];
}

export interface FullChainDiagnostic {
  traceId: string;
  ok: boolean;
  route: FullChainRoute;
  sourceKind?: SourcePayload["sourceKind"];
  page?: { host: string; pathname: string };
  totalMs: number;
  stages: Partial<Record<FullChainStageName, FullChainStageRecord>>;
  error?: { stage: string; message: string };
}

/**
 * Observability state machine for the summarize pipeline
 * (mount -> settings -> cache -> extraction -> summary -> render).
 * Diagnostics must never affect panel behavior.
 */
export class FullChainTracer {
  private trace?: FullChainTraceState;
  private last?: FullChainDiagnostic;

  get active(): FullChainTraceState | undefined {
    return this.trace;
  }

  get lastDiagnostic(): FullChainDiagnostic | undefined {
    return this.last;
  }

  start(): FullChainTraceState {
    this.last = undefined;
    const trace: FullChainTraceState = {
      traceId: createPanelRequestId("trace"),
      startedAt: Date.now(),
      page: readSafePageIdentity(),
      stages: {}
    };
    this.trace = trace;
    return trace;
  }

  ensure(): FullChainTraceState {
    return this.trace ?? this.start();
  }

  clear(trace: FullChainTraceState): void {
    if (this.trace === trace) this.trace = undefined;
  }

  setSourceKind(sourceKind: SourcePayload["sourceKind"]): void {
    if (this.trace) this.trace.sourceKind = sourceKind;
  }

  stageFailed(name: FullChainStageName): boolean {
    return this.trace?.stages[name]?.ok === false;
  }

  async timeStage<T>(
    name: FullChainStageName,
    action: () => Promise<T>,
    extra?: (value: T) => Partial<FullChainStageRecord>
  ): Promise<T> {
    if (!this.trace) return action();
    const startedAt = Date.now();
    try {
      const value = await action();
      this.recordStage(name, {
        ok: true,
        durationMs: elapsedMs(startedAt),
        ...(extra ? extra(value) : {})
      });
      return value;
    } catch (error) {
      this.recordStage(name, { ok: false, durationMs: elapsedMs(startedAt) });
      throw error;
    }
  }

  recordStage(name: FullChainStageName, stage: FullChainStageRecord): void {
    const trace = this.trace;
    if (!trace) return;
    trace.stages[name] = stage;
  }

  finish(
    route: FullChainRoute,
    ok: boolean,
    options: { stage?: string; error?: unknown } = {}
  ): void {
    const trace = this.trace;
    if (!trace) return;
    const diagnostic: FullChainDiagnostic = {
      traceId: trace.traceId,
      ok,
      route,
      ...(trace.sourceKind ? { sourceKind: trace.sourceKind } : {}),
      ...(trace.page ? { page: trace.page } : {}),
      totalMs: elapsedMs(trace.startedAt),
      stages: trace.stages,
      ...(options.stage || options.error !== undefined
        ? { error: { stage: options.stage ?? "unknown", message: safeTraceErrorMessage(options.error) } }
        : {})
    };
    this.trace = undefined;
    this.last = diagnostic;
    try {
      console.info("[YouMind] full-chain diagnostic", diagnostic);
    } catch {
      // Diagnostics must never affect panel behavior.
    }
  }

  resolveErrorStage(): string {
    const stages = this.trace?.stages;
    if (stages?.summary?.ok === false) return "summary";
    if (stages?.extraction?.ok === false) return "extraction";
    if (stages?.cache?.ok === false) return "cache";
    if (stages?.settings?.ok === false) return "settings";
    if (stages?.mount?.ok === false) return "mount";
    return "unknown";
  }
}

export function createPanelRequestId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export function fullChainSourceRoute(source: SourcePayload): string {
  if (isTranscriptSource(source.sourceKind)) return "video-transcript";
  if (source.sourceKind === "fallback") return "fallback-readable";
  return "generic-readable";
}

function readSafePageIdentity(): { host: string; pathname: string } | undefined {
  try {
    const pageUrl = new URL(location.href);
    return {
      host: pageUrl.host,
      pathname: pageUrl.pathname || "/"
    };
  } catch {
    return undefined;
  }
}

function safeTraceErrorMessage(error: unknown): string {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : String(error ?? "");
  return message.replace(/\s+/gu, " ").trim().slice(0, 240) || "unknown error";
}
