import type { SourceExtractionDiagnostics, SourceExtractionStageFact, SourcePayload } from "../shared/types";
import { buildSourceMetadata } from "./sourcePayload";
import { fetchGoogleDocsDocumentText } from "./googleDocsDocument";

type BoilerplateGroupKey =
  | "script"
  | "embedded"
  | "navigation"
  | "footer"
  | "sidebar"
  | "form"
  | "button"
  | "hidden"
  | "comment"
  | "advertising"
  | "newsletter"
  | "menu"
  | "recommendation"
  | "related"
  | "sharing"
  | "byline"
  | "modal";

type ScoreCache = Map<Element, number>;

// Thresholds for identifying substantial documentation content in sidebars
const SUBSTANTIAL_CONTENT_MIN_PARAGRAPHS = 2;
const SUBSTANTIAL_CONTENT_MIN_HEADINGS = 2;
const MAIN_CONTENT_SELECTOR = "main,article,[role='main']";
const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

// Heading text patterns that signal non-content navigation sections.
// When a heading matches, the heading and its following siblings
// (up to the next same-level heading) are removed as boilerplate.
const NAVIGATION_HEADING_PATTERNS = [
  "相关", "推荐", "热门", "最新", "最多阅读", "猜你喜欢", "大家都在看",
  "相关推荐", "相关阅读", "相关文章", "延伸阅读",
  "related", "recommended", "trending", "popular", "more articles",
  "you might also like", "also read", "keep reading", "up next",
  "most read", "most viewed", "latest news",
];
const NAVIGATION_HEADING_REGEX = new RegExp(
  "^(?:" + NAVIGATION_HEADING_PATTERNS.map(escapeRegex).join("|") + ")",
  "i"
);

// Class name patterns that signal non-content elements. Used as negative
// multipliers in scoreElement so widget/sidebar/nav containers lose to
// real content containers in the same selector group.
const NON_CONTENT_CLASS_PATTERNS = [
  "nav", "footer", "sidebar", "widget", "breadcrumb", "pagination",
  "cookie", "banner", "toolbar", "promo", "subscribe", "newsletter",
  "recommend", "related", "trending", "popular", "share", "social",
];
// Match patterns at word boundaries so "nav" doesn't hit "canvas"/"innovate".
// safe for concurrent calls: read-only regex, no shared mutable state
const NON_CONTENT_CLASS_REGEX = new RegExp(
  "\\b(?:" + NON_CONTENT_CLASS_PATTERNS.join("|") + ")\\b",
  "i"
);

// Thresholds for card-grid detection: a container with many child blocks
// where each block has a heading but little prose is likely a card listing.
const CARD_GRID_MIN_CARDS = 4;
const CARD_GRID_MAX_PROSE = 80;

const DASHBOARD_MIN_CHART_COUNT = 2;
const DASHBOARD_MIN_HEADING_COUNT = 6;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCardGrid(candidate: Element): boolean {
  const parent = candidate.parentElement;
  if (!parent) return false;
  const siblings = Array.from(parent.children).filter(
    (c) => c.tagName === candidate.tagName
  );
  if (siblings.length < CARD_GRID_MIN_CARDS) return false;
  if (!isSmallCard(candidate)) return false;

  const smallCardCount = siblings.filter(isSmallCard).length;
  return smallCardCount >= Math.ceil(siblings.length / 2);
}

// A small card has a heading but little non-heading prose text.
function isSmallCard(el: Element): boolean {
  const heading = el.querySelector(HEADING_SELECTOR);
  if (!heading) return false;
  const headings = el.querySelectorAll(HEADING_SELECTOR);
  const headingText = Array.from(headings)
    .map((h) => normalizeWhitespace(h.textContent ?? ""))
    .join("").length;
  const ownText = normalizeWhitespace(el.textContent ?? "").length;
  return ownText - headingText <= CARD_GRID_MAX_PROSE;
}

export interface ReadableExtractionDiagnostics {
  bodyTextLength: number;
  selectedTextLength: number;
  selectedRoot: string;
  candidateCount: number;
  candidates: Array<{ selector: string; root: string; score: number }>;
  removedNodeCounts: Record<BoilerplateGroupKey, number>;
  mergedBlockCount: number;
  facts?: SourceExtractionStageFact[];
  lowConfidence?: boolean;
  lowConfidenceDetail?: string;
}

const boilerplateGroups: Array<{ key: BoilerplateGroupKey; selector: string }> = [
  { key: "script", selector: "script,style,noscript" },
  { key: "embedded", selector: "svg,canvas,iframe" },
  { key: "navigation", selector: "nav,[role='navigation']" },
  { key: "footer", selector: "footer" },
  { key: "sidebar", selector: "aside,[role='complementary'],[class*='sidebar'],[id*='sidebar']" },
  { key: "form", selector: "form" },
  { key: "button", selector: "button" },
  { key: "hidden", selector: "[aria-hidden='true'],[hidden]" },
  { key: "comment", selector: ".comment,.comments,#comments,[class*='comment'],[id*='comment']" },
  { key: "advertising", selector: "[class^='ad-'],[class*=' ad-'],[id^='ad-'],[class*='advert'],[id*='advert'],[class*='sponsor'],[id*='sponsor']" },
  { key: "newsletter", selector: "[class*='newsletter'],[id*='newsletter']" },
  { key: "menu", selector: "[class*='menu'],[id*='menu']" },
  { key: "recommendation", selector: "[class*='recommend'],[id*='recommend']" },
  { key: "related", selector: "[class*='related'],[id*='related']" },
  { key: "sharing", selector: ".share,.share-tools,.share-buttons,.social-share,[class^='share-'],[class*=' share-'],[aria-label*='share' i],[aria-label*='分享']" }
];

const preferredSelectors = [
  "article",
  "main",
  "[role='main']",
  ".markdown-body",
  ".docs-content",
  ".doc-content",
  ".post-content",
  ".entry-content",
  "#content",
  ".content"
];

const minimumReadableScore = 80;
const minimumReadableBlockScore = 50;
const readableSiblingContainerSelector = "main,[role='main'],#content,.content,.docs-content,.doc-content,.markdown-body";

export async function extractReadableDocument(doc: Document, url: string): Promise<SourcePayload> {
  return (await extractReadableDocumentWithDiagnostics(doc, url)).payload;
}


/**
 * 检查文档是否为 dashboard(数据可视化页):含 ≥2 图表 + ≥6 heading。
 * 判定基于 DOM 结构,不依赖 diagnostics(避免 ratio 问题,见 implement.md 切片3/4 debug)。
 */
export function isDashboardDocument(doc: Document): boolean {
  const chartCount = doc.querySelectorAll("canvas,svg").length;
  if (chartCount < DASHBOARD_MIN_CHART_COUNT) return false;
  const headingCount = doc.querySelectorAll(HEADING_SELECTOR).length;
  if (headingCount < DASHBOARD_MIN_HEADING_COUNT) return false;
  return true;
}
export function diagnoseReadableDocument(doc: Document, url: string): ReadableExtractionDiagnostics {
  return extractReadableDocumentWithDiagnosticsSync(doc, url).diagnostics;
}

/**
 * Async 版本：含 Readability fallback
 */
async function extractReadableDocumentWithDiagnostics(doc: Document, url: string): Promise<{ payload: SourcePayload; diagnostics: ReadableExtractionDiagnostics }> {
  // Google Docs 文档页正文在 canvas 上，DOM 抽取只能拿到界面文案（见 googleDocsDocument.ts）
  const googleDocsResult = await extractGoogleDocsDocument(doc, url);
  if (googleDocsResult) return googleDocsResult;

  // 复用 sync 版本获取初始结果
  const syncResult = extractReadableDocumentWithDiagnosticsSync(doc, url);

  // Readability fallback：只走通用 scoring 路径，平台特定路径不触发
  const payloadText = syncResult.payload.text;
  const selectedRoot = syncResult.diagnostics.selectedRoot;
  const candidateCount = syncResult.diagnostics.candidateCount;
  const bodyTextLength = syncResult.diagnostics.bodyTextLength;
  if (
    selectedRoot === "body" &&
    candidateCount === 0 &&
    bodyTextLength > payloadText.length + 500
  ) {
    const readabilityResult = await tryReadabilityFallback(doc, url);
    if (readabilityResult) {
      const readabilityPayload: SourcePayload = {
        url,
        title: readabilityResult.title,
        ...buildSourceMetadata(doc, url),
        sourceKind: "page-readable",
        text: readabilityResult.text,
        sourceMarkdown: readabilityResult.text,
        sourceText: markdownToPlainText(readabilityResult.text),
        capturedAt: Date.now()
      };
      const fallbackDiagnostics: ReadableExtractionDiagnostics = {
        ...syncResult.diagnostics,
        selectedRoot: "@mozilla/readability (fallback)",
        selectedTextLength: readabilityResult.text.length,
        lowConfidence: false,
        lowConfidenceDetail: undefined
      };
      return {
        payload: withReadableDiagnostics(readabilityPayload, fallbackDiagnostics),
        diagnostics: fallbackDiagnostics
      };
    }
  }

  return syncResult;
}

/**
 * Google Docs 文档页：正文由 canvas 渲染，DOM 里只有界面文案，
 * 因此改走导出接口取纯文本全文；取不到返回 undefined，交回通用 DOM 抽取。
 */
