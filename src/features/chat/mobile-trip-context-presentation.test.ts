import { describe, expect, test } from "bun:test";

import {
  authenticatedTripContextPatch,
  projectMobileTripContextSummary,
} from "@/features/chat/mobile-trip-context-presentation";

const emptyContext = {
  accommodation: "",
  dateRange: "",
  travelerType: "",
  nearbyArea: "Siargao Island" as const,
};

describe("mobile trip context presentation", () => {
  test("uses an honest add action for an anonymous empty trip", () => {
    expect(projectMobileTripContextSummary({ context: emptyContext, source: "anonymous" })).toEqual(
      { actionLabel: "Add trip details", facts: [], state: "empty" },
    );
  });

  test.each([
    {
      name: "accommodation only",
      context: { ...emptyContext, accommodation: "Pilar homestay" },
      facts: [],
    },
    {
      name: "area only",
      context: { ...emptyContext, nearbyArea: "Dapa" as const },
      facts: [{ label: "Area", value: "Dapa" }],
    },
    {
      name: "dates only",
      context: { ...emptyContext, dateRange: "Aug 1 - 6" },
      facts: [{ label: "Dates", value: "Aug 1 - 6" }],
    },
    {
      name: "traveler type only",
      context: { ...emptyContext, travelerType: "Two friends" },
      facts: [],
    },
  ])("renders only the known fact for $name", ({ context, facts }) => {
    expect(projectMobileTripContextSummary({ context, source: "authenticated" })).toMatchObject({
      actionLabel: "View trip details",
      facts,
      state: "partial",
    });
  });

  test("renders only actual area, date, and authoritative pass facts for a populated trip", () => {
    expect(
      projectMobileTripContextSummary({
        context: {
          accommodation: "Pilar homestay",
          dateRange: "Aug 1 - 6",
          travelerType: "Two friends",
          nearbyArea: "Dapa",
        },
        pass: { status: "available", summary: "2 planning passes available" },
        source: "authenticated",
      }),
    ).toEqual({
      actionLabel: "View trip details",
      facts: [
        { label: "Area", value: "Dapa" },
        { label: "Dates", value: "Aug 1 - 6" },
        { label: "Trip Pass", value: "2 planning passes available" },
      ],
      state: "populated",
    });
  });

  test("does not turn island fallback or unavailable pass state into a fact", () => {
    for (const pass of [{ status: "not_connected" }, { status: "unavailable" }] as const) {
      const presentation = projectMobileTripContextSummary({
        context: { ...emptyContext, dateRange: "Aug 1 - 6" },
        pass,
        source: "authenticated",
      });

      expect(presentation.facts).toEqual([{ label: "Dates", value: "Aug 1 - 6" }]);
      expect(JSON.stringify(presentation)).not.toContain("Cloud 9");
      expect(JSON.stringify(presentation)).not.toContain("Jun 12 - 22");
      expect(JSON.stringify(presentation)).not.toContain("Couple");
    }
  });

  test("keeps pending and failed source states distinct from empty", () => {
    expect(
      projectMobileTripContextSummary({
        context: { ...emptyContext, nearbyArea: "Cloud 9" },
        source: "loading",
      }),
    ).toEqual({ actionLabel: "View trip details", facts: [], state: "loading" });
    expect(
      projectMobileTripContextSummary({
        context: { ...emptyContext, nearbyArea: "Cloud 9" },
        source: "error",
      }),
    ).toEqual({ actionLabel: "View trip details", facts: [], state: "unavailable" });
  });

  test("preserves unrelated owner-scoped context while replacing bounded editable fields", () => {
    expect(
      authenticatedTripContextPatch(
        {
          profile: {
            tripContext: {
              notes: "Late arrival",
              transportMode: "scooter",
              geolocation: { latitude: 9.81, longitude: 126.16 },
            },
          },
        },
        {
          accommodation: "Pilar homestay",
          dateRange: "Aug 1 - 6",
          travelerType: "Two friends",
          nearbyArea: "Dapa",
        },
      ),
    ).toEqual({
      notes: "Late arrival",
      transportMode: "scooter",
      accommodation: "Pilar homestay",
      dateRange: "Aug 1 - 6",
      travelerType: "Two friends",
      currentArea: "Dapa",
    });
  });

  test("uses nulls to clear bounded authenticated fields without inventing replacements", () => {
    expect(authenticatedTripContextPatch(undefined, emptyContext)).toEqual({
      accommodation: null,
      dateRange: null,
      travelerType: null,
      currentArea: null,
    });
  });
});
