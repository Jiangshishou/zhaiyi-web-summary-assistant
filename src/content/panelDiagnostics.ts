import { DEEPSEEK_WEB_PROVIDER_ID } from "../shared/deepseekWeb";
import { diagnosticStatusLabel } from "../shared/sourceStatus";
import type { FullChainDiagnostic, FullChainStageName, FullChainStageRecord } from "./fullChainTrace";
import type { PageCache, ProviderId, ProviderSettings, Settings, SourcePayload } from "../shared/types";

interface DiagnosticPackageInput {
  cache?: PageCache;
  diagnostic?: FullChainDiagnostic;
  providerDiagnostics?: PanelProviderDiagnostics;
}

export function formatUserVisibleDiagnosticPackage(input: DiagnosticPackageInput): string {
  const { cache, diagnostic, providerDiagnostics } = input;
  if (!cache && !diagnostic) return "";

  const source = cache?.source;
  const page = diagnostic?.page ?? readSafePageIdentityFromUrl(source?.url);
  const lines = ["# 摘意诊断信息"];
  const version = readExtensionVersion();
  if (version) lines.push("", `插件版本：${version}`);
  if (page) lines.push(`页面：${page.host}${page.pathname}`);
  if (diagnostic?.traceId) lines.push(`追踪编号：${diagnostic.traceId}`);
  if (diagnostic?.route) lines.push(`处理路径：${diagnostic.route}`);
  const sourceKind = diagnostic?.sourceKind ?? source?.sourceKind;
  if (sourceKind) lines.push(`内容类型：${sourceKind}`);
  if (source?.title) lines.push(`来源标题：${source.title}`);
  if (source?.text !== undefined) lines.push(`来源字数：${source.text.length}`);

  const summaryLines = formatDiagnosticSummarySection(cache, providerDiagnostics);
  if (summaryLines.length) lines.push("", "## 摘要", ...summaryLines);

  if (diagnostic?.error) {
    lines.push("", "## 错误", `错误：${diagnostic.error.stage} - ${diagnostic.error.message}`);
    const providerErrorKind = classifyProviderErrorKind(diagnostic.error.message);
    if (providerErrorKind) lines.push(`错误类型：${providerErrorKind}`);
  }

  if (diagnostic?.stages && Object.keys(diagnostic.stages).length > 0) {
    lines.push("", "## 处理链路");
    for (const name of ["mount", "settings", "cache", "extraction", "summary", "render"] satisfies FullChainStageName[]) {
      const stage = diagnostic.stages[name];
      if (stage) lines.push(formatDiagnosticStageLine(name, stage));
    }
  }

  const sourceDiagnosticLines = source ? formatDiagnosticSourceSection(source) : [];
  if (sourceDiagnosticLines.length) lines.push("", "## 抽取详情", ...sourceDiagnosticLines);

  return lines.join("\n");
}

type PanelProviderEndpointMode = "deepseek-web" | "chat-completions" | "messages" | "unknown";

interface PanelProviderDiagnostics {
  origin?: string;
  endpointMode?: PanelProviderEndpointMode;
  streaming?: boolean;
}

function formatDiagnosticSummarySection(cache: PageCache | undefined, providerDiagnostics?: PanelProviderDiagnostics): string[] {
  const meta = cache?.summaryMeta;
  const timing = meta?.timing;
  const lines: string[] = [];
  if (meta?.providerId || meta?.model) {
  lines.push(`服务商：${meta.providerId || "unknown"} / ${meta.model || "unknown"}`);
  }
  if (providerDiagnostics) {
    const providerFacts = [
      providerDiagnostics.origin ? `origin=${providerDiagnostics.origin}` : "",
      providerDiagnostics.endpointMode ? `endpoint=${providerDiagnostics.endpointMode}` : "",
      providerDiagnostics.streaming !== undefined ? `streaming=${providerDiagnostics.streaming ? "yes" : "no"}` : ""
    ].filter(Boolean);
  if (providerFacts.length) lines.push(`服务商诊断：${providerFacts.join("；")}`);
  }
  if (!timing) return lines;
  if (timing.mode) lines.push(`模式：${timing.mode}`);
  lines.push(`总计：${formatDiagnosticMs(timing.totalMs)}`);
  if (timing.providerFirstChunkMs !== undefined) lines.push(`首段：${formatDiagnosticMs(timing.providerFirstChunkMs)}`);
  if (timing.providerDurationMs !== undefined) lines.push(`服务商耗时：${formatDiagnosticMs(timing.providerDurationMs)}`);
  if (timing.parseDurationMs !== undefined) lines.push(`解析：${formatDiagnosticMs(timing.parseDurationMs)}`);
  if (timing.chunkCount !== undefined || timing.chunkConcurrency !== undefined) {
    lines.push(`分块：${timing.chunkCount ?? "unknown"} 段，并发 ${timing.chunkConcurrency ?? "unknown"}`);
  }
  if (timing.chunkDurationMs !== undefined) lines.push(`分块耗时：${formatDiagnosticMs(timing.chunkDurationMs)}`);
  if (timing.synthesisDurationMs !== undefined) lines.push(`合成：${formatDiagnosticMs(timing.synthesisDurationMs)}`);
  return lines;
}

