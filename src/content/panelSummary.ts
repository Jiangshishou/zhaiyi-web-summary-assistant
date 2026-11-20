import { formatDuration } from "../shared/numberFormat";
import type { PageCache, SummaryPoint } from "../shared/types";

export function stripOverviewLabel(value: string): string {
  return value.replace(/^(?:总结|概览|总览)\s*[:：]\s*/u, "").trim();
}

export function cloneSummaryPoints(points: SummaryPoint[]): SummaryPoint[] {
  return points.map((point) => ({
    text: point.text,
    ...(point.children?.length ? { children: cloneSummaryPoints(point.children) } : {})
  }));
}

export function formatSummaryMarkdown(cache?: PageCache, fallbackTitle = "当前页面"): string {
  const summary = cache?.summary;
  if (!summary) return "";

  const title = normalizeMarkdownLine(summary.title || cache?.source.title || fallbackTitle || "当前页面");
  const overview = normalizeMarkdownBlock(stripOverviewLabel(summary.overview));
  const lines = [`# ${title}`];
  appendSourceMetadata(lines, cache, fallbackTitle);

  if (overview) {
    lines.push("", overview);
  }

  for (const section of summary.sections) {
    const sectionTitle = normalizeMarkdownLine(section.title);
    if (sectionTitle) {
      lines.push("", `## ${sectionTitle}`);
    }
    appendMarkdownPoints(lines, section.points, 0);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendSourceMetadata(lines: string[], cache: PageCache, fallbackTitle: string): void {
  const source = cache.source;
  lines.push("", "## 来源");
  lines.push(`- 标题：${normalizeMarkdownLine(source.title || fallbackTitle || "当前页面")}`);
  lines.push(`- 链接：${normalizeMarkdownLine(source.url)}`);
  lines.push(`- 内容类型：${normalizeMarkdownLine(source.sourceKind)}`);
  if (cache.summaryMeta) {
    const generatedAt = new Date(cache.summaryMeta.generatedAt).toISOString();
    lines.push(`- 生成：${normalizeMarkdownLine(cache.summaryMeta.providerId)} / ${normalizeMarkdownLine(cache.summaryMeta.model)} / ${generatedAt}`);
  }
  const timing = formatSummaryTiming(cache);
  if (timing) lines.push(`- 耗时：${timing}`);
}

function appendMarkdownPoints(lines: string[], points: SummaryPoint[], depth: number): void {
  for (const point of points) {
    const text = normalizeMarkdownLine(point.text);
    if (text) {
      lines.push(`${"  ".repeat(depth)}- ${text}`);
    }
    if (point.children?.length) {
      appendMarkdownPoints(lines, point.children, depth + 1);
    }
  }
}

function formatSummaryTiming(cache: PageCache): string {
  const timing = cache.summaryMeta?.timing;
  if (!timing) return "";
  const parts = [`总计 ${formatDuration(timing.totalMs)}`];
  if (timing.providerFirstChunkMs !== undefined) parts.push(`首段 ${formatDuration(timing.providerFirstChunkMs)}`);
  if (timing.providerDurationMs !== undefined) parts.push(`服务商 ${formatDuration(timing.providerDurationMs)}`);
  if (timing.parseDurationMs !== undefined) parts.push(`解析 ${formatDuration(timing.parseDurationMs)}`);
  if (timing.mode) parts.push(`模式 ${timing.mode}`);
  if (timing.chunkCount !== undefined || timing.chunkConcurrency !== undefined) {
    parts.push(`分块 ${timing.chunkCount ?? "?"} 段，并发 ${timing.chunkConcurrency ?? "?"}`);
  }
  if (timing.chunkDurationMs !== undefined) parts.push(`分块耗时 ${formatDuration(timing.chunkDurationMs)}`);
  if (timing.synthesisDurationMs !== undefined) parts.push(`合成 ${formatDuration(timing.synthesisDurationMs)}`);
  return parts.join("、");
}

function normalizeMarkdownLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMarkdownBlock(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => normalizeMarkdownLine(line))
    .filter(Boolean)
    .join("\n");
}

/** 把标题清洗成安全文件名主干：替换非法字符、折叠空白、截断到 80 字，空则回退。 */
export function sanitizeFileTitle(title: string, fallback = "summary"): string {
  const safe = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return safe || fallback;
}

export function buildMarkdownFilename(title = "当前页面"): string {
  return `${sanitizeFileTitle(title, "summary")}.md`;
}
