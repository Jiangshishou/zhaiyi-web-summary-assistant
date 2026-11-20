import type { Settings } from "../shared/types";

type ResolvedTheme = "light" | "dark";

export function resolveTheme(settings: Settings): ResolvedTheme {
  if (settings.themeMode === "light" || settings.themeMode === "dark") return settings.themeMode;

  const documentTheme = findDocumentThemeSignal();
  if (documentTheme) return documentTheme;

  const pageBg = findPageBackground();
  if (pageBg) return luminance(pageBg) < 0.45 ? "dark" : "light";

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function findDocumentThemeSignal(): ResolvedTheme | undefined {
  const candidates = [document.documentElement, document.body].filter(Boolean);
  for (const element of candidates) {
    const tokens = [
      element.getAttribute("data-theme"),
      element.getAttribute("data-color-mode"),
      element.getAttribute("data-v-theme"),
      element.className
    ].join(" ").toLowerCase();

    if (/(^|\s)(bili-dark|bilibili-dark|bili-theme-dark|dark-theme|theme-dark|dark)(\s|$)/.test(tokens)) return "dark";
    if (/(^|\s)(bili-light|bilibili-light|bili-theme-light|light-theme|theme-light|light)(\s|$)/.test(tokens)) return "light";
  }
  return undefined;
}

function findPageBackground(): [number, number, number] | undefined {
  const candidates = [document.body, document.documentElement].filter(Boolean);
  for (const element of candidates) {
    const bg = getComputedStyle(element).backgroundColor;
    const rgb = parseRgb(bg);
    if (rgb && !isTransparent(bg)) return rgb;
  }

  // Bilibili / YouTube paint dark backgrounds via CSS variables on :root that
  // resolve to a color only after the page's stylesheet applies; computed style
  // can report `rgba(0,0,0,0)` (transparent) before that. Fall back to the
  // theme-color meta, which video sites set explicitly to reflect player chrome.
  const themeColor = metaThemeColor();
  if (themeColor) return themeColor;

  return undefined;
}

function isTransparent(bg: string): boolean {
  const alpha = bg.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i)?.[1];
  return alpha !== undefined && Number.parseFloat(alpha) === 0;
}

function metaThemeColor(): [number, number, number] | undefined {
  const tag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!tag?.content) return undefined;
  return parseHexOrRgb(tag.content);
}

function parseHexOrRgb(value: string): [number, number, number] | undefined {
  const trimmed = value.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) {
      return [parseInt(digits[0] + digits[0], 16), parseInt(digits[1] + digits[1], 16), parseInt(digits[2] + digits[2], 16)];
    }
    return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16)];
  }
  return parseRgb(trimmed);
}

function parseRgb(value: string): [number, number, number] | undefined {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
