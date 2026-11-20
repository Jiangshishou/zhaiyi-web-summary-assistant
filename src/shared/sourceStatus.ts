import type { SourceExtractionDiagnostics, SourceExtractionStage, SourceKind } from "./types";

export function sourceDiagnosticsNeedAttention(
  diagnostics: SourceExtractionDiagnostics | undefined,
  sourceKind?: SourceKind
): boolean {
  if (!diagnostics) return sourceKind === "fallback";
  return Boolean(
    diagnostics.lowConfidence ||
    sourceKind === "fallback" ||
    diagnostics.stages.some((stage) => stage.status === "warning" || stage.status === "failed")
  );
}

export function diagnosticStatusLabel(status: SourceExtractionStage["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "warning":
      return "注意";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
  }
}
