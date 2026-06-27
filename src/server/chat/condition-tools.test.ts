import { describe, expect, test } from "bun:test";

import {
  buildConditionJudgment,
  type ConditionJudgment,
  conditionActivities,
  conditionJudgmentRequestSchema,
  conditionJudgmentSchema,
  conditionRecommendations,
  conditionRiskLevels,
  conditionSignalKinds,
  conditionSignalStatuses,
  precipitationProbabilityRiskLevel,
  rainSumRiskLevel,
  windGustRiskLevel,
  windSpeedRiskLevel,
} from "@/server/chat/condition-tools";
import { searchSiargaoLocalGuide } from "@/server/local/siargao-beaches";
import type { WeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

type ConditionSourceSummary = ConditionJudgment["sources"][number];

describe("condition judgment contracts", () => {
  test("captures the supported condition judgment vocabulary", () => {
    expect(conditionSignalKinds).toEqual(["weather", "tide", "surf", "road", "manual_caveat"]);
    expect(conditionSignalStatuses).toEqual(["checked", "not_checked", "unavailable"]);
    expect(conditionRiskLevels).toEqual(["low", "medium", "high"]);
    expect(conditionActivities).toEqual([
      "swimming",
      "surfing",
      "scooter",
      "rain_plan",
      "sunset",
      "boat_trip",
    ]);
    expect(conditionRecommendations).toEqual([
      "good",
      "flexible",
      "avoid",
      "needs_local_confirmation",
    ]);
  });

  test("requires a complete judgment, not raw weather alone", () => {
    const parsed = conditionJudgmentSchema.parse(swimmingJudgmentFixture);

    expect(parsed.recommendation).toBe("flexible");
    expect(parsed.reasons).toHaveLength(2);
    expect(parsed.alternatives).toEqual(["Use Malinao as the close fallback if rain picks up."]);
    expect(parsed.signals.map((signal) => signal.kind)).toEqual([
      "weather",
      "tide",
      "surf",
      "manual_caveat",
    ]);

    expect(() =>
      conditionJudgmentSchema.parse({
        activity: "swimming",
        locationName: "General Luna",
        weather: { rainSum: 0.4, windGust: 18 },
      }),
    ).toThrow();
  });

  test("keeps tide and surf explicitly not checked in the first implementation slice", () => {
    const parsed = conditionJudgmentSchema.parse(swimmingJudgmentFixture);
    const tideSignal = parsed.signals.find((signal) => signal.kind === "tide");
    const surfSignal = parsed.signals.find((signal) => signal.kind === "surf");

    expect(tideSignal).toEqual(
      expect.objectContaining({
        status: "not_checked",
        source: expect.objectContaining({ label: "not_verified" }),
      }),
    );
    expect(surfSignal).toEqual(
      expect.objectContaining({
        status: "not_checked",
        source: expect.objectContaining({ label: "not_verified" }),
      }),
    );
    expect(parsed.sources.map((source) => source.label)).toEqual([
      "weather_checked",
      "not_verified",
      "curated_local_guide",
    ]);
  });

  test("models nullable optional request fields for future strict Responses schemas", () => {
    expect(
      conditionJudgmentRequestSchema.parse({
        activity: "sunset",
        location: "Cloud 9",
        date_range: "today",
        beach_name: null,
        include_local_caveats: null,
        constraints: null,
      }),
    ).toEqual({
      activity: "sunset",
      location: "Cloud 9",
      date_range: "today",
      beach_name: null,
      include_local_caveats: null,
      constraints: null,
    });
  });

  test("classifies Open-Meteo threshold helpers", () => {
    expect(precipitationProbabilityRiskLevel(80)).toBe("high");
    expect(precipitationProbabilityRiskLevel(50)).toBe("medium");
    expect(rainSumRiskLevel(3)).toBe("low");
    expect(windSpeedRiskLevel(30)).toBe("medium");
    expect(windGustRiskLevel(60)).toBe("high");
  });

  test("builds a low-risk scooter judgment from checked weather and unchecked roads", () => {
    const judgment = buildConditionJudgment({
      request: requestFixture({ activity: "scooter", constraints: ["avoid flooded roads"] }),
      weatherSnapshot: weatherSnapshotFixture({ level: "low", windGust: 18 }),
    });

    expect(judgment.recommendation).toBe("good");
    expect(judgment.signals.map((signal) => [signal.kind, signal.status])).toEqual([
      ["weather", "checked"],
      ["road", "not_checked"],
    ]);
    expect(judgment.sources.map((source) => source.label)).toEqual([
      "weather_checked",
      "not_verified",
    ]);
    expect(judgment.caveats).toContain("Preserved constraints: avoid flooded roads.");
  });

  test("keeps swimming flexible when weather is checked but tide and surf are not", () => {
    const judgment = buildConditionJudgment({
      request: requestFixture({
        activity: "swimming",
        beach_name: "Malinao Beach",
        include_local_caveats: true,
      }),
      weatherSnapshot: weatherSnapshotFixture({ level: "low", rainSum: 0.2, windGust: 14 }),
      localGuideResult: searchSiargaoLocalGuide({
        query: "Malinao swimming beach",
        filters: { swimming: true, beachSurface: "sand" },
      }),
    });

    expect(judgment.recommendation).toBe("flexible");
    expect(judgment.locationName).toBe("Malinao Beach");
    expect(judgment.signals.map((signal) => signal.kind)).toEqual([
      "weather",
      "tide",
      "surf",
      "manual_caveat",
    ]);
    expect(judgment.caveats).toContain(
      "Tide, surf, swell, currents, and lifeguard status were not checked.",
    );
  });

  test("avoids exposed scooter and boat plans when checked weather risk is high", () => {
    const highWeather = weatherSnapshotFixture({
      level: "high",
      precipitationProbability: 88,
      rainSum: 24,
      windGust: 62,
    });

    expect(
      buildConditionJudgment({
        request: requestFixture({ activity: "scooter" }),
        weatherSnapshot: highWeather,
      }).recommendation,
    ).toBe("avoid");
    expect(
      buildConditionJudgment({
        request: requestFixture({ activity: "boat_trip", location: "Del Carmen" }),
        weatherSnapshot: highWeather,
      }).recommendation,
    ).toBe("avoid");
  });

  test("handles sunset as weather-sensitive without inventing tide or surf checks", () => {
    const judgment = buildConditionJudgment({
      request: requestFixture({ activity: "sunset", location: "Cloud 9" }),
      weatherSnapshot: weatherSnapshotFixture({
        condition: "Cloudy breaks",
        level: "medium",
        precipitationProbability: 48,
      }),
    });

    expect(judgment.recommendation).toBe("flexible");
    expect(judgment.signals.map((signal) => signal.kind)).toEqual(["weather"]);
    expect(judgment.reasons[0]).toContain("Cloudy breaks");
    expect(judgment.caveats).not.toContain(
      "Tide, surf, swell, currents, and lifeguard status were not checked.",
    );
  });

  test("uses conservative local confirmation when weather is unavailable", () => {
    const judgment = buildConditionJudgment({
      request: requestFixture({ activity: "swimming" }),
      weatherSnapshot: fallbackWeatherSnapshot,
    });

    expect(judgment.recommendation).toBe("needs_local_confirmation");
    expect(judgment.sources[0]).toEqual(
      expect.objectContaining({
        label: "provider_unavailable",
        sourceName: "Open-Meteo weather API",
      }),
    );
    expect(judgment.signals[0]).toEqual(
      expect.objectContaining({
        kind: "weather",
        status: "unavailable",
      }),
    );
  });
});

const weatherSource: ConditionSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-27T00:00:00.000Z",
  confidence: "medium",
  checked: ["General Luna forecast"],
  notChecked: ["tide", "surf", "road flooding"],
};

