import { describe, expect, test } from "bun:test";

import {
  type ChatRouteDependencies,
  chatResponse,
  createDefaultChatRouteDependencies,
} from "@/app/api/chat/chat-route";
import { RecommendationAgent } from "@/server/chat/recommendation-agent";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";
import type { OpenMeteoForecastLocation } from "@/server/providers/open-meteo";
import {
  fallbackWeatherSnapshot,
  type WeatherSnapshot,
} from "@/server/public-pages/weather-snapshot";

describe("chat route", () => {
  test("rejects malformed JSON request bodies", async () => {
    const response = await chatResponse(rawRequest("{"), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  test("rejects requests without messages", async () => {
    const response = await chatResponse(jsonRequest({ messages: [] }), chatDependencies());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_chat_request");
    expect(body.issues[0].path).toBe("messages");
  });

  test("politely declines clearly unrelated questions without calling the model", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Can you write Python code for a stock bot?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("I can only help with Siargao");
    expect(dependencies.requests).toHaveLength(0);
    expect(dependencies.weatherRequests).toBe(0);
  });

  test("returns an Ask Siargao model response", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9");
    expect(body.message).toContain("Not checked: Generic model reasoning (not verified)");
    expect(body.message).toContain("live Google Places");
    expect(body.message).not.toContain("Checked: Google Places");
    expect(body.message).not.toContain("Checked: Open-Meteo");
    expect(body.message).not.toContain("Checked: Ask Siargao curated local beach guide");
    expect(body.model).toBeUndefined();
    expect(dependencies.requests[0]?.messages[0]?.content).toBe(
      "Where should we eat near Cloud 9?",
    );
  });

  test("uses recommendation agent before generic model for place requests", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return {
          status: "answered",
          message: "Best verified options I found:\n1. Dapa Grill\nMaps: https://maps.example/dapa",
          model: "gpt-5.5",
        };
      },
    };

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "where can I stop to eat on the way to Sugba Lagoon?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Dapa Grill");
    expect(body.model).toBeUndefined();
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("does not fall back to generic chat when recommendation agent fails", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        throw new Error("planner returned invalid JSON");
      },
    };

    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "suggest me good restaurant to eat near Dapa" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("recommendation_failed");
    expect(body.message).toContain("could not search local places");
    expect(body.message).toContain("Not checked: Google Places (provider unavailable");
    expect(body.message).toContain("Google Places recommendation lookup");
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("default dependencies wire the recommendation agent", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:password@localhost:5432/siargao_portal";

    try {
      const dependencies = createDefaultChatRouteDependencies();

      expect(dependencies.recommendationAgent).toBeDefined();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  test("passes the Siargao weather snapshot to weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What's the weather today in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests[0]?.weatherContext?.sourceProfileId).toBe("source_open_meteo");
    expect(dependencies.requests[0]?.weatherContext?.summary).toContain("Open-Meteo");
  });

  test("proactively loads weather for today activity planning near Cloud 9", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return { status: "unsupported", message: "", model: "gpt-5.5" };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What should I do near Cloud 9 today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("forecast near Cloud 9");
    expect(body.message).toContain("Checked: Open-Meteo weather API (weather checked");
    expect(body.message).toContain("profile source_open_meteo");
    expect(body.message).toContain("Weather signal: Partly cloudy");
    expect(body.message).toContain("Not checked: Open-Meteo weather API (weather checked");
    expect(body.message).toContain("Google Places open-now results");
    expect(body.message).not.toContain("provider unavailable");
    expect(countSourceLines(body.message, "Checked")).toBe(1);
    expect(countSourceLines(body.message, "Weather signal")).toBe(1);
    expect(countSourceLines(body.message, "Not checked")).toBe(1);
    expect(body.message).not.toContain("ask for dinner places");
    expect(agentCalls).toBe(0);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("marks fallback weather snapshots as provider unavailable", async () => {
    const dependencies = chatDependencies();
    dependencies.getLatestSiargaoWeatherSnapshot = async () => {
      dependencies.weatherRequests += 1;
      return fallbackWeatherSnapshot;
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What should I do near Cloud 9 today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).not.toContain("Checked: Open-Meteo weather API");
    expect(body.message).toContain(
      "Not checked: Open-Meteo weather API (provider unavailable; low confidence; profile source_open_meteo)",
    );
    expect(body.message).toContain("Open-Meteo weather snapshot for this request");
    expect(body.message).toContain("Weather signal: live conditions were not available.");
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("tolerates a missing leading letter in Cloud 9 activity prompts", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "hat should I do near Cloud 9 today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("forecast near Cloud 9");
    expect(body.message).toContain("Checked: Open-Meteo weather API (weather checked");
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("loads weather for rainy-day follow-ups using prior Cloud 9 context", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "What should I do near Cloud 9 today?" },
          { role: "assistant", content: "Try the boardwalk and nearby cafes." },
          { role: "user", content: "what if it's a rainy day?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("It looks stormy near Cloud 9 today");
    expect(body.message).toContain("Checked: Open-Meteo weather API (weather checked");
    expect(body.message).toContain("If you want dinner next, I can check open nearby restaurants");
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("uses the Del Carmen forecast location for Del Carmen weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "What's the weather today in Siargao Del Carmen area?" },
        ],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(1);
    expect(dependencies.weatherLocations[0]?.id).toBe("siargao_del_carmen");
    expect(dependencies.weatherLocations[0]?.name).toContain("Del Carmen");
  });

  test("does not fetch weather context for non-weather questions", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where should we eat near Cloud 9?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(dependencies.weatherRequests).toBe(0);
    expect(dependencies.requests[0]?.weatherContext).toBeUndefined();
  });

  test("routes dinner-place follow-ups to recommendation with carried Cloud 9 context", async () => {
    const dependencies = chatDependencies();
    let agentMessages: unknown;
    dependencies.recommendationAgent = {
      answer: async ({ messages }) => {
        agentMessages = messages;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n- Dinner Grill\nMaps: https://maps.example/dinner",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "What should I do near Cloud 9 today?" },
          { role: "assistant", content: "Try the boardwalk and nearby cafes." },
          { role: "user", content: "what if it's a rainy day?" },
          { role: "assistant", content: "Use indoor options around Cloud 9." },
          { role: "user", content: "what about dinner places?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Dinner Grill");
    expect(Array.isArray(agentMessages)).toBe(true);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes covered cafe and beachfront place requests to recommendation", async () => {
    const dependencies = chatDependencies();
    let agentMessages: unknown;
    dependencies.recommendationAgent = {
      answer: async ({ messages }) => {
        agentMessages = messages;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n1. **Covered Cafe**\n  Maps: https://maps.example/cafe",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "something covered" },
          {
            role: "assistant",
            content: "A covered café or beachfront place near General Luna would fit.",
          },
          {
            role: "user",
            content: "yes give me specific covered cafés or beachfront places near General Luna.",
          },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Covered Cafe");
    expect(Array.isArray(agentMessages)).toBe(true);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes open-now follow-ups about prior place recommendations to recommendation", async () => {
    const dependencies = chatDependencies();
    let agentMessages: unknown;
    dependencies.recommendationAgent = {
      answer: async ({ messages }) => {
        agentMessages = messages;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n1. **Open Cafe**\n  Best fit: closest strong match, 300 m from General Luna, open now.",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "yes give me specific covered cafés or beachfront places near General Luna.",
          },
          {
            role: "assistant",
            content: "Good options I found from Google Places:\n1. **Covered Cafe**",
          },
          { role: "user", content: "open now?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Open Cafe");
    expect(Array.isArray(agentMessages)).toBe(true);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("checks open-now follow-ups through trip-context recommendation routing", async () => {
    const dependencies = chatDependencies();
    const searches: GooglePlacesChatSearch[] = [];
    const requiresLiveStatuses: Array<boolean | undefined> = [];
    dependencies.recommendationAgent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, requiresLiveStatus, search }) => {
        searches.push(search);
        requiresLiveStatuses.push(requiresLiveStatus);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Open Cloud 9 Cafe",
          rating: 4.5,
          userRatingCount: 220,
        });
      },
    });

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Where should we get coffee near Cloud 9?" },
          { role: "assistant", content: "Try a cafe near Catangnan." },
          { role: "user", content: "open now?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Open Cloud 9 Cafe");
    expect(countSourceLines(body.message, "Checked")).toBe(1);
    expect(countSourceLines(body.message, "Not checked")).toBe(1);
    expect(requiresLiveStatuses).toEqual([true]);
    expect(searches[0]).toMatchObject({
      textQuery: "cafe near Cloud 9 Siargao",
      includedType: "cafe",
      center: { latitude: 9.8116, longitude: 126.1651 },
    });
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes existential there nearby cafe prompts instead of asking for location context", async () => {
    const dependencies = chatDependencies();
    const searches: GooglePlacesChatSearch[] = [];
    const requiresLiveStatuses: Array<boolean | undefined> = [];
    dependencies.recommendationAgent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, requiresLiveStatus, search }) => {
        searches.push(search);
        requiresLiveStatuses.push(requiresLiveStatus);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "General Luna Open Cafe",
          rating: 4.4,
          userRatingCount: 180,
        });
      },
    });

    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Are there cafes nearby that are open now?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("General Luna Open Cafe");
    expect(body.message).not.toContain("Which Siargao place or area do you mean by there?");
    expect(requiresLiveStatuses).toEqual([true]);
    expect(searches[0]).toMatchObject({
      textQuery: "cafe near General Luna Siargao",
      includedType: "cafe",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 6_000,
    });
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes cheaper there follow-ups through prior trip location context", async () => {
    const dependencies = chatDependencies();
    const searches: GooglePlacesChatSearch[] = [];
    dependencies.recommendationAgent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Cloud 9 Budget Grill",
          rating: 4.3,
          userRatingCount: 140,
        });
      },
    });

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Where should we get dinner near Cloud 9?" },
          { role: "assistant", content: "Here are dinner options near Cloud 9." },
          { role: "user", content: "anything cheaper there?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9 Budget Grill");
    expect(searches[0]).toMatchObject({
      textQuery: "cheap restaurant near Cloud 9 Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 6_000,
    });
    expect(dependencies.requests).toHaveLength(0);
  });

  test("does not keep cheaper search terms after a later open-now route follow-up", async () => {
    const dependencies = chatDependencies();
    const searches: GooglePlacesChatSearch[] = [];
    const requiresLiveStatuses: Array<boolean | undefined> = [];
    dependencies.recommendationAgent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, requiresLiveStatus, search }) => {
        searches.push(search);
        requiresLiveStatuses.push(requiresLiveStatus);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Cloud 9 Dinner Grill",
          rating: 4.5,
          userRatingCount: 220,
        });
      },
    });

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Where should we get dinner near Cloud 9?" },
          { role: "assistant", content: "Here are dinner options near Cloud 9." },
          { role: "user", content: "anything cheaper?" },
          { role: "assistant", content: "Here are cheaper dinner options." },
          { role: "user", content: "open now?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9 Dinner Grill");
    expect(requiresLiveStatuses).toEqual([true]);
    expect(searches[0]).toMatchObject({
      textQuery: "dinner restaurants near Cloud 9 Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 6_000,
    });
    expect(searches[0]?.textQuery).not.toContain("cheap");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes nearby follow-ups through prior trip location context", async () => {
    const dependencies = chatDependencies();
    const searches: GooglePlacesChatSearch[] = [];
    dependencies.recommendationAgent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Cloud 9 Coffee Stop",
          rating: 4.6,
          userRatingCount: 320,
        });
      },
    });

    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "We are staying near Cloud 9." },
          { role: "assistant", content: "That keeps you close to Catangnan." },
          { role: "user", content: "what cafes are nearby?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Cloud 9 Coffee Stop");
    expect(searches[0]).toMatchObject({
      textQuery: "cafe near Cloud 9 Siargao",
      includedType: "cafe",
      center: { latitude: 9.8116, longitude: 126.1651 },
      radiusMeters: 6_000,
    });
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes bar and drinks requests to recommendation", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n1. **Harana Bar**\n  Maps: https://maps.example/bar",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Where can we get drinks near General Luna?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Harana Bar");
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes service-place prompts to recommendation", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n1. **General Luna Pharmacy**\n  Maps: https://maps.example/pharmacy",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "Any pharmacy nearby that is open now?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("General Luna Pharmacy");
    expect(agentCalls).toBe(1);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("routes named-place map-link follow-ups to recommendation", async () => {
    const dependencies = chatDependencies();
    let agentMessages: unknown;
    dependencies.recommendationAgent = {
      answer: async ({ messages }) => {
        agentMessages = messages;
        return {
          status: "answered",
          message:
            "Good options I found from Google Places:\n1. **Shaka Siargao**\n  Maps: https://maps.example/shaka",
          model: "gpt-5.5",
        };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [
          { role: "user", content: "Where should we get coffee near Cloud 9?" },
          { role: "assistant", content: "Shaka Siargao is a common coffee stop near Cloud 9." },
          { role: "user", content: "Can I get the map link for Shaka Siargao?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Shaka Siargao");
    expect(Array.isArray(agentMessages)).toBe(true);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("answers 30-minute General Luna beach questions from the grounded beach guide", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return { status: "unsupported", message: "", model: "gpt-5.5" };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "which beaches can i reach within 30 min ride from general luna?",
          },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("From General Luna");
    expect(body.message).toContain("Doot Beach");
    expect(body.message).toContain("Malinao Beach");
    expect(body.message).toContain("Secret Beach");
    expect(body.message).toContain("not include Pacifico or Alegria");
    expect(body.message).toContain(
      "Checked: Ask Siargao curated local beach guide (curated local guide; medium confidence)",
    );
    expect(body.message).toContain("Not checked: Ask Siargao curated local beach guide");
    expect(body.message).not.toContain("live checked");
    expect(body.message).not.toContain("Google Places API");
    expect(countSourceLines(body.message, "Checked")).toBe(1);
    expect(countSourceLines(body.message, "Not checked")).toBe(1);
    expect(agentCalls).toBe(0);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("inherits prior beach constraints for sandy-only follow-ups", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "which beaches can i reach within 30 min ride from general luna?",
          },
          {
            role: "assistant",
            content:
              "From General Luna, Doot Beach, Malinao Beach, and Secret Beach are close options.",
          },
          { role: "user", content: "i'd like not rocky beaches, sand beaches only" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("sandy, not-rocky beach options");
    expect(body.message).toContain("Doot Beach");
    expect(body.message).toContain("Malinao Beach");
    expect(body.message).toContain("Secret Beach");
    expect(body.message).not.toContain("Cloud 9 beach access");
    expect(body.message).not.toContain("Union Beach area");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("carries ride-time limits into beach follow-ups", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "Which beaches can I reach within 20 min ride from General Luna?",
          },
          {
            role: "assistant",
            content: "Doot and Malinao are the closest beach options.",
          },
          { role: "user", content: "best for swimming?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("about a 20-minute ride");
    expect(body.message).toContain("good sandy shoreline candidate when conditions are calm");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("keeps kids and no-scooter constraints in grounded beach routing", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content:
              "We are with kids near General Luna and have no scooter. Which beaches are within 30 min ride?",
          },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Trip fit notes: travelling with kids");
    expect(body.message).toContain("no scooter / walking constraint");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("lets sunset beach follow-ups override prior swimming modifier", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [
          {
            role: "user",
            content: "which beaches can i reach within 30 min ride from general luna?",
          },
          {
            role: "assistant",
            content:
              "From General Luna, Doot Beach, Malinao Beach, and Secret Beach are close options.",
          },
          { role: "user", content: "i'd like not rocky beaches, sand beaches only" },
          {
            role: "assistant",
            content:
              "For sandy options, I would shortlist Malinao Beach, Doot Beach, and Secret Beach.",
          },
          { role: "user", content: "best for swimming?" },
          {
            role: "assistant",
            content: "For swimming, Malinao and Doot are the easiest close sandy options.",
          },
          { role: "user", content: "what about sunset?" },
        ],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("For sunset with your sandy, not-rocky filter");
    expect(body.message).toContain("late-afternoon beach options");
    expect(body.message).toContain("classic Cloud 9 sunset vibe");
    expect(body.message).not.toContain("good sandy shoreline candidate when conditions are calm");
    expect(dependencies.requests).toHaveLength(0);
  });

  test("asks for clarification when there has no prior referent", async () => {
    const dependencies = chatDependencies();
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "What should I do there today?" }],
      }),
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("Which Siargao place or area do you mean by there?");
    expect(dependencies.weatherRequests).toBe(0);
    expect(dependencies.requests).toHaveLength(0);
  });

  test("does not call recommendation agent for ordinary chat", async () => {
    const dependencies = chatDependencies();
    let agentCalls = 0;
    dependencies.recommendationAgent = {
      answer: async () => {
        agentCalls += 1;
        return { status: "unsupported", message: "", model: "gpt-5.5" };
      },
    };
    const response = await chatResponse(
      jsonRequest({
        messages: [{ role: "user", content: "How many nights should we stay in Siargao?" }],
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(agentCalls).toBe(0);
  });

  test("returns stable unavailable response when OpenAI is not configured", async () => {
    const response = await chatResponse(
      jsonRequest({ messages: [{ role: "user", content: "Hi" }] }),
      {
        generateAskSiargaoChatResponse: async () => {
          throw new Error("OPENAI_API_KEY is required for Ask Siargao chat.");
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("chat_not_configured");
  });
});

function chatDependencies() {
  const requests: Parameters<ChatRouteDependencies["generateAskSiargaoChatResponse"]>[0][] = [];
  const dependencies: ChatRouteDependencies & {
    requests: typeof requests;
    weatherLocations: OpenMeteoForecastLocation[];
    weatherRequests: number;
  } = {
    generateAskSiargaoChatResponse: async (request) => {
      requests.push(request);
      return {
        message: "Near Cloud 9, start with Kermit, Shaka, or Bravo depending on your budget.",
        model: request.model ?? "gpt-5.5",
        requestId: "req_chat_test",
      };
    },
    getLatestSiargaoWeatherSnapshot: async (options) => {
      dependencies.weatherRequests += 1;
      if (options?.location) {
        dependencies.weatherLocations.push(options.location);
      }
      return liveWeatherSnapshot(options?.location?.name);
    },
    requests,
    weatherLocations: [],
    weatherRequests: 0,
  };

  return dependencies;
}

function liveWeatherSnapshot(locationName = "Siargao Island"): WeatherSnapshot {
  return {
    ...fallbackWeatherSnapshot,
    status: "live",
    locationName,
    fetchedAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-27T00:00:00.000Z",
    freshness: "fresh",
    confidence: "medium",
    summary: `Open-Meteo live forecast for ${locationName}.`,
    today: {
      ...fallbackWeatherSnapshot.today,
      date: "2026-06-26",
      condition: "Partly cloudy",
      precipitationProbability: 20,
      precipitationSum: 1.1,
      rainSum: 0.7,
      windGust: 18,
      level: "low",
    },
  };
}

function jsonRequest(body: unknown) {
  return rawRequest(JSON.stringify(body));
}

function rawRequest(body: string) {
  return new Request("https://siargao.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function countSourceLines(message: string, label: "Checked" | "Weather signal" | "Not checked") {
  return message.split("\n").filter((line) => line.startsWith(`${label}:`)).length;
}

function googlePlacesContext({
  fetchedAt = "2026-06-28T00:00:00.000Z",
  placeName,
  rating,
  search,
  userRatingCount,
}: {
  fetchedAt?: string;
  placeName: string;
  rating: number;
  search: GooglePlacesChatSearch;
  userRatingCount: number;
}): GooglePlacesChatContext {
  return {
    status: "available",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt,
    freshness: "live",
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    caveats: ["No review text."],
    places: [
      {
        placeId: `place_${placeName.toLowerCase().replaceAll(/\W+/g, "_")}`,
        resourceName: `places/${placeName}`,
        displayName: placeName,
        formattedAddress: "Cloud 9, General Luna",
        latitude: 9.8117,
        longitude: 126.1652,
        types: ["restaurant", "cafe", "food"],
        primaryType: search.includedType ?? "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: `https://maps.google.com/?cid=${encodeURIComponent(placeName)}`,
        rating,
        userRatingCount,
        currentOpeningHours: { openNow: true },
      },
    ],
  };
}