async function extractGoogleDocsDocument(
  doc: Document,
  url: string
): Promise<{ payload: SourcePayload; diagnostics: ReadableExtractionDiagnostics } | undefined> {
  const exported = await fetchGoogleDocsDocumentText(url, doc.title ?? "");
  if (!exported) return undefined;

  const payload: SourcePayload = {
    url,
    title: exported.title,
    ...buildSourceMetadata(doc, url),
    sourceKind: "page-readable",
    text: exported.text,
    sourceMarkdown: exported.text,
    sourceText: exported.text,
    capturedAt: Date.now()
  };
  const diagnostics = platformDiagnostics(doc, payload, "google-docs", [
    { label: "页面类型", value: "google-docs" },
    { label: "获取方式", value: "导出接口 export?format=txt" }
  ]);
  return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
}

function extractReadableDocumentWithDiagnosticsSync(doc: Document, url: string): { payload: SourcePayload; diagnostics: ReadableExtractionDiagnostics } {
  const githubPage = extractGitHubPage(doc, url);
  if (githubPage) {
    const sourceText = markdownToPlainText(githubPage.text);
    const payload: SourcePayload = {
      url,
      title: githubPage.title,
      ...buildSourceMetadata(doc, url),
      sourceKind: "page-readable",
      text: githubPage.text,
      sourceMarkdown: githubPage.text,
      sourceText,
      capturedAt: Date.now()
    };
    const diagnostics = platformDiagnostics(doc, payload, "github", githubPage.facts);
    return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
  }

  const redditPage = extractRedditPage(doc, url);
  if (redditPage) {
    const sourceText = markdownToPlainText(redditPage.text);
    const payload: SourcePayload = {
      url,
      title: redditPage.title,
      ...buildSourceMetadata(doc, url),
      sourceKind: "page-readable",
      text: redditPage.text,
      sourceMarkdown: redditPage.text,
      sourceText,
      capturedAt: Date.now()
    };
    const diagnostics = platformDiagnostics(doc, payload, "reddit", redditPage.facts);
    return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
  }

  const discourseTopic = extractDiscourseTopic(doc, url);
  if (discourseTopic) {
    const sourceText = markdownToPlainText(discourseTopic.text);
    const payload: SourcePayload = {
      url,
      title: discourseTopic.title,
      ...buildSourceMetadata(doc, url),
      sourceKind: "page-readable",
      text: discourseTopic.text,
      sourceMarkdown: discourseTopic.text,
      sourceText,
      capturedAt: Date.now()
    };
    const diagnostics = platformDiagnostics(doc, payload, "discourse", discourseTopic.facts);
    return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
  }

  const xPostThread = extractXPostThread(doc, url);
  if (xPostThread) {
    const sourceText = markdownToPlainText(xPostThread.text);
    const payload: SourcePayload = {
      url,
      title: xPostThread.title,
      ...buildSourceMetadata(doc, url),
      sourceKind: "page-readable",
      text: xPostThread.text,
      sourceMarkdown: xPostThread.text,
      sourceText,
      capturedAt: Date.now()
    };
    const diagnostics = platformDiagnostics(doc, payload, "x-thread", xPostThread.facts);
    return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
  }

  const steamWorkshopPage = extractSteamWorkshopPage(doc, url);
  if (steamWorkshopPage) {
    const sourceText = markdownToPlainText(steamWorkshopPage.text);
    const payload: SourcePayload = {
      url,
      title: steamWorkshopPage.title,
      ...buildSourceMetadata(doc, url),
      sourceKind: "page-readable",
      text: steamWorkshopPage.text,
      sourceMarkdown: steamWorkshopPage.text,
      sourceText,
      capturedAt: Date.now()
    };
    const diagnostics = platformDiagnostics(doc, payload, "steam-workshop", steamWorkshopPage.facts);
    return { payload: withReadableDiagnostics(payload, diagnostics), diagnostics };
  }

  const clone = doc.cloneNode(true) as Document;
  flattenShadowRoots(doc, clone);
  const dashboard = isDashboardDocument(clone);
  const removedNodeCounts = removeBoilerplate(clone, dashboard);
  removeNavBlocksByText(clone);
  const scoreCache: ScoreCache = new Map();

  const selection = selectReadableContent(clone, scoreCache);
  // Dashboard: SVG <text> 数据文本已转为 p.dashboard-svg-text,但短文本低于 scoring 阈值,
  // 故 dashboard 时强制并入 blocks,不依赖 scoring 选中(不退化:仅 dashboard 命中时)
  const dashboardSvgTextBlocks = dashboard
    ? Array.from(clone.querySelectorAll("p.dashboard-svg-text"))
    : [];
  const text = normalizeMarkdown([...selection.blocks, ...dashboardSvgTextBlocks].map(nodeToMarkdown).join("\n\n"));
  const title = selection.mergedBlockCount > 1
    ? normalizeWhitespace(clone.title ?? "") || findTitle(selection.root, clone, url)
    : findTitle(selection.root, clone, url);

  // schema.org / JSON-LD 权威正文兜底：DOM 评分从 feed/列表页选错元素或提取过短时，
  // 若 JSON-LD 提供的 articleBody/text 显著更长（>1.5x），采用它作正文。
  // 移植自 defuddle `_getSchemaText`（defuddle.js），task defuddle-schema-org。
  const schemaArticle = extractSchemaOrgArticle(doc);
  const schemaText = schemaArticle?.text ?? "";
  const schemaWordCount = countWords(schemaText);
  const domWordCount = countWords(text);
  const useSchema = schemaWordCount > domWordCount * 1.5 && schemaWordCount >= 10;
  const effectiveText = useSchema ? schemaText : text;
  const effectiveTitle = useSchema && schemaArticle && schemaArticle.title ? schemaArticle.title : title;
  const schemaFacts: SourceExtractionStageFact[] = useSchema
    ? [{ label: "正文来源", value: "schema.org (JSON-LD)" }]
    : [];

  const payloadText = effectiveText || normalizeWhitespace(selection.root.textContent ?? "");
  const sourceMarkdown = effectiveText || payloadText;

  const payload = {
    url,
    title: effectiveTitle,
    ...buildSourceMetadata(doc, url),
    sourceKind: "page-readable" as const,
    text: payloadText,
    sourceMarkdown,
    sourceText: markdownToPlainText(sourceMarkdown),
    capturedAt: Date.now()
  };

  return {
    payload: withReadableDiagnostics(payload, {
      bodyTextLength: safeTextLength(doc.body ?? doc.documentElement),
      selectedTextLength: normalizeWhitespace(payloadText).length,
      selectedRoot: describeElement(selection.root),
      candidateCount: selection.candidates.length,
      candidates: selection.candidates,
      removedNodeCounts,
      mergedBlockCount: selection.mergedBlockCount,
      ...(schemaFacts.length ? { facts: schemaFacts } : {})
    }),
    diagnostics: {
      bodyTextLength: safeTextLength(doc.body ?? doc.documentElement),
      selectedTextLength: normalizeWhitespace(payloadText).length,
      selectedRoot: describeElement(selection.root),
      candidateCount: selection.candidates.length,
      candidates: selection.candidates,
      removedNodeCounts,
      mergedBlockCount: selection.mergedBlockCount,
      ...(schemaFacts.length ? { facts: schemaFacts } : {})
    }
  };
}

function withReadableDiagnostics(payload: SourcePayload, diagnostics: ReadableExtractionDiagnostics): SourcePayload {
  return {
    ...payload,
    extractionDiagnostics: buildReadableSourceDiagnostics(diagnostics)
  };
}

