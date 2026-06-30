import { describe, expect, test } from "bun:test";

import { renderNightlifeEventsText, searchNightlifeEvents } from "@/server/chat/nightlife-events";

describe("nightlife events", () => {
  test("returns Tuesday General Luna route candidates ordered by time and intensity", () => {
    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      now: new Date("2026-06-30T12:00:00+08:00"),
    });

    expect(result).toMatchObject({
      status: "available",
      localDate: "2026-06-30",
      dayOfWeek: "Tuesday",
      route: {
        warmUp: { venueName: "BARREL", routeRole: "warm_up" },
        mainParty: { venueName: "Barbosa", routeRole: "main_party" },
        lateOption: { venueName: "Siargao Beach Club", routeRole: "late_option" },
        softerOption: { venueName: "Mama Coco", routeRole: "softer_option" },
      },
    });
    expect(result.candidates.map((candidate) => candidate.venueName)).toEqual([
      "BARREL",
      "Barbosa",
      "Mama Coco",
      "Siargao Beach Club",
    ]);
    expect(result.source).toMatchObject({
      label: "curated_local_guide",
      sourceName: "Ask Siargao approved nightlife event facts",
      checked: [
        "approved General Luna nightlife event facts for Tuesday",
        "route roles: warm-up, main party, late option, and softer option when available",
      ],
    });
    expect(result.source.notChecked).toEqual(
      expect.arrayContaining([
        "live crowd size",
        "door policy",
        "guest list",
        "table availability",
        "last-minute cancellation",
        "exact closing time",
      ]),
    );
  });

  test("filters to pub quiz and trivia interest without treating memory as live evidence", () => {
    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      interests: ["pub_quiz", "trivia"],
      now: new Date("2026-06-30T12:00:00+08:00"),
    });

    expect(result.candidates.map((candidate) => candidate.venueName)).toEqual(["BARREL"]);
    expect(renderNightlifeEventsText(result)).toContain("BARREL - Tuesday Pub Quiz");
    expect(renderNightlifeEventsText(result)).toContain("Not checked: same-day venue social posts");
  });
});
