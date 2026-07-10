import { describe, expect, test } from "bun:test";

import { projectTripState, tripContextFacts } from "@/features/chat/trip-state";

describe("trip state projection", () => {
  test("keeps a new visitor empty instead of restoring former demo trip data", () => {
    const state = projectTripState({ localContext: {}, profileStatus: "anonymous" });

    expect(state).toEqual({
      context: { accommodation: "", dateRange: "", travelerType: "", nearbyArea: "Siargao Island" },
      source: "anonymous",
    });
    expect(tripContextFacts(state.context)).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("Near Cloud 9 / Catangnan");
    expect(JSON.stringify(state)).not.toContain("Jun 12 - 22");
    expect(JSON.stringify(state)).not.toContain("Couple");
  });

  test("uses only valid local facts for an anonymous visitor", () => {
    const state = projectTripState({
      localContext: { accommodation: "  Dapa stay ", travelerType: "Family" },
      profileStatus: "anonymous",
    });

    expect(state).toEqual({
      context: {
        accommodation: "Dapa stay",
        dateRange: "",
        travelerType: "Family",
        nearbyArea: "Siargao Island",
      },
      source: "anonymous",
    });
  });

  test("holds an empty presentation while auth resolves or fails", () => {
    expect(
      projectTripState({
        localContext: { accommodation: "Browser-only stay" },
        profileStatus: "loading",
      }),
    ).toEqual({
      context: { accommodation: "", dateRange: "", travelerType: "", nearbyArea: "Siargao Island" },
      source: "loading",
    });
    expect(
      projectTripState({
        localContext: { accommodation: "Browser-only stay" },
        profileStatus: "error",
      }),
    ).toEqual({
      context: { accommodation: "", dateRange: "", travelerType: "", nearbyArea: "Siargao Island" },
      source: "error",
    });
  });

  test("uses the authenticated profile without merging local context", () => {
    const state = projectTripState({
      localContext: { accommodation: "Another visitor's local stay", nearbyArea: "Cloud 9" },
      profile: { profile: { tripContext: { currentArea: "Dapa" } } },
      profileStatus: "authenticated",
    });

    expect(state).toEqual({
      context: {
        accommodation: "",
        dateRange: "",
        travelerType: "",
        nearbyArea: "Dapa",
      },
      source: "authenticated",
    });
  });
});
