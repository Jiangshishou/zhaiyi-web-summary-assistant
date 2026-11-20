import { isRecord } from "../shared/jsonRead";
import { extractPartialJsonSource, extractPartialJsonStringValue } from "../shared/partialJson";
import {
  buildSummaryDraftFromEvents,
  parseSummaryStreamEventLine,
  type SummaryStreamEvent
} from "../shared/summaryStreamEvents";
import { finalizeSummary, hasMeaningfulSummary, removeOverviewDuplicatePoints } from "../shared/summaryQuality";
import type { SummaryPoint, SummaryResult, SummarySection } from "../shared/types";

export type SummaryStreamUpdate =
  | { kind: "final"; summary: SummaryResult }
  | { kind: "draft"; draft: SummaryResult }
  | { kind: "event-overview"; overview: string }
  | { kind: "json-summary"; summary: SummaryResult }
  | { kind: "partial-overview"; overview: string }
  | { kind: "none" };

export class SummaryStreamAssembler {
  private buffer = "";
  private preview?: SummaryResult;
  private draft?: SummaryResult;
  private overview?: string;
  /** Newline-terminated prefix of `buffer` already committed into `events`. */
  private eventScanOffset = 0;
  private events: SummaryStreamEvent[] = [];
  /** Last event came from a non-newline-terminated tail and may still grow. */
  private provisionalTailEvent = false;
  /** Last complete strict-JSON object text used for a json-summary preview. */
  private lastCompleteJsonText?: string;

  append(chunk: string): SummaryStreamUpdate {
    this.buffer += chunk;

    const eventsChanged = this.consumeNewEventLines();
    if (this.events.length > 0) {
      // No new complete event lines → skip O(n) draft rebuild / re-emit.
      if (!eventsChanged) return { kind: "none" };

      const eventDraft = buildSummaryDraftFromEvents(this.events);
      if (eventDraft) {
        if (eventDraft.finalSummary) {
          const finalSummary = this.mergeSummaryWithStreamFallback(
            eventDraft.finalSummary,
            { title: eventDraft.finalSummary.title, overview: eventDraft.overview, sections: eventDraft.sections }
          );
          if (!hasMeaningfulSummary(finalSummary)) return { kind: "none" };
          this.preview = finalSummary;
          this.draft = undefined;
          this.overview = undefined;
          return { kind: "final", summary: finalSummary };
        }
        this.overview = eventDraft.overview || this.overview;
        this.draft = eventDraft.sections.length > 0
          ? { title: "", overview: eventDraft.overview, sections: eventDraft.sections }
          : undefined;
        if (this.draft) return { kind: "draft", draft: this.draft };
        return { kind: "event-overview", overview: eventDraft.overview };
      }
    }

    const jsonText = extractCompleteJsonObject(this.buffer);
    if (jsonText) {
      // Unchanged complete object (e.g. trailing whitespace chunks) must not re-emit.
      if (jsonText === this.lastCompleteJsonText && this.preview) {
        return { kind: "none" };
      }
      const preview = parseStreamSummaryText(jsonText);
      if (preview) {
        this.lastCompleteJsonText = jsonText;
        this.preview = preview;
        return { kind: "json-summary", summary: preview };
      }
    }

    const overview = extractPartialJsonStringValue(this.buffer, "overview");
    if (!overview?.trim() || overview === this.overview) return { kind: "none" };

    this.overview = overview;
    return { kind: "partial-overview", overview };
  }

  mergeFinal(summary: SummaryResult): SummaryResult {
    return this.mergeSummaryWithStreamFallback(summary);
  }

  hasPreview(): boolean {
    return Boolean(this.preview || this.draft || this.overview?.trim());
  }

  get previewSummary(): SummaryResult | undefined {
    return this.preview;
  }

  get previewDraft(): SummaryResult | undefined {
    return this.draft;
  }

