import { buildMarkdownFilename } from "./panelSummary";
import type { PageCache, SubtitleTranslationTarget, TranslatedSubtitleSegment } from "../shared/types";

export function buildSrtFilename(title = "字幕"): string {
  return buildMarkdownFilename(title).replace(/\.md$/u, ".srt");
}

export function formatSubtitlePlainText(
  segments: PageCache["source"]["segments"] | undefined,
  translatedSegments?: TranslatedSubtitleSegment[]
): string {
  if (!segments?.length) return "";
  return segments
    .map((segment, index) => `[${formatTimestamp(segment.start)}] ${visibleSubtitleText(segment.text, translatedSegments?.[index]?.translatedText)}`)
    .join("\n");
}

export function formatSubtitleSrt(
  segments: PageCache["source"]["segments"] | undefined,
  translatedSegments?: TranslatedSubtitleSegment[]
): string {
  if (!segments?.length) return "";
  return segments
    .map((segment, index) => {
      const next = segments[index + 1];
      const end = Number.isFinite(segment.end) && segment.end > segment.start
        ? segment.end
        : next?.start ?? segment.start + 2;
      return [
        String(index + 1),
        `${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(end)}`,
        visibleSubtitleText(segment.text, translatedSegments?.[index]?.translatedText)
      ].join("\n");
    })
    .join("\n\n");
}

function visibleSubtitleText(originalText: string, translatedText: string | undefined): string {
  return translatedText?.trim() || originalText;
}

function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function getSubtitleTranslationTarget(segments: Array<{ text: string }>): SubtitleTranslationTarget {
  return getSubtitleSourceLanguage(segments) === "zh-Hans" ? "en" : "zh-Hans";
}

export function getSubtitleTranslationTargets(segments: Array<{ text: string }>): SubtitleTranslationTarget[] {
  const sourceLanguage = getSubtitleSourceLanguage(segments);
  return (["zh-Hans", "en"] as SubtitleTranslationTarget[]).filter((target) => target !== sourceLanguage);
}

export function getSubtitleSourceLanguage(segments: Array<{ text: string }>): SubtitleTranslationTarget {
  return isMostlyChineseSubtitle(segments) ? "zh-Hans" : "en";
}

export function isSubtitleTranslationTarget(value: string): value is SubtitleTranslationTarget {
  return value === "zh-Hans" || value === "en";
}

function isMostlyChineseSubtitle(segments: Array<{ text: string }>): boolean {
  const sample = segments.map((segment) => segment.text).join("\n").slice(0, 1200);
  const chineseCount = (sample.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latinCount = (sample.match(/[A-Za-z]/gu) ?? []).length;
  return chineseCount > 0 && chineseCount >= latinCount;
}

export function isTranscriptSource(sourceKind: PageCache["source"]["sourceKind"]): boolean {
  return sourceKind === "youtube-transcript" || sourceKind === "bilibili-transcript" || sourceKind === "douyin-visible";
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const totalSec = Math.floor(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
