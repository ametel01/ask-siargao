import { describe, expect, test } from "bun:test";

import { loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import { selectAgentResponseTools } from "@/server/chat/agent-tool-selection";
import { buildAgentResponseTools } from "@/server/chat/agent-tools";
import { buildRequiredEvidencePlan } from "@/server/chat/required-evidence";

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

  test("selects condition tools without unrelated database or nightlife schemas", () => {
    const names = selectedNames("Is it safe to surf near Cloud 9 tomorrow?");

    expect(names).toContain("get_weather_forecast");
    expect(names).toContain("get_marine_conditions");
    expect(names).toContain("get_tide_forecast");
    expect(names).toContain("get_condition_judgment");
    expect(names).toContain("rank_surf_spots_nearby");
    expect(names).not.toContain("describe_database_schema");
    expect(names).not.toContain("search_nightlife_events");
  });

  test("uses governed condition providers for an immediate Cloud 9 decision", () => {
    const names = selectedNames("Should we still go to Cloud 9 today?");

    expect(names).toContain("get_weather_forecast");
    expect(names).toContain("get_marine_conditions");
    expect(names).toContain("get_tide_forecast");
    expect(names).toContain("get_condition_judgment");
    expect(names).not.toContain("research_web");
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
    buildRequiredEvidencePlan(request),
  );
  return tools.flatMap((tool) => (tool.type === "function" ? [tool.name] : [tool.type]));
}
