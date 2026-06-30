import { describe, expect, test } from "bun:test";

import { buildPlaceSearchPlan } from "@/server/chat/place-search-plan";

describe("buildPlaceSearchPlan", () => {
  test("builds narrow activity-place queries without an unsupported included type", () => {
    expect(
      buildPlaceSearchPlan({
        category: "activity_place",
        location: "General Luna",
        areaScope: "nearby",
        latestUserTurn: "beachfront places near General Luna",
        constraints: ["beachfront"],
      }),
    ).toEqual({
      query: "beachfront places near General Luna Siargao",
      searchTerm: "beachfront places",
    });

    expect(
      buildPlaceSearchPlan({
        category: "activity_place",
        location: "General Luna",
        areaScope: "in_area",
        latestUserTurn: "covered indoor spots in General Luna",
        constraints: ["covered_seating"],
      }),
    ).toEqual({
      query: "covered places in General Luna Siargao",
      searchTerm: "covered places",
    });
  });

  test("uses supported Google Places included types for proven services only", () => {
    expect(
      buildPlaceSearchPlan({
        category: "service",
        location: "Dapa",
        areaScope: "nearby",
        latestUserTurn: "nearest ATM to Dapa ferry terminal",
      }),
    ).toEqual({
      query: "atm near Dapa Siargao",
      searchTerm: "atm",
      includedType: "atm",
    });

    expect(
      buildPlaceSearchPlan({
        category: "service",
        location: "General Luna",
        areaScope: "nearby",
        latestUserTurn: "clinic near General Luna",
      }),
    ).toEqual({
      query: "clinic near General Luna Siargao",
      searchTerm: "clinic",
    });

    expect(
      buildPlaceSearchPlan({
        category: "service",
        location: "General Luna",
        areaScope: "nearby",
        latestUserTurn: "scooter rental near General Luna",
      }),
    ).toEqual({
      query: "scooter rental near General Luna Siargao",
      searchTerm: "scooter rental",
    });
  });
});
