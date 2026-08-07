import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PendingAssistantWaitState } from "@/features/chat/PendingAssistantWaitState";
import {
  createResponseWaitRequest,
  invalidateResponseWaitRequest,
  isCurrentResponseWaitRequest,
  reduceResponseWaitLifecycle,
  responseStoppedStatusText,
  responseWaitStatusText,
  settleResponseWaitRequest,
  stopResponseWaitRequest,
} from "@/features/chat/response-wait-state";

describe("response wait state lifecycle", () => {
  test("allows only the current pending request to complete and clear ownership", () => {
    const request = createResponseWaitRequest({
      assistantMessageId: "assistant_pending",
      createRequestId: () => "request_current",
      prompt: "Where should we eat?",
    });

    expect(isCurrentResponseWaitRequest(request, "request_current")).toBe(true);
    expect(settleResponseWaitRequest(request, "request_old")).toBe(request);
    expect(settleResponseWaitRequest(request, "request_current")).toBeNull();
  });

  test("keeps late first responses from clearing a newer retry", () => {
    const first = createResponseWaitRequest({
      assistantMessageId: "assistant_first",
      createRequestId: () => "request_first",
      prompt: "Plan a beach day.",
    });
    const retry = createResponseWaitRequest({
      assistantMessageId: "assistant_retry",
      createRequestId: () => "request_retry",
      prompt: "Plan a beach day.",
    });

    expect(settleResponseWaitRequest(retry, first.requestId)).toBe(retry);
    expect(settleResponseWaitRequest(retry, retry.requestId)).toBeNull();
  });

  test("aborts and releases controller resources on stop, invalidation, and unmount cleanup", () => {
    const stopped = createResponseWaitRequest({
      assistantMessageId: "assistant_stop",
      createRequestId: () => "request_stop",
      prompt: "Will it rain?",
    });

    expect(stopResponseWaitRequest(stopped, "request_stop")).toBeNull();
    expect(stopped.controller.signal.aborted).toBe(true);
    expect(stopResponseWaitRequest(null, "request_stop")).toBeNull();

    const invalidated = createResponseWaitRequest({
      assistantMessageId: "assistant_unmount",
      createRequestId: () => "request_unmount",
      prompt: "What about tomorrow?",
    });

    expect(invalidateResponseWaitRequest(invalidated)).toBeNull();
    expect(invalidated.controller.signal.aborted).toBe(true);
  });

  test("models failed and stopped retry lifecycles without accepting stale events", () => {
    const pending = reduceResponseWaitLifecycle(
      { phase: "idle" },
      {
        type: "start",
        request: {
          assistantMessageId: "assistant_pending",
          prompt: "Find a rainy day plan.",
          requestId: "request_pending",
        },
      },
    );

    expect(
      reduceResponseWaitLifecycle(pending, { type: "complete", requestId: "request_old" }),
    ).toBe(pending);

    const failed = reduceResponseWaitLifecycle(pending, {
      type: "fail",
      requestId: "request_pending",
    });
    expect(failed).toMatchObject({ phase: "failed", prompt: "Find a rainy day plan." });

    const retry = reduceResponseWaitLifecycle(failed, {
      type: "start",
      request: {
        assistantMessageId: "assistant_retry",
        prompt: "Find a rainy day plan.",
        requestId: "request_retry",
      },
    });
    expect(
      reduceResponseWaitLifecycle(retry, { type: "complete", requestId: "request_retry" }),
    ).toEqual({ phase: "idle" });

    const stopped = reduceResponseWaitLifecycle(pending, {
      type: "stop",
      requestId: "request_pending",
    });
    expect(stopped).toMatchObject({ phase: "stopped", prompt: "Find a rainy day plan." });
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
