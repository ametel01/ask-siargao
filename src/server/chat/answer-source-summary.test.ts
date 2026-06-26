import { describe, expect, test } from "bun:test";

import {
  type AnswerSourceSummary,
  googlePlacesFreshnessToTrustLabel,
  renderAnswerSourceLines,
  renderAnswerSourceSummaryMarkdown,
} from "@/server/chat/answer-source-summary";

describe("answer source summaries", () => {
  test("maps provider freshness values to explicit trust labels", () => {
    expect(googlePlacesFreshnessToTrustLabel("live")).toBe("live_checked");
    expect(googlePlacesFreshnessToTrustLabel("fresh_cache")).toBe("fresh_cache");
    expect(googlePlacesFreshnessToTrustLabel("stale_cache")).toBe("not_verified");
  });

  test("renders checked and not-checked lines with source metadata", () => {
    const summary: AnswerSourceSummary = {
      label: "live_checked",
      sourceName: "Google Places API",
      sourceProfileId: "source_google_places",
      fetchedAt: "2026-06-26T01:00:00.000Z",
      confidence: "high",
      checked: ["ratings", "open-now signal"],
      notChecked: ["bookings", "review text"],
    };

    expect(renderAnswerSourceLines([summary])).toEqual([
      "Checked: Google Places API (live checked; high confidence; profile source_google_places; fetched 2026-06-26T01:00:00.000Z) - ratings and open-now signal.",
      "Not checked: Google Places API (live checked; high confidence; profile source_google_places; fetched 2026-06-26T01:00:00.000Z) - bookings and review text.",
    ]);
  });

  test("keeps weather signal as its own parser-compatible source line", () => {
    const summary: AnswerSourceSummary = {
      label: "weather_checked",
      sourceName: "Open-Meteo weather API",
      sourceProfileId: "source_open_meteo",
      fetchedAt: "2026-06-26T00:00:00.000Z",
      confidence: "medium",
      checked: ["forecast for General Luna"],
      notChecked: ["surf reports", "road flooding"],
    };

    expect(
      renderAnswerSourceSummaryMarkdown([summary], {
        weatherSignal: "Thunderstorm; rain 0.7mm",
      }),
    ).toBe(
      [
        "Checked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - forecast for General Luna.",
        "Weather signal: Thunderstorm; rain 0.7mm.",
        "Not checked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - surf reports and road flooding.",
      ].join("\n"),
    );
  });

  test("renders curated and generic labels from explicit inputs only", () => {
    const summaries: AnswerSourceSummary[] = [
      {
        label: "curated_local_guide",
        sourceName: "Ask Siargao curated local beach guide",
        confidence: "medium",
        checked: ["ride-time notes", "beach-surface notes"],
        notChecked: ["live road conditions"],
      },
      {
        label: "not_verified",
        sourceName: "Generic model reasoning",
        checked: [],
        notChecked: ["live Google Places", "Open-Meteo forecast", "curated local guide"],
      },
    ];

    expect(renderAnswerSourceLines(summaries)).toEqual([
      "Checked: Ask Siargao curated local beach guide (curated local guide; medium confidence) - ride-time notes and beach-surface notes.",
      "Not checked: Ask Siargao curated local beach guide (curated local guide; medium confidence) - live road conditions.",
      "Not checked: Generic model reasoning (not verified) - live Google Places, Open-Meteo forecast, and curated local guide.",
    ]);
  });

  test("does not invent checked items for empty or unavailable summaries", () => {
    const summaries: AnswerSourceSummary[] = [
      {
        label: "provider_unavailable",
        sourceName: "Open-Meteo weather API",
        confidence: "low",
        checked: ["ignored unavailable check"],
        notChecked: ["weather forecast"],
      },
      {
        label: "fresh_cache",
        sourceName: "Google Places API",
        checked: [],
        notChecked: [],
      },
    ];

    expect(renderAnswerSourceLines(summaries)).toEqual([
      "Not checked: Open-Meteo weather API (provider unavailable; low confidence) - weather forecast.",
    ]);
  });

  test("normalizes whitespace without reading answer text", () => {
    const summary: AnswerSourceSummary = {
      label: "fresh_cache",
      sourceName: "Google Places API",
      checked: ["  cached place listing\nfacts  "],
      notChecked: ["  ", "independent local validation"],
    };

    expect(renderAnswerSourceLines([summary])).toEqual([
      "Checked: Google Places API (fresh cache) - cached place listing facts.",
      "Not checked: Google Places API (fresh cache) - independent local validation.",
    ]);
  });
});