const uncheckedMarineSource: ConditionSourceSummary = {
  label: "not_verified",
  sourceName: "Condition judgment unchecked marine signals",
  confidence: "medium",
  checked: [],
  notChecked: ["tide", "surf", "currents", "lifeguard or swimming safety"],
};

const localGuideSource: ConditionSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach-surface notes", "local caveats"],
  notChecked: ["live beach access changes", "lifeguard or swimming safety"],
};

const swimmingJudgmentFixture = {
  activity: "swimming",
  locationName: "General Luna",
  dateLabel: "today",
  recommendation: "flexible",
  level: "medium",
  reasons: [
    "Open-Meteo weather is usable but not a marine-safety check.",
    "Curated beach notes say sandy entries can vary with tide and exact access.",
  ],
  alternatives: ["Use Malinao as the close fallback if rain picks up."],
  caveats: ["Confirm tide, surf, currents, and lifeguard conditions locally before swimming."],
  signals: [
    {
      kind: "weather",
      status: "checked",
      level: "medium",
      label: "Open-Meteo forecast",
      summary: "Light rain risk and moderate gusts for General Luna.",
      checked: ["precipitation probability", "rain amount", "wind gust"],
      notChecked: ["tide", "surf", "currents"],
      evidenceIds: ["ev_open_meteo_general_luna_today"],
      source: weatherSource,
    },
    {
      kind: "tide",
      status: "not_checked",
      level: "medium",
      label: "Tide",
      summary: "No tide provider is integrated in this implementation slice.",
      checked: [],
      notChecked: ["tide height", "tide timing"],
      evidenceIds: [],
      source: uncheckedMarineSource,
    },
    {
      kind: "surf",
      status: "not_checked",
      level: "medium",
      label: "Surf and current",
      summary: "No surf, swell, or current provider is integrated in this implementation slice.",
      checked: [],
      notChecked: ["surf height", "swell", "currents"],
      evidenceIds: [],
      source: uncheckedMarineSource,
    },
    {
      kind: "manual_caveat",
      status: "checked",
      level: "medium",
      label: "Curated local caveat",
      summary: "Sandy beach comfort depends on exact access and conditions.",
      checked: ["beach-surface notes", "local caveats"],
      notChecked: ["live access changes"],
      evidenceIds: ["curated_beach_malinao"],
      source: localGuideSource,
    },
  ],
  sources: [weatherSource, uncheckedMarineSource, localGuideSource],
} satisfies ConditionJudgment;

