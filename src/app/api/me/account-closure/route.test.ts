import { describe, expect, test } from "bun:test";

import {
  type AccountClosureRouteDependencies,
  postAccountClosureResponse,
} from "@/app/api/me/account-closure/account-closure-route";
import { accountClosureVerificationConfig } from "@/server/privacy/account-closure";

describe("POST /api/me/account-closure", () => {
  test("rejects anonymous and stale verification without starting phase one", async () => {
    let begins = 0;
    const anonymous = dependencies({ userId: null, verified: false, onBegin: () => (begins += 1) });
    expect((await postAccountClosureResponse(request(), anonymous)).status).toBe(401);

    const stale = dependencies({
      userId: "user_stale",
      verified: false,
      onBegin: () => (begins += 1),
    });
    const response = await postAccountClosureResponse(request(), stale);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "reverification_required" });
    expect(begins).toBe(0);
  });

  test("derives identity from Clerk and requires the inclusive five-minute server config", async () => {
    let receivedUserId = "";
    let receivedConfig: unknown;
    const route = dependencies({
      userId: "user_verified",
      verified: true,
      onBegin: (userId) => {
        receivedUserId = userId;
      },
      onHas: (input) => {
        receivedConfig = input;
      },
    });
    const response = await postAccountClosureResponse(request(), route);

    expect(response.status).toBe(200);
    expect(receivedUserId).toBe("user_verified");
    expect(receivedConfig).toEqual({ reverification: accountClosureVerificationConfig });
    expect(await response.json()).toEqual({
      status: "closed",
      operationRef: "closure_operation_test",
      message: "Account Closure is terminal and local access has ended.",
    });
  });

  test("returns no readable identity and emits only an opaque audit reference", async () => {
    const events: unknown[] = [];
    const response = await postAccountClosureResponse(
      request(),
      dependencies({
        userId: "user_secret",
        verified: true,
        audit: (event) => {
          events.push(event);
        },
      }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("user_secret");
    expect(JSON.stringify(events)).not.toContain("user_secret");
    expect(events).toEqual([
      {
        at: "2026-08-07T04:00:00.000Z",
        operationRef: "closure_operation_test",
        outcome: "closed",
      },
    ]);
  });

  test("rejects cross-origin and malformed requests before auth or writes", async () => {
    let authCalls = 0;
    const route = dependencies({ userId: "user_no_write", verified: true });
    route.auth = async () => {
      authCalls += 1;
      return { userId: "user_no_write", has: () => true };
    };
    const crossOrigin = request({ origin: "https://evil.example" });
    expect((await postAccountClosureResponse(crossOrigin, route)).status).toBe(403);
    expect(
      (
        await postAccountClosureResponse(
          new Request("https://siargao.test/api/me/account-closure", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmation: "close" }),
          }),
          route,
        )
      ).status,
    ).toBe(400);
    expect(authCalls).toBe(0);
  });
});

function dependencies(input: {
  userId: string | null;
  verified: boolean;
  onBegin?: (userId: string) => void;
  onHas?: (input: unknown) => void;
  audit?: AccountClosureRouteDependencies["audit"];
}): AccountClosureRouteDependencies {
  return {
    audit: input.audit ?? (() => undefined),
    auth: async () => ({
      userId: input.userId,
      has: (config) => {
        input.onHas?.(config);
        return input.verified;
      },
    }),
    begin: async ({ userId }) => {
      input.onBegin?.(userId);
      return {
        status: "closed",
        operationRef: "closure_operation_test",
        tombstoneRef: "closure_tombstone_test",
      };
    },
    db: { query: async () => ({ rows: [] }) },
    now: () => new Date("2026-08-07T04:00:00.000Z"),
    policy: {
      alertAfterAttempts: 2,
      closurePolicyVersion: "test",
      closureRetentionMs: 1,
      commercePolicyVersion: "test",
      commerceRetentionMs: 1,
      providerSubjectEncryptionKey: Buffer.alloc(32, 1).toString("base64"),
      providerSubjectEncryptionKeyVersion: 1,
      tombstoneHashKey: "test",
      tombstoneHashVersion: 1,
    },
    reverificationResponse: () =>
      Response.json({ error: "reverification_required" }, { status: 403 }),
  };
}

function request(input: { origin?: string } = {}) {
  return new Request("https://siargao.test/api/me/account-closure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: input.origin ?? "https://siargao.test",
      "sec-fetch-site": input.origin ? "cross-site" : "same-origin",
    },
    body: JSON.stringify({ confirmation: "CLOSE MY ACCOUNT" }),
  });
}
