import { describe, expect, test } from "bun:test";

import {
  deriveTripContext,
  interpretChatRequestIntent,
  normalizeOptionalTripContextDraft,
  normalizeTripContextClientContext,
  normalizeTripContextDraft,
  parseUserProfileTripContextPatch,
  summarizeClientContextForMetadata,
  summarizeTripContextForAgent,
  summarizeTripContextForLogs,
  summarizeTripContextForStoredHistory,
} from "@/server/chat/trip-context";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

describe("Trip Context module", () => {
  test("accepts only bounded structured trip controls and normalizes recognized aliases", () => {
    expect(
      parseUserProfileTripContextPatch({
        travelerType: "Family with kids",
        transportMode: "scooter",
        rideTimeLimitMinutes: 1,
      }),
    ).toEqual({
      success: true,
      data: {
        travelerType: "family_with_kids",
        transportMode: "scooter",
        rideTimeLimitMinutes: 1,
      },
    });

    expect(parseUserProfileTripContextPatch({ rideTimeLimitMinutes: null })).toEqual({
      success: true,
      data: { rideTimeLimitMinutes: null },
    });
    for (const rideTimeLimitMinutes of [0, -1, 1.5, 361]) {
      const parsed = parseUserProfileTripContextPatch({ rideTimeLimitMinutes });
      expect(parsed.success).toBe(false);
    }
  });

  test("does not backfill former demo values for missing, malformed, or cleared draft fields", () => {
    const emptyDraft = normalizeTripContextDraft();
    const malformedDraft = normalizeTripContextDraft({
      accommodation: " ",
      dateRange: "",
      travelerType: " ",
      nearbyArea: "not-a-siargao-area" as never,
    });
    const clientContext = normalizeTripContextClientContext(
      { tripContext: {} },
      new Date("2026-07-10T00:00:00.000Z"),
    );
    const derived = deriveTripContext([{ role: "user", content: "Help me plan a day." }], {
      clientContext,
    });

    expect(emptyDraft).toEqual({});
    expect(malformedDraft).toEqual({});
    expect(normalizeOptionalTripContextDraft({})).toBeUndefined();
    expect(clientContext.tripContext).toBeUndefined();
    expect(derived.contextSources.uiDraft).toBe(false);
    expect(derived.accommodation).toBeUndefined();
    expect(derived.dateRange).toBeUndefined();
    expect(derived.travelerType).toBeUndefined();
    expect(JSON.stringify({ emptyDraft, malformedDraft, derived })).not.toContain(
      "Near Cloud 9 / Catangnan",
    );
    expect(JSON.stringify({ emptyDraft, malformedDraft, derived })).not.toContain("Jun 12 - 22");
    expect(JSON.stringify({ emptyDraft, malformedDraft, derived })).not.toContain("Couple");
  });

  test("preserves only supplied partial local draft facts", () => {
    const draft = normalizeTripContextDraft({ accommodation: "  Dapa stay  " });
    const context = deriveTripContext([{ role: "user", content: "Plan a quiet day." }], {
      uiDraft: draft,
    });

    expect(draft).toEqual({ accommodation: "Dapa stay" });
    expect(context.accommodation).toBe("Dapa stay");
    expect(context.dateRange).toBeUndefined();
    expect(context.travelerType).toBeUndefined();
    expect(context.contextSources.uiDraft).toBe(true);
  });

  test("seeds stable context from bounded signed-in profile fields", () => {
    const context = deriveTripContext([{ role: "user", content: "Where should we eat tonight?" }], {
      profileContext: {
        budgetLevel: "budget",
        preferredAreas: ["Del Carmen"],
        tripContext: {
          currentArea: "Del Carmen",
          notes: "Private anniversary note should not become model context.",
          rideTimeLimitMinutes: 25,
          transportMode: "tricycle",
        },
      },
    });

    expect(context.currentLocation).toEqual({
      label: "Del Carmen",
      area: "Del Carmen",
      source: "profile",
    });
    expect(context.travelerProfile.budget).toBe("cheap");
    expect(context.durableConstraints).toContain("budget_cheap");
    expect(context.rideTimeLimitMinutes).toBe(25);
    expect(context.transportMode).toBe("tricycle");
    expect(context.contextSources.profile).toBe(true);
  });

  test("carries typed durable traveler preferences into safe planning context", () => {
    const context = deriveTripContext([{ role: "user", content: "Plan my surf day." }], {
      profileContext: {
        surfAbility: "Intermediate",
        quietSleepPreference: true,
        weatherPreference: "avoid_rain",
      },
    });

    expect(context.surfAbility).toBe("intermediate");
    expect(context.prefersQuietSleep).toBe(true);
    expect(context.durableConstraints).toContain("quiet_sleep");
    expect(context.durableConstraints).toContain("rain_avoidance");
  });

  test("does not leak structured food needs into agent or log context", () => {
    const intent = interpretChatRequestIntent({
      messages: [{ role: "user", content: "Help me choose dinner." }],
      profileContext: {
        foodNeeds: ["vegan", "gluten_free"],
        dietaryNotes: "Private allergy details must stay out of trip context.",
      },
    });
    const summaries = JSON.stringify({
      agent: summarizeTripContextForAgent(intent),
      logs: summarizeTripContextForLogs(intent),
    });

    expect(summaries).not.toContain("vegan");
    expect(summaries).not.toContain("gluten_free");
    expect(summaries).not.toContain("Private allergy");
  });

  test("keeps owner profile context authoritative over an adversarial client draft", () => {
    const context = deriveTripContext([{ role: "user", content: "Plan a quiet day." }], {
      profileContext: {
        preferredAreas: ["Del Carmen"],
      },
      uiDraft: {
        accommodation: "Near Cloud 9 / Catangnan",
        dateRange: "Aug 1 - 6",
        travelerType: "Family with kids",
        nearbyArea: "Cloud 9",
      },
    });

    expect(context.currentLocation).toEqual({
      label: "Del Carmen",
      area: "Del Carmen",
      source: "profile",
    });
    expect(context.accommodation).toBeUndefined();
    expect(context.dateRange).toBeUndefined();
    expect(context.travelerProfile.withKids).toBe(false);
    expect(context.durableConstraints).not.toContain("with_kids");
    expect(context.contextSources.uiDraft).toBe(false);
    expect(context.contextSources.profile).toBe(true);
  });

  test("rejects a client draft when an authenticated request has no saved profile", () => {
    const context = deriveTripContext([{ role: "user", content: "Plan a quiet day." }], {
      allowClientTripDraft: false,
      clientContext: normalizeTripContextClientContext(
        {
          tripContext: {
            accommodation: "Stale browser villa",
            dateRange: "Jan 1 - 31",
            travelerType: "Another traveler",
            nearbyArea: "Cloud 9",
          },
        },
        new Date("2026-07-10T00:00:00.000Z"),
      ),
      profileContext: null,
    });

    expect(context.accommodation).toBeUndefined();
    expect(context.dateRange).toBeUndefined();
    expect(context.currentLocation).toBeUndefined();
    expect(context.contextSources.uiDraft).toBe(false);
  });

  test("keeps latest-turn modifiers temporary while stable constraints persist", () => {
    const context = deriveTripContext([
      { role: "user", content: "We are on a budget near Cloud 9 and have no scooter." },
      { role: "assistant", content: "I will keep it close and practical." },
      { role: "user", content: "Anything cheaper that is open now?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(context.travelerProfile.budget).toBe("cheap");
    expect(context.durableConstraints).toContain("budget_cheap");
    expect(context.durableConstraints).toContain("no_scooter");
    expect(context.temporaryModifiers).toContain("cheaper");
    expect(context.temporaryModifiers).toContain("open_now");
  });

  test("lets latest explicit stable-context corrections override older user turns", () => {
    const transportContext = deriveTripContext([
      { role: "user", content: "We are on a budget near Cloud 9 and have no scooter." },
      { role: "assistant", content: "I will keep that close and practical." },
      { role: "user", content: "Actually we rented a scooter, so widen the options." },
    ] satisfies AskSiargaoChatMessage[]);
    const budgetContext = deriveTripContext([
      { role: "user", content: "Keep this cheap and budget-friendly near General Luna." },
      { role: "assistant", content: "I will keep the budget low." },
      { role: "user", content: "Actually make it premium for tonight." },
    ] satisfies AskSiargaoChatMessage[]);

    expect(transportContext.transportMode).toBe("scooter");
    expect(transportContext.durableConstraints).not.toContain("no_scooter");
    expect(budgetContext.travelerProfile.budget).toBe("premium");
    expect(budgetContext.durableConstraints).toContain("budget_premium");
    expect(budgetContext.durableConstraints).not.toContain("budget_cheap");
  });

  test("uses valid browser geolocation only as a near-me proximity anchor", () => {
    const now = new Date("2026-07-08T05:00:00.000Z");
    const clientContext = normalizeTripContextClientContext(
      {
        geolocation: {
          latitude: 9.8116,
          longitude: 126.1651,
          accuracyMeters: 20,
          capturedAt: "2026-07-08T04:55:00.000Z",
          consentScope: "single_request",
        },
        tripContext: {
          accommodation: "Near Cloud 9 / Catangnan",
          dateRange: "Aug 1 - 6",
          travelerType: "Couple",
          nearbyArea: "Cloud 9",
        },
      },
      now,
    );
    const context = deriveTripContext(
      [{ role: "user", content: "What cafes are open now near me?" }],
      {
        clientContext,
      },
    );
    const intent = interpretChatRequestIntent({
      clientContext,
      messages: [{ role: "user", content: "What cafes are open now near me?" }],
    });
    const serializedSafeContext = JSON.stringify({
      agent: summarizeTripContextForAgent(intent),
      metadata: summarizeClientContextForMetadata(clientContext),
    });

    expect(context.currentLocation).toBeUndefined();
    expect(context.currentArea).toBeUndefined();
    expect(context.browserGeolocation).toEqual({
      status: "available",
      source: "browser_geolocation",
      consentScope: "single_request",
      usedAsProximityAnchor: true,
    });
    expect(context.temporaryModifiers).toContain("open_now");
    expect(serializedSafeContext).not.toContain("General Luna");
    expect(serializedSafeContext).not.toContain("9.8116");
    expect(serializedSafeContext).not.toContain("126.1651");
  });

  test("redacts raw profile notes, accommodation, and coordinates from safe summaries", () => {
    const now = new Date("2026-07-08T05:00:00.000Z");
    const clientContext = normalizeTripContextClientContext(
      {
        geolocation: {
          latitude: 9.8116,
          longitude: 126.1651,
          capturedAt: "2026-07-08T04:55:00.000Z",
          consentScope: "trip_session",
        },
      },
      now,
    );
    const intent = interpretChatRequestIntent({
      clientContext,
      messages: [{ role: "user", content: "Where should we eat?" }],
      profileContext: {
        preferredAreas: ["Cloud 9"],
        tripContext: {
          accommodation: "Secret Villa Mango room 4B",
          notes: "Do not reveal this passport schedule note.",
        },
      },
    });
    const summaries = JSON.stringify({
      agent: summarizeTripContextForAgent(intent),
      logs: summarizeTripContextForLogs(intent),
      metadata: summarizeClientContextForMetadata(clientContext),
      storage: summarizeTripContextForStoredHistory(intent),
    });

    expect(summaries).not.toContain("Secret Villa Mango");
    expect(summaries).not.toContain("passport schedule");
    expect(summaries).not.toContain("9.8116");
    expect(summaries).not.toContain("126.1651");
    expect(summaries).toContain("hasAccommodation");
  });

  test("does not create trip context for unrelated non-Siargao prompts", () => {
    const intent = interpretChatRequestIntent({
      messages: [{ role: "user", content: "Who won the NBA finals?" }],
    });

    expect(intent.shouldDeclineNonSiargaoTopic).toBe(true);
    expect(intent.tripContext.currentLocation).toBeUndefined();
    expect(intent.tripContext.currentArea).toBeUndefined();
    expect(intent.tripContext.activeGoal).toBeUndefined();
    expect(intent.tripContext.durableConstraints).toEqual([]);
    expect(intent.tripContext.temporaryModifiers).toEqual([]);
  });
});
