import { applyNoTranslate } from "./noTranslate";

type ToastKind = "info" | "success" | "error";

let toastRoot: HTMLElement | null = null;
let currentTheme: "light" | "dark" = "dark";

const TOAST_DURATION = 2500;
const ENTER_MS = 300;
const EXIT_MS = 400;

const TOAST_CSS = `
.ym-toast-container {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 15%;
  z-index: 99999;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.ym-toast {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--ym-toast-bg);
  color: var(--ym-toast-text);
  border: 1px solid var(--ym-toast-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px var(--ym-toast-shadow);
  font-family: var(--ym-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  pointer-events: auto;
  opacity: 0;
  transform: scale(0.9);
  transform-origin: center;
  transition: transform ${ENTER_MS}ms var(--ym-ease-out, ease-out), opacity ${ENTER_MS}ms var(--ym-ease-out, ease-out);
}
.ym-toast.ym-toast-visible {
  opacity: 1;
  transform: scale(1);
}
.ym-toast.ym-toast-exit {
  opacity: 0;
  transform: scale(0.9);
  transition: transform ${EXIT_MS}ms var(--ym-ease-out, ease-out), opacity ${EXIT_MS}ms var(--ym-ease-out, ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .ym-toast {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .ym-toast.ym-toast-exit {
    opacity: 0;
  }
}
`;

function icon(kind: ToastKind): string {
  if (kind === "success") {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style="color: var(--ym-toast-success);"><path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (kind === "error") {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style="color: var(--ym-toast-danger);"><path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return "";
}

function themeVars(theme: "light" | "dark"): string {
  if (theme === "light") {
    return `
      --ym-toast-bg: rgba(255, 255, 255, 0.95);
      --ym-toast-text: #2f2f2d;
      --ym-toast-border: #eaeaea;
      --ym-toast-shadow: rgba(60, 52, 40, 0.10);
      --ym-toast-accent: #5a8a91;
      --ym-toast-danger: #d97070;
      --ym-toast-success: #7a9a72;
    `;
  }
  return `
    --ym-toast-bg: rgba(40, 40, 40, 0.95);
    --ym-toast-text: #eae8e4;
    --ym-toast-border: rgba(255,255,255,0.08);
    --ym-toast-shadow: rgba(40, 36, 32, 0.22);
    --ym-toast-accent: #6ba8b0;
    --ym-toast-danger: #d97070;
    --ym-toast-success: #7a9a72;
  `;
}

export function mountToaster(root: ShadowRoot): void {
  if (toastRoot) return;

  const host = root.host as HTMLElement;
  currentTheme = host.getAttribute("data-theme") === "light" ? "light" : "dark";

  const style = document.createElement("style");
  style.textContent = TOAST_CSS;
  root.appendChild(style);

  const container = document.createElement("div");
  container.className = "ym-toast-container";
  container.setAttribute("style", themeVars(currentTheme));
  applyNoTranslate(container);
  root.appendChild(container);
  toastRoot = container;

  new MutationObserver(() => {
    const next: "light" | "dark" = host.getAttribute("data-theme") === "light" ? "light" : "dark";
    if (next !== currentTheme) {
      currentTheme = next;
      container.setAttribute("style", themeVars(next));
    }
  }).observe(host, { attributes: true, attributeFilter: ["data-theme"] });
}

export function showToast(text: string, kind: ToastKind = "info"): void {
  if (!toastRoot) return;

  const el = document.createElement("div");
  el.className = "ym-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  applyNoTranslate(el);
  el.innerHTML = `${icon(kind)}<span>${text}</span>`;
  toastRoot.appendChild(el);

  // 入场：rAF 触发 transition（可中断，可 retarget）
  requestAnimationFrame(() => el.classList.add("ym-toast-visible"));

  // 出场定时器
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleExit = (delay: number): void => {
    if (exitTimer) clearTimeout(exitTimer);
    exitTimer = setTimeout(() => {
      el.classList.remove("ym-toast-visible");
      el.classList.add("ym-toast-exit");
      setTimeout(() => el.remove(), EXIT_MS);
    }, delay);
  };

  scheduleExit(TOAST_DURATION);

  // hover 暂停
  el.addEventListener("mouseenter", () => {
    if (exitTimer) clearTimeout(exitTimer);
  });

  el.addEventListener("mouseleave", () => {
    scheduleExit(500);
  });
}
