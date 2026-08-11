import { createAgentTurnResult } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { displayReadyStoredChatTurn } from "@/server/chat/public-turn-assembly";
import {
  inspectRealityCheckRequest,
  resolveRealityCheckLifecycle,
} from "@/server/chat/reality-check";

export const realityCheckEvaluationArtifactPath =
  "docs/evaluations/on-demand-reality-check-2026-08-03.json";

const productCases = [
  {
    id: "accommodation_before_booking",
    prompt: "Reality-check this hotel before we book.",
    recentUserContext: "We are considering Siargao Bleu Resort for our family stay.",
    expectedKind: "accommodation",
    evidenceContract: "named property identity plus governed area and traveler-fit evidence",
  },
  {
    id: "four_day_itinerary",
    prompt:
      "Is this four-day itinerary feasible? Day 1 Cloud 9, day 2 Pacifico, day 3 Dapa, then an 8 AM ferry on day 4.",
    expectedKind: "itinerary",
    evidenceContract:
      "submitted sequence, route estimates, constraints, and relevant current facts",
  },
  {
    id: "today_weather_and_tide",
    prompt: "Given today's weather and tide, should we still go to Cloud 9?",
    expectedKind: "immediate_plan",
    evidenceContract: "successful request-time condition evidence before a decisive verdict",
  },
  {
    id: "kids_without_scooter",
    prompt:
      "We have kids and no scooter. What is wrong with this four-day plan? Day 1 General Luna, then Pacifico for dinner before an 8 AM Dapa ferry.",
    expectedKind: "itinerary",
    evidenceContract: "traveler constraints plus transport and sequencing evidence",
  },
  {
    id: "surf_session_match",
    prompt:
      "I am an intermediate surfer near Cloud 9. Should I surf this morning? Reality-check the session.",
    expectedKind: "surf_session",
    evidenceContract: "skill, location, timing, condition judgment, and marine or tide evidence",
  },
  {
    id: "cancelled_island_tour",
    prompt: "Our island tour was cancelled. Give us a workable replacement.",
    expectedKind: "disruption_recovery",
    evidenceContract: "traveler-reported disruption plus request-time replacement evidence",
  },
] as const;

const checkedWeatherSource = {
  label: "weather_checked",
  sourceName: "Open-Meteo Weather API",
  checked: ["current rain and wind signal"],
  notChecked: [],
} satisfies AnswerSourceSummary;

const unavailableSource = {
  label: "provider_unavailable",
  sourceName: "Google Places API",
  checked: [],
  notChecked: ["property identity and current details"],
} satisfies AnswerSourceSummary;

const placesSource = {
  label: "live_checked",
  sourceName: "Google Places API",
  checked: ["place identity"],
  notChecked: [],
} satisfies AnswerSourceSummary;

export function buildRealityCheckEvaluationArtifact() {
  const scenarios = productCases.map((scenario, index) => {
    const recognition = inspectRealityCheckRequest({
      messages: [
        ...("recentUserContext" in scenario
          ? [{ role: "user", content: scenario.recentUserContext }]
          : []),
        { role: "user", content: scenario.prompt },
      ],
    }).recognition;
    const passed =
      recognition.explicit &&
      recognition.kind === scenario.expectedKind &&
      recognition.missingContext.length === 0;
    return {
      ordinal: index + 1,
      ...scenario,
      observedKind: recognition.kind ?? null,
      missingContext: recognition.missingContext,
      status: passed ? "pass" : "fail",
    };
  });

  const contractCases = [
    evaluateMissingInput(),
    evaluateProviderFailure(),
    evaluatePartialEvidence(),
    evaluateLegacyResponse(),
    evaluateMixedArtifactSelection(),
  ];

  return {
    schemaVersion: 1,
    generatedAt: "2026-08-03T00:00:00.000+08:00",
    executionMode: "on_demand",
    privacyBoundary:
      "The matrix contains synthetic prompts and public fixture metadata only; it contains no user identifiers, coordinates, raw provider payloads, or tool arguments.",
    productScenarios: {
      caseCount: scenarios.length,
      allCasesPass: scenarios.every((scenario) => scenario.status === "pass"),
      cases: scenarios,
    },
    failClosedContracts: {
      caseCount: contractCases.length,
      allCasesPass: contractCases.every((contractCase) => contractCase.status === "pass"),
      cases: contractCases,
    },
    semanticOrdering: {
      status: "covered",
      contract:
        "Condition, route, and governed local-fact prerequisites complete before dependent Places, ranking, or replacement work starts.",
      regressionEvidence: [
        "src/server/chat/ask-siargao-agent.test.ts",
        "src/server/chat/agent-tools.test.ts",
      ],
    },
    publicBoundary: {
      status: "covered",
      contract:
        "Only server-validated summaries and allowlisted successful cards or itineraries cross the public response and stored-history boundaries.",
      regressionEvidence: [
        "src/server/chat/agent-runtime.test.ts",
        "src/server/chat/public-turn-assembly.test.ts",
        "src/server/chat/chat-history-store.test.ts",
      ],
    },
  };
}

function evaluateMissingInput() {
  const recognition = inspectRealityCheckRequest({
    messages: [{ role: "user", content: "Reality-check this hotel before I book." }],
  }).recognition;
  const passed =
    recognition.explicit &&
    recognition.kind === "accommodation" &&
    recognition.missingContext.includes("subject");
  return {
    id: "missing_input_clarification",
    expected: "request the missing property subject without inventing a verdict",
    observed: recognition.missingContext,
    status: passed ? "pass" : "fail",
  };
}