function buildReadableSourceDiagnostics(diagnostics: ReadableExtractionDiagnostics): SourceExtractionDiagnostics {
  const lowConfidence = diagnostics.lowConfidence ?? isLowConfidenceReadableDiagnostics(diagnostics);
  const removed = Object.entries(diagnostics.removedNodeCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}:${count}`)
    .join(", ");
  return {
    lowConfidence,
    stages: [
      {
        id: "readable",
        status: lowConfidence ? "warning" : "success",
        label: "正文抽取",
        detail: lowConfidence ? diagnostics.lowConfidenceDetail ?? "正文选择置信度偏低，可展开检查来源。" : "已抽取清洗后的正文。",
        facts: [
          { label: "选中区域", value: diagnostics.selectedRoot },
          { label: "正文长度", value: String(diagnostics.selectedTextLength) },
          { label: "页面文本", value: String(diagnostics.bodyTextLength) },
          { label: "候选数", value: String(diagnostics.candidateCount) },
          { label: "合并块数", value: String(diagnostics.mergedBlockCount) },
          ...(diagnostics.facts ?? []),
          ...(removed ? [{ label: "清理节点", value: removed }] : [])
        ]
      },
      {
        id: "truncation",
        status: "success",
        label: "截断",
        detail: "正文抽取阶段未截断来源文本。"
      }
    ]
  };
}

// 选中根退回 body 说明评分没找到正文容器。此时只有抽取量占页面文本极小比例才判低置信。
// 挑选条件：既有的「候选数 === 0」被兜底选根架空（对每个 section/div 都会 push 候选），
// 而「selectedRoot === "body"」也命不中——selectedRoot 是 describeElement() 的描述串，
// 带类名的 body 形如 "body.docs-gm.docsCommonWiz…"。两个条件同时失效，才让只剩界面残留的
// 页面仍报「抽取成功」（google-docs 事故：109/826686）。
const LOW_CONFIDENCE_MIN_PAGE_TEXT = 1000;
const LOW_CONFIDENCE_MAX_SELECTED_RATIO = 0.05;
const BODY_ROOT_SELECTION_REGEX = /^body(?:[.#]|$)/u;

function isLowConfidenceReadableDiagnostics(diagnostics: ReadableExtractionDiagnostics): boolean {
  if (!BODY_ROOT_SELECTION_REGEX.test(diagnostics.selectedRoot)) return false;
  const pageTextLength = diagnostics.bodyTextLength;
  return pageTextLength >= LOW_CONFIDENCE_MIN_PAGE_TEXT &&
    diagnostics.selectedTextLength < pageTextLength * LOW_CONFIDENCE_MAX_SELECTED_RATIO;
}

/**
 * @mozilla/readability 兜底抽取：自研 scoring 低置信度时使用
 */
async function tryReadabilityFallback(
  doc: Document,
  url: string
): Promise<{ title: string; text: string } | undefined> {
  try {
    const { Readability } = await import("@mozilla/readability");
    const reader = new Readability(doc.cloneNode(true) as Document);
    const result = reader.parse();
    if (!result || !result.textContent?.trim()) return undefined;
    const text = normalizeMarkdown(result.textContent);
    if (text.length < 50) return undefined;
    return {
      title: result.title?.trim() || findTitleFallback(doc, url),
      text
    };
  } catch {
    return undefined;
  }
}

function findTitleFallback(doc: Document, url: string): string {
  const titleEl = doc.querySelector("title");
  return normalizeWhitespace(titleEl?.textContent ?? "") || new URL(url).hostname;
}
type GitHubSubtype =
  | "github-readme"
  | "github-blob"
  | "github-issue"
  | "github-pr"
  | "github-discussion"
  | "github-wiki"
  | "github-release"
  | "github-markdown";

function extractGitHubPage(doc: Document, url: string): { title: string; text: string; facts: SourceExtractionStageFact[] } | undefined {
  const pageUrl = new URL(url || doc.URL || "https://example.com");
  if (!isGitHubHostname(pageUrl.hostname)) return undefined;

  const subtype = classifyGitHubSubtype(doc, pageUrl);
  const markdownBodies = findGitHubMarkdownBodies(doc);
  if (!markdownBodies.length) return undefined;

  const selectedBodies = selectGitHubMarkdownBodies(doc, subtype, markdownBodies);
  if (!selectedBodies.length) return undefined;

  const title = findGitHubTitle(doc, selectedBodies[0], pageUrl, subtype);
  const blocks = selectedBodies
    .map((body, index) => formatGitHubMarkdownBody(body, index, selectedBodies.length))
    .filter(Boolean);
  if (!blocks.length) return undefined;

  const text = normalizeMarkdown(selectedBodies.length === 1 && startsWithMarkdownHeading(blocks[0])
    ? blocks[0]
    : [`# ${title}`, ...blocks].join("\n\n"));

  return {
    title,
    text,
    facts: [
      { label: "页面类型", value: subtype },
      { label: "已加载 Markdown", value: String(markdownBodies.length) },
      { label: "已选 Markdown", value: String(selectedBodies.length) }
    ]
  };
}

function isGitHubHostname(hostname: string): boolean {
  return hostname === "github.com" || hostname.endsWith(".github.com");
}

function classifyGitHubSubtype(doc: Document, url: URL): GitHubSubtype {
  const path = url.pathname;
  if (/\/issues\/\d+(?:\/|$)/i.test(path)) return "github-issue";
  if (/\/pull\/\d+(?:\/|$)/i.test(path)) return "github-pr";
  if (/\/discussions\/\d+(?:\/|$)/i.test(path)) return "github-discussion";
  if (/\/wiki(?:\/|$)/i.test(path)) return "github-wiki";
  if (/\/releases(?:\/tag\/|\/|$)/i.test(path)) return "github-release";
  if (/\/blob\//i.test(path)) return "github-blob";
  if (doc.querySelector("article.markdown-body, .markdown-body.entry-content")) return "github-readme";
  return "github-markdown";
}

function findGitHubMarkdownBodies(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll(".markdown-body"))
    .filter((body) => !body.closest("template,[hidden],[aria-hidden='true']"))
    .filter((body) => normalizeWhitespace(body.textContent ?? "").length > 0);
}

function selectGitHubMarkdownBodies(doc: Document, subtype: GitHubSubtype, markdownBodies: Element[]): Element[] {
  const subtypeBodies = findGitHubSubtypeBodies(doc, subtype).filter((body) => markdownBodies.includes(body));
  const bodies = subtypeBodies.length ? subtypeBodies : markdownBodies;
  return bodies.filter((body) => !isGitHubDiffOnlyMarkdownBody(body));
}

function findGitHubSubtypeBodies(doc: Document, subtype: GitHubSubtype): Element[] {
  if (subtype === "github-wiki") {
    return Array.from(doc.querySelectorAll("#wiki-body .markdown-body, .wiki-body .markdown-body"));
  }

  if (subtype === "github-release") {
    return Array.from(doc.querySelectorAll(".release-entry .markdown-body, [data-testid='release-body'], .markdown-body"));
  }

  if (subtype === "github-readme" || subtype === "github-blob") {
    return Array.from(doc.querySelectorAll("article.markdown-body, .markdown-body.entry-content, .Box-body .markdown-body"));
  }

  return Array.from(doc.querySelectorAll(".js-discussion .markdown-body, #discussion_bucket .markdown-body, .discussion-thread .markdown-body, .timeline-comment .markdown-body, .review-comment .markdown-body, .markdown-body"));
}

function isGitHubDiffOnlyMarkdownBody(body: Element): boolean {
  if (body.closest(".timeline-comment,.review-comment,.discussion-comment")) return false;
  return Boolean(body.closest(".file,.js-file,.blob-wrapper,.blob-code,.js-diff-progressive-container,[data-testid='diff-file']"));
}

function findGitHubTitle(doc: Document, firstBody: Element, url: URL, subtype: GitHubSubtype): string {
  const markdownH1 = normalizeWhitespace(firstBody.querySelector("h1")?.textContent ?? "");
  const markdownHeading = normalizeWhitespace(firstBody.querySelector("h1, h2")?.textContent ?? "");
  const docTitle = cleanGitHubDocumentTitle(doc.title ?? "");

  if (subtype === "github-readme") {
    const repositoryTitle = findGitHubRepositoryTitle(doc) || (!markdownH1 ? findGitHubRepositoryNameFromUrl(url) : "");
    if (repositoryTitle) return repositoryTitle;
    if (markdownH1) return markdownH1;
    if (docTitle) return docTitle;
    if (markdownHeading) return markdownHeading;
  }

  if (subtype === "github-blob") {
    const fileTitle = findGitHubBlobTitle(doc, url) || docTitle;
    if (fileTitle) return fileTitle;
    if (markdownH1) return markdownH1;
    if (markdownHeading) return markdownHeading;
  }

  const pageHeading = findGitHubPageHeading(doc, firstBody);
  if (pageHeading) return pageHeading;
  if (subtype === "github-wiki" && docTitle) return docTitle;
  if (markdownHeading && subtype === "github-wiki") return markdownHeading;
  if (docTitle) return docTitle;
  if (markdownHeading) return markdownHeading;

  return url.hostname;
}

function findGitHubRepositoryTitle(doc: Document): string {
  const selectors = [
    "[data-testid='repository-container-header'] strong[itemprop='name'] a",
    "[data-testid='repository-container-header'] strong a",
    "#repository-container-header strong[itemprop='name'] a",
    "#repository-container-header strong a",
    "strong[itemprop='name'] a"
  ];

  for (const selector of selectors) {
    const title = cleanGitHubRepositoryNameCandidate(doc.querySelector(selector)?.textContent ?? "");
    if (title) return title;
  }

  return "";
}

function findGitHubRepositoryNameFromUrl(url: URL): string {
  const segments = url.pathname.split("/").map((segment) => decodeURIComponent(segment)).filter(Boolean);
  if (segments.length < 2) return "";
  return cleanGitHubRepositoryNameCandidate(segments[1]);
}

function findGitHubBlobTitle(doc: Document, url: URL): string {
  const selectors = [
    "[aria-label='Breadcrumbs'] [aria-current='page']",
    "[data-testid='breadcrumbs'] [aria-current='page']",
    ".file-navigation .final-path",
    ".final-path"
  ];

  for (const selector of selectors) {
    const title = normalizeWhitespace(doc.querySelector(selector)?.textContent ?? "");
    if (title) return title;
  }

  const segments = url.pathname.split("/").map((segment) => decodeURIComponent(segment)).filter(Boolean);
  const blobIndex = segments.findIndex((segment) => segment.toLowerCase() === "blob");
  if (blobIndex >= 0 && segments.length > blobIndex + 2) return normalizeWhitespace(segments.at(-1) ?? "");
  return "";
}

