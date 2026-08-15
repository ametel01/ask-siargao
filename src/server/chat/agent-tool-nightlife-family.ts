import { z } from "zod";
import type { AgentToolResult } from "@/server/chat/agent-runtime";
import type { AgentToolDependencies } from "@/server/chat/agent-tool-catalogue";

import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { optionalNullable } from "@/server/chat/agent-tool-utils";
import {
  nightlifeEventInterestValues,
  renderNightlifeEventsText,
  searchNightlifeEvents,
} from "@/server/chat/nightlife-events";

const searchNightlifeEventsSchema = z.strictObject({
  location: z.enum(["General Luna"]),
  date: z.enum(["tonight", "today"]),
  interests: optionalNullable(z.array(z.enum(nightlifeEventInterestValues)).max(6)),
});

export type SearchNightlifeEventsArguments = z.infer<typeof searchNightlifeEventsSchema>;

export type NightlifeToolHandlers = {
  searchNightlifeEvents: ToolHandler<SearchNightlifeEventsArguments>;
};

export function createNightlifeToolFamily(
  handlers: NightlifeToolHandlers = {
    searchNightlifeEvents: (args, _request, dependencies) =>
      searchNightlifeEventsToolResult(args, dependencies),
  },
): AgentToolFamily {
  return {
    id: "nightlife_events",
    toolNames: ["search_nightlife_events"],
    tools: {
      search_nightlife_events: defineTool({
        definition: {
          type: "function",
          name: "search_nightlife_events",
          description:
            "Search approved General Luna nightlife event facts before using Google Places for venue details. Use for tonight, party, nightlife, bar-hopping, DJ, live-music, foam-party, pub-quiz, trivia, and drinks-tonight route answers. This returns event schedule evidence, source profile IDs, freshness/expiry metadata, refresh decisions, and route roles, not live crowd size, door policy, guest list, table availability, last-minute cancellation, or exact closing time.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                enum: ["General Luna"],
                description: "Nightlife area currently supported by approved event facts.",
              },
              date: {
                type: "string",
                enum: ["tonight", "today"],
                description: "Time-bound nightlife date to check.",
              },
              interests: {
                type: ["array", "null"],
                items: {
                  type: "string",
                  enum: nightlifeEventInterestValues,
                },
                description:
                  "Optional nightlife interests from the user, such as party, dj, pub_quiz, trivia, foam_party, or drinks.",
              },
            },
            required: ["location", "date", "interests"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: searchNightlifeEventsSchema,
        execute: handlers.searchNightlifeEvents,
      }),
    },
  };
}

function searchNightlifeEventsToolResult(
  args: SearchNightlifeEventsArguments,
  dependencies: AgentToolDependencies,
): AgentToolResult {
  const result = searchNightlifeEvents({
    location: args.location,
    date: args.date,
    ...(args.interests ? { interests: args.interests } : {}),
    now: dependencies.now?.() ?? new Date(),
  });

  return {
    name: "search_nightlife_events",
    status: "success",
    text: renderNightlifeEventsText(result),
    data: {
      status: result.status,
      location: result.location,
      requestedDate: result.requestedDate,
      localDate: result.localDate,
      dayOfWeek: result.dayOfWeek,
      candidates: result.candidates,
      route: result.route,
      boundaries: {
        checked: result.sources.flatMap((source) => source.checked),
        notChecked: [...new Set(result.sources.flatMap((source) => source.notChecked))],
      },
      refreshDecision: result.refreshDecision,
      nextStep:
        "Use Google Places only after this event lookup to enrich selected venue identity, map links, address, business status, opening-hour signal, ratings, and review counts.",
    },
    sources: result.sources,
  };
}
