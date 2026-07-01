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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
