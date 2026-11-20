export function findAuthorAvatar(doc: Document, pageUrl: string): string | undefined {
  const hostname = new URL(pageUrl).hostname;

  // GitHub repository pages: prefer the owner avatar, not the repository social preview image.
  if (hostname === "github.com") {
    const owner = extractGitHubOwner(pageUrl);
    if (!owner) return undefined;

    const ownerPath = `/${owner}`;
    const avatar =
      doc.querySelector<HTMLImageElement>(`a[href='${ownerPath}'] img.avatar`)?.src ||
      doc.querySelector<HTMLImageElement>(`a[data-hovercard-url='/users/${owner}/hovercard'] img.avatar`)?.src ||
      doc.querySelector<HTMLImageElement>(".AppHeader-context-item img.avatar")?.src;

    return avatar || `https://github.com/${owner}.png?size=80`;
  }

  // Bilibili: .up-avatar img
  if (hostname.includes("bilibili.com")) {
    const avatar =
      doc.querySelector<HTMLImageElement>(".up-avatar img, .up-avatar-wrap img, #v_upinfo .up-avatar img")?.src;
    return avatar;
  }

  // YouTube: #owner-avatar img or #avatar img (channel/author avatar)
  if (hostname.includes("youtube.com")) {
    const avatar =
      doc.querySelector<HTMLImageElement>("#owner #avatar img, ytd-video-owner-renderer #avatar img")?.src;
    return avatar;
  }

  if (isRedditHost(hostname)) {
    const avatar = findRedditCommunityIcon(doc, pageUrl);
    if (avatar) return avatar;
  }

  // X/Twitter: author avatar in article or profile
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
    const avatar =
      doc.querySelector<HTMLImageElement>("article img[src*='/profile_images/']")?.src ||
      doc.querySelector<HTMLImageElement>("[data-testid='Tweet-User-Avatar'] img")?.src;
    return avatar;
  }

  if (isDiscourseTopicHost(hostname, doc)) {
    const avatar =
      doc.querySelector<HTMLImageElement>(
        "article[id='post_1'] .topic-avatar img.avatar, article[id='post_1'] .topic-avatar img, .topic-post .topic-avatar img.avatar, .topic-post .topic-avatar img"
      )?.src;
    return avatar;
  }

  // 微信公众号: #js_profile_qrcode img
  if (hostname.includes("mp.weixin.qq.com")) {
    const avatar =
      doc.querySelector<HTMLImageElement>("#js_profile_qrcode img, .profile_avatar img")?.src;
    return avatar;
  }

  // 知乎: author avatar in article header
  if (hostname.includes("zhihu.com")) {
    const avatar =
      doc.querySelector<HTMLImageElement>(".AuthorInfo-avatar img, .Avatar img")?.src;
    return avatar;
  }

  return undefined;
}

function extractGitHubOwner(pageUrl: string): string | undefined {
  const [, owner, repo] = new URL(pageUrl).pathname.split("/");
  if (!owner || !repo) return undefined;
  return owner;
}

function isDiscourseTopicHost(hostname: string, doc: Document): boolean {
  return hostname === "linux.do" ||
    hostname.endsWith(".linux.do") ||
    Boolean(doc.querySelector("meta[name='generator'][content*='Discourse'], article[id^='post_'] .topic-meta-data"));
}

function isRedditHost(hostname: string): boolean {
  return hostname === "reddit.com" || hostname.endsWith(".reddit.com");
}

function findRedditCommunityIcon(doc: Document, pageUrl: string): string | undefined {
  const subreddit = findRedditSubredditName(doc, pageUrl);
  if (!subreddit) return undefined;

  const matchingPost = Array.from(doc.querySelectorAll("shreddit-post"))
    .find((post) => normalizeRedditSubredditName(post.getAttribute("subreddit-prefixed-name")) === subreddit);
  if (matchingPost) {
    const iconFromAttribute = readFirstUrlAttribute(matchingPost, [
      "subreddit-icon",
      "subredditIcon",
      "community-icon",
      "communityIcon",
      "icon"
    ], pageUrl);
    if (iconFromAttribute) return iconFromAttribute;

    const iconFromPost = matchingPost.querySelector<HTMLImageElement>(
      "img[slot='subredditIcon'], [slot='subredditIcon'] img, img[slot='communityIcon'], [slot='communityIcon'] img, shreddit-subreddit-icon img, [data-testid='subreddit-icon'] img"
    )?.src;
    if (iconFromPost) return iconFromPost;
  }

  const directIcon = doc.querySelector<HTMLImageElement>(
    "shreddit-subreddit-icon img, [data-testid='subreddit-icon'] img, img[slot='subredditIcon'], [slot='subredditIcon'] img, img[slot='communityIcon'], [slot='communityIcon'] img"
  )?.src;
  if (directIcon) return directIcon;

  return Array.from(doc.querySelectorAll<HTMLImageElement>("img"))
    .find((img) => imageBelongsToSubreddit(img, subreddit))
    ?.src;
}

function findRedditSubredditName(doc: Document, pageUrl: string): string | undefined {
  const pathSubreddit = new URL(pageUrl).pathname.match(/^\/r\/([^/]+)/i)?.[1];
  if (pathSubreddit) return `r/${decodeURIComponent(pathSubreddit)}`;

  const postSubreddit = doc.querySelector("shreddit-post")?.getAttribute("subreddit-prefixed-name");
  return normalizeRedditSubredditName(postSubreddit);
}

function normalizeRedditSubredditName(value: string | null | undefined): string | undefined {
  const text = value?.trim().replace(/^\/+/, "");
  if (!text) return undefined;
  const name = text.match(/^r\/([^/\s]+)/i)?.[1] ?? text.match(/^([^/\s]+)$/)?.[1];
  return name ? `r/${name}` : undefined;
}

function readFirstUrlAttribute(element: Element, attributes: string[], baseUrl: string): string | undefined {
  for (const attribute of attributes) {
    const url = normalizeImageUrl(element.getAttribute(attribute), baseUrl);
    if (url) return url;
  }
  return undefined;
}

function normalizeImageUrl(value: string | null, baseUrl: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    return new URL(text, baseUrl).href;
  } catch {
    return text;
  }
}

function imageBelongsToSubreddit(img: HTMLImageElement, subreddit: string): boolean {
  const subredditLower = subreddit.toLowerCase();
  const subredditName = subredditLower.replace(/^r\//, "");
  const closestLink = img.closest("a")?.getAttribute("href") ?? "";
  const closestLabel = img.closest("[aria-label]")?.getAttribute("aria-label") ?? "";
  const label = [
    img.alt,
    img.getAttribute("aria-label"),
    img.getAttribute("title"),
    closestLink,
    closestLabel
  ].join(" ").toLowerCase();

  return label.includes(subredditLower) || (label.includes(subredditName) && label.includes("icon"));
}
