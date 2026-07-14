import { describe, expect, test } from "bun:test";

import { createMemoryQuotaStore } from "@/server/security/rate-limit";
import {
  anonymousTripCookieName,
  beginAnonymousFreeChat,
} from "@/server/trip-pass/anonymous-free-allowance";

const env = {
  NODE_ENV: "test",
  TRIP_PASS_ANON_HMAC_KEY: "test-anonymous-identity-secret",
  TRIP_PASS_ANON_HMAC_KEY_VERSION: "3",
  TRUST_PROXY_HEADERS: "true",
};

describe("anonymous free allowance", () => {
  test("issues, validates, rotates, and replaces anonymous trip cookies without raw identifiers", async () => {
    const store = createMemoryQuotaStore();
    const now = new Date("2026-07-14T02:00:00.000Z");
    const first = await beginAnonymousFreeChat(request(), {
      createId: ids("trip_a"),
      env,
      now: () => now,
      requestId: "request_a",
      store,
      trustProxyHeaders: true,
    });
    expect(first.status).toBe("allowed");
    if (first.status !== "allowed") {
      return;
    }
    expect(first.cookie.state).toBe("missing");
    expect(first.actor.tripVersion).toBe(3);
    expect(first.actor.tripHash).not.toContain("trip_a");
    expect(first.actor.cohortHash).not.toContain("203.0.113.10");
    await first.settle({ success: false });

    const cookie = cookiePair(first.headers);
    const valid = await beginAnonymousFreeChat(request({ cookie }), {
      createId: ids("trip_unused"),
      env,
      now: () => new Date("2026-07-14T02:01:00.000Z"),
      requestId: "request_b",
      store,
      trustProxyHeaders: true,
    });
    expect(valid.status).toBe("allowed");
    if (valid.status !== "allowed") {
      return;
    }
    expect(valid.cookie.state).toBe("valid");
    expect(valid.actor.tripHash).toBe(first.actor.tripHash);
    await valid.settle({ success: false });

    const rotated = await beginAnonymousFreeChat(request({ cookie }), {
      createId: ids("trip_unused"),
      env,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
      requestId: "request_c",
      store,
      trustProxyHeaders: true,
    });
    expect(rotated.status).toBe("allowed");
    if (rotated.status !== "allowed") {
      return;
    }
    expect(rotated.cookie.state).toBe("rotated");
    expect(rotated.actor.tripHash).toBe(first.actor.tripHash);
    await rotated.settle({ success: false });

    const tampered = await beginAnonymousFreeChat(request({ cookie: `${cookie}tampered` }), {
      createId: ids("trip_b"),
      env,
      now: () => new Date("2026-07-14T02:02:00.000Z"),
      requestId: "request_d",
      store,
      trustProxyHeaders: true,
    });
    expect(tampered.status).toBe("allowed");
    if (tampered.status !== "allowed") {
      return;
    }
    expect(tampered.cookie.state).toBe("tampered");
    expect(tampered.actor.tripHash).not.toBe(first.actor.tripHash);
    await tampered.settle({ success: false });

    const expired = await beginAnonymousFreeChat(request({ cookie }), {
      createId: ids("trip_c"),
      env,
      now: () => new Date("2026-07-22T02:00:00.000Z"),
      requestId: "request_e",
      store,
      trustProxyHeaders: true,
    });
    expect(expired.status).toBe("allowed");
    if (expired.status !== "allowed") {
      return;
    }
    expect(expired.cookie.state).toBe("expired");
    expect(expired.actor.tripHash).not.toBe(first.actor.tripHash);
    await expired.settle({ success: false });
  });

  test("challenges repeated cleared-cookie identities in one abuse cohort", async () => {
    const store = createMemoryQuotaStore();
    const results = await Promise.all(
      ["trip_a", "trip_b", "trip_c", "trip_d", "trip_e"].map((tripId, index) =>
        beginAnonymousFreeChat(request(), {
          createId: ids(tripId),
          env,
          now: () => new Date(`2026-07-14T02:0${index}:00.000Z`),
          requestId: `request_${index}`,
          store,
          trustProxyHeaders: true,
        }),
      ),
    );

    expect(results.slice(0, 4).map((result) => result.status)).toEqual([
      "allowed",
      "allowed",
      "allowed",
      "allowed",
    ]);
    expect(results[4]?.status).toBe("challenge_required");
    if (results[4]?.status === "challenge_required") {
      expect(results[4].response.status).toBe(403);
      await expect(results[4].response.json()).resolves.toMatchObject({
        error: "challenge_required",
      });
    }
    await Promise.all(
      results.map((result) =>
        result.status === "allowed" ? result.settle({ success: false }) : Promise.resolve(),
      ),
    );
  });

  test("fails closed in production when Redis is not configured", async () => {
    const result = await beginAnonymousFreeChat(request(), {
      env: {
        NODE_ENV: "production",
        TRIP_PASS_ANON_HMAC_KEY: "production-secret",
      },
      now: () => new Date("2026-07-14T02:00:00.000Z"),
      requestId: "request_production_missing_redis",
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.response.status).toBe(503);
      await expect(result.response.json()).resolves.toMatchObject({
        error: "unavailable",
        reason: "anonymous_quota_store_unavailable",
      });
    }
  });

  test("binds the seven-day chat allowance to the trip identity across network changes", async () => {
    const store = createMemoryQuotaStore();
    const first = await beginAnonymousFreeChat(request({ forwardedFor: "203.0.113.10" }), {
      createId: ids("trip_network_change"),
      env,
      now: () => new Date("2026-07-14T02:00:00.000Z"),
      requestId: "request_0",
      store,
      trustProxyHeaders: true,
    });
    expect(first.status).toBe("allowed");
    if (first.status !== "allowed") {
      return;
    }
    const cookie = cookiePair(first.headers);
    await first.settle({ success: true });

    for (let index = 1; index < 10; index += 1) {
      const result = await beginAnonymousFreeChat(
        request({ cookie, forwardedFor: index % 2 === 0 ? "203.0.113.10" : "198.51.100.20" }),
        {
          env,
          now: () => new Date(`2026-07-14T02:${String(index).padStart(2, "0")}:00.000Z`),
          requestId: `request_${index}`,
          store,
          trustProxyHeaders: true,
        },
      );
      expect(result.status).toBe("allowed");
      if (result.status === "allowed") {
        await result.settle({ success: true });
      }
    }

    const exhausted = await beginAnonymousFreeChat(
      request({ cookie, forwardedFor: "198.51.100.20" }),
      {
        env,
        now: () => new Date("2026-07-14T02:10:00.000Z"),
        requestId: "request_10",
        store,
        trustProxyHeaders: true,
      },
    );
    expect(exhausted.status).toBe("sign_in_required");
    if (exhausted.status === "sign_in_required") {
      expect(exhausted.response.status).toBe(429);
      await expect(exhausted.response.json()).resolves.toMatchObject({
        error: "sign_in_required",
        reason: "chat_message_free_allowance_exhausted",
      });
    }
  });

  test("uses challenge outcomes for shared-network velocity instead of exhausting one traveler", async () => {
    const store = createMemoryQuotaStore();
    const travelerStatuses: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await beginAnonymousFreeChat(
        request({ forwardedFor: "2001:db8:abcd:12::1" }),
        {
          createId: ids(`hotel_trip_${index}`),
          env: {
            ...env,
            TRIP_PASS_IPV6_COHORT_BITS: "64",
          },
          now: () => new Date(`2026-07-14T03:0${index}:00.000Z`),
          requestId: `hotel_request_${index}`,
          store,
          trustProxyHeaders: true,
        },
      );
      travelerStatuses.push(result.status);
      if (result.status === "allowed") {
        await result.settle({ success: false });
      }
    }

    expect(travelerStatuses).toEqual([
      "allowed",
      "allowed",
      "allowed",
      "allowed",
      "challenge_required",
    ]);
  });

  test("enforces minute starts, concurrency, and parallel final-unit reservations atomically", async () => {
    const store = createMemoryQuotaStore();
    const first = await beginAnonymousFreeChat(request(), {
      createId: ids("trip_parallel"),
      env,
      now: () => new Date("2026-07-14T02:00:00.000Z"),
      requestId: "held_a",
      store,
      trustProxyHeaders: true,
    });
    expect(first.status).toBe("allowed");
    if (first.status !== "allowed") {
      return;
    }
    const cookie = cookiePair(first.headers);

    const second = await beginAnonymousFreeChat(request({ cookie }), {
      env,
      now: () => new Date("2026-07-14T02:00:00.000Z"),
      requestId: "held_b",
      store,
      trustProxyHeaders: true,
    });
    expect(second.status).toBe("allowed");

    const third = await beginAnonymousFreeChat(request({ cookie }), {
      env,
      now: () => new Date("2026-07-14T02:00:00.000Z"),
      requestId: "held_c",
      store,
      trustProxyHeaders: true,
    });
    expect(third.status).toBe("sign_in_required");
    if (second.status === "allowed") {
      await second.settle({ success: false });
    }
    await first.settle({ success: false });

    for (let index = 0; index < 9; index += 1) {
      const result = await beginAnonymousFreeChat(request({ cookie }), {
        env,
        now: () => new Date(`2026-07-14T02:${String(index + 1).padStart(2, "0")}:00.000Z`),
        requestId: `used_${index}`,
        store,
        trustProxyHeaders: true,
      });
      expect(result.status).toBe("allowed");
      if (result.status === "allowed") {
        await result.settle({ success: true });
      }
    }

    const [finalA, finalB] = await Promise.all([
      beginAnonymousFreeChat(request({ cookie }), {
        env,
        now: () => new Date("2026-07-14T02:20:00.000Z"),
        requestId: "final_a",
        store,
        trustProxyHeaders: true,
      }),
      beginAnonymousFreeChat(request({ cookie }), {
        env,
        now: () => new Date("2026-07-14T02:20:00.000Z"),
        requestId: "final_b",
        store,
        trustProxyHeaders: true,
      }),
    ]);

    expect([finalA.status, finalB.status].toSorted()).toEqual(["allowed", "sign_in_required"]);
    await Promise.all(
      [finalA, finalB].map((result) =>
        result.status === "allowed" ? result.settle({ success: true }) : Promise.resolve(),
      ),
    );
  });
});

function request(input: { cookie?: string; forwardedFor?: string } = {}) {
  return new Request("https://ask-siargao.test/api/chat", {
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      "x-forwarded-for": input.forwardedFor ?? "203.0.113.10",
    },
  });
}

function cookiePair(headers: Headers) {
  const cookie = headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toStartWith(`${anonymousTripCookieName}=`);
  return cookie ?? "";
}

function ids(...values: string[]) {
  const remaining = [...values];
  return () => remaining.shift() ?? values.at(-1) ?? "trip_fallback";
}
