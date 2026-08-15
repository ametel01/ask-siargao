import { z } from "zod";
import type { AgentToolExecutionRequest, AgentToolResult } from "@/server/chat/agent-runtime";
import {
  type AgentToolDependencies,
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { isRecord, optionalNullable } from "@/server/chat/agent-tool-utils";
import type { AnswerSourceSummary, AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import {
  buildWebResearchQueries,
  type ResearchFinding,
  type ResearchWebRequest,
  type ResearchWebResultData,
  runWebResearch,
  webResearchDateContexts,
  webResearchFreshnessLevels,
  webResearchIntents,
  webResearchSourceTypes,
} from "@/server/chat/web-research";

const researchWebSchema = z.strictObject({
  query: z.string().trim().min(2).max(320),
  intent: z.enum(webResearchIntents),
  location: optionalNullable(z.string().trim().min(2).max(120)),
  localDate: optionalNullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dateContext: optionalNullable(z.enum(webResearchDateContexts)),
  sourceTypes: optionalNullable(z.array(z.enum(webResearchSourceTypes)).min(1).max(8)),
  requiredFreshness: optionalNullable(z.enum(webResearchFreshnessLevels)),
  maxSources: optionalNullable(z.number().int().min(1).max(8)),
});

const webResearchIntentSet = new Set(webResearchIntents);
const webResearchSourceTypeSet = new Set(webResearchSourceTypes);

export type ResearchWebArguments = z.infer<typeof researchWebSchema>;

export type WebResearchToolHandlers = {
  researchWeb: ToolHandler<ResearchWebArguments>;
};

export function createWebResearchToolFamily(
  handlers: WebResearchToolHandlers = { researchWeb: researchWebToolResult },
): AgentToolFamily {
  return {
    id: "public_web_research",
    toolNames: ["research_web"],
    tools: {
      research_web: defineTool({
        definition: {
          type: "function",
          name: "research_web",
          description:
            "Research current public web evidence for Siargao recommendations, schedules, availability, prices, safety, disruptions, service lookups such as scooter rental, and other public facts. The model chooses the natural-language query from the user's prompt. Provider-unavailable results are returned as tool evidence for a caveated answer rather than a terminal response.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Natural-language public web research query scoped to the user request.",
              },
              intent: {
                type: "string",
                enum: webResearchIntents,
                description:
                  "Reason public web research is needed: recommendation, schedule, availability, price, safety, how_to, or fact.",
              },
              location: {
                type: ["string", "null"],
                description:
                  "Optional Siargao location or area to target, such as General Luna, Dapa, Del Carmen, or Cloud 9.",
              },
              localDate: {
                type: ["string", "null"],
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                description:
                  "Optional local Philippines date in YYYY-MM-DD format when the request is date-sensitive.",
              },
              dateContext: {
                type: ["string", "null"],
                enum: [...webResearchDateContexts, null],
                description:
                  "Optional date context such as today, tonight, tomorrow, next_7_days, date_range, or none.",
              },
              sourceTypes: {
                type: ["array", "null"],
                items: {
                  type: "string",
                  enum: webResearchSourceTypes,
                },
                description:
                  "Optional source classes to target, such as official, government, local_directory, maps, guide, social, community, news, or weather.",
              },
              requiredFreshness: {
                type: ["string", "null"],
                enum: [...webResearchFreshnessLevels, null],
                description:
                  "Optional minimum freshness expectation: live, same_day, week, month, or stable.",
              },
              maxSources: {
                type: ["integer", "null"],
                minimum: 1,
                maximum: 8,
                description: "Maximum number of scored sources and findings to return.",
              },
            },
            required: [
              "query",
              "intent",
              "location",
              "localDate",
              "dateContext",
              "sourceTypes",
              "requiredFreshness",
              "maxSources",
            ],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: researchWebSchema,
        execute: handlers.researchWeb,
        argumentsForValidation: researchWebArgumentsForValidation,
      }),
    },
  };
}

function researchWebArgumentsForValidation(request: AgentToolExecutionRequest) {
  if (!isRecord(request.arguments)) {
    return request.arguments;
  }

  const args = request.arguments;
  const sourceTypes = normalizeWebResearchSourceTypes(
    args.sourceTypes ??
      args.source_types ??
      args.sourceType ??
      args.source_type ??
      args.sources ??
      args.source_classes ??
      args.sourceClasses,
  );
  const intent = normalizeWebResearchIntent(args.intent);

  return {
    query: normalizeWebResearchQuery(args),
    intent: intent ?? "fact",
    location: normalizeNullableString(args.location ?? args.area ?? args.place ?? args.near),
    localDate: normalizeNullableString(args.localDate ?? args.local_date ?? args.date),
    dateContext: normalizeWebResearchDateContext(args.dateContext ?? args.date_context),
    sourceTypes: sourceTypes ?? null,
    requiredFreshness: normalizeWebResearchFreshness(
      args.requiredFreshness ?? args.required_freshness ?? args.freshness,
    ),
    maxSources: normalizeWebResearchMaxSources(args.maxSources ?? args.max_sources ?? args.limit),
  };
}

function normalizeWebResearchQuery(args: Record<string, unknown>) {
  const directQuery =
    args.query ??
    args.q ??
    args.searchQuery ??
    args.search_query ??
    args.query_text ??
    args.question;
  if (typeof directQuery === "string") {
    return directQuery;
  }

  const queries = args.queries ?? args.search_queries;
  if (Array.isArray(queries)) {
    const firstQuery = queries.find((query): query is string => typeof query === "string");
    if (firstQuery) {
      return firstQuery;
    }
  }

  return directQuery;
}

function normalizeNullableString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeWebResearchIntent(value: unknown) {
  return typeof value === "string" &&
    webResearchIntentSet.has(value as (typeof webResearchIntents)[number])
    ? value
    : undefined;
}

function normalizeWebResearchDateContext(value: unknown) {
  if (typeof value !== "string" || value === "none") {
    return null;
  }
  return webResearchDateContexts.includes(value as (typeof webResearchDateContexts)[number])
    ? value
    : null;
}

function normalizeWebResearchFreshness(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return webResearchFreshnessLevels.includes(value as (typeof webResearchFreshnessLevels)[number])
    ? value
    : null;
}

function normalizeWebResearchMaxSources(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(numericValue) ? Math.min(8, Math.max(1, numericValue)) : null;
}

function normalizeWebResearchSourceTypes(value: unknown) {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalizedSourceTypes = candidates.flatMap((candidate) => {
    if (typeof candidate !== "string") {
      return [];
    }
    const normalized = normalizeWebResearchSourceType(candidate);
    return webResearchSourceTypeSet.has(normalized as (typeof webResearchSourceTypes)[number])
      ? [normalized as (typeof webResearchSourceTypes)[number]]
      : [];
  });
  return normalizedSourceTypes.length > 0 ? [...new Set(normalizedSourceTypes)] : undefined;
}

function normalizeWebResearchSourceType(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "blog":
    case "blogs":
    case "article":
    case "articles":
    case "travel_blog":
    case "travel_blogs":
      return "guide";
    case "official_site":
    case "official_sites":
    case "official_website":
    case "official_websites":
    case "operator":
    case "operators":
      return "official";
    case "directory":
    case "directories":
    case "listing":
    case "listings":
    case "local_listing":
    case "local_listings":
      return "local_directory";
    case "map":
    case "google_maps":
    case "places":
      return "maps";
    case "forum":
    case "forums":
    case "reddit":
      return "community";
    default:
      return normalized;
  }
}

