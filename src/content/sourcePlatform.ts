type SourcePlatform = "youtube" | "bilibili" | "douyin" | "page";

export type SourcePageClassification = {
  platform: SourcePlatform;
  transcriptCandidate: boolean;
};

export function classifySourcePage(pageUrl: string): SourcePageClassification {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return { platform: "page", transcriptCandidate: false };
  }

  if (isYouTubeHost(url.hostname)) {
    return { platform: "youtube", transcriptCandidate: isYouTubeVideoUrl(url) };
  }

  if (isBilibiliHost(url.hostname)) {
    return { platform: "bilibili", transcriptCandidate: isBilibiliVideoUrl(url) };
  }

  if (isDouyinHost(url.hostname)) {
    return { platform: "douyin", transcriptCandidate: isDouyinDetailUrl(url) };
  }

  return { platform: "page", transcriptCandidate: false };
}

function isYouTubeHost(hostname: string): boolean {
  return (
    hostname === "youtu.be" ||
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "youtube-nocookie.com" ||
    hostname.endsWith(".youtube-nocookie.com")
  );
}

function isYouTubeVideoUrl(url: URL): boolean {
  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return Boolean(videoId);
  }

  const watchId = url.searchParams.get("v");
  if (url.pathname === "/watch" && Boolean(watchId)) return true;

  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return (kind === "shorts" || kind === "embed" || kind === "live") && Boolean(id);
}

function isBilibiliHost(hostname: string): boolean {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function isBilibiliVideoUrl(url: URL): boolean {
  return /^\/video\/(?:BV[^/?]+|av\d+)/iu.test(url.pathname);
}

function isDouyinHost(hostname: string): boolean {
  return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
}

function isDouyinDetailUrl(url: URL): boolean {
  if (url.hostname === "v.douyin.com") {
    return Boolean(url.pathname.split("/").filter(Boolean)[0]);
  }

  if (url.searchParams.has("modal_id")) return true;

  const [first, second, third] = url.pathname.split("/").filter(Boolean);
  if ((first === "video" || first === "note") && Boolean(second)) return true;
  return first === "share" && (second === "video" || second === "note") && Boolean(third);
}
