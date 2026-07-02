import { describe, expect, test } from "bun:test";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type { GooglePlacesChatContext } from "@/server/providers/google-places-chat";
import {
  createGooglePlacesChatCaptureInput,
  createGooglePlacesDetailsCaptureInput,
  googlePlacesChatSearchCacheKey,
} from "@/server/providers/google-places-governed-capture";
import {
  googlePlacesAtmosphereDetailsFieldMask,
  googlePlacesRequestPolicies,
} from "@/server/providers/google-places-policy";
import { SourcePolicyError, SourceRegistry } from "@/server/providers/source-registry";

describe("Google Places governed capture", () => {
  test("builds registry-backed chat capture with explicit citation-only policy metadata", () => {
    const context = googlePlacesChatContext();
    const capture = createGooglePlacesChatCaptureInput({
      context,
      place: context.places[0],
      resultIndex: 0,
    });

    expect(capture.governedPolicy).toMatchObject({
      requestKind: "chat_search",
      sourceProfileId: "source_google_places",
      sourceName: "Google Places API",
      allowedUse: "citation_only",
      fieldMask: context.fieldMask,
      fetchedAt: "2026-06-25T22:08:55.090Z",
      storagePolicy: "google_attribution_required_cache",
      requiresGoogleAttribution: true,
      reuseState: "fresh",
      auditUseAllowed: true,
      canCitePublicly: true,
      canExposeToAgents: false,
      rawEvidenceAllowed: false,
      publicRepublishAllowed: false,
    });
    expect(capture.sourceRecord).toMatchObject({
      id: "record_google_places_chat_place_kermit",
      providerEntityId: "place_kermit",
      entityType: "restaurant",
      name: "Kermit Surf Resort and Restaurant",
      sourceUrl: "https://maps.google.com/?cid=123",
      fetchedAt: "2026-06-25T22:08:55.090Z",
      allowedUse: "citation_only",
      normalizedPayload: expect.objectContaining({
        fieldMask: context.fieldMask,
        searchCacheKey: googlePlacesChatSearchCacheKey(context.search),
        storagePolicy: "google_attribution_required_cache",
        publicRepublishAllowed: false,
        auditUseAllowed: true,
        rawEvidenceAllowed: false,
        requiresGoogleAttribution: true,
      }),
    });
    expect(capture.snapshot).toMatchObject({
      requestKind: "chat_search",
      fieldMask: context.fieldMask,
      fetchedAt: "2026-06-25T22:08:55.090Z",
      staleAt: "2026-06-30T22:08:55.090Z",
      retentionExpiresAt: "2026-07-25T22:08:55.090Z",
      storagePolicy: "google_attribution_required_cache",
      attributionJson: expect.objectContaining({
        fieldMask: context.fieldMask,
        requiresGoogleAttribution: true,
      }),
    });
    expect(capture.details).toMatchObject({
      displayNameJson: { text: "Kermit Surf Resort and Restaurant" },
      googleMapsUri: "https://maps.google.com/?cid=123",
      openingHoursJson: { openNow: true },
      rating: 4.6,
      userRatingCount: 1240,
      fetchedAt: "2026-06-25T22:08:55.090Z",
      staleAt: capture.snapshot?.staleAt,
      retentionExpiresAt: capture.snapshot?.retentionExpiresAt,
    });
    expect(capture.governedFacts.length).toBeGreaterThan(0);
    expect(capture.governedFacts.every((fact) => !fact.publicRepublishAllowed)).toBe(true);
    expect(
      capture.governedEvidence.every((evidence) => evidence.allowedUse === "citation_only"),
    ).toBe(true);
  });

  test("builds governed detail capture without exposing review text as public evidence", () => {
    const capture = createGooglePlacesDetailsCaptureInput({
      details: googlePlacesCaptureDetails(),
      requestKind: "details_atmosphere_reviews",
    });

    expect(capture.governedPolicy).toMatchObject({
      requestKind: "details_atmosphere_reviews",
      fieldMask: googlePlacesAtmosphereDetailsFieldMask,
      staleAt: "2026-07-02T00:00:00.000Z",
      retentionExpiresAt: "2026-07-02T00:00:00.000Z",
      publicRepublishAllowed: false,
      rawEvidenceAllowed: false,
    });
    expect(capture.details).toMatchObject({
      displayNameJson: { text: "Kermit Surf Resort and Restaurant", languageCode: "en" },
      paymentOptionsJson: { acceptsCreditCards: true },
      attributionsJson: [{ provider: "Google" }],
      staleAt: "2026-07-02T00:00:00.000Z",
      retentionExpiresAt: "2026-07-02T00:00:00.000Z",
    });
    expect(JSON.stringify(capture.governedFacts)).not.toContain("Great pizza after surfing");
    expect(capture.governedEvidence.every((evidence) => !evidence.publicRepublishAllowed)).toBe(
      true,
    );
  });

  test("marks stale observations and blocks reusable governed facts and evidence", () => {
    const context = googlePlacesChatContext({ fetchedAt: "2026-06-01T00:00:00.000Z" });
    const capture = createGooglePlacesChatCaptureInput({
      context,
      now: "2026-06-08T00:00:00.000Z",
      place: context.places[0],
      resultIndex: 0,
    });

    expect(capture.governedPolicy.reuseState).toBe("stale");
    expect(capture.governedFacts).toEqual([]);
    expect(capture.governedEvidence).toEqual([]);
  });

  test("blocks retention-expired and no-store observations from fact and evidence emission", () => {
    const expiredContext = googlePlacesChatContext({ fetchedAt: "2026-05-01T00:00:00.000Z" });
    const expired = createGooglePlacesChatCaptureInput({
      context: expiredContext,
      now: "2026-06-02T00:00:00.000Z",
      place: expiredContext.places[0],
      resultIndex: 0,
    });
    const noStore = createGooglePlacesChatCaptureInput({
      context: googlePlacesChatContext(),
      policies: {
        ...googlePlacesRequestPolicies,
        chat_search: {
          ...googlePlacesRequestPolicies.chat_search,
          storagePolicy: "google_no_store",
        },
      },
      place: googlePlacesChatContext().places[0],
      resultIndex: 0,
    });

    expect(expired.governedPolicy.reuseState).toBe("expired");
    expect(expired.governedFacts).toEqual([]);
    expect(noStore.governedPolicy.reuseState).toBe("not_legally_reusable");
    expect(noStore.governedEvidence).toEqual([]);
  });

  test("fails closed when source registry or request policy metadata is missing", () => {
    const context = googlePlacesChatContext();

    expect(() =>
      createGooglePlacesChatCaptureInput({
        context,
        place: context.places[0],
        registry: new SourceRegistry([]),
        resultIndex: 0,
      }),
    ).toThrow(SourcePolicyError);

    expect(() =>
      createGooglePlacesChatCaptureInput({
        context,
        place: context.places[0],
        policies: {
          ...googlePlacesRequestPolicies,
          chat_search: {
            ...googlePlacesRequestPolicies.chat_search,
            fieldMask: undefined,
          },
        },
        resultIndex: 0,
      }),
    ).toThrow("missing an explicit field mask");

    expect(() =>
      createGooglePlacesChatCaptureInput({
        context: { ...context, fieldMask: "places.id" },
        place: context.places[0],
        resultIndex: 0,
      }),
    ).toThrow("field mask does not match");
  });

  test("fails closed for disallowed Google Places source profiles", () => {
    const context = googlePlacesChatContext();

    expect(() =>
      createGooglePlacesChatCaptureInput({
        context,
        place: context.places[0],
        registry: createDefaultSourceRegistry(),
        resultIndex: 0,
        sourceProfileId: "source_disallowed_scrape",
      }),
    ).toThrow(SourcePolicyError);
  });
});

