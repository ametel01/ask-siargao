import { describe, expect, test } from "bun:test";

import {
  tripPassDifferentiators,
  tripPassPolicyPoints,
  tripPassPublicOffer,
} from "@/features/trip-pass/public-copy";
import { tripPassProductCatalog } from "@/server/trip-pass/catalog";

describe("Trip Pass public copy contract", () => {
  test("renders the launch offer from the catalog-backed presentation", () => {
    expect(tripPassPublicOffer).toMatchObject({
      label: "Siargao Trip Pass",
      priceLabel: "₱499",
      priceAuthority: "stripe_price",
      durationDays: 14,
      freeWindowDays: 7,
      freeLimits: { chat: 10, live: 3, heavy: 1 },
      paidLimits: { chat: 150, live: 40, heavy: 8, weather: 20, route: 25 },
    });
    expect(tripPassPublicOffer.priceLabel).toBe(
      tripPassProductCatalog.presentation.launchPriceLabel,
    );
  });

  test("keeps public positioning truthful and bounded", () => {
    const copy = [
      tripPassPublicOffer.headline,
      ...tripPassDifferentiators,
      ...tripPassPolicyPoints.map((point) => `${point.title} ${point.body}`),
    ].join(" ");

    expect(copy).not.toMatch(/\bunlimited\b/i);
    expect(copy).not.toMatch(/\bguarantee(?:d)?\b/i);
    expect(copy).not.toMatch(/\bExplorer\b|\bExtended\b/);
    expect(copy).toContain("source, freshness, and not-checked boundaries");
    expect(copy).toContain("verified Stripe payment event");
  });
});