export async function researchWebToolResult(
  args: ResearchWebArguments,
  request: AgentToolExecutionRequest,
  dependencies: AgentToolDependencies,
): Promise<AgentToolResult> {
  const researchRequest = researchWebRequestFromArguments(args);
  const searchedQueries = buildWebResearchQueries(researchRequest);
  const provider = dependencies.webResearchProvider;

  if (!provider) {
    const result = runWebResearch(researchRequest, [], {
      now: dependencies.now?.(),
      providerUnavailable: true,
    });
    return researchWebProviderUnavailableToolResult(result, {
      reason: "not_configured",
      provider: "web_research",
      message:
        "WEB_RESEARCH_PROVIDER is not configured as openai or OPENAI_API_KEY is unavailable.",
    });
  }

  try {
    const providerResults = await provider(researchRequest, {
      requestId: request.requestId,
      searchedQueries,
    });
    const result = runWebResearch(researchRequest, providerResults, {
      now: dependencies.now?.(),
    });

    return {
      name: "research_web",
      status: "success",
      text: renderResearchWebText(result),
      data: result,
      sources: researchWebSourceSummaries(result),
    };
  } catch (error) {
    const providerFailure = summarizeWebResearchProviderFailure(error);
    const result = runWebResearch(researchRequest, [], {
      now: dependencies.now?.(),
      providerUnavailable: true,
    });
    return {
      name: "research_web",
      status: "error",
      text:
        typeof providerFailure.message === "string"
          ? `Public web research provider unavailable: ${providerFailure.message}`
          : "Public web research provider unavailable.",
      logData: { providerFailure },
      data: result,
      errorCode: "provider_unavailable",
      sources: researchWebProviderUnavailableSources(result),
    };
  }
}

