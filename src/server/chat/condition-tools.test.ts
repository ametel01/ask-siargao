import { describe, expect, test } from "bun:test";

import {
  type ConditionJudgment,
  conditionActivities,
  conditionJudgmentRequestSchema,
  conditionJudgmentSchema,
  conditionRecommendations,
  conditionRiskLevels,
  conditionSignalKinds,
  conditionSignalStatuses,
} from "@/server/chat/condition-tools";

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
