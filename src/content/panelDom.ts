export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.documentElement.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    textarea.remove();
  }
}

export function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

export function clearMotionAttribute(element: HTMLElement, attribute: string, delayMs: number): void {
  window.setTimeout(() => {
    if (element.isConnected) element.removeAttribute(attribute);
  }, delayMs);
}
