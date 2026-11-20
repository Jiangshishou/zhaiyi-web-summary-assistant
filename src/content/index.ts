import { YouMindSummaryPanel } from "./panel";
import { sendRuntimeMessage } from "./sendMessage";
import type { TabRequest, TabResponse } from "../shared/messages";
import type { Settings } from "../shared/types";

declare global {
  interface Window {
    __ymSummaryContentLoaded?: boolean;
    __ymSummaryContentVersion?: string;
  }
}

const contentVersion = chrome.runtime.getManifest().version;

if (!window.__ymSummaryContentLoaded || window.__ymSummaryContentVersion !== contentVersion) {
  boot();
  window.__ymSummaryContentLoaded = true;
  window.__ymSummaryContentVersion = contentVersion;
}

function boot(): void {
  chrome.runtime.onMessage.addListener((message: TabRequest, _sender, sendResponse: (response: TabResponse) => void) => {
    if (message.type === "YM_OPEN_PANEL") {
      void ensurePanel()
        .open(message.autoSummarize, { animate: message.animate !== false })
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }

    if (message.type === "YM_TOGGLE_PANEL") {
      const panel = ensurePanel();
      if (panel.isOpen()) {
        panel.toggle();
        sendResponse({ ok: true });
        return undefined;
      }

      void sendRuntimeMessage({ type: "YM_GET_SETTINGS" })
        .then((settings) => panel.toggle(settings.autoSummarize ?? true))
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }

    if (message.type === "YM_STREAM_CHUNK") {
      if (message.requestId && panelInstance?.element.isConnected) {
        panelInstance.appendStreamChunk(message.chunk, message.requestId);
      }
      return undefined;
    }

    return undefined;
  });

  document.addEventListener("keydown", (event) => {
    if (!matchesShortcut(event, openSummaryShortcut)) return;
    event.preventDefault();
    void openPanelFromShortcut();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshOpenSummaryShortcut();
  });
  void refreshOpenSummaryShortcut();
}

let panelInstance: YouMindSummaryPanel | undefined;
let currentSettings: Settings | undefined;
let openSummaryShortcut = "";

function ensurePanel(): YouMindSummaryPanel {
  if (panelInstance?.element.isConnected) return panelInstance;

  const existing = document.querySelector<HTMLElement>('ym-summary-panel[data-ym-summary-panel-host="true"]');
  const host = existing ?? document.createElement("ym-summary-panel");
  host.dataset.ymSummaryPanelHost = "true";
  panelInstance = new YouMindSummaryPanel(host);
  if (!host.isConnected) document.documentElement.append(host);
  return panelInstance;
}

async function openPanelFromShortcut(): Promise<void> {
  const panel = ensurePanel();
  if (panel.isOpen()) {
    panel.toggle();
    return;
  }

  const settings = currentSettings ?? await sendRuntimeMessage({ type: "YM_GET_SETTINGS" });
  currentSettings = settings;
  panel.toggle(settings.autoSummarize ?? true);
}

async function refreshOpenSummaryShortcut(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "YM_GET_COMMAND_SHORTCUTS" });
    openSummaryShortcut = response.shortcuts["_execute_action"] ?? "";
  } catch {
    // Background unreachable (extension reloading); keep the last known shortcut.
  }
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const key = parts[parts.length - 1];
  const wantsAlt = parts.includes("alt");
  const wantsCtrl = parts.includes("ctrl") || parts.includes("control");
  const wantsShift = parts.includes("shift");
  const wantsMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("command");
  return (
    event.key.toLowerCase() === key &&
    event.altKey === wantsAlt &&
    event.ctrlKey === wantsCtrl &&
    event.shiftKey === wantsShift &&
    event.metaKey === wantsMeta
  );
}
