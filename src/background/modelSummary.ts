import { parseModelJson } from "./modelJson";
import { isRecord } from "../shared/jsonRead";
import { extractPartialJsonStringValue } from "../shared/partialJson";
import type { SummaryPoint, SummaryResult, SummarySection } from "../shared/types";
import { buildSummaryDraftFromEvents, parseSummaryStreamEvents } from "../shared/summaryStreamEvents";
import { finalizeSummary, hasAnySummaryText, hasMeaningfulSummary, hasMeaningfulSummaryPoint, hasSummaryTree, isMeaningfulSummaryText, removeOverviewDuplicatePoints } from "../shared/summaryQuality";
const OVERVIEW_KEYS = ["overview", "summary", "abstract", "description", "intro", "introduction", "总览", "摘要"];
const SECTION_KEYS = ["sections", "keyPoints", "key_points", "outline", "topics", "chapters", "items"];
const SECTION_TITLE_KEYS = ["title", "heading", "name", "topic", "section"];
const SECTION_POINT_KEYS = ["points", "items", "bullets", "keyPoints", "key_points", "children", "details", "subpoints", "subPoints"];
const SECTION_FALLBACK_TEXT_KEYS = ["text", "point", "content", "summary", "value"];
const POINT_TEXT_KEYS = ["text", "point", "content", "summary", "title", "heading", "name", "value"];
const POINT_CHILD_KEYS = ["children", "details", "items", "subpoints", "subPoints", "bullets", "points"];
const DEFAULT_SUMMARY_TITLE = "当前页面";

export function parseSummaryJson(raw: string): SummaryResult {
  const value = parseModelJson(raw, {
    prefer: isSummaryLikeObject,
    errorPrefix: "模型返回的摘要 JSON 无法解析"
  });
  if (!isSummaryLikeObject(value)) {
    if (hasAnySummaryLikeText(value)) {
      throw new Error("模型返回的摘要 JSON 无法解析：模型仅返回占位摘要");
    }
    throw new Error("模型返回的摘要 JSON 无法解析：缺少有效 overview 或 sections");
  }
  const summary = normalizeSummary(value);
  if (!hasMeaningfulSummary(summary)) {
    throw new Error("模型返回的摘要 JSON 无法解析：模型仅返回占位摘要");
  }
  return summary;
}

// 检测 JSONL 流截断：有流式事件但 final 事件缺失（协议要求 final 必达）。
// 纯严格 JSON 响应（无事件）返回 false，交由既有解析路径处理。
export function isTruncatedStreamOutput(raw: string): boolean {
  let events: ReturnType<typeof parseSummaryStreamEvents>;
  try {
    events = parseSummaryStreamEvents(raw);
  } catch {
    return false;
  }
  if (events.length === 0) return false;
  return buildSummaryDraftFromEvents(events)?.finalSummary === undefined;
}

export function parseSummaryOutput(raw: string): SummaryResult {
  let events: ReturnType<typeof parseSummaryStreamEvents>;
  try {
    events = parseSummaryStreamEvents(raw, { strict: true });
  } catch (error) {
    // Stream event truncation: try recovery from text field
    const recovered = recoverTruncatedStrictJsonSummary(raw);
    if (recovered) return recovered;
    throw error;
  }

  const streamDraft = buildSummaryDraftFromEvents(events);
  const finalSummary = streamDraft?.finalSummary;
  if (finalSummary) {
    const reconciledFinalSummary = finalizeSummary(finalSummary, {
      title: finalSummary.title,
      overview: streamDraft.overview,
      sections: streamDraft.sections
    });
    const normalizedFinalSummary = normalizeSummary(reconciledFinalSummary);
    if (!hasMeaningfulSummary(normalizedFinalSummary)) {
      throw new Error(hasAnySummaryText(finalSummary)
        ? "模型返回的摘要 JSON 无法解析：模型仅返回占位摘要"
        : "模型返回的摘要 JSON 无法解析：缺少有效 overview 或 sections");
    }
    return normalizedFinalSummary;
  }

  if (events.length === 0) {
    try {
      return parseSummaryJson(raw);
    } catch (error) {
      const recovered = recoverTruncatedStrictJsonSummary(raw);
      if (recovered) return recovered;
      throw error;
    }
  }

  // Has events but no final summary - try to build from stream draft
  if (streamDraft && hasAnySummaryText({ title: "", overview: streamDraft.overview, sections: streamDraft.sections })) {
    const title = extractPartialJsonStringValue(raw, "title")?.trim() || DEFAULT_SUMMARY_TITLE;
    return normalizeSummary({
      title,
      overview: streamDraft.overview,
      sections: streamDraft.sections
    });
  }

  const fallbackText = raw
    .split(/\r?\n/u)
    .filter((line) => parseSummaryStreamEvents(line).length === 0)
    .join("\n")
    .trim();

  if (!fallbackText) throw new Error("模型返回的摘要 JSON 无法解析：缺少 final.summary");
  try {
    return parseSummaryJson(fallbackText);
  } catch (error) {
    const recovered = recoverTruncatedStrictJsonSummary(raw);
    if (recovered) return recovered;
    throw error;
  }
}

function recoverTruncatedStrictJsonSummary(raw: string): SummaryResult | undefined {
  // Try stream event text field first
  let overview = normalizeOverviewText(extractPartialJsonStringValue(raw, "text") ?? "");

  // Fallback to plain JSON overview field
  if (!overview) {
    overview = normalizeOverviewText(extractPartialJsonStringValue(raw, "overview") ?? "");
  }

  if (!isMeaningfulSummaryText(overview)) return undefined;

  // Reject truncated overviews shorter than minimum viable length
  if (overview.length < 8) return undefined;

  const title = extractPartialJsonStringValue(raw, "title")?.trim() || DEFAULT_SUMMARY_TITLE;
  return {
    title,
    overview,
    sections: []
  };
}

