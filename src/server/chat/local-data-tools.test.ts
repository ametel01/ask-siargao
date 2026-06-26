import { describe, expect, test } from "bun:test";

import {
  describeDatabaseSchema,
  localFactsMaxLimit,
  localFactsQuerySchema,
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
});
