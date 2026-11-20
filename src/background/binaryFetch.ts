export async function fetchSourceBinary(url: string): Promise<{ url: string; bytes: ArrayBuffer; contentType?: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只支持读取 HTTP/HTTPS 来源。");
  }
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`来源读取失败：HTTP ${response.status}`);
  }
  return {
    url: response.url || url,
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? undefined
  };
}