/**
 * 从原始模型输出宽松抢救一棵带树摘要：跳过坏行继续解析事件流。
 * strict 解析会在坏行处 break 并丢弃后续事件；此处与内容面板的宽松装配同源，
 * 用于 strict 解析失败或结构补全重试失败后的降级回退；无树时返回 undefined。
 */
export function recoverLenientStreamSummary(raw: string): SummaryResult | undefined {
  const events = parseSummaryStreamEvents(raw);
  const draft = buildSummaryDraftFromEvents(events);
  if (!draft) return undefined;

  const title = extractPartialJsonStringValue(raw, "title")?.trim() || DEFAULT_SUMMARY_TITLE;
  const finalSummary = draft.finalSummary;
  const merged = finalSummary
    ? finalizeSummary(finalSummary, { title: finalSummary.title, overview: draft.overview, sections: draft.sections })
    : { title, overview: draft.overview, sections: draft.sections };
  const summary = normalizeSummary(merged);
  return hasSummaryTree(summary) ? summary : undefined;
}

function isSummaryLikeObject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const overview = normalizeOverviewText(readFirstString(value, OVERVIEW_KEYS, ""));
  if (isMeaningfulSummaryText(overview)) return true;
  return readFirstArray(value, SECTION_KEYS).some(hasReadableSectionRow);
}

function hasAnySummaryLikeText(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (normalizeOverviewText(readFirstString(value, OVERVIEW_KEYS, ""))) return true;
  return readFirstArray(value, SECTION_KEYS).some(hasAnyReadableSectionRow);
}

function hasAnyReadableSectionRow(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!isRecord(value)) return false;
  if (readFirstString(value, SECTION_FALLBACK_TEXT_KEYS, "")) return true;
  return readFirstArray(value, SECTION_POINT_KEYS).some(hasAnyReadablePoint);
}

function hasAnyReadablePoint(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!isRecord(value)) return false;
  if (readFirstString(value, POINT_TEXT_KEYS, "")) return true;
  return readFirstArray(value, POINT_CHILD_KEYS).some(hasAnyReadablePoint);
}

function hasReadablePoint(point: SummaryPoint): boolean {
  return hasMeaningfulSummaryPoint(point);
}

function hasReadableSectionRow(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!isRecord(value)) return false;
  const points = readFirstArray(value, SECTION_POINT_KEYS).map(normalizePoint);
  if (points.some(hasReadablePoint)) return true;
  return Boolean(readFirstString(value, SECTION_FALLBACK_TEXT_KEYS, ""));
}

function normalizeSummary(value: unknown): SummaryResult {
  if (!isRecord(value)) throw new Error("模型返回的摘要不是对象");

  const title = readFirstString(value, ["title", "heading", "name"], DEFAULT_SUMMARY_TITLE);
  const rawOverview = normalizeOverviewText(readFirstString(value, OVERVIEW_KEYS, ""));
  const parsedSections = readSummarySections(value).filter((section) => section.points.length > 0);
  const sections = isMeaningfulSummaryText(rawOverview)
    ? removeOverviewDuplicatePoints(parsedSections, rawOverview)
    : parsedSections;
  const overview = isMeaningfulSummaryText(rawOverview)
    ? rawOverview
    : firstMeaningfulPointText(sections);

  return {
    title,
    overview,
    sections
  };
}

function firstMeaningfulPointText(sections: SummarySection[]): string {
  for (const section of sections) {
    for (const point of section.points) {
      const text = firstMeaningfulPointTextFromPoint(point);
      if (text) return text;
    }
  }
  return "";
}

function firstMeaningfulPointTextFromPoint(point: SummaryPoint): string {
  if (isMeaningfulSummaryText(point.text)) return point.text.trim();
  for (const child of point.children ?? []) {
    const text = firstMeaningfulPointTextFromPoint(child);
    if (text) return text;
  }
  return "";
}

function readSummarySections(value: Record<string, unknown>): SummarySection[] {
  const rows = readFirstArray(value, SECTION_KEYS);
  if (rows.length === 0) return [];

  return rows.map(normalizeSection).filter((section) => section.points.length > 0);
}

function normalizeSection(value: unknown): SummarySection {
  if (typeof value === "string") return { title: "要点", points: [{ text: value.trim() }] };
  if (!isRecord(value)) return { title: "要点", points: [] };

  const pointRows = readFirstArray(value, SECTION_POINT_KEYS);
  const points = pointRows.map(normalizePoint).filter(BooleanPoint);
  const fallbackText = readFirstString(value, SECTION_FALLBACK_TEXT_KEYS, "");

  return {
    title: readFirstString(value, SECTION_TITLE_KEYS, "要点"),
    points: points.length > 0 ? points : fallbackText ? [{ text: fallbackText }] : []
  };
}

function normalizePoint(value: unknown): SummaryPoint {
  if (typeof value === "string") return { text: value.trim() };
  if (!isRecord(value)) return { text: "" };

  const children = readFirstArray(value, POINT_CHILD_KEYS)
    .map(normalizePoint)
    .filter(BooleanPoint);

  return {
    text: readFirstString(value, POINT_TEXT_KEYS, ""),
    ...(children.length > 0 ? { children } : {})
  };
}

function BooleanPoint(point: SummaryPoint): boolean {
  return hasMeaningfulSummaryPoint(point);
}

function readFirstString(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function readFirstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeOverviewText(value: string): string {
  return value.replace(/^(?:总结|概览|总览)\s*[:：]\s*/u, "").trim();
}
