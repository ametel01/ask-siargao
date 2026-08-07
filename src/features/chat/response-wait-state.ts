export const responseWaitStatusText = "Understanding your question and choosing the right checks.";
export const responseStoppedStatusText = "Stopped waiting here. You can retry that question.";

export type ResponseWaitRequest = {
  assistantMessageId: string;
  controller: AbortController;
  prompt: string;
  requestId: string;
};

export type ResponseWaitLifecycle =
  | { phase: "idle" }
  | {
      phase: "pending" | "failed" | "stopped";
      assistantMessageId: string;
      prompt: string;
      requestId: string;
    };

export type ResponseWaitLifecycleEvent =
  | { type: "start"; request: Omit<ResponseWaitRequest, "controller"> }
  | { type: "complete"; requestId: string }
  | { type: "fail"; requestId: string }
  | { type: "stop"; requestId: string }
  | { type: "invalidate"; requestId?: string };

export function createResponseWaitRequest({
  assistantMessageId,
  controller = new AbortController(),
  createRequestId = createResponseWaitRequestId,
  prompt,
}: {
  assistantMessageId: string;
  controller?: AbortController;
  createRequestId?: () => string;
  prompt: string;
}): ResponseWaitRequest {
  return {
    assistantMessageId,
    controller,
    prompt,
    requestId: createRequestId(),
  };
}

export function isCurrentResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
  requestId: string,
): activeRequest is ResponseWaitRequest {
  return activeRequest?.requestId === requestId;
}

export function settleResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
  requestId: string,
): ResponseWaitRequest | null {
  return isCurrentResponseWaitRequest(activeRequest, requestId) ? null : activeRequest;
}

export function stopResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
  requestId: string,
): ResponseWaitRequest | null {
  if (!isCurrentResponseWaitRequest(activeRequest, requestId)) {
    return activeRequest;
  }

  abortResponseWaitRequest(activeRequest);
  return null;
}

export function invalidateResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
): ResponseWaitRequest | null {
  if (activeRequest) {
    abortResponseWaitRequest(activeRequest);
  }
  return null;
}

export function abortResponseWaitRequest(activeRequest: ResponseWaitRequest) {
  if (!activeRequest.controller.signal.aborted) {
    activeRequest.controller.abort();
  }
}

export function isResponseWaitAbort(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function reduceResponseWaitLifecycle(
  state: ResponseWaitLifecycle,
  event: ResponseWaitLifecycleEvent,
): ResponseWaitLifecycle {
  switch (event.type) {
    case "start":
      return { ...event.request, phase: "pending" };
    case "complete":
      return state.phase === "pending" && state.requestId === event.requestId
        ? { phase: "idle" }
        : state;
    case "fail":
      return state.phase === "pending" && state.requestId === event.requestId
        ? { ...state, phase: "failed" }
        : state;
    case "stop":
      return state.phase === "pending" && state.requestId === event.requestId
        ? { ...state, phase: "stopped" }
        : state;
    case "invalidate":
      return event.requestId === undefined ||
        (state.phase !== "idle" && state.requestId === event.requestId)
        ? { phase: "idle" }
        : state;
  }
}

function createResponseWaitRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `response_${crypto.randomUUID()}`;
  }

  return `response_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
