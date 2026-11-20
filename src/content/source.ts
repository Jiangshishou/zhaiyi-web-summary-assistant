import { extractReadableDocument, isDashboardDocument } from "./extract";
import { classifySourcePage } from "./sourcePlatform";
import { extractVideoTranscript } from "./transcripts";
import type { SourceExtractionStage, SourcePayload } from "../shared/types";

// 稳定化重读常量(见 design.md 决策 2;仅 dashboard 命中 + 刷新路径触发)
const STABILIZATION_DELAY_MS = 350;
const STABILIZATION_MIN_GROWTH = 200;
const MAX_STABILIZATION_ROUNDS = 2;

export async function extractCurrentSource(options?: { stabilize?: boolean }): Promise<SourcePayload> {
  const pageUrl = location.href;
  const classification = classifySourcePage(pageUrl);
  if (classification.transcriptCandidate) {
    const transcript = await safeExtractTranscript(pageUrl, classification);
    if (transcript.source) return transcript.source;
    return buildFallbackSource(pageUrl, transcript.stage);
  }

  const readable = await extractReadableDocument(document, pageUrl);
  if (!options?.stabilize) return readable;

  // dashboard 稳定化:doc 级判定(chart+heading)即可触发,不依赖欠采 ratio
  // ratio 是"最终欠采"信号,不是"该不该等 hydrate"信号(见 design.md 决策 1/2)
  if (!isDashboardDocument(document)) return readable;

  let stable = readable;
  let prevLen = stable.text.length;
  let rounds = 0;
  for (; rounds < MAX_STABILIZATION_ROUNDS; rounds++) {
    await new Promise<void>((resolve) => setTimeout(resolve, STABILIZATION_DELAY_MS));
    const reread = await extractReadableDocument(document, pageUrl);
    const len = reread.text.length;
    stable = reread;
    if (len - prevLen < STABILIZATION_MIN_GROWTH) break;
    prevLen = len;
  }

  // 稳定化后仍欠采?判定:visible 含 stable 没有的实质行(内容差,非长度差
  // —— stable 的 markdown 符号会让它比纯文本长,长度差不靠谱,见切片4 debug)
  const visible = readVisibleText(document);
  const stableNorm = stable.text.replace(/[#*\n\s]+/gu, " ").toLowerCase();
  const visibleDiff = visible.split("\n")
    .filter((line) => line.trim() && !stableNorm.includes(line.replace(/\s+/gu, " ").toLowerCase()))
    .join("\n");
  const undercapture = visibleDiff.length > 20;
  if (!undercapture) return stable;

  const supplement = `\n\n[页面可见文本补充]\n${visible}`;
  return withDashboardStage(
    { ...stable, text: stable.text + supplement, sourceMarkdown: (stable.sourceMarkdown ?? stable.text) + supplement },
    rounds, readable.text.length, stable.text.length, true
  );
}

/**
 * dashboard 降级:拼装 csr-dashboard warning stage + lowConfidence,不动 sourceKind
 */
function withDashboardStage(source: SourcePayload, rounds: number, firstLen: number, stableLen: number, supplemented: boolean): SourcePayload {
  const existingStages = source.extractionDiagnostics?.stages ?? [];
  const dashboardStage: SourceExtractionStage = {
    id: "csr-dashboard",
    status: "warning",
      label: "图表页",
      detail: "检测到图表页面，正文可能不完整，已重新读取" + (supplemented ? "并补充可见文字" : ""),
    facts: [
      { label: "稳定化轮数", value: String(rounds) },
      { label: "首次长度", value: String(firstLen) },
      { label: "稳定后长度", value: String(stableLen) },
      { label: "可见文本补充", value: supplemented ? "是" : "否" }
    ]
  };
  return {
    ...source,
    extractionDiagnostics: {
      lowConfidence: true,
      stages: [...existingStages, dashboardStage]
    }
  };
}

/**
 * 可见文本补救(与 panel.ts readVisiblePageText 同语义;source 侧降级补充用)
 * 不从 panel.ts import:panel.ts 是 content script 入口,source 作为被引模块不反向依赖它
 */
function readVisibleText(doc: Document): string {
  const raw = typeof doc.body?.innerText === "string"
    ? doc.body.innerText
    : doc.body?.textContent ?? doc.documentElement?.textContent ?? "";
  return raw
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function safeExtractTranscript(
  pageUrl: string,
  classification: ReturnType<typeof classifySourcePage>
): Promise<{ source?: SourcePayload; stage: SourceExtractionStage }> {
  try {
    const source = await extractVideoTranscript(document, pageUrl, classification);
    return source
      ? { source, stage: transcriptSuccessStage(source) }
      : { stage: transcriptFailedStage("没有取到字幕。") };
  } catch (error) {
    console.warn("[YouMind] transcript extraction failed", pageUrl, error);
    return { stage: transcriptFailedStage(error instanceof Error ? error.message : String(error)) };
  }
}

async function buildFallbackSource(pageUrl: string, transcriptStage: SourceExtractionStage): Promise<SourcePayload> {
  const readable = await extractReadableDocument(document, pageUrl);
  // Fallback is communicated once via sourceKind "fallback" plus diagnostics;
  // do not also set a red warning line for the expected no-subtitle case.
  const readableStages = readable.extractionDiagnostics?.stages ?? [];
  const truncationStage = readableStages.find((stage) => stage.id === "truncation");
  return {
    ...readable,
    sourceKind: "fallback",
    extractionDiagnostics: {
      lowConfidence: true,
      stages: [
        transcriptStage,
        ...readableStages.filter((stage) => stage.id !== "truncation"),
        {
          id: "fallback",
          status: "warning",
      label: "退回正文",
      detail: "没有可用的视频字幕，已改用页面正文；可能包含视频简介、播放器或推荐内容。",
        },
        ...(truncationStage ? [truncationStage] : [])
      ]
    }
  };
}

function transcriptSuccessStage(source: SourcePayload): SourceExtractionStage {
  return {
    id: "transcript",
    status: "success",
    label: "字幕获取",
      detail: source.sourceKind === "bilibili-official-summary" ? "已读取 Bilibili 官方 AI 总结。" : "已读取视频字幕。",
    facts: [
      { label: "来源类型", value: source.sourceKind },
      { label: "文本长度", value: String(source.text.length) },
      ...(source.segments?.length ? [{ label: "时间段", value: String(source.segments.length) }] : []),
      ...(source.isAutoGenerated ? [{ label: "字幕类型", value: "自动生成" }] : [])
    ]
  };
}

function transcriptFailedStage(detail: string): SourceExtractionStage {
  return {
    id: "transcript",
    status: "failed",
    label: "字幕获取",
    detail
  };
}
