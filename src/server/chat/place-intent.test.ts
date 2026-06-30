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

  test("classifies time-bound party prompts as bar place intents for later venue enrichment", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "What are the best party places in General Luna tonight?" },
    ]);

    expect(intent).toMatchObject({
      category: "bar",
      location: "General Luna",
    });
    expect(intent?.liveNeeds).toContain("recommendation");
  });

  test("classifies local service requests as place intents", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "Nearest ATM or laundry near Dapa ferry terminal?" },
    ]);

    expect(intent).toMatchObject({
      category: "service",
      areaScope: "nearby",
      location: "Dapa",
    });
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

  test("resolves there from prior place context", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "Where should we get dinner near Cloud 9?" },
      { role: "assistant", content: "Here are some dinner options near Cloud 9." },
      { role: "user", content: "anything cheaper there?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      areaScope: "nearby",
      location: "Cloud 9",
    });
    expect(intent?.constraints).toContain("cheaper");
  });

  test("resolves nearby from prior General Luna context", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "We are staying in General Luna." },
      { role: "assistant", content: "That keeps you close to most food options." },
      { role: "user", content: "what cafes are nearby?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "coffee",
      areaScope: "nearby",
      location: "General Luna",
      radiusMeters: 6_000,
    });
  });

  test("persists family context into place constraints", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "We are with kids near Cloud 9." },
      { role: "assistant", content: "Keep it casual and close." },
      { role: "user", content: "where should we get dinner?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      location: "Cloud 9",
    });
    expect(intent?.constraints).toContain("family_friendly");
  });

  test("keeps open-now needs on food follow-ups", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "Where should we get coffee near Cloud 9?" },
      { role: "assistant", content: "Try a cafe near Catangnan." },
      { role: "user", content: "open now?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "coffee",
      location: "Cloud 9",
    });
    expect(intent?.liveNeeds).toContain("open_now");
  });

  test("uses assistant recommendation context when trimmed user turns omit the location", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "what if it rains?" },
      { role: "assistant", content: "It looks stormy near General Luna today." },
      { role: "user", content: "where should i go for breakfast tomorrow?" },
      {
        role: "assistant",
        content:
          "Good options I found from Google Places: Sunday Siargao, 873 m from General Luna.",
      },
      { role: "user", content: "what about lunch?" },
      {
        role: "assistant",
        content:
          "Good options I found from Google Places: Yugto Siargao, 1.2 km from General Luna.",
      },
      { role: "user", content: "what about dinner?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      meal: "dinner",
      location: "General Luna",
    });
  });

  test("inherits the newest prior meal for restaurant-quality follow-ups", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "where should i go for breakfast tomorrow?" },
      { role: "assistant", content: "Try a cafe near General Luna." },
      { role: "user", content: "what about lunch?" },
      { role: "assistant", content: "Try a restaurant near General Luna." },
      { role: "user", content: "what about dinner?" },
      { role: "assistant", content: "Ask Siargao could not answer right now. Please try again." },
      { role: "user", content: "I want proper restaurant not carinderia" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      meal: "dinner",
      location: "General Luna",
      avoid: ["brunch_only", "coffee_only", "carinderia", "canteen"],
    });
  });

  test("carries proper-restaurant avoidance into seafood refinements", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "what about dinner?" },
      { role: "assistant", content: "Try Loka or X Pizza near Cloud 9." },
      { role: "user", content: "I want proper restaurant not carinderia" },
      { role: "assistant", content: "Try a sit-down restaurant near Cloud 9." },
      { role: "user", content: "what about seafood?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      meal: "dinner",
      location: "Cloud 9",
      avoid: ["brunch_only", "coffee_only", "carinderia", "canteen"],
    });
  });

  test("does not keep cheaper as a durable constraint after the latest turn changes", () => {
    const intent = interpretPlaceIntent([
      { role: "user", content: "Where should we get dinner near Cloud 9?" },
      { role: "assistant", content: "Here are dinner options near Cloud 9." },
      { role: "user", content: "anything cheaper?" },
      { role: "assistant", content: "Here are cheaper dinner options." },
      { role: "user", content: "open now?" },
    ] satisfies AskSiargaoChatMessage[]);

    expect(intent).toMatchObject({
      category: "food",
      location: "Cloud 9",
    });
    expect(intent?.liveNeeds).toContain("open_now");
    expect(intent?.constraints).not.toContain("cheaper");
    expect(intent?.constraints).not.toContain("budget");
  });
});
