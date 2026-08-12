import { describe, expect, test } from "bun:test";

import type { AgentToolCallAudit, AgentToolResult } from "@/server/chat/agent-runtime";
import {
  buildEvidenceLifecycle,
  buildRequiredEvidencePlan,
  buildRequiredEvidencePolicy,
  buildRequiredEvidenceRepair,
  executeRequiredEvidence,
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

  test("requires exact-property Places evidence and area-fit facts for accommodation checks", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_accommodation_reality_check",
      messages: [
        {
          role: "user",
          content:
            "Reality-check Bravo Beach Resort in General Luna before I book. We have kids, no scooter, and need quiet sleep.",
        },
      ],
    });

    expect(plan.requiredToolCalls.map((call) => [call.name, call.purpose])).toEqual([
      ["search_places", "accommodation_property_identity"],
      ["query_local_facts", "accommodation_area_fit"],
    ]);
    expect(plan.requiredToolCalls[0]?.arguments).toMatchObject({
      query: "Bravo Beach Resort accommodation Siargao",
      constraints: { included_type: "lodging", open_now: null, page_size: 5 },
    });
    expect(plan.requiredToolCalls[1]?.arguments).toEqual({
      entityTypes: ["area", "route"],
      area: "general luna",
      text: "General Luna",
      limit: 5,
    });
    expect(plan.allowedPlaceNames).toEqual(["Bravo Beach Resort"]);
  });

  test("uses bounded recent context to resolve a referenced accommodation", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_referenced_accommodation",
      messages: [
        {
          role: "user",
          content: "We are considering Bravo Beach Resort in General Luna.",
        },
        { role: "assistant", content: "What would you like checked?" },
        { role: "user", content: "Reality-check this hotel before I book." },
      ],
    });

    expect(plan.requiredToolCalls[0]).toMatchObject({
      name: "search_places",
      purpose: "accommodation_property_identity",
      arguments: { query: "Bravo Beach Resort accommodation Siargao" },
    });
  });

  test("checks each compared stay area without manufacturing a property lookup", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_area_reality_check",
      messages: [
        {
          role: "user",
          content:
            "Should we stay in General Luna or Malinao with kids, no scooter, quiet sleep, and a budget?",
        },
      ],
    });

    expect(plan.requiredToolCalls.map((call) => [call.name, call.arguments.area])).toEqual([
      ["query_local_facts", "general luna"],
      ["query_local_facts", "malinao"],
    ]);
    expect(plan.allowedPlaceNames).toBeUndefined();
  });

  test("adds current web evidence only for explicit accommodation price or availability claims", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_current_accommodation",
      messages: [
        {
          role: "user",
          content:
            "Reality-check Bravo Beach Resort in General Luna and its current price and availability before I book.",
        },
      ],
    });

    expect(plan.requiredToolCalls.map((call) => call.purpose)).toEqual([
      "accommodation_property_identity",
      "accommodation_area_fit",
      "accommodation_current_public_claims",
    ]);
  });

  test("does not create accommodation evidence calls while the property is missing", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_missing_accommodation",
      messages: [{ role: "user", content: "Reality-check this hotel before I book." }],
    });

    expect(plan.requiredToolCalls).toEqual([]);
  });

  test("allows only the named accommodation card from mixed Places results", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_accommodation_cards",
      messages: [
        {
          role: "user",
          content: "Reality-check Bravo Beach Resort in General Luna before I book.",
        },
      ],
    });
    const placesSource = {
      label: "live_checked" as const,
      sourceName: "Google Places",
      checked: ["place identity"],
      notChecked: ["room condition"],
    };

    expect(
      requiredEvidencePlaceCardIds(plan, [
        {
          name: "search_places",
          toolCallId: "call_places",
          status: "success",
          text: "Two lodging results returned.",
          sources: [placesSource],
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
              title: "Unrelated Siargao Hotel",
              fitReasons: [],
              caveats: [],
              sourceLabel: "Google Places - live checked",
            },
          ],
        },
      ]),
    ).toEqual(["place_bravo"]);
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
          arguments: plan.requiredToolCalls[0]?.arguments ?? {},
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

  test("builds policy-owned required evidence repair calls and instruction", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence_vehicle_rental",
      messages: [{ role: "user", content: "Where can I rent a scooter in General Luna?" }],
    });

    expect(buildRequiredEvidenceRepair({ plan, toolCalls: [] })).toEqual({
      functionCalls: [
        {
          callId: "auto_required_evidence_search_places_1",
          name: "search_places",
          arguments: plan.requiredToolCalls[0]?.arguments,
        },
      ],
      instruction: expect.stringContaining("local_service_places_lookup"),
    });
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
          arguments: plan.requiredToolCalls[0]?.arguments ?? {},
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

  test("does not start a terminal-only web fallback when batched Places evidence succeeds", async () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence_vehicle_rental_batch",
      messages: [{ role: "user", content: "Where can I rent a scooter in General Luna?" }],
    });
    const executedToolNames: string[] = [];

    const { outputs } = await executeRequiredEvidence({
      plan,
      functionCalls: [
        { callId: "call_web", name: "research_web", arguments: {} },
        {
          callId: "call_places",
          name: "search_places",
          arguments: plan.requiredToolCalls[0]?.arguments ?? {},
        },
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

  test("plans current General Luna dinner evidence as research before Places enrichment", () => {
    const plan = buildRequiredEvidencePlan({
      requestId: "request_required_evidence_current_dinner",
      messages: [
        {
          role: "user",
          content: "What is the current dinner pop-up in General Luna tonight?",
        },
      ],
    });

    expect(plan.requiredToolCalls.map((call) => [call.name, call.purpose])).toEqual([
      ["research_web", "current_public_web_research"],
      ["search_places", "place_recommendation"],
    ]);
    expect(plan.requiredToolCalls[1]).toMatchObject({
      dependsOn: ["research_web"],
      requiresOpenNow: true,
    });
    expect(missingRequiredEvidenceToolCalls(plan, []).map((call) => call.name)).toEqual([
      "research_web",
    ]);
  });

  test("executes prerequisites before enriching research-selected places", async () => {
    const policy = buildRequiredEvidencePolicy({
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

    const execution = policy.execute({
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
                checked: ["place details"],
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
              {
                id: "place_random",
                kind: "place" as const,
                title: "Random Bar",
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
    const { admissibleEvidence, outputs } = await execution;

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
    expect(admissibleEvidence.allowedCardIds).toEqual(["place_roots"]);
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

  test("terminates dependent Places execution when research selects no entities", async () => {
    const plan = researchBackedPlacePlan();
    const executedToolNames: string[] = [];

    const { outputs } = await executeRequiredEvidence({
      plan,
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

  test("completes current surf evidence before dependent ranking through one lifecycle", async () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_surf_order",
      messages: [
        {
          role: "user",
          content:
            "Beginner surf in Pacifico tomorrow morning: does the tide make it worth booking?",
        },
      ],
    });
    const events: string[] = [];
    let completeCondition: (() => void) | undefined;
    const pendingCondition = new Promise<void>((resolve) => {
      completeCondition = resolve;
    });

    const execution = lifecycle.execute({
      functionCalls: [
        {
          callId: "call_ranking",
          name: "rank_surf_spots_nearby",
          arguments: { skill_level: "beginner" },
        },
        {
          callId: "call_condition",
          name: "get_condition_judgment",
          arguments: { activity: "surfing" },
        },
      ],
      toolResults: [],
      execute: async (functionCall) => {
        events.push(`${functionCall.name}:start`);
        if (functionCall.name === "get_condition_judgment") {
          await pendingCondition;
        }
        events.push(`${functionCall.name}:end`);
        const result: AgentToolResult = {
          name: functionCall.name,
          toolCallId: functionCall.callId,
          status: "success",
          text: `${functionCall.name} completed.`,
          sources: [],
        };
        return { functionCall, result };
      },
      resultOf: (output) => output.result,
      skip: (
        functionCall,
        result,
      ): { functionCall: typeof functionCall; result: AgentToolResult } => ({
        functionCall,
        result,
      }),
    });

    await Promise.resolve();
    expect(events).toEqual(["get_condition_judgment:start"]);
    completeCondition?.();
    const { outputs } = await execution;

    expect(events).toEqual([
      "get_condition_judgment:start",
      "get_condition_judgment:end",
      "rank_surf_spots_nearby:start",
      "rank_surf_spots_nearby:end",
    ]);
    expect(outputs.map((output) => output.functionCall.name)).toEqual([
      "get_condition_judgment",
      "rank_surf_spots_nearby",
    ]);
  });

  test("plans condition and required evidence repairs in lifecycle order", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_repairs",
      messages: [
        {
          role: "user",
          content: "Given the current rain, should we still get dinner at the General Luna pop-up?",
        },
      ],
    });

    const conditionRepair = lifecycle.repairTools({
      toolCalls: [],
      toolResults: [],
    });
    expect(conditionRepair).toMatchObject({
      type: "tool",
      stage: "condition-judgment",
      functionCalls: [{ name: "get_condition_judgment" }],
    });

    const conditionCall =
      conditionRepair?.type === "tool" ? conditionRepair.functionCalls[0] : null;
    expect(conditionCall).toBeDefined();
    const requiredEvidenceRepair = lifecycle.repairTools({
      toolCalls: [
        {
          id: "audit_condition",
          toolCallId: conditionCall?.callId,
          name: conditionCall?.name ?? "get_condition_judgment",
          arguments: conditionCall?.arguments ?? {},
          status: "success",
          durationMs: 1,
          startedAt: "2026-08-12T01:00:00.000Z",
          completedAt: "2026-08-12T01:00:00.001Z",
          sourceProfileIds: [],
          sources: [],
        },
      ],
      toolResults: [],
    });

    expect(requiredEvidenceRepair).toMatchObject({
      type: "tool",
      stage: "required-evidence",
      functionCalls: [{ name: "research_web" }],
    });
  });

  test("admits only matching cards from an adversarial mixed final selection", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_mixed_cards",
      messages: [
        {
          role: "user",
          content: "Reality-check Bravo Beach Resort in General Luna before I book.",
        },
      ],
    });
    const toolResults = [
      {
        name: "search_places",
        toolCallId: "call_places",
        status: "success" as const,
        text: "Google Places returned the named stay and an unrelated result.",
        sources: [
          {
            label: "live_checked" as const,
            sourceName: "Google Places",
            checked: ["place identity"],
            notChecked: ["room condition"],
          },
        ],
        cards: [
          {
            id: "place_bravo",
            kind: "place" as const,
            title: "Bravo Beach Resort",
            fitReasons: [],
            caveats: [],
            sourceLabel: "Google Places - live checked",
          },
          {
            id: "place_unrelated",
            kind: "place" as const,
            title: "Unrelated Resort",
            fitReasons: [],
            caveats: [],
            sourceLabel: "Google Places - live checked",
          },
        ],
      },
    ];

    const finalized = lifecycle.finalize({
      finalPayload: finalPayload({
        answer: "Bravo Beach Resort matches the checked place identity.",
        usedToolCallIds: ["call_places"],
        displayCardIds: ["place_bravo", "place_unrelated"],
      }),
      toolCalls: [],
      toolResults,
    });

    expect(finalized.finalPayload?.displayCardIds).toEqual(["place_bravo"]);
    expect(finalized.admissibleEvidence.allowedCardIds).toEqual(["place_bravo"]);
  });

  test("requests one final retry when completed evidence is absent from the answer", () => {
    const lifecycle = buildEvidenceLifecycle({
      requestId: "request_evidence_lifecycle_final_retry",
      messages: [
        {
          role: "user",
          content: "What is the current dinner pop-up in General Luna tonight?",
        },
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
        name: "research_web",
        toolCallId: "call_research",
        status: "error" as const,
        errorCode: "provider_unavailable",
        text: "Public web research was unavailable.",
        data: { status: "provider_unavailable" },
        sources: [unavailableSource],
      },
      {
        name: "search_places",
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
      stage: "required-evidence-final-payload",
    });
  });
});

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