function formatDiagnosticStageLine(name: FullChainStageName, stage: FullChainStageRecord): string {
  const parts = [stage.ok ? "ok" : "failed"];
  if (stage.hit !== undefined) parts.push(stage.hit ? "hit" : "miss");
  if (stage.route) parts.push(stage.route);
  parts.push(formatDiagnosticMs(stage.durationMs));
  return `- ${name}：${parts.join("，")}`;
}

// 模型输出解析类失败的报错文本里可能带模型返回的散文内容，若照常做子串匹配会被误判成
// provider 故障（google-docs 事故：散文含「连接至」→ 被标成 network）。
// 以下片段与 src/background/modelSummary.ts、src/background/summarizer.ts 的抛错文案对应。
const MODEL_OUTPUT_PARSE_FAILURE_REGEX =
  /模型返回的摘要 JSON 无法解析|模型返回的摘要不是对象|补全请求仍缺少有效 sections\/points|缺少 final\.summary|模型仅返回占位摘要/u;

function classifyProviderErrorKind(message: string): string {
  if (MODEL_OUTPUT_PARSE_FAILURE_REGEX.test(message)) return "";
  const normalized = message.toLowerCase();
  if (/(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/u.test(normalized)) return "rate-limit";
  if (/quota|insufficient_quota|billing|余额|额度|配额/u.test(normalized)) return "quota";
  if (/network|failed to fetch|timeout|timed out|econnreset|enotfound|连接|网络/u.test(normalized)) return "network";
  if (/(?:^|\D)(401|403)(?:\D|$)|unauthorized|forbidden|api key|认证|鉴权|权限/u.test(normalized)) return "auth";
  return "";
}

export function buildPanelProviderDiagnostics(
  providerId: ProviderId | undefined,
  providers: ProviderSettings | undefined,
  settings: Settings | undefined
): PanelProviderDiagnostics | undefined {
  const id = providerId || settings?.defaultProvider;
  if (!id) return undefined;
  const config = providers?.[id];
  const origin = panelProviderOrigin(config?.baseUrl);
  const diagnostics: PanelProviderDiagnostics = {
    ...(origin ? { origin } : {}),
    endpointMode: panelProviderEndpointMode(id, config?.baseUrl),
    streaming: panelProviderStreaming(id, config)
  };
  return diagnostics.origin || diagnostics.endpointMode || diagnostics.streaming !== undefined ? diagnostics : undefined;
}

function panelProviderOrigin(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

function panelProviderEndpointMode(providerId: ProviderId, baseUrl: string | undefined): PanelProviderEndpointMode {
  if (providerId === DEEPSEEK_WEB_PROVIDER_ID) return "deepseek-web";
  const path = readProviderUrlPath(baseUrl);
  if (!path) return baseUrl?.trim() ? "chat-completions" : "unknown";
  if (/\/v1\/messages$/iu.test(path)) return "messages";
  if (/\/v1(?:\/chat\/completions)?$/iu.test(path)) return "chat-completions";
  return "chat-completions";
}

function panelProviderStreaming(providerId: ProviderId, config: ProviderSettings[ProviderId] | undefined): boolean | undefined {
  if (providerId === DEEPSEEK_WEB_PROVIDER_ID || config) return true;
  return undefined;
}

function readProviderUrlPath(baseUrl: string | undefined): string {
  if (!baseUrl?.trim()) return "";
  try {
    return new URL(baseUrl).pathname.replace(/\/+$/u, "");
  } catch {
    return baseUrl.trim().replace(/[?#].*$/u, "").replace(/\/+$/u, "");
  }
}

function formatDiagnosticSourceSection(source: SourcePayload): string[] {
  const diagnostics = source.extractionDiagnostics;
  const lines = [`低置信：${diagnostics?.lowConfidence ? "是" : "否"}`];
  for (const stage of diagnostics?.stages ?? []) {
    lines.push(`- ${stage.label}：${diagnosticStatusLabel(stage.status)}${stage.detail ? `。${stage.detail}` : ""}`);
    for (const fact of stage.facts ?? []) {
      lines.push(`  - ${fact.label}：${fact.value}`);
    }
  }
  return diagnostics?.stages.length || diagnostics?.lowConfidence ? lines : [];
}

function formatDiagnosticMs(value: number): string {
  return `${Math.round(value)} ms`;
}

function readSafePageIdentityFromUrl(value: string | undefined): { host: string; pathname: string } | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return { host: url.host, pathname: url.pathname || "/" };
  } catch {
    return undefined;
  }
}

function readExtensionVersion(): string | undefined {
  try {
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: { getManifest?: () => { version?: string } } };
    }).chrome?.runtime;
    const version = runtime?.getManifest?.().version;
    return version || undefined;
  } catch {
    return undefined;
  }
}