function googlePlacesChatContext({
  fetchedAt = "2026-06-25T22:08:55.090Z",
}: {
  fetchedAt?: string;
} = {}): GooglePlacesChatContext {
  return {
    status: "available",
    sourceName: "Google Places",
    sourceProfileId: "source_google_places",
    fetchedAt,
    freshness: "live",
    search: {
      label: "agent_good_restaurant_in_general_luna_siargao",
      textQuery: "good restaurant in General Luna Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 12_000,
      pageSize: 8,
    },
    fieldMask: googlePlacesRequestPolicies.chat_search.fieldMask,
    places: [
      {
        placeId: "place_kermit",
        resourceName: "places/place_kermit",
        displayName: "Kermit Surf Resort and Restaurant",
        formattedAddress: "Tourism Road, General Luna, Siargao",
        latitude: 9.803,
        longitude: 126.161,
        types: ["restaurant", "food", "point_of_interest", "establishment"],
        primaryType: "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=123",
        rating: 4.6,
        userRatingCount: 1240,
        currentOpeningHours: { openNow: true },
      },
    ],
    caveats: [],
  };
}

function googlePlacesCaptureDetails() {
  return {
    placeId: "place_kermit",
    resourceName: "places/place_kermit",
    displayName: "Kermit Surf Resort and Restaurant",
    displayNameJson: { text: "Kermit Surf Resort and Restaurant", languageCode: "en" },
    formattedAddress: "Tourism Road, General Luna, Siargao",
    locationJson: { latitude: 9.803, longitude: 126.161 },
    latitude: 9.803,
    longitude: 126.161,
    types: ["restaurant", "food", "point_of_interest", "establishment"],
    primaryType: "restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=123",
    currentOpeningHoursJson: { openNow: true },
    priceLevel: "PRICE_LEVEL_MODERATE",
    rating: 4.6,
    userRatingCount: 1240,
    paymentOptionsJson: { acceptsCreditCards: true },
    attributionsJson: [{ provider: "Google" }],
    reviews: [
      {
        name: "places/place_kermit/reviews/review_1",
        rating: 5,
        text: { text: "Great pizza after surfing.", languageCode: "en" },
      },
    ],
    fieldMask: googlePlacesAtmosphereDetailsFieldMask,
    fetchedAt: "2026-06-25T00:00:00.000Z",
  };
}
