import { describe, expect, test } from "bun:test";

import {
  type RecommendationAction,
  RecommendationAgent,
  type RecommendationAgentPlanner,
} from "@/server/chat/recommendation-agent";
import {
  type GooglePlacesChatContext,
  type GooglePlacesChatSearch,
  googlePlacesChatSearchFieldMask,
} from "@/server/providers/google-places-chat";
import { googlePlacesDiscoverySourceProfileId } from "@/server/providers/google-places-discovery";

describe("RecommendationAgent", () => {
  test("searches Google Places directly for simple location restaurant requests", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Dapa Food House",
          rating: 4.5,
          userRatingCount: 95,
        });
      },
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "find some good restaurant in dapa" }],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "good restaurant in Dapa Siargao",
      includedType: "restaurant",
      center: { latitude: 9.7594, longitude: 125.9761 },
    });
    expect(response.message).toContain("Good options I found:");
    expect(response.message).toContain("- **1. Dapa Food House**");
    expect(response.message).toContain("Rating: 4.5 (95 reviews)");
  });

  test("lets the planner choose search and ranking actions before rendering candidates", async () => {
    const actions: RecommendationAction[] = [
      { type: "resolve_location", text: "Dapa" },
      {
        type: "search_places",
        query: "restaurant near Dapa Siargao",
        centerLabel: "Dapa",
        includedType: "restaurant",
      },
      {
        type: "rank_candidates",
        preferredTerms: ["restaurant", "grill"],
        excludedTerms: ["carinderia"],
      },
      { type: "final_answer" },
    ];
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      planner: queuePlanner(actions),
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Dapa Grill Restaurant",
          rating: 4.4,
          userRatingCount: 120,
        });
      },
    });

    const response = await agent.answer({
      messages: [
        {
          role: "user",
          content:
            "i'll travel from general luna to del carmen port to go to sugba lagoon, where can i stop to eat?",
        },
      ],
    });

    expect(response.status).toBe("answered");
    expect(searches[0]).toMatchObject({
      textQuery: "restaurant near Dapa Siargao",
      includedType: "restaurant",
      center: { latitude: 9.7594, longitude: 125.9761 },
    });
    expect(response.message).toContain("Good options I found:");
    expect(response.message).toContain("- **1. Dapa Grill Restaurant**");
    expect(response.message).toContain("Rating: 4.4 (120 reviews)");
    expect(response.message).toContain("Maps: https://maps.google.com/?cid=place_dapa");
  });

  test("adapts to a proper-restaurant follow-up without hardcoded fallback copy", async () => {
    const actions: RecommendationAction[] = [
      { type: "resolve_location", text: "Dapa" },
      {
        type: "search_places",
        query: "sit down restaurant near Dapa Siargao",
        centerLabel: "Dapa",
        includedType: "restaurant",
      },
      {
        type: "search_places",
        query: "restaurant near Del Carmen Port Siargao",
        centerLabel: "Del Carmen Port",
        includedType: "restaurant",
      },
      {
        type: "rank_candidates",
        preferredTerms: ["restaurant", "sit down"],
        excludedTerms: ["carinderia", "canteen"],
      },
      { type: "final_answer" },
    ];
    const searchedQueries: string[] = [];
    const agent = new RecommendationAgent({
      planner: queuePlanner(actions),
      placesAdapter: async ({ fetchedAt, search }) => {
        searchedQueries.push(search.textQuery);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: search.textQuery.includes("Del Carmen")
            ? "Port View Restaurant"
            : "Dapa Sit Down Restaurant",
        });
      },
    });

    const response = await agent.answer({
      messages: [
        {
          role: "user",
          content:
            "i'll travel from general luna to del carmen port to go to sugba lagoon, where can i stop to eat on the way there?",
        },
        { role: "assistant", content: "Try roadside carinderias near Dapa." },
        { role: "user", content: "i want proper restaurant not carenderia" },
      ],
    });

    expect(response.status).toBe("answered");
    expect(searchedQueries).toEqual([
      "sit down restaurant near Dapa Siargao",
      "restaurant near Del Carmen Port Siargao",
    ]);
    expect(response.message).toContain("Dapa Sit Down Restaurant");
    expect(response.message).toContain("Port View Restaurant");
    expect(response.message).not.toMatch(/car[ie]nderia/i);
  });

  test("renders fallback searches from planner-selected searches when no candidates are found", async () => {
    const agent = new RecommendationAgent({
      planner: queuePlanner([
        {
          type: "search_places",
          query: "proper restaurant near Dapa Siargao",
          centerLabel: "Dapa",
          includedType: "restaurant",
        },
        {
          type: "search_places",
          query: "restaurant near Del Carmen Port Siargao",
          centerLabel: "Del Carmen Port",
          includedType: "restaurant",
        },
        { type: "final_answer" },
      ]),
      placesAdapter: async ({ fetchedAt, search }) =>
        googlePlacesContext({ fetchedAt, search, places: [] }),
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "proper restaurant not carinderia" }],
    });

    expect(response.message).toContain("Tap these searches instead");
    expect(response.message).toContain("proper restaurant near Dapa Siargao");
    expect(response.message).toContain("restaurant near Del Carmen Port Siargao");
  });
});

function queuePlanner(actions: RecommendationAction[]): RecommendationAgentPlanner {
  let index = 0;
  return async () => actions[index++] ?? { type: "final_answer" };
}

function googlePlacesContext({
  fetchedAt = "2026-06-28T00:00:00.000Z",
  placeName = "Dapa Restaurant",
  places,
  rating = 4.2,
  search,
  userRatingCount = 80,
}: {
  fetchedAt?: string;
  placeName?: string;
  places?: GooglePlacesChatContext["places"];
  rating?: number;
  search: GooglePlacesChatSearch;
  userRatingCount?: number;
}): GooglePlacesChatContext {
  return {
    status: places && places.length === 0 ? "no_results" : "available",
    sourceName: "Google Places",
    sourceProfileId: googlePlacesDiscoverySourceProfileId,
    fetchedAt,
    search,
    fieldMask: googlePlacesChatSearchFieldMask,
    caveats: ["No review text."],
    places: places ?? [
      {
        placeId: `place_${placeName.toLowerCase().replaceAll(/\W+/g, "_")}`,
        resourceName: `places/${placeName}`,
        displayName: placeName,
        formattedAddress: "Dapa, Siargao",
        latitude: 9.7594,
        longitude: 125.9761,
        types: ["restaurant", "food"],
        primaryType: "restaurant",
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=place_dapa",
        rating,
        userRatingCount,
      },
    ],
  };
}