function requestFixture(
  overrides: Partial<
    ConditionJudgment["activity"] extends infer _Activity
      ? {
          activity: ConditionJudgment["activity"];
          location: "Siargao Island" | "Cloud 9" | "General Luna" | "Del Carmen";
          date_range: "today" | "next_7_days";
          beach_name: string | null;
          include_local_caveats: boolean | null;
          constraints: string[] | null;
        }
      : never
  > = {},
) {
  return {
    activity: "swimming",
    location: "General Luna",
    date_range: "today",
    beach_name: null,
    include_local_caveats: null,
    constraints: null,
    ...overrides,
  } as const;
}

function weatherSnapshotFixture({
  condition = "Cloudy breaks",
  level = "low",
  precipitationProbability = 20,
  precipitationSum = 0.4,
  rainSum = 0.2,
  windGust = 18,
  windSpeed = 12,
}: Partial<WeatherSnapshot["today"]> = {}): WeatherSnapshot {
  return {
    ...fallbackWeatherSnapshot,
    status: "live",
    locationName: "Siargao forecast near General Luna",
    fetchedAt: "2026-06-27T00:00:00.000Z",
    expiresAt: "2026-06-28T00:00:00.000Z",
    freshness: "fresh",
    confidence: "medium",
    citationUrl: "https://api.open-meteo.com/v1/forecast",
    evidenceIds: ["ev_open_meteo_test"],
    summary: "Open-Meteo fixture summary.",
    today: {
      ...fallbackWeatherSnapshot.today,
      date: "2026-06-27",
      condition,
      precipitationProbability,
      precipitationSum,
      rainSum,
      windSpeed,
      windGust,
      level,
      evidenceId: "ev_open_meteo_test",
    },
  };
}
