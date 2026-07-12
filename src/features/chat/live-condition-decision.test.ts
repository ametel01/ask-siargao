import { describe, expect, test } from "bun:test";

import {
  conditionDecisionSummaryFields,
  projectSurfConditionDecision,
  projectWeatherConditionDecision,
  type SurfConditionSnapshot,
  type WeatherConditionSnapshot,
} from "@/features/chat/live-condition-decision";
import type { DecisionSummary } from "@/server/chat/agent-runtime";

const weatherSnapshot = (
  overrides: Partial<WeatherConditionSnapshot> = {},
): WeatherConditionSnapshot => ({
  status: "live",
  locationName: "Cloud 9",
  fetchedAt: "2026-07-10T01:00:00.000Z",
  freshness: "fresh",
  today: {
    condition: "Cloudy",
    precipitationProbability: 20,
    rainSum: 1,
    precipitationSum: 1,
    windGust: 18,
  },
  ...overrides,
});

const surfSnapshot = (overrides: Partial<SurfConditionSnapshot> = {}): SurfConditionSnapshot => ({
  status: "live",
  locationName: "Cloud 9",
  fetchedAt: "2026-07-10T01:00:00.000Z",
  level: "low",
  metrics: {
    waves: "0.7m swell / 10s",
    tide: "High 4:55 AM 1.7m",
    wind: "10km/h",
  },
  weather: {
    status: "live",
    freshness: "fresh",
    condition: "Cloudy",
    precipitationProbability: 20,
    rainSum: 1,
    windGust: 18,
  },
  tide: {
    status: "live",
    stationName: "Dapa tide station",
    bestWindow: "5:00 AM-8:00 AM: near high tide",
  },
  caveats: [],
  ...overrides,
});