function researchWebProviderUnavailableToolResult(
  result: ResearchWebResultData,
  providerFailure?: Record<string, unknown>,
): AgentToolResult {
  return {
    name: "research_web",
    status: "error",
    text: renderResearchWebText(result),
    ...(providerFailure ? { logData: { providerFailure } } : {}),
    data: result,
    errorCode: "provider_unavailable",
    sources: researchWebProviderUnavailableSources(result),
  };
}

function summarizeWebResearchProviderFailure(error: unknown): Record<string, unknown> {
  const record = isRecord(error) ? error : {};
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;

  return {
    reason: "provider_exception",
    provider: "openai_web_search",
    ...(error instanceof Error ? { name: error.name } : {}),
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...stringLogField("code", record.code),
    ...stringLogField("type", record.type),
    ...stringLogField("param", record.param),
    ...stringLogField("requestId", record.request_id ?? record.requestId),
    ...(message ? { message: sanitizeProviderFailureText(message) } : {}),
  };
}

function stringLogField(name: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  return { [name]: sanitizeProviderFailureText(value) };
}

function sanitizeProviderFailureText(value: string) {
  return value
    .replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [redacted]")
    .replaceAll(/\b(api[_-]?key|token|secret)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, 500);
}

function researchWebRequestFromArguments(args: ResearchWebArguments): ResearchWebRequest {
  return {
    query: args.query,
    intent: args.intent,
    ...(args.location ? { location: args.location } : {}),
    ...(args.localDate ? { localDate: args.localDate } : {}),
    ...(args.dateContext ? { dateContext: args.dateContext } : {}),
    ...(args.sourceTypes ? { sourceTypes: args.sourceTypes } : {}),
    ...(args.requiredFreshness ? { requiredFreshness: args.requiredFreshness } : {}),
    ...(args.maxSources ? { maxSources: args.maxSources } : {}),
  };
}

function renderResearchWebText(result: ResearchWebResultData) {
  const lines = [
    `Public web research status: ${result.status}.`,
    `Normalized query: ${result.normalizedQuery}.`,
    `Searched queries: ${result.searchedQueries.join(" | ")}.`,
  ];

  if (result.findings.length > 0) {
    lines.push("Findings:");
    lines.push(
      ...result.findings.map(
        (finding, index) =>
          `${index + 1}. ${finding.claim} (${finding.answerRole}; ${finding.confidence} confidence; ${finding.sourceType}; ${finding.sourceTitle}; ${finding.sourceUrl}).`,
      ),
    );
  } else {
    lines.push("Findings: none.");
  }

  if (result.entities.length > 0) {
    lines.push(
      `Selected entities: ${result.entities
        .map((entity) =>
          [
            entity.name,
            entity.kind,
            entity.area,
            entity.needsPlacesEnrichment ? "needs Places enrichment" : undefined,
          ]
            .filter(Boolean)
            .join(" / "),
        )
        .join("; ")}.`,
    );
  }

  if (result.notChecked.length > 0) {
    lines.push(`Not checked: ${result.notChecked.join("; ")}.`);
  }

  return lines.join("\n");
}

function researchWebSourceSummaries(result: ResearchWebResultData): AnswerSourceSummary[] {
  if (result.status === "provider_unavailable") {
    return researchWebProviderUnavailableSources(result);
  }
  if (result.status === "insufficient") {
    return [
      {
        label: "insufficient_web_evidence",
        sourceName: "Public web research",
        sourceProfileId: "source_web_research",
        confidence: "low",
        checked: [],
        notChecked: [...result.notChecked],
      },
    ];
  }

  return result.findings.map((finding) => ({
    label: researchWebLabelForFinding(finding),
    sourceName: finding.sourceTitle,
    sourceProfileId: `source_web_${finding.sourceType}`,
    ...(finding.publishedOrUpdatedAt ? { fetchedAt: finding.publishedOrUpdatedAt } : {}),
    confidence: finding.confidence,
    checked: [finding.claim],
    notChecked: [...result.notChecked],
  }));
}

function researchWebProviderUnavailableSources(
  result: ResearchWebResultData,
): AnswerSourceSummary[] {
  return [
    {
      label: "provider_unavailable",
      sourceName: "Public web research provider",
      sourceProfileId: "source_web_research",
      confidence: "low",
      checked: [],
      notChecked: [...result.notChecked],
    },
  ];
}

function researchWebLabelForFinding(finding: ResearchFinding): AnswerTrustLabel {
  if (finding.sourceType === "official" || finding.sourceType === "government") {
    return "official_checked";
  }
  if (finding.sourceType === "local_directory") {
    return "directory_checked";
  }
  if (finding.sourceType === "community" || finding.sourceType === "social") {
    return "community_signal";
  }
  return "web_researched";
}