function cleanGitHubRepositoryNameCandidate(value: string): string {
  const normalized = normalizeWhitespace(value).replace(/\s*\/\s*/gu, "/");
  if (!normalized) return "";
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function findGitHubPageHeading(doc: Document, contentBody: Element): string {
  const heading = doc.querySelector(
    "bdi.js-issue-title, .js-issue-title, [data-testid='issue-title'], [data-testid='pull-request-title'], h1 bdi, h1"
  );
  if (!heading || contentBody.contains(heading)) return "";
  return normalizeWhitespace(heading.textContent ?? "");
}

function cleanGitHubDocumentTitle(title: string): string {
  const normalized = normalizeWhitespace(title);
  const repositoryMatch = normalized.match(/^GitHub\s+-\s+[^/]+\/([^:]+)(?::\s+.*)?$/iu);
  if (repositoryMatch?.[1]) return cleanGitHubRepositoryNameCandidate(repositoryMatch[1]);
  return normalized
    .replace(/\s+\u00b7\s+.*$/u, "")
    .replace(/\s+\|\s+GitHub$/iu, "");
}

function formatGitHubMarkdownBody(body: Element, index: number, total: number): string {
  const markdown = normalizeMarkdown(nodeToMarkdown(body));
  if (!markdown) return "";
  if (total === 1) return markdown;

  return `## ${index === 0 ? "正文" : `评论 #${index}`}\n\n${markdown}`;
}

function startsWithMarkdownHeading(markdown: string): boolean {
  return /^#{1,6}\s+\S/u.test(markdown);
}

function extractRedditPage(doc: Document, url: string): { title: string; text: string; facts: SourceExtractionStageFact[] } | undefined {
  if (!isRedditPage(url)) return undefined;

  const postNodes = Array.from(doc.querySelectorAll("shreddit-post"));
  const commentNodes = Array.from(doc.querySelectorAll("shreddit-comment"));
  const posts = postNodes
    .map((post, index) => formatRedditPost(post, index + 1))
    .filter(Boolean);
  const comments = commentNodes
    .map((comment, index) => formatRedditComment(comment, index + 1))
    .filter(Boolean);
  if (!posts.length && !comments.length) return undefined;

  const collapsedControlCount = countRedditCollapsedControls(doc);
  const title = findRedditTitle(doc, url);
  return {
    title,
    text: normalizeMarkdown([
      `# ${title}`,
      ...posts,
      ...(comments.length ? ["## 评论", ...comments] : [])
    ].join("\n\n")),
    facts: [
      { label: "页面类型", value: "reddit" },
      { label: "已加载帖子", value: String(postNodes.length) },
      { label: "已选帖子", value: String(posts.length) },
      { label: "已加载评论", value: String(commentNodes.length) },
      { label: "已选评论", value: String(comments.length) },
      ...(collapsedControlCount ? [{ label: "折叠入口", value: String(collapsedControlCount) }] : [])
    ]
  };
}

function isRedditPage(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "reddit.com" || hostname.endsWith(".reddit.com");
}

function findRedditTitle(doc: Document, url: string): string {
  const isPostPage = isRedditPostPage(url);
  const firstPost = doc.querySelector("shreddit-post");
  const postTitle = firstPost ? readRedditPostTitle(firstPost) : "";
  if (postTitle && isPostPage) return postTitle;

  const docTitle = normalizeWhitespace(doc.title ?? "");
  if (isPostPage && docTitle) return docTitle;

  const subreddit = firstPost?.getAttribute("subreddit-prefixed-name");
  if (subreddit) return subreddit;

  const pathSubreddit = new URL(url).pathname.match(/^\/r\/([^/]+)/i)?.[1];
  if (pathSubreddit) return `r/${decodeURIComponent(pathSubreddit)}`;

  return docTitle || new URL(url).hostname;
}

function isRedditPostPage(url: string): boolean {
  return /^\/r\/[^/]+\/comments\/[^/]+/i.test(new URL(url).pathname);
}

function countRedditCollapsedControls(doc: Document): number {
  return Array.from(doc.querySelectorAll("button,a,shreddit-comment-tree,shreddit-more-comments"))
    .filter((node) => /(?:load|view|show)\s+more|more comments|continue this thread|查看更多|加载更多|展开/u.test(normalizeWhitespace(node.textContent ?? "")))
    .length;
}

function formatRedditPost(post: Element, index: number): string {
  const title = readRedditPostTitle(post);
  const body = readRedditPostBody(post);
  if (!title && !body) return "";

  const lines = [`## ${title || `Post ${index}`}`];
  const meta = readRedditPostMeta(post);
  if (meta.length) lines.push(meta.join(" · "));
  if (body) lines.push("", body);
  return lines.join("\n");
}

function readRedditPostTitle(post: Element): string {
  const explicitTitle = normalizeWhitespace(post.getAttribute("post-title") || post.querySelector("[slot='title']")?.textContent || "");
  if (explicitTitle) return explicitTitle;

  const heading = Array.from(post.querySelectorAll("h1, h2"))
    .find((node) => !node.closest("[slot='text-body'], [slot='body'], [slot='comment'], shreddit-post-text-body, .md, .usertext-body"));
  return normalizeWhitespace(heading?.textContent ?? "");
}

function readRedditPostMeta(post: Element): string[] {
  const author = normalizeWhitespace(post.getAttribute("author") || post.querySelector("[slot='authorName']")?.textContent || "");
  const score = normalizeWhitespace(post.getAttribute("score") || "");
  const comments = normalizeWhitespace(post.getAttribute("comment-count") || "");
  const flair = normalizeWhitespace(post.querySelector("[slot='post-flair']")?.textContent || "");
  const href = normalizeWhitespace(post.getAttribute("content-href") || post.getAttribute("permalink") || "");

  return [
    author ? `作者：${author.startsWith("u/") ? author : `u/${author}`}` : "",
    score ? `分数：${score}` : "",
    comments ? `评论：${comments}` : "",
    flair ? `标签：${flair}` : "",
    href ? `链接：${href}` : ""
  ].filter(Boolean);
}

function readRedditPostBody(post: Element): string {
  const body = post.querySelector("[slot='text-body']");
  if (!body) return "";
  return normalizeMarkdown(nodeToMarkdown(body));
}

function formatRedditComment(comment: Element, index: number): string {
  const body = readRedditCommentBody(comment);
  if (!body) return "";

  const author = normalizeWhitespace(
    comment.getAttribute("author") ||
    comment.querySelector("[slot='authorName'], [slot='author']")?.textContent ||
    ""
  );
  const score = normalizeWhitespace(comment.getAttribute("score") || comment.querySelector("[slot='score']")?.textContent || "");
  const permalink = normalizeWhitespace(comment.getAttribute("permalink") || comment.getAttribute("content-href") || "");
  const heading = author ? `### #${index} ${author.startsWith("u/") ? author : `u/${author}`}` : `### #${index}`;
  const meta = [
    score ? `分数：${score}` : "",
    permalink ? `链接：${permalink}` : ""
  ].filter(Boolean);

  return [heading, meta.join(" · "), "", body].filter((line, lineIndex) => lineIndex === 2 || line).join("\n");
}

function readRedditCommentBody(comment: Element): string {
  const body = comment.querySelector("[slot='comment'], [slot='body'], [slot='text-body'], .md, .usertext-body");
  if (!body) return "";
  const clone = body.cloneNode(true) as Element;
  clone.querySelectorAll("shreddit-comment").forEach((nested) => nested.remove());
  return normalizeMarkdown(nodeToMarkdown(clone));
}

function extractDiscourseTopic(doc: Document, url: string): { title: string; text: string; facts: SourceExtractionStageFact[] } | undefined {
  if (!isDiscourseTopicPage(doc, url)) return undefined;

  const postNodes = doc.querySelectorAll("article[id^='post_']").length
    ? doc.querySelectorAll("article[id^='post_']")
    : doc.querySelectorAll(".topic-post");
  const posts = Array.from(postNodes)
    .map((post, index) => formatDiscoursePost(post, index + 1))
    .filter(Boolean);
  if (!posts.length) return undefined;

  const title = findDiscourseTitle(doc, url);
  return {
    title,
    text: normalizeMarkdown([`# ${title}`, ...posts].join("\n\n")),
    facts: [
      { label: "页面类型", value: "discourse" },
      { label: "已加载帖子", value: String(postNodes.length) },
      { label: "已选帖子", value: String(posts.length) }
    ]
  };
}

function isDiscourseTopicPage(doc: Document, url: string): boolean {
  const hostname = new URL(url || doc.URL || "https://example.com").hostname;
  const hasTopicPath = /\/t\//.test(new URL(url || doc.URL || "https://example.com").pathname);
  return hasTopicPath && Boolean(doc.querySelector("#topic-title, .topic-post .cooked, article[id^='post_'] .cooked")) && (
    hostname === "linux.do" ||
    hostname.endsWith(".linux.do") ||
    Boolean(doc.querySelector("meta[name='generator'][content*='Discourse'], #reply-control, .topic-status-info"))
  );
}

function findDiscourseTitle(doc: Document, url: string): string {
  const title = normalizeWhitespace(
    doc.querySelector("#topic-title h1 a, #topic-title h1")?.textContent ?? ""
  );
  if (title) return title;

  const pageHeading = Array.from(doc.querySelectorAll("h1 .fancy-title, h1"))
    .find((node) => !node.closest(".cooked,.topic-post,article[id^='post_']"));
  const pageTitle = normalizeWhitespace(pageHeading?.textContent ?? "");
  if (pageTitle) return pageTitle;

  const docTitle = normalizeWhitespace(doc.title ?? "");
  return cleanDiscourseDocumentTitle(docTitle, new URL(url || doc.URL || "https://example.com").hostname) || new URL(url || doc.URL || "https://example.com").hostname;
}

function cleanDiscourseDocumentTitle(title: string, hostname: string): string {
  const normalized = normalizeWhitespace(title);
  const parts = normalized.split(/\s+-\s+/u).map(normalizeWhitespace).filter(Boolean);
  if (parts.length < 2) return normalized;

  const siteName = parts.at(-1) ?? "";
  if (!isDiscourseSiteTitle(siteName, hostname)) return normalized;

  const withoutSite = parts.slice(0, -1);
  if (withoutSite.length > 1) return withoutSite.slice(0, -1).join(" - ");
  return withoutSite[0] ?? "";
}

function isDiscourseSiteTitle(title: string, hostname: string): boolean {
  const normalizedTitle = title.toLocaleLowerCase();
  const normalizedHostname = hostname.replace(/^www\./iu, "").toLocaleLowerCase();
  const hostLabel = normalizedHostname.split(".")[0]?.replace(/[-_]+/gu, " ") ?? "";
  return normalizedTitle === normalizedHostname ||
    normalizedTitle === hostLabel ||
    (normalizedHostname === "linux.do" && normalizedTitle === "linux do");
}

function formatDiscoursePost(post: Element, index: number): string {
  const cooked = post.querySelector(".cooked");
  if (!cooked) return "";

  const body = normalizeMarkdown(nodeToMarkdown(cooked));
  if (!body) return "";

  const author = normalizeWhitespace(
    post.querySelector("[data-user-card], .topic-meta-data .names .first, .names .first")?.textContent ?? ""
  );
  const postId = post.closest("article[id^='post_']")?.id.replace(/^post_/, "") || String(index);
  const heading = author ? `## #${postId} ${author}` : `## #${postId}`;
  return `${heading}\n\n${body}`;
}

function extractXPostThread(doc: Document, url: string): { title: string; text: string; facts: SourceExtractionStageFact[] } | undefined {
  const pageUrl = new URL(url);
  if (!isXHostname(pageUrl.hostname) || !pageUrl.pathname.includes("/status/")) return undefined;

  const tweets = findXThreadTweetArticles(doc);
  const title = findXPostTitle(doc, url) || normalizeWhitespace(doc.title ?? "") || pageUrl.hostname;
  const posts = tweets
    .map((tweet, index) => formatXTweet(tweet, index + 1, title))
    .filter(Boolean);
  if (!posts.length) return undefined;

  return {
    title,
    text: normalizeMarkdown([`# ${title}`, ...posts].join("\n\n")),
    facts: [
      { label: "页面类型", value: "x-thread" },
      { label: "已加载推文", value: String(doc.querySelectorAll("article[data-testid='tweet'] [data-testid='tweetText']").length) },
      { label: "已选推文", value: String(posts.length) }
    ]
  };
}

function findXThreadTweetArticles(doc: Document): Element[] {
  const cells = Array.from(doc.querySelectorAll("[data-testid='cellInnerDiv']"));
  if (cells.length) {
    const tweets: Element[] = [];
    for (const cell of cells) {
      if (isXTimelineBoundaryCell(cell)) break;

      const tweet = findTopLevelXTweetArticle(cell);
      if (tweet) tweets.push(tweet);
    }

    if (tweets.length) return tweets;
  }

  return Array.from(doc.querySelectorAll("article[data-testid='tweet']"))
    .filter((tweet) => isTopLevelElement(tweet) && Boolean(tweet.querySelector("[data-testid='tweetText']")));
}

function findTopLevelXTweetArticle(root: Element): Element | undefined {
  return Array.from(root.querySelectorAll("article[data-testid='tweet']"))
    .find((tweet) => isTopLevelElement(tweet) && Boolean(tweet.querySelector("[data-testid='tweetText']")));
}

function isTopLevelElement(element: Element): boolean {
  const parent = element.parentElement?.closest(element.tagName.toLowerCase());
  return !parent || !parent.contains(element);
}

function isXTimelineBoundaryCell(cell: Element): boolean {
  const heading = normalizeWhitespace(cell.querySelector("h1, h2, h3, [role='heading']")?.textContent ?? "");
  if (isXRecommendationText(heading)) return true;

  if (cell.querySelector("article[data-testid='tweet']")) return false;
  return isXRecommendationText(normalizeWhitespace(cell.textContent ?? ""));
}

function isXRecommendationText(text: string): boolean {
  return /^(discover more|relevant people|who to follow|what'?s happening|trending|more posts|you might like|发现更多|相关用户|推荐|趋势|正在发生)/iu.test(text);
}

function formatXTweet(tweet: Element, index: number, threadTitle: string): string {
  const author = readXTweetAuthor(tweet);
  const body = readXTweetBody(tweet, index === 1 ? { author, title: threadTitle } : {});
  if (!body) return "";

  const label = index === 1 ? "推文" : `回复 #${index - 1}`;
  const heading = index === 1 || !author ? `## ${label}` : `## ${label} ${author}`;
  return `${heading}\n\n${body}`;
}

function readXTweetBody(tweet: Element, context: { author?: string; title?: string } = {}): string {
  const body = tweet.querySelector("[data-testid='tweetText']");
  if (!body) return "";
  return normalizeMarkdown(stripLeadingXArticleChrome(nodeToMarkdown(body), context));
}

function readXTweetAuthor(tweet: Element): string {
  const userName = tweet.querySelector("[data-testid='User-Name']");
  if (!userName) return "";

  const texts = Array.from(userName.querySelectorAll("span"))
    .map((span) => normalizeWhitespace(span.textContent ?? ""))
    .filter(Boolean)
    .filter((text, index, all) => all.indexOf(text) === index);
  const handle = texts.find((text) => text.startsWith("@")) || "";
  const name = texts.find((text) => !text.startsWith("@") && text !== handle) || "";
  return [name, handle].filter(Boolean).join(" ");
}

function removeBoilerplate(doc: Document, isDashboard = false): Record<BoilerplateGroupKey, number> {
  const counts = Object.fromEntries(boilerplateGroups.map((group) => [group.key, 0])) as Record<BoilerplateGroupKey, number>;
  // 未打开的原生 <dialog> 由 UA 样式表隐藏（dialog:not([open]) 不匹配 [hidden]
  // 属性），弹窗内的 main/article 会胜过真实正文容器污染可读根选择
  // （如 greasyfork 安装提示弹窗）。在组循环之前独立移除，绕过
  // "含 main/article 的节点保留"保护——弹窗内的语义标签不是页面主内容。
  const closedDialogs = Array.from(doc.querySelectorAll("dialog:not([open])"));
  counts.modal = closedDialogs.length;
  closedDialogs.forEach((node) => node.remove());
  for (const group of boilerplateGroups) {
    const nodes = Array.from(doc.querySelectorAll(group.selector));
    counts[group.key] += nodes.length;
    nodes.forEach((node) => {
      // 根节点与 <body> 永不删除：页面自身的 id/class 可能恰好含样板子串
      // (如微信公众号页 `<body class="… comment_feature …">` 命中 [class*='comment']),
      // 删掉 body 会让整页内容消失、抽取退回 documentElement 只剩 <head> 文本
      // (task wechat-article-extract)。
      if (node === doc.body || node === doc.documentElement) {
        counts[group.key] -= 1;
        return;
      }
      // Don't remove nodes that ARE or CONTAIN main content areas
      if (node.matches(MAIN_CONTENT_SELECTOR) || node.querySelector(MAIN_CONTENT_SELECTOR)) {
        counts[group.key] -= 1;
        return;
      }
      // Protect substantial content: sidebar with multiple paragraphs/headings likely contains docs
      if (group.key === "sidebar") {
        const paragraphs = node.querySelectorAll("p").length;
        const headings = node.querySelectorAll(HEADING_SELECTOR).length;
        if (paragraphs >= SUBSTANTIAL_CONTENT_MIN_PARAGRAPHS || headings >= SUBSTANTIAL_CONTENT_MIN_HEADINGS) {
          counts[group.key] -= 1;
          return;
        }
      }
      // Dashboard: 保留 SVG <text> 数据文本(图表里的可见数据载体),移除其余 svg 子树
      if (isDashboard && group.key === "embedded" && node.tagName.toLowerCase() === "svg") {
        const textParts = Array.from(node.querySelectorAll("text"))
          .map((t) => normalizeWhitespace(t.textContent ?? ""))
          .filter(Boolean);
        if (textParts.length) {
          const replacement = doc.createElement("p");
          replacement.className = "dashboard-svg-text";
          replacement.textContent = textParts.join(" ");
          node.replaceWith(replacement);
          counts[group.key] -= 1;
          return;
        }
      }
      node.remove();
    });
  }
  doc.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
    // 压缩空白以同时命中 `display:none` 与 `display: none`（getAttribute 原样返回属性值）
    const style = (node.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
    if (style.includes("display:none") || style.includes("visibility:hidden")) {
      counts.hidden += 1;
      node.remove();
    }
  });

  // Remove sections whose heading signals non-content navigation
  // ("相关推荐", "Trending", "More articles", etc).
  const navHeadings = Array.from(
    doc.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
  ).filter((h) => NAVIGATION_HEADING_REGEX.test(normalizeWhitespace(h.textContent ?? "")));
  for (const heading of navHeadings) {
    const level = parseInt(heading.tagName[1], 10);
    const firstSibling = heading.nextElementSibling;
    heading.remove();
    removeFollowingSiblings(firstSibling, level);
  }
// 文本模式级样板清理（移植 defuddle content-patterns 精简）：移除孤立短样板——
  // byline / 独立日期行 / 社交计数 / "Leave a comment" / newsletter 提示块。
  // 仅命中短、无正文链接嵌套的叶子元素，正文段落不匹配，防误伤。
  counts.byline = removeTextPatternBoilerplate(doc);

  return counts;
}

// Remove siblings starting from a node until a same-or-higher level heading.
// Used to strip "相关推荐" navigation sections block by block.
function removeFollowingSiblings(start: Element | null, level: number): void {
  let node = start;
  while (node) {
    const match = node.tagName.match(/^H(\d)$/);
    if (match && parseInt(match[1], 10) <= level) break;
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

function selectReadableContent(
  doc: Document,
  scoreCache: ScoreCache
): {
  root: Element;
  blocks: Element[];
  candidates: Array<{ selector: string; root: string; score: number }>;
  mergedBlockCount: number;
} {
  const candidates: Array<{ selector: string; root: string; score: number }> = [];
  const merged = findReadableSiblingBlocks(doc, scoreCache, candidates);
  if (merged) return merged;

  const root = findReadableRoot(doc, scoreCache, candidates);
  return {
    root,
    blocks: [root],
    candidates,
    mergedBlockCount: 1
  };
}

function findReadableSiblingBlocks(
  doc: Document,
  scoreCache: ScoreCache,
  candidates: Array<{ selector: string; root: string; score: number }>
): { root: Element; blocks: Element[]; candidates: Array<{ selector: string; root: string; score: number }>; mergedBlockCount: number } | undefined {
  const containers = findReadableSiblingContainers(doc);
  for (const container of containers) {
    const blocks = Array.from(container.children).filter(isReadableBlockElement);
    const scoredBlocks = blocks
      .map((element) => ({ element, score: scoreElement(element, scoreCache) }))
      .filter((entry) => entry.score > minimumReadableBlockScore);

    for (const entry of scoredBlocks) {
      candidates.push({ selector: "readable-sibling", root: describeElement(entry.element), score: Math.round(entry.score) });
    }

    if (scoredBlocks.length < 2) continue;

    const containerScore = scoreElement(container, scoreCache);
    candidates.push({ selector: "readable-container", root: describeElement(container), score: Math.round(containerScore) });

    return {
      root: container,
      blocks: scoredBlocks.map((entry) => entry.element),
      candidates,
      mergedBlockCount: scoredBlocks.length
    };
  }

  return undefined;
}

function findReadableSiblingContainers(doc: Document): Element[] {
  const containers: Element[] = [];
  const pending = Array.from(doc.querySelectorAll(readableSiblingContainerSelector));
  const seen = new Set<Element>();

  while (pending.length) {
    const container = pending.shift();
    if (!container || seen.has(container)) continue;
    seen.add(container);
    containers.push(container);

    for (const child of Array.from(container.children)) {
      if (isPotentialReadableBlockContainer(child)) pending.push(child);
    }
  }

  return containers;
}

function isPotentialReadableBlockContainer(element: Element): boolean {
  if (!element.children.length) return false;
  const tag = element.tagName.toLowerCase();
  return ["main", "article", "section", "div"].includes(tag) ||
    element.getAttribute("role") === "main" ||
    hasReadableContentClass(element) ||
    element.id === "content";
}

function isReadableBlockElement(element: Element): boolean {
  if (isCodeSnippetContainer(element)) return false;
  return ["article", "section"].includes(element.tagName.toLowerCase()) ||
    element.getAttribute("role") === "article" ||
    hasReadableContentClass(element);
}

function isCodeSnippetContainer(element: Element): boolean {
  const classes = Array.from(element.classList);
  return Boolean(element.querySelector("pre, code")) && (
    classes.includes("snippet-clipboard-content") ||
    classes.includes("highlight") ||
    (classes.includes("notranslate") && classes.includes("overflow-auto"))
  );
}

function hasReadableContentClass(element: Element): boolean {
  return Array.from(element.classList).some((className) =>
    className === "content" ||
    /^(post|entry|article|doc|docs|markdown|readable)[-_](content|body)$/iu.test(className) ||
    /^(content|body)[-_](post|entry|article|doc|docs|markdown|readable)$/iu.test(className)
  );
}

function findReadableRoot(
  doc: Document,
  scoreCache: ScoreCache,
  candidates: Array<{ selector: string; root: string; score: number }>
): Element {
  const bodyText = normalizeWhitespace(doc.body?.textContent ?? "").length;
  for (const selector of preferredSelectors) {
    const elements = Array.from(doc.querySelectorAll(selector));
    const best = pickBestReadableElement(elements, minimumReadableScore, selector, scoreCache);
    if (!best) {
      // 语义标签(main/article/[role='main'])即使分数低于阈值也选中
      const semantic = elements.find((el) => el.matches(MAIN_CONTENT_SELECTOR));
      if (semantic && !isCardGrid(semantic)) {
        // 例外：语义标签占页面可见文本比例过低时不直接信任——无 main 的列表页里
        // 唯一 <article> 可能是客户端渲染的赞助卡（原子类名站点，清理规则不命中），
        // continue 交给后续 selector / section,div fallback 选更大的内容容器
        const semanticText = normalizeWhitespace(semantic.textContent ?? "").length;
        if (bodyText > 1000 && semanticText < bodyText * 0.1) continue;
        const score = scoreElement(semantic, scoreCache);
        candidates.push({ selector, root: describeElement(semantic), score: Math.round(score) });
        return semantic;
      }
      continue;
    }
    // Skip card-grid candidates (many small <article> cards on listing pages)
    if (isCardGrid(best)) continue;
    // Skip candidates that are tiny relative to page text (listing page with
    // one slightly-larger card that still misses the real content container)
    if (bodyText > 1000) {
      const bestText = normalizeWhitespace(best.textContent ?? "").length;
      if (bestText < bodyText * 0.02) continue;
    }
    return best;
  }

  const fallbackRoot = doc.body ?? doc.documentElement;
  return pickBestReadableElement(Array.from(fallbackRoot.querySelectorAll("section, div")), minimumReadableScore, "section, div", scoreCache) ?? fallbackRoot;

  function pickBestReadableElement(candidatesToScore: Element[], minimumScore: number, selector: string, cache: ScoreCache): Element | undefined {
    let best: { element: Element; score: number } | undefined;

    for (const element of candidatesToScore) {
      const score = scoreElement(element, cache);
      candidates.push({ selector, root: describeElement(element), score: Math.round(score) });
      if (score <= minimumScore) continue;
      if (!best || score > best.score) best = { element, score };
    }

    return best?.element;
  }
}

function scoreElement(element: Element, scoreCache?: ScoreCache): number {
  if (scoreCache?.has(element)) return scoreCache.get(element) ?? 0;
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!text) {
    scoreCache?.set(element, 0);
    return 0;
  }
  const linkText = Array.from(element.querySelectorAll("a"))
    .map((link) => normalizeWhitespace(link.textContent ?? ""))
    .join("");
  const linkDensity = linkText.length / text.length;
  let score = text.length * (1 - Math.min(linkDensity, 0.9));
  const className = (element.className && typeof element.className === "string")
    ? element.className
    : "";
  if (className && NON_CONTENT_CLASS_REGEX.test(className)) {
    score *= 0.1;
  }
  // —— 移植 defuddle ContentScorer 多信号（scoring.js），换算到字符 scale ——
  const classLower = className.toLocaleLowerCase();
  // content 指示类正信号（content/article/post/main/entry/story）
  if (/\b(content|article|post|main|entry|story)\b/.test(classLower)) {
    score *= 1.15;
  }
  // 段落结构：有 <p> 说明是散文正文而非导航
  const paragraphCount = element.getElementsByTagName("p").length;
  if (paragraphCount > 0) {
    score += text.length * 0.05;
  }
  // 日期/作者（byline）信号：含出版日期或 "By <大写>" 的文章正文特征
  if (/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}|\b(?:by|written by)\s+[A-Z]/i.test(text)) {
    score += text.length * 0.1;
  }
  // 图片密度惩罚：缩略图墙的导航/列表页尺寸降权
  const imageCount = element.getElementsByTagName("img").length;
  if (imageCount) {
    score -= Math.min(imageCount, 6) * text.length * 0.04;
  }
  // 嵌套表格惩罚：旧式布局页降权
  const tableCount = element.getElementsByTagName("table").length;
  if (tableCount) {
    score -= tableCount * text.length * 0.03;
  }
  scoreCache?.set(element, score);
  return score;
}

function findTitle(root: Element, doc: Document, url: string): string {
  const xTitle = findXPostTitle(doc, url);
  if (xTitle) return xTitle;

  const h1 = normalizeWhitespace(root.querySelector("h1")?.textContent ?? "");
  const metadataTitle = findDocumentMetadataTitle(doc);
  const leadingH2 = findLeadingHeading(root, "h2");
  const fallbackH2 = normalizeWhitespace(root.querySelector("h2")?.textContent ?? "");
  const docTitle = normalizeWhitespace(doc.title ?? "");

  // App-like pages often expose a placeholder heading (e.g. "Untitled prompt")
  // while the browser tab title is the reliable identity. Prefer the heading
  // only when it is a real document title, not a generic app-shell placeholder.
  if (h1 && !isPlaceholderHeading(h1)) return h1;
  if (metadataTitle && !isPlaceholderHeading(metadataTitle)) return metadataTitle;
  if (docTitle) return docTitle;
  if (leadingH2 && !isPlaceholderHeading(leadingH2)) return leadingH2;
  if (fallbackH2 && !isPlaceholderHeading(fallbackH2)) return fallbackH2;

  return new URL(url || doc.URL || "https://example.com").hostname;
}

function findDocumentMetadataTitle(doc: Document): string {
  return normalizeWhitespace(
    doc.querySelector<HTMLMetaElement>("meta[property='og:title'], meta[name='twitter:title'], meta[name='title']")?.content ?? ""
  );
}

function findLeadingHeading(root: Element, selector: string): string {
  const heading = root.querySelector(selector);
  if (!heading) return "";

  const precedingText = normalizeWhitespace(readTextBeforeElement(root, heading));
  if (precedingText.length > 80) return "";

  return normalizeWhitespace(heading.textContent ?? "");
}

function readTextBeforeElement(root: Node, target: Element): string {
  const chunks: string[] = [];

  const walk = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child === target) return true;

      if (child instanceof Element && child.contains(target)) {
        return walk(child);
      }

      chunks.push(child.textContent ?? "");
    }
    return false;
  };

  walk(root);
  return chunks.join(" ");
}

