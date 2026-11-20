export function renderLucideIcon(icon: "captions" | "check" | "chevron-down" | "copy" | "download" | "external-link" | "eye" | "eye-off" | "file-text" | "languages" | "locate-fixed" | "navigation" | "plus" | "refresh-cw" | "save" | "search" | "settings" | "sparkles" | "trash-2" | "x"): string {
  const paths = {
    captions: `
      <rect width="18" height="14" x="3" y="5" rx="2"></rect>
      <path d="M7 15h4"></path>
      <path d="M15 15h2"></path>
      <path d="M7 11h2"></path>
      <path d="M13 11h4"></path>
    `,
    "chevron-down": `
      <path d="m6 9 6 6 6-6"></path>
    `,
    check: `
      <path d="M20 6 9 17l-5-5"></path>
    `,
    copy: `
      <rect x="8" y="8" width="10" height="10" rx="2"></rect>
      <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
    `,
    download: `
      <path d="M12 15V3"></path>
      <path d="m7 10 5 5 5-5"></path>
      <path d="M5 19h14"></path>
    `,
    "external-link": `
      <path d="M15 3h6v6"></path>
      <path d="M10 14 21 3"></path>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    `,
    "file-text": `
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M16 13H8"></path>
      <path d="M16 17H8"></path>
      <path d="M10 9H8"></path>
    `,
    eye: `
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `,
    "eye-off": `
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path>
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path>
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path>
      <path d="m2 2 20 20"></path>
    `,
    languages: `
      <path d="m5 8 6 6"></path>
      <path d="m4 14 6-6 2-3"></path>
      <path d="M2 5h12"></path>
      <path d="M7 2h1"></path>
      <path d="m22 22-5-10-5 10"></path>
      <path d="M14 18h6"></path>
    `,
    "locate-fixed": `
      <line x1="3" x2="6" y1="12" y2="12"></line>
      <line x1="18" x2="21" y1="12" y2="12"></line>
      <line x1="12" x2="12" y1="3" y2="6"></line>
      <line x1="12" x2="12" y1="18" y2="21"></line>
      <circle cx="12" cy="12" r="7"></circle>
      <circle cx="12" cy="12" r="3"></circle>
    `,
    navigation: `
      <polygon points="4 12 18 4 13 21 11 13 4 12"></polygon>
    `,
    plus: `
      <path d="M5 12h14"></path>
      <path d="M12 5v14"></path>
    `,
    "refresh-cw": `
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
      <path d="M8 16H3v5"></path>
    `,
    save: `
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
      <path d="M17 21v-7H7v7"></path>
      <path d="M7 3v5h8"></path>
    `,
    search: `
      <path d="m21 21-4.34-4.34"></path>
      <circle cx="11" cy="11" r="8"></circle>
    `,
    settings: `
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.32-1.915"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `,
    sparkles: `
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"></path>
      <path d="M20 3v4"></path>
      <path d="M22 5h-4"></path>
      <path d="M4 17v2"></path>
      <path d="M5 18H3"></path>
    `,
    "trash-2": `
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
      <path d="M3 6h18"></path>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    `,
    x: `
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    `
  };
  return `<svg class="lucide lucide-${icon}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[icon]}</svg>`;
}

export function renderActionIcon(action: string): string {
  if (action === "copy-summary") return renderLucideIcon("copy");
  if (action === "download-summary") return renderLucideIcon("download");
  if (action === "download-source-text") return renderLucideIcon("download");
  if (action === "open-translation-targets") return renderLucideIcon("languages");
  if (action === "translate-subtitles") return renderLucideIcon("languages");
  if (action === "locate-subtitle") return renderLucideIcon("locate-fixed");
  return "";
}

/**
 * 摘要标签的星形标记：和流式生成时那三颗星是同一个四角星（同一套 clip-path 比例），
 * 实心填充。原来的 list-tree 是线性图标，16px 下糊成「一根竖杠 + 三道横」，
 * 读起来像个字母 E；实心四角星在这个尺寸最清楚，也让「摘要」入口与「正在总结」共用一套语言。
 */
export function renderSummaryStarIcon(): string {
  return `<svg class="summary-star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="12,1.5 14.52,9.48 22.5,12 14.52,14.52 12,22.5 9.48,14.52 1.5,12 9.48,9.48" fill="currentColor" stroke="none"></polygon></svg>`;
}

export function renderTranslationLoadingIcon(): string {
  return renderLucideIcon("languages");
}

export function renderStreamingSparkle(): string {
  return `
    <span class="streaming-sparkle" aria-hidden="true">
      <span class="streaming-sparkle-star large"></span>
      <span class="streaming-sparkle-star medium"></span>
      <span class="streaming-sparkle-star small"></span>
    </span>
  `;
}