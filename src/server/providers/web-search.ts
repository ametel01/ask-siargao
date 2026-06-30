import OpenAI from "openai";

import type {
  ResearchEntity,
  ResearchWebRequest,
  WebResearchProviderResult,
  WebResearchSourceType,
} from "@/server/chat/web-research";
import { webResearchSourceTypes } from "@/server/chat/web-research";

export type WebResearchSearchProvider = (
  request: ResearchWebRequest,
  context: {
    requestId: string;
    searchedQueries: readonly string[];
  },
) => Promise<readonly WebResearchProviderResult[]>;

type ResponsesClientLike = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{
      output_text?: string;
      output?: unknown;
      _request_id?: string | null;
    }>;
  };
};

export type OpenAIWebResearchProviderOptions = {
  apiKey?: string;
  client?: ResponsesClientLike;
  enabled?: boolean;
  maxResults?: number;
  model?: string;
};

const openAiWebSearchToolType = "web_search";
const defaultMaxResults = 8;

export function createConfiguredWebResearchProvider(
  options: OpenAIWebResearchProviderOptions = {},
): WebResearchSearchProvider | undefined {
  const enabled =
    options.enabled ?? process.env.WEB_RESEARCH_PROVIDER?.trim().toLowerCase() === "openai";
  if (!enabled) {
    return undefined;
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const client: ResponsesClientLike | undefined =
    options.client ??
    (apiKey ? (new OpenAI({ apiKey }) as unknown as ResponsesClientLike) : undefined);
  if (!client) {
    return undefined;
  }

  return createOpenAIWebResearchProvider({
    client,
    maxResults: options.maxResults,
    model: options.model ?? process.env.OPENAI_WEB_SEARCH_MODEL ?? process.env.OPENAI_MODEL,
  });
}

export function createOpenAIWebResearchProvider({
  client,
  maxResults = defaultMaxResults,
  model = "gpt-5.5",
}: {
  client: ResponsesClientLike;
  maxResults?: number;
  model?: string;
}): WebResearchSearchProvider {
  return async (request, context) => {
    const response = await client.responses.create({
      model,
      store: false,
      tools: [{ type: openAiWebSearchToolType }],
      input: webResearchExtractionPrompt(request, context, maxResults),
      text: {
        format: {
          type: "json_schema",
          name: "ask_siargao_web_research_sources",
          strict: true,
          schema: webResearchSourcesJsonSchema(maxResults),
        },
      },
    });

    return parseWebResearchResponse(response.output_text).slice(0, maxResults);
  };
}

function webResearchExtractionPrompt(
  request: ResearchWebRequest,
  context: { requestId: string; searchedQueries: readonly string[] },
  maxResults: number,
) {
  return [
    "Search the public web for current Ask Siargao evidence.",
    "Return JSON only, matching the provided schema.",
    "Prefer official operator, government, venue, directory, event-calendar, map, news, and recent guide pages.",
    "Do not include private groups, raw page text, user personal data, or unsupported claims.",
    `Request ID: ${context.requestId}`,
    `Intent: ${request.intent}`,
    `Location: ${request.location ?? "Siargao"}`,
    `Date context: ${request.dateContext ?? "none"}`,
    `Required freshness: ${request.requiredFreshness ?? "stable"}`,
    `Allowed source types: ${(request.sourceTypes ?? webResearchSourceTypes).join(", ")}`,
    `Maximum sources: ${maxResults}`,
    "Search queries:",
    ...context.searchedQueries.map((query, index) => `${index + 1}. ${query}`),
  ].join("\n");
}

function webResearchSourcesJsonSchema(maxResults: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        maxItems: maxResults,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "title", "pageSummary", "sourceType"],
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            snippet: { type: "string" },
            pageSummary: { type: "string" },
            sourceType: { type: "string", enum: webResearchSourceTypes },
            publishedOrUpdatedAt: { type: "string" },
            entities: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "kind"],
                properties: {
                  name: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["place", "operator", "event", "route", "service", "activity"],
                  },
                  role: { type: "string" },
                  area: { type: "string" },
                  needsPlacesEnrichment: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  };
}

function parseWebResearchResponse(outputText: string | undefined) {
  if (!outputText) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return [];
  }

  return parsed.results.flatMap((item) => readWebResearchProviderResult(item));
}

function readWebResearchProviderResult(value: unknown): WebResearchProviderResult[] {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.title !== "string") {
    return [];
  }
  const sourceType = readSourceType(value.sourceType);
  return [
    {
      url: value.url,
      title: value.title,
      ...(typeof value.snippet === "string" ? { snippet: value.snippet } : {}),
      ...(typeof value.pageSummary === "string" ? { pageSummary: value.pageSummary } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(typeof value.publishedOrUpdatedAt === "string"
        ? { publishedOrUpdatedAt: value.publishedOrUpdatedAt }
        : {}),
      ...(Array.isArray(value.entities) ? { entities: readResearchEntities(value.entities) } : {}),
    },
  ];
}

function readResearchEntities(values: readonly unknown[]): ResearchEntity[] {
  return values.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.kind !== "string") {
      return [];
    }
    const kind = readResearchEntityKind(value.kind);
    if (!kind) {
      return [];
    }
    return [
      {
        name: value.name,
        kind,
        ...(typeof value.role === "string" ? { role: value.role } : {}),
        ...(typeof value.area === "string" ? { area: value.area } : {}),
        ...(typeof value.needsPlacesEnrichment === "boolean"
          ? { needsPlacesEnrichment: value.needsPlacesEnrichment }
          : {}),
      },
    ];
  });
}

function readResearchEntityKind(value: string): ResearchEntity["kind"] | undefined {
  return ["place", "operator", "event", "route", "service", "activity"].includes(value)
    ? (value as ResearchEntity["kind"])
    : undefined;
}

function readSourceType(value: unknown): WebResearchSourceType | undefined {
  return typeof value === "string" &&
    webResearchSourceTypes.includes(value as WebResearchSourceType)
    ? (value as WebResearchSourceType)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