function findXPostTitle(doc: Document, url: string): string | undefined {
  const hostname = new URL(url).hostname;
  if (!isXHostname(hostname) || !new URL(url).pathname.includes("/status/")) return undefined;

  const metadataTitle = findXMetadataTitle(doc);
  if (metadataTitle) return metadataTitle;

  const articleTitle = findXArticleHeadingTitle(doc);
  if (articleTitle) return articleTitle;

  const tweet = doc.querySelector("[data-testid='tweetText']");
  if (!tweet) return undefined;

  const line = firstTextLine(tweet);
  if (!line) return undefined;

  return line.length > 90 ? `${line.slice(0, 87)}...` : line;
}

function findXMetadataTitle(doc: Document): string | undefined {
  const raw = findDocumentMetadataTitle(doc);
  if (!raw) return undefined;

  return cleanXTitleCandidate(raw);
}

function findXArticleHeadingTitle(doc: Document): string | undefined {
  const article = doc.querySelector("article[data-testid='tweet'], article");
  if (!article) return undefined;

  const headings = Array.from(article.querySelectorAll("h1, [role='heading'], [data-testid*='title' i]"))
    .map((node) => normalizeWhitespace(node.textContent ?? ""))
    .map(cleanXTitleCandidate)
    .filter(Boolean) as string[];
  return headings.find((heading) => !isXPageChromeTitle(heading));
}

