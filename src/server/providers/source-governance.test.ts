import { describe, expect, test } from "bun:test";

import { detectFactConflicts } from "@/server/facts/conflicts";
import {
  canPublishFactPublicly,
  canUseFactInPaidAudit,
  createGovernedFact,
  normalizeSourceRecord,
} from "@/server/facts/fact-graph";
import {
  computeFactConfidence,
  computeSourceCredibility,
  toFactConfidenceScoreRecord,
  toSourceCredibilityScoreRecord,
} from "@/server/facts/scoring";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
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
});
