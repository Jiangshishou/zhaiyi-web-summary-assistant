export function findAuthorName(doc: Document, pageUrl: string): string | undefined {
  const hostname = new URL(pageUrl).hostname;

  if (hostname === "github.com") {
    return extractGitHubOwner(pageUrl);
  }

  if (hostname.includes("youtube.com")) {
    return firstText(doc, [
      "ytd-video-owner-renderer #channel-name a",
      "#owner #channel-name a",
      "#upload-info #channel-name a",
      "link[itemprop='name']"
    ]);
  }

  if (hostname.includes("bilibili.com")) {
    return firstText(doc, [
      "#v_upinfo .up-name",
      "#v_upinfo .username",
      ".up-info-container .up-name",
      ".up-name",
      "meta[name='author']"
    ]);
  }

  if (hostname.includes("douyin.com")) {
    return firstText(doc, [
      "[data-e2e='user-title']",
      "[data-e2e='video-author-name']",
      "[class*='author'] [class*='name']"
    ]);
  }

  if (isXHostname(hostname)) {
    return extractXAuthorName(doc);
  }

  if (isDiscourseTopicHost(hostname, doc)) {
    return firstText(doc, [
      "article[id='post_1'] .topic-meta-data .names .full-name",
      "article[id='post_1'] .topic-meta-data .names .first",
      "article[id='post_1'] [data-user-card]",
      ".topic-post .topic-meta-data .names .full-name",
      ".topic-post .topic-meta-data .names .first",
      ".topic-post [data-user-card]"
    ]);
  }

  return firstText(doc, [
    "meta[name='author']",
    "meta[property='article:author']",
    "a[rel='author']",
    ".author",
    "[class*='author-name']"
  ]);
}

function extractXAuthorName(doc: Document): string | undefined {
  const direct = firstText(doc, [
    "article [data-testid='User-Name'] a[role='link'] span span",
    "article [data-testid='User-Name'] span"
  ]);
  if (direct && !direct.startsWith("@")) return direct;

  const block = normalizeAuthorText(doc.querySelector("article [data-testid='User-Name']")?.textContent ?? "");
  if (!block) return undefined;

  const beforeHandle = block.split("@")[0]?.trim();
  return normalizeAuthorText(beforeHandle || block);
}

function isXHostname(hostname: string): boolean {
  return hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com");
}

function isDiscourseTopicHost(hostname: string, doc: Document): boolean {
  return hostname === "linux.do" ||
    hostname.endsWith(".linux.do") ||
    Boolean(doc.querySelector("meta[name='generator'][content*='Discourse'], article[id^='post_'] .topic-meta-data"));
}

function firstText(doc: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    const raw = readNodeText(node);
    const text = normalizeAuthorText(raw);
    if (text) return text;
  }
  return undefined;
}

function readNodeText(node: Element | null): string {
  if (!node) return "";
  if (node instanceof HTMLMetaElement) return node.content || "";
  if (node instanceof HTMLLinkElement) return node.getAttribute("title") || node.getAttribute("content") || "";
  return node.textContent ?? "";
}

function normalizeAuthorText(value: string): string | undefined {
  const text = value.replace(/\s+/g, " ").replace(/^作者[:：]\s*/u, "").trim();
  if (!text || text.length > 80) return undefined;
  return text;
}

function extractGitHubOwner(pageUrl: string): string | undefined {
  const [, owner, repo] = new URL(pageUrl).pathname.split("/");
  if (!owner || !repo) return undefined;
  return owner;
}
