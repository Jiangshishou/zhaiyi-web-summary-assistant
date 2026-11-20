/* 封面兜底：站点 CSP 或防盗链会拦掉直接加载的封面图。
   这里只做两件纯事：把后台取回的字节转成内联地址，以及把一次兜底尝试收敛成「有结果 / 没有结果」。
   触发时机与 DOM 处置留在面板侧，便于单独测试这两条判定。 */

export function bufferToDataUrl(bytes: ArrayBuffer, contentType?: string): string | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined;
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  // 只认图片：后台通道拿回来的可能是 HTML 错误页，别把它当图片塞进 src
  if (!type.startsWith("image/")) return undefined;
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < view.length; index += chunk) {
    binary += String.fromCharCode(...view.subarray(index, index + chunk));
  }
  try {
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

export async function resolveCoverDataUrl(
  url: string,
  fetchBinary: (target: string) => Promise<{ bytes: ArrayBuffer; contentType?: string }>
): Promise<string | undefined> {
  try {
    const { bytes, contentType } = await fetchBinary(url);
    return bufferToDataUrl(bytes, contentType);
  } catch {
    return undefined;
  }
}
