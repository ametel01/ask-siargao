import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingAssistantWaitState } from "@/features/chat/PendingAssistantWaitState";
import {
  createResponseWaitLifecycle,
  responseStoppedStatusText,
  responseWaitStatusText,
  transitionResponseWaitMessage,
} from "@/features/chat/response-wait-state";

describe("response wait state lifecycle", () => {
  test("owns progress and completion for one response without accepting stale completion", async () => {
    const events: string[] = [];
    let emitLateProgress: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const lifecycle = createResponseWaitLifecycle<{ message: string }>({
      createRequestId: (() => {
        let count = 0;
        return () => `request_${++count}`;
      })(),
    });

    const first = lifecycle.start(
      { assistantMessageId: "assistant_first", prompt: "First question" },
      (request, onProgress) => {
        emitLateProgress = () => onProgress("Late first progress");
        return new Promise<{ message: string }>((resolve) => {
          releaseFirst = () => resolve({ message: "First answer" });
          expect(request.controller.signal.aborted).toBe(false);
        });
      },
      (event) => {
        events.push(event.type === "progress" ? event.message : event.type);
      },
    );
    const second = lifecycle.start(
      { assistantMessageId: "assistant_second", prompt: "Second question" },
      async () => ({ message: "Second answer" }),
      (event) => {
        events.push(event.type === "completed" ? event.result.message : event.type);
      },
    );
    emitLateProgress?.();
    releaseFirst?.();

    await Promise.all([first, second]);

    expect(events).toEqual(["started", "stopped", "started", "Second answer"]);
    expect(lifecycle.getActiveRequest()).toBeNull();
  });

  test("turns an explicit stop into a terminal lifecycle event and aborts transport", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const lifecycle = createResponseWaitLifecycle<{ message: string }>();
    const completion = lifecycle.start(
      { assistantMessageId: "assistant_stop", prompt: "Stop this" },
      (request) => {
        observedSignal = request.controller.signal;
        return new Promise<{ message: string }>((resolve) => {
          release = () => resolve({ message: "late answer" });
        });
      },
      (event) => events.push(event.type),
    );

    expect(lifecycle.stop()).toBe(true);
    release?.();
    await completion;

    expect(observedSignal?.aborted).toBe(true);
    expect(events).toEqual(["started", "stopped"]);
    expect(lifecycle.getActiveRequest()).toBeNull();
  });

  test("emits failures while keeping aborts silent", async () => {
    const failureEvents: string[] = [];
    const lifecycle = createResponseWaitLifecycle<{ message: string }>();

    await lifecycle.start(
      { assistantMessageId: "assistant_failure", prompt: "Fail this" },
      async () => {
        throw new Error("network unavailable");
      },
      (event) => failureEvents.push(event.type),
    );

    expect(failureEvents).toEqual(["started", "failed"]);
  });

  test("invalidates an unmounted response without publishing a terminal message", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const lifecycle = createResponseWaitLifecycle<{ message: string }>();
    const completion = lifecycle.start(
      { assistantMessageId: "assistant_unmount", prompt: "Unmount this" },
      (request) => {
        observedSignal = request.controller.signal;
        return new Promise<{ message: string }>((resolve) => {
          release = () => resolve({ message: "late answer" });
        });
      },
      (event) => events.push(event.type),
    );

    lifecycle.invalidate();
    release?.();
    await completion;

    expect(observedSignal?.aborted).toBe(true);
    expect(events).toEqual(["started"]);
    expect(lifecycle.getActiveRequest()).toBeNull();
  });

  test("projects progress, completion, failure, and stop into message transitions", () => {
    const request = {
      assistantMessageId: "assistant_transition",
      controller: new AbortController(),
      prompt: "Transition this",
      requestId: "request_transition",
    };
    const baseMessage = {
      id: request.assistantMessageId,
      role: "assistant" as const,
      status: "pending" as const,
      text: responseWaitStatusText,
      timestamp: "10:00 AM",
    };
    const options = {
      errorText: (error: unknown) => (error instanceof Error ? error.message : "fallback error"),
      projectResult: () => ({ text: "Fresh answer", answerArrivalMotion: { kind: "arrival" } }),
      stoppedText: responseStoppedStatusText,
      timestamp: () => "10:01 AM",
    };

    expect(
      transitionResponseWaitMessage(
        baseMessage,
        { type: "progress", request, message: "Checking" },
        options,
      ),
    ).toMatchObject({ status: "pending", text: "Checking" });
    expect(
      transitionResponseWaitMessage(
        baseMessage,
        {
          type: "completed",
          request,
          result: { message: "Fresh answer" },
        },
        options,
      ),
    ).toMatchObject({ status: "complete", text: "Fresh answer", retryPrompt: "Transition this" });
    expect(
      transitionResponseWaitMessage(
        baseMessage,
        {
          type: "failed",
          request,
          error: new Error("Network unavailable"),
        },
        options,
      ),
    ).toMatchObject({
      status: "error",
      text: "Network unavailable",
      retryPrompt: "Transition this",
    });
    expect(
      transitionResponseWaitMessage(baseMessage, { type: "stopped", request }, options),
    ).toMatchObject({ status: "stopped", text: responseStoppedStatusText });
  });
});

describe("response wait state presentation", () => {
  test("renders one stable indeterminate status without progress values or internal stages", () => {
    const html = renderToStaticMarkup(
      <PendingAssistantWaitState disabled={false} onStopWaiting={() => {}} />,
    );

    expect(html).toContain(responseWaitStatusText);
    expect(html).toContain("Stop waiting");
    expect(html.match(/role="status"/g)?.length).toBe(1);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toMatch(/\b\d{1,3}%\b/);
    expect(html).not.toMatch(/\b(countdown|elapsed|stage|tool|provider|OpenAI|Places)\b/i);
    expect(html).not.toMatch(/\b(width|transform):/i);
    expect(html).not.toContain(responseStoppedStatusText);
  });

  test("renders a real streamed progress update when one is available", () => {
    const statusText = "Checking two relevant sources.";
    const html = renderToStaticMarkup(
      <PendingAssistantWaitState
        disabled={false}
        onStopWaiting={() => {}}
        statusText={statusText}
      />,
    );

    expect(html).toContain(statusText);
    expect(html).not.toContain(responseWaitStatusText);
  });
});
