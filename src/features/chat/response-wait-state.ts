export const responseWaitStatusText = "Understanding your question and choosing the right checks.";
export const responseStoppedStatusText = "Stopped waiting here. You can retry that question.";

export type ResponseWaitRequest = {
  assistantMessageId: string;
  controller: AbortController;
  prompt: string;
  requestId: string;
};

export type ResponseWaitMessageStatus = "pending" | "complete" | "error" | "stopped";

export type ResponseWaitMessage = {
  answerArrivalMotion?: unknown;
  retryPrompt?: string;
  status?: ResponseWaitMessageStatus;
  text: string;
  timestamp: string;
};

export type ResponseWaitLifecycleNotification<T> =
  | { type: "started"; request: ResponseWaitRequest }
  | { type: "progress"; request: ResponseWaitRequest; message: string }
  | { type: "completed"; request: ResponseWaitRequest; result: T }
  | { type: "failed"; request: ResponseWaitRequest; error: unknown }
  | { type: "stopped"; request: ResponseWaitRequest };

export type ResponseWaitLifecycleExecutor<T> = (
  request: ResponseWaitRequest,
  onProgress: (message: string) => void,
) => Promise<T>;

export type ResponseWaitLifecycleController<T> = {
  getActiveRequest: () => ResponseWaitRequest | null;
  invalidate: () => void;
  start: (
    input: Omit<ResponseWaitRequest, "controller" | "requestId">,
    execute: ResponseWaitLifecycleExecutor<T>,
    notify: (event: ResponseWaitLifecycleNotification<T>) => void,
  ) => Promise<void>;
  stop: (requestId?: string) => boolean;
};

export function transitionResponseWaitMessage<TMessage extends ResponseWaitMessage, TResult>(
  message: TMessage,
  event: ResponseWaitLifecycleNotification<TResult>,
  options: {
    errorText: (error: unknown) => string;
    projectResult: (message: TMessage, result: TResult) => Partial<TMessage>;
    stoppedText: string;
    timestamp: () => string;
  },
): TMessage {
  if (event.type === "progress") {
    return message.status === "pending" ? { ...message, text: event.message } : message;
  }
  if (event.type === "completed") {
    return {
      ...message,
      ...options.projectResult(message, event.result),
      retryPrompt: event.request.prompt,
      status: "complete",
      timestamp: options.timestamp(),
    };
  }
  if (event.type === "failed") {
    return {
      ...message,
      answerArrivalMotion: undefined,
      retryPrompt: event.request.prompt,
      status: "error",
      text: options.errorText(event.error),
      timestamp: options.timestamp(),
    };
  }
  if (event.type === "stopped") {
    return {
      ...message,
      answerArrivalMotion: undefined,
      retryPrompt: event.request.prompt,
      status: "stopped",
      text: options.stoppedText,
      timestamp: options.timestamp(),
    };
  }
  return message;
}

export function createResponseWaitLifecycle<T>(options?: {
  createRequestId?: () => string;
}): ResponseWaitLifecycleController<T> {
  let activeRequest: ResponseWaitRequest | null = null;
  let activeNotify: ((event: ResponseWaitLifecycleNotification<T>) => void) | null = null;

  function getActiveRequest() {
    return activeRequest;
  }

  function invalidate() {
    activeRequest = invalidateResponseWaitRequest(activeRequest);
    activeNotify = null;
  }

  function stop(requestId = activeRequest?.requestId) {
    if (!activeRequest || !requestId || activeRequest.requestId !== requestId) {
      return false;
    }

    const stoppedRequest = activeRequest;
    activeRequest = stopResponseWaitRequest(activeRequest, requestId);
    activeNotify?.({ type: "stopped", request: stoppedRequest });
    activeNotify = null;
    return true;
  }

  function start(
    input: Omit<ResponseWaitRequest, "controller" | "requestId">,
    execute: ResponseWaitLifecycleExecutor<T>,
    notify: (event: ResponseWaitLifecycleNotification<T>) => void,
  ) {
    const replacedRequest = activeRequest;
    const replacedNotify = activeNotify;
    invalidate();
    if (replacedRequest) {
      replacedNotify?.({ type: "stopped", request: replacedRequest });
    }
    const request = createResponseWaitRequest({
      ...input,
      createRequestId: options?.createRequestId,
    });
    activeRequest = request;
    activeNotify = notify;
    notify({ type: "started", request });

    let execution: Promise<T>;
    try {
      execution = execute(request, (message) => {
        if (isCurrentResponseWaitRequest(activeRequest, request.requestId)) {
          notify({ type: "progress", request, message });
        }
      });
    } catch (error) {
      execution = Promise.reject(error);
    }

    return execution.then(
      (result) => {
        if (!isCurrentResponseWaitRequest(activeRequest, request.requestId)) {
          return;
        }

        activeRequest = null;
        activeNotify = null;
        notify({ type: "completed", request, result });
      },
      (error: unknown) => {
        if (
          !isCurrentResponseWaitRequest(activeRequest, request.requestId) ||
          isResponseWaitAbort(error)
        ) {
          return;
        }

        activeRequest = null;
        activeNotify = null;
        notify({ type: "failed", request, error });
      },
    );
  }

  return { getActiveRequest, invalidate, start, stop };
}

function createResponseWaitRequest({
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

function isCurrentResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
  requestId: string,
): activeRequest is ResponseWaitRequest {
  return activeRequest?.requestId === requestId;
}

function stopResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
  requestId: string,
): ResponseWaitRequest | null {
  if (!isCurrentResponseWaitRequest(activeRequest, requestId)) {
    return activeRequest;
  }

  abortResponseWaitRequest(activeRequest);
  return null;
}

function invalidateResponseWaitRequest(
  activeRequest: ResponseWaitRequest | null,
): ResponseWaitRequest | null {
  if (activeRequest) {
    abortResponseWaitRequest(activeRequest);
  }
  return null;
}

function abortResponseWaitRequest(activeRequest: ResponseWaitRequest) {
  if (!activeRequest.controller.signal.aborted) {
    activeRequest.controller.abort();
  }
}

export function isResponseWaitAbort(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function createResponseWaitRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `response_${crypto.randomUUID()}`;
  }

  return `response_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
