import { describe, expect, test } from "bun:test";

import {
  projectMobileTripPass,
  projectTripPassAccountView,
} from "@/features/trip-pass/account-presentation";
import type { TripPassAccountPresentation } from "@/server/trip-pass/presentation";

describe("Trip Pass account presentation UI projection", () => {
  test.each([
    ["free", "Free launch allowance", "Start checkout"],
    ["pending", "Checkout is waiting for confirmation", "Start checkout"],
    ["active", "Trip Pass is active", null],
    ["expired", "Trip Pass has expired", "Start checkout"],
    ["unavailable", "Trip Pass checkout is unavailable", null],
  ] as const)("projects %s account state", (status, headline, actionLabel) => {
    const view = projectTripPassAccountView(account({ status }), "ready");

    expect(view.headline).toBe(headline);
    expect(view.actionLabel).toBe(actionLabel);
    expect(view.announcement).not.toContain("unlimited");
    expect(view.detail).not.toContain("guarantee");
  });

  test("distinguishes fetch unavailability from exhausted allowances", () => {
    const view = projectTripPassAccountView(null, "unavailable");

    expect(view.status).toBe("unavailable");
    expect(view.headline).toBe("Trip Pass status is temporarily unavailable");
    expect(view.warnings).toEqual(["Status could not be refreshed."]);
    expect(view.detail).not.toContain("exhausted");
  });

  test("projects seven-day reset copy for free states and expiry for paid states", () => {
    const free = projectTripPassAccountView(account({ status: "free" }), "ready");
    const active = projectTripPassAccountView(
      account({ status: "active", expiresAt: "2026-07-18T08:00:00.000Z" }),
      "ready",
    );

    expect(free.resetLabel).toBe("Free launch allowances reset every seven days.");
    expect(active.resetLabel).toBe("Paid allowances last until the pass expires.");
    expect(active.validityLabel).toBe("Expires 18 Jul");
  });

  test("warns only from API-projected allowance and expiry signals", () => {
    const view = projectTripPassAccountView(
      account({
        status: "active",
        expiresAt: "2026-07-06T06:00:00.000Z",
        allowances: [
          allowance("chat_message", 130, 150, 20, true),
          allowance("live_refresh", 40, 40, 0, true),
        ],
        attention: {
          lowChatMessages: true,
          lowLiveRefreshes: true,
          expiresSoon: true,
        },
      }),
      "ready",
    );

    expect(view.warnings).toEqual([
      "Chat answers are near the limit: 20 left.",
      "Live refreshes allowance is exhausted.",
      "Pass expires soon: 6 Jul.",
    ]);
  });

  test("mobile projection hides healthy states and shows only actionable warnings", () => {
    expect(projectMobileTripPass(account({ status: "active" }))).toEqual({ status: "hidden" });
    expect(
      projectMobileTripPass(
        account({
          status: "active",
          allowances: [allowance("live_refresh", 40, 40, 0, true)],
          attention: {
            lowChatMessages: false,
            lowLiveRefreshes: true,
            expiresSoon: false,
          },
        }),
      ),
    ).toEqual({
      status: "visible",
      tone: "critical",
      text: "Live refreshes allowance is exhausted. Use cached/local evidence or wait for the next allowance window.",
    });
    expect(projectMobileTripPass(account({ status: "pending" }))).toMatchObject({
      status: "visible",
      tone: "neutral",
    });
  });
});

function account(
  overrides: Partial<TripPassAccountPresentation> & {
    expiresAt?: string | null;
    status: TripPassAccountPresentation["status"];
  },
): TripPassAccountPresentation {
  const allowances = overrides.allowances ?? [
    allowance(
      "chat_message",
      0,
      overrides.status === "active" ? 150 : 10,
      overrides.status === "active" ? 150 : 10,
      false,
    ),
    allowance(
      "live_refresh",
      0,
      overrides.status === "active" ? 40 : 3,
      overrides.status === "active" ? 40 : 3,
      false,
    ),
  ];
  return {
    status: overrides.status,
    product: {
      label: "Siargao Trip Pass",
      durationDays: 14,
    },
    validity: {
      startsAt: overrides.validity?.startsAt ?? null,
      expiresAt:
        overrides.expiresAt ??
        overrides.validity?.expiresAt ??
        (overrides.status === "expired" ? "2026-07-03T08:00:00.000Z" : null),
    },
    allowances,
    attention: overrides.attention ?? {
      lowChatMessages: false,
      lowLiveRefreshes: false,
      expiresSoon: false,
    },
    checkout: overrides.checkout ?? {
      status:
        overrides.status === "active" || overrides.status === "unavailable"
          ? "unavailable"
          : "available",
      reason: overrides.status === "unavailable" ? "checkout_unavailable" : null,
    },
    actions: overrides.actions ?? {
      startCheckout: overrides.status !== "active" && overrides.status !== "unavailable",
    },
  };
}

function allowance(
  meterType: TripPassAccountPresentation["allowances"][number]["meterType"],
  used: number,
  limit: number,
  remaining: number,
  warning: boolean,
): TripPassAccountPresentation["allowances"][number] {
  return {
    meterType,
    used,
    limit,
    remaining,
    warning,
  };
}
