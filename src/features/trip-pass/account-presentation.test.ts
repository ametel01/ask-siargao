import { describe, expect, test } from "bun:test";

import {
  projectMobileTripPass,
  projectTripPassAccountView,
} from "@/features/trip-pass/account-presentation";
import type { TripPassAccountPresentation } from "@/server/trip-pass/presentation";

describe("Trip Pass account presentation UI projection", () => {
  test.each([
    ["free", "Free travel answers", "Start checkout"],
    ["pending", "Checkout is waiting for confirmation", null],
    ["active", "Trip Pass is active", null],
    ["exhausted", "Trip Pass answers are used", "Start checkout"],
    ["refund_review", "Refund is under review", null],
    ["dispute_suspended", "Trip Pass is suspended", null],
    ["expired", "Trip Pass has expired", "Start checkout"],
    ["revoked", "Trip Pass was revoked", "Start checkout"],
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

    expect(free.resetLabel).toBe("Free travel answers reset every seven days.");
    expect(active.resetLabel).toBe("Travel answers are available until the pass expires.");
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
          expiresSoon: true,
        },
      }),
      "ready",
    );

    expect(view.warnings).toEqual([
      "Travel answers are near the limit: 20 left.",
      "Pass expires soon: 6 Jul.",
    ]);
  });

  test("mobile projection summarizes healthy state and shows actionable warnings", () => {
    expect(projectMobileTripPass(account({ status: "active" }))).toEqual({
      status: "visible",
      tone: "neutral",
      text: "Trip Pass · 150 travel answers left",
    });
    expect(
      projectMobileTripPass(
        account({
          status: "active",
          allowances: [allowance("chat_message", 150, 150, 0, true)],
          attention: {
            lowChatMessages: true,
            expiresSoon: false,
          },
        }),
      ),
    ).toEqual({
      status: "visible",
      tone: "critical",
      text: "Travel answers are used. Manage your Trip Pass in settings.",
    });
    expect(projectMobileTripPass(account({ status: "pending" }))).toMatchObject({
      status: "visible",
      tone: "neutral",
    });
    expect(
      projectMobileTripPass(
        account({
          status: "active",
          allowances: [
            allowance("chat_message", 10, 150, 140, false),
            allowance("live_refresh", 40, 40, 0, true),
          ],
        }),
      ),
    ).toEqual({
      status: "visible",
      tone: "neutral",
      text: "Trip Pass · 140 travel answers left",
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
      ["active", "refund_review", "dispute_suspended"].includes(overrides.status) ? 150 : 10,
      ["active", "refund_review", "dispute_suspended"].includes(overrides.status) ? 150 : 10,
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
      expiresSoon: false,
    },
    checkout: overrides.checkout ?? {
      status: ["active", "refund_review", "dispute_suspended", "unavailable"].includes(
        overrides.status,
      )
        ? "unavailable"
        : "available",
      reason: overrides.status === "unavailable" ? "checkout_unavailable" : null,
    },
    actions: overrides.actions ?? {
      startCheckout: ![
        "active",
        "refund_review",
        "dispute_suspended",
        "pending",
        "unavailable",
      ].includes(overrides.status),
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