  get previewOverview(): string | undefined {
    return this.overview;
  }

  reset(): void {
    this.buffer = "";
    this.preview = undefined;
    this.draft = undefined;
    this.overview = undefined;
    this.eventScanOffset = 0;
    this.events = [];
    this.provisionalTailEvent = false;
    this.lastCompleteJsonText = undefined;
  }

  private consumeNewEventLines(): boolean {
    if (this.provisionalTailEvent) {
      this.events.pop();
      this.provisionalTailEvent = false;
    }

    let changed = false;
    let offset = this.eventScanOffset;
    const buffer = this.buffer;

    while (offset < buffer.length) {
      const nextLf = buffer.indexOf("\n", offset);
      if (nextLf < 0) break;

      let line = buffer.slice(offset, nextLf);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const event = parseSummaryStreamEventLine(line);
      if (event) {
        this.events.push(event);
        changed = true;
      }
      offset = nextLf + 1;
    }
    this.eventScanOffset = offset;

    const tail = buffer.slice(offset);
    if (!tail) return changed;

    const tailEvent = parseSummaryStreamEventLine(tail);
    if (tailEvent) {
      this.events.push(tailEvent);
      this.provisionalTailEvent = true;
      changed = true;
    }
    return changed;
  }

  private mergeSummaryWithStreamFallback(
    summary: SummaryResult,
    fallbackDraft = this.getCurrentDraft()
  ): SummaryResult {
    const stored = this.getCurrentDraft();
    // 显式传入的 draft（来自 JSONL 事件）优先作为主 draft，
    // 但如果没有有效内容则用存储的 preview
    const mergedFallback = fallbackDraft && stored && fallbackDraft !== stored
      ? finalizeSummary(fallbackDraft, stored)
      : (fallbackDraft ?? stored);
    if (!mergedFallback) return summary;
    return finalizeSummary(summary, mergedFallback);
  }

  private getCurrentDraft(): SummaryResult | undefined {
    if (this.draft) return this.draft;
    if (this.overview?.trim()) return { title: "", overview: this.overview, sections: [] };
    return this.preview;
  }
}

function parseStreamSummaryText(jsonText: string): SummaryResult | undefined {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return normalizeStreamSummary(parsed);
  } catch {
    return undefined;
  }
}

function extractCompleteJsonObject(buffer: string): string | undefined {
  const source = extractPartialJsonSource(buffer).trim().replace(/```\s*$/u, "").trim();
  const start = source.indexOf("{");
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

function normalizeStreamSummary(value: unknown): SummaryResult | undefined {
  if (!isRecord(value)) return undefined;
  const overview = typeof value.overview === "string" ? value.overview : "";
  const parsedSections = Array.isArray(value.sections) ? value.sections.map(normalizeStreamSection).filter(isSummarySection) : [];
  const sections = removeOverviewDuplicatePoints(parsedSections, overview);
  if (!overview && sections.length === 0) return undefined;

  return {
    title: typeof value.title === "string" ? value.title : "",
    overview,
    sections
  };
}

function normalizeStreamSection(value: unknown): SummarySection | undefined {
  if (!isRecord(value) || typeof value.title !== "string") return undefined;
  const points = Array.isArray(value.points) ? value.points.map(normalizeStreamPoint).filter(isSummaryPoint) : [];
  return { title: value.title, points };
}

function normalizeStreamPoint(value: unknown): SummaryPoint | undefined {
  if (!isRecord(value) || typeof value.text !== "string") return undefined;
  const children = Array.isArray(value.children) ? value.children.map(normalizeStreamPoint).filter(isSummaryPoint) : undefined;
  return children?.length ? { text: value.text, children } : { text: value.text };
}

function isSummarySection(value: SummarySection | undefined): value is SummarySection {
  return Boolean(value);
}

function isSummaryPoint(value: SummaryPoint | undefined): value is SummaryPoint {
  return Boolean(value);
}
