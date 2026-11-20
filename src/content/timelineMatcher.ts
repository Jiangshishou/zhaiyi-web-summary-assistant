import type { SourceSegment } from "./sourceJump";
import { normalizeForMatch, matchScore, isBetterSegmentJumpCandidate, MAX_SOURCE_JUMP_SEGMENT_WINDOW, SEGMENT_MATCH_THRESHOLD } from "./sourceJump";

interface WindowEntry {
  segment: SourceSegment;
  normalizedText: string;
  textLength: number;
  windowSize: number;
}

/**
 * 预计算字幕段窗口的 timeline 匹配器。
 * 构造时一次性构建所有窗口归一化文本，查询时只做评分对比；
 * 同一 query 的结果缓存，tab 切换 re-render 时直接命中。
 */
export class TimelineMatcher {
  private readonly windows: WindowEntry[] = [];
  private readonly cache = new Map<string, SourceSegment | undefined>();

  constructor(segments: SourceSegment[]) {
    for (let start = 0; start < segments.length; start += 1) {
      let windowText = "";
      const limit = Math.min(segments.length, start + MAX_SOURCE_JUMP_SEGMENT_WINDOW);
      for (let end = start; end < limit; end += 1) {
        windowText += segments[end].text;
        const normalizedText = normalizeForMatch(windowText);
        this.windows.push({
          segment: segments[start],
          normalizedText,
          textLength: normalizedText.length,
          windowSize: end - start + 1
        });
      }
    }
  }

  match(text: string): SourceSegment | undefined {
    const query = normalizeForMatch(text);
    if (!query) return undefined;
    const cached = this.cache.get(query);
    if (cached !== undefined || this.cache.has(query)) return cached;

    let best: { score: number; segment: SourceSegment; textLength: number; windowSize: number } | undefined;
    for (const w of this.windows) {
      const candidate = {
        score: matchScore(query, w.normalizedText),
        segment: w.segment,
        textLength: w.textLength,
        windowSize: w.windowSize
      };
      if (isBetterSegmentJumpCandidate(candidate, best, query.length)) best = candidate;
    }
    const result = best && best.score >= SEGMENT_MATCH_THRESHOLD ? best.segment : undefined;
    this.cache.set(query, result);
    return result;
  }
}
