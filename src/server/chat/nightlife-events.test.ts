import { describe, expect, test } from "bun:test";

import {
  type NightlifeEventInterest,
  renderNightlifeEventsText,
  searchNightlifeEvents,
} from "@/server/chat/nightlife-events";
import { buildRequiredEvidencePlan } from "@/server/chat/required-evidence";

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
    expect(result.candidates[0]).toMatchObject({
      sourceProfileId: "source_nightlife_local_event_directories",
      sourceUrl: "https://siargaovibes.com/activities/tuesdays-pub-quiz-at-barrel/",
      observedAt: "2026-06-30T19:00:00+08:00",
      lastVerifiedAt: "2026-06-30T09:00:00+08:00",
      expiresAt: "2026-06-30T21:30:00+08:00",
      reviewAfter: "2026-07-01T09:00:00+08:00",
      confidence: "medium",
    });
    expect(result.sources.map((source) => source.label)).toEqual([
      "event_checked",
      "event_checked",
      "event_checked",
    ]);
    expect(result.sources.map((source) => source.sourceProfileId)).toEqual([
      "source_nightlife_local_event_directories",
      "source_nightlife_official_venue_websites",
      "source_nightlife_public_official_social_posts",
    ]);
    expect(result.sources[0]?.checked).toEqual([
      "approved General Luna nightlife event facts for Tuesday",
      "verified event occurrences: BARREL, Mama Coco",
      "route roles: warm-up, main party, late option, and softer option when available",
    ]);
    expect(result.sources[0]?.notChecked).toEqual(
      expect.arrayContaining([
        "live crowd size",
        "door policy",
        "guest list",
        "table availability",
        "last-minute cancellation",
        "exact closing time",
      ]),
    );
    expect(result.source).toMatchObject({
      label: "event_checked",
      sourceName: "Local nightlife event directories",
      checked: [
        "approved General Luna nightlife event facts for Tuesday",
        "verified event occurrences: BARREL, Mama Coco",
        "route roles: warm-up, main party, late option, and softer option when available",
      ],
    });
    expect(result.refreshDecision).toMatchObject({
      status: "not_needed",
      checkedFreshHighMediumEventCount: 4,
      minimumFreshHighMediumEventCount: 2,
    });
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
    expect(renderNightlifeEventsText(result)).toContain(
      "profile: source_nightlife_local_event_directories",
    );
  });

  test("keeps BARREL as warm-up for the canonical required-evidence party route", () => {
    const plan = buildRequiredEvidencePlan({
      messages: [
        {
          role: "user",
          content: "What are the best party places in General Luna tonight?",
        },
      ],
      deterministicSignals: {
        intent: {
          latestUserTurn: "What are the best party places in General Luna tonight?",
          nightlifePlan: true,
        },
      },
    });
    const nightlifeCall = plan.requiredToolCalls.find(
      (requiredCall) => requiredCall.name === "search_nightlife_events",
    );

    expect(nightlifeCall?.arguments).toMatchObject({
      location: "General Luna",
      date: "tonight",
      interests: ["party"],
    });

    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      interests: nightlifeCall?.arguments.interests as NightlifeEventInterest[],
      now: new Date("2026-06-30T12:00:00+08:00"),
    });

    expect(result.route.warmUp).toMatchObject({
      venueName: "BARREL",
      eventName: "Tuesday Pub Quiz",
      routeRole: "warm_up",
    });
    expect(result.candidates.map((candidate) => candidate.venueName)).toEqual([
      "BARREL",
      "Barbosa",
      "Mama Coco",
      "Siargao Beach Club",
    ]);
  });

  test("expires event occurrences after their event window", () => {
    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      now: new Date("2026-06-30T22:30:00+08:00"),
    });

    expect(result.candidates.map((candidate) => candidate.venueName)).toEqual([
      "Barbosa",
      "Mama Coco",
      "Siargao Beach Club",
    ]);
    expect(result.candidates.map((candidate) => candidate.venueName)).not.toContain("BARREL");
  });

  test("does not treat stale recurring baseline rows as same-day truth", () => {
    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      now: new Date("2026-07-07T12:00:00+08:00"),
    });

    expect(result).toMatchObject({
      status: "no_events",
      localDate: "2026-07-07",
      dayOfWeek: "Tuesday",
      candidates: [],
      refreshDecision: {
        status: "recommended",
        checkedFreshHighMediumEventCount: 0,
        minimumFreshHighMediumEventCount: 2,
      },
    });
    expect(renderNightlifeEventsText(result)).toContain(
      "Do not substitute Google Places bar rankings as event evidence.",
    );
  });

  test("keeps community and broad guide signals out of event truth", () => {
    const result = searchNightlifeEvents({
      location: "General Luna",
      date: "tonight",
      now: new Date("2026-07-06T12:00:00+08:00"),
    });

    expect(result.status).toBe("no_events");
    expect(result.candidates.map((candidate) => candidate.venueName)).not.toContain("El Lobo");
    expect(result.sources.map((source) => source.sourceProfileId)).not.toContain(
      "source_nightlife_local_guides",
    );
    expect(result.refreshDecision.status).toBe("recommended");
  });
});
