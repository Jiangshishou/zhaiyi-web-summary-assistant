import { isRecord } from "./jsonRead";
import type { SummaryPoint, SummaryResult, SummarySection } from "./types";

export type SummaryStreamEvent =
  | { type: "overview_delta"; text: string }
  | { type: "section"; index: number; title: string }
  | { type: "point"; section: number; index: number; text: string }
  | { type: "child"; section: number; point: number; index: number; text: string }
  | { type: "final"; summary: SummaryResult };

export interface SummaryStreamDraft {
  overview: string;
  sections: SummarySection[];
  finalSummary?: SummaryResult;
}

export function parseSummaryStreamEventLine(line: string, options?: { strict?: boolean }): SummaryStreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;

  // Truncated JSON detected
  if (!trimmed.endsWith("}")) {
    // Strict mode: fail fast ONLY for stream events (containing "type":)
    // Let plain JSON truncation fall through to recovery logic
    if (options?.strict && trimmed.includes('"type":')) {
      throw new Error(`模型返回的摘要 JSON 无法解析：流式事件 JSON 不完整。截断内容预览：${trimmed.slice(0, 200)}`);
    }
    // Non-strict mode or plain JSON: return undefined
    return undefined;
  }

  try {
    return normalizeSummaryStreamEvent(JSON.parse(trimmed) as unknown);
  } catch (error) {
    const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
    const message = `模型返回的摘要 JSON 无法解析：流式事件 JSON 格式错误。内容预览：${preview}`;
    // Strict mode: throw with preview
    if (options?.strict) {
      throw new Error(message, { cause: error });
    }
    // Non-strict mode: return undefined
    return undefined;
  }
}

export function parseSummaryStreamEvents(buffer: string, options?: { strict?: boolean }): SummaryStreamEvent[] {
  const events: SummaryStreamEvent[] = [];
  const lines = buffer.split(/\r?\n/u);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    try {
      const event = parseSummaryStreamEventLine(line, options);
      if (event) events.push(event);
    } catch {
      // 严格模式下流式事件截断 - 尝试从截断行提取 text 字段
      const trimmed = line.trim();
      if (options?.strict && trimmed.includes('"text":"')) {
        const textMatch = trimmed.match(/"text":"([^"]*)$/);
        if (textMatch?.[1]) {
          events.push({ type: "overview_delta", text: textMatch[1] });
        }
      }
      // 截断后续行无法解析，停止
      break;
    }
  }
  return events;
}

export function buildSummaryDraftFromEvents(events: SummaryStreamEvent[]): SummaryStreamDraft | undefined {
  const draft: SummaryStreamDraft = { overview: "", sections: [] };
  let changed = false;

  for (const event of events) {
    switch (event.type) {
      case "overview_delta":
        draft.overview += event.text;
        changed = changed || event.text.trim().length > 0;
        break;
      case "section":
        draft.sections[event.index] = {
          title: event.title,
          points: draft.sections[event.index]?.points ?? []
        };
        changed = true;
        break;
      case "point": {
        const section = ensureSection(draft.sections, event.section);
        section.points[event.index] = {
          text: event.text,
          children: section.points[event.index]?.children
        };
        changed = true;
        break;
      }
      case "child": {
        const section = ensureSection(draft.sections, event.section);
        const point = ensurePoint(section.points, event.point);
        const children = point.children ?? [];
        children[event.index] = { text: event.text };
        point.children = children;
        changed = true;
        break;
      }
      case "final":
        draft.finalSummary = event.summary;
        changed = true;
        break;
    }
  }

  draft.sections = draft.sections.filter(BooleanSection);
  for (const section of draft.sections) {
    section.points = section.points.filter(BooleanPoint);
    for (const point of section.points) {
      if (point.children) point.children = point.children.filter(BooleanPoint);
    }
  }
  return changed ? draft : undefined;
}

function normalizeSummaryStreamEvent(value: unknown): SummaryStreamEvent | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "overview_delta":
      return typeof value.text === "string" ? { type: "overview_delta", text: value.text } : undefined;
    case "section":
      return readIndex(value.index) !== undefined && typeof value.title === "string"
        ? { type: "section", index: readIndex(value.index)!, title: value.title }
        : undefined;
    case "point":
      return readIndex(value.section) !== undefined && readIndex(value.index) !== undefined && typeof value.text === "string"
        ? { type: "point", section: readIndex(value.section)!, index: readIndex(value.index)!, text: value.text }
        : undefined;
    case "child":
      return readIndex(value.section) !== undefined && readIndex(value.point) !== undefined && readIndex(value.index) !== undefined && typeof value.text === "string"
        ? { type: "child", section: readIndex(value.section)!, point: readIndex(value.point)!, index: readIndex(value.index)!, text: value.text }
        : undefined;
    case "final":
      return normalizeSummaryResult(value.summary);
    default:
      return undefined;
  }
}

function normalizeSummaryResult(value: unknown): SummaryStreamEvent | undefined {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.overview !== "string" || !Array.isArray(value.sections)) return undefined;
  const sections = value.sections.map(normalizeSection).filter(BooleanSection);
  return { type: "final", summary: { title: value.title, overview: value.overview, sections } };
}

function normalizeSection(value: unknown): SummarySection | undefined {
  if (!isRecord(value) || typeof value.title !== "string" || !Array.isArray(value.points)) return undefined;
  return { title: value.title, points: value.points.map(normalizePoint).filter(BooleanPoint) };
}

function normalizePoint(value: unknown): SummaryPoint | undefined {
  if (!isRecord(value) || typeof value.text !== "string") return undefined;
  const children = Array.isArray(value.children) ? value.children.map(normalizePoint).filter(BooleanPoint) : undefined;
  return children?.length ? { text: value.text, children } : { text: value.text };
}

function ensureSection(sections: SummarySection[], index: number): SummarySection {
  sections[index] ??= { title: "生成中", points: [] };
  return sections[index]!;
}

function ensurePoint(points: SummaryPoint[], index: number): SummaryPoint {
  points[index] ??= { text: "生成中" };
  return points[index]!;
}

function readIndex(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 ? value : undefined;
}

function BooleanSection(section: SummarySection | undefined): section is SummarySection {
  return Boolean(section);
}

function BooleanPoint(point: SummaryPoint | undefined): point is SummaryPoint {
  return Boolean(point);
}
