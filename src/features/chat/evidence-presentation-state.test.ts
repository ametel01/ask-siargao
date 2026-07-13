import { describe, expect, test } from "bun:test";

import {
  type EvidencePresentationState,
  evidenceStateCopy,
  projectCapabilityEvidencePresentation,
  projectConditionEvidencePresentation,
  projectSourceEvidencePresentation,
  type SourceEvidenceInput,
  sourceEvidenceDetailLines,
  sourceEvidenceReceiptItems,
  sourceEvidenceReceiptSummaryText,
  sourceEvidenceSummaryText,
} from "@/features/chat/evidence-presentation-state";
import type { LiveConditionDecision } from "@/features/chat/live-condition-decision";

describe("evidence presentation state", () => {
  test("defines the six traveler-facing states", () => {
    const states: EvidencePresentationState[] = [
      "capability",
      "checking",
      "checked",
      "stale",
      "unavailable",
      "not-verified",
    ];

    expect(states.map(evidenceStateCopy)).toEqual([
      expect.objectContaining({ label: "Can check when asked" }),
      expect.objectContaining({ label: "Checking now" }),
      expect.objectContaining({ label: "Checked" }),
      expect.objectContaining({ label: "Prior evidence" }),
      expect.objectContaining({ label: "Unavailable" }),
      expect.objectContaining({ label: "Not verified" }),
    ]);
  });

  test("presents landing rows as capability, not pre-request success", () => {
    const presentation = projectCapabilityEvidencePresentation("Can check places when asked");

    expect(presentation).toMatchObject({
      state: "capability",
      label: "Can check when asked",
      summary: "Can check places when asked",
      isPositiveClaim: false,
    });
    expect(presentation.checkedScope).toEqual([]);
  });

  test.each([
    ["loading", "checking", "Checking now"],
    ["live", "checked", "Checked"],
    ["partial", "checked", "Partly checked signals"],
    ["stale", "stale", "Prior evidence"],
    ["unavailable", "unavailable", "Unavailable"],
    ["not-verified", "not-verified", "Not verified"],
  ] as const)("maps %s condition decisions to %s", (decisionState, evidenceState, label) => {
    const presentation = projectConditionEvidencePresentation(
      conditionDecision({ state: decisionState }),
    );

    expect(presentation).toMatchObject({ state: evidenceState, label });
    expect(presentation.isPositiveClaim).toBe(evidenceState === "checked");
  });

  test("keeps retained stale condition data distinct from checked current evidence", () => {
    const presentation = projectConditionEvidencePresentation(
      conditionDecision({
        state: "stale",
        evidenceStatus: "Forecast freshness: stale",
        checked: ["Prior Open-Meteo daily forecast signals"],
      }),
    );

    expect(presentation).toMatchObject({
      state: "stale",
      label: "Prior evidence",
      summary: "Forecast freshness: stale",
      isPositiveClaim: false,
    });
    expect(presentation.checkedScope).toEqual([]);
  });

  test.each([
    [source({ label: "live_checked", sourceName: "Google Places API" }), "Places checked"],
    [source({ label: "fresh_cache", sourceName: "Google Places API" }), "Recently checked"],
    [source({ label: "weather_checked", sourceName: "Open-Meteo weather API" }), "Weather checked"],
    [
      source({ label: "curated_local_guide", sourceName: "Ask Siargao curated local beach guide" }),
      "Guide info checked",
    ],
    [
      source({ label: "official_checked", sourceName: "BARBOSA Official Schedule" }),
      "Official source checked",
    ],
  ] as const)("accepts supported current source evidence as checked", (input, label) => {
    const presentation = projectSourceEvidencePresentation(input);

    expect(presentation).toMatchObject({
      state: "checked",
      label,
      isPositiveClaim: true,
    });
    expect(presentation.sourceName).not.toContain("API");
  });

  test("summarizes mixed checked, unavailable, and not-verified sources without upgrading all of them", () => {
    const summary = sourceEvidenceSummaryText([
      source({ label: "live_checked", sourceName: "Google Places API" }),
      source({
        label: "provider_unavailable",
        sourceName: "Open-Meteo weather API",
        checked: [],
        notChecked: ["weather forecast"],
      }),
      source({
        label: "insufficient_web_evidence",
        sourceName: "Public web research",
        checked: [],
        notChecked: ["current ferry disruption evidence"],
      }),
    ]);

    expect(summary).toBe("Checked: Google Places; 2 caveated");
  });

  test("renders source detail lines from the mapped checked and not-checked boundaries", () => {
    expect(
      sourceEvidenceDetailLines(
        source({
          label: "weather_checked",
          sourceName: "Open-Meteo weather API",
          checked: ["forecast for Cloud 9"],
          notChecked: ["surf reports", "road flooding"],
        }),
      ),
    ).toEqual([
      "Checked details: forecast for Cloud 9",
      "Not checked: surf reports, road flooding",
    ]);
  });

  test("builds a compact receipt summary and deduplicates sources without losing freshness", () => {
    const items = sourceEvidenceReceiptItems([
      source({
        label: "live_checked",
        sourceName: "Google Places API",
        fetchedAt: "2026-07-10T01:00:00.000Z",
        checked: ["place identity"],
        notChecked: ["review text"],
      }),
      source({
        label: "live_checked",
        sourceName: "Google Places API",
        fetchedAt: "2026-07-10T03:15:00.000Z",
        checked: ["current opening status"],
        notChecked: ["bookings"],
      }),
      source({
        label: "provider_unavailable",
        sourceName: "Public web research",
        checked: [],
        notChecked: ["current ferry disruption evidence"],
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.presentation.checkedScope).toEqual([
      "place identity",
      "current opening status",
    ]);
    expect(items[0]?.presentation.notCheckedScope).toEqual(["review text", "bookings"]);
    expect(items[0]?.fetchedAtValues).toEqual([
      "2026-07-10T01:00:00.000Z",
      "2026-07-10T03:15:00.000Z",
    ]);
    expect(sourceEvidenceReceiptSummaryText(items.map((item) => item.source))).toBe(
      "Latest check Jul 10, 11:15 AM: Google Places checked; 1 verification gap.",
    );
  });

  test("rejects unsupported checked or fresh UI claims for stale, failed, or insufficient source states", () => {
    const unsupportedSources = [
      source({
        label: "provider_unavailable",
        checked: ["ignored provider facts"],
        notChecked: ["Google Places lookup"],
      }),
      source({ label: "not_verified", checked: ["ignored memory facts"] }),
      source({ label: "insufficient_web_evidence", checked: ["ignored weak web facts"] }),
      source({ label: "no_current_event_facts", checked: ["ignored stale event facts"] }),
      source({ label: "live_checked", checked: [] }),
      source({ label: "fresh_cache", checked: [] }),
    ];

    for (const input of unsupportedSources) {
      const presentation = projectSourceEvidencePresentation(input);

      expect(presentation.state).not.toBe("checked");
      expect(presentation.isPositiveClaim).toBe(false);
      expect(presentation.label.toLowerCase()).not.toContain("fresh");
      expect(presentation.label.toLowerCase()).not.toContain("checked");
      expect(presentation.checkedScope).toEqual([]);
    }
  });
});

function conditionDecision(overrides: Partial<LiveConditionDecision> = {}): LiveConditionDecision {
  return {
    kind: "weather",
    state: "live",
    action: "Keep the outdoor plan flexible.",
    basis: "The checked daily forecast is available.",
    fallback: "Keep a covered stop ready.",
    evidenceStatus: "Forecast freshness: fresh",
    sourceTime: "2026-07-10T01:00:00.000Z",
    supportingMetrics: [],
    checked: ["Open-Meteo daily forecast for Cloud 9"],
    notChecked: ["Road flooding was not checked."],
    isPrior: false,
    ...overrides,
  };
}

function source(overrides: Partial<SourceEvidenceInput> = {}): SourceEvidenceInput {
  return {
    label: "live_checked",
    sourceName: "Google Places API",
    fetchedAt: "2026-07-10T01:00:00.000Z",
    checked: ["place identity"],
    notChecked: ["review text"],
    ...overrides,
  };
}