describe("live condition decision", () => {
  test("keeps loading weather and surf separate from unavailable decisions", () => {
    const weather = projectWeatherConditionDecision({
      locationName: "Cloud 9",
      snapshot: undefined,
      isLoading: true,
      isRefreshing: true,
      hasError: false,
    });
    const surf = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: undefined,
      isLoading: true,
      isRefreshing: true,
      hasError: false,
    });

    expect(weather).toMatchObject({ state: "loading", action: "Checking current conditions." });
    expect(surf).toMatchObject({ state: "loading", action: "Checking current conditions." });
    expect(weather.notChecked).toEqual([]);
    expect(surf.notChecked).toEqual([]);
  });

  test.each([
    {
      name: "fresh low weather keeps the outdoor plan flexible",
      snapshot: weatherSnapshot(),
      action: "Keep the outdoor plan flexible.",
    },
    {
      name: "fresh medium weather chooses cover",
      snapshot: weatherSnapshot({
        today: {
          condition: "Rain",
          precipitationProbability: 50,
          rainSum: 7,
          precipitationSum: 7,
          windGust: 38,
        },
      }),
      action: "Choose cover and keep the plan flexible.",
    },
    {
      name: "fresh high weather avoids an exposed plan",
      snapshot: weatherSnapshot({
        today: {
          condition: "Rain",
          precipitationProbability: 80,
          rainSum: 20,
          precipitationSum: 20,
          windGust: 60,
        },
      }),
      action: "Avoid an exposed plan; choose cover.",
    },
  ])("$name", ({ snapshot, action }) => {
    const decision = projectWeatherConditionDecision({
      locationName: "Cloud 9",
      snapshot,
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({ state: "live", action, isPrior: false });
    expect(decision.supportingMetrics).toEqual([
      expect.objectContaining({ label: "Rain chance" }),
      expect.objectContaining({ label: "Rain" }),
      expect.objectContaining({ label: "Wind gust" }),
    ]);
    expect(decision.timing).toBeUndefined();
  });

  test("keeps stale retained weather distinct from a fresh decision during revalidation", () => {
    const decision = projectWeatherConditionDecision({
      locationName: "Cloud 9",
      snapshot: weatherSnapshot({ freshness: "stale" }),
      isLoading: false,
      isRefreshing: true,
      hasError: false,
    });

    expect(decision).toMatchObject({
      state: "stale",
      action: "Keep the outdoor plan flexible.",
      isPrior: true,
    });
    expect(decision.basis).toContain("prior data");
    expect(decision.checked).toEqual(["Prior Open-Meteo daily forecast signals"]);
    expect(decision.evidenceStatus).toBe("Forecast freshness: stale");
    expect(decision.sourceTime).toBe("2026-07-10T01:00:00.000Z");
  });

  test("classifies a failed refresh with retained weather as prior rather than unavailable", () => {
    const decision = projectWeatherConditionDecision({
      locationName: "Cloud 9",
      snapshot: weatherSnapshot(),
      isLoading: false,
      isRefreshing: false,
      hasError: true,
    });

    expect(decision).toMatchObject({ state: "stale", isPrior: true });
    expect(decision.basis).toContain("latest refresh failed");
    expect(decision.evidenceStatus).toBe("Forecast freshness: stale");
  });

  test("does not treat unknown weather freshness as a checked current forecast", () => {
    const decision = projectWeatherConditionDecision({
      locationName: "Cloud 9",
      snapshot: weatherSnapshot({ freshness: "unknown" }),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({ state: "not-verified", isPrior: false });
    expect(decision.evidenceStatus).toBe("Forecast freshness: unknown");
    expect(decision.action).not.toContain("Avoid");
  });

  test("does not turn a fallback or request error into a weather decision", () => {
    for (const request of [
      {
        snapshot: weatherSnapshot({ status: "fallback", freshness: "unknown" }),
        isLoading: false,
        isRefreshing: false,
        hasError: false,
      },
      { snapshot: undefined, isLoading: false, isRefreshing: false, hasError: true },
    ]) {
      const decision = projectWeatherConditionDecision({ locationName: "Cloud 9", ...request });

      expect(decision.state).toBe("unavailable");
      expect(decision.action).toContain("Conditions unavailable");
      expect(decision.supportingMetrics.map((metric) => metric.value)).not.toContain("0");
    }
  });

  test("keeps fully unavailable surf signals unavailable instead of inventing favorable defaults", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot({
        status: "unavailable",
        metrics: { waves: "Unavailable", tide: "Unavailable", wind: "Unavailable" },
        weather: {
          status: "unavailable",
          freshness: "unknown",
          condition: "Unavailable",
          precipitationProbability: null,
          rainSum: null,
          windGust: null,
        },
        tide: { status: "unavailable", stationName: "Dapa tide station", bestWindow: null },
      }),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({
      state: "unavailable",
      action: "Conditions unavailable; keep surf plans flexible.",
    });
    expect(decision.supportingMetrics.map((metric) => metric.value)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
    expect(decision.checked).toEqual([]);
    expect(decision.notChecked.join(" ")).toContain("Exact-break conditions");
  });

  test("uses a Dapa tide window as a planning cue without presenting it as an exact-break reading", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot(),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({
      state: "live",
      action: "Use the Dapa tide window as a planning cue, then confirm locally.",
      timing: "5:00 AM-8:00 AM: near high tide",
    });
    expect(decision.basis).toContain("nearby station proxy");
    expect(decision.notChecked.join(" ")).toContain("Exact-break conditions");
    expect(decision.notChecked.join(" ")).toContain("safety status");
  });

  test("keeps a complete surf snapshot without a Tide-Forecast window live but non-timed", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot({
        tide: { status: "live", stationName: "Dapa tide station", bestWindow: null },
      }),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({
      state: "live",
      action: "Keep surf plans flexible and confirm locally.",
      evidenceStatus: "Weather freshness: fresh; Dapa tide freshness was not supplied.",
    });
    expect(decision.timing).toBeUndefined();
  });

  test("does not treat unknown weather freshness as a checked current surf view", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot({
        weather: {
          ...surfSnapshot().weather,
          freshness: "unknown",
        },
      }),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({ state: "not-verified", isPrior: false });
    expect(decision.evidenceStatus).toContain("Weather freshness: unknown");
    expect(decision.action).not.toContain("Use the Dapa tide window");
  });

  test.each([
    {
      name: "weather-only partial evidence",
      snapshot: surfSnapshot({
        status: "partial",
        metrics: { waves: "Unavailable", tide: "Unavailable", wind: "gust 18km/h" },
        tide: { status: "unavailable", stationName: "Dapa tide station", bestWindow: null },
      }),
      missing: ["tide", "swell"],
    },
    {
      name: "tide-only partial evidence",
      snapshot: surfSnapshot({
        status: "partial",
        metrics: { waves: "0.7m swell / 10s", tide: "High 4:55 AM 1.7m", wind: "Unavailable" },
        weather: {
          status: "unavailable",
          freshness: "unknown",
          condition: "Unavailable",
          precipitationProbability: null,
          rainSum: null,
          windGust: null,
        },
      }),
      missing: ["weather", "wind"],
    },
  ])("keeps $name bounded", ({ snapshot, missing }) => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot,
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision.state).toBe("partial");
    for (const signal of missing) {
      expect(decision.basis).toContain(signal);
    }
    expect(decision.action).not.toContain("best");
    expect(decision.notChecked.join(" ")).toContain("local operator confirmation");
  });

  test("makes a stale weather component stale surf guidance instead of a live claim", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot({
        weather: {
          ...surfSnapshot().weather,
          freshness: "stale",
        },
      }),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    expect(decision).toMatchObject({ state: "stale", isPrior: true });
    expect(decision.action).not.toContain("Use the Dapa tide window");
  });

  test("classifies a failed surf refresh with retained data as prior", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot(),
      isLoading: false,
      isRefreshing: false,
      hasError: true,
    });

    expect(decision).toMatchObject({ state: "stale", isPrior: true });
    expect(decision.basis).toContain("latest refresh failed");
    expect(decision.action).not.toContain("Use the Dapa tide window");
  });

  test("never derives road, official-warning, or safety claims from weather or tide metrics", () => {
    const decisions = [
      projectWeatherConditionDecision({
        locationName: "Cloud 9",
        snapshot: weatherSnapshot(),
        isLoading: false,
        isRefreshing: false,
        hasError: false,
      }),
      projectSurfConditionDecision({
        locationName: "Cloud 9",
        snapshot: surfSnapshot(),
        isLoading: false,
        isRefreshing: false,
        hasError: false,
      }),
    ];
    const rendered = decisions
      .flatMap((decision) => [
        decision.action,
        decision.basis,
        decision.fallback,
        ...decision.checked,
      ])
      .join(" ")
      .toLowerCase();

    for (const forbiddenClaim of ["road is", "safe", "official warning", "operator confirmed"]) {
      expect(rendered).not.toContain(forbiddenClaim);
    }
    expect(decisions.flatMap((decision) => decision.notChecked).join(" ")).toContain("Road");
    expect(decisions.flatMap((decision) => decision.notChecked).join(" ")).toContain("safety");
  });

  test("exports fields equivalent to a ConditionJudgment DecisionSummary fixture", () => {
    const decision = projectSurfConditionDecision({
      locationName: "Cloud 9",
      snapshot: surfSnapshot(),
      isLoading: false,
      isRefreshing: false,
      hasError: false,
    });

    const fixture = {
      id: "condition_decision:surfing:cloud-9:today",
      bestAction: "Keep surf plans flexible and confirm locally.",
      basis: "Weather and Dapa tide signals are available; confirm at the break.",
      fallback: "Keep an on-land plan ready and confirm conditions before paddling out.",
      timing: "Today",
      area: "Cloud 9",
      sources: [],
    } satisfies DecisionSummary;
    const conditionFixtureDecision = {
      ...decision,
      action: fixture.bestAction,
      basis: fixture.basis,
      fallback: fixture.fallback,
      timing: fixture.timing,
    };

    expect(conditionDecisionSummaryFields(conditionFixtureDecision)).toEqual({
      bestAction: fixture.bestAction,
      basis: fixture.basis,
      fallback: fixture.fallback,
      timing: fixture.timing,
    });
  });
});
