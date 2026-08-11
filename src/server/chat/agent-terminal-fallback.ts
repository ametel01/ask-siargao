import {
  type AgentFinalPayload,
  type AgentRuntimeRequest,
  type AgentToolCallAudit,
  type AgentToolResult,
  agentItineraryArtifactId,
  type DecisionSummary,
  type ItineraryPlan,
  type RecommendationCard,
} from "@/server/chat/agent-runtime";

export type AgentTerminalFallback = {
  completionStatus: "completed_with_limits";
  terminationReason:
    | "model_response_budget_exhausted"
    | "model_response_invalid"
    | "model_response_unavailable";
  message: string;
  finalPayload: AgentFinalPayload;
  decisionSummaries: readonly DecisionSummary[];
};

export function buildAgentTerminalFallback(input: {
  request: AgentRuntimeRequest;
  toolCalls: readonly AgentToolCallAudit[];
  toolResults: readonly AgentToolResult[];
  terminationReason?: AgentTerminalFallback["terminationReason"];
}): AgentTerminalFallback {
  const evidenceResults = input.toolResults.filter(isUsableTerminalEvidence);
  const usedToolCallIds = uniqueText(
    evidenceResults.flatMap((result) => (result.toolCallId ? [result.toolCallId] : [])),
  );
  const decisionSummaries = dedupeById(
    evidenceResults.flatMap((result) => result.decisionSummaries ?? []),
  );
  const itineraries = dedupeItineraries(
    evidenceResults.flatMap((result) => result.itineraries ?? []),
  );
  const cards = dedupeById(evidenceResults.flatMap((result) => result.cards ?? [])).slice(0, 3);
  const message = renderTerminalFallbackMessage({
    content: latestUserContent(input.request),
    decisionSummary: decisionSummaries.at(-1),
    itinerary: itineraries.at(-1),
    cards,
    evidenceResults,
  });

  return {
    completionStatus: "completed_with_limits",
    terminationReason: input.terminationReason ?? "model_response_budget_exhausted",
    message,
    finalPayload: {
      answer: message,
      usedMemoryFiles: [],
      usedToolCallIds,
      displayCardIds: cards.map((card) => card.id),
      displayActionIds: [],
      displayItineraryIds: itineraries.map(agentItineraryArtifactId),
      displayDecisionSummaryIds: decisionSummaries.map((summary) => summary.id),
    },
    decisionSummaries,
  };
}

function renderTerminalFallbackMessage(input: {
  content: string;
  decisionSummary?: DecisionSummary;
  itinerary?: ItineraryPlan;
  cards: readonly RecommendationCard[];
  evidenceResults: readonly AgentToolResult[];
}) {
  const sections: string[] = [];
  if (input.decisionSummary) {
    sections.push(input.decisionSummary.bestAction, `Why: ${input.decisionSummary.basis}`);
    if (input.decisionSummary.fallback) {
      sections.push(`Fallback: ${input.decisionSummary.fallback}`);
    }
    if (input.decisionSummary.avoid) {
      sections.push(`Avoid: ${input.decisionSummary.avoid}`);
    }
  }

  if (input.itinerary) {
    const stops = input.itinerary.stops
      .slice(0, 4)
      .map((stop) => `${stop.sequence}. ${stop.title} — ${stop.rationale}`)
      .join("\n");
    sections.push(`**${input.itinerary.title}**\n${stops}`);
    const fallbackStop = input.itinerary.fallbackStops.at(0);
    if (fallbackStop) {
      sections.push(`Backup stop: ${fallbackStop.title} — ${fallbackStop.rationale}`);
    }
  }

  if (input.cards.length > 0) {
    sections.push(
      input.cards
        .map(
          (card) =>
            `- **${card.title}**: ${card.fitReasons[0] ?? card.subtitle ?? "Checked option."}`,
        )
        .join("\n"),
    );
  }

  if (sections.length > 0) {
    return sections.join("\n\n");
  }

  const successfulText = input.evidenceResults.find(
    (result) => result.status === "success" && result.text.trim().length > 0,
  )?.text;
  if (successfulText) {
    return `${successfulText}\n\nTreat this as a limited answer and confirm any missing current detail locally before committing.`;
  }

  if (isVehicleRentalLookup(input.content)) {
    return "I couldn't verify current scooter rental options, so I won't invent a shop. Ask your accommodation for a nearby established rental desk, compare the written daily rate and deposit terms, and inspect the helmet, brakes, lights, tires, and fuel level before accepting a scooter.";
  }
  if (isConditionRequest(input.content)) {
    return "I couldn't verify the current conditions, so keep today's plan close, flexible, and easy to abandon. Use a covered stop as your fallback, avoid exposed riding or water activities if rain, wind, visibility, or road conditions worsen, and confirm conditions locally before setting out.";
  }
  if (isCurrentEventRequest(input.content)) {
    return "I couldn't verify the current event schedule, so don't travel for a specific listing yet. Check the venue's official page or message the venue directly, then keep a nearby alternative ready.";
  }
  return "I couldn't verify enough current information to name a reliable option. Keep the plan flexible, confirm the key detail locally, and avoid committing time or money until that check succeeds.";
}

function isUsableTerminalEvidence(result: AgentToolResult) {
  return result.status === "success" || result.sources.length > 0;
}

function isVehicleRentalLookup(content: string) {
  return (
    /\b(?:rent|rental|rentals|hire|hiring)\b/iu.test(content) &&
    /\b(?:scooters?|motorbikes?|motor\s*bikes?)\b/iu.test(content)
  );
}

function isConditionRequest(content: string) {
  return /\b(?:weather|rain|storm|wind|forecast|conditions?|safe|safety|swim|surf|boat|road|flood|sunset|scooter|motorbike)\b/iu.test(
    content,
  );
}

function isCurrentEventRequest(content: string) {
  return /\b(?:tonight|event|party|nightlife|dj|live\s+music|trivia|pub\s+quiz)\b/iu.test(content);
}

function latestUserContent(request: AgentRuntimeRequest) {
  return request.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

function dedupeById<T extends { id: string }>(values: readonly T[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) {
      return false;
    }
    seen.add(value.id);
    return true;
  });
}

function dedupeItineraries(values: readonly ItineraryPlan[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = agentItineraryArtifactId(value);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values)];
}
