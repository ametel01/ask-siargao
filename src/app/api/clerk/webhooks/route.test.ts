import { describe, expect, test } from "bun:test";
import type { UserWebhookEvent, WebhookEvent } from "@clerk/backend";

import {
  clerkWebhookResponse,
  maxClerkWebhookBodyBytes,
} from "@/app/api/clerk/webhooks/clerk-webhook-route";

describe("Clerk webhook route", () => {
  test("rejects oversized bodies before signature verification", async () => {
    let verifyCalls = 0;
    const response = await clerkWebhookResponse(
      new Request("https://siargao.test/api/clerk/webhooks", {
        method: "POST",
        headers: { "content-length": String(maxClerkWebhookBodyBytes + 1) },
        body: "{}",
      }),
      {
        applyClerkUserWebhookEvent: async () => ({ status: "upserted", userId: "unreached" }),
        verifyWebhook: async () => {
          verifyCalls += 1;
          return userEvent("user.created", "unreached");
        },
      },
    );

    expect(response.status).toBe(413);
    expect(verifyCalls).toBe(0);
  });

  test("bounds streamed bodies when content-length is absent", async () => {
    let verifyCalls = 0;
    const response = await clerkWebhookResponse(
      new Request("https://siargao.test/api/clerk/webhooks", {
        method: "POST",
        body: "x".repeat(maxClerkWebhookBodyBytes + 1),
      }),
      {
        applyClerkUserWebhookEvent: async () => ({ status: "upserted", userId: "unreached" }),
        verifyWebhook: async () => {
          verifyCalls += 1;
          return userEvent("user.created", "unreached");
        },
      },
    );

    expect(response.status).toBe(413);
    expect(verifyCalls).toBe(0);
  });

  test("rejects requests that fail Clerk webhook verification", async () => {
    const internalPhrase = "fixture_should_not_render_clerk_verification";
    const response = await clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async () => ({ status: "upserted", userId: "unreached" }),
      verifyWebhook: async () => {
        throw new Error(`No matching svix signature. ${internalPhrase}`);
      },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_clerk_webhook",
      message: "Webhook verification failed.",
    });
    expect(JSON.stringify(body)).not.toContain(internalPhrase);
  });

  test("syncs verified Clerk user lifecycle events before returning success", async () => {
    const appliedEvents: string[] = [];
    const response = await clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async (event) => {
        appliedEvents.push(event.type);
        if (event.type === "user.deleted") {
          return { status: "deleted", userId: event.data.id ?? "missing" };
        }

        return {
          status: "upserted",
          userId: event.data.id,
        };
      },
      verifyWebhook: async () => userEvent("user.updated", "user_sync"),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      status: "upserted",
      userId: "user_sync",
    });
    expect(appliedEvents).toEqual(["user.updated"]);
  });

  test("does not start lifecycle application until webhook verification succeeds", async () => {
    const events: string[] = [];
    const verifiedEvent = deferred<WebhookEvent>();
    const verificationStarted = deferred<void>();
    const responsePromise = clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async (event) => {
        events.push(`apply:${event.type}`);
        return { status: "upserted", userId: event.data.id ?? "missing" };
      },
      verifyWebhook: async () => {
        events.push("verify:start");
        verificationStarted.resolve();
        return verifiedEvent.promise;
      },
    });

    await verificationStarted.promise;
    expect(events).toEqual(["verify:start"]);

    verifiedEvent.resolve(userEvent("user.updated", "user_pending_verification"));
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      status: "upserted",
      userId: "user_pending_verification",
    });
    expect(events).toEqual(["verify:start", "apply:user.updated"]);
  });

  test("never starts lifecycle application when webhook verification is rejected", async () => {
    const events: string[] = [];
    const verifiedEvent = deferred<WebhookEvent>();
    const verificationStarted = deferred<void>();
    const responsePromise = clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async (event) => {
        events.push(`apply:${event.type}`);
        return { status: "upserted", userId: event.data.id ?? "missing" };
      },
      verifyWebhook: async () => {
        events.push("verify:start");
        verificationStarted.resolve();
        return verifiedEvent.promise;
      },
    });

    await verificationStarted.promise;
    expect(events).toEqual(["verify:start"]);

    verifiedEvent.reject(new Error("pending verification rejected"));
    const response = await responsePromise;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_clerk_webhook",
      message: "Webhook verification failed.",
    });
    expect(events).toEqual(["verify:start"]);
  });

  test("does not return 2xx when local Clerk user sync fails", async () => {
    const internalPhrase = "fixture_should_not_render_clerk_sync";
    const response = await clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async () => {
        throw new Error(`database unavailable ${internalPhrase}`);
      },
      verifyWebhook: async () => userEvent("user.created", "user_fail"),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "clerk_user_sync_failed",
      message: "Failed to sync Clerk user.",
    });
    expect(JSON.stringify(body)).not.toContain(internalPhrase);
  });

  test("ignores verified non-user Clerk events", async () => {
    const response = await clerkWebhookResponse(clerkWebhookRequest(), {
      applyClerkUserWebhookEvent: async () => {
        throw new Error("Non-user events should not sync users.");
      },
      verifyWebhook: async () =>
        ({
          type: "session.created",
          object: "event",
          data: { id: "sess_123" },
          event_attributes: {
            http_request: { client_ip: "127.0.0.1", user_agent: "bun-test" },
          },
        }) as WebhookEvent,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
  });
});

function clerkWebhookRequest() {
  return new Request("https://siargao.test/api/clerk/webhooks", {
    method: "POST",
    body: "{}",
  });
}

function userEvent(type: "user.created" | "user.updated" | "user.deleted", userId: string) {
  if (type === "user.deleted") {
    return {
      type,
      object: "event",
      data: {
        object: "user",
        id: userId,
        deleted: true,
      },
      event_attributes: {
        http_request: { client_ip: "127.0.0.1", user_agent: "bun-test" },
      },
    } satisfies UserWebhookEvent;
  }

  return {
    type,
    object: "event",
    data: {
      id: userId,
      email_addresses: [],
      first_name: null,
      last_name: null,
      image_url: "",
      primary_email_address_id: null,
      updated_at: Date.parse("2026-06-29T01:00:00.000Z"),
      last_active_at: null,
    },
    event_attributes: {
      http_request: { client_ip: "127.0.0.1", user_agent: "bun-test" },
    },
  } as unknown as UserWebhookEvent;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
