import { z } from "zod";
import type { AgentToolExecutionRequest } from "@/server/chat/agent-runtime";
import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { isRecord, optionalNullable } from "@/server/chat/agent-tool-utils";
import {
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

export function createWebResearchToolFamily(handlers: WebResearchToolHandlers): AgentToolFamily {
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
    args.sourceTypes ?? args.source_types ?? args.sourceType ?? args.source_type,
  );
  const intent = normalizeWebResearchIntent(args.intent);

  return {
    query: args.query,
    intent: intent ?? "fact",
    location: args.location ?? null,
    localDate: args.localDate ?? args.local_date ?? null,
    dateContext: args.dateContext ?? args.date_context ?? null,
    sourceTypes: sourceTypes ?? null,
    requiredFreshness: args.requiredFreshness ?? args.required_freshness ?? args.freshness ?? null,
    maxSources: args.maxSources ?? args.max_sources ?? args.limit ?? null,
  };
}

function normalizeWebResearchIntent(value: unknown) {
  return typeof value === "string" &&
    webResearchIntentSet.has(value as (typeof webResearchIntents)[number])
    ? value
    : undefined;
}

function normalizeWebResearchSourceTypes(value: unknown) {
  const candidates = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const sourceTypes = candidates.filter(
    (candidate): candidate is (typeof webResearchSourceTypes)[number] =>
      typeof candidate === "string" &&
      webResearchSourceTypeSet.has(candidate as (typeof webResearchSourceTypes)[number]),
  );
  return sourceTypes.length > 0 ? sourceTypes : undefined;
}
