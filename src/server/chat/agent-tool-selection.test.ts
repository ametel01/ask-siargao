import { describe, expect, test } from "bun:test";

import { loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import { selectAgentResponseTools } from "@/server/chat/agent-tool-selection";
import { buildAgentResponseTools } from "@/server/chat/agent-tools";
import { buildEvidenceLifecycle } from "@/server/chat/required-evidence";

describe("agent tool selection", () => {
  test("keeps a general planning turn compact", () => {
    const names = selectedNames("How should I spend my first afternoon?");

    expect(names).toEqual([
      "search_local_guide",
      "plan_local_itinerary",
      "load_agent_memory_file",
      "search_agent_memory",
    ]);
  });

  test("selects the governed condition judgment without exposing its provider adapters", () => {
    const names = selectedNames("Is it safe to surf near Cloud 9 tomorrow?");

    expect(names).toContain("get_condition_judgment");
    expect(names).not.toContain("get_weather_forecast");
    expect(names).not.toContain("get_marine_conditions");
    expect(names).not.toContain("get_tide_forecast");
    expect(names).toContain("rank_surf_spots_nearby");
    expect(names).not.toContain("describe_database_schema");
    expect(names).not.toContain("search_nightlife_events");
  });

  test("uses governed condition providers for an immediate Cloud 9 decision", () => {
    const names = selectedNames("Should we still go to Cloud 9 today?");

    expect(names.filter((name) => name.startsWith("get_") && name.includes("condition"))).toEqual([
      "get_condition_judgment",
    ]);
    expect(names).not.toContain("get_weather_forecast");
    expect(names).not.toContain("get_marine_conditions");
    expect(names).not.toContain("get_tide_forecast");
    expect(names).not.toContain("research_web");
  });

  test("keeps a direct tide-timing request on the raw tide interface", () => {
    const names = selectedNames("What time is high tide at Cloud 9 tomorrow?");

    expect(names).toContain("get_tide_forecast");
    expect(names).not.toContain("get_weather_forecast");
    expect(names).not.toContain("get_marine_conditions");
    expect(names).not.toContain("get_condition_judgment");
  });

  test.each(["What is the surf forecast at Cloud 9?", "What is the surf report at Cloud 9?"])(
    "routes surf decisions through the governed judgment: %s",
    (prompt) => {
      const names = selectedNames(prompt);

      expect(names).toContain("get_condition_judgment");
      expect(names).not.toContain("get_weather_forecast");
      expect(names).not.toContain("get_marine_conditions");
      expect(names).not.toContain("get_tide_forecast");
    },
  );

  test.each([
    "What is the wave height at Cloud 9 tomorrow?",
    "Show me the marine forecast for Siargao",
    "Can I see the wave height at Cloud 9?",
  ])("keeps explicit provider-detail requests on the raw marine interface: %s", (prompt) => {
    const names = selectedNames(prompt);

    expect(names).toContain("get_marine_conditions");
    expect(names).toContain("get_tide_forecast");
    expect(names).not.toContain("get_weather_forecast");
    expect(names).not.toContain("get_condition_judgment");
  });

  test.each([
    "Is it safe to swim at high tide at Cloud 9?",
    "Is this wave height safe for surfing at Cloud 9?",
    "Can I surf at high tide at Cloud 9?",
    "Could we swim at high tide at Cloud 9?",
    "Can the kids swim at high tide at Cloud 9?",
    "Could they surf at high tide at Cloud 9?",
  ])("keeps mixed raw-detail safety decisions on the governed judgment: %s", (prompt) => {
    const names = selectedNames(prompt);

    expect(names).toContain("get_condition_judgment");
    expect(names).not.toContain("get_weather_forecast");
    expect(names).not.toContain("get_marine_conditions");
    expect(names).not.toContain("get_tide_forecast");
  });

  test("keeps ordered required research and Places tools available", () => {
    const prompt = "Where can I rent a motorbike in Siargao today?";
    const names = selectedNames(prompt);

    expect(names).toContain("research_web");
    expect(names).toContain("search_places");
    expect(names).toContain("get_place_details");
  });
});

function selectedNames(content: string) {
  const request = { messages: [{ role: "user" as const, content }] };
  const tools = selectAgentResponseTools(
    buildAgentResponseTools(loadAgentMemorySnapshot(), { vectorStoreId: "" }),
    request,
    buildEvidenceLifecycle(request).requiredToolNames,
  );
  return tools.flatMap((tool) => (tool.type === "function" ? [tool.name] : [tool.type]));
}
