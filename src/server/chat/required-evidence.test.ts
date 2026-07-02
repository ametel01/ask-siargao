import { describe, expect, test } from "bun:test";

import type { AgentToolCallAudit, AgentToolResult } from "@/server/chat/agent-runtime";
import {
  buildRequiredEvidencePlan,
  finalPayloadSatisfiesRequiredEvidence,
  missingRequiredEvidenceToolCalls,
  type RequiredEvidencePlan,
  requiredEvidencePlaceCardIds,
} from "@/server/chat/required-evidence";

describe("required evidence planning", () => {
  test("does not manufacture required calls from deterministic request context", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence",
      messages: [{ role: "user", content: "best dinner in General Luna tonight" }],
      deterministicSignals: {
        context: {
          locationLabel: "General Luna",
          tripContext: { activeGoal: "food" },
        },
      },
    });

    expect(plan.requiredToolCalls).toEqual([]);
    expect(missingRequiredEvidenceToolCalls(plan, [])).toEqual([]);
  });

  test("plans vehicle rental evidence as Places first with web fallback after terminal failure", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence_vehicle_rental",
      messages: [{ role: "user", content: "Where can I rent a scooter in General Luna?" }],
    });

    expect(plan.requiredToolCalls.map((call) => [call.name, call.purpose])).toEqual([
      ["search_places", "local_service_places_lookup"],
      ["research_web", "local_service_web_fallback"],
    ]);
    expect(missingRequiredEvidenceToolCalls(plan, []).map((call) => call.name)).toEqual([
      "search_places",
    ]);
    expect(
      missingRequiredEvidenceToolCalls(plan, [
        toolCall({
          name: "search_places",
          status: "error",
          sources: [
            {
              label: "provider_unavailable",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "low",
              checked: [],
              notChecked: ["live Places lookup"],
            },
          ],
        }),
      ]).map((call) => call.name),
    ).toEqual(["research_web"]);
  });

  test("skips vehicle rental web fallback when Places evidence satisfies the policy", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence_vehicle_rental",
      messages: [{ role: "user", content: "Where can I rent a motorbike near Cloud 9?" }],
    });

    expect(
      missingRequiredEvidenceToolCalls(plan, [
        toolCall({
          name: "search_places",
          sources: [
            {
              label: "live_checked",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "medium",
              checked: ["place identity", "map link"],
              notChecked: ["deposit terms"],
            },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  test("enforces explicit research-before-Places contracts when supplied directly", () => {
    const plan = researchBackedPlacePlan();

    expect(plan.requiredToolCalls.map((call) => call.name)).toEqual([
      "research_web",
      "search_places",
    ]);
    expect(missingRequiredEvidenceToolCalls(plan, [])).toEqual([plan.requiredToolCalls[0]]);
    expect(missingRequiredEvidenceToolCalls(plan, [successfulResearchToolCall()])).toEqual([
      plan.requiredToolCalls[1],
    ]);
  });

  test("treats insufficient web evidence as completed but not satisfying checked evidence", () => {
    const plan = currentResearchOnlyPlan();
    const toolCalls = [
      toolCall({
        name: "research_web",
        sources: [
          {
            label: "insufficient_web_evidence",
            sourceName: "Public web research",
            sourceProfileId: "source_web_research",
            confidence: "low",
            checked: [],
            notChecked: ["current ferry disruption evidence"],
          },
        ],
      }),
    ];

    expect(missingRequiredEvidenceToolCalls(plan, toolCalls)).toEqual([]);
  });

  test("does not fall back to broad Places when successful research selects no entities", () => {
    const plan = researchBackedPlacePlan();

    expect(
      missingRequiredEvidenceToolCalls(
        plan,
        [successfulResearchToolCall()],
        [researchToolResult({ entities: [] })],
      ),
    ).toEqual([]);
  });

  test("accepts only Places cards that match research-selected entities", () => {
    const plan = researchBackedPlacePlan();

    expect(
      requiredEvidencePlaceCardIds(plan, [
        researchToolResult({
          entities: [{ name: "Roots Siargao", kind: "place", needsPlacesEnrichment: true }],
        }),
        {
          name: "search_places",
          toolCallId: "call_places",
          status: "success",
          text: "Google Places returned selected and unrelated candidates.",
          sources: [
            {
              label: "live_checked",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "medium",
              checked: ["place details"],
              notChecked: [],
            },
          ],
          cards: [
            {
              id: "place_roots",
              kind: "place",
              title: "Roots Siargao",
              subtitle: "General Luna",
              fitReasons: [],
              caveats: [],
              sourceLabel: "Google Places - live checked",
            },
            {
              id: "place_random",
              kind: "place",
              title: "Random Bar",
              subtitle: "General Luna",
              fitReasons: [],
              caveats: [],
              sourceLabel: "Google Places - live checked",
            },
          ],
        },
      ]),
    ).toEqual(["place_roots"]);
  });

  test("requires successful research to be cited and reflected in the final answer", () => {
    const plan = currentResearchOnlyPlan();
    const researchResult = researchToolResult({
      entities: [{ name: "Roots Siargao", kind: "place", needsPlacesEnrichment: true }],
      findings: [
        {
          claim: "Roots Siargao is the strongest dinner candidate tonight.",
          answerRole: "primary",
        },
      ],
    });
    const toolCalls = [successfulResearchToolCall()];

    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "Use a covered dinner spot tonight.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        [researchResult],
      ),
    ).toBe(false);
    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "Roots Siargao is the strongest dinner candidate tonight.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        [researchResult],
      ),
    ).toBe(true);
  });

  test("requires terminal research failures to be transparent and card-free", () => {
    const plan = currentResearchOnlyPlan();
    const toolCalls = [
      toolCall({
        name: "research_web",
        sources: [
          {
            label: "insufficient_web_evidence",
            sourceName: "Public web research",
            sourceProfileId: "source_web_research",
            confidence: "low",
            checked: [],
            notChecked: ["current dinner evidence"],
          },
        ],
      }),
    ];
    const toolResults = [
      {
        name: "research_web",
        toolCallId: "call_research",
        status: "success",
        text: "Public web research was insufficient.",
        data: { status: "insufficient" },
        sources: toolCalls[0]?.sources ?? [],
      } satisfies AgentToolResult,
    ];

    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "Rain looks rough, so stay somewhere covered.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        toolResults,
      ),
    ).toBe(false);
    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "I could not verify current public web evidence for dinner tonight.",
          usedToolCallIds: ["call_research"],
          displayCardIds: ["place_random"],
        }),
        toolCalls,
        toolResults,
      ),
    ).toBe(false);
    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "I could not verify current public web evidence for dinner tonight.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        toolResults,
      ),
    ).toBe(true);
  });

  test("requires provider-unavailable web research to stay transparent and card-free", () => {
    const plan = currentResearchOnlyPlan();
    const toolCalls = [
      toolCall({
        name: "research_web",
        status: "error",
        sources: [
          {
            label: "provider_unavailable",
            sourceName: "Public web research",
            sourceProfileId: "source_web_research",
            confidence: "low",
            checked: [],
            notChecked: ["current public web research"],
          },
        ],
      }),
    ];
    const toolResults = [
      {
        name: "research_web",
        toolCallId: "call_research",
        status: "error",
        text: "Public web research provider unavailable.",
        data: { status: "provider_unavailable" },
        sources: toolCalls[0]?.sources ?? [],
      } satisfies AgentToolResult,
    ];

    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "Use the highest-rated open place from Google Maps.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        toolResults,
      ),
    ).toBe(false);
    expect(
      finalPayloadSatisfiesRequiredEvidence(
        plan,
        finalPayload({
          answer: "I could not verify current public web evidence for dinner tonight.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        toolResults,
      ),
    ).toBe(true);
  });
});

