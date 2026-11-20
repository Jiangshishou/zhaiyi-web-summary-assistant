import type { SummaryPoint, SummaryResult, SummarySection } from "./types";

const PLACEHOLDER_SUMMARY_TEXT = new Set([
  "暂无",
  "暂无总览",
  "暂无概览",
  "暂无摘要",
  "暂无内容",
  "无可用总览",
  "无可用概览",
  "无可用摘要",
  "无可用内容",
  "没有可用总览",
  "没有可用概览",
  "没有可用摘要",
  "没有可用内容",
  "无法生成总览",
  "无法生成概览",
  "无法生成摘要",
  "内容不足"
]);

export function hasMeaningfulSummary(summary: SummaryResult): boolean {
  return isMeaningfulSummaryText(summary.overview) || summary.sections.some((section) =>
    section.points.some(hasMeaningfulSummaryPoint)
  );
}

export function hasAnySummaryText(summary: SummaryResult): boolean {
  return Boolean(summary.overview.trim()) || summary.sections.some((section) =>
    section.points.some(hasAnySummaryPoint)
  );
}

export function hasSummaryTree(summary: SummaryResult): boolean {
  return summary.sections.some((section) => section.points.length > 0);
}

export function hasMeaningfulSummaryPoint(point: SummaryPoint): boolean {
  return isMeaningfulSummaryText(point.text) || Boolean(point.children?.some(hasMeaningfulSummaryPoint));
}

export function removeOverviewDuplicatePoints(sections: SummarySection[], overview: string): SummarySection[] {
  if (!isMeaningfulSummaryText(overview)) return sections;
  const normalizedOverview = overview.trim();
  return sections
    .map((section) => ({
      ...section,
      points: section.points.filter((point) => point.text.trim() !== normalizedOverview || Boolean(point.children?.length))
    }))
    .filter((section) => section.points.length > 0);
}

export function mergeSummaryWithMeaningfulFallback(summary: SummaryResult, fallback?: SummaryResult): SummaryResult {
  const overview = isMeaningfulSummaryText(summary.overview)
    ? summary.overview
    : fallback && isMeaningfulSummaryText(fallback.overview)
      ? fallback.overview
      : summary.overview;
  const primarySections = meaningfulSummarySectionEntries(summary.sections);
  const fallbackSections = fallback ? meaningfulSummarySectionEntries(fallback.sections) : [];
  if (
    !fallback &&
    isMeaningfulSummaryText(summary.overview) &&
    summary.sections.length > 0 &&
    primarySections.length === summary.sections.length &&
    primarySections.every(({ section }, index) => section === summary.sections[index])
  ) {
    return summary;
  }
  const fallbackSectionsByIndex = new Map(fallbackSections.map(({ index, section }) => [index, section]));
  const reconciledSections = primarySections.length > 0
    ? primarySections.map(({ index, section }) => mergeSummarySectionChildren(section, fallbackSectionsByIndex.get(index)))
    : fallbackSections.map(({ section }) => section);
  const sections = reconciledSections;

  return overview === summary.overview && sections === summary.sections
    ? summary
    : { ...summary, overview, sections };
}

function hasAnySummaryPoint(point: SummaryPoint): boolean {
  return Boolean(point.text.trim()) || Boolean(point.children?.some(hasAnySummaryPoint));
}

function meaningfulSummarySectionEntries(sections: SummarySection[]): Array<{ index: number; section: SummarySection }> {
  return sections
    .map((section, index) => {
      const points = section.points.map(meaningfulSummaryPoint).filter(isSummaryPoint);
      if (points.length === 0) return undefined;
      return points.length === section.points.length && points.every((point, pointIndex) => point === section.points[pointIndex])
        ? { index, section }
        : { index, section: { ...section, points } };
    })
    .filter(isIndexedSummarySection);
}

function meaningfulSummaryPoint(point: SummaryPoint): SummaryPoint | undefined {
  const children = point.children?.map(meaningfulSummaryPoint).filter(isSummaryPoint);
  if (!isMeaningfulSummaryText(point.text) && !children?.length) return undefined;
  if (!children?.length) return point.children ? { ...point, children: undefined } : point;
  return { ...point, children };
}

function mergeSummarySectionChildren(primary: SummarySection, fallback?: SummarySection): SummarySection {
  if (!fallback) return primary;
  const points = primary.points.map((point, pointIndex) => {
    const fallbackPoint = fallback.points[pointIndex];
    if (point.children?.length || !fallbackPoint?.children?.length) return point;
    return { ...point, children: cloneSummaryPoints(fallbackPoint.children) };
  });
  return { ...primary, points };
}

function cloneSummaryPoints(points: SummaryPoint[]): SummaryPoint[] {
  return points.map((point) => ({
    ...point,
    ...(point.children?.length ? { children: cloneSummaryPoints(point.children) } : {})
  }));
}

function isIndexedSummarySection(
  value: { index: number; section: SummarySection } | undefined
): value is { index: number; section: SummarySection } {
  return Boolean(value);
}

function isSummaryPoint(value: SummaryPoint | undefined): value is SummaryPoint {
  return Boolean(value);
}

export function isMeaningfulSummaryText(value: string): boolean {
  const normalized = normalizeSummaryQualityText(value);
  return Boolean(normalized) && !PLACEHOLDER_SUMMARY_TEXT.has(normalized);
}

