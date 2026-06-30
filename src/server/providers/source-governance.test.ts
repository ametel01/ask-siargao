import { describe, expect, test } from "bun:test";

import { detectFactConflicts } from "@/server/facts/conflicts";
import {
  canPublishFactPublicly,
  canUseFactInPaidAudit,
  createGovernedEvidence,
  createGovernedFact,
  normalizeSourceRecord,
} from "@/server/facts/fact-graph";
import {
  computeFactConfidence,
  computeSourceCredibility,
  toFactConfidenceScoreRecord,
  toSourceCredibilityScoreRecord,
} from "@/server/facts/scoring";
import { ingestLocalVerifiedAccommodation } from "@/server/providers/accommodation-ingestion";
import {
  createDefaultSourceRegistry,
  nightlifeCommunitySourceProfileIds,
  nightlifeEventSourceProfileIds,
} from "@/server/providers/adapters";
import { SourcePolicyError } from "@/server/providers/source-registry";

const fetchedAt = "2026-06-23T00:00:00.000Z";

describe("source registry and fact governance", () => {
  test("rejects provider data without an explicit source profile", () => {
    const registry = createDefaultSourceRegistry();

    expect(() =>
      normalizeSourceRecord(registry, {
        id: "record_unknown",
        sourceProfileId: "missing_source",
        entityType: "route",
        name: "Unknown route",
        fetchedAt,
        normalizedPayload: {},
      }),
    ).toThrow(SourcePolicyError);
  });

  test("rejects disallowed sources before fact cache insertion", () => {
    const registry = createDefaultSourceRegistry();

    expect(() =>
      normalizeSourceRecord(registry, {
        id: "record_disallowed",
        sourceProfileId: "source_disallowed_scrape",
        entityType: "review",
        name: "Scraped review",
        fetchedAt,
        normalizedPayload: {},
      }),
    ).toThrow(SourcePolicyError);
  });

  test("applies different behavior for audit-only, citation-only, and public-republish facts", () => {
    const registry = createDefaultSourceRegistry();

    const userRecord = normalizeSourceRecord(registry, {
      id: "record_user",
      sourceProfileId: "source_user_submitted",
      entityType: "accommodation",
      name: "Host answer",
      fetchedAt,
      normalizedPayload: { wifi: "host says 50 Mbps" },
    });
    const userFact = createGovernedFact(registry, userRecord, {
      id: "fact_user_wifi",
      entityId: "entity_stay",
      claim: "Host says Wi-Fi is 50 Mbps.",
      factType: "internet_power",
      fetchedAt,
    });

    const weatherRecord = normalizeSourceRecord(registry, {
      id: "record_weather",
      sourceProfileId: "source_open_meteo",
      entityType: "weather",
      name: "Siargao forecast",
      fetchedAt,
      normalizedPayload: { rain: "daily" },
    });
    const weatherFact = createGovernedFact(registry, weatherRecord, {
      id: "fact_weather",
      entityId: "entity_siargao",
      claim: "Daily rainfall forecast is available.",
      factType: "weather",
      fetchedAt,
    });

    const officialRecord = normalizeSourceRecord(registry, {
      id: "record_official",
      sourceProfileId: "source_official_transport",
      entityType: "route",
      name: "Ferry schedule",
      fetchedAt,
      normalizedPayload: { lastFerry: "15:30" },
    });
    const officialFact = createGovernedFact(registry, officialRecord, {
      id: "fact_official_route",
      entityId: "route_surigao_to_dapa",
      claim: "Last listed ferry is 15:30.",
      factType: "route_schedule",
      fetchedAt,
    });

    expect(canUseFactInPaidAudit(userFact)).toBe(true);
    expect(canPublishFactPublicly(userFact, "high")).toBe(false);
    expect(canPublishFactPublicly(weatherFact, "medium")).toBe(true);
    expect(canPublishFactPublicly(officialFact, "high")).toBe(false);
    expect(registry.decide("source_public_tourism_directory").publicRepublishAllowed).toBe(true);
    expect(registry.decide("source_google_places")).toMatchObject({
      canFetch: true,
      canStoreRaw: false,
      canUseInPaidAudit: true,
      canCitePublicly: true,
      canExposeToAgents: false,
      publicRepublishAllowed: false,
    });
  });

  test("stores source credibility and fact confidence separately", () => {
    const registry = createDefaultSourceRegistry();
    const profile = registry.require("source_open_meteo");
    const sourceScore = computeSourceCredibility(profile);
    const record = normalizeSourceRecord(registry, {
      id: "record_weather_confidence",
      sourceProfileId: profile.id,
      entityType: "weather",
      name: "Siargao forecast",
      fetchedAt,
      normalizedPayload: {},
    });
    const fact = createGovernedFact(registry, record, {
      id: "fact_weather_confidence",
      entityId: "entity_siargao",
      claim: "Rain forecast is fresh.",
      factType: "weather",
      fetchedAt,
    });
    const factScore = computeFactConfidence({
      fact,
      sourceCredibility: sourceScore,
      corroboratingSources: 1,
      matchStatus: "confident",
      isFresh: true,
      hasConflict: false,
      directlyStated: true,
    });

    expect(toSourceCredibilityScoreRecord(profile.id, sourceScore).sourceProfileId).toBe(
      profile.id,
    );
    expect(toFactConfidenceScoreRecord(fact.id, factScore).factId).toBe(fact.id);
    expect(sourceScore.drivers).toContain("public-republish-rights");
    expect(factScore.drivers).toContain("fresh");
  });

  test("enforces official-source precedence for route and policy conflicts", () => {
    const registry = createDefaultSourceRegistry();
    const officialRecord = normalizeSourceRecord(registry, {
      id: "record_official_route",
      sourceProfileId: "source_official_transport",
      entityType: "route",
      name: "Official ferry schedule",
      fetchedAt,
      normalizedPayload: {},
    });
    const weatherRecord = normalizeSourceRecord(registry, {
      id: "record_non_official_route",
      sourceProfileId: "source_open_meteo",
      entityType: "route",
      name: "Non-official route note",
      fetchedAt,
      normalizedPayload: {},
    });

    const officialFact = createGovernedFact(registry, officialRecord, {
      id: "fact_official_schedule",
      entityId: "route_surigao_to_dapa",
      claim: "Last ferry departs at 15:30.",
      factType: "route_schedule",
      fetchedAt,
    });
    const nonOfficialFact = createGovernedFact(registry, weatherRecord, {
      id: "fact_non_official_schedule",
      entityId: "route_surigao_to_dapa",
      claim: "Last ferry departs at 17:00.",
      factType: "route_schedule",
      fetchedAt,
    });

    const conflicts = detectFactConflicts([officialFact, nonOfficialFact]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe("route_schedule_conflict");
    expect(conflicts[0]?.preferredFactId).toBe("fact_official_schedule");
    expect(conflicts[0]?.severity).toBe("high");
  });

  test("creates governed accommodation facts and evidence from local verified records", () => {
    const registry = createDefaultSourceRegistry();
    const result = ingestLocalVerifiedAccommodation(
      {
        entityId: "entity_verified_stay",
        name: "Verified Stay",
        aliases: ["Verified Guesthouse"],
        areaSlug: "general-luna",
        fetchedAt,
        sourceUrl: "https://siargao.example/public-directory/verified-stay",
      },
      registry,
    );

    expect(result.sourceRecord.allowedUse).toBe("public_republish");
    expect(result.sourceRecord.rawSnapshot).toBeUndefined();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.sourceProfileId).toBe("source_public_tourism_directory");
    expect(result.facts[0]?.auditUseAllowed).toBe(true);
    expect(result.facts[0]?.publicRepublishAllowed).toBe(true);
    expect(result.evidence[0]?.publicRepublishAllowed).toBe(true);
    expect(result.candidate.evidenceIds).toEqual(["ev_entity_verified_stay_public_directory"]);
  });

  test("does not ingest local accommodation records from disallowed source profiles", () => {
    const registry = createDefaultSourceRegistry();

    expect(() =>
      ingestLocalVerifiedAccommodation(
        {
          entityId: "entity_scraped_stay",
          name: "Scraped Stay",
          areaSlug: "general-luna",
          fetchedAt,
          sourceProfileId: "source_disallowed_scrape",
        },
        registry,
      ),
    ).toThrow(SourcePolicyError);
  });

  test("registers explicit nightlife and event source profiles", () => {
    const registry = createDefaultSourceRegistry();
    const requiredProfiles = [
      "source_nightlife_official_venue_websites",
      "source_nightlife_official_multi_venue_event_pages",
      "source_nightlife_local_event_directories",
      "source_nightlife_venue_submitted_events",
      "source_nightlife_public_official_social_posts",
      "source_nightlife_local_guides",
      "source_nightlife_travel_news_corroboration",
      "source_nightlife_review_travel_platforms",
      "source_nightlife_reddit_public_threads",
      "source_nightlife_youtube_videos",
      "source_nightlife_broad_travel_blogs",
      "source_google_places",
      "source_open_meteo",
    ];

    for (const sourceProfileId of requiredProfiles) {
      expect(registry.require(sourceProfileId)).toMatchObject({
        id: sourceProfileId,
        freshnessWindowDays: expect.any(Number),
        allowedUse: expect.any(String),
        storesRawAllowed: expect.any(Boolean),
        publishesRawAllowed: expect.any(Boolean),
        knownStaleRisk: expect.any(String),
      });
    }

    expect(registry.require("source_nightlife_venue_submitted_events")).toMatchObject({
      accessMethod: "partner",
      allowedUse: "public_republish",
      requiresPartnerApproval: true,
      storesRawAllowed: true,
      publishesRawAllowed: true,
    });
    expect(registry.require("source_nightlife_public_official_social_posts")).toMatchObject({
      accessMethod: "official_page",
      allowedUse: "citation_only",
      storesRawAllowed: false,
      publishesRawAllowed: false,
      freshnessWindowDays: 1,
    });
  });

  test("disallows private social groups and keeps community sources out of event truth", () => {
    const registry = createDefaultSourceRegistry();

    expect(registry.decide("source_nightlife_private_social_groups")).toMatchObject({
      canFetch: false,
      canExtractFacts: false,
      canUseInPaidAudit: false,
      canCitePublicly: false,
    });
    expect(() =>
      registry.assertCanEnterFactGraph("source_nightlife_private_social_groups"),
    ).toThrow(SourcePolicyError);

    for (const sourceProfileId of nightlifeCommunitySourceProfileIds) {
      const profile = registry.require(sourceProfileId);
      expect(profile.authorityLevel).toBeLessThanOrEqual(3);
      expect(profile.notes).toMatch(/not|cannot|only|discovery|context|verify/i);
      expect([...nightlifeEventSourceProfileIds]).not.toContain(sourceProfileId);
    }
  });

  test("governed evidence inherits public republication policy", () => {
    const registry = createDefaultSourceRegistry();
    const userRecord = normalizeSourceRecord(registry, {
      id: "record_user_private_evidence",
      sourceProfileId: "source_user_submitted",
      entityType: "accommodation",
      name: "Host answer",
      fetchedAt,
      normalizedPayload: { area: "General Luna" },
    });
    const userFact = createGovernedFact(registry, userRecord, {
      id: "fact_user_private_area",
      entityId: "entity_user_stay",
      claim: "Host says the stay is in General Luna.",
      factType: "accommodation_area",
      fetchedAt,
    });
    const evidence = createGovernedEvidence(registry, userFact, {
      id: "ev_user_private_area",
      factId: userFact.id,
      sourceRecordId: userRecord.id,
      label: "Host-provided area answer",
    });

    expect(evidence.publicRepublishAllowed).toBe(false);
    expect(evidence.allowedUse).toBe("audit_only");
  });
});