function evaluateProviderFailure() {
  const lifecycle = resolveRealityCheckLifecycle({
    requestId: "evaluation_provider_failure",
    recognition: {
      explicit: true,
      kind: "accommodation",
      missingContext: [],
    },
    finalPayload: {
      usedToolCallIds: ["call_places_failed"],
      displayCardIds: [],
      displayItineraryIds: [],
      realityCheck: {
        kind: "accommodation",
        verdict: "keep",
        subject: "Example Hotel",
        bestAction: "Keep the booking.",
        basis: "The property is a good fit.",
        evidenceToolCallIds: ["call_places_failed"],
      },
    },
    toolCalls: [
      {
        toolCallId: "call_places_failed",
        name: "search_places",
        status: "error",
        sources: [unavailableSource],
      },
    ],
    toolResults: [
      {
        toolCallId: "call_places_failed",
        name: "search_places",
        status: "error",
        sources: [unavailableSource],
      },
    ],
  });
  const passed =
    lifecycle.state === "resolved" &&
    lifecycle.repair?.reason === "insufficient_source_evidence" &&
    lifecycle.validated?.proposal.verdict === "needs_confirmation";
  return {
    id: "provider_failure_downgrade",
    expected: "reject the positive verdict and downgrade to needs_confirmation",
    observed: lifecycle.repair
      ? `${lifecycle.repair.reason}:${lifecycle.validated?.proposal.verdict ?? "no_fallback"}`
      : lifecycle.validated?.proposal.verdict,
    status: passed ? "pass" : "fail",
  };
}

function evaluatePartialEvidence() {
  const lifecycle = resolveRealityCheckLifecycle({
    requestId: "evaluation_partial_evidence",
    recognition: {
      explicit: true,
      kind: "immediate_plan",
      missingContext: [],
    },
    finalPayload: {
      usedToolCallIds: ["call_condition_ok", "call_places_failed"],
      displayCardIds: [],
      displayItineraryIds: [],
      realityCheck: {
        kind: "immediate_plan",
        verdict: "change",
        subject: "Cloud 9 visit today",
        bestAction: "Move the visit later and keep an indoor fallback.",
        basis: "The checked rain signal conflicts with the current timing.",
        evidenceToolCallIds: ["call_condition_ok", "call_places_failed"],
      },
    },
    toolCalls: [
      {
        toolCallId: "call_condition_ok",
        name: "get_condition_judgment",
        status: "success",
        sources: [checkedWeatherSource],
      },
      {
        toolCallId: "call_places_failed",
        name: "search_places",
        status: "error",
        sources: [unavailableSource],
      },
    ],
    toolResults: [
      {
        toolCallId: "call_condition_ok",
        name: "get_condition_judgment",
        status: "success",
        sources: [checkedWeatherSource],
      },
      {
        toolCallId: "call_places_failed",
        name: "search_places",
        status: "error",
        sources: [unavailableSource],
      },
    ],
  });
  const passed = lifecycle.state === "resolved" && lifecycle.validated?.sourceState === "partial";
  return {
    id: "partial_evidence_label",
    expected: "retain the supported decision and label its evidence partial",
    observed: lifecycle.validated?.sourceState ?? lifecycle.repair?.reason ?? lifecycle.state,
    status: passed ? "pass" : "fail",
  };
}

function evaluateLegacyResponse() {
  const display = displayReadyStoredChatTurn({
    content: "Keep the plan flexible.",
    sources: [checkedWeatherSource],
    cards: [],
    actions: [],
    itineraries: [],
    decisionSummaries: [
      {
        id: "decision_legacy",
        bestAction: "Keep the plan flexible.",
        basis: "Rain remains possible.",
        sources: [checkedWeatherSource],
      },
    ],
  });
  const summary = display.decisionSummaries[0];
  const passed = Boolean(summary) && summary?.kind === undefined && summary?.verdict === undefined;
  return {
    id: "legacy_summary_compatibility",
    expected: "hydrate a legacy decision summary without inventing kind or verdict",
    observed: summary
      ? { id: summary.id, hasKind: Boolean(summary.kind), hasVerdict: Boolean(summary.verdict) }
      : null,
    status: passed ? "pass" : "fail",
  };
}

function evaluateMixedArtifactSelection() {
  const allowedCard = {
    id: "card_allowed_hotel",
    kind: "place" as const,
    title: "Allowed Hotel",
    fitReasons: ["Matches the named property"],
    caveats: [],
    sourceLabel: "live_checked",
    sources: [placesSource],
  };
  const unrelatedCard = {
    ...allowedCard,
    id: "card_unrelated_hotel",
    title: "Unrelated Hotel",
  };
  const turn = createAgentTurnResult({
    message: "Use the named hotel only.",
    requestId: "evaluation_mixed_artifacts",
    model: "deterministic-evaluation",
    allowedCardIds: [allowedCard.id],
    finalPayload: {
      answer: "Use the named hotel only.",
      usedMemoryFiles: [],
      usedToolCallIds: ["call_places"],
      displayCardIds: [allowedCard.id, unrelatedCard.id],
      displayActionIds: [],
      displayItineraryIds: [],
      displayDecisionSummaryIds: [],
    },
    toolResults: [
      {
        toolCallId: "call_places",
        name: "search_places",
        status: "success",
        sources: [placesSource],
        cards: [allowedCard, unrelatedCard],
      },
    ],
  });
  const selectedIds = turn.cards?.map((card) => card.id) ?? [];
  return {
    id: "mixed_artifact_selection",
    expected: "keep the allowlisted card and suppress the unrelated explicit selection",
    observed: selectedIds,
    status: selectedIds.length === 1 && selectedIds[0] === allowedCard.id ? "pass" : "fail",
  };
}
