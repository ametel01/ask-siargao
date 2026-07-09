import { describe, expect, test } from "bun:test";

import {
  type DecisionStripSummary,
  projectDecisionStrip,
} from "@/features/chat/decision-strip-presentation";

const checkedWeatherSource = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  confidence: "medium" as const,
  checked: ["forecast for Cloud 9"],
  notChecked: ["surf reports"],
};

const completeSummary: DecisionStripSummary = {
  id: "decision:cloud-9",
  bestAction: "Keep the swim flexible.",
  basis: "Weather is usable, but surf reports are not checked.",
  area: "Cloud 9",
  timing: "Today",
  fallback: "Use a nearby covered stop if conditions worsen.",
  avoid: "Do not treat this as a beach safety clearance.",
  sources: [checkedWeatherSource],
};

describe("decision strip presentation", () => {
  test("projects one complete selected summary with its checked scope", () => {
    expect(projectDecisionStrip([completeSummary])).toEqual({
      summary: completeSummary,
      context: [
        { label: "Where", value: "Cloud 9" },
        { label: "When", value: "Today" },
      ],
      guidance: [
        { label: "Backup", value: "Use a nearby covered stop if conditions worsen." },
        { label: "Avoid", value: "Do not treat this as a beach safety clearance." },
      ],
      sourceStatus: {
        label: "Checked",
        value: "Open-Meteo weather API: forecast for Cloud 9",
      },
    });
  });

  test("collapses missing optional fields and empty source metadata", () => {
    expect(
      projectDecisionStrip([
        {
          id: "decision:partial",
          bestAction: "Choose a covered stop.",
          basis: "Rain is possible.",
          sources: [],
        },
      ]),
    ).toMatchObject({
      context: [],
      guidance: [],
    });
    expect(
      projectDecisionStrip([{ ...completeSummary, sources: [] }])?.sourceStatus,
    ).toBeUndefined();
  });

  test("does not promote unchecked or unavailable sources to checked", () => {
    expect(
      projectDecisionStrip([
        {
          ...completeSummary,
          sources: [
            {
              label: "not_verified",
              sourceName: "Saved itinerary",
              checked: [],
              notChecked: ["current conditions"],
            },
          ],
        },
      ])?.sourceStatus,
    ).toEqual({ label: "Not verified", value: "Saved itinerary" });
    expect(
      projectDecisionStrip([
        {
          ...completeSummary,
          sources: [
            {
              label: "provider_unavailable",
              sourceName: "Open-Meteo weather API",
              checked: [],
              notChecked: ["forecast"],
            },
          ],
        },
      ])?.sourceStatus,
    ).toEqual({ label: "Source unavailable", value: "Open-Meteo weather API" });
  });

  test("uses only the first selected summary and has no presentation for absent summaries", () => {
    const secondarySummary = {
      ...completeSummary,
      id: "decision:secondary",
      bestAction: "Do not render as a second top-level strip.",
    };

    expect(projectDecisionStrip([completeSummary, secondarySummary])?.summary).toBe(
      completeSummary,
    );
    expect(projectDecisionStrip([])).toBeUndefined();
    expect(projectDecisionStrip(undefined)).toBeUndefined();
  });
});
