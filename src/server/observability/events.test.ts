import { describe, expect, test } from "bun:test";

import {
  type AnalyticsCaptureEvent,
  type AnalyticsSink,
  createPostHogAnalyticsSink,
  trackServerEvent,
} from "@/server/observability/events";

describe("privacy-safe analytics events", () => {
  test("sends allowlisted payloads to an injected sink", async () => {
    const captured: AnalyticsCaptureEvent[] = [];
    const sink: AnalyticsSink = {
      name: "test-sink",
      async send(event) {
        captured.push(event);
      },
    };

    const event = trackServerEvent({
      distinctId: "server:test",
      name: "trip_pass_checkout_started",
      now: new Date("2026-07-14T04:10:00.000Z"),
      payload: {
        checkoutAvailable: true,
        productCode: "siargao_trip_pass_14d_v1",
        productVersion: 1,
        status: "started",
        stripeCheckoutSessionId: "cs_should_not_leave",
        surface: "settings",
      },
      sink,
    });

    await expect(event.delivery).resolves.toEqual({ sink: "test-sink", status: "sent" });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      distinctId: "server:test",
      event: "trip_pass_checkout_started",
      timestamp: "2026-07-14T04:10:00.000Z",
    });
    expect(captured[0]?.properties).toMatchObject({
      checkoutAvailable: true,
      productCode: "siargao_trip_pass_14d_v1",
      productVersion: 1,
      source: "ask-siargao-server",
      status: "started",
      surface: "settings",
    });
    expect(JSON.stringify(captured[0])).not.toContain("cs_should_not_leave");
  });

  test("drops prohibited identifiers and content before delivery", async () => {
    const captured: AnalyticsCaptureEvent[] = [];
    const sink: AnalyticsSink = {
      name: "test-sink",
      async send(event) {
        captured.push(event);
      },
    };

    const event = trackServerEvent({
      name: "llm_cost_recorded",
      now: new Date("2026-07-14T04:11:00.000Z"),
      payload: {
        callCount: 1,
        calls: [
          {
            callIndex: 0,
            inputTokens: 120,
            mode: "non-thinking",
            prompt: "private user question",
            upstreamRequestId: "req_secret",
          },
        ],
        email: "traveler@example.com",
        fallbackUsed: false,
        latitude: 9.8,
        messageText: "private answer",
        requestId: "chat_req_secret",
        stripeEventId: "evt_secret",
        totalModeledCostUsd: "0.001",
        totals: {
          inputCacheHitTokens: 10,
          rawWebhookBody: "{secret}",
        },
      },
      sink,
    });

    await event.delivery;
    const delivered = JSON.stringify(captured[0]);
    expect(delivered).toContain("inputCacheHitTokens");
    expect(delivered).toContain("totalModeledCostUsd");
    expect(delivered).not.toContain("private user question");
    expect(delivered).not.toContain("private answer");
    expect(delivered).not.toContain("traveler@example.com");
    expect(delivered).not.toContain("chat_req_secret");
    expect(delivered).not.toContain("evt_secret");
    expect(delivered).not.toContain("req_secret");
    expect(delivered).not.toContain("rawWebhookBody");
    expect(delivered).not.toContain("latitude");
  });

  test("does not throw when analytics is unconfigured or the sink times out", async () => {
    const disabled = trackServerEvent({
      env: {},
      name: "trip_pass_pricing_viewed",
      payload: { productCode: "siargao_trip_pass_14d_v1", surface: "landing" },
      sink: null,
    });

    expect(await disabled.delivery).toEqual({ sink: "none", status: "disabled" });

    const timedOut = trackServerEvent({
      name: "trip_pass_pricing_viewed",
      payload: { productCode: "siargao_trip_pass_14d_v1", surface: "landing" },
      sink: {
        name: "slow-test-sink",
        send: (_event, signal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(resolve, 20);
          }),
      },
      timeoutMs: 1,
    });

    expect(await timedOut.delivery).toEqual({ sink: "slow-test-sink", status: "timed_out" });
  });

  test("builds a PostHog-compatible capture sink", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];
    const sink = createPostHogAnalyticsSink({
      env: {
        NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example/",
        NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      },
      fetch: (async (url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          url: String(url),
        });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    await sink?.send(
      {
        distinctId: "server:test",
        event: "trip_pass_meter_warning",
        properties: { meterType: "chat_message", remaining: 20 },
        timestamp: "2026-07-14T04:12:00.000Z",
      },
      new AbortController().signal,
    );

    expect(requests).toEqual([
      {
        body: {
          api_key: "phc_test",
          distinct_id: "server:test",
          event: "trip_pass_meter_warning",
          properties: { meterType: "chat_message", remaining: 20 },
          timestamp: "2026-07-14T04:12:00.000Z",
        },
        url: "https://posthog.example/capture/",
      },
    ]);
  });
});
