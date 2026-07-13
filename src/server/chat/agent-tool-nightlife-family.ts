import { z } from "zod";

import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { optionalNullable } from "@/server/chat/agent-tool-utils";
import { nightlifeEventInterestValues } from "@/server/chat/nightlife-events";

const searchNightlifeEventsSchema = z.strictObject({
  location: z.enum(["General Luna"]),
  date: z.enum(["tonight", "today"]),
  interests: optionalNullable(z.array(z.enum(nightlifeEventInterestValues)).max(6)),
});

export type SearchNightlifeEventsArguments = z.infer<typeof searchNightlifeEventsSchema>;

export type NightlifeToolHandlers = {
  searchNightlifeEvents: ToolHandler<SearchNightlifeEventsArguments>;
};

export function createNightlifeToolFamily(handlers: NightlifeToolHandlers): AgentToolFamily {
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
