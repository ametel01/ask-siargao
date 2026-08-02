import type { AgentRuntimeRequest, AskSiargaoAgentToolName } from "@/server/chat/agent-runtime";
import type { AgentResponseToolDefinition } from "@/server/chat/agent-tool-catalogue";
import { interpretPlaceIntent } from "@/server/chat/place-intent";
import type { RequiredEvidencePlan } from "@/server/chat/required-evidence";

const memoryTools = ["load_agent_memory_file", "search_agent_memory"] as const;
const conditionTools = [
  "get_weather_forecast",
  "get_marine_conditions",
  "get_tide_forecast",
  "get_condition_judgment",
] as const;
const placesTools = ["search_places", "get_place_details", "search_local_guide"] as const;
const localFactsTools = [
  "describe_database_schema",
  "query_local_facts",
  "get_source_evidence",
] as const;

export function selectAgentResponseTools(
  tools: readonly AgentResponseToolDefinition[],
  request: AgentRuntimeRequest,
  requiredEvidencePlan: RequiredEvidencePlan,
) {
  const selected = new Set<AskSiargaoAgentToolName>(memoryTools);
  const latestUserTurn =
    request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  const placeIntent = interpretPlaceIntent(request.messages);

  if (placeIntent) {
    addTools(selected, placesTools);
    if (
      placeIntent.category === "bar" ||
      placeIntent.category === "service" ||
      placeIntent.liveNeeds.some((need) => need === "open_now" || need === "hours")
    ) {
      selected.add("research_web");
    }
  }
  if (conditionIntent(latestUserTurn)) {
    addTools(selected, conditionTools);
  }
  if (surfIntent(latestUserTurn)) {
    addTools(selected, conditionTools);
    selected.add("rank_surf_spots_nearby");
    selected.add("search_local_guide");
  }
  if (itineraryIntent(latestUserTurn)) {
    selected.add("plan_local_itinerary");
    selected.add("search_local_guide");
    selected.add("search_places");
    selected.add("get_place_details");
    selected.add("get_weather_forecast");
    selected.add("get_condition_judgment");
  }
  if (nightlifeIntent(latestUserTurn)) {
    selected.add("search_nightlife_events");
    selected.add("research_web");
    addTools(selected, placesTools);
  }
  if (webResearchIntent(latestUserTurn)) {
    selected.add("research_web");
  }
  if (localFactsIntent(latestUserTurn)) {
    addTools(selected, localFactsTools);
  }
  if (sourcePolicyIntent(latestUserTurn)) {
    selected.add("describe_source_policy");
    selected.add("get_source_evidence");
  }

  for (const requiredCall of requiredEvidencePlan.requiredToolCalls) {
    selected.add(requiredCall.name);
    addPairedTools(selected, requiredCall.name);
  }

  if (selected.size === memoryTools.length) {
    selected.add("search_local_guide");
    selected.add("plan_local_itinerary");
  }

  return tools.filter((tool) => tool.type === "file_search" || selected.has(tool.name));
}

function addPairedTools(selected: Set<AskSiargaoAgentToolName>, name: AskSiargaoAgentToolName) {
  if (name === "search_places") {
    selected.add("get_place_details");
    selected.add("search_local_guide");
  } else if (name === "get_weather_forecast") {
    selected.add("get_condition_judgment");
  } else if (name === "research_web") {
    selected.add("search_places");
  } else if (name === "search_nightlife_events") {
    selected.add("search_places");
  }
}

function addTools(
  selected: Set<AskSiargaoAgentToolName>,
  tools: readonly AskSiargaoAgentToolName[],
) {
  for (const tool of tools) {
    selected.add(tool);
  }
}

function conditionIntent(content: string) {
  return /\b(?:weather|rain|storm|wind|forecast|conditions?|safe|safety|swim|swimming|boat|ferry|road|flood|sunset)\b/iu.test(
    content,
  );
}

function surfIntent(content: string) {
  return /\b(?:surf|surfing|waves?|swell|tides?|currents?|reef)\b/iu.test(content);
}

function itineraryIntent(content: string) {
  return /\b(?:itinerary|half[-\s]?day|full[-\s]?day|day\s+plan|food\s+crawl|plan\s+(?:my|our|a|the)\s+(?:day|afternoon|evening)|route\s+for)\b/iu.test(
    content,
  );
}

function nightlifeIntent(content: string) {
  return /\b(?:nightlife|party|parties|bar[-\s]?hop|dj|live\s+music|events?|tonight)\b/iu.test(
    content,
  );
}

function webResearchIntent(content: string) {
  return /\b(?:current|currently|latest|today|tonight|tomorrow|open\s+now|availability|available|book(?:ing)?|prices?|rates?|schedule|rent|rental|hire|disruption|advisory)\b/iu.test(
    content,
  );
}

function localFactsIntent(content: string) {
  return /\b(?:database|local\s+facts?|accommodation|hotel|hostel|resort|compare|evidence|audit)\b/iu.test(
    content,
  );
}

function sourcePolicyIntent(content: string) {
  return /\b(?:source\s+policy|source\s+profile|retention|field\s+mask|what\s+sources?|how\s+do\s+you\s+know)\b/iu.test(
    content,
  );
}
