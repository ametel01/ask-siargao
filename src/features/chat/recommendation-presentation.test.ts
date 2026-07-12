import { describe, expect, test } from "bun:test";
import { projectRecommendationSet } from "@/features/chat/recommendation-presentation";
import type {
  ItineraryPlanArtifact,
  RecommendationCardArtifact,
} from "@/features/chat/saved-trip-client";

describe("recommendation presentation", () => {
  test("renders one useful option without comparison chrome", () => {
    const presentation = projectRecommendationSet({
      cards: [
        recommendationCard({
          decision: { label: "best_fit", bestAction: "Start here." },
          fitReasons: ["Fits your Cloud 9 breakfast window and scooter-free plan."],
        }),
      ],
    });

    expect(presentation.hasComparison).toBe(false);
    expect(presentation.cards).toEqual([
      expect.objectContaining({
        fitRationale: "Fits your Cloud 9 breakfast window and scooter-free plan.",
        isPrimary: true,
        role: "best",
        roleLabel: "Best fit",
      }),
    ]);
  });

  test("uses explicit roles for one best move and limited alternatives or fallbacks", () => {
    const presentation = projectRecommendationSet({
      cards: [
        recommendationCard({
          id: "place_alt",
          title: "Alt Cafe",
          decision: { label: "good_now", bestAction: "Use if nearby." },
          fitReasons: ["Works if you are already at Cloud 9."],
        }),
        recommendationCard({
          id: "place_best",
          title: "Best Cafe",
          decision: { label: "best_fit", bestAction: "Start here." },
          fitReasons: ["Best fit for a quiet breakfast before surf school."],
        }),
        recommendationCard({
          id: "place_fallback",
          title: "Fallback Cafe",
          decision: { label: "fallback", bestAction: "Use if the first stop is full." },
          fitReasons: ["Useful covered backup during a rain shower."],
        }),
        recommendationCard({
          id: "place_extra",
          title: "Extra Cafe",
          fitReasons: ["Should stay out once the bounded set is full."],
        }),
      ],
    });

    expect(presentation.hasComparison).toBe(true);
    expect(presentation.cards.map(({ card }) => card.id)).toEqual([
      "place_best",
      "place_alt",
      "place_fallback",
    ]);
    expect(presentation.cards.map((card) => [card.role, card.roleLabel, card.isPrimary])).toEqual([
      ["best", "Best fit", true],
      ["alternative", "Alternative", false],
      ["fallback", "Fallback", false],
    ]);
  });

  test("does not promote provider order to best fit without explicit metadata", () => {
    const presentation = projectRecommendationSet({
      cards: [
        recommendationCard({
          id: "place_ranked_first",
          title: "Provider First",
          fitReasons: ["Returned #1 by Google Places.", "Open now according to Google Places."],
        }),
        recommendationCard({
          id: "place_useful",
          title: "Useful Cafe",
          fitReasons: ["Matches your request for a quiet place near General Luna."],
        }),
      ],
    });

    expect(presentation.cards.map(({ card }) => card.id)).toEqual(["place_useful"]);
    expect(presentation.cards[0]).toMatchObject({
      isPrimary: false,
      role: "alternative",
      roleLabel: "Alternative",
    });
    expect(JSON.stringify(presentation)).not.toContain("Returned #1");
  });

  test("collapses cards missing traveler-specific rationale or optional signals", () => {
    const presentation = projectRecommendationSet({
      cards: [
        recommendationCard({
          id: "place_process",
          fitReasons: ["Returned #2 by Google Places.", "Well rated and open now."],
          distanceLabel: undefined,
          mapsUrl: undefined,
          openStatusLabel: undefined,
          subtitle: undefined,
        }),
      ],
    });

    expect(presentation.cards).toEqual([]);
    expect(presentation.hasComparison).toBe(false);
  });

  test("suppresses duplicate card grids when a selected itinerary already carries route stops", () => {
    const presentation = projectRecommendationSet({
      cards: [
        recommendationCard({
          id: "place_stop_1",
          title: "Cloud 9 Boardwalk",
          fitReasons: ["Good first stop before moving indoors."],
        }),
        recommendationCard({
          id: "place_stop_2",
          title: "Covered Cafe",
          fitReasons: ["Useful second stop during rain."],
        }),
      ],
      itineraries: [itineraryPlan()],
    });

    expect(presentation.cards).toEqual([]);
  });
});

function recommendationCard(
  overrides: Partial<RecommendationCardArtifact> = {},
): RecommendationCardArtifact {
  return {
    id: "place_shaka",
    kind: "place",
    title: "Shaka Siargao",
    subtitle: "Cafe - Cloud 9, General Luna",
    mapsUrl: "https://maps.google.com/?cid=shaka",
    distanceLabel: "About 50 m from search center.",
    openStatusLabel: "Open now according to Google Places.",
    fitReasons: ["Fits your quiet breakfast request near Cloud 9."],
    caveats: [],
    sourceLabel: "Google Places - live checked",
    ...overrides,
  };
}

function itineraryPlan(): ItineraryPlanArtifact {
  return {
    id: "itinerary_cloud_9",
    title: "Rainy Cloud 9 Route",
    durationLabel: "2 hours",
    stops: [
      {
        title: "Cloud 9 Boardwalk",
        kind: "activity",
        sequence: 1,
        rationale: "Start outside while the shower is light.",
        caveats: [],
      },
      {
        title: "Covered Cafe",
        kind: "meal",
        sequence: 2,
        rationale: "Move indoors when rain gets heavier.",
        caveats: [],
      },
    ],
    fallbackStops: [],
    skip: [],
    sources: [],
  };
}
