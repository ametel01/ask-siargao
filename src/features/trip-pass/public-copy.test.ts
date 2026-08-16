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
      priceLabel: "$9.99",
      priceAuthority: "stripe_price",
      durationDays: 14,
      freeWindowDays: 7,
      freeAnswerLimit: 10,
      paidAnswerLimit: 150,
      purchaseActionLabel: "Get the 14-day Trip Pass — $9.99",
      purchaseActivationCopy:
        "Sign in to continue your purchase. Your 14-day Trip Pass activates only after payment is confirmed.",
      value: {
        perAnswerLabel: "$0.07",
        perDayLabel: "$0.71",
      },
    });
    expect(tripPassPublicOffer.priceLabel).toBe(
      tripPassProductCatalog.presentation.launchPriceLabel,
    );
    expect(tripPassPublicOffer.links.purchase).toBe("/sign-in?redirect_url=%2Fsettings%23pass");
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
    expect(copy).not.toMatch(/live decisions|heavy research|route checks|weather allowance/i);
    expect(copy).toContain("source, freshness, and not-checked boundaries");
    expect(copy).toContain("verified Stripe payment event");
  });
});