function cleanXTitleCandidate(raw: string): string | undefined {
  const text = normalizeWhitespace(raw)
    .replace(/\s+[/-]\s+X$/iu, "")
    .trim();
  if (!text || isXPageChromeTitle(text) || text.startsWith("@")) return undefined;

  const quoted = text.match(/^[^:：]{1,80}(?:\s+on\s+X|在\s*X\s*上)?\s*[:：]\s*[“"'](.+?)[”"']?$/iu)?.[1];
  const candidate = normalizeWhitespace(quoted || text);
  return candidate && !isXPageChromeTitle(candidate) ? candidate : undefined;
}

function isXPageChromeTitle(text: string): boolean {
  return /^(x|twitter|文章|post|posts|home|timeline|notifications|messages)$/iu.test(text);
}

function stripLeadingXArticleChrome(markdown: string, context: { author?: string; title?: string }): string {
  const author = normalizeWhitespace(context.author ?? "");
  const handle = author.split(" ").find((part) => part.startsWith("@")) ?? "";
  const authorName = normalizeWhitespace(author.replace(handle, ""));
  const title = normalizeWhitespace(context.title ?? "");
  const lines = markdown.split("\n");

  while (lines.length) {
    const normalized = normalizeMarkdownLineForComparison(lines[0] ?? "");
    if (!normalized) {
      lines.shift();
      continue;
    }

    if (
      isSameXChromeLine(normalized, authorName) ||
      isSameXChromeLine(normalized, handle) ||
      isSameXChromeLine(normalized, author) ||
      isSameXChromeLine(normalized, title) ||
      isNumericXMetricLine(normalized)
    ) {
      lines.shift();
      continue;
    }

    break;
  }

  return lines.join("\n");
}

function normalizeMarkdownLineForComparison(line: string): string {
  return normalizeWhitespace(line.replace(/^#{1,6}\s+/u, "").replace(/^[-*]\s+/u, "").replace(/[*_`]/gu, ""));
}

function isSameXChromeLine(line: string, expected: string): boolean {
  return Boolean(expected) && line.toLocaleLowerCase() === expected.toLocaleLowerCase();
}

function isNumericXMetricLine(line: string): boolean {
  return /^\d{1,3}(?:[,\s]\d{3})*$/.test(line);
}

function firstTextLine(node: Node): string | undefined {
  const lines: string[] = [];
  let current = "";

  const walk = (child: Node): void => {
    if (child.nodeType === Node.TEXT_NODE) {
      current += child.textContent ?? "";
      return;
    }

    if (!(child instanceof Element)) return;
    if (child.tagName.toLowerCase() === "br") {
      pushLine();
      return;
    }

    for (const nested of Array.from(child.childNodes)) walk(nested);

    if (["div", "p"].includes(child.tagName.toLowerCase())) pushLine();
  };

  const pushLine = (): void => {
    const text = normalizeWhitespace(current);
    if (text) lines.push(text);
    current = "";
  };

  for (const child of Array.from(node.childNodes)) walk(child);
  pushLine();

  return lines[0];
}

function isXHostname(hostname: string): boolean {
  return hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com");
}

// Steam 创意工坊物品页（steamcommunity.com/sharedfiles/filedetails/?id=...）：
// 页面真实正文在 .workshopItemDescription 描述区，其余是 tabs/侧栏/DLC/订阅等
// UI 骨架（含 display:none 的违规/不兼容通知），全部不进摘要。
function extractSteamWorkshopPage(doc: Document, url: string): { title: string; text: string; facts: SourceExtractionStageFact[] } | undefined {
  const pageUrl = new URL(url || doc.URL || "https://example.com");
  if (!isSteamWorkshopHostname(pageUrl.hostname)) return undefined;
  if (!/^\/sharedfiles\/filedetails\//i.test(pageUrl.pathname)) return undefined;

  const description = doc.querySelector("#highlightContent, .workshopItemDescription");
  if (!description) return undefined;
  const markdown = normalizeMarkdown(nodeToMarkdown(description));
  if (!markdown) return undefined;

  const title = normalizeWhitespace(doc.querySelector(".workshopItemTitle")?.textContent ?? "")
    || normalizeWhitespace(doc.title ?? "")
    || pageUrl.hostname;

  return {
    title,
    text: normalizeMarkdown(`# ${title}\n\n${markdown}`),
    facts: [
      { label: "页面类型", value: "steam-workshop" },
      { label: "已选描述区", value: describeElement(description) }
    ]
  };
}

function isSteamWorkshopHostname(hostname: string): boolean {
  return hostname === "steamcommunity.com" || hostname.endsWith(".steamcommunity.com");
}

function isPlaceholderHeading(text: string): boolean {
  return /^(untitled|new (prompt|chat|document|conversation|note))\b/i.test(text);
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeWhitespace(node.textContent ?? "");
  }

  if (!(node instanceof Element)) return "";

  const tag = node.tagName.toLowerCase();
  const children = Array.from(node.childNodes).map(nodeToMarkdown).filter(Boolean);
  const joined = children.join(tag === "p" || tag.startsWith("h") ? "" : "\n").trim();

  switch (tag) {
    case "h1":
      return `# ${normalizeWhitespace(node.textContent ?? "")}\n`;
    case "h2":
      return `## ${normalizeWhitespace(node.textContent ?? "")}\n`;
    case "h3":
      return `### ${normalizeWhitespace(node.textContent ?? "")}\n`;
    case "p":
      return `${normalizeWhitespace(node.textContent ?? "")}\n`;
    case "li":
      return `- ${normalizeWhitespace(node.textContent ?? "")}`;
    case "ul":
    case "ol":
      return `${children.join("\n")}\n`;
    case "blockquote":
      return `${joined
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    case "pre":
    case "code":
      return `\`\`\`\n${node.textContent?.trim() ?? ""}\n\`\`\`\n`;
    case "br":
      return "\n";
    default:
      return joined ? `${joined}\n` : "";
  }
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToPlainText(markdown: string): string {
  return normalizeWhitespace(
    markdown
      .replace(/```[^\n]*\n([\s\S]*?)\n```/gu, "$1")
      .replace(/^#{1,6}\s+/gmu, "")
      .replace(/^\s*[-*]\s+/gmu, "")
      .replace(/^\s*\d+[.)]\s+/gmu, "")
      .replace(/^>\s?/gmu, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
      .replace(/[*_`]/gu, "")
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function platformDiagnostics(
  doc: Document,
  payload: SourcePayload,
  selectedRoot: string,
  facts: SourceExtractionStageFact[] = [],
  options: Pick<ReadableExtractionDiagnostics, "lowConfidence" | "lowConfidenceDetail"> = {}
): ReadableExtractionDiagnostics {
  return {
    bodyTextLength: safeTextLength(doc.body ?? doc.documentElement),
    selectedTextLength: normalizeWhitespace(payload.text).length,
    selectedRoot,
    candidateCount: 0,
    candidates: [],
    removedNodeCounts: Object.fromEntries(boilerplateGroups.map((group) => [group.key, 0])) as Record<BoilerplateGroupKey, number>,
    mergedBlockCount: 1,
    facts,
    ...options
  };
}

function safeTextLength(element: Element | null): number {
  return normalizeWhitespace(element?.textContent ?? "").length;
}

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).slice(0, 3).map((className) => `.${className}`).join("");
  return `${tag}${id}${classes}`;
}
interface SchemaOrgArticle { text: string; title: string; }

function extractSchemaOrgArticle(doc: Document): SchemaOrgArticle | undefined {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));
  const items: unknown[] = [];
  for (const script of scripts) {
    let content = script.textContent ?? "";
    try {
      content = content
        .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")
        .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
        .trim();
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["@graph"])) {
        items.push(...((parsed as Record<string, unknown>)["@graph"] as unknown[]));
      } else {
        items.push(parsed);
      }
    } catch {
      // 忽略解析失败的 JSON-LD 块
    }
  }
  if (!items.length) return undefined;
  const found = findSchemaOrgArticleIn(items);
  if (!found) return undefined;
  return { text: schemaOrgTextToPlain(found.text, doc), title: found.title };
}

type SchemaOrgArticleHit = { text: string; title: string };

function findSchemaOrgArticleIn(items: unknown, depth = 0): SchemaOrgArticleHit | undefined {
  if (!items || depth > 10) return undefined;
  const list = Array.isArray(items) ? items : [items];
  for (const item of list) {
    if (Array.isArray(item)) {
      const found = findSchemaOrgArticleIn(item, depth + 1);
      if (found) return found;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const textValue =
      typeof obj.text === "string" ? obj.text
      : typeof obj.articleBody === "string" ? obj.articleBody
      : "";
    if (textValue.trim()) {
      return { text: textValue, title: typeof obj.headline === "string" ? obj.headline : "" };
    }
    if (Array.isArray(obj["@graph"])) {
      const found = findSchemaOrgArticleIn(obj["@graph"], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function schemaOrgTextToPlain(text: string, doc: Document): string {
  const container = doc.createElement("div");
  container.innerHTML = text;
  return normalizeWhitespace(container.textContent ?? "");
}

function countWords(text: string): number {
  // 按有效字符数计数（对无空格分词的中文/日文也成立），仅用于内容量比例判断
  return text.replace(/\s+/g, "").length;
}

function removeTextPatternBoilerplate(doc: Document): number {
  let removed = 0;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("p,div,span,li,h1,h2,h3"))) {
    if (el.matches(MAIN_CONTENT_SELECTOR) || el.querySelector(MAIN_CONTENT_SELECTOR)) continue;
    const text = normalizeWhitespace(el.textContent ?? "");
    if (!text || text.length > 120) continue;
    if (el.querySelector("img,picture")) continue;
    if (!isTextBoilerplate(text)) continue;
    el.remove();
    removed += 1;
  }
  return removed;
}

function isTextBoilerplate(text: string): boolean {
  // 社交计数：`12 Likes` / `3 赞`
  if (/^\d{1,6}\s+(?:Likes?|Comments?|Shares?|Retweets?|Reposts?|Restacks?|赞|评论|分享|人已读)$/iu.test(text)) return true;
  // 精确样板短短语
  if (/^(?:Leave a (?:comment|reply)|Comments?|pinned|Loading\.\.\.|Share this|Follow us)$/iu.test(text)) return true;
  // newsletter 提示（成对关键词，短块）——与 removeBoilerplate 的 newsletter 组互补（该组靠类名）
  if (/(?:subscribe|sign[- ]?up|get (?:the )?(?:latest|updates)|不要错过|订阅)[\s\S]{0,40}(?:newsletter|email|简报|资讯)/iu.test(text)) return true;
  if (/订阅[\s\S]{0,40}(?:电子报|推送|周刊)/u.test(text)) return true;
  // byline：`By <Name>` / `Posted by <Name>` 开头。`By <4位年份>` 视为正文句子，不删。
  if (text.length <= 80 && /^(?:posted\s+)?by\s+(?!\d{4})\S/iu.test(text)) return true;
  // 独立日期行（可含 read time）：剔除日期/词/标点后余留极短 → 元数据行而非正文
  const HAS_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{4}-\d{1,2}-\d{1,2}/iu;
  if (HAS_DATE.test(text)) {
    const residual = text
      .replace(HAS_DATE, " ")
      .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/giu, " ")
      .replace(/\b\d+(?:st|nd|rd|th)?\b|\b\d+\s*min(?:ute)?s?\b|\bread(?:ing)?\s*time\b|\bmin(?:ute)?s?\b|\bread\b/giu, " ")
      .replace(/[|·•–—\-,:.\s]+/g, "");
    if (residual.length < 8) return true;
  }
  return false;
}

// —— defuddle `scoreNonContentBlock` 文本特征导航移除（removals/scoring.js）——
// 不依赖 class 名，靠块内导航指示词 + 链接密度的负分，负分则整块移除，
// 用于兜住首页/聚合页无 class 的导航墙与侧边栏（defuddle-text-feature-removal）。
const NAV_INDICATOR_PATTERNS = [
  "advertisement", "all rights reserved", "banner", "cookie", "comments",
  "copyright", "follow me", "follow us", "footer", "header", "homepage",
  "login", "menu", "more articles", "more like this", "most read", "nav",
  "navigation", "newsletter", "popular", "privacy", "recommended", "register",
  "related", "responses", "share", "sidebar", "sign in", "sign up", "signup",
  "social", "sponsored", "subscribe", "terms", "trending",
].map((word) => new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i"));

const SOCIAL_LINK_REGEX =
  /linkedin\.com\/(?:in|company)\/|twitter\.com\/(?!intent\b)\w|x\.com\/(?!intent\b)\w|facebook\.com\/(?!share\b)\w|instagram\.com\/\w|threads\.net\/\w|mastodon\.\w/i;

const TEXT_BLOCK_SELECTOR = "div,section,article,main,aside,header,footer,nav";

const NON_CONTENT_CLASS_FEATURES = [
  "advert", "ad-", "ads", "banner", "cookie", "copyright", "footer", "header",
  "homepage", "menu", "nav", "newsletter", "popular", "privacy", "recommended",
  "related", "rights", "sidebar", "social", "sponsored", "subscribe",
  "terms", "trending", "widget",
];

function isLikelyContentBlock(element: Element): boolean {
  const role = (element.getAttribute("role") ?? "").toLowerCase();
  const tag = element.tagName.toLowerCase();
  if (role === "main" || role === "contentinfo" || role === "article") return true;
  // `<main>`/`<article>` 语义标签即内容区（隐式 role 拿不到），绝不当作导航移除
  if (tag === "main" || tag === "article") return true;
  const className = (element.className && typeof element.className === "string")
    ? element.className.toLowerCase()
    : "";
  const id = element.id.toLowerCase();
  if (/\b(content|article|post|entry|main)\b/.test(className) || /\b(content|article|post|entry|main)\b/.test(id)) return true;
  if (element.querySelector("pre, table, figure, picture")) return true;
  // defuddle isLikelyContent 导航标题检测：块内标题若为导航指示词（Most read/More like this…）
  // 且无实质段落，则整块仍是导航，不进内容保护
  const chars = countWords(element.textContent ?? "");
  const para = element.getElementsByTagName("p").length + element.getElementsByTagName("li").length;
  for (const heading of element.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const hText = normalizeWhitespace(heading.textContent ?? "").trim().toLowerCase();
    if (hText && NAV_INDICATOR_PATTERNS.some((pattern) => pattern.test(hText))) {
      if (!(chars > 50 && para > 1)) return false;
    }
  }
  // defuddle isLikelyContent 段落信号：有段落 + 足够篇幅都是正文，绝不当作导航移除
  if (chars > 50 && para > 1) return true;
  if (chars > 100) return true;
  if (chars > 30 && para > 0) return true;
  return false;
}

function scoreTextBlock(element: Element): number {
  let score = 0;
  const text = normalizeWhitespace(element.textContent ?? "");
  const chars = countWords(text);
  if (chars < 3) return 0;
  score += text.split(",").length - 1;
  const lower = text.toLowerCase();
  for (const pattern of NAV_INDICATOR_PATTERNS) {
    if (pattern.test(lower)) score -= 10;
  }
  const links = Array.from(element.getElementsByTagName("a"));
  const linkCount = links.length;
  if (linkCount / Math.max(chars, 1) > 0.5) score -= 15;
  if (linkCount > 1 && chars < 80) {
    const linkText = links.reduce((sum, link) => sum + (link.textContent ?? "").length, 0);
    if (linkText / (text.length || 1) > 0.8) score -= 15;
  }
  const lists = element.getElementsByTagName("ul").length + element.getElementsByTagName("ol").length;
  if (lists > 0 && linkCount > 3 * lists) score -= 10;
  if (chars < 80 && links.some((link) => SOCIAL_LINK_REGEX.test((link.getAttribute("href") ?? "").toLowerCase()))) {
    score -= 15;
  }
  const className = (element.className && typeof element.className === "string")
    ? element.className.toLowerCase()
    : "";
  const id = element.id.toLowerCase();
  for (const feature of NON_CONTENT_CLASS_FEATURES) {
    if (className.includes(feature) || id.includes(feature)) score -= 8;
  }
  return score;
}

function removeNavBlocksByText(doc: Document): void {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR));
  for (const element of candidates) {
    if (isLikelyContentBlock(element)) continue;
    // 不删除包含语义正文标签(main/article/[role='main'])的容器
    if (element.querySelector(MAIN_CONTENT_SELECTOR)) continue;
    if (element.closest("pre, code, td, th")) continue;
    if (scoreTextBlock(element) < 0) element.remove();
  }
}


// —— defuddle `flattenShadowRoots` 移植（task defuddle-shadow）——
// content script 跑在 live DOM：doc.cloneNode(true) 不复制 shadow root（shadow 内容不序列化），
// 正文会从自定义元素里丢失。此处从 live doc 读各元素 shadowRoot.innerHTML 填回 clone 对应宿主。
function flattenShadowRoots(live: Document, clone: Document): void {
  if (!live.body || !clone.body) return;
  const liveEls = Array.from(live.body.querySelectorAll("*"));
  const firstWithShadow = liveEls.find((el) => el.shadowRoot);
  if (!firstWithShadow) return;
  // content script 隔离 world 有时 shadowRoot 存在但内容空（defuddle 同款检查）；
  // 读得到才摊平，否则交给外部主世界脚本（data-defuddle-shadow）处理。
  if ((firstWithShadow.shadowRoot?.childNodes?.length ?? 0) === 0) return;
  const cloneEls = Array.from(clone.body.querySelectorAll("*"));
  if (liveEls.length !== cloneEls.length) return;
  for (let i = liveEls.length - 1; i >= 0; i--) {
    const orig = liveEls[i] as Element & { shadowRoot?: ShadowRoot };
    if (!orig.shadowRoot) continue;
    const target = cloneEls[i];
    if (!target) continue;
    const html = orig.shadowRoot.innerHTML;
    if (html.length > 0) replaceShadowHost(target, html, clone);
  }
}

function replaceShadowHost(el: Element, shadowHtml: string, doc: Document): void {
  const template = doc.createElement("template");
  template.innerHTML = shadowHtml;
  const fragment = template.content;
  // 自定义元素（tag 含 `-`）替换为 div，防样品被当作宿主重新初始化
  if (el.tagName.includes("-")) {
    const div = doc.createElement("div");
    div.appendChild(fragment);
    el.parentNode?.replaceChild(div, el);
  } else {
    el.textContent = "";
    el.appendChild(fragment);
  }
}
