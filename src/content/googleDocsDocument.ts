// Google Docs 文档页专用抓取。
// Google Docs 的文档正文由 canvas 渲染：实测该页 body.innerText 只有 160 字符界面文案
// （「此文档包含多个标签页」等），DOM 抽取注定只能拿到界面残留（事故：109/826686 字符）。
// 导出接口 export?format=txt 返回纯文本全文（实测 122264 字符），同源请求自动带 cookie，
// 具备查看权限即可读取；抓不到时返回 undefined，由调用方回落到既有 DOM 抽取。

const GOOGLE_DOCS_HOSTNAME = "docs.google.com";
const GOOGLE_DOCS_EXPORT_SUFFIX = "/export?format=txt";
const GOOGLE_DOCS_DOCUMENT_PATH_REGEX = /^\/document\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+/u;
const GOOGLE_DOCS_TITLE_SUFFIX_REGEX = /\s*[-–—]\s*Google\s*(?:文档|ドキュメント|Docs)$/u;
const HTML_DOCUMENT_REGEX = /^\s*<(!doctype|html)/iu;
const GOOGLE_DOCS_TITLE_FALLBACK = "Google 文档";

export async function fetchGoogleDocsDocumentText(
  pageUrl: string,
  pageTitle: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ title: string; text: string } | undefined> {
  const exportUrl = buildGoogleDocsExportUrl(pageUrl);
  if (!exportUrl) return undefined;
  try {
    const response = await fetchImpl(exportUrl, { credentials: "same-origin" });
    if (!response.ok) return undefined;
    const text = normalizeGoogleDocsText(await response.text());
    // 权限不足时导出接口可能返回 200 + 登录/错误 HTML 页，不能当成正文
    if (!text || HTML_DOCUMENT_REGEX.test(text)) return undefined;
    return { title: cleanGoogleDocsTitle(pageTitle), text };
  } catch {
    return undefined;
  }
}

function buildGoogleDocsExportUrl(pageUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== GOOGLE_DOCS_HOSTNAME) return undefined;
  const documentPath = url.pathname.match(GOOGLE_DOCS_DOCUMENT_PATH_REGEX)?.[0];
  if (!documentPath) return undefined;
  return `https://${GOOGLE_DOCS_HOSTNAME}${documentPath}${GOOGLE_DOCS_EXPORT_SUFFIX}`;
}

function cleanGoogleDocsTitle(pageTitle: string): string {
  return pageTitle.replace(GOOGLE_DOCS_TITLE_SUFFIX_REGEX, "").trim() || GOOGLE_DOCS_TITLE_FALLBACK;
}

function normalizeGoogleDocsText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");
}
