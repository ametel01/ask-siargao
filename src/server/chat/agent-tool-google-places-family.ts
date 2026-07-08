import { z } from "zod";
import type {
  AgentToolExecutionContext,
  AgentToolExecutionRequest,
} from "@/server/chat/agent-runtime";
import {
  type AgentToolFamily,
  defineTool,
  type ToolHandler,
} from "@/server/chat/agent-tool-catalogue";
import { isRecord, optionalNullable } from "@/server/chat/agent-tool-utils";

type GooglePlacesToolExecutionContext = NonNullable<AgentToolExecutionContext["googlePlaces"]>;

const siargaoCenterSchema = z.strictObject({
  latitude: z.number().min(9.0).max(10.5),
  longitude: z.number().min(125.0).max(127.0),
});

const searchPlacesSchema = z.strictObject({
  query: z.string().trim().min(2).max(180),
  center: siargaoCenterSchema,
  radius_meters: z.number().int().min(500).max(20_000),
  constraints: optionalNullable(
    z.strictObject({
      included_type: optionalNullable(z.string().trim().min(2).max(60)),
      open_now: optionalNullable(z.boolean()),
      page_size: optionalNullable(z.number().int().min(1).max(10)),
    }),
  ),
});
const placeDetailsSchema = z.strictObject({
  place_id: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .regex(/^[A-Za-z0-9_.:-]+$/),
});

export type SearchPlacesArguments = z.infer<typeof searchPlacesSchema>;
export type PlaceDetailsArguments = z.infer<typeof placeDetailsSchema>;

export type GooglePlacesToolContext = ReturnType<typeof normalizeGooglePlacesToolContext>;

export type GooglePlacesToolHandlers = {
  searchPlaces: ToolHandler<SearchPlacesArguments>;
  getPlaceDetails: ToolHandler<PlaceDetailsArguments>;
};

export function createGooglePlacesToolFamily(handlers: GooglePlacesToolHandlers): AgentToolFamily {
  return {
    id: "google_places",
    toolNames: ["search_places", "get_place_details"],
    tools: {
      search_places: defineTool({
        definition: {
          type: "function",
          name: "search_places",
          description:
            "Search governed Google Places results for Siargao places, venues, and local services using allowed chat-search fields. The model chooses a natural-language query from the user's prompt; if another provider failed, successful Places evidence can still support a caveated answer.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural-language place search query scoped to Siargao.",
              },
              center: {
                type: "object",
                properties: {
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                },
                required: ["latitude", "longitude"],
                additionalProperties: false,
              },
              radius_meters: {
                type: "integer",
                minimum: 500,
                maximum: 20000,
                description: "Search radius around the center point.",
              },
              constraints: {
                type: ["object", "null"],
                properties: {
                  included_type: {
                    type: ["string", "null"],
                    description: "Optional Google Places primary type such as restaurant or cafe.",
                  },
                  open_now: {
                    type: ["boolean", "null"],
                    description: "Whether live opening status is needed.",
                  },
                  page_size: {
                    type: ["integer", "null"],
                    minimum: 1,
                    maximum: 10,
                    description: "Maximum number of places to return.",
                  },
                },
                required: ["included_type", "open_now", "page_size"],
                additionalProperties: false,
              },
            },
            required: ["query", "center", "radius_meters", "constraints"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: searchPlacesSchema,
        execute: handlers.searchPlaces,
        argumentsForValidation: searchPlacesArgumentsForValidation,
      }),
      get_place_details: defineTool({
        definition: {
          type: "function",
          name: "get_place_details",
          description:
            "Get governed Google Places identity details for one place ID using cache-first lookup and the allowed details field mask.",
          parameters: {
            type: "object",
            properties: {
              place_id: {
                type: "string",
                description: "Google Places place ID.",
              },
            },
            required: ["place_id"],
            additionalProperties: false,
          },
          strict: true,
        },
        schema: placeDetailsSchema,
        execute: handlers.getPlaceDetails,
      }),
    },
  };
}

export function normalizeGooglePlacesToolContext(
  toolContext: AgentToolExecutionContext | undefined,
) {
  const googlePlaces = toolContext?.googlePlaces;
  if (!googlePlaces) {
    return undefined;
  }

  return {
    center: googlePlaces.center,
    centerSource: googlePlaces.centerSource,
    cacheMode: googlePlaces.cacheMode,
    consentScope: googlePlaces.consentScope,
  };
}

export type GooglePlacesCenterContext = {
  centerSource: GooglePlacesToolExecutionContext["centerSource"];
  consentScope?: GooglePlacesToolExecutionContext["consentScope"];
};

function searchPlacesArgumentsForValidation(request: AgentToolExecutionRequest) {
  if (!isRecord(request.arguments)) {
    return request.arguments;
  }

  const placesToolContext = normalizeGooglePlacesToolContext(request.toolContext);
  if (!placesToolContext?.center) {
    return request.arguments;
  }

  if ("center" in request.arguments && placesToolContext.centerSource !== "browser_geolocation") {
    return request.arguments;
  }

  return {
    ...request.arguments,
    center: placesToolContext.center,
  };
}
