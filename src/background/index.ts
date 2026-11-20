import { handleRuntimeCommand, openPanelFromAction } from "./commands";
import type { RuntimeRequest, RuntimeResponseMap } from "../shared/messages";

chrome.action.onClicked.addListener(async (tab) => {
  await openPanelFromAction(chrome, tab);
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  void handleRuntimeRequest(request, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

export async function handleRuntimeRequest(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<RuntimeResponseMap[RuntimeRequest["type"]]> {
  return handleRuntimeCommand(request, sender, chrome);
}
