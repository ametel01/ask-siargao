import { describe, expect, test } from "bun:test";

import {
  describeDatabaseSchema,
  getSourceEvidence,
  localFactsMaxLimit,
  localFactsQuerySchema,
  queryLocalFacts,
  sourceEvidenceArgumentsSchema,
} from "@/server/chat/local-data-tools";

describe("local data tools contracts", () => {
  test("describes every approved local data surface", () => {
    const schema = describeDatabaseSchema();

    expect(schema.publicViews.map((view) => view.name)).toEqual([
      "areas",
      "routes",
      "curated_local_guide",
      "public_entities",
      "governed_facts",
      "source_evidence",
    ]);
    expect(schema.defaultLimit).toBe(10);
    expect(schema.maxLimit).toBe(localFactsMaxLimit);
  });

  test("includes field descriptions and query rules for agent-safe discovery", () => {
    const schema = describeDatabaseSchema();

    expect(schema.queryRules).toContain(
      "Use structured filters only: entityTypes, area, tags, text, and limit.",
    );
    expect(schema.queryRules.join(" ")).toContain("SQL-like expressions");

    for (const view of schema.publicViews) {
      expect(view.description.length).toBeGreaterThan(20);
      expect(view.fields.length).toBeGreaterThan(0);
      for (const field of view.fields) {
        expect(field.name.length).toBeGreaterThan(0);
        expect(field.description.length).toBeGreaterThan(12);
        expect(typeof field.required).toBe("boolean");
      }
    }

    const curatedGuide = schema.publicViews.find((view) => view.name === "curated_local_guide");
    expect(curatedGuide?.fields.map((field) => field.name)).toEqual([
      "id",
      "entityType",
      "name",
      "area",
      "tags",
      "claim",
      "confidence",
      "source",
      "caveats",
    ]);
  });

  test("does not advertise restricted tables or provider payload fields", () => {
    const serializedSchema = JSON.stringify(describeDatabaseSchema()).toLowerCase();

    expect(serializedSchema).not.toContain("users");
    expect(serializedSchema).not.toContain("audit_requests");
    expect(serializedSchema).not.toContain("audit_reports");
    expect(serializedSchema).not.toContain("payments");
    expect(serializedSchema).not.toContain("llm_runs");
    expect(serializedSchema).not.toContain("raw_payload");
    expect(serializedSchema).not.toContain("payload_json");
    expect(serializedSchema).not.toContain("text_json");
    expect(serializedSchema).not.toContain("original_text_json");
  });

  test("validates structured local fact queries and caps limits", () => {
    expect(
      localFactsQuerySchema.parse({
        entityTypes: ["Beach", "ROUTE"],
        area: " General Luna ",
        tags: [" Sandy ", "Swimming"],
        text: " family beach ",
        limit: 999,
      }),
    ).toEqual({
      entityTypes: ["beach", "route"],
      area: "general luna",
      tags: ["sandy", "swimming"],
      text: "family beach",
      limit: localFactsMaxLimit,
    });

    expect(() => localFactsQuerySchema.parse({ entityTypes: [], limit: 5 })).toThrow();
    expect(() =>
      localFactsQuerySchema.parse({
        entityTypes: ["users"],
        limit: 5,
      }),
    ).toThrow();
    expect(() =>
      localFactsQuerySchema.parse({
        entityTypes: ["beach"],
        table: "facts",
        limit: 5,
      }),
    ).toThrow();
  });

  test("validates display-safe source evidence arguments", () => {
    expect(
      sourceEvidenceArgumentsSchema.parse({
        factIds: ["curated_local_guide:beach:doot", "fact_route_gl_pacifico"],
      }),
    ).toEqual({
      factIds: ["curated_local_guide:beach:doot", "fact_route_gl_pacifico"],
    });

    expect(() => sourceEvidenceArgumentsSchema.parse({ factIds: [] })).toThrow();
    expect(() =>
      sourceEvidenceArgumentsSchema.parse({
        factIds: ["../../raw-snapshot"],
      }),
    ).toThrow();
    expect(() =>
      sourceEvidenceArgumentsSchema.parse({
        factIds: ["fact_safe"],
        includeRawPayload: true,
      }),
    ).toThrow();
  });

  test("queries curated beach facts with area, tag, text, and limit filters", async () => {
    const result = await queryLocalFacts({
      entityTypes: ["beach"],
      area: "General Luna",
      tags: ["sandy"],
      text: "beach",
      limit: 2,
    });

    expect(result.facts).toHaveLength(2);
    for (const fact of result.facts) {
      expect(fact.entityType).toBe("beach");
      expect(fact.tags).toContain("sandy");
      expect(`${fact.name} ${fact.area} ${fact.claim}`.toLowerCase()).toContain("beach");
      expect(fact.source.label).toBe("curated_local_guide");
      expect(fact.source.sourceName).toBe("Ask Siargao curated local beach guide");
      expect(["high", "medium", "low"]).toContain(fact.confidence);
      expect(fact.caveats.join(" ")).toContain("No live tide/current/access/lifeguard check.");
    }
  });

  test("filters curated guide facts by swimming, rain-fit, and sunset tags", async () => {
    const swimming = await queryLocalFacts({
      entityTypes: ["beach"],
      tags: ["swimming"],
      limit: 3,
    });
    const rainy = await queryLocalFacts({
      entityTypes: ["beach"],
      tags: ["rain-fit"],
      limit: 3,
    });
    const sunset = await queryLocalFacts({
      entityTypes: ["beach"],
      tags: ["sunset"],
      text: "sunset",
      limit: 3,
    });

    expect(swimming.facts.length).toBeGreaterThan(0);
    expect(rainy.facts.length).toBeGreaterThan(0);
    expect(sunset.facts.length).toBeGreaterThan(0);
    expect(swimming.facts.every((fact) => fact.tags.includes("swimming"))).toBe(true);
    expect(rainy.facts.every((fact) => fact.tags.includes("rain-fit"))).toBe(true);
    expect(sunset.facts.every((fact) => fact.tags.includes("sunset"))).toBe(true);
  });

  test("queries approved database route rows through an injected query runner", async () => {
    const queryTexts: string[] = [];
    const result = await queryLocalFacts(
      {
        entityTypes: ["route"],
        area: "General Luna",
        tags: ["transport"],
        limit: 5,
      },
      {
        queryRunner: async (strings) => {
          queryTexts.push(strings.join("?"));
          return [
            {
              id: "route_gl_dapa",
              name: "General Luna to Dapa",
              origin: "General Luna",
              destination: "Dapa",
              transport_modes: ["van", "scooter"],
              risk_notes: ["Check road and ferry conditions separately."],
              raw_payload: { should: "not leak" },
              user_email: "private@example.com",
            },
          ];
        },
      },
    );

    expect(result.facts).toEqual([
      {
        id: "route:route_gl_dapa",
        entityType: "route",
        name: "General Luna to Dapa",
        area: "General Luna to Dapa",
        tags: ["route", "transport", "van", "scooter"],
        claim: "General Luna to Dapa connects General Luna to Dapa by van, scooter.",
        confidence: "medium",
        source: {
          label: "curated_local_guide",
          sourceName: "Ask Siargao baseline route taxonomy",
        },
        caveats: [
          "Check road and ferry conditions separately.",
          "Route taxonomy is not a live ferry, road, traffic, weather, or schedule check.",
        ],
      },
    ]);
    expect(queryTexts.join(" ").toLowerCase()).toContain("from routes");
    expect(queryTexts.join(" ").toLowerCase()).not.toContain("raw_snapshots");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("raw_payload");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("private@example.com");
  });

  test("serializes governed database facts without raw row leakage", async () => {
    const result = await queryLocalFacts(
      {
        entityTypes: ["service"],
        text: "generator",
        limit: 5,
      },
      {
        queryRunner: async (strings) => {
          if (!strings.join("?").includes("from facts")) {
            return [];
          }
          return [
            {
              id: "fact_generator_backup",
              entity_type: "service",
              name: "Backup generator service",
              area: "General Luna",
              claim: "Some accommodations list generator backup as an amenity.",
              fact_type: "generator",
              confidence_label: "medium",
              source_profile_id: "source_local_public",
              source_name: "Local public directory",
              allowed_use: "public_republish",
              fetched_at: new Date("2026-06-26T00:00:00.000Z"),
              payload_json: { should: "not leak" },
              text_json: { should: "not leak" },
              audit_request_id: "audit_private",
            },
          ];
        },
      },
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      id: "fact_generator_backup",
      entityType: "service",
      name: "Backup generator service",
      area: "General Luna",
      confidence: "medium",
      source: {
        label: "fresh_cache",
        sourceName: "Local public directory",
        sourceProfileId: "source_local_public",
        fetchedAt: "2026-06-26T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("payload_json");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("text_json");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("audit_private");
  });

  test("caps query_local_facts results to the normalized maximum limit", async () => {
    const result = await queryLocalFacts({
      entityTypes: ["beach"],
      limit: 999,
    });

    expect(result.query.limit).toBe(localFactsMaxLimit);
    expect(result.facts.length).toBeLessThanOrEqual(localFactsMaxLimit);
  });

  test("returns display-safe evidence for curated local guide fact IDs", async () => {
    const result = await getSourceEvidence({
      factIds: ["curated_local_guide:beach:doot-beach"],
    });

    expect(result.evidence).toEqual([
      {
        factId: "curated_local_guide:beach:doot-beach",
        sourceName: "Ask Siargao curated local beach guide",
        sourceLabel: "curated_local_guide",
        confidence: "medium",
        caveats: [
          "Curated local guide estimate; exact conditions can change by tide, weather, road access, and site conditions.",
        ],
        checked: ["curated beach fit notes", "estimated ride-time notes"],
        notChecked: [
          "live tide",
          "currents",
          "road conditions",
          "access changes",
          "lifeguard or swimming safety",
        ],
      },
    ]);
    expect(result.missingFactIds).toEqual([]);
  });

  test("returns citation-only source evidence without raw source bodies", async () => {
    const result = await getSourceEvidence(
      {
        factIds: ["fact_transport_schedule"],
      },
      {
        queryRunner: async () => [
          {
            fact_id: "fact_transport_schedule",
            confidence_label: "medium",
            source_profile_id: "source_official_transport",
            fetched_at: new Date("2026-06-26T00:00:00.000Z"),
            verified_at: "2026-06-26T01:00:00.000Z",
            expires_at: "2026-06-27T00:00:00.000Z",
            source_name: "Official transport source profile",
            source_allowed_use: "citation_only",
            evidence_label: "official schedule citation",
            citation_url: "https://example.com/schedule",
            citation_text: "Published schedule page",
            evidence_allowed_use: "citation_only",
            public_republish_allowed: false,
            raw_payload: { should: "not leak" },
          },
        ],
      },
    );

    expect(result.evidence).toEqual([
      {
        factId: "fact_transport_schedule",
        sourceName: "Official transport source profile",
        sourceLabel: "not_verified",
        sourceProfileId: "source_official_transport",
        confidence: "medium",
        fetchedAt: "2026-06-26T00:00:00.000Z",
        verifiedAt: "2026-06-26T01:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        citationUrl: "https://example.com/schedule",
        citationText: "Published schedule page",
        caveats: [
          "Citation-only source metadata may be displayed, but source bodies are not copied.",
          "Evidence output is display-safe metadata, not a raw source dump.",
        ],
        checked: [
          "official schedule citation",
          "source fetch timestamp",
          "verification timestamp",
          "freshness boundary",
        ],
        notChecked: ["private audit records", "payment records", "internal model traces"],
      },
    ]);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("raw_payload");
  });

  test("adds Google Places caveats while omitting restricted payload and review fields", async () => {
    const result = await getSourceEvidence(
      {
        factIds: ["fact_google_place_hours"],
      },
      {
        queryRunner: async () => [
          {
            fact_id: "fact_google_place_hours",
            confidence_label: "low",
            source_profile_id: "source_google_places",
            source_name: "Google Places API profile",
            source_allowed_use: "citation_only",
            evidence_label: "allowed Google Places field mask",
            citation_url: "https://maps.google.com/?cid=test",
            evidence_allowed_use: "citation_only",
            public_republish_allowed: false,
            payload_json: { should: "not leak" },
            text_json: { should: "not leak" },
            original_text_json: { should: "not leak" },
          },
        ],
      },
    );

    expect(result.evidence[0]?.caveats).toContain(
      "Google Places evidence requires Google attribution and field-mask governance.",
    );
    expect(result.evidence[0]?.caveats).toContain(
      "Google review content, raw snapshots, and unrestricted payloads are not exposed.",
    );
    expect(result.evidence[0]?.notChecked).toContain("Google review text");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("payload_json");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("text_json");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("original_text_json");
  });

  test("reports unknown fact IDs without broadening the evidence query", async () => {
    const result = await getSourceEvidence(
      {
        factIds: ["missing_fact", "curated_local_guide:beach:malinao-beach"],
      },
      {
        queryRunner: async () => [],
      },
    );

    expect(result.evidence.map((item) => item.factId)).toEqual([
      "curated_local_guide:beach:malinao-beach",
    ]);
    expect(result.missingFactIds).toEqual(["missing_fact"]);
  });

  test("does not display citations when source policy does not allow display", async () => {
    const result = await getSourceEvidence(
      {
        factIds: ["fact_audit_only"],
      },
      {
        queryRunner: async () => [
          {
            fact_id: "fact_audit_only",
            confidence_label: "medium",
            source_profile_id: "source_user_submitted",
            source_name: "User-submitted trip evidence profile",
            source_allowed_use: "audit_only",
            evidence_label: "private host note",
            citation_url: "https://example.com/private",
            citation_text: "Do not show this",
            evidence_allowed_use: "audit_only",
            public_republish_allowed: false,
          },
        ],
      },
    );

    expect(result.evidence[0]).not.toHaveProperty("citationUrl");
    expect(result.evidence[0]).not.toHaveProperty("citationText");
    expect(JSON.stringify(result)).not.toContain("Do not show this");
  });
});
