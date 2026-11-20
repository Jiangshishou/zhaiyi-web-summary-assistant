/** 触发浏览器把一段文本内容下载成本地文件（Blob → 临时链接 → 点击 → 回收）。 */
export function triggerFileDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
