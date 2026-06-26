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
    expect(response.message).toContain("Good options I found from Google Places:");
    expect(response.message).toContain("Checked: Google Places ratings, open-now signal");
    expect(response.message).toContain("Not checked: covered seating, bookings, review text");
    expect(response.message).toContain("1. **Dapa Food House**");
    expect(response.message).toContain("Rating: 4.5 (95 reviews)");
    expect(response.message).toContain("Best fit:");
    expect(response.message).toContain("from Dapa");
    expect(response.message).not.toContain("search center");
  });

  test("searches Google Places once for nearby open-now food requests", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "General Luna Grill",
          rating: 4.6,
          userRatingCount: 180,
        });
      },
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "where can I eat nearby that is open now?" }],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "good restaurant near General Luna Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radiusMeters: 6_000,
    });
    expect(response.message).toContain("General Luna Grill");
  });

  test("searches Google Places with bar included type for drinks requests", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "General Luna Beach Bar",
          rating: 4.4,
          userRatingCount: 210,
        });
      },
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "Where can we get drinks near General Luna?" }],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "bar near General Luna Siargao",
      includedType: "bar",
      radiusMeters: 6_000,
    });
    expect(response.message).toContain("General Luna Beach Bar");
  });

  test("searches Google Places deterministically for service-place requests", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "General Luna Pharmacy",
          rating: 4.1,
          userRatingCount: 45,
        });
      },
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "Any pharmacy nearby that is open now?" }],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "pharmacy near General Luna Siargao",
      includedType: "pharmacy",
      radiusMeters: 6_000,
    });
    expect(response.message).toContain("General Luna Pharmacy");
  });

  test("searches a narrow identity query for specific-place map-link requests", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Shaka Siargao",
          rating: 4.7,
          userRatingCount: 500,
        });
      },
    });

    const response = await agent.answer({
      messages: [{ role: "user", content: "Can you find a map link for Shaka Siargao?" }],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "Shaka Siargao",
      radiusMeters: 12_000,
    });
    expect(searches[0]?.textQuery).not.toMatch(/restaurant|cafe|bar/i);
    expect(searches[0]?.includedType).toBeUndefined();
    expect(response.message).toContain("Shaka Siargao");
  });

  test("lets the latest meal request override earlier lunch context without assistant keyword leakage", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          places: [
            {
              placeId: "place_brunch_spot",
              resourceName: "places/place_brunch_spot",
              displayName: "Cloud 9 Brunch Spot",
              formattedAddress: "Cloud 9, General Luna",
              latitude: 9.8117,
              longitude: 126.1652,
              types: ["brunch_restaurant", "cafe", "food"],
              primaryType: "brunch_restaurant",
              businessStatus: "OPERATIONAL",
              googleMapsUri: "https://maps.google.com/?cid=brunch",
              rating: 4.9,
              userRatingCount: 900,
              currentOpeningHours: { openNow: false },
            },
            {
              placeId: "place_dinner_grill",
              resourceName: "places/place_dinner_grill",
              displayName: "Cloud 9 Dinner Grill",
              formattedAddress: "Cloud 9, General Luna",
              latitude: 9.8118,
              longitude: 126.1653,
              types: ["restaurant", "seafood_restaurant", "bar", "food"],
              primaryType: "restaurant",
              businessStatus: "OPERATIONAL",
              googleMapsUri: "https://maps.google.com/?cid=dinner",
              rating: 4.5,
              userRatingCount: 220,
              currentOpeningHours: { openNow: true },
            },
            {
              placeId: "place_coffee_only",
              resourceName: "places/place_coffee_only",
              displayName: "Cloud 9 Coffee Bar",
              formattedAddress: "Cloud 9, General Luna",
              latitude: 9.8119,
              longitude: 126.1654,
              types: ["coffee_shop", "cafe", "food"],
              primaryType: "coffee_shop",
              businessStatus: "OPERATIONAL",
              googleMapsUri: "https://maps.google.com/?cid=coffee",
              rating: 4.8,
              userRatingCount: 700,
              currentOpeningHours: { openNow: true },
            },
          ],
        });
      },
    });

    const response = await agent.answer({
      messages: [
        {
          role: "user",
          content: "We're near Cloud 9 and it is raining. Give me restaurant options for lunch.",
        },
        {
          role: "assistant",
          content: "A cafe in General Luna can be good for coffee if you want brunch.",
        },
        { role: "user", content: "What about dinner?" },
      ],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "dinner restaurants near Cloud 9 Siargao",
      includedType: "restaurant",
      center: { latitude: 9.8116, longitude: 126.1651 },
    });
    expect(searches[0]?.textQuery).not.toMatch(/cafe|coffee|General Luna/i);
    expect(response.message).toContain("1. **Cloud 9 Dinner Grill**");
    expect(response.message).not.toContain("Cloud 9 Coffee Bar");
    expect(response.message).not.toContain("Cloud 9 Brunch Spot");
    expect(response.message).not.toContain("Rain fit:");
    expect(response.message).toContain(
      "Checked Google Places for open nearby options. Covered seating and bookings not verified.",
    );
    expect(response.message).toContain("Best fit: closest strong match");
    expect(response.message).toContain("from Cloud 9, open now.");
    expect(response.message).not.toContain("Google currently reports open.");
    expect(response.message).not.toContain("Not checked: covered seating");
  });

  test("keeps breakfast caveats full but compacts lunch meal follow-up caveats", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: search.textQuery.includes("breakfast") ? "SHAKA Siargao" : "Yugto Siargao",
          rating: 4.7,
          userRatingCount: 500,
        });
      },
    });

    const breakfastResponse = await agent.answer({
      messages: [
        { role: "user", content: "What should I do near Cloud 9 today?" },
        { role: "assistant", content: "Keep it close around Cloud 9." },
        { role: "user", content: "where should i go for breakfast?" },
      ],
    });
    const lunchResponse = await agent.answer({
      messages: [
        { role: "user", content: "What should I do near Cloud 9 today?" },
        { role: "assistant", content: "Keep it close around Cloud 9." },
        { role: "user", content: "where should i go for breakfast?" },
        { role: "assistant", content: breakfastResponse.message },
        { role: "user", content: "what about lunch?" },
      ],
    });

    expect(searches[0]).toMatchObject({
      textQuery: "breakfast restaurants near Cloud 9 Siargao",
      center: { latitude: 9.8116, longitude: 126.1651 },
    });
    expect(searches[1]).toMatchObject({
      textQuery: "lunch restaurants near Cloud 9 Siargao",
      center: { latitude: 9.8116, longitude: 126.1651 },
    });
    expect(breakfastResponse.message).toContain("Checked: Google Places ratings");
    expect(breakfastResponse.message).toContain("Not checked: covered seating");
    expect(lunchResponse.message).toContain(
      "Checked Google Places for open nearby options. Covered seating and bookings not verified.",
    );
    expect(lunchResponse.message).not.toContain("Not checked: covered seating");
  });

  test("searches Google Places for covered cafe open-now follow-ups", async () => {
    const searches: GooglePlacesChatSearch[] = [];
    const agent = new RecommendationAgent({
      placesAdapter: async ({ fetchedAt, search }) => {
        searches.push(search);
        return googlePlacesContext({
          fetchedAt,
          search,
          placeName: "Covered Beachfront Cafe",
          rating: 4.6,
          userRatingCount: 250,
        });
      },
    });

    const response = await agent.answer({
      messages: [
        {
          role: "user",
          content: "yes give me specific covered cafés or beachfront places near General Luna.",
        },
        {
          role: "assistant",
          content: "Here are a few covered cafes near General Luna.",
        },
        { role: "user", content: "open now?" },
      ],
    });

    expect(response.status).toBe("answered");
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      textQuery: "beachfront cafe near General Luna Siargao",
      includedType: "cafe",
      center: { latitude: 9.8006, longitude: 126.1586 },
    });
    expect(response.message).toContain("Covered Beachfront Cafe");
    expect(response.message).toContain("Checked: Google Places ratings");
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
    expect(response.message).toContain("Good options I found from Google Places:");
    expect(response.message).toContain("1. **Dapa Grill Restaurant**");
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
