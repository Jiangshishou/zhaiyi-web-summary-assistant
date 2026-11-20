import type { TabRequest } from "../shared/messages";
import { isErrorResponse } from "../shared/errorResponse";

type TabLike = Pick<chrome.tabs.Tab, "id" | "url" | "pendingUrl">;

export type OpenPanelChromeApi = {
  tabs: {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<TabLike[]>;
    sendMessage(tabId: number, message: TabRequest): Promise<unknown>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
  action: {
    setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void>;
    setTitle(details: { tabId?: number; title: string }): Promise<void>;
  };
};

type OpenPanelResult =
  | { ok: true; injected: boolean }
  | { ok: false; reason: "missing-tab" | "unsupported-url" | "inject-failed"; error?: unknown };

const OPEN_PANEL_TITLE = "生成摘要";
const UNSUPPORTED_PAGE_TITLE = "这个页面不能用摘意，请在普通网页上试";
const INJECTION_FAILED_TITLE = "无法在这个页面打开浮窗，请刷新后重试";

export async function openPanelInActiveTab(
  api: OpenPanelChromeApi,
  autoSummarize: boolean,
  animate = true,
  messageOverride?: TabRequest
): Promise<OpenPanelResult> {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return openPanelInTab(api, tab, autoSummarize, animate, messageOverride);

  const [currentWindowTab] = await api.tabs.query({ active: true, currentWindow: true });
  return openPanelInTab(api, currentWindowTab, autoSummarize, animate, messageOverride);
}

export async function openPanelInTab(
  api: OpenPanelChromeApi,
  tab: TabLike | undefined,
  autoSummarize: boolean,
  animate = true,
  messageOverride?: TabRequest
): Promise<OpenPanelResult> {
  if (!tab?.id) return { ok: false, reason: "missing-tab" };

  if (!isInjectableTabUrl(tab.url ?? tab.pendingUrl ?? "")) {
    await tryMarkActionWarning(api, tab.id, UNSUPPORTED_PAGE_TITLE);
    return { ok: false, reason: "unsupported-url" };
  }

  const message: TabRequest = messageOverride ?? { type: "YM_OPEN_PANEL", autoSummarize, animate };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["assets/content.js"]
      });
    } catch (error) {
      await tryMarkActionWarning(api, tab.id, INJECTION_FAILED_TITLE);
      return { ok: false, reason: "inject-failed", error };
    }

    try {
      const response = await api.tabs.sendMessage(tab.id, message);
      if (isErrorResponse(response)) throw new Error(response.error);
      await tryClearActionWarning(api, tab.id);
      return { ok: true, injected: true };
    } catch (error) {
      if (attempt === 0 && isMissingContentReceiverError(error)) continue;
      await tryMarkActionWarning(api, tab.id, INJECTION_FAILED_TITLE);
      return { ok: false, reason: "inject-failed", error };
    }
  }

  return { ok: false, reason: "inject-failed" };
}

export function isInjectableTabUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isChromeWebStoreUrl(parsed);
  } catch {
    return false;
  }
}

async function clearActionWarning(api: OpenPanelChromeApi, tabId: number): Promise<void> {
  await Promise.all([
    api.action.setBadgeText({ tabId, text: "" }),
    api.action.setTitle({ tabId, title: OPEN_PANEL_TITLE })
  ]);
}

async function tryClearActionWarning(api: OpenPanelChromeApi, tabId: number): Promise<void> {
  try {
    await clearActionWarning(api, tabId);
  } catch {
    // Badge cleanup is best effort; opening the panel already succeeded.
  }
}

async function tryMarkActionWarning(api: OpenPanelChromeApi, tabId: number, title: string): Promise<void> {
  try {
    await markActionWarning(api, tabId, title);
  } catch {
    // Preserve the original injection error for the caller.
  }
}

async function markActionWarning(api: OpenPanelChromeApi, tabId: number, title: string): Promise<void> {
  await Promise.all([
    api.action.setBadgeBackgroundColor({ tabId, color: "#d97706" }),
    api.action.setBadgeText({ tabId, text: "!" }),
    api.action.setTitle({ tabId, title })
  ]);
}

function isChromeWebStoreUrl(url: URL): boolean {
  return (
    url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")
  ) || url.hostname === "chromewebstore.google.com";
}

function isMissingContentReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Receiving end does not exist") || message.includes("Could not establish connection");
}
