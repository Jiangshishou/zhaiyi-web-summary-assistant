import { sanitizeFileTitle } from "./panelSummary";

export interface SourceTextExport {
  content: string;
  filename: string;
  mime: string;
}

/** 正文导出文件名：沿用摘要的标题清洗，再按有没有 Markdown 直接决定扩展名。 */
export function buildSourceTextFilename(title: string | undefined, isMarkdown: boolean): string {
  const stem = sanitizeFileTitle(title ?? "", "当前页面");
  return `${stem}.${isMarkdown ? "md" : "txt"}`;
}

/**
 * 决定「正文」下载的内容、文件名与 MIME：有非空 Markdown 用 Markdown（.md），否则用纯文本（.txt）。
 * 复制正文与下载正文共用此解析器，保证两者拿到同一份内容。正文为空时返回 null，调用方静默不下载。
 */
export function resolveSourceTextExport(
  source: { title?: string; text?: string; sourceMarkdown?: string } | undefined,
  documentTitle = ""
): SourceTextExport | null {
  const markdown = source?.sourceMarkdown?.trim() ?? "";
  const isMarkdown = markdown.length > 0;
  const content = isMarkdown ? markdown : (source?.text ?? "").trim();
  if (!content) return null;
  const title = source?.title || documentTitle;
  return {
    content,
    filename: buildSourceTextFilename(title, isMarkdown),
    mime: isMarkdown ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8"
  };
}
