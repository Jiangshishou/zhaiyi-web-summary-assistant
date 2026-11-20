// Inlined sendRuntimeMessage to avoid cross-entry code splitting with shared/messages.ts.
// Type-only imports are erased at compile time — no runtime import in output.
// The error-response predicate is the shared zero-dependency src/shared/errorResponse.ts,
// which does not pull in the shared/messages.ts runtime.

import type {
  RuntimeRequest,
  RuntimeResponse
} from "../shared/messages";
import { isErrorResponse } from "../shared/errorResponse";

export async function sendRuntimeMessage<T extends RuntimeRequest>(
  request: T
): Promise<RuntimeResponse<T["type"]>> {
  const response = (await chrome.runtime.sendMessage(request)) as unknown;
  if (isErrorResponse(response)) throw new Error(response.error);
  return response as RuntimeResponse<T["type"]>;
}