function normalizeSummaryQualityText(value: string): string {
  return value
    .trim()
    .replace(/^(?:总结|概览|总览|摘要)\s*[:：]\s*/u, "")
    .replace(/[\s`"'“”‘’.,，。！？:：;；、…]+/gu, "")
    .trim();
}

/**
 * 用 JSONL 事件流构建的 draft 对 final.summary 做 schema diff 校验和补充。
 *
 * 问题：模型输出的 final.summary 有时会丢失 JSONL 事件流中已输出过的内容
 * （overview 截断、整节丢失、point/children 缺失）。
 * 此函数按 index 逐层比对 draft（事件流重建）与 final（模型 final 事件），
 * 发现 final 有缺失时从 draft 补充，不改动 final 已正确输出的内容。
 */
export function reconcileSummaryWithStreamDraft(
  final: SummaryResult,
  draft: SummaryResult
): SummaryResult {
  const overview = reconcileOverview(final.overview, draft.overview);
  const sections = reconcileSections(final.sections, draft.sections);
  return overview === final.overview && sections === final.sections
    ? final
    : { ...final, overview, sections };
}

/**
 * 统一的 summary finalization pipeline：
 * mergeSummaryWithMeaningfulFallback（overview fallback）+
 * reconcileSummaryWithStreamDraft（section/point/children schema diff）。
 * 供 background parseSummaryOutput 和 content summaryStreamAssembler 共用。
 */
export function finalizeSummary(
  summary: SummaryResult,
  draft: SummaryResult
): SummaryResult {
  const merged = mergeSummaryWithMeaningfulFallback(summary, draft);
  return reconcileSummaryWithStreamDraft(merged, draft);
}

/**
 * overview diff：draft overview 明显更长或内容更多时采用 draft
 */
function reconcileOverview(finalOverview: string, draftOverview: string): string {
  if (!isMeaningfulSummaryText(draftOverview)) return finalOverview;
  if (!isMeaningfulSummaryText(finalOverview)) return draftOverview;
  // draft 长度 > final * 1.3 且 final 不是 draft 的子串 → 用 draft
  // （长度阈值避免 final 仅差几个字也被替换）
  if (
    draftOverview.length > finalOverview.length * 1.3 &&
    !draftOverview.includes(finalOverview.trim())
  ) {
    return draftOverview;
  }
  return finalOverview;
}

/**
 * sections diff：按 index 逐层比对
 */
function reconcileSections(
  finalSections: SummarySection[],
  draftSections: SummarySection[]
): SummarySection[] {
  if (draftSections.length === 0) return finalSections;
  const maxLen = Math.max(finalSections.length, draftSections.length);
  let changed = false;
  const result: SummarySection[] = [];
  for (let i = 0; i < maxLen; i++) {
    const fs = finalSections[i];
    const ds = draftSections[i];
    if (fs && ds) {
      // 两者 index 对齐 → 递归合并 points
      const points = reconcilePoints(fs.points, ds.points, ds.title);
      if (points !== fs.points) {
        result.push({ ...fs, points });
        changed = true;
      } else {
        result.push(fs);
      }
    } else if (ds) {
      // final 缺失整个 section → 从 draft 补充
      result.push(deepCloneSection(ds));
      changed = true;
    } else {
      // draft 无此 section → 保留 final
      result.push(fs!);
    }
  }
  return changed ? result : finalSections;
}

/**
 * points diff：按 index 逐层比对，sectionTitle 用于日志上下文
 */
function reconcilePoints(
  finalPoints: SummaryPoint[],
  draftPoints: SummaryPoint[],
  _sectionTitle: string
): SummaryPoint[] {
  if (draftPoints.length === 0) return finalPoints;
  const maxLen = Math.max(finalPoints.length, draftPoints.length);
  let changed = false;
  const result: SummaryPoint[] = [];
  for (let i = 0; i < maxLen; i++) {
    const fp = finalPoints[i];
    const dp = draftPoints[i];
    if (fp && dp) {
      // 两者都有 → 合并 children
      const children = reconcileChildren(fp.children, dp.children);
      if (children !== fp.children) {
        result.push({ ...fp, children });
        changed = true;
      } else {
        result.push(fp);
      }
    } else if (dp) {
      // final 缺失该 point → 从 draft 补充
      result.push(deepClonePoint(dp));
      changed = true;
    } else {
      // draft 无此 point → 保留 final
      result.push(fp!);
    }
  }
  return changed ? result : finalPoints;
}

/**
 * children diff：按 index 逐层比对
 */
function reconcileChildren(
  finalChildren: SummaryPoint[] | undefined,
  draftChildren: SummaryPoint[] | undefined
): SummaryPoint[] | undefined {
  if (!draftChildren?.length) return finalChildren;
  if (!finalChildren?.length) return deepClonePoints(draftChildren);
  const maxLen = Math.max(finalChildren.length, draftChildren.length);
  let changed = false;
  const result: SummaryPoint[] = [];
  for (let i = 0; i < maxLen; i++) {
    const fc = finalChildren[i];
    const dc = draftChildren[i];
    if (fc && dc) {
      const text = fc.text.length >= dc.text.length ? fc.text : dc.text;
      const children = reconcileChildren(fc.children, dc.children);
      if (text !== fc.text || children !== fc.children) changed = true;
      result.push({ text, ...(children ? { children } : {}) });
    } else if (dc) {
      result.push(deepClonePoint(dc));
      changed = true;
    } else {
      result.push(fc!);
    }
  }
  return changed ? result : finalChildren;
}

function deepCloneSection(section: SummarySection): SummarySection {
  return {
    title: section.title,
    points: section.points.map(deepClonePoint)
  };
}

function deepClonePoint(point: SummaryPoint): SummaryPoint {
  return {
    text: point.text,
    ...(point.children?.length ? { children: deepClonePoints(point.children) } : {})
  };
}

function deepClonePoints(points: SummaryPoint[]): SummaryPoint[] {
  return points.map(deepClonePoint);
}
