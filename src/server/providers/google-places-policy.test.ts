import { describe, expect, test } from "bun:test";

import {
  buildGooglePlacesAttributionMetadata,
  computeGooglePlacesFieldStaleAt,
  computeGooglePlacesRequestWindows,
  getGooglePlacesReuseState,
  googlePlacesFieldFreshnessDays,
  googlePlacesRequestPolicies,
  requireGooglePlacesRequestPolicy,
} from "@/server/providers/google-places-policy";

describe("Google Places freshness and retention policy", () => {
  test("uses explicit field masks for every request kind", () => {
    expect(Object.keys(googlePlacesRequestPolicies).toSorted()).toEqual([
      "chat_search",
      "details_atmosphere_reviews",
      "details_enterprise",
      "details_identity_contact",
    ]);

    for (const policy of Object.values(googlePlacesRequestPolicies)) {
      expect(policy.fieldMask.length).toBeGreaterThan(0);
      expect(policy.fieldMask.split(",")).not.toContain("*");
      expect(policy.fieldMask).not.toContain(".*");
    }
  });

  test("computes stale and retention windows separately", () => {
    const windows = computeGooglePlacesRequestWindows({
      requestKind: "details_enterprise",
      fetchedAt: "2026-06-25T00:00:00.000Z",
    });

    expect(windows.staleAt.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(windows.retentionExpiresAt.toISOString()).toBe("2026-07-25T00:00:00.000Z");
    expect(windows.staleAt.getTime()).toBeLessThan(windows.retentionExpiresAt.getTime());
    expect(windows.storagePolicy).toBe("google_attribution_required_cache");
  });

  test("treats stale rows as present but expired rows as blocked from reuse", () => {
    expect(
      getGooglePlacesReuseState({
        now: "2026-07-05T00:00:00.000Z",
        staleAt: "2026-07-02T00:00:00.000Z",
        retentionExpiresAt: "2026-07-25T00:00:00.000Z",
        storagePolicy: "google_attribution_required_cache",
      }),
    ).toBe("stale");

    expect(
      getGooglePlacesReuseState({
        now: "2026-07-26T00:00:00.000Z",
        staleAt: "2026-07-02T00:00:00.000Z",
        retentionExpiresAt: "2026-07-25T00:00:00.000Z",
        storagePolicy: "google_attribution_required_cache",
      }),
    ).toBe("expired");

    expect(
      getGooglePlacesReuseState({
        now: "2026-06-25T00:00:00.000Z",
        staleAt: null,
        retentionExpiresAt: null,
        storagePolicy: "google_no_store",
      }),
    ).toBe("not_legally_reusable");
  });

  test("keeps place IDs durable while limiting Places latitude and longitude to thirty days", () => {
    expect(googlePlacesFieldFreshnessDays.place_id).toBe("indefinite");
    expect(
      computeGooglePlacesFieldStaleAt({
        field: "place_id",
        fetchedAt: "2026-06-25T00:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      computeGooglePlacesFieldStaleAt({
        field: "lat_lng",
        fetchedAt: "2026-06-25T00:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-07-25T00:00:00.000Z");
  });

  test("builds Google attribution metadata from response data", () => {
    expect(
      buildGooglePlacesAttributionMetadata({
        fetchedAt: "2026-06-25T00:00:00.000Z",
        fieldMask: googlePlacesRequestPolicies.chat_search.fieldMask,
        place: {
          googleMapsUri: "https://maps.google.com/?cid=123",
          attributions: [{ provider: "Google" }],
        },
      }),
    ).toEqual({
      sourceName: "Google Places",
      requiresGoogleAttribution: true,
      fieldMask: googlePlacesRequestPolicies.chat_search.fieldMask,
      fetchedAt: "2026-06-25T00:00:00.000Z",
      googleMapsUri: "https://maps.google.com/?cid=123",
      attributions: [{ provider: "Google" }],
    });
  });

  test("fails closed for unknown request kinds and incomplete policy metadata", () => {
    expect(() =>
      requireGooglePlacesRequestPolicy({
        requestKind: "unknown_kind",
      }),
    ).toThrow("Unknown Google Places request kind");

    expect(() =>
      requireGooglePlacesRequestPolicy({
        requestKind: "chat_search",
        policies: {
          ...googlePlacesRequestPolicies,
          chat_search: {
            ...googlePlacesRequestPolicies.chat_search,
            retentionDays: Number.NaN,
          },
        },
      }),
    ).toThrow("missing a valid retention window");

    expect(() =>
      requireGooglePlacesRequestPolicy({
        fieldMask: "places.id",
        requestKind: "chat_search",
      }),
    ).toThrow("field mask does not match");
  });
});
