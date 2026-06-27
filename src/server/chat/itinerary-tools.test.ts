import { describe, expect, test } from "bun:test";

import { planLocalItinerary } from "@/server/chat/itinerary-tools";

describe("local itinerary planning tools", () => {
  test("rainy Cloud 9 afternoon includes weather-needed caveats, fallbacks, and skip guidance", () => {
    const result = planLocalItinerary({
      theme: "rainy_cloud_9_afternoon",
      origin: "Cloud 9",
      duration_hours: 3,
      needs_weather_check: true,
      max_ride_minutes: 30,
    });

    expect(result.plan.title).toBe("Rainy Cloud 9 Afternoon");
    expect(result.plan.stops.map((stop) => stop.title)).toContain(
      "Cloud 9 boardwalk and surf-watch window",
    );
    expect(result.plan.fallbackStops.length).toBeGreaterThan(0);
    expect(result.plan.skip.join(" ")).toContain("Exposed beach hopping");
    expect(result.caveats.join(" ")).toContain("weather forecast");
    expect(result.plan.sources.map((source) => source.label)).toEqual([
      "curated_local_guide",
      "not_verified",
    ]);
    expect(result.requiredToolChecks.weather).toMatchObject({
      tool: "get_weather_forecast",
      location: "Cloud 9",
      date_range: "today",
    });
    expect(result.requiredToolChecks.places[0]).toMatchObject({
      tool: "search_places",
      query: "covered cafes near Cloud 9 Siargao",
      constraints: { included_type: "cafe", open_now: true, page_size: 5 },
    });
  });

  test("sunset plus dinner keeps a route-aware sequence and requires Places for dinner", () => {
    const result = planLocalItinerary({
      theme: "sunset_plus_dinner",
      duration_hours: 3,
      meal_preference: "seafood",
      needs_open_now: true,
    });

    expect(result.plan.stops[0]?.kind).toBe("beach");
    expect(result.plan.stops[1]).toMatchObject({
      kind: "meal",
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
    });
    expect(result.plan.stops[1]?.title).toContain("seafood");
    expect(result.plan.stops[1]?.caveats.join(" ")).toContain("search_places");
    expect(result.plan.skip).toContain("Far north dinner detours after sunset");
    expect(result.requiredToolChecks.weather?.location).toBe("General Luna");
    expect(result.requiredToolChecks.places[0]).toMatchObject({
      query: "seafood General Luna Siargao",
      constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
    });
  });

  test("sandy beach half-day excludes far north options under a 30-minute constraint", () => {
    const result = planLocalItinerary({
      theme: "sandy_beach_half_day",
      duration_hours: 4,
      max_ride_minutes: 30,
      transport_mode: "tricycle",
    });

    const stopTitles = result.plan.stops.map((stop) => stop.title);
    expect(stopTitles).toContain("Doot Beach");
    expect(stopTitles).toContain("Malinao Beach");
    expect(stopTitles).not.toContain("Pacifico Beach");
    expect(stopTitles).not.toContain("Alegria Beach");
    const excludedPacifico = result.localGuide.excluded.find(
      (candidate) => candidate.name === "Pacifico Beach",
    );
    expect(excludedPacifico?.reason).toContain("outside the 30-minute filter");
    expect(result.plan.skip.join(" ")).toContain("Pacifico Beach and Alegria Beach");
  });

  test("does not label General Luna ride estimates as previous-stop travel times", () => {
    const result = planLocalItinerary({
      theme: "sandy_beach_half_day",
      duration_hours: 4,
      max_ride_minutes: 30,
    });

    expect(result.plan.stops[0]).toMatchObject({
      title: "Doot Beach",
      sequence: 1,
    });
    expect(result.plan.stops[0]?.travelTimeFromPreviousMinutes).toBeUndefined();
    expect(result.plan.stops[1]).toMatchObject({
      title: "Malinao Beach",
      sequence: 2,
    });
    expect(result.plan.stops[1]?.travelTimeFromPreviousMinutes).toBeUndefined();
    expect(result.plan.stops[2]).toMatchObject({
      kind: "meal",
      travelTimeFromPreviousMinutes: 15,
    });
  });

  test("non-surfer half-day avoids surf-only stops", () => {
    const result = planLocalItinerary({
      theme: "non_surfer_half_day",
      constraints: ["not surfing"],
      max_ride_minutes: 30,
    });

    expect(result.plan.title).toBe("Non-Surfer Half-Day");
    expect(result.plan.stops.map((stop) => stop.title)).not.toContain("Cloud 9 beach access");
    expect(result.plan.skip).toContain("Surf-only lessons or reef entries");
    expect(result.plan.stops.map((stop) => stop.kind)).toContain("activity");
  });

  test("preserves user constraints in filters, caveats, skip guidance, and sources", () => {
    const result = planLocalItinerary({
      theme: "food_crawl",
      duration_hours: 3,
      constraints: ["vegetarian", "with kids", "avoid scooters", "quiet only"],
      needs_open_now: true,
    });

    expect(result.constraints.labels).toEqual(
      expect.arrayContaining(["vegetarian", "with kids", "avoid scooters", "quiet"]),
    );
    expect(result.localGuide.filters).toMatchObject({
      transportMode: "walk",
      withKids: true,
    });
    expect(result.plan.stops[0]?.title).toContain("vegetarian-friendly");
    expect(result.plan.stops[0]?.caveats.join(" ")).toContain("User constraints preserved");
    expect(result.plan.stops[0]?.caveats.join(" ")).toContain("Vegetarian fit needs live menu");
    expect(result.plan.stops[0]?.caveats.join(" ")).toContain("No-scooter fit depends");
    expect(result.plan.stops[0]?.caveats.join(" ")).toContain("Quietness and crowd levels");
    expect(result.plan.skip).toEqual(
      expect.arrayContaining([
        "Scooter-only routing or stops that require self-driving",
        "Food stops that cannot be checked for vegetarian-friendly options",
        "Known noisy or crowd-heavy stops when quieter options are available",
      ]),
    );
    expect(result.plan.sources.at(-1)?.notChecked).toEqual(
      expect.arrayContaining([
        "live vegetarian menu fit",
        "live crowd or noise levels",
        "live tricycle, van, or walking-route availability",
        "kid-specific swim safety",
      ]),
    );
    expect(result.caveats.join(" ")).toContain("quiet");
  });

  test("food crawl sequences meal stops and marks live open status as not checked", () => {
    const result = planLocalItinerary({
      theme: "food_crawl",
      duration_hours: 3,
      meal_preference: "local seafood",
      needs_open_now: true,
    });

    expect(result.plan.title).toBe("General Luna Food Crawl");
    expect(result.plan.stops.map((stop) => stop.kind)).toEqual(["meal", "meal", "meal"]);
    expect(result.plan.stops.map((stop) => stop.sequence)).toEqual([1, 2, 3]);
    expect(result.plan.stops[0]?.title).toContain("local seafood");
    expect(result.plan.sources.at(-1)?.notChecked.join(" ")).toContain("live open-now status");
    expect(result.plan.skip).toContain("Venue names without live or fresh-cache Places evidence");
    expect(result.requiredToolChecks.places.map((check) => check.query)).toEqual([
      "local seafood General Luna Siargao",
      "cafes or dessert near General Luna Siargao",
    ]);
  });
});
