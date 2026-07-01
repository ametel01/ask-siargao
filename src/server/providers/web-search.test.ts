import { describe, expect, test } from "bun:test";

import {
  createConfiguredWebResearchProvider,
  createOpenAIWebResearchProvider,
} from "@/server/providers/web-search";

describe("web research provider", () => {
  test("is disabled unless explicitly configured", () => {
    const originalProvider = process.env.WEB_RESEARCH_PROVIDER;
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.WEB_RESEARCH_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(createConfiguredWebResearchProvider()).toBeUndefined();
      expect(createConfiguredWebResearchProvider({ enabled: true })).toBeUndefined();
    } finally {
      restoreEnv("WEB_RESEARCH_PROVIDER", originalProvider);
      restoreEnv("OPENAI_API_KEY", originalKey);
    }
  });

  test("uses OpenAI hosted web_search and parses structured source results", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = createOpenAIWebResearchProvider({
      model: "gpt-test-search",
      client: {
        responses: {
          create: async (params) => {
            requests.push(params);
            return {
              output_text: JSON.stringify({
                results: [
                  {
                    url: "https://siargaovibes.com/events/funky-wednesday",
                    title: "Funky Wednesday at Goodies",
                    pageSummary: "Goodies lists Funky Wednesday from 8 PM to 12 AM.",
                    sourceType: "local_directory",
                    publishedOrUpdatedAt: "2026-07-01T09:00:00+08:00",
                    entities: [
                      {
                        name: "Goodies",
                        kind: "place",
                        area: "General Luna",
                        needsPlacesEnrichment: true,
                      },
                    ],
                  },
                ],
              }),
            };
          },
        },
      },
    });

    const results = await provider(
      {
        query: "Goodies Wednesday party",
        intent: "schedule",
        location: "General Luna",
        dateContext: "today",
        requiredFreshness: "same_day",
        sourceTypes: ["official", "local_directory"],
        maxSources: 3,
      },
      {
        requestId: "request_web_search_provider",
        searchedQueries: ["Goodies Wednesday party official", "Goodies Wednesday party events"],
      },
    );

    expect(requests[0]).toMatchObject({
      model: "gpt-test-search",
      store: false,
      tools: [{ type: "web_search" }],
    });
    expect(JSON.stringify(requests[0])).not.toContain("rawPageText");
    expect(results).toEqual([
      {
        url: "https://siargaovibes.com/events/funky-wednesday",
        title: "Funky Wednesday at Goodies",
        pageSummary: "Goodies lists Funky Wednesday from 8 PM to 12 AM.",
        sourceType: "local_directory",
        publishedOrUpdatedAt: "2026-07-01T09:00:00+08:00",
        entities: [
          {
            name: "Goodies",
            kind: "place",
            area: "General Luna",
            needsPlacesEnrichment: true,
          },
        ],
      },
    ]);
  });

  test("adds direct-source extraction rules for motorbike rental research", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = createOpenAIWebResearchProvider({
      client: {
        responses: {
          create: async (params) => {
            requests.push(params);
            return { output_text: JSON.stringify({ results: [] }) };
          },
        },
      },
    });

    await provider(
      {
        query: "motorbike rental in General Luna",
        intent: "recommendation",
        location: "General Luna",
      },
      {
        requestId: "request_motorbike_rental_web_search",
        searchedQueries: ["motorbike rental in general luna rates contact whatsapp deposit helmet"],
      },
    );

    const prompt = String(requests[0]?.input ?? "");
    expect(prompt).toContain("directly identify rental operators");
    expect(prompt).toContain("Exclude hotels, cafes, restaurants, attractions");
    expect(prompt).toContain("motorbike parking");
  });

  test("defaults hosted web_search to gpt-5.4-mini without inheriting OPENAI_MODEL", async () => {
    const originalProvider = process.env.WEB_RESEARCH_PROVIDER;
    const originalModel = process.env.OPENAI_MODEL;
    const originalWebSearchModel = process.env.OPENAI_WEB_SEARCH_MODEL;
    process.env.WEB_RESEARCH_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "model-that-must-not-be-inherited";
    delete process.env.OPENAI_WEB_SEARCH_MODEL;
    const requests: Record<string, unknown>[] = [];

    try {
      const provider = createConfiguredWebResearchProvider({
        client: {
          responses: {
            create: async (params) => {
              requests.push(params);
              return { output_text: JSON.stringify({ results: [] }) };
            },
          },
        },
      });

      await provider?.(
        { query: "party tonight General Luna", intent: "recommendation" },
        { requestId: "request_default_web_search_model", searchedQueries: ["party tonight"] },
      );
    } finally {
      restoreEnv("WEB_RESEARCH_PROVIDER", originalProvider);
      restoreEnv("OPENAI_MODEL", originalModel);
      restoreEnv("OPENAI_WEB_SEARCH_MODEL", originalWebSearchModel);
    }

    expect(requests[0]?.model).toBe("gpt-5.4-mini");
  });

  test("builds a strict schema with every object property required", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = createOpenAIWebResearchProvider({
      client: {
        responses: {
          create: async (params) => {
            requests.push(params);
            return { output_text: JSON.stringify({ results: [] }) };
          },
        },
      },
    });

    await provider(
      { query: "scooter rental General Luna Siargao", intent: "recommendation" },
      {
        requestId: "request_strict_schema_shape",
        searchedQueries: ["scooter rental General Luna Siargao"],
      },
    );

    const schema = readTextSchema(requests[0]);
    const resultsSchema = readObjectProperty(schema, "results");
    const resultItemSchema = readRecord(resultsSchema.items);
    const resultProperties = readRecord(resultItemSchema.properties);

    expect(sortedStrings(readRequired(resultItemSchema))).toEqual(
      sortedStrings(Object.keys(resultProperties)),
    );
    expect(readRecord(resultProperties.snippet).type).toEqual(["string", "null"]);
    expect(readRecord(resultProperties.pageSummary).type).toEqual(["string", "null"]);
    expect(readRecord(resultProperties.publishedOrUpdatedAt).type).toEqual(["string", "null"]);
    expect(readRecord(resultProperties.sourceType).enum).toContain(null);

    const entitiesSchema = readRecord(resultProperties.entities);
    const entityItemSchema = readRecord(entitiesSchema.items);
    const entityProperties = readRecord(entityItemSchema.properties);

    expect(sortedStrings(readRequired(entityItemSchema))).toEqual(
      sortedStrings(Object.keys(entityProperties)),
    );
    expect(readRecord(entityProperties.role).type).toEqual(["string", "null"]);
    expect(readRecord(entityProperties.area).type).toEqual(["string", "null"]);
    expect(readRecord(entityProperties.needsPlacesEnrichment).type).toEqual(["boolean", "null"]);
  });

  test("parses nullable strict optional fields without surfacing null values", async () => {
    const provider = createOpenAIWebResearchProvider({
      client: {
        responses: {
          create: async () => ({
            output_text: JSON.stringify({
              results: [
                {
                  url: "https://example.com/scooters",
                  title: "General Luna Scooter Rentals",
                  snippet: null,
                  pageSummary: null,
                  sourceType: null,
                  publishedOrUpdatedAt: null,
                  entities: [
                    {
                      name: "General Luna scooter rental",
                      kind: "service",
                      role: null,
                      area: null,
                      needsPlacesEnrichment: null,
                    },
                  ],
                },
              ],
            }),
          }),
        },
      },
    });

    await expect(
      provider(
        { query: "scooter rental General Luna Siargao", intent: "recommendation" },
        {
          requestId: "request_nullable_strict_optional_fields",
          searchedQueries: ["scooter rental General Luna Siargao"],
        },
      ),
    ).resolves.toEqual([
      {
        url: "https://example.com/scooters",
        title: "General Luna Scooter Rentals",
        entities: [
          {
            name: "General Luna scooter rental",
            kind: "service",
          },
        ],
      },
    ]);
  });

  test("returns no sources for malformed provider output", async () => {
    const provider = createOpenAIWebResearchProvider({
      client: {
        responses: {
          create: async () => ({ output_text: "not json" }),
        },
      },
    });

    await expect(
      provider(
        { query: "ferry update", intent: "safety" },
        { requestId: "request_malformed_web_search", searchedQueries: ["ferry update"] },
      ),
    ).resolves.toEqual([]);
  });
});

function readTextSchema(request: Record<string, unknown> | undefined) {
  const text = readRecord(request?.text);
  const format = readRecord(text.format);
  return readRecord(format.schema);
}

function readObjectProperty(schema: Record<string, unknown>, property: string) {
  return readRecord(readRecord(schema.properties)[property]);
}

function readRequired(schema: Record<string, unknown>) {
  const required = schema.required;
  if (!Array.isArray(required) || !required.every((value) => typeof value === "string")) {
    throw new Error("Expected schema.required to be an array of strings");
  }
  return required;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function sortedStrings(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
