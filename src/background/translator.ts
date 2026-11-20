import type { CompletionProvider } from "./summarizer";
import { parseModelJson } from "./modelJson";
import { isRecord } from "../shared/jsonRead";
import type {
  ProviderConfig,
  SubtitleSegment,
  SubtitleTranslationTarget,
  TranslatedSubtitleSegment
} from "../shared/types";

const MAX_BATCH_SEGMENTS = 80;
const MAX_BATCH_CHARS = 7000;

export async function translateSubtitles(
  provider: CompletionProvider,
  config: ProviderConfig,
  sourceTitle: string,
  segments: SubtitleSegment[],
  targetLanguage: SubtitleTranslationTarget
): Promise<{ segments: TranslatedSubtitleSegment[]; targetLanguage: SubtitleTranslationTarget }> {
  const translated: TranslatedSubtitleSegment[] = segments.map((segment) => ({
    ...segment,
    translatedText: segment.text
  }));
  const translatableSegments = segments
    .map((segment, index) => ({ index, segment }))
    .filter((item) => item.segment.text.trim());

  for (const batch of splitSubtitleBatches(translatableSegments)) {
    const raw = await provider.complete(config, buildTranslationRequest(sourceTitle, batch, targetLanguage));
    const rows = parseTranslationJson(raw);
    const byIndex = new Map(rows.map((row) => [row.index, row.text]));

    for (const item of batch) {
      const translatedText = byIndex.get(item.index)?.trim() || item.segment.text;
      translated[item.index] = { ...item.segment, translatedText };
    }
  }

  return { segments: translated, targetLanguage };
}

function splitSubtitleBatches(segments: Array<{ index: number; segment: SubtitleSegment }>): Array<Array<{ index: number; segment: SubtitleSegment }>> {
  const batches: Array<Array<{ index: number; segment: SubtitleSegment }>> = [];
  let current: Array<{ index: number; segment: SubtitleSegment }> = [];
  let currentChars = 0;

  segments.forEach((item) => {
    const nextChars = item.segment.text.length;
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_SEGMENTS || currentChars + nextChars > MAX_BATCH_CHARS)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += nextChars;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}

function buildTranslationRequest(
  sourceTitle: string,
  batch: Array<{ index: number; segment: SubtitleSegment }>,
  targetLanguage: SubtitleTranslationTarget
) {
  const targetLabel = targetLanguage === "zh-Hans" ? "简体中文" : "English";
  return {
    system: [
      "你是字幕翻译助手。",
      "只翻译 text 字段，保留 index 顺序和数量。",
      "不要总结，不要改写时间，不要输出 Markdown。",
      "必须输出严格 JSON：{\"translations\":[{\"index\":0,\"text\":\"...\"}]}。"
    ].join("\n"),
    user: `请把以下字幕翻译为${targetLabel}。\n\n标题：${sourceTitle}\n\n字幕 JSON：\n${JSON.stringify({
      subtitles: batch.map((item) => ({
        index: item.index,
        text: item.segment.text
      }))
    })}`,
    expectJson: true
  };
}

function parseTranslationJson(raw: string): Array<{ index: number; text: string }> {
  const parsed = parseModelJson(raw, {
    prefer: (value) => readTranslationRows(value).length > 0,
    errorPrefix: "模型返回的字幕翻译 JSON 无法解析"
  });
  const rows = readTranslationRows(parsed);

  if (rows.length === 0) {
    throw new Error("模型返回的字幕翻译为空");
  }

  return rows;
}

function readTranslationRows(value: unknown): Array<{ index: number; text: string }> {
  const rows = readTranslationRowArray(value);
  if (rows.length === 0) return readTranslationMap(value);

  return rows
    .map((row) => {
      if (!isRecord(row)) return undefined;
      const rawIndex = row.index ?? row.id ?? row.lineIndex ?? row.line_index ?? row.line;
      const index = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
      const text = readTranslatedText(row);
      if (!Number.isInteger(index) || !text.trim()) return undefined;
      return { index, text: text.trim() };
    })
    .filter((row): row is { index: number; text: string } => row !== undefined);
}

function readTranslationRowArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["translations", "subtitles", "translatedSubtitles", "translated_subtitles", "items", "rows"]) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows;
  }
  for (const key of ["result", "data", "output"]) {
    const rows = readTranslationRowArray(value[key]);
    if (rows.length > 0) return rows;
  }
  return [];
}

function readTranslationMap(value: unknown): Array<{ index: number; text: string }> {
  const map = readTranslationMapRecord(value);
  if (!map) return [];
  return Object.entries(map)
    .map(([key, rawText]) => {
      const index = Number(key);
      const text = typeof rawText === "string" ? rawText.trim() : "";
      if (!Number.isInteger(index) || !text) return undefined;
      return { index, text };
    })
    .filter((row): row is { index: number; text: string } => row !== undefined);
}

function readTranslationMapRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["translations", "subtitles", "translatedSubtitles", "translated_subtitles"]) {
    const candidate = value[key];
    if (isRecord(candidate) && !Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

function readTranslatedText(row: Record<string, unknown>): string {
  for (const key of ["text", "translation", "translated", "translatedText", "translated_text", "targetText", "target_text", "target", "content", "value"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