function toolCall({
  name,
  status = "success",
  sources,
}: {
  name: string;
  status?: AgentToolCallAudit["status"];
  sources: AgentToolCallAudit["sources"];
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: {},
    status,
    durationMs: 1,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T00:00:00.001Z",
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

function successfulResearchToolCall() {
  return toolCall({
    name: "research_web",
    sources: [
      {
        label: "official_checked",
        sourceName: "Official dinner source",
        sourceProfileId: "source_web_official",
        confidence: "high",
        checked: ["current dinner hours"],
        notChecked: ["bookings"],
      },
    ],
  });
}

function researchToolResult({
  entities,
  findings = [],
}: {
  entities: readonly Record<string, unknown>[];
  findings?: readonly Record<string, unknown>[];
}): AgentToolResult {
  return {
    name: "research_web",
    toolCallId: "call_research",
    status: "success",
    text: "Public web research returned selected entities.",
    data: {
      status: "available",
      entities,
      findings,
    },
    sources: [
      {
        label: "official_checked",
        sourceName: "Official source",
        sourceProfileId: "source_web_official",
        confidence: "high",
        checked: ["current evidence"],
        notChecked: [],
      },
    ],
  };
}

function currentResearchOnlyPlan() {
  return {
    requiredToolCalls: [
      {
        name: "research_web",
        purpose: "current_public_web_research",
        arguments: {
          query: "what is the current dinner pop-up in General Luna tonight",
          intent: "recommendation",
          location: "General Luna",
          dateContext: "tonight",
          sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
          requiredFreshness: "same_day",
          maxSources: 6,
        },
        acceptedSourceLabels: [
          "official_checked",
          "directory_checked",
          "web_researched",
          "community_signal",
        ],
        terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
        runBefore: ["search_places"],
      },
    ],
  } satisfies RequiredEvidencePlan;
}

function researchBackedPlacePlan() {
  return {
    requiredToolCalls: [
      {
        name: "research_web",
        purpose: "current_public_web_research",
        arguments: {
          query: "what is the current dinner pop-up in General Luna tonight",
          intent: "recommendation",
          location: "General Luna",
          dateContext: "tonight",
          sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
          requiredFreshness: "same_day",
          maxSources: 6,
        },
        acceptedSourceLabels: [
          "official_checked",
          "directory_checked",
          "web_researched",
          "community_signal",
        ],
        terminalSourceLabels: ["insufficient_web_evidence", "provider_unavailable"],
        runBefore: ["search_places"],
      },
      {
        name: "search_places",
        purpose: "place_recommendation",
        arguments: {
          query: "research-selected dinner place details in General Luna Siargao",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 12_000,
          constraints: {
            included_type: "restaurant",
            open_now: true,
            page_size: 8,
          },
        },
        acceptedSourceLabels: ["live_checked", "fresh_cache"],
        terminalSourceLabels: ["provider_unavailable"],
        dependsOn: ["research_web"],
        requiresOpenNow: true,
      },
    ],
    allowedCardKinds: ["place"],
  } satisfies RequiredEvidencePlan;
}

function finalPayload({
  answer,
  displayCardIds = [],
  usedToolCallIds,
}: {
  answer: string;
  displayCardIds?: readonly string[];
  usedToolCallIds: readonly string[];
}) {
  return {
    answer,
    usedMemoryFiles: [],
    usedToolCallIds,
    displayCardIds,
    displayActionIds: [],
    displayItineraryIds: [],
    displayDecisionSummaryIds: [],
  };
}
