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

    const lines = renderAnswerSourceLines([summary]);

    expect(lines).toEqual([
      "Checked: Google Places (Places checked; high confidence; checked Jun 26, 9:00 AM) - ratings and open-now signal.",
      "Not checked: Google Places (Places checked; high confidence; checked Jun 26, 9:00 AM) - bookings and review text.",
    ]);
    expect(lines.join("\n")).not.toContain("source_google_places");
    expect(lines.join("\n")).not.toContain("live_checked");
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
        "Checked: Weather forecast (Weather checked; medium confidence; checked Jun 26, 8:00 AM) - forecast for General Luna.",
        "Weather signal: Thunderstorm; rain 0.7mm.",
        "Not checked: Weather forecast (Weather checked; medium confidence; checked Jun 26, 8:00 AM) - surf reports and road flooding.",
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
      "Checked: Ask Siargao local beach guide (Guide info checked; medium confidence) - ride-time notes and beach-surface notes.",
      "Not checked: Ask Siargao local beach guide (Guide info checked; medium confidence) - live road conditions.",
      "Not checked: Ask Siargao estimate (Not verified) - live Google Places, Open-Meteo forecast, and curated local guide.",
    ]);
  });

  test("renders nightlife event, venue, and community labels distinctly", () => {
    const summaries: AnswerSourceSummary[] = [
      {
        label: "event_checked",
        sourceName: "Local nightlife event directories",
        sourceProfileId: "source_nightlife_local_event_directories",
        confidence: "medium",
        checked: ["approved event occurrence"],
        notChecked: ["crowd size"],
      },
      {
        label: "venue_checked",
        sourceName: "Google Places API",
        sourceProfileId: "source_google_places",
        confidence: "medium",
        checked: ["venue identity"],
        notChecked: ["event schedule"],
      },
      {
        label: "community_signal",
        sourceName: "Reddit public nightlife threads",
        sourceProfileId: "source_nightlife_reddit_public_threads",
        confidence: "low",
        checked: ["community rhythm signal"],
        notChecked: ["tonight's event schedule"],
      },
    ];

    expect(renderAnswerSourceLines(summaries)).toEqual([
      "Checked: Local nightlife event directories (Event checked; medium confidence) - approved event occurrence.",
      "Checked: Google Places (Places checked; medium confidence) - venue identity.",
      "Checked: Reddit public nightlife threads (Community signal; low confidence) - community rhythm signal.",
      "Not checked: Local nightlife event directories (Event checked; medium confidence) - crowd size.",
      "Not checked: Google Places (Places checked; medium confidence) - event schedule.",
      "Not checked: Reddit public nightlife threads (Community signal; low confidence) - tonight's event schedule.",
    ]);
  });

  test("renders public web research labels without treating weak evidence as checked", () => {
    const summaries: AnswerSourceSummary[] = [
      {
        label: "official_checked",
        sourceName: "Barbosa official schedule",
        sourceProfileId: "source_web_official",
        confidence: "high",
        checked: ["Wednesday closed schedule"],
        notChecked: ["last-minute private events"],
      },
      {
        label: "directory_checked",
        sourceName: "SiargaoVibes",
        sourceProfileId: "source_web_local_directory",
        confidence: "medium",
        checked: ["Goodies Funky Wednesday listing"],
        notChecked: ["live crowd size"],
      },
      {
        label: "web_researched",
        sourceName: "Recent Siargao nightlife guide",
        sourceProfileId: "source_web_guide",
        confidence: "low",
        checked: ["El Lobo Wednesday guide signal"],
        notChecked: ["official same-day confirmation"],
      },
      {
        label: "insufficient_web_evidence",
        sourceName: "Public web research",
        confidence: "low",
        checked: ["ignored weak check"],
        notChecked: ["current ferry disruption evidence"],
      },
    ];

    expect(renderAnswerSourceLines(summaries)).toEqual([
      "Checked: Barbosa official schedule (Official source checked; high confidence) - Wednesday closed schedule.",
      "Checked: SiargaoVibes (Directory checked; medium confidence) - Goodies Funky Wednesday listing.",
      "Checked: Recent Siargao nightlife guide (Public web checked; low confidence) - El Lobo Wednesday guide signal.",
      "Not checked: Barbosa official schedule (Official source checked; high confidence) - last-minute private events.",
      "Not checked: SiargaoVibes (Directory checked; medium confidence) - live crowd size.",
      "Not checked: Recent Siargao nightlife guide (Public web checked; low confidence) - official same-day confirmation.",
      "Not checked: Public web research (Web evidence insufficient; low confidence) - current ferry disruption evidence.",
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
      "Not checked: Weather forecast (Could not check; low confidence) - weather forecast.",
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
      "Checked: Google Places (Recently checked) - cached place listing facts.",
      "Not checked: Google Places (Recently checked) - independent local validation.",
    ]);
  });
});
