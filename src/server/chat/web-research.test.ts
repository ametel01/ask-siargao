import { describe, expect, test } from "bun:test";

import {
  buildWebResearchQueries,
  classifyWebResearchSource,
  runWebResearch,
  scoreResearchSource,
  type WebResearchProviderResult,
} from "@/server/chat/web-research";

const now = new Date("2026-07-01T12:00:00+08:00");

describe("web research engine", () => {
  test("expands nightlife/event queries with date, official, directory, and community targets", () => {
    const queries = buildWebResearchQueries({
      query: "best party locations",
      intent: "recommendation",
      location: "General Luna",
      dateContext: "tonight",
      localDate: "2026-07-01",
      sourceTypes: ["official", "local_directory", "community"],
    });

    expect(queries[0]).toContain("general luna");
    expect(queries.join("\n")).toContain("wednesday");
    expect(queries.join("\n")).toContain("official");
    expect(queries.join("\n")).toContain("directory local listing");
    expect(queries.join("\n")).toContain("reddit forum");
  });

  test("expands restaurant/current recommendation queries toward maps and official sources", () => {
    const queries = buildWebResearchQueries({
      query: "best dinner in General Luna",
      intent: "recommendation",
      location: "General Luna",
      dateContext: "tonight",
      sourceTypes: ["maps", "official", "local_directory"],
    });

    expect(queries.join("\n")).toContain("open now");
    expect(queries.join("\n")).toContain("official");
    expect(queries.join("\n")).toContain("local listing");
  });

  test("expands ferry and transport schedule queries toward official, government, and news sources", () => {
    const queries = buildWebResearchQueries({
      query: "Dapa to Surigao ferry schedule",
      intent: "schedule",
      location: "Siargao",
      dateContext: "tomorrow",
      sourceTypes: ["official", "government", "news"],
    });

    expect(queries.join("\n")).toContain("hours timetable");
    expect(queries.join("\n")).toContain("government advisory official");
    expect(queries.join("\n")).toContain("news update");
  });

  test("expands tour price queries toward current rates", () => {
    const queries = buildWebResearchQueries({
      query: "Sugba Lagoon tour price",
      intent: "price",
      location: "Del Carmen",
      dateContext: "none",
    });

    expect(queries.join("\n")).toContain("rates current fee");
    expect(queries.join("\n")).toContain("official");
    expect(queries.join("\n")).toContain("recent guide 2026");
  });

  test("expands motorbike rental queries toward rental operators and rates", () => {
    const queries = buildWebResearchQueries({
      query: "motorbike rental in General Luna",
      intent: "recommendation",
      location: "General Luna",
      sourceTypes: ["official", "local_directory", "maps", "guide"],
    });

    expect(queries.join("\n")).toContain("rates contact whatsapp deposit helmet");
    expect(queries.join("\n")).toContain("official scooter");
    expect(queries.join("\n")).toContain("Siargao scooter directory");
    expect(queries.join("\n")).not.toContain("events directory");
  });

  test("expands safety and disruption queries toward advisories and news", () => {
    const queries = buildWebResearchQueries({
      query: "road closures after storm",
      intent: "safety",
      location: "Siargao",
      dateContext: "today",
    });

    expect(queries.join("\n")).toContain("advisory closure disruption safety update");
    expect(queries.join("\n")).toContain("government official");
    expect(queries.join("\n")).toContain("weather forecast");
  });

  test("classifies source types from explicit class or URL hints", () => {
    expect(
      classifyWebResearchSource({
        url: "https://barbosasiargao.com/schedule",
        title: "BARBOSA Official Schedule",
      }),
    ).toBe("official");
    expect(
      classifyWebResearchSource({
        url: "https://www.reddit.com/r/SiargaoPH/comments/nightlife",
        title: "Nightlife party schedule",
      }),
    ).toBe("community");
    expect(
      classifyWebResearchSource({
        url: "https://siargaovibes.com/events/funky-wednesday",
        title: "Funky Wednesday at Goodies",
      }),
    ).toBe("local_directory");
  });

  test("ranks official current sources above guide sources for factual status", () => {
    const request = {
      query: "Barbosa Wednesday schedule",
      intent: "schedule" as const,
      location: "General Luna",
      dateContext: "today" as const,
      localDate: "2026-07-01",
      requiredFreshness: "same_day" as const,
    };
    const official = scoreResearchSource(
      {
        url: "https://barbosasiargao.com/schedule",
        title: "BARBOSA Official Schedule",
        sourceType: "official",
        snippet: "Wednesday: closed. Thursday party resumes.",
        publishedOrUpdatedAt: "2026-07-01T08:00:00+08:00",
      },
      request,
      now,
    );
    const guide = scoreResearchSource(
      {
        url: "https://example.com/siargao-party-guide",
        title: "Siargao Nightlife Guide",
        sourceType: "guide",
        snippet: "A 2025 guide says Barbosa is popular during the week.",
        publishedOrUpdatedAt: "2025-01-01T08:00:00+08:00",
      },
      request,
      now,
    );

    expect(official.score).toBeGreaterThan(guide.score);
    expect(official.confidence).toBe("high");
    expect(guide.confidence).toBe("low");
  });

  test("preserves negative evidence as answerable findings", () => {
    const result = runWebResearch(
      {
        query: "Barbosa Wednesday party",
        intent: "availability",
        location: "General Luna",
        dateContext: "today",
        localDate: "2026-07-01",
        requiredFreshness: "same_day",
      },
      [
        {
          url: "https://barbosasiargao.com/schedule",
          title: "BARBOSA Official Schedule",
          sourceType: "official",
          snippet: "Wednesday: closed. No party is listed for July 1, 2026.",
          publishedOrUpdatedAt: "2026-07-01T09:00:00+08:00",
          entities: [{ name: "Barbosa", kind: "place", area: "General Luna" }],
        },
      ],
      { now },
    );

    expect(result.status).toBe("available");
    expect(result.findings[0]).toMatchObject({
      answerRole: "negative",
      sourceTitle: "BARBOSA Official Schedule",
      matchedDateContext: "wednesday",
    });
    expect(result.entities).toEqual([
      {
        name: "Barbosa",
        kind: "place",
        area: "General Luna",
        needsPlacesEnrichment: true,
      },
    ]);
  });

  test("returns available findings for non-nightlife current recommendations", () => {
    const result = runWebResearch(
      {
        query: "best dinner in General Luna",
        intent: "recommendation",
        location: "General Luna",
        dateContext: "tonight",
        requiredFreshness: "same_day",
      },
      [
        {
          url: "https://maps.google.com/place/example",
          title: "Roots Siargao",
          sourceType: "maps",
          snippet: "Roots Siargao is open tonight in General Luna with dinner hours listed.",
          publishedOrUpdatedAt: "2026-07-01T10:00:00+08:00",
          entities: [{ name: "Roots Siargao", kind: "place", area: "General Luna" }],
        },
        {
          url: "https://roots-siargao.example/menu",
          title: "Roots Siargao Official Menu",
          sourceType: "official",
          snippet: "Dinner menu and July 2026 opening hours for General Luna.",
          publishedOrUpdatedAt: "2026-07-01T09:00:00+08:00",
        },
      ],
      { now },
    );

    expect(result.status).toBe("available");
    expect(result.findings[0]?.sourceType).toBeOneOf(["maps", "official"]);
    expect(result.entities[0]).toMatchObject({
      name: "Roots Siargao",
      kind: "place",
    });
  });

  test("filters unrelated hotel map pages from motorbike rental research", () => {
    const result = runWebResearch(
      {
        query: "motorbike rental in General Luna",
        intent: "recommendation",
        location: "General Luna",
        sourceTypes: ["maps", "official", "local_directory"],
        requiredFreshness: "stable",
      },
      [
        {
          url: "https://www.google.com/travel/hotels/entity/example",
          title: "Kaimana Resort Siargao - Google hotels",
          sourceType: "maps",
          snippet:
            "Google Hotels listing for Kaimana Resort Siargao in General Luna with restaurant details.",
          publishedOrUpdatedAt: "2026-06-29T09:00:00+08:00",
        },
        {
          url: "https://goldenbellsiargao.com/",
          title: "Golden Bell Siargao Scooter & Motorbike Rental",
          sourceType: "official",
          snippet:
            "Scooter and motorbike rental in General Luna with daily rates, helmets, delivery, and WhatsApp contact.",
          publishedOrUpdatedAt: "2026-06-29T09:00:00+08:00",
          entities: [{ name: "Golden Bell Siargao", kind: "operator", area: "General Luna" }],
        },
      ],
      { now },
    );

    expect(result.status).toBe("available");
    expect(result.findings.map((finding) => finding.sourceTitle)).toEqual([
      "Golden Bell Siargao Scooter & Motorbike Rental",
    ]);
    expect(JSON.stringify(result.findings)).not.toContain("Kaimana Resort");
    expect(JSON.stringify(result.entities)).not.toContain("Kaimana Resort");
    expect(result.entities[0]).toMatchObject({
      name: "Golden Bell Siargao",
      kind: "operator",
    });
  });

  test("rejects indirect motorbike mentions as rental research evidence", () => {
    const result = runWebResearch(
      {
        query: "motorbike rental in General Luna",
        intent: "recommendation",
        location: "General Luna",
        sourceTypes: ["local_directory", "guide"],
        requiredFreshness: "stable",
      },
      [
        {
          url: "https://wanderlog.example/siargao-books-cafe",
          title: "Siargao Books Cafe, Surigao City, Philippines",
          sourceType: "local_directory",
          snippet:
            "Public directory listing for a 24-hour cafe in General Luna with motorbike parking; useful as a nearby availability reference, but not a motorbike rental operator.",
          publishedOrUpdatedAt: "2026-07-01T09:00:00+08:00",
        },
        {
          url: "https://review.example/outdoor-adventures-siargao",
          title: "Outdoor Adventures Siargao - Review",
          sourceType: "guide",
          snippet:
            "Recent attraction page referencing motorbike transport on the island; not a rental operator listing.",
          publishedOrUpdatedAt: "2026-06-30T09:00:00+08:00",
        },
      ],
      { now },
    );

    expect(result.status).toBe("insufficient");
    expect(result.findings).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  test("returns insufficient when only weak stale sources exist", () => {
    const result = runWebResearch(
      {
        query: "party locations General Luna tonight",
        intent: "recommendation",
        location: "General Luna",
        dateContext: "tonight",
        requiredFreshness: "same_day",
      },
      [
        {
          url: "https://old-blog.example/siargao-nightlife",
          title: "Old Siargao Nightlife Guide",
          sourceType: "guide",
          snippet: "In 2023, visitors liked several bars around General Luna.",
          publishedOrUpdatedAt: "2023-02-01T08:00:00+08:00",
        },
      ],
      { now },
    );

    expect(result.status).toBe("insufficient");
    expect(result.findings).toEqual([]);
    expect(result.notChecked).toContain(
      "sufficient current public evidence for the requested fact or recommendation",
    );
  });

  test("does not return raw fetched page text or restricted payloads", () => {
    const source = {
      url: "https://siargaovibes.com/events/funky-wednesday",
      title: "Funky Wednesday at Goodies",
      sourceType: "local_directory",
      snippet: "Funky Wednesday at Goodies runs 8 PM to 12 AM on Wednesday.",
      pageSummary: "Goodies lists Funky Wednesday with house and techno DJs.",
      rawPageText: "very long raw page text that must never enter the result payload",
      providerPayload: { private: true },
      publishedOrUpdatedAt: "2026-07-01T08:00:00+08:00",
    } as unknown as WebResearchProviderResult;

    const result = runWebResearch(
      {
        query: "Goodies Wednesday party",
        intent: "schedule",
        location: "General Luna",
        dateContext: "today",
        localDate: "2026-07-01",
        requiredFreshness: "same_day",
      },
      [source],
      { now },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("raw page text");
    expect(serialized).not.toContain("providerPayload");
    expect(result.findings[0]?.claim).toBe(
      "Goodies lists Funky Wednesday with house and techno DJs.",
    );
  });

  test("returns provider unavailable without promoting weak fallback evidence", () => {
    const result = runWebResearch(
      {
        query: "ferry cancellations today",
        intent: "safety",
        location: "Siargao",
        dateContext: "today",
      },
      [],
      { providerUnavailable: true, now },
    );

    expect(result.status).toBe("provider_unavailable");
    expect(result.findings).toEqual([]);
    expect(result.sourceScores).toEqual([]);
    expect(result.notChecked[0]).toContain("provider was unavailable");
  });
});
