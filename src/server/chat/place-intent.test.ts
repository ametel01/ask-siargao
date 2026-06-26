import { describe, expect, test } from "bun:test";

import { interpretPlaceIntent } from "@/server/chat/place-intent";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

describe("interpretPlaceIntent", () => {
  test("classifies nearby open-now food requests", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "where can I eat nearby that is open now?" },
    ]);

    expect(intent).toMatchObject({
      category: "food",
      areaScope: "nearby",
      location: "General Luna",
      radiusMeters: 6_000,
    });
    expect(intent?.liveNeeds).toContain("open_now");
    expect(intent?.liveNeeds).toContain("nearby");
  });

  test("classifies covered cafes nearby with constraints", () => {
    const intent = interpretPlaceIntent([{ role: "user", content: "covered cafes nearby" }]);

    expect(intent).toMatchObject({
      category: "coffee",
      areaScope: "nearby",
      constraints: ["covered_seating"],
      radiusMeters: 6_000,
    });
    expect(intent?.liveNeeds).toContain("nearby");
  });

  test("classifies beachfront places near General Luna", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "beachfront places near General Luna" },
    ]);

    expect(intent).toMatchObject({
      category: "activity_place",
      areaScope: "nearby",
      location: "General Luna",
    });
    expect(intent?.constraints).toContain("beachfront");
  });

  test("inherits place category for open-now follow-ups", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "where should we get dinner near Cloud 9?" },
      {
        role: "assistant",
        content: "Good options I found from Google Places: 1. Dinner Grill",
      },
      { role: "user", content: "is this still open?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      location: "Cloud 9",
    });
    expect(intent?.liveNeeds).toContain("open_now");
  });

  test("classifies named place identity and map-link requests", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "Can you find a map link for Shaka Siargao?" },
    ]);

    expect(intent).toMatchObject({
      category: "specific_place",
      placeName: "Shaka",
    });
    expect(intent?.liveNeeds).toContain("identity");
  });
});
