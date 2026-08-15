import { describe, expect, test } from "bun:test";

import {
  type AgentToolCallAudit,
  type AgentToolResult,
  createAgentTurnResult,
} from "@/server/chat/agent-runtime";
import * as evidenceLifecycleModule from "@/server/chat/required-evidence";
import { buildEvidenceLifecycle } from "@/server/chat/required-evidence";

describe("evidence lifecycle", () => {
  test("keeps planning, execution, repair, and admission behind one public seam", () => {
    expect(Object.keys(evidenceLifecycleModule)).toEqual(["buildEvidenceLifecycle"]);
  });

  test("does not manufacture required calls from deterministic request context", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_required_evidence",
      messages: [{ role: "user", content: "best dinner in General Luna tonight" }],
      deterministicSignals: {
        context: {
          locationLabel: "General Luna",
          tripContext: { activeGoal: "food" },
        },
      },
    });

    expect(lifecycle.requiredToolNames).toEqual([]);
    expect(lifecycle.repairTools({ toolCalls: [], toolResults: [] })).toBeUndefined();
  });

  test("plans accommodation evidence and keeps exact-property admission in the lifecycle", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_accommodation_reality_check",
      messages: [
        {
          role: "user",
          content:
            "Reality-check Bravo Beach Resort in General Luna before I book. We have kids, no scooter, and need quiet sleep.",
        },
      ],
    });

    expect(lifecycle.requiredToolNames).toEqual(["search_places", "query_local_facts"]);
    const repair = lifecycle.repairTools({ toolCalls: [], toolResults: [] });
    expect(repair).toMatchObject({
      type: "tool",
      payloadKey: "automaticRequiredEvidence",
      payloadMode: "all",
      functionCalls: [
        {
          name: "search_places",
          arguments: {
            query: "Bravo Beach Resort accommodation Siargao",
            constraints: { included_type: "lodging", open_now: null, page_size: 5 },
          },
        },
        {
          name: "query_local_facts",
          arguments: {
            entityTypes: ["area", "route"],
            area: "general luna",
            text: "General Luna",
            limit: 5,
          },
        },
      ],
    });

    const finalized = lifecycle.finalize({
      finalPayload: finalPayload({
        answer: "Bravo Beach Resort matches the checked place identity.",
        usedToolCallIds: ["call_places"],
        displayCardIds: ["place_bravo", "place_unrelated"],
      }),
      toolCalls: [],
      toolResults: accommodationMixedPlaceResults(),
    });

    expect(finalized.finalPayload?.displayCardIds).toEqual(["place_bravo"]);
    expect(finalized.allowedCardIds).toEqual(["place_bravo"]);
  });

  test("does not create accommodation evidence while the property is missing", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_missing_accommodation",
      messages: [{ role: "user", content: "Reality-check this hotel before I book." }],
    });

    expect(lifecycle.requiredToolNames).toEqual([]);
    expect(lifecycle.repairTools({ toolCalls: [], toolResults: [] })).toBeUndefined();
  });

  test("plans vehicle Places evidence before its terminal web fallback", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_required_evidence_vehicle_rental",
      messages: [{ role: "user", content: "Where can I rent a scooter in General Luna?" }],
    });

    expect(lifecycle.requiredToolNames).toEqual(["search_places", "research_web"]);
    const firstRepair = lifecycle.repairTools({ toolCalls: [], toolResults: [] });
    expect(firstRepair).toMatchObject({
      type: "tool",
      functionCalls: [{ name: "search_places" }],
    });
    const placesCall = firstRepair?.type === "tool" ? firstRepair.functionCalls[0] : undefined;
    expect(placesCall?.arguments).toMatchObject({
      query: "scooter rental in General Luna Siargao",
      constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
    });

    const fallbackRepair = lifecycle.repairTools({
      toolCalls: [
        toolCall({
          name: "search_places",
          arguments: placesCall?.arguments,
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
      ],
      toolResults: [],
    });
    expect(fallbackRepair).toMatchObject({
      type: "tool",
      functionCalls: [{ name: "research_web" }],
    });
  });

  test("executes terminal fallback only after Places evidence is unavailable", async () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_required_evidence_vehicle_rental_batch",
      messages: [{ role: "user", content: "Where can I rent a scooter in General Luna?" }],
    });
    const executedToolNames: string[] = [];

    const { outputs } = await lifecycle.execute({
      functionCalls: [
        { callId: "call_web", name: "research_web", arguments: {} },
        { callId: "call_places", name: "search_places", arguments: {} },
      ],
      toolResults: [],
      execute: async (functionCall) => {
        executedToolNames.push(functionCall.name);
        return {
          functionCall,
          result: {
            name: functionCall.name,
            toolCallId: functionCall.callId,
            status: "success" as const,
            text: "Google Places returned checked scooter rental evidence.",
            sources: [
              {
                label: "live_checked" as const,
                sourceName: "Google Places",
                checked: ["place identity"],
                notChecked: ["deposit terms"],
              },
            ],
          } as AgentToolResult,
        };
      },
      resultOf: (output) => output.result,
      skip: (functionCall, result) => ({ functionCall, result }),
    });

    expect(executedToolNames).toEqual(["search_places"]);
    expect(outputs.map((output) => [output.functionCall.name, output.result.data])).toEqual([
      ["search_places", undefined],
      ["research_web", { status: "not_applicable" }],
    ]);
  });

  test("completes current web evidence before enriching research-selected Places", async () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_required_evidence_deep_seam",
      messages: [
        { role: "user", content: "What is the current dinner pop-up in General Luna tonight?" },
      ],
    });
    const events: string[] = [];
    let researchCompleted = false;
    let completeResearch: (() => void) | undefined;
    const pendingResearch = new Promise<void>((resolve) => {
      completeResearch = resolve;
    });

    const execution = lifecycle.execute({
      functionCalls: [
        {
          callId: "call_places",
          name: "search_places",
          arguments: { query: "broad dinner search" },
        },
        {
          callId: "call_research",
          name: "research_web",
          arguments: { query: "current dinner research" },
        },
      ],
      toolResults: [],
      execute: async (functionCall) => {
        events.push(`${functionCall.name}:start`);
        if (functionCall.name === "research_web") {
          await pendingResearch;
          researchCompleted = true;
          events.push("research_web:end");
          return {
            functionCall,
            result: researchToolResult({
              entities: [{ name: "Roots Siargao", kind: "place", needsPlacesEnrichment: true }],
            }),
          };
        }

        expect(researchCompleted).toBe(true);
        expect(functionCall.arguments.query).toContain("Roots Siargao");
        events.push("search_places:end");
        return {
          functionCall,
          result: {
            name: "search_places",
            toolCallId: functionCall.callId,
            status: "success" as const,
            text: "Google Places returned the research-selected place.",
            sources: [
              {
                label: "live_checked" as const,
                sourceName: "Google Places",
                checked: ["place details", "open now signal"],
                notChecked: [],
              },
            ],
            cards: [
              {
                id: "place_roots",
                kind: "place" as const,
                title: "Roots Siargao",
                fitReasons: [],
                caveats: [],
                sourceLabel: "Google Places - live checked",
              },
            ],
          },
        };
      },
      resultOf: (output) => output.result,
      skip: (functionCall, result) => ({ functionCall, result }),
    });

    await Promise.resolve();
    expect(events).toEqual(["research_web:start"]);
    completeResearch?.();
    const { outputs } = await execution;

    expect(events).toEqual([
      "research_web:start",
      "research_web:end",
      "search_places:start",
      "search_places:end",
    ]);
    expect(outputs.map((output) => output.functionCall.name)).toEqual([
      "research_web",
      "search_places",
    ]);
  });

  test("terminates dependent Places execution when research selects no entities", async () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_required_evidence_no_entities",
      messages: [
        { role: "user", content: "What is the current dinner pop-up in General Luna tonight?" },
      ],
    });
    const executedToolNames: string[] = [];

    const { outputs } = await lifecycle.execute({
      functionCalls: [
        { callId: "call_research", name: "research_web", arguments: {} },
        { callId: "call_places", name: "search_places", arguments: {} },
      ],
      toolResults: [],
      execute: async (functionCall) => {
        executedToolNames.push(functionCall.name);
        return {
          functionCall,
          result: researchToolResult({ entities: [] }),
        };
      },
      resultOf: (output) => output.result,
      skip: (functionCall, result) => ({ functionCall, result }),
      now: () => new Date("2026-08-12T01:00:00.000Z"),
    });

    expect(executedToolNames).toEqual(["research_web"]);
    expect(outputs[1]).toMatchObject({
      functionCall: { callId: "call_places", name: "search_places" },
      result: {
        status: "error",
        errorCode: "provider_unavailable",
        sources: [
          {
            label: "provider_unavailable",
            sourceName: "Google Places research-selected entity enrichment",
          },
        ],
      },
    });
  });

  test("accepts a final answer that cites completed research and matching Places evidence", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_success",
      messages: [
        { role: "user", content: "What is the current dinner pop-up in General Luna tonight?" },
      ],
    });
    const researchArguments = {
      query: "what is the current dinner pop-up in General Luna tonight",
      intent: "recommendation",
      location: "General Luna",
      dateContext: "tonight",
      sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
      requiredFreshness: "same_day",
      maxSources: 6,
    };
    const placesArguments = {
      query: "research-selected dinner place details in General Luna Siargao",
      center: { latitude: 9.8006, longitude: 126.1586 },
      radius_meters: 12_000,
      constraints: { included_type: "restaurant", open_now: true, page_size: 8 },
    };
    const toolCalls = [
      {
        ...toolCall({
          name: "research_web",
          arguments: researchArguments,
          sources: [
            {
              label: "official_checked",
              sourceName: "Official dinner source",
              checked: ["current dinner hours"],
              notChecked: ["bookings"],
            },
          ],
        }),
        toolCallId: "call_research",
      },
      {
        ...toolCall({
          name: "search_places",
          arguments: placesArguments,
          sources: [
            {
              label: "live_checked",
              sourceName: "Google Places",
              checked: ["place details", "open now signal"],
              notChecked: ["table availability"],
            },
          ],
        }),
        toolCallId: "call_places",
      },
    ];
    const toolResults = [
      researchToolResult({
        entities: [{ name: "Roots Siargao", kind: "place", needsPlacesEnrichment: true }],
        findings: [
          {
            claim: "Roots Siargao is the strongest dinner candidate tonight.",
            answerRole: "primary",
          },
        ],
      }),
      {
        name: "search_places" as const,
        toolCallId: "call_places",
        status: "success" as const,
        text: "Google Places returned Roots Siargao.",
        sources: [toolCalls[1]?.sources[0]],
        cards: [
          {
            id: "place_roots",
            kind: "place" as const,
            title: "Roots Siargao",
            fitReasons: [],
            caveats: [],
            sourceLabel: "Google Places - live checked",
          },
        ],
      },
    ];

    const finalized = lifecycle.finalize({
      finalPayload: finalPayload({
        answer: "Roots Siargao is the strongest dinner candidate tonight.",
        usedToolCallIds: ["call_research", "call_places"],
        displayCardIds: ["place_roots"],
      }),
      toolCalls,
      toolResults,
    });

    expect(finalized.satisfiesRequiredEvidence).toBe(true);
    expect(finalized.allowedCardIds).toEqual(["place_roots"]);
  });

  test("keeps final evidence selection and card admission on the lifecycle seam", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_automatic_cards",
      messages: [
        {
          role: "user",
          content: "Reality-check Bravo Beach Resort in General Luna before I book.",
        },
      ],
    });
    const finalized = lifecycle.finalize({
      finalPayload: finalPayload({
        answer: "Bravo Beach Resort is the checked match; ignore the unrelated result.",
        usedToolCallIds: ["call_places"],
        displayCardIds: ["place_bravo", "place_unrelated"],
      }),
      toolCalls: [],
      toolResults: accommodationMixedPlaceResults(),
    });

    expect(finalized.finalPayload?.displayCardIds).toEqual(["place_bravo"]);
  });

  test("gates automatic card selection when the final payload omits card ids", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_automatic_cards",
      messages: [
        {
          role: "user",
          content: "Reality-check Bravo Beach Resort in General Luna before I book.",
        },
      ],
    });
    const toolResults = accommodationMixedPlaceResults();
    const finalized = lifecycle.finalize({
      finalPayload: undefined,
      toolCalls: [],
      toolResults,
    });
    const turn = createAgentTurnResult({
      message: "Bravo Beach Resort is the checked match; ignore the unrelated result.",
      requestId: "request_evidence_lifecycle_automatic_cards",
      model: "gpt-test",
      toolResults,
      allowedCardKinds: finalized.allowedCardKinds,
      allowedCardIds: finalized.allowedCardIds,
      artifactSelectionMode: "compatibility",
    });

    expect(turn.cards?.map((card) => card.id)).toEqual(["place_bravo"]);
  });

  test("requests one final retry when a required provider failure is overclaimed", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_final_retry",
      messages: [
        { role: "user", content: "What is the current dinner pop-up in General Luna tonight?" },
      ],
    });
    const unavailableSource = {
      label: "provider_unavailable" as const,
      sourceName: "Public web research",
      checked: [],
      notChecked: ["current dinner evidence"],
    };
    const toolCalls = [
      {
        ...toolCall({
          name: "research_web",
          status: "error",
          arguments: {
            query: "what is the current dinner pop-up in General Luna tonight",
            intent: "recommendation",
            location: "General Luna",
            dateContext: "tonight",
            sourceTypes: ["maps", "official", "local_directory", "guide", "social"],
            requiredFreshness: "same_day",
            maxSources: 6,
          },
          sources: [unavailableSource],
        }),
        toolCallId: "call_research",
      },
    ];
    const toolResults = [
      {
        name: "research_web" as const,
        toolCallId: "call_research",
        status: "error" as const,
        errorCode: "provider_unavailable",
        text: "Public web research was unavailable.",
        data: { status: "provider_unavailable" },
        sources: [unavailableSource],
      },
      {
        name: "search_places" as const,
        toolCallId: "call_places",
        status: "error" as const,
        errorCode: "provider_unavailable",
        text: "Places enrichment was skipped after terminal research evidence.",
        sources: [
          {
            label: "provider_unavailable" as const,
            sourceName: "Google Places research-selected entity enrichment",
            checked: [],
            notChecked: ["research-selected place details"],
          },
        ],
      },
    ];

    expect(
      lifecycle.repairFinalPayload({
        finalPayload: finalPayload({
          answer: "Use the highest-rated open place from Google Maps.",
          usedToolCallIds: ["call_research"],
        }),
        toolCalls,
        toolResults,
      }),
    ).toMatchObject({
      type: "retry",
      payloadKey: "validationRepairRequiredEvidence",
    });
  });
});

function accommodationMixedPlaceResults(): AgentToolResult[] {
  return [
    {
      name: "search_places",
      toolCallId: "call_places",
      status: "success",
      text: "Google Places returned the named stay and an unrelated result.",
      sources: [
        {
          label: "live_checked",
          sourceName: "Google Places",
          checked: ["place identity"],
          notChecked: ["room condition"],
        },
      ],
      cards: [
        {
          id: "place_bravo",
          kind: "place",
          title: "Bravo Beach Resort",
          fitReasons: [],
          caveats: [],
          sourceLabel: "Google Places - live checked",
        },
        {
          id: "place_unrelated",
          kind: "place",
          title: "Unrelated Resort",
          fitReasons: [],
          caveats: [],
          sourceLabel: "Google Places - live checked",
        },
      ],
    },
  ];
}

function toolCall({
  name,
  arguments: toolArguments = {},
  status = "success",
  sources,
}: {
  name: string;
  arguments?: AgentToolCallAudit["arguments"];
  status?: AgentToolCallAudit["status"];
  sources: AgentToolCallAudit["sources"];
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: toolArguments,
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
