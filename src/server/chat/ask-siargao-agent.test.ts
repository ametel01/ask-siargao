import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { Logger } from "pino";

import { type AgentMemorySnapshot, loadAgentMemorySnapshot } from "@/server/chat/agent-memory";
import type {
  AgentFinalPayload,
  AgentResponsesClient,
  AgentResponsesCreateResult,
  AgentToolExecutor,
  AgentToolResult,
  DecisionSummary,
  ItineraryPlan,
  RecommendationCard,
} from "@/server/chat/agent-runtime";
import { executeAgentTool } from "@/server/chat/agent-tools";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { createMeteredToolExecutor, runAskSiargaoAgentTurn } from "@/server/chat/ask-siargao-agent";
import type {
  PaidChatUsageSessionResult,
  PaidDecisionMeterReservation,
  PaidDecisionMeterType,
} from "@/server/trip-pass/usage";

describe("Ask Siargao Responses tool-loop runtime", () => {
  test("returns a no-tool Siargao answer from one model call", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_general",
        output_text: "For a first Siargao day, keep Cloud 9 and General Luna easy.",
        _request_id: "req_general",
        usage: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          mode: "thinking_high",
          upstreamRequestId: "req_general",
          inputCacheHitTokens: 100,
          inputCacheMissTokens: 50,
          inputTokens: 150,
          outputTokens: 25,
          reasoningTokens: 5,
          totalTokens: 175,
        },
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_general",
      },
      { client, agentMemoryVectorStoreId: "", model: "gpt-test" },
    );

    expect(result.message).toContain("Cloud 9");
    expect(result.model).toBe("gpt-test");
    expect(result.requestId).toBe("agent_request_general");
    expect(result.upstreamRequestIds).toEqual(["req_general"]);
    expect(result.modelCost).toMatchObject({
      requestId: "agent_request_general",
      callCount: 1,
      fallbackUsed: false,
      totalModeledCostUsd: "0.00001428",
      totals: {
        inputCacheHitTokens: 100,
        inputCacheMissTokens: 50,
        inputTokens: 150,
        outputTokens: 25,
        reasoningTokens: 5,
        totalTokens: 175,
      },
    });
    expect(JSON.stringify(result.modelCost)).not.toContain("first afternoon");
    expect(result.toolCalls).toEqual([]);
    expect(result.memory?.versionId).toMatch(/^agent-memory:[a-f0-9]{24}$/);
    expect(result.memory?.files.map((file) => file.fileName)).toContain(
      "ASK_SIARGAO_AGENT_SKILLS.md",
    );
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.store).toBe(false);
    expect(client.requests[0]?.tools).toBeArray();
    expect(client.requests[0]?.tools).toContainEqual(
      expect.objectContaining({ name: "search_agent_memory" }),
    );
    expect(client.requests[0]?.tools).toContainEqual(
      expect.objectContaining({ name: "load_agent_memory_file" }),
    );
    expect(String(client.requests[0]?.instructions)).toContain("Use the loaded INDEX.md");
    expect(String(client.requests[0]?.instructions)).toContain("Ask Siargao Agent Memory Index");
    expect(String(client.requests[0]?.instructions)).toContain(
      "Every final answer must be written by the AI from loaded memory and tool output",
    );
    expect(String(client.requests[0]?.instructions)).toContain(
      "Return final answers as normal traveler-facing Markdown/plain text",
    );
    expect(String(client.requests[0]?.instructions)).not.toContain("Return final answers as JSON");
    expect(client.requests[0]?.max_output_tokens).toBe(1_500);
    const firstInput = parseFirstInput(client.requests[0]?.input);
    expect(firstInput.agentMemory?.versionId).toBe(result.memory?.versionId);
    expect(firstInput.agentMemory?.files?.[0]).toEqual({
      id: "ask_siargao_memory_index",
      role: "instruction",
    });
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("checksum");
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("byteLength");
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("relativePath");
    expect(firstInput.conversation?.[0]?.content).toContain("first afternoon");
    expect(firstInput.responseContract?.finalOutput).toContain("normal traveler-facing Markdown");
  });

  test("repairs malformed fenced JSON before returning a default chat answer", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_malformed_json",
        output_text:
          '```json\n{"answer":"Cloud 9 quick lowdown.\\n\\n### Surfing\\nUse Jacking Horse',
        output: [{ type: "message", id: "msg_malformed_json" }],
        _request_id: "req_malformed_json",
      },
      {
        id: "resp_repaired_markdown",
        output_text: "Cloud 9 quick lowdown.\n\n### Surfing\nUse Jacking Horse for lessons.",
        _request_id: "req_repaired_markdown",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Cloud 9 for 10 days, what should we know?" }],
        requestId: "agent_request_malformed_json_repair",
      },
      { client, agentMemoryVectorStoreId: "", model: "gpt-test" },
    );

    expect(result.message).toBe(
      "Cloud 9 quick lowdown.\n\n### Surfing\nUse Jacking Horse for lessons.",
    );
    expect(result.message).not.toContain("```json");
    expect(result.message).not.toContain('"answer"');
    expect(result.repairCount).toBe(1);
    expect(result.upstreamRequestIds).toEqual(["req_malformed_json", "req_repaired_markdown"]);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.max_output_tokens).toBe(1_500);
    expect(parseLastUserInputMessage(client.requests[1]?.input)?.instruction).toContain(
      "Return only normal traveler-facing Markdown/plain text",
    );
  });

  test("applies the free cost policy when the candidate flag is enabled", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_free_policy",
        output_text: "Keep the first Siargao answer compact.",
        _request_id: "req_free_policy",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_free_policy",
      },
      {
        client,
        agentMemoryVectorStoreId: "",
        costPolicyEnv: { DEEPSEEK_COST_POLICY_ENABLED: "true" },
        model: "deepseek-v4-flash",
      },
    );

    expect(result.message).toContain("compact");
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.max_output_tokens).toBe(1_500);
    expect(client.requests[0]?.modelCostPolicy).toEqual({ deepSeekThinkingMode: "disabled" });
  });

  test("returns live_access_required before calling a live tool when a decision meter is exhausted", async () => {
    const releases: PaidDecisionMeterType[] = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) => {
        if (meterType === "live_refresh") {
          return {
            status: "usage_limit_reached",
            allowance: { meterType, limit: 40, remaining: 0, used: 40 },
            meterType,
          };
        }
        return reservedDecisionMeter(meterType, {
          onRelease: () => releases.push(meterType),
        });
      },
    });
    const executeTool: AgentToolExecutor = async () => {
      throw new Error("provider should not run after live allowance exhaustion");
    };
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool,
      plan: "free",
      usageSession: session,
    });

    const result = await meteredExecuteTool({
      arguments: { query: "breakfast in Dapa" },
      name: "search_places",
      requestId: "request_live_exhausted",
      toolCallId: "call_live_exhausted",
    });

    expect(result).toMatchObject({
      errorCode: "live_access_required",
      name: "search_places",
      status: "error",
      toolCallId: "call_live_exhausted",
    });
    expect(result.data).toEqual({ meterType: "live_refresh", reason: "live_access_required" });
    expect(releases).toEqual(["heavy_recommendation"]);
  });

  test("releases live decision meter reservations when a live provider returns an error result", async () => {
    const settlements: Array<{ meterType: PaidDecisionMeterType; success: boolean }> = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) =>
        reservedDecisionMeter(meterType, {
          onSettle: (success) => settlements.push({ meterType, success }),
        }),
    });
    const executeTool: AgentToolExecutor = async (request) => ({
      name: request.name,
      toolCallId: request.toolCallId,
      status: "error",
      text: "Google Places search is temporarily unavailable.",
      errorCode: "provider_unavailable",
      sources: [providerUnavailableSourceSummary],
    });
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool,
      plan: "free",
      usageSession: session,
    });

    const result = await meteredExecuteTool({
      arguments: { query: "breakfast in Dapa" },
      name: "search_places",
      requestId: "request_provider_unavailable",
      toolCallId: "call_provider_unavailable",
    });

    expect(result).toMatchObject({
      errorCode: "provider_unavailable",
      status: "error",
      toolCallId: "call_provider_unavailable",
    });
    expect(settlements).toEqual([
      { meterType: "live_refresh", success: false },
      { meterType: "heavy_recommendation", success: false },
    ]);
  });

  test("settles each live decision meter category once across supporting tool calls", async () => {
    const reservations = new Map<PaidDecisionMeterType, PaidDecisionMeterReservation>();
    const settlementCounts = new Map<PaidDecisionMeterType, number>();
    const providerIds: string[] = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) => {
        const existing = reservations.get(meterType);
        if (existing) {
          return existing;
        }
        const reservation = reservedDecisionMeter(meterType, {
          onSettle: (success, ids) => {
            if (success) {
              settlementCounts.set(meterType, (settlementCounts.get(meterType) ?? 0) + 1);
              providerIds.push(...ids);
            }
          },
          reuseSettlement: true,
        });
        reservations.set(meterType, reservation);
        return reservation;
      },
    });
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool: async (request) => ({
        name: request.name,
        toolCallId: request.toolCallId,
        status: "success",
        text: "Google Places returned live evidence.",
        logData: { upstreamRequestId: `${request.toolCallId}_upstream` },
        sources: [placesSourceSummary],
      }),
      plan: "free",
      usageSession: session,
    });

    await meteredExecuteTool({
      arguments: { query: "breakfast in Dapa" },
      name: "search_places",
      requestId: "request_supporting_tools",
      toolCallId: "call_search_places",
    });
    await meteredExecuteTool({
      arguments: { placeId: "place_dapa_breakfast" },
      name: "get_place_details",
      requestId: "request_supporting_tools",
      toolCallId: "call_place_details",
    });

    expect([...reservations.keys()]).toEqual(["live_refresh", "heavy_recommendation"]);
    expect([...settlementCounts.entries()]).toEqual([
      ["live_refresh", 1],
      ["heavy_recommendation", 1],
    ]);
    expect(providerIds).toEqual(["call_search_places_upstream", "call_search_places_upstream"]);
  });

  test("releases decision meter reservations for cache-only tool results", async () => {
    const settlements: Array<{ meterType: PaidDecisionMeterType; success: boolean }> = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) =>
        reservedDecisionMeter(meterType, {
          onSettle: (success) => settlements.push({ meterType, success }),
        }),
    });
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool: async (request) => ({
        name: request.name,
        toolCallId: request.toolCallId,
        status: "success",
        text: "Recently checked cached Places evidence.",
        sources: [
          {
            ...placesSourceSummary,
            label: "fresh_cache",
            sourceName: "Google Places cache",
          },
        ],
      }),
      plan: "free",
      usageSession: session,
    });

    const result = await meteredExecuteTool({
      arguments: { query: "breakfast in Dapa" },
      name: "search_places",
      requestId: "request_fresh_cache",
      toolCallId: "call_fresh_cache",
    });

    expect(result.status).toBe("success");
    expect(settlements).toEqual([
      { meterType: "live_refresh", success: false },
      { meterType: "heavy_recommendation", success: false },
    ]);
  });

  test("free decision metering charges live and heavy categories without paid-only sublimits", async () => {
    const settlements: Array<{ meterType: PaidDecisionMeterType; success: boolean }> = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) =>
        reservedDecisionMeter(meterType, {
          onSettle: (success) => settlements.push({ meterType, success }),
        }),
    });
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool: async (request) => ({
        name: request.name,
        toolCallId: request.toolCallId,
        status: "success",
        text: "Live web research returned current evidence.",
        sources: [
          {
            ...placesSourceSummary,
            label: "official_checked",
            sourceName: "Public web source",
          },
        ],
      }),
      plan: "free",
      usageSession: session,
    });

    await meteredExecuteTool({
      arguments: { query: "events tonight" },
      name: "research_web",
      requestId: "request_free_research",
      toolCallId: "call_free_research",
    });

    expect(settlements).toEqual([
      { meterType: "live_refresh", success: true },
      { meterType: "heavy_recommendation", success: true },
    ]);
  });

  test("paid tools do not reserve legacy commercial decision meters", async () => {
    const settlements: Array<{ meterType: PaidDecisionMeterType; success: boolean }> = [];
    const session = fakePaidUsageSession({
      reserveDecisionMeter: async (meterType) =>
        reservedDecisionMeter(meterType, {
          onSettle: (success) => settlements.push({ meterType, success }),
        }),
    });
    const meteredExecuteTool = createMeteredToolExecutor({
      executeTool: async (request) => ({
        name: request.name,
        toolCallId: request.toolCallId,
        status: "success",
        text: "Itinerary planning returned a route.",
        sources: [localGuideSourceSummary],
      }),
      plan: "paid",
      usageSession: session,
    });

    await meteredExecuteTool({
      arguments: { goal: "rainy afternoon" },
      name: "plan_local_itinerary",
      requestId: "request_paid_route",
      toolCallId: "call_paid_route",
    });

    expect(settlements).toEqual([]);
  });

  test("repairs leaked DSML tool-call markup before returning a default chat answer", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_dsml_final_text",
        output_text:
          '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="load_agent_memory_file"> <｜｜DSML｜｜parameter name="file_id" string="true">ASK_SIARGAO_ANSWER_PATTERNS.md</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>',
        output: [{ type: "message", id: "msg_dsml_final_text" }],
        _request_id: "req_dsml_final_text",
      },
      {
        id: "resp_repaired_dsml_markdown",
        output_text:
          "For a rainy dinner, start with Bravo if you want a covered, full-dinner setup.",
        _request_id: "req_repaired_dsml_markdown",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Compare Bravo, CEV, Shaka, and Kurvada for dinner tonight. Which are open?",
          },
        ],
        requestId: "agent_request_dsml_final_text_repair",
      },
      { client, agentMemoryVectorStoreId: "", model: "gpt-test" },
    );

    expect(result.message).toBe(
      "For a rainy dinner, start with Bravo if you want a covered, full-dinner setup.",
    );
    expect(result.message).not.toContain("DSML");
    expect(result.message).not.toContain("tool_calls");
    expect(result.upstreamRequestIds).toEqual([
      "req_dsml_final_text",
      "req_repaired_dsml_markdown",
    ]);
    expect(client.requests).toHaveLength(2);
    expect(parseLastUserInputMessage(client.requests[1]?.input)?.instruction).toContain(
      "Return only normal traveler-facing Markdown/plain text",
    );
  });

  test("builds prompts with compact available memory metadata and only the index body", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_memory_prompt",
        output_text: "Use source policy for source labels.",
        _request_id: "req_memory_prompt",
      },
    ]);
    const memorySnapshot = memorySnapshotFixture({
      instructionContent: "INDEX_BODY_MARKER: choose the smallest relevant file.",
      sourcePolicyContent: "REFERENCE_BODY_MARKER: full source-policy text must be loaded by tool.",
    });

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What source labels can you use?" }],
        requestId: "agent_request_memory_prompt",
      },
      {
        client,
        agentMemoryVectorStoreId: "",
        memorySnapshot,
        model: "gpt-test",
      },
    );

    const instructions = String(client.requests[0]?.instructions);
    expect(instructions).toContain("# Available Ask Siargao Agent Memory");
    expect(instructions).toContain("Memory files are policy and local-reference context");
    expect(instructions).toContain("ASK_SIARGAO_SOURCE_POLICY.md");
    expect(instructions).toContain("Source-label policy and memory retrieval boundaries.");
    expect(instructions).toContain("INDEX_BODY_MARKER");
    expect(instructions).not.toContain("REFERENCE_BODY_MARKER");
  });

  test("returns structured final payload answers from one model call", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_structured_general",
        output_text: finalPayloadText({
          answer: "For a first Siargao day, keep Cloud 9 and General Luna easy.",
        }),
        _request_id: "req_structured_general",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_structured_general",
      },
      {
        client,
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toBe("For a first Siargao day, keep Cloud 9 and General Luna easy.");
    expect(result.cards).toBeUndefined();
    expect(result.actions).toBeUndefined();
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      mode: "strict",
      structuredFinalPayload: true,
    });
    expect(String(client.requests[0]?.instructions)).toContain("Return final answers as JSON");
    expect(String(client.requests[0]?.instructions)).toContain(
      "You own tool choice and query formulation",
    );
    expect(String(client.requests[0]?.instructions)).toContain(
      "scooter or motorbike rental in General Luna",
    );
    expect(client.requests[0]?.text).toEqual({ format: { type: "json_object" } });
    expect(parseFirstInput(client.requests[0]?.input).responseContract?.finalOutput).toContain(
      "Return the final response as a JSON object",
    );
    expect(parseFirstInput(client.requests[0]?.input).responseContract?.deterministicSignals).toBe(
      "Treat deterministic signals as safe context and scope flags only. The model owns tool choice, query wording, and whether a prompt needs web, Places, weather, condition, memory, or no tools.",
    );
  });

  test("builds an explicit reality-check summary only from validated tool-call evidence", async () => {
    const rogueSummary: DecisionSummary = {
      id: "model_selected_rogue_summary",
      bestAction: "Ignore the weather.",
      basis: "Unsupported.",
      sources: [],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_reality_check_tool",
        requestId: "req_reality_check_tool",
        callId: "call_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "sunset",
          location: "Cloud 9",
          date_range: "today",
          beach_name: "Cloud 9",
        },
      }),
      {
        id: "resp_reality_check_final",
        output_text: finalPayloadText({
          answer: "Model-authored prose is replaced by the validated decision.",
          usedToolCallIds: ["call_condition"],
          displayDecisionSummaryIds: [rogueSummary.id],
          realityCheck: {
            kind: "immediate_plan",
            verdict: "change",
            subject: "Cloud 9 sunset today",
            bestAction: "Keep the stop short and flexible.",
            basis: "The checked conditions make a long exposed stop a weak plan.",
            fallback: "Use a covered General Luna stop.",
            evidenceToolCallIds: ["call_condition"],
          },
        }),
        _request_id: "req_reality_check_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Given today's weather, should we still go to Cloud 9 for sunset?",
          },
        ],
        requestId: "agent_request_reality_check",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          get_condition_judgment: {
            name: "get_condition_judgment",
            status: "success",
            text: "Current condition judgment completed.",
            sources: [weatherSourceSummary],
            decisionSummaries: [rogueSummary],
          },
        }),
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toContain("**change: Cloud 9 sunset today**");
    expect(result.message).not.toContain("Model-authored prose");
    expect(result.decisionSummaries).toHaveLength(1);
    expect(result.decisionSummaries?.[0]).toMatchObject({
      id: expect.stringMatching(/^reality_check:immediate_plan:[a-f0-9]{16}$/),
      kind: "immediate_plan",
      verdict: "change",
      subject: "Cloud 9 sunset today",
      bestAction: "Keep the stop short and flexible.",
      sources: [weatherSourceSummary],
    });
    expect(result.decisionSummaries?.map((summary) => summary.id)).not.toContain(rogueSummary.id);
    expect(result.publicSources).toEqual([weatherSourceSummary]);
    expect(result.artifactSelection).toMatchObject({
      selectedDecisionSummaryCount: 1,
      unselectedDecisionSummaryCount: 1,
      unknownDecisionSummaryIds: [],
    });
  });

  test("repairs an explicit reality check that omitted its proposal", async () => {
    const proposal: NonNullable<AgentFinalPayload["realityCheck"]> = {
      kind: "immediate_plan",
      verdict: "keep",
      subject: "Cloud 9 sunset today",
      bestAction: "Keep the sunset stop flexible.",
      basis: "The current forecast supports a short stop.",
      evidenceToolCallIds: ["call_condition"],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_reality_repair_tool",
        requestId: "req_reality_repair_tool",
        callId: "call_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "sunset",
          location: "Cloud 9",
          date_range: "today",
          beach_name: "Cloud 9",
        },
      }),
      {
        id: "resp_reality_repair_missing",
        output_text: finalPayloadText({
          answer: "Go to Cloud 9.",
          usedToolCallIds: ["call_condition"],
        }),
        output: [{ type: "message", id: "msg_reality_repair_missing" }],
        _request_id: "req_reality_repair_missing",
      },
      {
        id: "resp_reality_repair_final",
        output_text: finalPayloadText({
          answer: "Keep it flexible.",
          usedToolCallIds: ["call_condition"],
          realityCheck: proposal,
        }),
        _request_id: "req_reality_repair_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Given today's weather, should we still go to Cloud 9 for sunset?",
          },
        ],
        requestId: "agent_request_reality_repair",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          get_condition_judgment: {
            name: "get_condition_judgment",
            status: "success",
            text: "Current condition judgment completed.",
            sources: [weatherSourceSummary],
          },
        }),
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.repairCount).toBe(1);
    expect(result.decisionSummaries?.[0]).toMatchObject({ verdict: "keep" });
    expect(parseLastUserInputMessage(client.requests[2]?.input)).toMatchObject({
      validationRepairRealityCheck: {
        expectedKind: "immediate_plan",
        reason: "missing_reality_check",
      },
    });
  });

  test("downgrades a repeated positive verdict after provider failure", async () => {
    const unsafeProposal: NonNullable<AgentFinalPayload["realityCheck"]> = {
      kind: "immediate_plan",
      verdict: "keep",
      subject: "Cloud 9 sunset today",
      bestAction: "Go ahead with the sunset stop.",
      basis: "The weather should be fine.",
      evidenceToolCallIds: ["call_condition"],
    };
    const repeatedFinal = {
      output_text: finalPayloadText({
        answer: "Go ahead.",
        usedToolCallIds: ["call_condition"],
        realityCheck: unsafeProposal,
      }),
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_reality_failure_tool",
        requestId: "req_reality_failure_tool",
        callId: "call_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "sunset",
          location: "Cloud 9",
          date_range: "today",
          beach_name: "Cloud 9",
        },
      }),
      {
        id: "resp_reality_failure_final",
        ...repeatedFinal,
        output: [{ type: "message", id: "msg_reality_failure_final" }],
        _request_id: "req_reality_failure_final",
      },
      {
        id: "resp_reality_failure_repeated",
        ...repeatedFinal,
        _request_id: "req_reality_failure_repeated",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Given today's weather, should we still go to Cloud 9 for sunset?",
          },
        ],
        requestId: "agent_request_reality_failure",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          get_condition_judgment: {
            name: "get_condition_judgment",
            status: "error",
            text: "The forecast provider is unavailable.",
            errorCode: "provider_unavailable",
            sources: [weatherProviderUnavailableSourceSummary],
          },
        }),
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.repairCount).toBe(1);
    expect(result.message).toContain("**needs confirmation: Cloud 9 sunset today**");
    expect(result.message).not.toContain("Go ahead");
    expect(result.decisionSummaries?.[0]).toMatchObject({
      verdict: "needs_confirmation",
      sources: [weatherProviderUnavailableSourceSummary],
    });
  });

  test("reality-checks an exact accommodation and filters mixed place cards", async () => {
    const bravoCard: RecommendationCard = {
      id: "card_bravo_beach_resort",
      kind: "place",
      title: "Bravo Beach Resort",
      subtitle: "General Luna",
      fitReasons: ["The checked listing matches the named property."],
      caveats: ["Room noise and Wi-Fi reliability were not checked."],
      sourceLabel: "Google Places - live checked",
    };
    const unrelatedCard: RecommendationCard = {
      ...bravoCard,
      id: "card_unrelated_resort",
      title: "Unrelated Resort",
    };
    const areaSource: AnswerSourceSummary = {
      label: "curated_local_guide",
      sourceName: "Ask Siargao governed area facts",
      confidence: "medium",
      checked: ["General Luna area fit", "transport access"],
      notChecked: ["property room noise", "property Wi-Fi reliability"],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_accommodation_evidence",
        _request_id: "req_accommodation_evidence",
        output: [
          {
            type: "function_call",
            call_id: "call_bravo_places",
            name: "search_places",
            arguments: JSON.stringify({
              query: "Bravo Beach Resort accommodation Siargao",
              center: { latitude: 9.784, longitude: 126.158 },
              radius_meters: 12000,
              constraints: { included_type: "lodging", open_now: null, page_size: 5 },
            }),
          },
          {
            type: "function_call",
            call_id: "call_general_luna_facts",
            name: "query_local_facts",
            arguments: JSON.stringify({
              entityTypes: ["area", "route"],
              area: "general luna",
              text: "General Luna",
              limit: 5,
            }),
          },
        ],
      },
      {
        id: "resp_accommodation_final",
        _request_id: "req_accommodation_final",
        output_text: finalPayloadText({
          answer: "The named property and General Luna fit were checked separately.",
          usedToolCallIds: ["call_bravo_places", "call_general_luna_facts"],
          displayCardIds: [bravoCard.id, unrelatedCard.id],
          realityCheck: {
            kind: "accommodation",
            verdict: "keep",
            subject: "Bravo Beach Resort",
            bestAction: "Keep it on the shortlist for its General Luna location.",
            basis:
              "Places confirms the property identity, and governed area facts fit a family without a scooter.",
            avoid: "Room noise and Wi-Fi reliability are not confirmed; ask the property directly.",
            area: "General Luna",
            evidenceToolCallIds: ["call_bravo_places", "call_general_luna_facts"],
          },
        }),
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content:
              "Reality-check Bravo Beach Resort in General Luna for kids, quiet sleep, and no scooter before I book.",
          },
        ],
        requestId: "agent_request_accommodation_exact",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          search_places: {
            name: "search_places",
            status: "success",
            text: "Google Places matched the named property.",
            sources: [placesSourceSummary],
            cards: [bravoCard, unrelatedCard],
          },
          query_local_facts: {
            name: "query_local_facts",
            status: "success",
            text: "Governed General Luna area-fit facts returned.",
            sources: [areaSource],
          },
        }),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toContain("**keep: Bravo Beach Resort**");
    expect(result.message).toContain("Room noise and Wi-Fi reliability are not confirmed");
    expect(result.cards?.map((card) => card.id)).toEqual([bravoCard.id]);
    expect(JSON.stringify(result.cards)).not.toContain(unrelatedCard.title);
    expect(result.publicSources).toEqual([placesSourceSummary, areaSource]);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 1,
      totalCardCount: 1,
      unknownCardIds: [],
    });
  });

  test("downgrades a property verdict when Places is unavailable", async () => {
    const areaSource: AnswerSourceSummary = {
      label: "curated_local_guide",
      sourceName: "Ask Siargao governed area facts",
      confidence: "medium",
      checked: ["General Luna area fit"],
      notChecked: ["property identity"],
    };
    const unsafeProposal: NonNullable<AgentFinalPayload["realityCheck"]> = {
      kind: "accommodation",
      verdict: "keep",
      subject: "Bravo Beach Resort",
      bestAction: "Book the property.",
      basis: "General Luna fits the trip constraints.",
      evidenceToolCallIds: ["call_bravo_places_failed", "call_general_luna_facts"],
    };
    const repeatedFinal = {
      output_text: finalPayloadText({
        answer: "Keep the property on the shortlist without a checked Places claim.",
        usedToolCallIds: ["call_bravo_places_failed", "call_general_luna_facts"],
        realityCheck: unsafeProposal,
      }),
    };
    const client = fakeResponsesClient([
      {
        id: "resp_accommodation_failure_evidence",
        _request_id: "req_accommodation_failure_evidence",
        output: [
          {
            type: "function_call",
            call_id: "call_bravo_places_failed",
            name: "search_places",
            arguments: JSON.stringify({
              query: "Bravo Beach Resort accommodation Siargao",
              center: { latitude: 9.784, longitude: 126.158 },
              radius_meters: 12000,
              constraints: { included_type: "lodging", open_now: null, page_size: 5 },
            }),
          },
          {
            type: "function_call",
            call_id: "call_general_luna_facts",
            name: "query_local_facts",
            arguments: JSON.stringify({
              entityTypes: ["area", "route"],
              area: "general luna",
              text: "General Luna",
              limit: 5,
            }),
          },
        ],
      },
      {
        id: "resp_accommodation_failure_final",
        _request_id: "req_accommodation_failure_final",
        output: [{ type: "message", id: "msg_accommodation_failure_final" }],
        ...repeatedFinal,
      },
      {
        id: "resp_accommodation_failure_repeated",
        _request_id: "req_accommodation_failure_repeated",
        ...repeatedFinal,
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Reality-check Bravo Beach Resort in General Luna before I book.",
          },
        ],
        requestId: "agent_request_accommodation_provider_failure",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          search_places: {
            name: "search_places",
            status: "error",
            text: "Google Places was unavailable.",
            errorCode: "provider_unavailable",
            sources: [providerUnavailableSourceSummary],
          },
          query_local_facts: {
            name: "query_local_facts",
            status: "success",
            text: "Governed General Luna area facts returned.",
            sources: [areaSource],
          },
        }),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.repairCount).toBe(1);
    expect(result.message).toContain("**needs confirmation: Bravo Beach Resort**");
    expect(result.message).not.toContain("Book the property");
    expect(result.cards).toBeUndefined();
    expect(result.decisionSummaries?.[0]).toMatchObject({
      verdict: "needs_confirmation",
      sources: [providerUnavailableSourceSummary, areaSource],
    });
  });

  test("asks for the accommodation instead of inventing one", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_accommodation_clarification",
        _request_id: "req_accommodation_clarification",
        output_text: finalPayloadText({ answer: "I can check it." }),
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Reality-check this hotel before I book." }],
        requestId: "agent_request_accommodation_clarification",
      },
      { client, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toBe(
      "Which accommodation should I reality-check? Send its name or listing link.",
    );
    expect(result.toolCalls).toEqual([]);
    expect(result.decisionSummaries).toBeUndefined();
  });

  test("returns only tool artifacts selected by structured final payload", async () => {
    const card = {
      id: "card_doot",
      kind: "beach" as const,
      title: "Doot Beach",
      subtitle: "General Luna-side sandy beach",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Doot%20Beach%20Siargao",
      distanceLabel: "About 20 minutes by tricycle from General Luna",
      fitReasons: ["Sandy shore", "Works for a quieter beach stop"],
      caveats: ["Check tide and road conditions before leaving"],
      sourceLabel: "Ask Siargao curated local beach guide",
      decision: {
        label: "best_fit" as const,
        bestAction: "Choose Doot for the easiest sandy stop near General Luna.",
      },
    };
    const unselectedCard = {
      ...card,
      id: "card_malinao",
      title: "Malinao Beach",
      decision: {
        label: "fallback" as const,
        bestAction: "Keep Malinao as the backup if Doot is crowded.",
      },
    };
    const action = {
      id: "ask_weather",
      label: "Check weather",
      prompt: "Check weather before going to Doot Beach.",
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_structured_artifact_call",
        requestId: "req_structured_artifact_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: {
          query: "sandy swimming beaches within 30 minutes",
          filters: { beach_surface: "sand", swimming: true, max_ride_minutes: 30 },
        },
      }),
      {
        id: "resp_structured_artifact_final",
        output_text: finalPayloadText({
          answer: "Doot is the best fit to show.",
          usedToolCallIds: ["call_local"],
          displayCardIds: [card.id],
          displayActionIds: [action.id],
        }),
        _request_id: "req_structured_artifact_final",
      },
      {
        id: "resp_structured_artifact_final_after_memory",
        output_text: finalPayloadText({
          answer: "Doot is the best fit to show.",
          usedToolCallIds: ["call_local"],
          usedMemoryFiles: ["LOCAL_GUIDE_BEACHES.md"],
          displayCardIds: [card.id],
          displayActionIds: [action.id],
        }),
        _request_id: "req_structured_artifact_final_after_memory",
      },
    ]);
    const localGuideExecutor = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot and Malinao.",
        sources: [localGuideSourceSummary],
        cards: [card, unselectedCard],
        actions: [action],
      },
    });
    const memoryExecutor = memoryLoadExecutor();

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_structured_artifacts",
      },
      {
        client,
        executeTool: (request) =>
          request.name === "load_agent_memory_file"
            ? memoryExecutor(request)
            : localGuideExecutor(request),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toBe("Doot is the best fit to show.");
    expect(result.cards).toEqual([{ ...card, sources: [localGuideSourceSummary] }]);
    expect(JSON.stringify(result.cards)).not.toContain("Keep Malinao as the backup");
    expect(result.actions).toEqual([action]);
    expect(result.artifactSelection).toMatchObject({
      mode: "strict",
      structuredFinalPayload: true,
      selectedCardCount: 1,
      selectedActionCount: 1,
      unselectedCardCount: 1,
    });
  });

  test("Dapa breakfast structured final output returns restaurant card but not beach cards", async () => {
    const breakfastCard = {
      id: "card_dapa_breakfast",
      kind: "place" as const,
      title: "Dapa Breakfast House",
      subtitle: "Dapa",
      mapsUrl: "https://maps.example/dapa-breakfast",
      fitReasons: ["Breakfast fit returned by Google Places."],
      caveats: ["Menus and table availability were not checked."],
      sourceLabel: "Google Places - live checked",
    };
    const beachCard = {
      id: "card_doot_beach",
      kind: "beach" as const,
      title: "Doot Beach",
      subtitle: "General Luna-side sandy beach",
      fitReasons: ["Sandy beach fallback from local guide."],
      caveats: ["Not relevant to a Dapa breakfast-only request."],
      sourceLabel: "Ask Siargao curated local beach guide",
    };
    const client = fakeResponsesClient([
      {
        id: "resp_dapa_breakfast_multi_call",
        _request_id: "req_dapa_breakfast_multi_call",
        output: [
          {
            type: "function_call",
            call_id: "call_places_breakfast",
            name: "search_places",
            arguments: JSON.stringify({
              query: "breakfast in Dapa Siargao",
              center: { latitude: 9.759, longitude: 126.053 },
              radius_meters: 3000,
              constraints: { included_type: "restaurant", open_now: null, page_size: 5 },
            }),
          },
          {
            type: "function_call",
            call_id: "call_local_beaches",
            name: "search_local_guide",
            arguments: JSON.stringify({
              query: "Dapa breakfast fallback beaches",
              filters: null,
            }),
          },
        ],
      },
      {
        id: "resp_dapa_breakfast_final",
        output_text: finalPayloadText({
          answer: "For breakfast in Dapa, start with Dapa Breakfast House.",
          usedToolCallIds: ["call_places_breakfast", "call_local_beaches"],
          displayCardIds: [breakfastCard.id],
        }),
        _request_id: "req_dapa_breakfast_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned breakfast options in Dapa.",
        sources: [placesSourceSummary],
        cards: [breakfastCard],
      },
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned unrelated beach cards.",
        sources: [localGuideSourceSummary],
        cards: [beachCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "I'll go to Dapa later, good places for breakfast?" }],
        requestId: "agent_request_dapa_breakfast_regression",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("breakfast in Dapa");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "search_places",
      "search_local_guide",
    ]);
    expect(result.sources).toEqual([placesSourceSummary, localGuideSourceSummary]);
    expect(result.cards?.map((card) => card.id)).toEqual([breakfastCard.id]);
    expect(JSON.stringify(result.cards)).not.toContain(beachCard.title);
    expect(result.artifactSelection).toMatchObject({
      totalCardCount: 2,
      selectedCardCount: 1,
      unselectedCardCount: 1,
    });
  });

  test("Dapa breakfast legacy final output returns no unselected cards", async () => {
    const breakfastCard = {
      id: "card_dapa_breakfast",
      kind: "place" as const,
      title: "Dapa Breakfast House",
      fitReasons: ["Breakfast fit returned by Google Places."],
      caveats: [],
      sourceLabel: "Google Places - live checked",
    };
    const beachCard = {
      id: "card_doot_beach",
      kind: "beach" as const,
      title: "Doot Beach",
      fitReasons: ["Sandy beach fallback from local guide."],
      caveats: [],
      sourceLabel: "Ask Siargao curated local beach guide",
    };
    const client = fakeResponsesClient([
      {
        id: "resp_dapa_breakfast_legacy_multi_call",
        _request_id: "req_dapa_breakfast_legacy_multi_call",
        output: [
          {
            type: "function_call",
            call_id: "call_places_breakfast",
            name: "search_places",
            arguments: JSON.stringify({ query: "breakfast in Dapa Siargao" }),
          },
          {
            type: "function_call",
            call_id: "call_local_beaches",
            name: "search_local_guide",
            arguments: JSON.stringify({ query: "Dapa beaches", filters: null }),
          },
        ],
      },
      {
        id: "resp_dapa_breakfast_legacy_final",
        output_text: "For breakfast in Dapa, use the Places breakfast result.",
        _request_id: "req_dapa_breakfast_legacy_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned breakfast options in Dapa.",
        sources: [placesSourceSummary],
        cards: [breakfastCard],
      },
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned unrelated beach cards.",
        sources: [localGuideSourceSummary],
        cards: [beachCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "I'll go to Dapa later, good places for breakfast?" }],
        requestId: "agent_request_dapa_breakfast_legacy_regression",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("breakfast in Dapa");
    expect(result.cards).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalCardCount: 2,
      unselectedCardCount: 2,
    });
  });

  test("normalizes indexed web and Places tool aliases in final payloads", async () => {
    const scooterWebSource: AnswerSourceSummary = {
      label: "directory_checked",
      sourceName: "Public scooter rental directory",
      sourceProfileId: "source_web_directory",
      fetchedAt: "2026-07-01T09:00:00.000Z",
      confidence: "medium",
      checked: ["General Luna scooter rental listings"],
      notChecked: ["walk-in availability", "deposit requirements"],
    };
    const scooterPlaceCard: RecommendationCard = {
      id: "place_island_scooter_rental",
      kind: "place",
      title: "Island Scooter Rental",
      subtitle: "General Luna",
      mapsUrl: "https://maps.example/island-scooter-rental",
      fitReasons: ["Returned by the model-selected Places lookup."],
      caveats: ["Helmet availability, deposit, and daily rate were not checked."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_scooter_rental_model_tools",
        _request_id: "req_scooter_rental_model_tools",
        output: [
          {
            type: "function_call",
            call_id: "call_scooter_web",
            name: "research_web",
            arguments: JSON.stringify({
              query: "scooter rental General Luna Siargao",
              intent: "recommendation",
              location: "General Luna",
              sourceTypes: ["official", "local_directory", "maps", "guide"],
              requiredFreshness: "stable",
            }),
          },
          {
            type: "function_call",
            call_id: "call_scooter_places",
            name: "search_places",
            arguments: JSON.stringify({
              query: "scooter rental General Luna Siargao",
              center: { latitude: 9.8006, longitude: 126.1586 },
              radius_meters: 8_000,
              constraints: { included_type: null, open_now: null, page_size: 5 },
            }),
          },
        ],
      },
      {
        id: "resp_scooter_rental_final",
        output_text: finalPayloadText({
          answer:
            "For scooter rental in General Luna, start with Island Scooter Rental and confirm deposit, helmet, and current daily rate before paying.",
          usedToolCallIds: ["research_web_0", "search_places_0"],
          displayCardIds: [scooterPlaceCard.id],
        }),
        _request_id: "req_scooter_rental_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "research_web") {
        expect(request.arguments.query).toBe("scooter rental General Luna Siargao");
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research returned General Luna scooter rental listings.",
          data: {
            status: "available",
            findings: [
              {
                claim: "General Luna has public scooter rental listings.",
                answerRole: "primary",
              },
            ],
            entities: [
              {
                name: "Island Scooter Rental",
                kind: "service",
                area: "General Luna",
                needsPlacesEnrichment: true,
              },
            ],
          },
          sources: [scooterWebSource],
        };
      }
      if (request.name === "search_places") {
        expect(request.arguments.query).toBe("scooter rental General Luna Siargao");
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned scooter rental options.",
          sources: [placesSourceSummary],
          cards: [scooterPlaceCard],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can I rent a scooter in General Luna?" }],
        requestId: "agent_request_scooter_rental_model_tools",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("scooter rental");
    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_scooter_web", "research_web"],
      ["call_scooter_places", "search_places"],
    ]);
    expect(result.cards).toEqual([scooterPlaceCard]);
    expect(result.publicSources).toEqual([scooterWebSource, placesSourceSummary]);
  });

  test("repairs motorbike rental answers that skip Places lookup after web research", async () => {
    const motorbikeWebSource: AnswerSourceSummary = {
      label: "official_checked",
      sourceName: "Public motorbike rental operator",
      sourceProfileId: "source_web_official",
      fetchedAt: "2026-07-01T09:00:00.000Z",
      confidence: "medium",
      checked: ["General Luna motorbike rental operator page"],
      notChecked: ["Google Maps details", "walk-in availability"],
    };
    const motorbikePlaceCard: RecommendationCard = {
      id: "place_general_luna_motorbike_rental",
      kind: "place",
      title: "General Luna Motorbike Rental",
      subtitle: "General Luna",
      mapsUrl: "https://maps.example/general-luna-motorbike-rental",
      fitReasons: ["Returned by the runtime-repaired Places lookup."],
      caveats: ["Availability, deposits, and current daily rates were not checked."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_motorbike_rental_web_only",
        _request_id: "req_motorbike_rental_web_only",
        output: [
          {
            type: "function_call",
            call_id: "call_motorbike_web",
            name: "research_web",
            arguments: JSON.stringify({
              query: "motorbike rental General Luna Siargao",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
        ],
      },
      {
        id: "resp_motorbike_rental_bad_final",
        output_text: finalPayloadText({
          answer:
            "Golden Bell and Siargao Scooter Rentals are known options; ask if you want map links.",
          usedToolCallIds: ["call_motorbike_web"],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_rental_bad_final",
      },
      {
        id: "resp_motorbike_rental_repaired_final",
        output_text: finalPayloadText({
          answer:
            "For motorbike rental in General Luna, start with General Luna Motorbike Rental and confirm availability, helmet, deposit, and current daily rate before paying. If you want, I can also pull map links and phone numbers.",
          usedToolCallIds: ["call_motorbike_web", "auto_required_evidence_search_places_1"],
          displayCardIds: [motorbikePlaceCard.id],
        }),
        _request_id: "req_motorbike_rental_repaired_final",
      },
      {
        id: "resp_motorbike_rental_quality_repaired_final",
        output_text: finalPayloadText({
          answer: [
            "Best motorbike rental options in **General Luna**:",
            "",
            "| Rental shop | Area | Price signal | Contact / notes |",
            "| --- | --- | ---: | --- |",
            "| **General Luna Motorbike Rental** | General Luna | Confirm current **₱/day rate** | Message first for availability, helmet, deposit, delivery/pickup, and opening hours. |",
            "| **Golden Bell** | Tourism Road / General Luna | Public web source should support any listed rate before quoting it | Good backup if the Places card option is full; confirm WhatsApp/contact details from the checked source. |",
            "| **Siargao Scooter Rentals** | General Luna | Confirm rate before paying | Ask about passport/ID deposit rules, helmet fit, and pickup timing. |",
            "",
            "My pick: start with **General Luna Motorbike Rental** from the checked Places result, then use Golden Bell or Siargao Scooter Rentals as backups. Take a walkaround video and check brakes, horn, lights, tire tread, helmet fit, and registration copy before riding off.",
          ].join("\n"),
          usedToolCallIds: ["call_motorbike_web", "auto_required_evidence_search_places_1"],
          displayCardIds: [motorbikePlaceCard.id],
        }),
        _request_id: "req_motorbike_rental_quality_repaired_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "research_web") {
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research returned General Luna motorbike rental operators.",
          data: {
            status: "available",
            findings: [
              {
                claim: "General Luna has public motorbike rental operators.",
                answerRole: "primary",
              },
            ],
          },
          sources: [motorbikeWebSource],
        };
      }
      if (request.name === "search_places") {
        expect(request.toolCallId).toBe("auto_required_evidence_search_places_1");
        expect(request.arguments).toMatchObject({
          query: "motorbike rental in General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 8_000,
          constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
        });
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned motorbike rental options.",
          sources: [placesSourceSummary],
          cards: [motorbikePlaceCard],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can i rent a motorbike in general luna?" }],
        requestId: "agent_request_motorbike_rental_places_repair",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("motorbike rental");
    expect(result.message).toContain("| Rental shop | Area | Price signal | Contact / notes |");
    expect(result.message).toContain("My pick");
    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_motorbike_web", "research_web"],
      ["auto_required_evidence_search_places_1", "search_places"],
    ]);
    expect(result.cards).toEqual([motorbikePlaceCard]);
    expect(result.publicSources).toEqual([motorbikeWebSource, placesSourceSummary]);
    expect(client.requests).toHaveLength(4);
    expect(JSON.stringify(parseFirstInput(client.requests[3]?.input))).toContain(
      "validationRepairStructuredAnswerQuality",
    );
  });

  test("repairs motorbike rental Places lookups with the wrong included type", async () => {
    const motorbikePlaceCard: RecommendationCard = {
      id: "place_golden_bell_siargao",
      kind: "place",
      title: "Golden Bell Siargao",
      subtitle: "Tourism Road, General Luna",
      mapsUrl: "https://maps.example/golden-bell-siargao",
      fitReasons: ["Returned by the runtime-repaired vehicle-rental Places lookup."],
      caveats: ["Call ahead for current bike availability and deposit rules."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_motorbike_wrong_places_type",
        requestId: "req_motorbike_wrong_places_type",
        callId: "call_wrong_places_type",
        name: "search_places",
        arguments: {
          query: "motorbike rental in General Luna Siargao",
          center: { latitude: 9.789, longitude: 126.156 },
          radius_meters: 5_000,
          constraints: {
            included_type: "local_government_office",
            open_now: null,
            page_size: 10,
          },
        },
      }),
      {
        id: "resp_motorbike_wrong_type_bad_final",
        output_text: finalPayloadText({
          answer: "Golden Bell Siargao is a likely option; if you want, I can find more details.",
          usedToolCallIds: ["call_wrong_places_type"],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_wrong_type_bad_final",
      },
      {
        id: "resp_motorbike_wrong_type_repaired_final",
        output_text: finalPayloadText({
          answer: [
            "Best options in **General Luna / Catangnan**:",
            "",
            "| Rental shop | Area | Price signal | Contact / notes |",
            "| --- | --- | ---: | --- |",
            "| **Golden Bell Siargao** | Tourism Road, General Luna | Confirm current **₱/day rate** | Use the map card, then message for availability, helmet, deposit, and delivery. |",
            "| **Siargao Motorbike Rentals** | General Luna | Confirm rate before paying | Good backup if Golden Bell is full; ask about pickup and surf rack. |",
            "| **Lola's Rentals** | Catangnan | Varies | Useful if you are closer to Cloud 9. |",
            "",
            "My pick: start with **Golden Bell Siargao**, then use Siargao Motorbike Rentals as backup. Check brakes, horn, lights, tire tread, helmet fit, and registration copy before riding off.",
          ].join("\n"),
          usedToolCallIds: ["auto_required_evidence_search_places_1"],
          displayCardIds: [motorbikePlaceCard.id],
        }),
        _request_id: "req_motorbike_wrong_type_repaired_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.toolCallId === "call_wrong_places_type") {
        expect(request.arguments).toMatchObject({
          constraints: { included_type: "local_government_office" },
        });
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "error",
          text: "Google Places search is temporarily unavailable.",
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        };
      }
      if (request.toolCallId === "auto_required_evidence_search_places_1") {
        expect(request.arguments).toMatchObject({
          query: "motorbike rental in General Luna Siargao",
          constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
        });
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned vehicle-rental candidates.",
          sources: [placesSourceSummary],
          cards: [motorbikePlaceCard],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can i rent a motorbike in general luna?" }],
        requestId: "agent_request_motorbike_wrong_places_type",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_wrong_places_type", "search_places"],
      ["auto_required_evidence_search_places_1", "search_places"],
    ]);
    expect(result.message).toContain("| Rental shop | Area | Price signal | Contact / notes |");
    expect(result.cards).toEqual([motorbikePlaceCard]);
    expect(result.publicSources).toEqual([placesSourceSummary]);
  });

  test("falls back to web research when motorbike rental Places lookup is unavailable", async () => {
    const motorbikeWebSource: AnswerSourceSummary = {
      label: "official_checked",
      sourceName: "Golden Bell Siargao Scooter & Motorbike Rental",
      sourceProfileId: "source_web_official",
      fetchedAt: "2026-07-01T09:00:00.000Z",
      confidence: "high",
      checked: [
        "Golden Bell lists scooter and motorbike rental in General Luna with rates, WhatsApp contact, helmets, and delivery.",
      ],
      notChecked: ["Google Maps open-now status", "walk-in availability"],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_motorbike_places_lookup",
        requestId: "req_motorbike_places_lookup",
        callId: "call_motorbike_places_unavailable",
        name: "search_places",
        arguments: {
          query: "motorbike rental in General Luna Siargao",
          center: { latitude: 9.789, longitude: 126.156 },
          radius_meters: 5_000,
          constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
        },
      }),
      {
        id: "resp_motorbike_generic_fallback",
        output_text: finalPayloadText({
          answer:
            "I couldn’t verify current Google Maps-style listings right now, so ask your hotel or check rentals in town.",
          usedToolCallIds: [],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_generic_fallback",
      },
      {
        id: "resp_motorbike_web_fallback_final",
        output_text: finalPayloadText({
          answer: [
            "Best options in **General Luna / Catangnan**:",
            "",
            "| Rental shop | Area | Price signal | Contact / notes |",
            "| --- | --- | ---: | --- |",
            "| **Golden Bell Siargao** | Tourism Road, General Luna | From **₱350/day** | WhatsApp contact, helmets, and delivery are supported by the web source; call/message first because Places was unavailable. |",
            "| **Siargao Motorbike Rentals** | General Luna | Confirm daily rate | Use as backup and verify deposit, helmet, and pickup timing before paying. |",
            "| **Lola's Rentals** | Catangnan / Tourism Road | Confirm daily rate | Good backup near Cloud 9/Catangnan; verify current hours. |",
            "",
            "My pick: message **Golden Bell Siargao** first, then compare one backup if they are full. Avoid leaving your passport if another shop will take a cash deposit or local ID photo instead, and take a walkaround video before riding off.",
          ].join("\n"),
          usedToolCallIds: ["auto_required_evidence_research_web_1"],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_web_fallback_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "search_places") {
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "error",
          errorCode: "provider_unavailable",
          text: "Google Places search lookup failed.",
          sources: [
            {
              label: "provider_unavailable",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "low",
              checked: [],
              notChecked: ["Google Places search lookup"],
            },
          ],
        };
      }
      if (request.name === "research_web") {
        expect(request.toolCallId).toBe("auto_required_evidence_research_web_1");
        expect(request.arguments).toMatchObject({
          query:
            "motorbike rental in General Luna Siargao Golden Bell Morenta Siargao Motorbike Rentals rates contact WhatsApp deposit helmet delivery",
          intent: "recommendation",
          location: "General Luna",
          sourceTypes: ["official", "local_directory", "maps", "guide"],
        });
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research returned direct General Luna motorbike rental operators.",
          data: {
            status: "available",
            findings: [
              {
                claim:
                  "Golden Bell lists scooter and motorbike rental in General Luna with rates and WhatsApp contact.",
                answerRole: "primary",
              },
            ],
          },
          sources: [motorbikeWebSource],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can i rent a motorbike in general luna?" }],
        requestId: "agent_request_motorbike_places_unavailable_web_fallback",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("| Rental shop | Area | Price signal | Contact / notes |");
    expect(result.message).toContain("Golden Bell Siargao");
    expect(result.message).toContain("My pick");
    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_motorbike_places_unavailable", "search_places"],
      ["auto_required_evidence_research_web_1", "research_web"],
    ]);
    expect(result.cards ?? []).toEqual([]);
    expect(result.publicSources).toEqual([motorbikeWebSource]);
    expect(JSON.stringify(parseFirstInput(client.requests[2]?.input))).toContain(
      "automaticRequiredEvidence",
    );
  });

  test("repairs legacy motorbike rental answers that punt after checked evidence", async () => {
    const motorbikeWebSource: AnswerSourceSummary = {
      label: "official_checked",
      sourceName: "Golden Bell Siargao Scooter & Motorbike Rental",
      sourceProfileId: "source_web_official",
      confidence: "high",
      checked: ["Golden Bell lists scooter and motorbike rental in General Luna."],
      notChecked: ["walk-in availability"],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_legacy_motorbike_tools",
        _request_id: "req_legacy_motorbike_tools",
        output: [
          {
            type: "function_call",
            call_id: "call_legacy_motorbike_web",
            name: "research_web",
            arguments: JSON.stringify({
              query: "motorbike rental in General Luna",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
          {
            type: "function_call",
            call_id: "call_legacy_motorbike_places",
            name: "search_places",
            arguments: JSON.stringify({
              query: "motorbike rental in General Luna Siargao",
              center: { latitude: 9.789, longitude: 126.156 },
              radius_meters: 5_000,
              constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
            }),
          },
        ],
      },
      {
        id: "resp_legacy_motorbike_plain_text",
        output_text: [
          "I found three solid options:",
          "| Option | Area | Why it fits |",
          "|---|---|---|",
          "| Golden Bell Siargao | General Luna | Active scooter and motorbike rental operator |",
          "| Siargao Motorbike Rentals | General Luna | Direct rental operator page |",
          "| Morenta Siargao | General Luna | Rental-focused operator |",
          "If you want, I can next compare prices.",
        ].join("\n"),
        _request_id: "req_legacy_motorbike_plain_text",
      },
      {
        id: "resp_legacy_motorbike_repaired_json",
        output_text: finalPayloadText({
          answer: [
            "Best options in **General Luna / Catangnan**:",
            "",
            "| Rental shop | Area | Why it fits | Contact / notes |",
            "| --- | --- | --- | --- |",
            "| **Golden Bell Siargao** | General Luna | Active scooter and motorbike rental operator | Message first for rate, helmet, deposit, and pickup/delivery. |",
            "| **Siargao Motorbike Rentals** | General Luna | Direct rental operator page | Compare agreement terms and pickup timing. |",
            "| **Morenta Siargao** | General Luna | Rental-focused operator | Ask about delivery and longer-stay discounts. |",
            "",
            "My pick: message **Golden Bell Siargao** first, then compare one backup before paying.",
          ].join("\n"),
          usedToolCallIds: ["call_legacy_motorbike_web"],
          displayCardIds: [],
        }),
        _request_id: "req_legacy_motorbike_repaired_json",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "search_places") {
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned rental operators.",
          sources: [placesSourceSummary],
        };
      }
      expect(request.name).toBe("research_web");
      return {
        name: "research_web",
        toolCallId: request.toolCallId,
        status: "success",
        text: "Public web research returned direct General Luna motorbike rental operators.",
        data: { status: "available" },
        sources: [motorbikeWebSource],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can i rent a motorbike in general luna?" }],
        requestId: "agent_request_legacy_motorbike_quality_repair",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("| Rental shop | Area | Why it fits | Contact / notes |");
    expect(result.message).toContain("My pick");
    expect(result.message).not.toContain("If you want");
    expect(result.publicSources).toEqual([motorbikeWebSource]);
    expect(JSON.stringify(parseFirstInput(client.requests[2]?.input))).toContain(
      "legacy_answer_punts_on_available_evidence",
    );
  });

  test("reruns targeted web research when model motorbike rental research is insufficient", async () => {
    const targetedWebSource: AnswerSourceSummary = {
      label: "official_checked",
      sourceName: "Golden Bell Siargao Scooter & Motorbike Rental",
      sourceProfileId: "source_web_official",
      confidence: "high",
      checked: ["Golden Bell lists scooter and motorbike rental in General Luna."],
      notChecked: ["Google Maps open-now status"],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_motorbike_places_and_weak_web",
        _request_id: "req_motorbike_places_and_weak_web",
        output: [
          {
            type: "function_call",
            call_id: "call_motorbike_places_down",
            name: "search_places",
            arguments: JSON.stringify({
              query: "motorbike rental in General Luna Siargao",
              center: { latitude: 9.789, longitude: 126.156 },
              radius_meters: 5_000,
              constraints: { included_type: "car_rental", open_now: null, page_size: 10 },
            }),
          },
          {
            type: "function_call",
            call_id: "call_motorbike_weak_web",
            name: "research_web",
            arguments: JSON.stringify({
              query: "motorbike rental General Luna",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
        ],
      },
      {
        id: "resp_motorbike_weak_fallback",
        output_text: finalPayloadText({
          answer: "I can’t give a trustworthy ranked shortlist right now. Ask your hotel first.",
          usedToolCallIds: [],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_weak_fallback",
      },
      {
        id: "resp_motorbike_targeted_web_final",
        output_text: finalPayloadText({
          answer: [
            "Best options in **General Luna / Catangnan**:",
            "",
            "| Rental shop | Area | Why it fits | Contact / notes |",
            "| --- | --- | --- | --- |",
            "| **Golden Bell Siargao** | General Luna | Direct scooter and motorbike rental operator evidence | Message first for rate, helmet, deposit, and pickup/delivery. |",
            "| **Morenta Siargao** | General Luna | Rental-focused operator evidence | Ask about delivery and agreement terms. |",
            "| **Siargao Motorbike Rentals** | General Luna | Direct rental operator evidence | Compare pickup timing and deposit policy. |",
            "",
            "My pick: message **Golden Bell Siargao** first, then compare one backup before paying.",
          ].join("\n"),
          usedToolCallIds: ["auto_required_evidence_research_web_1"],
          displayCardIds: [],
        }),
        _request_id: "req_motorbike_targeted_web_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "search_places") {
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "error",
          errorCode: "provider_unavailable",
          text: "Google Places search lookup failed.",
          sources: [
            {
              label: "provider_unavailable",
              sourceName: "Google Places",
              sourceProfileId: "source_google_places",
              confidence: "low",
              checked: [],
              notChecked: ["Google Places search lookup"],
            },
          ],
        };
      }
      if (request.name === "research_web" && request.toolCallId === "call_motorbike_weak_web") {
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research status: insufficient.",
          data: { status: "insufficient" },
          sources: [
            {
              label: "insufficient_web_evidence",
              sourceName: "Public web research",
              sourceProfileId: "source_web_research",
              confidence: "low",
              checked: [],
              notChecked: ["sufficient current public evidence"],
            },
          ],
        };
      }
      if (request.name === "research_web") {
        expect(request.toolCallId).toBe("auto_required_evidence_research_web_1");
        expect(String(request.arguments.query)).toContain("Golden Bell");
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research returned targeted rental operators.",
          data: { status: "available" },
          sources: [targetedWebSource],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can i rent a motorbike in general luna?" }],
        requestId: "agent_request_motorbike_insufficient_web_targeted_repair",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("Golden Bell Siargao");
    expect(result.message).toContain("My pick");
    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_motorbike_places_down", "search_places"],
      ["call_motorbike_weak_web", "research_web"],
      ["auto_required_evidence_research_web_1", "research_web"],
    ]);
    expect(result.publicSources).toEqual([targetedWebSource]);
  });

  test("repairs thin structured answers for any evidence-backed place result", async () => {
    const cafeCard: RecommendationCard = {
      id: "place_cafe_general_luna",
      kind: "place",
      title: "General Luna Cafe",
      subtitle: "General Luna",
      mapsUrl: "https://maps.example/general-luna-cafe",
      openStatusLabel: "Open now",
      fitReasons: ["Returned by checked Places evidence for cafes in General Luna."],
      caveats: ["Confirm seating and current kitchen hours before walking over."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_cafe_places_call",
        requestId: "req_cafe_places_call",
        callId: "call_cafe_places",
        name: "search_places",
        arguments: {
          query: "cafes in General Luna Siargao",
          constraints: { included_type: "cafe", open_now: null, page_size: 5 },
        },
      }),
      {
        id: "resp_cafe_bad_final",
        output_text: finalPayloadText({
          answer: "General Luna Cafe is a good cafe option. If you want, I can pull map links.",
          usedToolCallIds: ["call_cafe_places"],
          displayCardIds: [cafeCard.id],
        }),
        _request_id: "req_cafe_bad_final",
      },
      {
        id: "resp_cafe_quality_repaired_final",
        output_text: finalPayloadText({
          answer: [
            "Best cafe result in **General Luna**:",
            "",
            "| Place | Area | Why it fits | Practical note |",
            "| --- | --- | --- | --- |",
            "| **General Luna Cafe** | General Luna | Checked Places result for cafes nearby | Open now in the Places result; use the map card and confirm seating/current kitchen hours before walking over. |",
            "",
            "First move: open the map card for **General Luna Cafe** and message or call if you need a table immediately.",
          ].join("\n"),
          usedToolCallIds: ["call_cafe_places"],
          displayCardIds: [cafeCard.id],
        }),
        _request_id: "req_cafe_quality_repaired_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned cafes in General Luna.",
        sources: [placesSourceSummary],
        cards: [cafeCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "what cafes are good in General Luna?" }],
        requestId: "agent_request_cafe_structured_quality",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("| Place | Area | Why it fits | Practical note |");
    expect(result.message).toContain("First move");
    expect(result.cards).toEqual([cafeCard]);
    expect(result.publicSources).toEqual([placesSourceSummary]);
    expect(client.requests).toHaveLength(3);
    expect(JSON.stringify(parseFirstInput(client.requests[2]?.input))).toContain(
      "validationRepairStructuredAnswerQuality",
    );
  });

  test("keeps successful Places evidence when model-selected web research fails", async () => {
    const webUnavailableSource: AnswerSourceSummary = {
      label: "provider_unavailable",
      sourceName: "Public web research",
      sourceProfileId: "source_web_research",
      confidence: "low",
      checked: [],
      notChecked: ["current public web scooter rental evidence"],
    };
    const scooterPlaceCard: RecommendationCard = {
      id: "place_general_luna_scooters",
      kind: "place",
      title: "General Luna Scooters",
      subtitle: "General Luna",
      mapsUrl: "https://maps.example/general-luna-scooters",
      fitReasons: ["Returned by Google Places after public web research failed."],
      caveats: ["Public web research was unavailable; call ahead before relying on it."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_scooter_web_failed_places_ok",
        _request_id: "req_scooter_web_failed_places_ok",
        output: [
          {
            type: "function_call",
            call_id: "call_scooter_web_failed",
            name: "research_web",
            arguments: JSON.stringify({
              query:
                "scooter rental in General Luna Siargao Golden Bell Morenta Siargao Motorbike Rentals rates contact WhatsApp deposit helmet delivery",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
          {
            type: "function_call",
            call_id: "call_scooter_places_ok",
            name: "search_places",
            arguments: JSON.stringify({
              query: "scooter rental General Luna Siargao",
              constraints: { included_type: "car_rental", open_now: null, page_size: 5 },
            }),
          },
        ],
      },
      {
        id: "resp_scooter_web_failed_places_final",
        output_text: finalPayloadText({
          answer:
            "Google Places returned General Luna Scooters. I could not verify public web evidence, so confirm the current rate and deposit before going.",
          usedToolCallIds: ["call_scooter_web_failed", "call_scooter_places_ok"],
          displayCardIds: [scooterPlaceCard.id],
        }),
        _request_id: "req_scooter_web_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      research_web: {
        name: "research_web",
        status: "error",
        text: "Public web research provider unavailable.",
        errorCode: "provider_unavailable",
        data: { status: "provider_unavailable" },
        sources: [webUnavailableSource],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned scooter rental options.",
        sources: [placesSourceSummary],
        cards: [scooterPlaceCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can I rent a scooter in General Luna?" }],
        requestId: "agent_request_scooter_web_failed_places_ok",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("General Luna Scooters");
    expect(result.message).not.toBe(
      "I could not verify current public web evidence for this request.",
    );
    expect(result.toolCalls.map((toolCall) => [toolCall.name, toolCall.status])).toEqual([
      ["research_web", "error"],
      ["search_places", "success"],
    ]);
    expect(result.cards).toEqual([scooterPlaceCard]);
    expect(result.publicSources).toEqual([webUnavailableSource, placesSourceSummary]);
  });

  test("keeps successful web research when model-selected Places lookup fails", async () => {
    const scooterWebSource: AnswerSourceSummary = {
      label: "directory_checked",
      sourceName: "Public scooter rental directory",
      sourceProfileId: "source_web_directory",
      fetchedAt: "2026-07-01T09:00:00.000Z",
      confidence: "medium",
      checked: ["General Luna scooter rental listings"],
      notChecked: ["Google Maps details", "walk-in availability"],
    };
    const placesUnavailableSource: AnswerSourceSummary = {
      label: "provider_unavailable",
      sourceName: "Google Places",
      sourceProfileId: "source_google_places",
      confidence: "low",
      checked: [],
      notChecked: ["Google Places lookup"],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_scooter_web_ok_places_failed",
        _request_id: "req_scooter_web_ok_places_failed",
        output: [
          {
            type: "function_call",
            call_id: "call_scooter_web_ok",
            name: "research_web",
            arguments: JSON.stringify({
              query:
                "scooter rental in General Luna Siargao Golden Bell Morenta Siargao Motorbike Rentals rates contact WhatsApp deposit helmet delivery",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
          {
            type: "function_call",
            call_id: "call_scooter_places_failed",
            name: "search_places",
            arguments: JSON.stringify({
              query: "scooter rental General Luna Siargao",
              constraints: { included_type: "car_rental", open_now: null, page_size: 5 },
            }),
          },
        ],
      },
      {
        id: "resp_scooter_web_ok_places_failed_final",
        output_text: finalPayloadText({
          answer: [
            "| Rental shop | Area | Price signal | Contact / notes |",
            "| --- | --- | ---: | --- |",
            "| **General Luna scooter rental listings** | General Luna | Confirm current **₱/day rate** | Public web research found listings, but Google Places was unavailable, so verify the map pin before going. |",
            "| **Backup rental listing** | General Luna | Confirm rate before paying | Ask about helmet, deposit/passport rules, delivery or pickup, and opening hours. |",
            "| **Walk-in option** | General Luna | Varies | Use only as a fallback and check brakes, lights, horn, tire tread, and registration copy. |",
            "",
            "My pick: start with the public web listing that has the clearest contact details, then verify the map pin locally because Places was unavailable.",
          ].join("\n"),
          usedToolCallIds: ["call_scooter_web_ok", "call_scooter_places_failed"],
          displayCardIds: [],
        }),
        _request_id: "req_scooter_web_ok_places_failed_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      research_web: {
        name: "research_web",
        status: "success",
        text: "Public web research returned General Luna scooter rental listings.",
        data: {
          status: "available",
          findings: [
            {
              claim: "Public web research found General Luna scooter rental listings.",
              answerRole: "primary",
            },
          ],
        },
        sources: [scooterWebSource],
      },
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places unavailable.",
        errorCode: "provider_unavailable",
        data: { status: "provider_unavailable" },
        sources: [placesUnavailableSource],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "where can I rent a scooter in General Luna?" }],
        requestId: "agent_request_scooter_web_ok_places_failed",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("Public web research found");
    expect(result.toolCalls.map((toolCall) => [toolCall.name, toolCall.status])).toEqual([
      ["research_web", "success"],
      ["search_places", "error"],
    ]);
    expect(result.cards).toBeUndefined();
    expect(result.publicSources).toEqual([scooterWebSource, placesUnavailableSource]);
  });

  test("does not auto-inject required evidence before model tool choice", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_classifier_signals_final",
        output_text: finalPayloadText({
          answer: "For dinner tonight, use the places you already trust and re-check hours.",
          usedToolCallIds: [],
          displayCardIds: [],
        }),
        _request_id: "req_direct_classifier_signals_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      throw new Error(`Unexpected automatic tool call ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Best dinner in General Luna tonight?" }],
        requestId: "agent_request_no_auto_required_evidence",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toContain("re-check hours");
    expect(result.toolCalls).toEqual([]);
    expect(client.requests).toHaveLength(1);
  });

  test("waits for required upstream research before starting dependent Places enrichment", async () => {
    const currentDinnerPlacesSource: AnswerSourceSummary = {
      ...placesSourceSummary,
      checked: ["place identity", "map link", "open-now signal"],
    };
    const rootsCard: RecommendationCard = {
      id: "place_roots_siargao",
      kind: "place",
      title: "Roots Siargao",
      subtitle: "General Luna",
      mapsUrl: "https://maps.example/roots-siargao",
      fitReasons: ["Selected by current public web research before Places enrichment."],
      caveats: ["Confirm table availability before walking over."],
      sourceLabel: "Google Places - live checked",
      sources: [currentDinnerPlacesSource],
    };
    const disallowedCard: RecommendationCard = {
      ...rootsCard,
      id: "place_random_bar",
      title: "Random Bar",
      fitReasons: ["Unrelated Places candidate that should not pass the contract allowlist."],
    };
    const events: string[] = [];
    let researchCompleted = false;
    const client = fakeResponsesClient([
      {
        id: "resp_current_dinner_batched_tools",
        _request_id: "req_current_dinner_batched_tools",
        output: [
          {
            type: "function_call",
            call_id: "call_current_dinner_research",
            name: "research_web",
            arguments: JSON.stringify({
              query: "what is the current dinner pop-up in General Luna tonight",
              intent: "recommendation",
              location: "General Luna",
            }),
          },
          {
            type: "function_call",
            call_id: "call_current_dinner_places",
            name: "search_places",
            arguments: JSON.stringify({
              query: "dinner pop-up General Luna Siargao",
              center: { latitude: 9.8006, longitude: 126.1586 },
              radius_meters: 12_000,
              constraints: { included_type: "restaurant", open_now: true, page_size: 8 },
            }),
          },
        ],
      },
      {
        id: "resp_current_dinner_final",
        output_text: finalPayloadText({
          answer:
            "Roots Siargao is the strongest current dinner candidate tonight based on public web research and checked Places details.",
          usedToolCallIds: ["call_current_dinner_research", "call_current_dinner_places"],
          displayCardIds: [rootsCard.id, disallowedCard.id],
        }),
        _request_id: "req_current_dinner_final",
      },
      {
        id: "resp_current_dinner_quality_final",
        output_text: finalPayloadText({
          answer: [
            "Current dinner lead in **General Luna**:",
            "",
            "| Place | Area | Why it fits | First move |",
            "| --- | --- | --- | --- |",
            "| **Roots Siargao** | General Luna | Current public web research selected it, then Places checked the matching venue details. | Use the map card and confirm table availability before walking over. |",
            "",
            "Skip unrelated candidates unless fresh evidence names them for tonight.",
          ].join("\n"),
          usedToolCallIds: ["call_current_dinner_research", "call_current_dinner_places"],
          displayCardIds: [rootsCard.id, disallowedCard.id],
        }),
        _request_id: "req_current_dinner_quality_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "research_web") {
        events.push("research:start");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        researchCompleted = true;
        events.push("research:end");
        return {
          name: "research_web",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Public web research selected Roots Siargao.",
          data: {
            status: "available",
            entities: [
              {
                name: "Roots Siargao",
                kind: "place",
                area: "General Luna",
                needsPlacesEnrichment: true,
              },
            ],
            findings: [
              {
                claim: "Roots Siargao is the strongest current dinner candidate tonight.",
                answerRole: "primary",
              },
            ],
          },
          sources: [
            {
              label: "official_checked",
              sourceName: "Roots Siargao official channel",
              sourceProfileId: "source_web_official",
              confidence: "high",
              checked: ["current dinner pop-up signal"],
              notChecked: ["walk-in table availability"],
            },
          ],
        };
      }
      if (request.name === "search_places") {
        events.push(`places:start:${researchCompleted ? "after" : "before"}_research`);
        expect(researchCompleted).toBe(true);
        expect(String(request.arguments.query)).toContain("Roots Siargao");
        events.push("places:end");
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned the research-selected dinner place.",
          sources: [currentDinnerPlacesSource],
          cards: [rootsCard, disallowedCard],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          { role: "user", content: "What is the current dinner pop-up in General Luna tonight?" },
        ],
        requestId: "agent_request_current_dinner_ordered_evidence",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(events).toEqual([
      "research:start",
      "research:end",
      "places:start:after_research",
      "places:end",
    ]);
    expect(result.toolCalls.map((toolCall) => [toolCall.toolCallId, toolCall.name])).toEqual([
      ["call_current_dinner_research", "research_web"],
      ["call_current_dinner_places", "search_places"],
    ]);
    expect(result.cards?.map((card) => card.id)).toEqual([rootsCard.id]);
    expect(JSON.stringify(result.cards)).not.toContain(disallowedCard.title);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 1,
      unknownCardIds: [],
    });
  });

  test("keeps legacy plain-text compatibility without tool-result artifacts", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_legacy_artifact_call",
        requestId: "req_legacy_artifact_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: { query: "sandy swimming beaches within 30 minutes", filters: null },
      }),
      {
        id: "resp_legacy_artifact_final",
        output_text: "The model wrote a legacy plain-text answer.",
        _request_id: "req_legacy_artifact_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach.",
        sources: [localGuideSourceSummary],
        cards: [
          {
            id: "card_doot",
            kind: "beach",
            title: "Doot Beach",
            fitReasons: ["Sandy shore"],
            caveats: [],
            sourceLabel: "Ask Siargao curated local beach guide",
          },
        ],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_legacy_artifacts",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toBe("The model wrote a legacy plain-text answer.");
    expect(result.cards).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalCardCount: 1,
      unselectedCardCount: 1,
    });
  });

  test("selects named tool-result cards from default plain-text answers", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_plain_artifact_call",
        requestId: "req_plain_artifact_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: { query: "sandy swimming beaches within 30 minutes", filters: null },
      }),
      {
        id: "resp_plain_artifact_final",
        output_text: "Doot Beach is the best fit for a sandy, easier family beach stop.",
        _request_id: "req_plain_artifact_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach.",
        sources: [localGuideSourceSummary],
        cards: [
          {
            id: "card_doot",
            kind: "beach",
            title: "Doot Beach",
            fitReasons: ["Sandy shore"],
            caveats: [],
            sourceLabel: "Ask Siargao curated local beach guide",
          },
        ],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_plain_text_artifacts",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Doot Beach");
    expect(result.cards?.map((card) => card.title)).toEqual(["Doot Beach"]);
    expect(result.publicSources).toEqual([localGuideSourceSummary]);
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      selectedCardCount: 1,
      totalCardCount: 1,
      unselectedCardCount: 0,
    });
  });

  test("repairs legacy final text when structured final output is required", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_required_structured_legacy",
        output_text: "Legacy text should be repaired.",
        _request_id: "req_required_structured_legacy",
      },
      {
        id: "resp_required_structured_repaired",
        output_text: finalPayloadText({
          answer: "Start your first afternoon with an easy General Luna orientation walk.",
        }),
        _request_id: "req_required_structured_repaired",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_required_structured_legacy",
      },
      { client, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toBe(
      "Start your first afternoon with an easy General Luna orientation walk.",
    );
    expect(result.repairCount).toBe(1);
    expect(client.requests).toHaveLength(2);
    expect(client.requests.map((request) => request.text)).toEqual([
      { format: { type: "json_object" } },
      { format: { type: "json_object" } },
    ]);
    expect(JSON.stringify(parseFirstInput(client.requests[1]?.input))).toContain(
      "validationRepairStructuredFinalOutput",
    );
  });

  test("rejects repeated invalid final text after one structured-output repair", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_required_structured_legacy",
        output_text: "Legacy text should be repaired.",
        _request_id: "req_required_structured_legacy",
      },
      {
        id: "resp_required_structured_still_legacy",
        output_text: "The repair also returned legacy text.",
        _request_id: "req_required_structured_still_legacy",
      },
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
          requestId: "agent_request_required_structured_repeated_legacy",
        },
        { client, model: "gpt-test", requireStructuredFinalOutput: true },
      ),
    ).rejects.toThrow("legacy plain text");
    expect(client.requests).toHaveLength(2);
  });

  test("rejects unknown used tool call IDs in strict structured final output", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_unknown_used_tool",
        output_text: finalPayloadText({
          answer: "This payload cites a missing tool call.",
          usedToolCallIds: ["missing_call"],
        }),
        _request_id: "req_unknown_used_tool",
      },
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
          requestId: "agent_request_unknown_used_tool",
        },
        { client, model: "gpt-test", requireStructuredFinalOutput: true },
      ),
    ).rejects.toThrow("unknown tool call ID");
  });

  test("repairs surf answers by loading SURF.md before final prose", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_surf_memory_missing",
        output_text: finalPayloadText({
          answer: "Cloud 9 is the classic surf answer.",
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_surf_memory_missing",
      },
      {
        id: "resp_surf_memory_final",
        output_text: finalPayloadText({
          answer: "Cloud 9 is the classic surf answer.",
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_surf_memory_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Which surf spots should I consider?" }],
        requestId: "agent_request_surf_memory_repair",
      },
      {
        client,
        executeTool: memoryLoadExecutor(),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toContain("Cloud 9");
    expect(result.toolCalls).toContainEqual(
      expect.objectContaining({
        name: "load_agent_memory_file",
        toolCallId: "auto_required_memory_load_surf",
      }),
    );
    expect(parseAutomaticMemoryInput(client.requests[1]?.input).validationRepairMemoryLoad).toEqual(
      expect.objectContaining({
        name: "load_agent_memory_file",
        arguments: { documents: ["SURF.md"] },
      }),
    );
  });

  test("repairs clear memory answers after a non-memory tool call", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_surf_tool_first",
        requestId: "req_surf_tool_first",
        callId: "call_surf_tool",
        name: "rank_surf_spots_nearby",
        arguments: { skill_level: "beginner", max_results: 3 },
      }),
      {
        id: "resp_surf_memory_still_missing",
        output_text: finalPayloadText({
          answer: "Use Cloud 9 only if you want the famous break.",
          usedToolCallIds: ["call_surf_tool"],
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_surf_memory_still_missing",
      },
      {
        id: "resp_surf_memory_repaired",
        output_text: finalPayloadText({
          answer: "Use Cloud 9 only if you want the famous break.",
          usedToolCallIds: ["call_surf_tool"],
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_surf_memory_repaired",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Which surf spots should I consider?" }],
        requestId: "agent_request_surf_memory_after_tool_repair",
      },
      {
        client,
        executeTool: async (request) => {
          if (request.name === "load_agent_memory_file") {
            return memoryLoadExecutor()(request);
          }
          return {
            name: request.name,
            status: "success",
            text: "Ranked surf spots loaded.",
            toolCallId: request.toolCallId,
            sources: [],
          };
        },
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "rank_surf_spots_nearby",
      "load_agent_memory_file",
    ]);
    expect(parseAutomaticMemoryInput(client.requests[2]?.input).validationRepairMemoryLoad).toEqual(
      expect.objectContaining({
        name: "load_agent_memory_file",
        arguments: { documents: ["SURF.md"] },
      }),
    );
  });

  test("repairs beach guide answers by loading LOCAL_GUIDE_BEACHES.md", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_beach_memory_missing",
        output_text: finalPayloadText({
          answer: "Doot and Malinao are the easier sandy beach options.",
          usedMemoryFiles: ["LOCAL_GUIDE_BEACHES.md"],
        }),
        _request_id: "req_beach_memory_missing",
      },
      {
        id: "resp_beach_memory_final",
        output_text: finalPayloadText({
          answer: "Doot and Malinao are the easier sandy beach options.",
          usedMemoryFiles: ["LOCAL_GUIDE_BEACHES.md"],
        }),
        _request_id: "req_beach_memory_final",
      },
    ]);

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Which sandy beaches are good near General Luna?" }],
        requestId: "agent_request_beach_memory_repair",
      },
      {
        client,
        executeTool: memoryLoadExecutor(),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(parseAutomaticMemoryInput(client.requests[1]?.input).validationRepairMemoryLoad).toEqual(
      expect.objectContaining({
        name: "load_agent_memory_file",
        arguments: { documents: ["LOCAL_GUIDE_BEACHES.md"] },
      }),
    );
  });

  test("repairs source-policy answers by loading ASK_SIARGAO_SOURCE_POLICY.md", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_source_memory_missing",
        output_text: finalPayloadText({
          answer: "Memory alone cannot create checked source labels.",
          usedMemoryFiles: ["ASK_SIARGAO_SOURCE_POLICY.md"],
        }),
        _request_id: "req_source_memory_missing",
      },
      {
        id: "resp_source_memory_final",
        output_text: finalPayloadText({
          answer: "Memory alone cannot create checked source labels.",
          usedMemoryFiles: ["ASK_SIARGAO_SOURCE_POLICY.md"],
        }),
        _request_id: "req_source_memory_final",
      },
    ]);

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What source labels can you use?" }],
        requestId: "agent_request_source_memory_repair",
      },
      {
        client,
        executeTool: memoryLoadExecutor(),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(parseAutomaticMemoryInput(client.requests[1]?.input).validationRepairMemoryLoad).toEqual(
      expect.objectContaining({
        name: "load_agent_memory_file",
        arguments: { documents: ["ASK_SIARGAO_SOURCE_POLICY.md"] },
      }),
    );
  });

  test("keeps loaded source and tool memory out of traveler prose while preserving source metadata", async () => {
    const breakfastCard = recommendationCard({
      id: "place_dapa_breakfast_house",
      title: "Dapa Breakfast House",
      subtitle: "Dapa",
      fitReasons: ["Breakfast option returned by Google Places."],
      caveats: ["Call ahead for today's menu and seats."],
      sources: [placesSourceSummary],
    });
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_source_tool_memory_call",
        requestId: "req_source_tool_memory_call",
        callId: "call_source_tool_memory",
        name: "load_agent_memory_file",
        arguments: {
          documents: ["ASK_SIARGAO_SOURCE_POLICY.md", "ASK_SIARGAO_TOOL_USE_POLICY.md"],
        },
      }),
      responseWithToolCall({
        id: "resp_dapa_breakfast_places_call",
        requestId: "req_dapa_breakfast_places_call",
        callId: "call_dapa_breakfast_places",
        name: "search_places",
        arguments: {
          query: "breakfast in Dapa Siargao",
          constraints: { included_type: "restaurant", open_now: null, page_size: 5 },
        },
      }),
      {
        id: "resp_dapa_breakfast_memory_aligned_final",
        output_text: finalPayloadText({
          answer:
            "For breakfast in Dapa, start with Dapa Breakfast House and call ahead for today's menu and seats.",
          usedMemoryFiles: ["ASK_SIARGAO_SOURCE_POLICY.md", "ASK_SIARGAO_TOOL_USE_POLICY.md"],
          usedToolCallIds: ["call_dapa_breakfast_places"],
          displayCardIds: [breakfastCard.id],
        }),
        _request_id: "req_dapa_breakfast_memory_aligned_final",
      },
    ]);
    const memorySnapshot = loadAgentMemorySnapshot({ rootDir: process.cwd() });
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "load_agent_memory_file") {
        return executeAgentTool(request, { memorySnapshot });
      }
      if (request.name === "search_places") {
        return {
          name: "search_places",
          toolCallId: request.toolCallId,
          status: "success",
          text: "Google Places returned a Dapa breakfast option.",
          sources: [placesSourceSummary],
          cards: [breakfastCard],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Breakfast in Dapa now, should I call ahead?" }],
        requestId: "agent_request_source_tool_memory_contract",
      },
      {
        client,
        executeTool,
        memorySnapshot,
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "load_agent_memory_file",
      "search_places",
    ]);
    expect(result.message).toContain("call ahead");
    expect(result.message).not.toContain("Checked:");
    expect(result.message).not.toContain("Not checked:");
    assertTravelerProseHasNoInternalMechanics(result.message);
    expect(result.publicSources).toEqual([placesSourceSummary]);
    expect(result.cards).toEqual([breakfastCard]);
    expect(result.cards?.[0]?.sources?.[0]?.checked).toEqual(["place identity", "map link"]);
    expect(result.cards?.[0]?.sources?.[0]?.notChecked).toEqual(["review text", "bookings"]);
    expect(result.memory?.files.map((file) => file.fileName)).toContain(
      "ASK_SIARGAO_SOURCE_POLICY.md",
    );
  });

  test("keeps loaded source and tool memory free of final-prose footer instructions", () => {
    const memorySnapshot = loadAgentMemorySnapshot({ rootDir: process.cwd() });
    const sourcePolicy = requiredMemoryContent(memorySnapshot, "ASK_SIARGAO_SOURCE_POLICY.md");
    const toolUsePolicy = requiredMemoryContent(memorySnapshot, "ASK_SIARGAO_TOOL_USE_POLICY.md");
    const nightlifeMemory = requiredMemoryContent(memorySnapshot, "NIGHTLIFE.md");
    const modelFacingSourceToolMemory = [sourcePolicy, toolUsePolicy].join("\n\n");

    expect(modelFacingSourceToolMemory).not.toMatch(/\bUse\s+["'`]Checked:/i);
    expect(modelFacingSourceToolMemory).not.toMatch(/\bUse\s+["'`]Not checked:/i);
    expect(modelFacingSourceToolMemory).not.toMatch(
      /(^|\n)\s*Checked:\s+[^\n]+(?:\n[^\n]*){0,4}\n\s*Not checked:/i,
    );
    expect(sourcePolicy).toContain("AnswerSourceSummary.checked");
    expect(sourcePolicy).toContain("AnswerSourceSummary.notChecked");
    expect(nightlifeMemory).toContain(
      "Structured source boundary for metadata, not normal traveler prose:",
    );
    expect(nightlifeMemory).toContain(
      "checked: event schedule sources and Google Places venue details.",
    );
    expect(nightlifeMemory).toContain("notChecked: live crowd size");
  });

  test("does not force beach or surf memory for breakfast place prompts", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_breakfast_no_memory",
        output_text: finalPayloadText({
          answer: "For breakfast in Dapa, use a Places check for current options.",
        }),
        _request_id: "req_breakfast_no_memory",
      },
    ]);

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "I'll go to Dapa later, good places for breakfast?" }],
        requestId: "agent_request_breakfast_no_memory",
      },
      {
        client,
        executeTool: memoryLoadExecutor(),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(client.requests).toHaveLength(1);
  });

  test("rejects unobserved used memory files in strict structured final output", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_unknown_memory_strict",
        output_text: finalPayloadText({
          answer: "First afternoon answer.",
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_unknown_memory_strict",
      },
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
          requestId: "agent_request_unknown_memory_strict",
        },
        { client, model: "gpt-test", requireStructuredFinalOutput: true },
      ),
    ).rejects.toThrow("memory file(s) not loaded or returned this turn: SURF.md");
  });

  test("drops and logs unobserved used memory files in compatibility mode", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_unknown_memory_compat",
        output_text: finalPayloadText({
          answer: "First afternoon answer.",
          usedMemoryFiles: ["SURF.md"],
        }),
        _request_id: "req_unknown_memory_compat",
      },
    ]);
    const logs = captureLogger();

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_unknown_memory_compat",
      },
      { client, logger: logs.logger, model: "gpt-test" },
    );

    expect(result.message).toBe("First afternoon answer.");
    expect(logs.events).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Agent final payload referenced unobserved memory file(s).",
        payload: { usedMemoryFiles: ["SURF.md"] },
      }),
    );
  });

  test("logs and drops unknown used tool call IDs in compatibility mode", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_unknown_used_tool_compat",
        output_text: finalPayloadText({
          answer: "First afternoon answer.",
          usedToolCallIds: ["missing_call"],
        }),
        _request_id: "req_unknown_used_tool_compat",
      },
    ]);
    const logs = captureLogger();

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How should I spend my first afternoon?" }],
        requestId: "agent_request_unknown_tool_compat",
      },
      { client, logger: logs.logger, model: "gpt-test" },
    );

    expect(result.message).toBe("First afternoon answer.");
    expect(logs.events).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Agent final payload referenced unknown tool call ID(s).",
        payload: { usedToolCallIds: ["missing_call"] },
      }),
    );
  });

  test("registers hosted file search when a vector store is configured", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_general",
        output_text: "Use memory policy, then answer concisely.",
        _request_id: "req_general",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "How do your source labels work?" }],
        requestId: "agent_request_file_search",
      },
      {
        client,
        agentMemoryVectorStoreId: "vs_memory",
        model: "gpt-test",
      },
    );

    expect(client.requests[0]?.tools).toContainEqual({
      type: "file_search",
      vector_store_ids: ["vs_memory"],
      max_num_results: 5,
    });
    expect(client.requests[0]?.include).toEqual(["file_search_call.results"]);
    expect(client.requests[0]?.tools).not.toContainEqual(
      expect.objectContaining({ name: "search_agent_memory" }),
    );
    expect(result.memory?.vectorStoreId).toBe("vs_memory");
    const firstInput = parseFirstInput(client.requests[0]?.input);
    expect(firstInput.agentMemory?.vectorStoreId).toBeUndefined();
    expect(JSON.stringify(firstInput.agentMemory)).not.toContain("vs_memory");
  });

  test("accepts hosted file-search memory results as observed used memory files", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_file_search_memory",
        output_text: finalPayloadText({
          answer: "Memory retrieval does not create checked source labels.",
          usedMemoryFiles: ["ASK_SIARGAO_SOURCE_POLICY.md"],
        }),
        output: [
          {
            type: "file_search_call",
            id: "fs_source_policy",
            queries: ["source labels"],
            status: "completed",
            results: [
              {
                filename: "ASK_SIARGAO_SOURCE_POLICY.md",
                attributes: {
                  agent_memory_file_name: "ASK_SIARGAO_SOURCE_POLICY.md",
                },
              },
            ],
          },
        ],
        _request_id: "req_file_search_memory",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What source labels can you use?" }],
        requestId: "agent_request_file_search_memory",
      },
      {
        client,
        agentMemoryVectorStoreId: "vs_memory",
        memorySnapshot: memorySnapshotFixture(),
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toContain("Memory retrieval");
    expect(result.toolCalls).toEqual([]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.include).toEqual(["file_search_call.results"]);
  });

  test("binds the resolved memory snapshot into backend memory tool calls", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_memory_call",
        requestId: "req_memory_call",
        callId: "call_memory",
        name: "search_agent_memory",
        arguments: { query: "resolved snapshot needle", max_results: 1 },
      }),
      {
        id: "resp_memory_final",
        output_text: "Used the resolved memory snapshot.",
        _request_id: "req_memory_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What does the source policy say?" }],
        requestId: "agent_request_bound_memory",
      },
      {
        client,
        loadMemorySnapshot: () =>
          memorySnapshotFixture({
            sourcePolicyContent: "Resolved snapshot needle only exists in this loaded snapshot.",
          }),
        model: "gpt-test",
      },
    );

    expect(result.memory?.versionId).toBe("agent-memory:testmemory000000000000");
    expect(parseToolOutput(client.requests[1]?.input, 0).text).toContain(
      "Resolved snapshot needle",
    );
  });

  test("executes a weather tool call and feeds the result back to the model", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_weather_call",
        requestId: "req_weather_call",
        callId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      {
        id: "resp_weather_final",
        output_text: "Plan the beach window early, then keep a covered fallback for showers.",
        _request_id: "req_weather_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded: showers possible in the afternoon.",
        sources: [weatherSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is today good for a beach plan?" }],
        requestId: "agent_request_weather",
      },
      {
        client,
        executeTool,
        model: "gpt-test",
        now: steppedClock(["2026-06-26T00:00:00.000Z", "2026-06-26T00:00:00.042Z"]),
      },
    );

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.previous_response_id).toBeUndefined();
    expect(client.requests[1]?.store).toBe(false);
    expect(client.requests[1]?.instructions).toBe(client.requests[0]?.instructions);
    expect(String(client.requests[1]?.instructions)).toContain(
      "Use backend tools whenever the answer needs current weather",
    );
    expect(responseInputItemsByType(client.requests[1]?.input, "function_call")).toContainEqual(
      expect.objectContaining({
        call_id: "call_weather",
      }),
    );
    expect(responseInputItemsByType(client.requests[1]?.input, "function_call_output")).toEqual([
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_weather",
      }),
    ]);
    expect(parseToolOutput(client.requests[1]?.input, 0).text).toContain("Open-Meteo");
    expect(result.message).toContain("covered fallback");
    expect(result.upstreamRequestIds).toEqual(["req_weather_call", "req_weather_final"]);
    expect(result.toolCalls[0]).toMatchObject({
      toolCallId: "call_weather",
      name: "get_weather_forecast",
      status: "success",
      durationMs: 42,
      providerOperation: "open_meteo.forecast",
      sourceProfileIds: ["source_open_meteo"],
    });
    expect(result.sources).toEqual([weatherSourceSummary]);
  });

  test("does not pass raw browser geolocation into non-Places tool executors", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_weather_location_call",
        requestId: "req_weather_location_call",
        callId: "call_weather_location",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      {
        id: "resp_weather_location_final",
        output_text: "Weather checked without exposing exact browser coordinates.",
        _request_id: "req_weather_location_final",
      },
    ]);
    const toolRequests: Parameters<AgentToolExecutor>[0][] = [];

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is today good for a beach plan?" }],
        requestId: "agent_request_weather_location",
        clientContext: {
          geolocation: {
            status: "available",
            source: "browser_geolocation",
            consentScope: "single_request",
            latitude: 9.8123,
            longitude: 126.1664,
            accuracyMeters: 20,
            capturedAt: "2026-06-26T00:00:00.000Z",
          },
        },
      },
      {
        client,
        executeTool: async (request) => {
          toolRequests.push(request);
          return {
            name: request.name,
            status: "success",
            text: "Open-Meteo forecast loaded.",
            sources: [weatherSourceSummary],
          };
        },
        model: "gpt-test",
      },
    );

    expect(toolRequests[0]?.clientContext).toBeUndefined();
    expect(JSON.stringify(toolRequests)).not.toContain("9.8123");
    expect(JSON.stringify(toolRequests)).not.toContain("126.1664");
  });

  test("repairs near-me Places tool calls to use consented browser geolocation", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_near_me_places_call",
        requestId: "req_near_me_places_call",
        callId: "call_places_near_me",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          radius_meters: 2_500,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_near_me_places_final",
        output_text: "I checked nearby restaurants using your shared location.",
        _request_id: "req_near_me_places_final",
      },
    ]);
    const toolRequests: Parameters<AgentToolExecutor>[0][] = [];
    const browserCenter = { latitude: 9.8123, longitude: 126.1664 };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What restaurants are open near me?" }],
        requestId: "agent_request_near_me_places",
        clientContext: {
          geolocation: {
            status: "available",
            source: "browser_geolocation",
            consentScope: "single_request",
            ...browserCenter,
            accuracyMeters: 20,
            capturedAt: "2026-06-26T00:00:00.000Z",
          },
        },
        deterministicSignals: {
          clientContext: {
            geolocation: {
              status: "available",
              source: "browser_geolocation",
              consentScope: "single_request",
              ...browserCenter,
            },
          },
        },
      },
      {
        client,
        executeTool: async (request) => {
          toolRequests.push(request);
          return {
            name: request.name,
            status: "success",
            text: "Google Places returned nearby restaurants.",
            data: {
              centerSource: "browser_geolocation",
              search: {
                center: browserCenter,
              },
            },
            sources: [openNowPlacesSourceSummary],
          };
        },
        model: "gpt-test",
      },
    );

    expect(result.message).toContain("shared location");
    const firstInput = parseFirstInput(client.requests[0]?.input);
    expect(firstInput.deterministicSignals?.clientContext).toEqual({
      geolocation: {
        status: "available",
        source: "browser_geolocation",
        consentScope: "single_request",
        centerSource: "browser_geolocation",
      },
    });
    const toolOutput = parseToolOutput(client.requests[1]?.input, 0);
    expect(toolOutput.data).toMatchObject({
      search: {
        center: { source: "browser_geolocation" },
      },
    });
    expect(toolRequests[0]).toMatchObject({
      name: "search_places",
      arguments: {
        query: "restaurants open now",
      },
      toolContext: {
        googlePlaces: {
          center: browserCenter,
          centerSource: "browser_geolocation",
          cacheMode: "no_store",
          consentScope: "single_request",
        },
      },
    });
    expect(toolRequests[0]?.clientContext).toBeUndefined();
    expect(toolRequests[0]?.arguments).not.toHaveProperty("center");
    expect(result.toolCalls[0]).toMatchObject({
      name: "search_places",
      arguments: {
        center: { source: "browser_geolocation" },
      },
    });
    expect(JSON.stringify(result.toolCalls)).not.toContain("9.8123");
    expect(JSON.stringify(result.toolCalls)).not.toContain("126.1664");
    expect(JSON.stringify(firstInput)).not.toContain("9.8123");
    expect(JSON.stringify(firstInput)).not.toContain("126.1664");
    expect(JSON.stringify(toolOutput)).not.toContain("9.8123");
    expect(JSON.stringify(toolOutput)).not.toContain("126.1664");
  });

  test("repairs equivalent nearby phrasing with browser geolocation", async () => {
    for (const prompt of [
      "What's open around here?",
      "Closest cafe?",
      "Any restaurants near us?",
    ]) {
      const client = fakeResponsesClient([
        responseWithToolCall({
          id: `resp_places_${prompt}`,
          requestId: `req_places_${prompt}`,
          callId: `call_places_${prompt}`,
          name: "search_places",
          arguments: {
            query: "cafes open now",
            center: { latitude: 9.784, longitude: 126.158 },
            radius_meters: 2_500,
            constraints: { open_now: true },
          },
        }),
        {
          id: `resp_final_${prompt}`,
          output_text: "Used your shared location for nearby places.",
          _request_id: `req_final_${prompt}`,
        },
      ]);
      const toolRequests: Parameters<AgentToolExecutor>[0][] = [];
      const browserCenter = { latitude: 9.8123, longitude: 126.1664 };

      await runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: prompt }],
          requestId: `agent_request_${prompt}`,
          clientContext: {
            geolocation: {
              status: "available",
              source: "browser_geolocation",
              consentScope: "single_request",
              ...browserCenter,
              capturedAt: "2026-06-26T00:00:00.000Z",
            },
          },
        },
        {
          client,
          executeTool: async (request) => {
            toolRequests.push(request);
            return {
              name: request.name,
              status: "success",
              text: "Google Places returned nearby venues.",
              sources: [openNowPlacesSourceSummary],
            };
          },
          model: "gpt-test",
        },
      );

      expect(toolRequests[0]?.toolContext?.googlePlaces?.center).toEqual(browserCenter);
      expect(toolRequests[0]?.toolContext?.googlePlaces?.centerSource).toBe("browser_geolocation");
    }
  });

  test("does not repair anchored relative-location prompts to browser geolocation", async () => {
    for (const scenario of [
      {
        prompt: "What's the closest cafe to Cloud 9?",
        query: "closest cafes",
        center: { latitude: 9.8116, longitude: 126.1651 },
      },
      {
        prompt: "Nearest ATM to Dapa ferry terminal?",
        query: "nearest ATMs",
        center: { latitude: 9.7604, longitude: 126.0523 },
      },
      {
        prompt: "Cafes nearby Cloud 9?",
        query: "cafes nearby",
        center: { latitude: 9.8116, longitude: 126.1651 },
      },
      {
        prompt: "Laundry close by Dapa ferry terminal?",
        query: "laundry close by",
        center: { latitude: 9.7604, longitude: 126.0523 },
      },
    ]) {
      const client = fakeResponsesClient([
        responseWithToolCall({
          id: `resp_places_anchored_${scenario.query}`,
          requestId: `req_places_anchored_${scenario.query}`,
          callId: `call_places_anchored_${scenario.query}`,
          name: "search_places",
          arguments: {
            query: scenario.query,
            center: scenario.center,
            radius_meters: 2_500,
            constraints: { page_size: 5 },
          },
        }),
        {
          id: `resp_final_anchored_${scenario.query}`,
          output_text: "Used the named anchor for the search.",
          _request_id: `req_final_anchored_${scenario.query}`,
        },
      ]);
      const toolRequests: Parameters<AgentToolExecutor>[0][] = [];

      await runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: scenario.prompt }],
          requestId: `agent_request_anchored_${scenario.query}`,
          clientContext: {
            geolocation: {
              status: "available",
              source: "browser_geolocation",
              consentScope: "single_request",
              latitude: 9.8123,
              longitude: 126.1664,
              capturedAt: "2026-06-26T00:00:00.000Z",
            },
          },
        },
        {
          client,
          executeTool: async (request) => {
            toolRequests.push(request);
            return {
              name: request.name,
              status: "success",
              text: "Google Places returned anchored venues.",
              sources: [openNowPlacesSourceSummary],
            };
          },
          model: "gpt-test",
        },
      );

      expect(toolRequests[0]).toMatchObject({
        name: "search_places",
        arguments: {
          query: scenario.query,
          center: scenario.center,
        },
      });
      expect(toolRequests[0]?.toolContext).toBeUndefined();
    }
  });

  test("auto-executes surf spot ranking for closest near-me surf prompts", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_surf_condition",
        output_text: "Direct surf answer without condition evidence or distances.",
        _request_id: "req_direct_surf_condition",
      },
      {
        id: "resp_after_surf_condition",
        output_text: "Surf answer with condition evidence but still no ranked distances.",
        _request_id: "req_after_surf_condition",
      },
      {
        id: "resp_after_surf_ranking",
        output_text:
          "Closest surf spots from your shared location are Pacifico / Big Wish and Bamboo Garden, with approximate km distances.",
        _request_id: "req_after_surf_ranking",
      },
    ]);
    const browserCenter = { latitude: 9.952, longitude: 126.088 };
    const toolRequests: Parameters<AgentToolExecutor>[0][] = [];
    const executeTool: AgentToolExecutor = async (request) => {
      toolRequests.push(request);
      if (request.name === "get_condition_judgment") {
        return {
          name: request.name,
          status: "success",
          text: "Condition judgment: poor for surfing today.",
          sources: [weatherSourceSummary, conditionMarineSourceSummary],
        };
      }
      if (request.name === "rank_surf_spots_nearby") {
        return {
          name: request.name,
          status: "success",
          text: "Ranked surf spots: 1. Pacifico / Big Wish - About 0.2 km straight-line. 2. Bamboo Garden - About 0.3 km straight-line.",
          data: {
            centerSource: "browser_geolocation",
            spots: [
              {
                name: "Pacifico / Big Wish",
                distanceLabel: "About 0.2 km straight-line from your shared location.",
              },
              {
                name: "Bamboo Garden",
                distanceLabel: "About 0.3 km straight-line from your shared location.",
              },
            ],
          },
          sources: [localGuideSourceSummary],
        };
      }
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "I want to go surfing today what are the closest spots near me?",
          },
        ],
        requestId: "agent_request_auto_near_me_surf",
        clientContext: {
          geolocation: {
            status: "available",
            source: "browser_geolocation",
            consentScope: "trip_session",
            ...browserCenter,
            capturedAt: "2026-06-26T00:00:00.000Z",
          },
        },
        deterministicSignals: {
          intent: {
            nearMeUsesBrowserGeolocation: true,
            nearby: true,
            today: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Pacifico / Big Wish");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "get_condition_judgment",
      "rank_surf_spots_nearby",
    ]);
    expect(result.toolCalls[1]?.arguments).toEqual({
      skill_level: "any",
      max_results: 7,
      include_boat_access: false,
      center: { source: "browser_geolocation" },
    });
    expect(toolRequests[1]).toMatchObject({
      name: "rank_surf_spots_nearby",
      toolContext: {
        surfSpotRanking: {
          center: browserCenter,
          centerSource: "browser_geolocation",
          consentScope: "trip_session",
        },
      },
    });
    const automaticInput = parseLastUserInputMessage(client.requests[2]?.input);
    expect(automaticInput?.validationRepairSurfSpotRanking).toMatchObject({
      name: "rank_surf_spots_nearby",
    });
    const toolOutput = automaticInput?.validationRepairSurfSpotRanking as
      | { result?: Record<string, unknown> }
      | undefined;
    expect(toolOutput?.result?.data).toMatchObject({
      center: { source: "browser_geolocation" },
    });
    expect(JSON.stringify(result.toolCalls)).not.toContain("9.952");
    expect(JSON.stringify(result.toolCalls)).not.toContain("126.088");
    expect(JSON.stringify(client.requests)).not.toContain("9.952");
    expect(JSON.stringify(client.requests)).not.toContain("126.088");
  });

  test("waits for current surf conditions before dependent rankings and filters mixed cards", async () => {
    const rankedCard: RecommendationCard = recommendationCard({
      id: "card_ranked_intermediate_surf",
      title: "Ranked intermediate surf option",
      fitReasons: ["Matches the supplied intermediate level and shared-location ranking."],
      caveats: ["Exact-break safety needs local-coach confirmation."],
      kind: "beach",
      sourceLabel: "Ask Siargao surf reference",
      sources: [localGuideSourceSummary],
    });
    const unrelatedCard: RecommendationCard = recommendationCard({
      id: "card_unrelated_beginner_lesson",
      title: "Unrelated beginner lesson",
      fitReasons: ["A beginner option unrelated to the supplied level."],
      caveats: ["Not selected for this session."],
      kind: "beach",
      sourceLabel: "Ask Siargao surf reference",
      sources: [localGuideSourceSummary],
    });
    const client = fakeResponsesClient([
      {
        id: "resp_ordered_surf_calls",
        _request_id: "req_ordered_surf_calls",
        output: [
          {
            type: "function_call",
            call_id: "call_surf_memory",
            name: "load_agent_memory_file",
            arguments: JSON.stringify({ documents: ["SURF.md"] }),
          },
          {
            type: "function_call",
            call_id: "call_surf_condition",
            name: "get_condition_judgment",
            arguments: JSON.stringify({
              activity: "surfing",
              location: "Siargao Island",
              date_range: "today",
              beach_name: null,
              include_local_caveats: null,
              constraints: ["intermediate"],
            }),
          },
          {
            type: "function_call",
            call_id: "call_surf_ranking",
            name: "rank_surf_spots_nearby",
            arguments: JSON.stringify({
              skill_level: "intermediate",
              max_results: 3,
              include_boat_access: false,
            }),
          },
          {
            type: "function_call",
            call_id: "call_unrelated_surf_guide",
            name: "search_local_guide",
            arguments: JSON.stringify({ query: "beginner beach lesson", filters: null }),
          },
        ],
      },
      {
        id: "resp_ordered_surf_final",
        _request_id: "req_ordered_surf_final",
        output_text: finalPayloadText({
          answer:
            "Change the session: Ranked intermediate surf option is about 0.4 km from your shared location, but use it only after local-coach confirmation.",
          usedMemoryFiles: ["SURF.md"],
          usedToolCallIds: ["call_surf_condition", "call_surf_ranking"],
          displayCardIds: [rankedCard.id, unrelatedCard.id],
          realityCheck: {
            kind: "surf_session",
            verdict: "change",
            subject: "Intermediate surf near my location today",
            bestAction: "Use the ranked option only after local-coach confirmation.",
            basis: "The current modelled sea conditions support a conditional session.",
            fallback: "Skip the session if the exact break looks unsuitable on arrival.",
            avoid: "Do not treat modelled conditions as a safe-to-surf guarantee.",
            timing: "today",
            area: "near the shared location",
            evidenceToolCallIds: ["call_surf_condition"],
          },
        }),
      },
    ]);
    let conditionStartedResolve: (() => void) | undefined;
    let conditionResultResolve: ((result: AgentToolResult) => void) | undefined;
    const conditionStarted = new Promise<void>((resolve) => {
      conditionStartedResolve = resolve;
    });
    const conditionResult = new Promise<AgentToolResult>((resolve) => {
      conditionResultResolve = resolve;
    });
    let rankingStarted = false;
    let localGuideStarted = false;
    const memoryExecutor = memoryLoadExecutor();
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "get_condition_judgment") {
        conditionStartedResolve?.();
        return conditionResult;
      }
      if (request.name === "rank_surf_spots_nearby") {
        rankingStarted = true;
        return {
          name: request.name,
          status: "success",
          text: "Ranked current intermediate surf options.",
          data: {
            centerSource: "browser_geolocation",
            spots: [
              {
                name: rankedCard.title,
                distanceLabel: "About 0.4 km straight-line from your shared location.",
              },
            ],
          },
          sources: [localGuideSourceSummary],
          cards: [rankedCard],
        };
      }
      if (request.name === "search_local_guide") {
        localGuideStarted = true;
        return {
          name: request.name,
          status: "success",
          text: "Returned an unrelated beginner option.",
          sources: [localGuideSourceSummary],
          cards: [unrelatedCard],
        };
      }
      if (request.name === "load_agent_memory_file") {
        return memoryExecutor(request);
      }
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };
    const turnPromise = runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "As an intermediate surfer, should I surf near me today?",
          },
        ],
        requestId: "agent_request_ordered_surf_reality_check",
        clientContext: {
          geolocation: {
            status: "available",
            source: "browser_geolocation",
            consentScope: "single_request",
            latitude: 9.952,
            longitude: 126.088,
            capturedAt: "2026-08-03T08:00:00.000Z",
          },
        },
      },
      {
        client,
        executeTool,
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    await conditionStarted;
    await Promise.resolve();
    expect(rankingStarted).toBe(false);
    expect(localGuideStarted).toBe(false);
    conditionResultResolve?.({
      name: "get_condition_judgment",
      status: "success",
      text: "Current weather, modelled waves, and swell were checked.",
      sources: [weatherSourceSummary, marineCheckedSourceSummary],
    });

    const result = await turnPromise;

    expect(rankingStarted).toBe(true);
    expect(localGuideStarted).toBe(true);
    expect(result.cards?.map((card) => card.id)).toEqual([rankedCard.id]);
    expect(JSON.stringify(result)).not.toContain(unrelatedCard.title);
    expect(result.decisionSummaries?.[0]).toMatchObject({
      kind: "surf_session",
      verdict: "change",
      subject: "Intermediate surf near my location today",
    });
    expect(result.artifactSelection).toMatchObject({
      totalCardCount: 1,
      selectedCardCount: 1,
      unselectedCardCount: 0,
    });
  });

  test.each([
    {
      prompt: "Should we surf in Pacifico tomorrow morning?",
      answer: "What is the surfer's level: beginner, intermediate, or advanced?",
    },
    {
      prompt: "As an intermediate surfer, should I paddle out at Cloud 9?",
      answer: "When do you want to surf: today or tomorrow, and roughly what time?",
    },
  ])("asks for missing surf-session context before running tools: $prompt", async (scenario) => {
    const client = fakeResponsesClient([
      {
        id: "resp_missing_surf_context",
        _request_id: "req_missing_surf_context",
        output_text: finalPayloadText({ answer: "I need one detail first." }),
      },
    ]);
    let toolCallCount = 0;
    const executeTool: AgentToolExecutor = async (request) => {
      toolCallCount += 1;
      return {
        name: request.name,
        status: "error",
        text: "Unexpected tool call.",
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: scenario.prompt }],
        requestId: "agent_request_missing_surf_context",
      },
      {
        client,
        executeTool,
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toBe(scenario.answer);
    expect(result.toolCalls).toEqual([]);
    expect(toolCallCount).toBe(0);
  });

  test("returns needs-confirmation when surf condition providers are unavailable", async () => {
    const marineUnavailable: AnswerSourceSummary = {
      label: "provider_unavailable",
      sourceName: "Open-Meteo Marine API",
      sourceProfileId: "source_open_meteo_marine",
      confidence: "low",
      checked: [],
      notChecked: ["modelled waves and swell"],
    };
    const client = fakeResponsesClient([
      {
        id: "resp_unavailable_surf_calls",
        _request_id: "req_unavailable_surf_calls",
        output: [
          {
            type: "function_call",
            call_id: "call_unavailable_surf_memory",
            name: "load_agent_memory_file",
            arguments: JSON.stringify({ documents: ["SURF.md"] }),
          },
          {
            type: "function_call",
            call_id: "call_unavailable_surf_condition",
            name: "get_condition_judgment",
            arguments: JSON.stringify({
              activity: "surfing",
              location: "Siargao Island",
              date_range: "next_7_days",
              beach_name: "Pacifico Beach",
              include_local_caveats: true,
              constraints: ["beginner"],
            }),
          },
        ],
      },
      {
        id: "resp_unavailable_surf_final",
        _request_id: "req_unavailable_surf_final",
        output_text: finalPayloadText({
          answer: "Confirm the beginner window with a local coach before booking.",
          usedMemoryFiles: ["SURF.md"],
          usedToolCallIds: ["call_unavailable_surf_condition"],
          displayCardIds: ["card_unsupported_surf"],
          realityCheck: {
            kind: "surf_session",
            verdict: "needs_confirmation",
            subject: "Pacifico beginner surf tomorrow morning",
            bestAction: "Confirm the beginner window with a local coach before booking.",
            basis: "The current modelled sea conditions could not be established.",
            fallback: "Use a land-based activity if no coach can confirm the session.",
            avoid: "Do not paddle out without local confirmation.",
            timing: "tomorrow morning",
            area: "Pacifico",
            evidenceToolCallIds: ["call_unavailable_surf_condition"],
          },
        }),
      },
    ]);
    const memoryExecutor = memoryLoadExecutor();
    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Beginner surf in Pacifico tomorrow morning: is it worth booking?",
          },
        ],
        requestId: "agent_request_unavailable_surf_reality_check",
      },
      {
        client,
        executeTool: async (request) => {
          if (request.name === "load_agent_memory_file") {
            return memoryExecutor(request);
          }
          return {
            name: request.name,
            status: "success",
            text: "Current surf condition providers were unavailable.",
            sources: [weatherProviderUnavailableSourceSummary, marineUnavailable],
            cards: [
              recommendationCard({
                id: "card_unsupported_surf",
                title: "Unsupported surf recommendation",
                kind: "beach",
                fitReasons: ["No current provider support."],
                caveats: ["Current conditions unavailable."],
                sourceLabel: "Provider unavailable",
                sources: [marineUnavailable],
              }),
            ],
          };
        },
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.decisionSummaries?.[0]).toMatchObject({
      kind: "surf_session",
      verdict: "needs_confirmation",
      subject: "Pacifico beginner surf tomorrow morning",
    });
    expect(result.cards).toBeUndefined();
    expect(result.publicSources).toEqual([
      weatherProviderUnavailableSourceSummary,
      marineUnavailable,
    ]);
  });

  test("orders disruption evidence before replacements and filters adversarial mixed artifacts", async () => {
    const replacementCard = recommendationCard({
      id: "card_cancelled_tour_replacement",
      title: "Covered General Luna stop",
      fitReasons: ["Works as a land-based replacement for the traveler-reported cancellation."],
      caveats: ["Confirm current space before leaving."],
    });
    const unrelatedCard = recommendationCard({
      id: "card_cancelled_tour_unrelated",
      title: "Unrelated island-hopping operator",
      fitReasons: ["Not selected as the replacement."],
      caveats: ["The original island plan was cancelled."],
    });
    const replacementPlan: ItineraryPlan = {
      id: "itinerary:cancelled_tour:covered_general_luna",
      title: "Covered General Luna Replacement",
      durationLabel: "half day",
      stops: [
        {
          title: "Covered General Luna stop",
          kind: "activity",
          sequence: 1,
          area: "General Luna",
          rationale: "Keeps the replacement on land and close to services.",
          caveats: ["Confirm current opening before leaving."],
        },
      ],
      fallbackStops: [],
      skip: ["Do not chase another exposed boat departure in poor conditions."],
      sources: [localGuideSourceSummary, weatherSourceSummary],
    };
    const unrelatedPlan: ItineraryPlan = {
      ...replacementPlan,
      id: "itinerary:cancelled_tour:unrelated_boat",
      title: "Unrelated Boat Replacement",
    };
    const client = fakeResponsesClient([
      {
        id: "resp_disruption_ordered_calls",
        _request_id: "req_disruption_ordered_calls",
        output: [
          {
            type: "function_call",
            call_id: "call_disruption_condition",
            name: "get_condition_judgment",
            arguments: JSON.stringify({
              activity: "boat_trip",
              location: "Siargao Island",
              date_range: "today",
              beach_name: null,
              include_local_caveats: true,
              constraints: ["cancelled island tour"],
            }),
          },
          {
            type: "function_call",
            call_id: "call_disruption_plan",
            name: "plan_local_itinerary",
            arguments: JSON.stringify({
              theme: "rainy_cloud_9_afternoon",
              origin: "General Luna",
              duration_hours: 4,
              needs_weather_check: true,
            }),
          },
          {
            type: "function_call",
            call_id: "call_disruption_places",
            name: "search_places",
            arguments: JSON.stringify({
              query: "covered activities General Luna Siargao",
              center: { latitude: 9.784, longitude: 126.158 },
              radius_meters: 4000,
              constraints: { included_type: null, open_now: true, page_size: 5 },
            }),
          },
          {
            type: "function_call",
            call_id: "call_disruption_unrelated",
            name: "search_local_guide",
            arguments: JSON.stringify({ query: "another island tour", filters: null }),
          },
        ],
      },
      {
        id: "resp_disruption_ordered_final",
        _request_id: "req_disruption_ordered_final",
        output_text: finalPayloadText({
          answer: "Use the covered General Luna replacement and keep the boat plan off today.",
          usedToolCallIds: [
            "call_disruption_condition",
            "call_disruption_plan",
            "call_disruption_places",
          ],
          displayCardIds: [replacementCard.id, unrelatedCard.id],
          displayItineraryIds: [replacementPlan.id ?? "", unrelatedPlan.id ?? ""],
          realityCheck: {
            kind: "disruption_recovery",
            verdict: "change",
            subject: "Traveler-reported cancelled island tour",
            bestAction: "Use the covered General Luna replacement today.",
            basis: "Current conditions and governed local options support a land-based half day.",
            fallback: "Stay near General Luna and confirm current opening before leaving.",
            avoid: "Avoid relying on another boat departure today.",
            timing: "today",
            area: "General Luna",
            evidenceToolCallIds: [
              "call_disruption_condition",
              "call_disruption_plan",
              "call_disruption_places",
            ],
          },
        }),
      },
    ]);
    let conditionResolve: ((result: AgentToolResult) => void) | undefined;
    let conditionStartedResolve: (() => void) | undefined;
    const conditionStarted = new Promise<void>((resolve) => {
      conditionStartedResolve = resolve;
    });
    const conditionResult = new Promise<AgentToolResult>((resolve) => {
      conditionResolve = resolve;
    });
    let replacementStarted = false;
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "get_condition_judgment") {
        conditionStartedResolve?.();
        return conditionResult;
      }
      replacementStarted = true;
      if (request.name === "plan_local_itinerary") {
        return {
          name: request.name,
          status: "success",
          text: "Prepared the land-based replacement.",
          sources: [localGuideSourceSummary],
          itineraries: [replacementPlan],
        };
      }
      if (request.name === "search_places") {
        return {
          name: request.name,
          status: "success",
          text: "Returned a current covered option.",
          sources: [placesSourceSummary],
          cards: [replacementCard],
        };
      }
      if (request.name === "search_local_guide") {
        return {
          name: request.name,
          status: "success",
          text: "Returned an unrelated boat option.",
          sources: [localGuideSourceSummary],
          cards: [unrelatedCard],
          itineraries: [unrelatedPlan],
        };
      }
      throw new Error(`Unexpected tool ${request.name}`);
    };
    const turnPromise = runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Our island tour was cancelled. Give us a workable replacement.",
          },
        ],
        requestId: "agent_request_disruption_ordering",
      },
      {
        client,
        executeTool,
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    await conditionStarted;
    await Promise.resolve();
    expect(replacementStarted).toBe(false);
    conditionResolve?.({
      name: "get_condition_judgment",
      status: "success",
      text: "Current boat-trip conditions checked.",
      sources: [weatherSourceSummary, conditionMarineSourceSummary],
    });
    const result = await turnPromise;

    expect(replacementStarted).toBe(true);
    expect(result.cards?.map((card) => card.id)).toEqual([replacementCard.id]);
    expect(result.itineraries?.map((itinerary) => itinerary.id)).toEqual([replacementPlan.id]);
    expect(result.decisionSummaries?.[0]).toMatchObject({
      kind: "disruption_recovery",
      verdict: "change",
      subject: "Traveler-reported cancelled island tour",
    });
    expect(JSON.stringify(result)).not.toContain(unrelatedCard.title);
    expect(JSON.stringify(result)).not.toContain(unrelatedPlan.title);
  });

  test("returns needs-confirmation without failed replacement artifacts", async () => {
    const failedCard = recommendationCard({
      id: "card_closed_venue_failed_replacement",
      title: "Unverified replacement venue",
      fitReasons: ["Returned only with the failed provider result."],
      caveats: ["Availability could not be established."],
    });
    const failedPlan: ItineraryPlan = {
      id: "itinerary:closed_venue:failed_replacement",
      title: "Unverified Venue Replacement",
      durationLabel: "evening",
      stops: [],
      fallbackStops: [],
      skip: [],
      sources: [providerUnavailableSourceSummary],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_disruption_places",
        requestId: "req_failed_disruption_places",
        callId: "call_failed_disruption_places",
        name: "search_places",
        arguments: {
          query: "open dinner alternatives General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_failed_disruption_final",
        _request_id: "req_failed_disruption_final",
        output_text: finalPayloadText({
          answer: "Confirm a replacement directly before leaving.",
          usedToolCallIds: ["call_failed_disruption_places"],
          displayCardIds: [failedCard.id],
          displayItineraryIds: [failedPlan.id ?? ""],
          realityCheck: {
            kind: "disruption_recovery",
            verdict: "needs_confirmation",
            subject: "Traveler-reported closed dinner venue",
            bestAction: "Confirm a replacement directly before leaving.",
            basis: "Current opening and availability could not be established.",
            fallback: "Use a nearby walk-in option only after local confirmation.",
            avoid: "Avoid travelling across the island for an unconfirmed venue.",
            timing: "tonight",
            area: "General Luna",
            evidenceToolCallIds: ["call_failed_disruption_places"],
          },
        }),
      },
    ]);
    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Our dinner venue closed. Give us an alternative instead.",
          },
        ],
        requestId: "agent_request_failed_disruption_replacement",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          search_places: {
            name: "search_places",
            status: "error",
            text: "Google Places was unavailable.",
            errorCode: "provider_unavailable",
            sources: [providerUnavailableSourceSummary],
            cards: [failedCard],
            itineraries: [failedPlan],
          },
        }),
        agentMemoryVectorStoreId: "",
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.decisionSummaries?.[0]).toMatchObject({
      kind: "disruption_recovery",
      verdict: "needs_confirmation",
    });
    expect(result.cards).toBeUndefined();
    expect(result.itineraries).toBeUndefined();
    expect(result.publicSources).toEqual([providerUnavailableSourceSummary]);
  });

  test("repairs structured surf-near-me answers that omit ranked spots from the public payload", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_near_me_surf_memory",
        requestId: "req_near_me_surf_memory",
        callId: "call_surf_memory",
        name: "load_agent_memory_file",
        arguments: { documents: ["SURF.md"] },
      }),
      responseWithToolCall({
        id: "resp_near_me_surf_tool",
        requestId: "req_near_me_surf_tool",
        callId: "call_surf_ranking",
        name: "rank_surf_spots_nearby",
        arguments: { skill_level: "any", max_results: 7 },
      }),
      {
        id: "resp_near_me_surf_without_condition",
        output_text: finalPayloadText({
          answer: "I’d skip surfing today because conditions look risky.",
          usedMemoryFiles: ["SURF.md"],
          usedToolCallIds: ["call_surf_ranking"],
        }),
        _request_id: "req_near_me_surf_without_condition",
      },
      {
        id: "resp_near_me_surf_omits_ranking",
        output_text: finalPayloadText({
          answer: "I’d skip surfing today because the checked condition judgment says high risk.",
          usedMemoryFiles: ["SURF.md"],
          usedToolCallIds: ["auto_required_condition_judgment_1"],
        }),
        _request_id: "req_near_me_surf_omits_ranking",
      },
      {
        id: "resp_near_me_surf_repaired_public_ranking",
        output_text: finalPayloadText({
          answer:
            "Nearest ranked spots from your shared location are Pacifico / Big Wish at about 0.2 km and Bamboo Garden at about 0.3 km, but I’d skip surfing today because the checked condition judgment says high risk.",
          usedMemoryFiles: ["SURF.md"],
          usedToolCallIds: ["call_surf_ranking", "auto_required_condition_judgment_1"],
        }),
        _request_id: "req_near_me_surf_repaired_public_ranking",
      },
    ]);
    const browserCenter = { latitude: 9.952, longitude: 126.088 };
    const memoryExecutor = memoryLoadExecutor();
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "load_agent_memory_file") {
        return memoryExecutor(request);
      }
      if (request.name === "rank_surf_spots_nearby") {
        return {
          name: request.name,
          status: "success",
          text: "Ranked surf spots: 1. Pacifico / Big Wish - About 0.2 km straight-line. 2. Bamboo Garden - About 0.3 km straight-line.",
          toolCallId: request.toolCallId,
          data: {
            centerSource: "browser_geolocation",
            spots: [
              {
                name: "Pacifico / Big Wish",
                distanceLabel: "About 0.2 km straight-line from your shared location.",
              },
              {
                name: "Bamboo Garden",
                distanceLabel: "About 0.3 km straight-line from your shared location.",
              },
            ],
          },
          sources: [localGuideSourceSummary],
        };
      }
      if (request.name === "get_condition_judgment") {
        return {
          name: request.name,
          status: "success",
          text: "Condition judgment: high risk for surfing today.",
          toolCallId: request.toolCallId,
          sources: [weatherSourceSummary, conditionMarineSourceSummary],
        };
      }
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "I want to go surfing today, which are the best spots near me?",
          },
        ],
        requestId: "agent_request_repair_public_near_me_surf_payload",
        clientContext: {
          geolocation: {
            status: "available",
            source: "browser_geolocation",
            consentScope: "trip_session",
            ...browserCenter,
            capturedAt: "2026-06-26T00:00:00.000Z",
          },
        },
        deterministicSignals: {
          intent: {
            nearMeUsesBrowserGeolocation: true,
            nearby: true,
            today: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Pacifico / Big Wish");
    expect(result.message).toContain("Bamboo Garden");
    expect(result.publicSources).toContainEqual(localGuideSourceSummary);
    expect(result.publicSources).toContainEqual(weatherSourceSummary);
    expect(result.publicSources).toContainEqual(conditionMarineSourceSummary);

    const repairInput = client.requests
      .map((request) => parseLastUserInputMessage(request.input))
      .find((input) => input?.validationRepairSurfSpotFinalPayload);
    expect(repairInput?.validationRepairSurfSpotFinalPayload).toMatchObject({
      toolCallId: "call_surf_ranking",
      name: "rank_surf_spots_nearby",
      issues: {
        answerMissingRankedSpots: true,
        usedToolCallIdsMissingRanking: true,
      },
    });
  });

  test("executes a condition judgment tool call and feeds the evidence back to the model", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_condition_call",
        requestId: "req_condition_call",
        callId: "call_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "swimming",
          location: "General Luna",
          date_range: "today",
          beach_name: "Malinao Beach",
          include_local_caveats: true,
          constraints: ["with kids"],
        },
      }),
      {
        id: "resp_condition_final",
        output_text:
          "Use Malinao only if the water looks calm; tide and surf still need local confirmation.",
        _request_id: "req_condition_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: flexible. Weather checked; tide and surf not checked.",
        data: {
          judgment: {
            recommendation: "flexible",
            signals: [
              { kind: "weather", status: "checked" },
              { kind: "tide", status: "not_checked" },
              { kind: "surf", status: "not_checked" },
            ],
          },
        },
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is Malinao good for swimming with kids today?" }],
        requestId: "agent_request_condition",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(client.requests).toHaveLength(2);
    expect(parseToolOutput(client.requests[1]?.input, 0).text).toContain("Condition judgment");
    expect(result.message).toContain("local confirmation");
    expect(result.toolCalls[0]).toMatchObject({
      toolCallId: "call_condition",
      name: "get_condition_judgment",
      status: "success",
      providerOperation: "condition_judgment",
      sourceProfileIds: ["source_open_meteo"],
    });
    expect(result.sources).toEqual([weatherSourceSummary, conditionMarineSourceSummary]);
  });

  test("auto-executes condition judgment before accepting direct condition prose", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_condition",
        output_text: "Direct swimming answer without condition evidence.",
        _request_id: "req_direct_condition",
      },
      {
        id: "resp_after_condition_repair",
        output_text:
          "Final swimming answer after checking condition evidence and preserving tide caveats.",
        _request_id: "req_after_condition_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: flexible. Weather checked; tide and surf not checked.",
        data: {
          judgment: {
            recommendation: "flexible",
            signals: [
              { kind: "weather", status: "checked" },
              { kind: "tide", status: "not_checked" },
              { kind: "surf", status: "not_checked" },
            ],
          },
        },
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is Malinao good for swimming today?" }],
        requestId: "agent_request_auto_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "General Luna",
            marineCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after checking condition evidence");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual(["get_condition_judgment"]);
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "swimming",
      location: "General Luna",
      date_range: "today",
      beach_name: "Malinao Beach",
      include_local_caveats: null,
      constraints: [],
    });
    expect(client.requests).toHaveLength(2);
    const automaticInput = parseAutomaticConditionInput(client.requests[1]?.input);
    expect(automaticInput.validationRepairConditionJudgment?.name).toBe("get_condition_judgment");
    expect(result.sources).toEqual([weatherSourceSummary, conditionMarineSourceSummary]);
  });

  test("condition repair uses the latest explicit place before inherited context", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_followup_condition",
        output_text: "Direct sunset answer without condition evidence.",
        _request_id: "req_direct_followup_condition",
      },
      {
        id: "resp_after_followup_condition_repair",
        output_text: "Final sunset answer after Cloud 9 condition evidence.",
        _request_id: "req_after_followup_condition_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment evidence for Cloud 9.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          { role: "user", content: "Is Malinao good for swimming today?" },
          { role: "assistant", content: "Malinao needs tide and surf confirmation." },
          { role: "user", content: "What about sunset at Cloud 9 tomorrow?" },
        ],
        requestId: "agent_request_followup_condition_repair",
        deterministicSignals: {
          intent: {
            locationLabel: "General Luna",
            marineCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Cloud 9 condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "sunset",
      location: "Cloud 9",
      date_range: "next_7_days",
      beach_name: "Cloud 9",
      include_local_caveats: null,
      constraints: [],
    });
    expect(client.requests).toHaveLength(2);
  });

  test("repairs condition evidence that omits required beach name and constraints", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_generic_swim_condition_call",
        requestId: "req_generic_swim_condition_call",
        callId: "call_generic_swim_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "swimming",
          location: "General Luna",
          date_range: "today",
          beach_name: null,
          include_local_caveats: null,
          constraints: [],
        },
      }),
      {
        id: "resp_after_generic_swim_condition",
        output_text: "Final swimming answer after generic General Luna evidence.",
        _request_id: "req_after_generic_swim_condition",
      },
      {
        id: "resp_after_required_malinao_condition",
        output_text: "Final swimming answer after Malinao and kids evidence.",
        _request_id: "req_after_required_malinao_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment evidence.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is Malinao good for swimming with kids today?" }],
        requestId: "agent_request_required_beach_condition_repair",
        deterministicSignals: {
          intent: {
            locationLabel: "General Luna",
            marineCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Malinao and kids evidence");
    expect(result.toolCalls.map((toolCall) => toolCall.arguments)).toEqual([
      {
        activity: "swimming",
        location: "General Luna",
        date_range: "today",
        beach_name: null,
        include_local_caveats: null,
        constraints: [],
      },
      {
        activity: "swimming",
        location: "General Luna",
        date_range: "today",
        beach_name: "Malinao Beach",
        include_local_caveats: null,
        constraints: ["with kids"],
      },
    ]);
    expect(client.requests).toHaveLength(3);
  });

  test("auto-executes boat condition judgments for boat ride prompts", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_boat_condition",
        output_text: "Direct boat answer without condition evidence.",
        _request_id: "req_direct_boat_condition",
      },
      {
        id: "resp_after_boat_condition_repair",
        output_text: "Final boat answer after checking condition evidence.",
        _request_id: "req_after_boat_condition_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: needs local confirmation. Weather checked; marine signals not checked.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is the boat ride to Sugba okay today?" }],
        requestId: "agent_request_auto_boat_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Del Carmen",
            marineCondition: true,
            roadCondition: false,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after checking condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "boat_trip",
      location: "Del Carmen",
      date_range: "today",
      beach_name: "Sugba Lagoon",
      include_local_caveats: null,
      constraints: [],
    });
  });

  test("repairs bare ride follow-ups in inherited boat context as boat trips", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_bare_ride_followup",
        output_text: "Direct follow-up answer without condition evidence.",
        _request_id: "req_direct_bare_ride_followup",
      },
      {
        id: "resp_after_bare_ride_followup_repair",
        output_text: "Final follow-up answer after checking boat condition evidence.",
        _request_id: "req_after_bare_ride_followup_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: needs local confirmation. Weather checked; marine signals not checked.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          { role: "user", content: "Is the boat ride to Sugba okay today?" },
          { role: "assistant", content: "Check condition evidence before deciding." },
          { role: "user", content: "Can I ride tomorrow?" },
        ],
        requestId: "agent_request_bare_ride_followup_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Del Carmen",
            marineCondition: true,
            roadCondition: false,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("boat condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "boat_trip",
      location: "Del Carmen",
      date_range: "next_7_days",
      beach_name: "Sugba Lagoon",
      include_local_caveats: null,
      constraints: [],
    });
  });

  test("repairs mixed scooter and boat condition prompts as boat trips", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_mixed_transport_condition",
        output_text: "Direct mixed transport answer without condition evidence.",
        _request_id: "req_direct_mixed_transport_condition",
      },
      {
        id: "resp_after_mixed_transport_condition",
        output_text: "Final mixed transport answer after checking condition evidence.",
        _request_id: "req_after_mixed_transport_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: needs local confirmation. Weather checked; marine and road signals not checked.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Is it okay to scooter to Del Carmen before a Sugba boat trip today?",
          },
        ],
        requestId: "agent_request_auto_mixed_transport_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Del Carmen",
            marineCondition: true,
            roadCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after checking condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "boat_trip",
      location: "Del Carmen",
      date_range: "today",
      beach_name: "Sugba Lagoon",
      include_local_caveats: null,
      constraints: [],
    });
  });

  test("repairs mismatched scooter condition evidence for mixed boat prompts", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_wrong_scooter_condition_call",
        requestId: "req_wrong_scooter_condition_call",
        callId: "call_wrong_scooter_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "scooter",
          location: "Del Carmen",
          date_range: "today",
          beach_name: "Sugba Lagoon",
          include_local_caveats: null,
          constraints: [],
        },
      }),
      {
        id: "resp_after_wrong_scooter_condition",
        output_text: "Final mixed answer after only scooter condition evidence.",
        _request_id: "req_after_wrong_scooter_condition",
      },
      {
        id: "resp_after_required_boat_condition",
        output_text: "Final mixed answer after required boat condition evidence.",
        _request_id: "req_after_required_boat_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment evidence.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Is it okay to scooter to Del Carmen before a Sugba boat trip today?",
          },
        ],
        requestId: "agent_request_mismatched_mixed_transport_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Del Carmen",
            marineCondition: true,
            roadCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("required boat condition evidence");
    expect(result.toolCalls.map((toolCall) => toolCall.arguments.activity)).toEqual([
      "scooter",
      "boat_trip",
    ]);
    expect(client.requests).toHaveLength(3);
  });

  test("repairs wave-and-boat prompts as boat trips even with surfing signals", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_wave_boat_condition",
        output_text: "Direct wave and boat answer without condition evidence.",
        _request_id: "req_direct_wave_boat_condition",
      },
      {
        id: "resp_after_wave_boat_condition",
        output_text: "Final wave and boat answer after checking boat condition evidence.",
        _request_id: "req_after_wave_boat_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: boat trip needs local confirmation.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Are the waves okay for the boat to Sugba?" }],
        requestId: "agent_request_wave_boat_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Del Carmen",
            marineCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("boat condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "boat_trip",
      location: "Del Carmen",
      date_range: "today",
      beach_name: "Sugba Lagoon",
      include_local_caveats: null,
      constraints: [],
    });
  });

  test("repairs tomorrow condition prompts with the next-7-days forecast range", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_tomorrow_condition",
        output_text: "Direct sunset answer without condition evidence.",
        _request_id: "req_direct_tomorrow_condition",
      },
      {
        id: "resp_after_tomorrow_condition",
        output_text: "Final sunset answer after checking condition evidence.",
        _request_id: "req_after_tomorrow_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: flexible. Weather checked for the next seven days.",
        sources: [weatherSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Is Cloud 9 sunset worth it tomorrow?" }],
        requestId: "agent_request_auto_tomorrow_condition",
        deterministicSignals: {
          intent: {
            locationLabel: "Cloud 9",
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after checking condition evidence");
    expect(result.toolCalls[0]?.arguments).toEqual({
      activity: "sunset",
      location: "Cloud 9",
      date_range: "next_7_days",
      beach_name: "Cloud 9",
      include_local_caveats: null,
      constraints: [],
    });
    expect(parseAutomaticConditionInput(client.requests[1]?.input).instruction).toContain(
      "7-day proxy",
    );
  });

  test("executes Google Places search and details tool calls", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_places_search",
        requestId: "req_places_search",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "cafes near Cloud 9",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
        },
      }),
      responseWithToolCall({
        id: "resp_places_details",
        requestId: "req_places_details",
        callId: "call_details",
        name: "get_place_details",
        arguments: { place_id: "ChIJCloud9Cafe" },
      }),
      {
        id: "resp_places_final",
        output_text: "Try the cafe with the Maps link first, then verify opening hours.",
        _request_id: "req_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned a cafe shortlist.",
        sources: [placesSourceSummary],
      },
      get_place_details: {
        name: "get_place_details",
        status: "success",
        text: "Google Places details loaded for Cloud 9 Cafe. Maps: https://maps.example/cafe",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Find a cafe near Cloud 9 and check details." }],
        requestId: "agent_request_places",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(client.requests).toHaveLength(3);
    expect(result.message).toContain("Maps link");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "search_places",
      "get_place_details",
    ]);
    expect(result.toolCalls.map((toolCall) => toolCall.providerOperation)).toEqual([
      "google_places.search",
      "google_places.details",
    ]);
    expect(result.sources).toEqual([placesSourceSummary]);
  });

  test("normalizes model-facing Places tool aliases and card IDs in final payloads", async () => {
    const placeCard = {
      id: "place_chij_dotfad3azmrpmzv_yvfbha",
      kind: "place" as const,
      title: "Lost In Siargao",
      subtitle: "Restaurant - General Luna - Google rating 4.8 from 74 ratings",
      mapsUrl: "https://maps.example/lost-in-siargao",
      openStatusLabel: "Open now according to Google Places.",
      fitReasons: ["A strong Google Places match for dinner in General Luna."],
      caveats: ["Bookings and table availability were not checked."],
      sourceLabel: "Google Places - live checked",
      sources: [placesSourceSummary],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_food_places",
        requestId: "req_food_places",
        callId: "call_places_dinner",
        name: "search_places",
        arguments: {
          query: "restaurants and dinner spots in General Luna, Siargao",
          center: { latitude: 9.7847, longitude: 126.1636 },
          radius_meters: 12_000,
        },
      }),
      {
        id: "resp_food_final",
        output_text: finalPayloadText({
          answer:
            "Start with Lost In Siargao tonight. I checked Google Places for live open-now status and map links.",
          usedToolCallIds: ["functions.search_places", "search_places"],
          displayCardIds: ["places/ChIJ_dOTfAD3AzMRpmZv_yvfBHA", "ChIJ_dOTfAD3AzMRpmZv_yvfBHA"],
        }),
        _request_id: "req_food_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned open dinner spots in General Luna.",
        toolCallId: "call_places_dinner",
        sources: [placesSourceSummary],
        cards: [placeCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Where should I eat in General Luna tonight?" }],
        requestId: "agent_request_food_places_aliases",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.publicSources).toEqual([placesSourceSummary]);
    expect(result.cards).toEqual([placeCard]);
    expect(result.artifactSelection?.unknownCardIds).toEqual([]);
  });

  test("does not expose Places cards when structured final payload selects no card IDs", async () => {
    const placeCard = {
      id: "place_chij_lost_in_siargao",
      kind: "place" as const,
      title: "Lost In Siargao",
      subtitle: "Restaurant - General Luna",
      mapsUrl: "https://maps.example/lost-in-siargao",
      openStatusLabel: "Open now according to Google Places.",
      fitReasons: ["Good dinner fit returned by Google Places."],
      caveats: ["Bookings and table availability were not checked."],
      sourceLabel: "Google Places - live checked",
      sources: [openNowPlacesSourceSummary],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_food_places",
        requestId: "req_food_places",
        callId: "call_places_dinner",
        name: "search_places",
        arguments: {
          query: "restaurants in General Luna open now dinner Siargao",
          center: { latitude: 9.7869, longitude: 126.1615 },
          radius_meters: 12_000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_food_final_without_cards",
        output_text: finalPayloadText({
          answer: "Start with Lost In Siargao tonight.",
          usedToolCallIds: ["search_places"],
        }),
        _request_id: "req_food_final_without_cards",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned open dinner spots in General Luna.",
        toolCallId: "call_places_dinner",
        sources: [openNowPlacesSourceSummary],
        cards: [placeCard],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Where should I eat in General Luna tonight?" }],
        requestId: "agent_request_food_places_missing_card_ids",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(client.requests).toHaveLength(2);
    expect(result.message).toContain("Lost In Siargao");
    expect(result.cards).toBeUndefined();
    expect(result.publicSources).toEqual([openNowPlacesSourceSummary]);
    expect(result.artifactSelection).toMatchObject({
      selectedCardCount: 0,
      totalCardCount: 1,
      unselectedCardCount: 1,
    });
  });

  test("executes a curated local guide tool call", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_local_call",
        requestId: "req_local_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: {
          query: "sandy swimming beaches within 30 minutes",
          filters: { beach_surface: "sand", swimming: true, max_ride_minutes: 30 },
        },
      }),
      {
        id: "resp_local_final",
        output_text: "Doot and Malinao fit best; tides and lifeguards were not checked.",
        _request_id: "req_local_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach and Malinao Beach.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_local",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Doot");
    expect(result.toolCalls[0]).toMatchObject({
      name: "search_local_guide",
      providerOperation: "local_guide.search",
      sourceProfileIds: [],
    });
    expect(result.sources).toEqual([localGuideSourceSummary]);
  });

  test("executes an itinerary planning tool call and keeps legacy artifacts internal", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_itinerary_call",
        requestId: "req_itinerary_call",
        callId: "call_itinerary",
        name: "plan_local_itinerary",
        arguments: {
          theme: "rainy_cloud_9_afternoon",
          origin: "Cloud 9",
          duration_hours: 3,
          needs_weather_check: true,
        },
      }),
      {
        id: "resp_itinerary_final",
        output_text: "Keep Cloud 9 short, then use the covered cafe fallback if rain builds.",
        _request_id: "req_itinerary_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared.",
        data: { plan: rainyCloud9Plan },
        sources: [localGuideSourceSummary],
        itineraries: [rainyCloud9Plan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 afternoon for 3 hours." }],
        requestId: "agent_request_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(String(client.requests[0]?.instructions)).toContain("Use the loaded INDEX.md");
    const toolOutput = parseToolOutput(client.requests[1]?.input, 0) as {
      data: { plan: { title: string } };
    };
    expect(toolOutput.data.plan.title).toBe("Rainy Cloud 9 Afternoon");
    expect(result.message).toContain("covered cafe");
    expect(result.toolCalls[0]).toMatchObject({
      name: "plan_local_itinerary",
      providerOperation: "local_itinerary.plan",
    });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
    expect(result.sources).toEqual([localGuideSourceSummary]);
  });

  test("auto-executes itinerary planning before accepting direct itinerary prose", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_itinerary",
        output_text: "Direct food crawl prose without a structured itinerary.",
        _request_id: "req_direct_itinerary",
      },
      {
        id: "resp_after_auto_plan",
        output_text: "Final food crawl answer after reading the itinerary artifact.",
        _request_id: "req_after_auto_plan",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured food crawl artifact prepared.",
        data: {
          plan: foodCrawlPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [genericSourceSummary],
        itineraries: [foodCrawlPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Make a 3 hour food crawl in General Luna." }],
        requestId: "agent_request_auto_initial_itinerary",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "General Luna",
            tripContext: {
              activeGoal: "itinerary",
              currentArea: "General Luna",
              durableConstraints: [],
              transportMode: "unknown",
            },
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after reading the itinerary artifact");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual(["plan_local_itinerary"]);
    expect(result.toolCalls[0]?.arguments).toMatchObject({
      theme: "food_crawl",
      origin: "General Luna",
      duration_hours: 3,
      needs_open_now: true,
    });
    expect(client.requests).toHaveLength(2);
    const automaticInput = parseAutomaticRequiredPlanInput(client.requests[1]?.input);
    expect(automaticInput.validationRepairItineraryPlan?.name).toBe("plan_local_itinerary");
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("auto-executes condition evidence after itinerary repair for mixed prompts", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_mixed",
        output_text: "Direct sandy beach plan and swimming advice without evidence.",
        _request_id: "req_direct_mixed",
      },
      {
        id: "resp_after_mixed_plan",
        output_text: "Itinerary evidence is present, but condition evidence is still missing.",
        _request_id: "req_after_mixed_plan",
      },
      {
        id: "resp_after_mixed_condition",
        output_text: "Final mixed answer after itinerary and condition evidence.",
        _request_id: "req_after_mixed_condition",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured sandy beach artifact prepared.",
        data: {
          plan: sandyBeachPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
      },
      get_condition_judgment: {
        name: "get_condition_judgment",
        status: "success",
        text: "Condition judgment: flexible. Weather checked; tide and surf not checked.",
        sources: [weatherSourceSummary, conditionMarineSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Plan a sandy beach half-day and tell me if swimming is okay today.",
          },
        ],
        requestId: "agent_request_mixed_itinerary_condition",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "General Luna",
            marineCondition: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after itinerary and condition evidence");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_condition_judgment",
    ]);
    expect(result.toolCalls[0]?.arguments).toMatchObject({
      theme: "sandy_beach_half_day",
    });
    expect(result.toolCalls[1]?.arguments).toEqual({
      activity: "swimming",
      location: "General Luna",
      date_range: "today",
      beach_name: null,
      include_local_caveats: null,
      constraints: [],
    });
    expect(client.requests).toHaveLength(3);
    expect(
      parseAutomaticRequiredPlanInput(client.requests[1]?.input).validationRepairItineraryPlan,
    ).toMatchObject({ name: "plan_local_itinerary" });
    expect(
      parseAutomaticConditionInput(client.requests[2]?.input).validationRepairConditionJudgment,
    ).toMatchObject({ name: "get_condition_judgment" });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("repairs open-ended Cloud 9 activity plans after condition-only evidence", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_cloud9_condition_only",
        requestId: "req_cloud9_condition_only",
        callId: "call_condition",
        name: "get_condition_judgment",
        arguments: {
          activity: "sightseeing",
          location: "Cloud 9",
          date_range: "today",
          include_local_caveats: null,
        },
      }),
      {
        id: "resp_cloud9_condition_final",
        output_text: "Condition-only answer without a structured plan.",
        _request_id: "req_cloud9_condition_final",
      },
      {
        id: "resp_cloud9_plan_without_checks",
        output_text: "Plan answer after itinerary but before live Places.",
        _request_id: "req_cloud9_plan_without_checks",
      },
      {
        id: "resp_cloud9_checked_final",
        output_text: "Final Cloud 9 activity plan after weather and Google Places checks.",
        _request_id: "req_cloud9_checked_final",
      },
    ]);
    const observedPlanArguments: Record<string, unknown>[] = [];
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "get_condition_judgment") {
        return {
          name: "get_condition_judgment",
          status: "success",
          text: "Condition judgment loaded.",
          sources: [weatherSourceSummary],
        };
      }
      if (request.name === "plan_local_itinerary") {
        observedPlanArguments.push(request.arguments);
        return executeAgentTool(request);
      }
      if (request.name === "get_weather_forecast") {
        return {
          name: "get_weather_forecast",
          status: "success",
          text: "Open-Meteo forecast loaded for Cloud 9.",
          sources: [weatherSourceSummary],
        };
      }
      if (request.name === "search_places") {
        return {
          name: "search_places",
          status: "success",
          text: "Google Places returned open cafe options.",
          sources: [openNowPlacesSourceSummary],
        };
      }
      throw new Error(`Unexpected tool call: ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What should I do near Cloud 9 today?" }],
        requestId: "agent_request_condition_only_cloud9_activity_plan",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "Cloud 9",
            nearby: true,
            today: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(observedPlanArguments[0]).toMatchObject({
      origin: "Cloud 9",
      needs_open_now: true,
      needs_weather_check: true,
    });
    expect(result.message).toContain("Google Places checks");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "get_condition_judgment",
      "plan_local_itinerary",
      "get_weather_forecast",
      "search_places",
    ]);
    expect(result.sources).toContainEqual(openNowPlacesSourceSummary);
  });

  test("repairs failed itinerary planning before accepting final itinerary prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_initial_plan",
        requestId: "req_failed_initial_plan",
        callId: "call_failed_initial_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "not_a_theme" },
      }),
      {
        id: "resp_after_failed_plan",
        output_text: "Final itinerary prose after a failed plan call.",
        _request_id: "req_after_failed_plan",
      },
      {
        id: "resp_after_repair_plan",
        output_text: "Final itinerary prose after the repaired artifact.",
        _request_id: "req_after_repair_plan",
      },
    ]);
    let planCallCount = 0;
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name !== "plan_local_itinerary") {
        return {
          name: request.name,
          status: "error",
          text: `Unexpected tool ${request.name}.`,
          errorCode: "unexpected_tool",
          sources: [],
        };
      }
      planCallCount += 1;
      if (planCallCount === 1) {
        return {
          name: "plan_local_itinerary",
          status: "error",
          text: "Invalid itinerary planning arguments.",
          errorCode: "invalid_tool_arguments",
          sources: [],
          toolCallId: request.toolCallId,
        };
      }
      return {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured sandy beach artifact prepared.",
        data: {
          plan: sandyBeachPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
        toolCallId: request.toolCallId,
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan a sandy beach half-day from General Luna." }],
        requestId: "agent_request_failed_initial_plan_repair",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "General Luna",
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("repaired artifact");
    expect(result.toolCalls.map((toolCall) => toolCall.status)).toEqual(["error", "success"]);
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "plan_local_itinerary",
    ]);
    expect(result.toolCalls[1]?.arguments).toMatchObject({
      theme: "sandy_beach_half_day",
      origin: "General Luna",
    });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("repairs direct sandy beach half-day prose without route activity-plan signals", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_sandy_half_day",
        output_text: "Direct sandy half-day prose without a structured itinerary.",
        _request_id: "req_direct_sandy_half_day",
      },
      {
        id: "resp_after_sandy_repair",
        output_text: "Final sandy beach answer after the itinerary artifact.",
        _request_id: "req_after_sandy_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured sandy beach artifact prepared.",
        data: {
          plan: sandyBeachPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beach half-day from General Luna." }],
        requestId: "agent_request_sandy_half_day_repair",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after the itinerary artifact");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.arguments).toMatchObject({
      theme: "sandy_beach_half_day",
      origin: "General Luna",
    });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("repairs scoped half-day itinerary prose when transport mode is van", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_van_half_day",
        output_text: "Direct van half-day prose without a structured itinerary.",
        _request_id: "req_direct_van_half_day",
      },
      {
        id: "resp_after_van_repair",
        output_text: "Final van half-day answer after the itinerary artifact.",
        _request_id: "req_after_van_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured non-surfer itinerary artifact prepared.",
        data: {
          plan: sandyBeachPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Plan a 3-hour non-surfer half-day by van from General Luna.",
          },
        ],
        requestId: "agent_request_van_half_day_repair",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after the itinerary artifact");
    expect(result.toolCalls[0]?.arguments).toMatchObject({
      theme: "non_surfer_half_day",
      origin: "General Luna",
      duration_hours: 3,
      transport_mode: "van",
    });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("does not repair non-itinerary not-surfing food prompts", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_not_surfing_food",
        output_text: "Try a casual dinner spot in General Luna.",
        _request_id: "req_not_surfing_food",
      },
    ]);
    let toolCallCount = 0;
    const executeTool: AgentToolExecutor = async (request) => {
      toolCallCount += 1;
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "I'm not surfing today, where should I eat in General Luna?",
          },
        ],
        requestId: "agent_request_not_surfing_food",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "General Luna",
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("General Luna");
    expect(result.toolCalls).toEqual([]);
    expect(result.itineraries).toBeUndefined();
    expect(toolCallCount).toBe(0);
  });

  test("repairs scoped itinerary prose that mentions ferry timing", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_direct_ferry_food_crawl",
        output_text: "Direct food crawl prose without a structured itinerary.",
        _request_id: "req_direct_ferry_food_crawl",
      },
      {
        id: "resp_after_ferry_food_crawl_repair",
        output_text: "Final food crawl answer after the itinerary artifact.",
        _request_id: "req_after_ferry_food_crawl_repair",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured food crawl artifact prepared.",
        data: {
          plan: foodCrawlPlan,
          requiredToolChecks: { places: [] },
        },
        sources: [genericSourceSummary],
        itineraries: [foodCrawlPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content: "Plan a 3-hour food crawl before my ferry transfer in General Luna.",
          },
        ],
        requestId: "agent_request_ferry_food_crawl_repair",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("after the itinerary artifact");
    expect(result.toolCalls[0]?.arguments).toMatchObject({
      theme: "food_crawl",
      origin: "General Luna",
      duration_hours: 3,
      needs_open_now: true,
    });
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  for (const prompt of [
    "Can you plan my airport transfer to General Luna?",
    "Can you plan my 2-hour airport transfer from General Luna?",
    "Can you plan my ferry transfer to General Luna?",
    "Can you plan my trip to Siargao?",
  ]) {
    test(`does not auto-repair non-itinerary plan prompt: ${prompt}`, async () => {
      const client = fakeResponsesClient([
        {
          id: "resp_direct_non_itinerary_plan",
          output_text: "Direct answer for a non-itinerary planning request.",
          _request_id: "req_direct_non_itinerary_plan",
        },
      ]);
      let toolCallCount = 0;
      const executeTool: AgentToolExecutor = async (request) => {
        toolCallCount += 1;
        return {
          name: request.name,
          status: "error",
          text: `Unexpected tool ${request.name}.`,
          errorCode: "unexpected_tool",
          sources: [],
        };
      };

      const result = await runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: prompt }],
          requestId: "agent_request_non_itinerary_plan",
          deterministicSignals: {
            intent: {
              activityPlan: true,
              locationLabel: "General Luna",
            },
          },
        },
        { client, executeTool, model: "gpt-test" },
      );

      expect(result.message).toContain("non-itinerary");
      expect(result.toolCalls).toEqual([]);
      expect(result.itineraries).toBeUndefined();
      expect(toolCallCount).toBe(0);
      expect(client.requests).toHaveLength(1);
    });
  }

  test("asks for the itinerary details when an explicit critique has no plan", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_missing_itinerary_details",
        output_text: finalPayloadText({ answer: "I need the plan first." }),
        _request_id: "req_missing_itinerary_details",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Can you critique my itinerary for tomorrow?" }],
        requestId: "agent_request_missing_itinerary_details",
      },
      { client, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    expect(result.message).toBe(
      "Send the itinerary stops and timing you want me to reality-check.",
    );
    expect(result.toolCalls).toEqual([]);
  });

  test("reviews an itinerary and waits for upstream checks before Places enrichment", async () => {
    const routeSource: AnswerSourceSummary = {
      label: "curated_local_guide",
      sourceName: "Ask Siargao governed route facts",
      confidence: "medium",
      checked: ["Cloud 9, Pacifico, and Dapa area relationship"],
      notChecked: ["live traffic", "vehicle availability"],
    };
    const reviewPlan: ItineraryPlan = {
      id: "itinerary_feasibility_review",
      title: "Itinerary Feasibility Review",
      durationLabel: "2 days, 3 stops",
      decision: {
        label: "avoid_today",
        bestAction: "Move the final north-island night to General Luna or Dapa.",
      },
      stops: [
        {
          title: "Cloud 9 sunset",
          kind: "activity",
          sequence: 1,
          area: "Cloud 9",
          rationale: "Day 1 at 16:00.",
          caveats: ["Current weather needs a separate check."],
        },
        {
          title: "Pacifico dinner",
          kind: "meal",
          sequence: 2,
          area: "Pacifico",
          travelTimeFromPreviousMinutes: 83,
          rationale: "Day 1 at 19:00.",
          caveats: ["Transfer time is a non-live estimate, not live traffic."],
        },
        {
          title: "Dapa ferry",
          kind: "transfer",
          sequence: 3,
          area: "Dapa",
          rationale: "Day 2 at 08:00.",
          caveats: ["Ferry schedule changes were not inferred."],
        },
      ],
      fallbackStops: [
        {
          title: "Travel south before dark",
          kind: "transfer",
          sequence: 1,
          rationale: "Use if the overnight base cannot change.",
          caveats: ["Vehicle availability needs confirmation."],
        },
      ],
      skip: ["Pacifico dinner before an early Dapa departure"],
      sources: [genericSourceSummary],
    };
    const dinnerCard: RecommendationCard = {
      id: "card_pacifico_dinner",
      kind: "place",
      title: "Pacifico Dinner House",
      subtitle: "Pacifico",
      fitReasons: ["Current Places match for the submitted dinner stop."],
      caveats: ["Reservations were not checked."],
      sourceLabel: "Google Places - live checked",
    };
    const unselectedCard: RecommendationCard = {
      ...dinnerCard,
      id: "card_unselected_pacifico",
      title: "Unselected Pacifico Venue",
    };
    const requiredPlacesArguments = {
      query: "Pacifico dinner Pacifico Siargao",
      center: { latitude: 9.954, longitude: 126.088 },
      radius_meters: 5000,
      constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
    };
    const finalReviewPayload: Partial<AgentFinalPayload> = {
      answer:
        "Change the plan: Pacifico dinner leaves a weak overnight position for the 8 AM Dapa ferry. Move south after Cloud 9, especially with kids and no scooter; keep Pacifico Dinner House only if the schedule changes.",
      usedToolCallIds: [
        "call_itinerary_review_plan",
        "auto_required_local_facts_1",
        "auto_required_weather_2",
        "auto_required_places_1",
      ],
      displayCardIds: [dinnerCard.id],
      displayItineraryIds: [reviewPlan.id ?? ""],
      realityCheck: {
        kind: "itinerary",
        verdict: "change",
        subject: "Cloud 9, Pacifico, and early Dapa ferry plan",
        bestAction: "Move the final north-island night to General Luna or Dapa.",
        basis:
          "The governed route context and submitted timing make Pacifico a weak position for the 8 AM Dapa ferry.",
        fallback: "Drop Pacifico dinner and travel south before dark.",
        avoid: "Do not rely on the non-live transfer estimate as a ferry guarantee.",
        timing: "Day 1 evening before the Day 2 8 AM ferry",
        area: "Pacifico to Dapa",
        evidenceToolCallIds: [
          "call_itinerary_review_plan",
          "auto_required_local_facts_1",
          "auto_required_weather_2",
          "auto_required_places_1",
        ],
      },
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_itinerary_review_plan",
        requestId: "req_itinerary_review_plan",
        callId: "call_itinerary_review_plan",
        name: "plan_local_itinerary",
        arguments: {
          theme: "itinerary_review",
          transport_mode: "tricycle",
          needs_weather_check: true,
          needs_open_now: true,
          constraints: ["with kids", "no scooter"],
          review_days: [
            {
              day_label: "Day 1",
              stops: [
                {
                  title: "Cloud 9 sunset",
                  area: "Cloud 9",
                  kind: "activity",
                  time: "16:00",
                  duration_minutes: 90,
                  weather_sensitive: true,
                },
                {
                  title: "Pacifico dinner",
                  area: "Pacifico",
                  kind: "meal",
                  time: "19:00",
                  duration_minutes: 90,
                },
              ],
            },
            {
              day_label: "Day 2",
              stops: [
                {
                  title: "Dapa ferry",
                  area: "Dapa",
                  kind: "transfer",
                  time: "08:00",
                  duration_minutes: 30,
                },
              ],
            },
          ],
        },
      }),
      {
        id: "resp_itinerary_review_before_upstream",
        _request_id: "req_itinerary_review_before_upstream",
        output_text: finalPayloadText({
          answer: "The plan needs route and weather checks first.",
          usedToolCallIds: ["call_itinerary_review_plan"],
        }),
      },
      {
        id: "resp_itinerary_review_before_places",
        _request_id: "req_itinerary_review_before_places",
        output_text: finalPayloadText({
          answer: "The upstream route and weather checks are complete.",
          usedToolCallIds: [
            "call_itinerary_review_plan",
            "auto_required_local_facts_1",
            "auto_required_weather_2",
          ],
        }),
      },
      {
        id: "resp_itinerary_review_final",
        _request_id: "req_itinerary_review_final",
        output_text: finalPayloadText(finalReviewPayload),
      },
    ]);

    let placesStarted = false;
    let resolveLocalFacts: ((result: AgentToolResult) => void) | undefined;
    let markLocalFactsStarted: (() => void) | undefined;
    const localFactsStarted = new Promise<void>((resolve) => {
      markLocalFactsStarted = resolve;
    });
    const localFactsResult = new Promise<AgentToolResult>((resolve) => {
      resolveLocalFacts = resolve;
    });
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "plan_local_itinerary") {
        return {
          name: "plan_local_itinerary",
          status: "success",
          text: "Reviewed the submitted itinerary and found an early-departure conflict.",
          data: {
            plan: reviewPlan,
            requiredToolChecks: {
              localFacts: [
                {
                  required: true,
                  tool: "query_local_facts",
                  entityTypes: ["area", "route"],
                  text: "Cloud 9 to Pacifico to Dapa",
                  limit: 10,
                  reason: "route context must precede place enrichment",
                },
              ],
              weather: {
                required: true,
                tool: "get_weather_forecast",
                location: "General Luna",
                date_range: "next_7_days",
                reason: "outdoor sequencing depends on weather",
              },
              places: [
                {
                  required: true,
                  tool: "search_places",
                  ...requiredPlacesArguments,
                  reason: "the dinner stop needs current identity and opening-hour evidence",
                },
              ],
            },
          },
          sources: [genericSourceSummary],
          itineraries: [reviewPlan],
        };
      }
      if (request.name === "query_local_facts") {
        markLocalFactsStarted?.();
        return localFactsResult;
      }
      if (request.name === "get_weather_forecast") {
        return {
          name: "get_weather_forecast",
          status: "success",
          text: "The next-seven-days forecast was checked for the outdoor stop.",
          sources: [weatherSourceSummary],
        };
      }
      if (request.name === "search_places") {
        placesStarted = true;
        return {
          name: "search_places",
          status: "success",
          text: "Current Pacifico dinner Places results returned.",
          sources: [openNowPlacesSourceSummary],
          cards: [dinnerCard, unselectedCard],
        };
      }
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const resultPromise = runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content:
              "Review my plan: Day 1 Cloud 9 sunset at 4 PM, Pacifico dinner at 7 PM; Day 2 Dapa ferry at 8 AM. We have kids, no scooter, and need current weather and dinner opening hours.",
          },
        ],
        requestId: "agent_request_itinerary_feasibility",
      },
      { client, executeTool, model: "gpt-test", requireStructuredFinalOutput: true },
    );

    await localFactsStarted;
    expect(placesStarted).toBe(false);
    resolveLocalFacts?.({
      name: "query_local_facts",
      status: "success",
      text: "Governed route and area facts returned.",
      sources: [routeSource],
    });
    const result = await resultPromise;

    expect(placesStarted).toBe(true);
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "query_local_facts",
      "get_weather_forecast",
      "search_places",
    ]);
    expect(result.message).toContain("**change: Cloud 9, Pacifico, and early Dapa ferry plan**");
    expect(result.message).toContain("Move the final north-island night to General Luna or Dapa");
    expect(result.itineraries?.map((itinerary) => itinerary.id)).toEqual([reviewPlan.id]);
    expect(result.cards?.map((card) => card.id)).toEqual([dinnerCard.id]);
    expect(JSON.stringify(result.cards)).not.toContain(unselectedCard.title);
    expect(result.decisionSummaries?.[0]).toMatchObject({
      kind: "itinerary",
      verdict: "change",
      sources: [
        genericSourceSummary,
        routeSource,
        weatherSourceSummary,
        openNowPlacesSourceSummary,
      ],
    });
    expect(client.requests).toHaveLength(4);
  });

  test("rainy Cloud 9 itineraries call planning and weather before final prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_rainy_plan",
        requestId: "req_rainy_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "rainy_cloud_9_afternoon", needs_weather_check: true },
      }),
      responseWithToolCall({
        id: "resp_rainy_weather",
        requestId: "req_rainy_weather",
        callId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Cloud 9", date_range: "today" },
      }),
      {
        id: "resp_rainy_final",
        output_text: "Weather was checked; keep the covered fallback and avoid exposed beach hops.",
        _request_id: "req_rainy_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required weather check: Cloud 9.",
        sources: [localGuideSourceSummary],
        itineraries: [rainyCloud9Plan],
      },
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded for Cloud 9.",
        sources: [weatherSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Rainy Cloud 9 afternoon plan?" }],
        requestId: "agent_request_rainy_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_weather_forecast",
    ]);
    expect(result.sources).toEqual([localGuideSourceSummary, weatherSourceSummary]);
    expect(result.message).toContain("Weather was checked");
  });

  test("sunset plus dinner itineraries call planning and Places before final prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_dinner_plan",
        requestId: "req_dinner_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "sunset_plus_dinner", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_dinner_places",
        requestId: "req_dinner_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "dinner restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_dinner_final",
        output_text: "Use the sunset stop, then choose the live-checked dinner venue.",
        _request_id: "req_dinner_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required Places check: dinner.",
        sources: [localGuideSourceSummary],
        itineraries: [sunsetDinnerPlan],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned open dinner options.",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sunset plus dinner plan for tonight." }],
        requestId: "agent_request_dinner_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "search_places",
    ]);
    expect(result.sources).toEqual([localGuideSourceSummary, placesSourceSummary]);
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("keeps hydrated itinerary artifacts internal when production tools omit result toolCallId", async () => {
    const placesArguments = {
      query: "dinner restaurants General Luna Siargao",
      center: { latitude: 9.784, longitude: 126.158 },
      radius_meters: 4000,
      constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_dinner_plan_without_result_id",
        requestId: "req_dinner_plan_without_result_id",
        callId: "call_plan_without_result_id",
        name: "plan_local_itinerary",
        arguments: { theme: "sunset_plus_dinner", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_dinner_places_without_result_id",
        requestId: "req_dinner_places_without_result_id",
        callId: "call_places_without_result_id",
        name: "search_places",
        arguments: placesArguments,
      }),
      {
        id: "resp_dinner_final_without_result_id",
        output_text: "Use the live-checked dinner venue.",
        _request_id: "req_dinner_final_without_result_id",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "plan_local_itinerary") {
        return {
          name: "plan_local_itinerary",
          status: "success",
          text: "Structured itinerary artifact prepared. Required Places check: dinner.",
          data: {
            plan: sunsetDinnerPlan,
            requiredToolChecks: {
              places: [{ required: true, tool: "search_places", ...placesArguments }],
            },
          },
          sources: [localGuideSourceSummary],
          itineraries: [sunsetDinnerPlan],
        };
      }
      if (request.name === "search_places") {
        return {
          name: "search_places",
          status: "success",
          text: "Google Places returned open dinner options.",
          sources: [openNowPlacesSourceSummary],
          cards: [
            {
              id: "card_kermit",
              kind: "place",
              title: "Kermit Siargao",
              subtitle: "Restaurant in General Luna",
              mapsUrl: "https://maps.example/kermit",
              openStatusLabel: "Open now according to Google Places.",
              fitReasons: ["Returned by Google Places for dinner restaurants."],
              caveats: ["Bookings and review text were not checked."],
              sourceLabel: "Google Places - live checked",
            },
          ],
          data: { search: { includedType: "restaurant" } },
        };
      }
      return {
        name: request.name,
        status: "error",
        text: `Unexpected tool ${request.name}.`,
        errorCode: "unexpected_tool",
        sources: [],
      };
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sunset plus dinner plan for tonight." }],
        requestId: "agent_request_dinner_itinerary_without_result_ids",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls[1]?.toolCallId).toBe("call_places_without_result_id");
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalCardCount: 1,
      totalItineraryCount: 1,
      unselectedCardCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("sandy beach half-day itineraries avoid surf-only brainstorms", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_sandy_plan",
        requestId: "req_sandy_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: {
          theme: "sandy_beach_half_day",
          origin: "General Luna",
          duration_hours: 3,
          max_ride_minutes: 30,
          avoid: ["surf-only stops"],
        },
      }),
      {
        id: "resp_sandy_final",
        output_text: "Use the sandy beach sequence and skip surf-only stops.",
        _request_id: "req_sandy_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured sandy beach itinerary artifact prepared.",
        sources: [localGuideSourceSummary],
        itineraries: [sandyBeachPlan],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          { role: "user", content: "Plan a non-surfer sandy beach half-day from General Luna." },
        ],
        requestId: "agent_request_sandy_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual(["plan_local_itinerary"]);
    expect(result.itineraries).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
    expect(result.message).toContain("skip surf-only stops");
  });

  test("food crawl itineraries call Places for live food options", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_food_plan",
        requestId: "req_food_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "food_crawl", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_food_places",
        requestId: "req_food_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_food_final",
        output_text: "Use the live food options as the crawl stops.",
        _request_id: "req_food_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured food crawl artifact prepared. Required Places check: restaurants.",
        sources: [genericSourceSummary],
        itineraries: [foodCrawlPlan],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned food options.",
        sources: [placesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Make a food crawl for 3 hours." }],
        requestId: "agent_request_food_crawl",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "search_places",
    ]);
    expect(result.sources).toEqual([genericSourceSummary, placesSourceSummary]);
  });

  test("Places failures in itinerary flows remain caveated instead of live checked", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_plan",
        requestId: "req_failed_places_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "sunset_plus_dinner", needs_open_now: true },
      }),
      responseWithToolCall({
        id: "resp_failed_places",
        requestId: "req_failed_places",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "dinner restaurants General Luna Siargao",
          center: { latitude: 9.784, longitude: 126.158 },
          radius_meters: 4000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 5 },
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text: "Places was unavailable, so dinner open status is not live checked.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required Places check: dinner.",
        sources: [localGuideSourceSummary],
        itineraries: [sunsetDinnerPlan],
      },
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places search failed.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sunset plus dinner plan for tonight." }],
        requestId: "agent_request_places_failure_itinerary",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.toolCalls[1]).toMatchObject({
      name: "search_places",
      status: "error",
      errorCode: "provider_unavailable",
    });
    expect(result.sources).toEqual([localGuideSourceSummary, providerUnavailableSourceSummary]);
    expect(result.message).toContain("not live checked");
  });

  test("keeps tool-generated cards and actions internal for legacy final answers", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_artifact_call",
        requestId: "req_artifact_call",
        callId: "call_local",
        name: "search_local_guide",
        arguments: {
          query: "sandy swimming beaches within 30 minutes",
          filters: { beach_surface: "sand", swimming: true, max_ride_minutes: 30 },
        },
      }),
      {
        id: "resp_artifact_final",
        output_text: "The model wrote this final answer after reading the tool output.",
        _request_id: "req_artifact_final",
      },
    ]);
    const card = {
      id: "card_doot",
      kind: "beach" as const,
      title: "Doot Beach",
      subtitle: "General Luna-side sandy beach",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Doot%20Beach%20Siargao",
      distanceLabel: "About 20 minutes by tricycle from General Luna",
      fitReasons: ["Sandy shore", "Works for a quieter beach stop"],
      caveats: ["Check tide and road conditions before leaving"],
      sourceLabel: "Ask Siargao curated local beach guide",
    };
    const action = {
      id: "ask_weather",
      label: "Check weather",
      prompt: "Check weather before going to Doot Beach.",
    };
    const executeTool = fakeToolExecutor({
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Curated local guide returned Doot Beach.",
        data: { restrictedProviderPayload: "SECRET_CARD_PAYLOAD" },
        sources: [localGuideSourceSummary],
        cards: [card],
        actions: [action],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Sandy beaches with kids near General Luna?" }],
        requestId: "agent_request_artifacts",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toBe("The model wrote this final answer after reading the tool output.");
    expect(result.cards).toBeUndefined();
    expect(result.actions).toBeUndefined();
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalCardCount: 1,
      totalActionCount: 1,
      unselectedCardCount: 1,
      unselectedActionCount: 1,
    });
    expect(result.sources).toEqual([localGuideSourceSummary]);
    expect(JSON.stringify(result.toolCalls)).not.toContain("SECRET_CARD_PAYLOAD");
    expect(parseToolOutput(client.requests[1]?.input, 0).cards).toBeUndefined();
    expect(parseToolOutput(client.requests[1]?.input, 0).actions).toBeUndefined();
  });

  test("auto-executes required itinerary checks before accepting final prose", async () => {
    const uncheckedItinerarySource: AnswerSourceSummary = {
      label: "not_verified",
      sourceName: "Itinerary planner unchecked live signals",
      confidence: "medium",
      checked: [],
      notChecked: ["weather forecast", "live open-now status", "surf"],
    };
    const planNeedingChecks: ItineraryPlan = {
      ...rainyCloud9Plan,
      sources: [uncheckedItinerarySource],
    };
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_required_plan",
        requestId: "req_required_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: { theme: "rainy_cloud_9_afternoon", needs_weather_check: true },
      }),
      {
        id: "resp_premature_final",
        output_text: "Premature final answer without required checks.",
        _request_id: "req_premature_final",
      },
      {
        id: "resp_checked_final",
        output_text: "Weather and Places were checked; keep surf caveats.",
        _request_id: "req_checked_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      plan_local_itinerary: {
        name: "plan_local_itinerary",
        status: "success",
        text: "Structured itinerary artifact prepared. Required weather and Places checks remain.",
        data: {
          plan: planNeedingChecks,
          requiredToolChecks: {
            weather: {
              required: true,
              tool: "get_weather_forecast",
              location: "Cloud 9",
              date_range: "today",
              reason: "Rain-sensitive Cloud 9 plan.",
            },
            places: [
              {
                required: true,
                tool: "search_places",
                query: "covered cafe Cloud 9 Siargao",
                center: { latitude: 9.8116, longitude: 126.1651 },
                radius_meters: 2500,
                constraints: { included_type: "cafe", open_now: true, page_size: 5 },
                reason: "Cafe fallback needs live identity and open status.",
              },
            ],
          },
        },
        sources: [uncheckedItinerarySource],
        itineraries: [planNeedingChecks],
      },
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Open-Meteo forecast loaded for Cloud 9.",
        sources: [weatherSourceSummary],
      },
      search_places: {
        name: "search_places",
        status: "success",
        text: "Google Places returned live cafe options.",
        sources: [openNowPlacesSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan a rainy Cloud 9 cafe afternoon." }],
        requestId: "agent_request_required_itinerary_checks",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Weather and Places were checked");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_weather_forecast",
      "search_places",
    ]);
    expect(client.requests).toHaveLength(3);
    const automaticInput = parseAutomaticRequiredCheckInput(client.requests[2]?.input);
    expect(automaticInput.automaticRequiredToolChecks?.map((check) => check.name)).toEqual([
      "get_weather_forecast",
      "search_places",
    ]);
    expect(result.itineraries).toBeUndefined();
    expect(result.sources).toContainEqual(weatherSourceSummary);
    expect(result.sources).toContainEqual(openNowPlacesSourceSummary);
    expect(result.artifactSelection).toMatchObject({
      structuredFinalPayload: false,
      totalItineraryCount: 1,
      unselectedItineraryCount: 1,
    });
  });

  test("repairs today Cloud 9 itinerary tool calls so live Places run before final prose", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_today_cloud9_plan",
        requestId: "req_today_cloud9_plan",
        callId: "call_plan",
        name: "plan_local_itinerary",
        arguments: {
          theme: "non_surfer_half_day",
          origin: "Cloud 9",
          needs_weather_check: false,
        },
      }),
      responseWithToolCall({
        id: "resp_today_cloud9_weather",
        requestId: "req_today_cloud9_weather",
        callId: "call_weather",
        name: "get_weather_forecast",
        arguments: { location: "Cloud 9", date_range: "today" },
      }),
      {
        id: "resp_today_cloud9_premature_final",
        output_text: "Premature final answer after weather but without live places.",
        _request_id: "req_today_cloud9_premature_final",
      },
      {
        id: "resp_today_cloud9_checked_final",
        output_text: "Weather and Google Places were checked before this final answer.",
        _request_id: "req_today_cloud9_checked_final",
      },
    ]);
    const observedPlanArguments: Record<string, unknown>[] = [];
    const executeTool: AgentToolExecutor = async (request) => {
      if (request.name === "plan_local_itinerary") {
        observedPlanArguments.push(request.arguments);
        return executeAgentTool(request);
      }
      if (request.name === "get_weather_forecast") {
        return {
          name: "get_weather_forecast",
          status: "success",
          text: "Open-Meteo forecast loaded for Cloud 9.",
          sources: [weatherSourceSummary],
        };
      }
      if (request.name === "search_places") {
        return {
          name: "search_places",
          status: "success",
          text: "Google Places returned open cafe options.",
          sources: [openNowPlacesSourceSummary],
        };
      }
      throw new Error(`Unexpected tool call: ${request.name}`);
    };

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "What should I do near Cloud 9 today?" }],
        requestId: "agent_request_today_cloud9_requires_places",
        deterministicSignals: {
          intent: {
            activityPlan: true,
            locationLabel: "Cloud 9",
            nearby: true,
            today: true,
          },
        },
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(observedPlanArguments[0]).toMatchObject({
      needs_open_now: true,
      needs_weather_check: true,
      origin: "Cloud 9",
    });
    expect(result.message).toContain("Google Places were checked");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "plan_local_itinerary",
      "get_weather_forecast",
      "search_places",
    ]);
    expect(client.requests).toHaveLength(4);
    const automaticInput = parseAutomaticRequiredCheckInput(client.requests[3]?.input);
    expect(automaticInput.automaticRequiredToolChecks?.map((check) => check.name)).toEqual([
      "search_places",
    ]);
    expect(result.sources).toContainEqual(weatherSourceSummary);
    expect(result.sources).toContainEqual(openNowPlacesSourceSummary);
  });

  test("executes safe local data tools through the tool loop", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_schema_call",
        requestId: "req_schema_call",
        callId: "call_schema",
        name: "describe_database_schema",
        arguments: {},
      }),
      responseWithToolCall({
        id: "resp_facts_call",
        requestId: "req_facts_call",
        callId: "call_facts",
        name: "query_local_facts",
        arguments: { entityTypes: ["beach"], tags: ["sandy"], limit: 2 },
      }),
      responseWithToolCall({
        id: "resp_evidence_call",
        requestId: "req_evidence_call",
        callId: "call_evidence",
        name: "get_source_evidence",
        arguments: { factIds: ["curated_local_guide:beach:doot-beach"] },
      }),
      {
        id: "resp_local_data_final",
        output_text: "Doot Beach is a curated local fact; tide and safety were not checked.",
        _request_id: "req_local_data_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      describe_database_schema: {
        name: "describe_database_schema",
        status: "success",
        text: "Safe schema dictionary loaded.",
        sources: [],
      },
      query_local_facts: {
        name: "query_local_facts",
        status: "success",
        text: "Safe local facts returned Doot Beach.",
        sources: [localGuideSourceSummary],
      },
      get_source_evidence: {
        name: "get_source_evidence",
        status: "success",
        text: "Display-safe evidence returned for Doot Beach.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Which sandy beach has source evidence?" }],
        requestId: "agent_request_local_data",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("Doot Beach");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "describe_database_schema",
      "query_local_facts",
      "get_source_evidence",
    ]);
    expect(result.toolCalls.map((toolCall) => toolCall.providerOperation)).toEqual([
      "local_data.schema",
      "local_data.query",
      "local_data.evidence",
    ]);
    expect(result.sources).toEqual([localGuideSourceSummary]);
  });

  test("executes multiple tool calls from one model response", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_multi_call",
        _request_id: "req_multi_call",
        output: [
          {
            type: "function_call",
            call_id: "call_weather",
            name: "get_weather_forecast",
            arguments: JSON.stringify({ location: "Cloud 9", date_range: "today" }),
          },
          {
            type: "function_call",
            call_id: "call_local",
            name: "search_local_guide",
            arguments: JSON.stringify({ query: "rain fit activities" }),
          },
        ],
      },
      {
        id: "resp_multi_final",
        output_text: "Use the early weather window, then keep a short local fallback nearby.",
        _request_id: "req_multi_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      get_weather_forecast: {
        name: "get_weather_forecast",
        status: "success",
        text: "Weather loaded.",
        sources: [weatherSourceSummary],
      },
      search_local_guide: {
        name: "search_local_guide",
        status: "success",
        text: "Local guide loaded.",
        sources: [localGuideSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Plan around rain near Cloud 9." }],
        requestId: "agent_request_multi",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(responseInputItemsByType(client.requests[1]?.input, "function_call")).toHaveLength(2);
    expect(
      responseInputItemsByType(client.requests[1]?.input, "function_call_output"),
    ).toHaveLength(2);
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      "get_weather_forecast",
      "search_local_guide",
    ]);
    expect(result.sources).toEqual([weatherSourceSummary, localGuideSourceSummary]);
  });

  test("continues the loop after a provider-failure tool output", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_call",
        requestId: "req_failed_places_call",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
          constraints: { open_now: true },
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text:
          "I could not check live Google Places open-now status, so verify before going.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places search failed: provider timeout.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
        requestId: "agent_request_provider_failure",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("could not check live Google Places");
    expect(result.toolCalls[0]).toMatchObject({
      status: "error",
      errorCode: "provider_unavailable",
    });
    expect(parseToolOutput(client.requests[1]?.input, 0).errorCode).toBe("provider_unavailable");
  });

  test("required Places provider failures remain caveated instead of retrying as checked evidence", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_required_failed_places_call",
        requestId: "req_required_failed_places_call",
        callId: "call_required_places",
        name: "search_places",
        arguments: {
          query: "restaurants and dinner spots in General Luna, Siargao",
          center: { latitude: 9.8006, longitude: 126.1586 },
          radius_meters: 12_000,
          constraints: { included_type: "restaurant", open_now: true, page_size: 8 },
        },
      }),
      {
        id: "resp_required_failed_places_final",
        output_text: finalPayloadText({
          answer:
            "Google Places was unavailable, so I cannot call any dinner option live checked tonight.",
          usedToolCallIds: ["call_required_places"],
        }),
        _request_id: "req_required_failed_places_final",
      },
    ]);
    const executeTool = fakeToolExecutor({
      search_places: {
        name: "search_places",
        status: "error",
        text: "Google Places search failed: provider timeout.",
        errorCode: "provider_unavailable",
        sources: [providerUnavailableSourceSummary],
      },
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Where should I eat in General Luna tonight?" }],
        requestId: "agent_request_required_places_provider_failure",
      },
      { client, executeTool, model: "gpt-test" },
    );

    expect(result.message).toContain("cannot call any dinner option live checked");
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual(["search_places"]);
    expect(result.toolCalls[0]).toMatchObject({
      status: "error",
      errorCode: "provider_unavailable",
    });
    expect(result.cards).toBeUndefined();
    expect(result.publicSources).toEqual([providerUnavailableSourceSummary]);
    expect(client.requests).toHaveLength(2);
  });

  test("covers cross-request answer-quality regressions with selected public artifacts", async () => {
    for (const scenario of answerQualityRegressionScenarios()) {
      const client = fakeResponsesClient([
        {
          id: `resp_${scenario.name}_tool_calls`,
          _request_id: `req_${scenario.name}_tool_calls`,
          output: scenario.toolCalls.map((toolCall) => ({
            type: "function_call",
            call_id: toolCall.callId,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          })),
        },
        {
          id: `resp_${scenario.name}_final`,
          output_text: finalPayloadText(scenario.finalPayload),
          _request_id: `req_${scenario.name}_final`,
        },
      ]);

      let result: Awaited<ReturnType<typeof runAskSiargaoAgentTurn>>;
      try {
        result = await runAskSiargaoAgentTurn(
          {
            messages: [{ role: "user", content: scenario.prompt }],
            requestId: `agent_request_${scenario.name}`,
            deterministicSignals: scenario.deterministicSignals,
          },
          {
            client,
            executeTool: fakeToolExecutor(scenario.toolResults),
            model: "gpt-test",
            requireStructuredFinalOutput: true,
          },
        );
      } catch (error) {
        throw new Error(`${scenario.name}: ${(error as Error).message}`);
      }

      expect(result.message, scenario.name).toStartWith(scenario.expectedOpening);
      for (const expectedText of scenario.expectedMessageText) {
        expect(result.message, scenario.name).toContain(expectedText);
      }
      assertTravelerProseHasNoInternalMechanics(result.message);
      assertDecisionGuidanceIsSpecific(result.message, scenario.expectedDecisionGuidance);
      expect(
        result.toolCalls.map((toolCall) => toolCall.name),
        scenario.name,
      ).toEqual(scenario.toolCalls.map((toolCall) => toolCall.name));
      expect(result.publicSources, scenario.name).toEqual(scenario.expectedPublicSources);
      expect(result.cards?.map((card) => card.id) ?? [], scenario.name).toEqual([
        ...scenario.expectedCardIds,
      ]);
      expect(result.itineraries?.map((itinerary) => itinerary.id) ?? [], scenario.name).toEqual([
        ...scenario.expectedItineraryIds,
      ]);
      expect(result.decisionSummaries?.map((summary) => summary.id) ?? [], scenario.name).toEqual([
        ...scenario.expectedDecisionSummaryIds,
      ]);
      expect(result.artifactSelection, scenario.name).toMatchObject(
        scenario.expectedArtifactSelection,
      );

      const publicArtifacts = JSON.stringify({
        cards: result.cards ?? [],
        itineraries: result.itineraries ?? [],
        decisionSummaries: result.decisionSummaries ?? [],
      });
      for (const leakedText of scenario.unselectedArtifactText) {
        expect(publicArtifacts, scenario.name).not.toContain(leakedText);
      }
    }
  });

  test("logs tool-loop metadata without raw tool output payloads", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_failed_places_call",
        requestId: "req_failed_places_call",
        callId: "call_places",
        name: "search_places",
        arguments: {
          query: "restaurants open now",
          center: { latitude: 9.8, longitude: 126.16 },
          radius_meters: 2500,
        },
      }),
      {
        id: "resp_failed_places_final",
        output_text: "I could not check live Google Places open-now status.",
        _request_id: "req_failed_places_final",
      },
    ]);
    const logs = captureLogger();

    await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Restaurants open now near General Luna?" }],
        requestId: "agent_request_logged_failure",
      },
      {
        client,
        logger: logs.logger,
        memorySnapshot: memorySnapshotFixture({
          instructionContent: "RAW_MEMORY_BODY_SECRET: never log this memory body.",
        }),
        executeTool: async (request) => ({
          name: request.name,
          status: "error",
          text: "Google Places search failed: raw provider payload SECRET_TOKEN.",
          logData: {
            providerFailure: {
              reason: "provider_exception",
              provider: "google_places",
              status: 503,
              message: "Sanitized upstream timeout.",
            },
          },
          data: { restrictedProviderPayload: "SECRET_TOKEN" },
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
        model: "gpt-test",
      },
    );

    const toolLog = logs.events.find(
      (event) => event.message === "Ask Siargao agent tool call completed.",
    );
    expect(logs.childBindings[0]?.requestId).toBe("agent_request_logged_failure");
    expect(toolLog?.payload).toMatchObject({
      toolCallId: "call_places",
      toolName: "search_places",
      status: "error",
      errorCode: "provider_unavailable",
      providerOperation: "google_places.search",
      sourceLabels: ["provider_unavailable"],
      sourceProfileIds: ["source_google_places"],
      toolDiagnostics: {
        providerFailure: {
          reason: "provider_exception",
          provider: "google_places",
          status: 503,
          message: "Sanitized upstream timeout.",
        },
      },
    });
    expect(JSON.stringify(toolLog?.payload)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(logs.events)).not.toContain("RAW_MEMORY_BODY_SECRET");
  });

  test("forces a final answer when another tool call would exceed the budget", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_loop_first",
        requestId: "req_loop_first",
        callId: "call_weather_1",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      responseWithToolCall({
        id: "resp_loop_second",
        requestId: "req_loop_second",
        callId: "call_weather_2",
        name: "get_weather_forecast",
        arguments: { location: "Siargao Island", date_range: "today" },
      }),
      {
        id: "resp_loop_budget_final",
        output_text: finalPayloadText({
          answer: "Use the checked forecast and keep the plan flexible.",
          usedToolCallIds: ["call_weather_1"],
        }),
        _request_id: "req_loop_budget_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [{ role: "user", content: "Check weather until certain." }],
        requestId: "agent_request_loop",
      },
      {
        client,
        executeTool: fakeToolExecutor({
          get_weather_forecast: {
            name: "get_weather_forecast",
            status: "success",
            text: "Weather loaded.",
            sources: [weatherSourceSummary],
          },
        }),
        maxToolCalls: 1,
        model: "gpt-test",
        requireStructuredFinalOutput: true,
      },
    );

    expect(result.message).toBe("Use the checked forecast and keep the plan flexible.");
    expect(result.toolCalls).toHaveLength(1);
    expect(client.requests).toHaveLength(3);
    expect(client.requests[2]?.tools).toBeUndefined();
    expect(JSON.stringify(parseFirstInput(client.requests[2]?.input))).toContain(
      "tool-call budget is exhausted",
    );
  });

  test("accepts minimal model-style web research calls without entering an invalid-argument loop", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_minimal_research",
        requestId: "req_minimal_research",
        callId: "call_minimal_research",
        name: "research_web",
        arguments: {
          query: "Cloud 9 Siargao quiet sleep surfing restaurants airport transfer",
          source_types: ["guide"],
          max_sources: 4,
        },
      }),
      {
        id: "resp_minimal_research_final",
        output_text: "Cloud 9 works if you stay slightly back from the boardwalk.",
        _request_id: "req_minimal_research_final",
      },
    ]);

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content:
              "Staying near Cloud 9 for 10 days with quiet sleep, surfing, restaurants, and airport transfer. What should we know?",
          },
        ],
        requestId: "agent_request_minimal_research_args",
      },
      {
        client,
        executeTool: (request) =>
          executeAgentTool(request, {
            webResearchProvider: async () => [
              {
                url: "https://example.com/cloud-9-guide",
                title: "Cloud 9 travel guide",
                sourceType: "guide",
                pageSummary:
                  "Cloud 9 has surf access, nearby food, and airport transfers arranged through stays.",
                publishedOrUpdatedAt: "2026-07-01T10:00:00+08:00",
              },
            ],
            now: () => new Date("2026-07-01T12:00:00+08:00"),
          }),
        model: "gpt-test",
      },
    );

    expect(result.message).toContain("Cloud 9 works");
    expect(result.toolCalls).toContainEqual(
      expect.objectContaining({
        name: "research_web",
        status: "success",
        toolCallId: "call_minimal_research",
      }),
    );
  });

  test("forces a final answer after repeated invalid web research arguments", async () => {
    const client = fakeResponsesClient([
      responseWithToolCall({
        id: "resp_invalid_research_1",
        requestId: "req_invalid_research_1",
        callId: "call_invalid_research_1",
        name: "research_web",
        arguments: {
          max_sources: "many",
        },
      }),
      responseWithToolCall({
        id: "resp_invalid_research_2",
        requestId: "req_invalid_research_2",
        callId: "call_invalid_research_2",
        name: "research_web",
        arguments: {
          queries: [],
          max_sources: "many",
        },
      }),
      {
        id: "resp_after_invalid_research_final",
        output_text:
          "Cloud 9 can still work from local memory and Places evidence, but public web research was not checked.",
        _request_id: "req_after_invalid_research_final",
      },
    ]);
    const executeTool: AgentToolExecutor = async (request) => ({
      name: request.name,
      toolCallId: request.toolCallId,
      status: "error",
      text: "Invalid arguments for research_web: Required",
      errorCode: "invalid_tool_arguments",
      sources: [],
    });

    const result = await runAskSiargaoAgentTurn(
      {
        messages: [
          {
            role: "user",
            content:
              "Staying near Cloud 9 for 10 days with quiet sleep, surfing, restaurants, and airport transfer. What should we know?",
          },
        ],
        requestId: "agent_request_repeated_invalid_research",
      },
      {
        client,
        executeTool,
        model: "gpt-test",
      },
    );

    expect(result.message).toContain("public web research was not checked");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: "research_web",
        status: "error",
        errorCode: "invalid_tool_arguments",
      }),
      expect.objectContaining({
        name: "research_web",
        status: "error",
        errorCode: "invalid_tool_arguments",
      }),
    ]);
    expect(client.requests.at(-1)).not.toHaveProperty("tools");
  });

  test("throws when a model response has neither final text nor tool calls", async () => {
    const client = fakeResponsesClient([
      {
        id: "resp_missing_output",
        output: [],
        _request_id: "req_missing_output",
      },
    ]);

    await expect(
      runAskSiargaoAgentTurn(
        {
          messages: [{ role: "user", content: "What is good today?" }],
          requestId: "agent_request_missing_output",
        },
        { client, model: "gpt-test" },
      ),
    ).rejects.toThrow("OpenAI response did not include output_text");
  });
});

type AnswerQualityScenario = {
  name: string;
  prompt: string;
  deterministicSignals?: Record<string, unknown>;
  toolCalls: Array<{
    callId: string;
    name: AgentToolResult["name"];
    arguments: Record<string, unknown>;
  }>;
  toolResults: Partial<Record<AgentToolResult["name"], AgentToolResult>>;
  finalPayload: Partial<AgentFinalPayload>;
  expectedOpening: string;
  expectedMessageText: readonly string[];
  expectedDecisionGuidance?: string;
  expectedPublicSources: readonly AnswerSourceSummary[];
  expectedCardIds: readonly string[];
  expectedItineraryIds: readonly string[];
  expectedDecisionSummaryIds: readonly string[];
  expectedArtifactSelection: Record<string, unknown>;
  unselectedArtifactText: readonly string[];
};

function answerQualityRegressionScenarios(): AnswerQualityScenario[] {
  const dapaBreakfastCard = recommendationCard({
    id: "place_dapa_breakfast_house",
    title: "Dapa Breakfast House",
    subtitle: "Breakfast in Dapa",
    fitReasons: ["Matches the Dapa breakfast area constraint."],
    caveats: ["Table availability was not confirmed."],
  });
  const irrelevantBeachCard = recommendationCard({
    id: "beach_doot_unused_for_breakfast",
    kind: "beach",
    title: "Doot Beach",
    subtitle: "General Luna-side beach",
    sourceLabel: "Ask Siargao curated local beach guide",
    sources: [localGuideSourceSummary],
    fitReasons: ["Useful for beaches, not breakfast."],
    caveats: ["Irrelevant to this food request."],
  });
  const cloud9RainPlan: ItineraryPlan = {
    id: "itinerary:cloud_9:rainy_3_hours",
    title: "Rainy Cloud 9 Three-Hour Plan",
    durationLabel: "3 hours",
    decision: {
      label: "fallback",
      bestAction: "Use a short Cloud 9 stop plus a covered cafe if showers build.",
    },
    stops: [
      {
        title: "Cloud 9 boardwalk",
        kind: "activity",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Keeps the iconic stop short in rain.",
        caveats: ["Move under cover if showers start."],
      },
      {
        title: "Covered cafe near Cloud 9",
        kind: "meal",
        sequence: 2,
        area: "Cloud 9",
        travelTimeFromPreviousMinutes: 5,
        rationale: "Preserves the three-hour timing without a long wet ride.",
        caveats: ["Open status should be confirmed before leaving."],
      },
    ],
    fallbackStops: [
      {
        title: "General Luna covered cafe",
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Better if rain is already heavy.",
        caveats: ["Confirm the venue is open."],
      },
    ],
    skip: ["Long exposed beach hopping"],
    sources: [localGuideSourceSummary, weatherSourceSummary],
  };
  const weatherUnavailableSummary: DecisionSummary = {
    id: "decision:cloud_9_sunset:weather_unavailable",
    bestAction: "Do not make Cloud 9 sunset the whole plan yet.",
    basis: "The forecast provider was unavailable, so the rain window is not confirmed.",
    fallback: "Keep a covered General Luna stop ready until you can confirm the sky locally.",
    timing: "today",
    area: "Cloud 9",
    sources: [weatherProviderUnavailableSourceSummary],
  };
  const tideSourceSummary: AnswerSourceSummary = {
    label: "tide_forecast_checked",
    sourceName: "Tide-Forecast tide table",
    sourceProfileId: "source_tide_forecast",
    fetchedAt: "2026-06-26T00:00:00.000Z",
    confidence: "medium",
    checked: ["tide timing for Pacifico"],
    notChecked: ["lesson availability", "lifeguard status"],
  };
  const pacificoSurfSummary: DecisionSummary = {
    id: "decision:pacifico_beginner_surf:tide",
    bestAction: "Book Pacifico only if your coach confirms a beginner window.",
    basis:
      "The tide timing works better around the checked window, but lesson availability is separate.",
    avoid: "Avoid paddling out alone as a beginner.",
    timing: "tomorrow morning",
    area: "Pacifico",
    sources: [weatherSourceSummary, tideSourceSummary, marineCheckedSourceSummary],
  };
  const malinaoSwimSummary: DecisionSummary = {
    id: "decision:malinao:kids_swim",
    bestAction: "Use Malinao as a tentative kids swim stop, not a guaranteed swim.",
    basis:
      "Weather evidence is usable, while tide, currents, and lifeguard status still need local eyes.",
    fallback: "Switch to a sand play or cafe stop if the water looks rough.",
    timing: "today",
    area: "Malinao",
    sources: [weatherSourceSummary, conditionMarineSourceSummary],
  };
  const delCarmenTransportSummary: DecisionSummary = {
    id: "decision:del_carmen:scooter_boat_rain",
    bestAction: "Leave extra time for Del Carmen and keep the boat leg conditional.",
    basis: "Road exposure and marine conditions both matter for this rainy transfer chain.",
    fallback: "Use a van or delay the boat if rain or chop builds.",
    timing: "today",
    area: "Del Carmen",
    sources: [weatherSourceSummary, conditionMarineSourceSummary],
  };
  const areaChoiceSummary: DecisionSummary = {
    id: "decision:general_luna_vs_malinao:quiet_family_budget",
    bestAction: "Choose Malinao for quiet sleep; use General Luna for meals by tricycle.",
    basis:
      "It preserves the kids, quiet, and budget constraints better than staying in the busiest strip.",
    avoid: "Avoid booking directly on the Cloud 9 road if quiet sleep is the priority.",
    area: "Malinao",
    sources: [localGuideSourceSummary],
  };
  const itineraryReviewPlan: ItineraryPlan = {
    id: "itinerary:review_input_only",
    title: "Reviewed Traveler Draft",
    durationLabel: "tomorrow",
    stops: [
      {
        title: "Cloud 9 sunset",
        kind: "activity",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Fine as the anchor.",
        caveats: ["Weather can change the value."],
      },
      {
        title: "Pacifico dinner",
        kind: "meal",
        sequence: 2,
        area: "Pacifico",
        rationale: "Too far before an early ferry.",
        caveats: ["Open status was not checked."],
      },
    ],
    fallbackStops: [],
    skip: ["Pacifico dinner before an early Dapa ferry"],
    sources: [localGuideSourceSummary],
  };
  const itineraryReviewSummary: DecisionSummary = {
    id: "decision:review:dapa_ferry_cloud9_pacifico",
    bestAction: "Keep Cloud 9, but move dinner back toward General Luna or Dapa.",
    basis: "Pacifico adds too much northbound travel before an 8 AM Dapa ferry.",
    avoid: "Avoid making Pacifico the dinner stop on that night.",
    timing: "tomorrow night",
    area: "General Luna / Dapa",
    sources: [localGuideSourceSummary],
  };
  const dapaClinicCard = recommendationCard({
    id: "place_dapa_clinic",
    title: "Dapa Community Clinic",
    subtitle: "Clinic near Dapa ferry area",
    fitReasons: ["Closest checked service fit for an urgent Dapa reef-cut request."],
    caveats: ["Current wait time and treatment availability were not confirmed."],
  });
  const irrelevantSurfCard = recommendationCard({
    id: "surf_cloud_9_unused_for_clinic",
    kind: "beach",
    title: "Cloud 9 surf tower",
    subtitle: "Surf landmark",
    sourceLabel: "Ask Siargao curated local beach guide",
    sources: [localGuideSourceSummary],
    fitReasons: ["Not a medical service."],
    caveats: ["Irrelevant to urgent care."],
  });

  return [
    {
      name: "food_place_dapa_breakfast",
      prompt: "I'm in Dapa before the ferry. Where should we get budget breakfast?",
      toolCalls: [
        {
          callId: "call_places_dapa_breakfast",
          name: "search_places",
          arguments: {
            query: "budget breakfast in Dapa Siargao",
            constraints: { included_type: "restaurant", page_size: 5 },
          },
        },
        {
          callId: "call_local_irrelevant_beach",
          name: "search_local_guide",
          arguments: { query: "Dapa beach fallback", filters: null },
        },
      ],
      toolResults: {
        search_places: {
          name: "search_places",
          status: "success",
          text: "Google Places returned Dapa breakfast options.",
          sources: [placesSourceSummary],
          cards: [dapaBreakfastCard],
        },
        search_local_guide: {
          name: "search_local_guide",
          status: "success",
          text: "Curated local guide returned beach ideas.",
          sources: [localGuideSourceSummary],
          cards: [irrelevantBeachCard],
        },
      },
      finalPayload: {
        answer:
          "Go with Dapa Breakfast House before the ferry; it fits Dapa, breakfast, and a budget stop without adding a General Luna detour.",
        usedToolCallIds: ["call_places_dapa_breakfast"],
        displayCardIds: [dapaBreakfastCard.id],
      },
      expectedOpening: "Go with Dapa Breakfast House",
      expectedMessageText: ["Dapa", "breakfast", "budget", "ferry"],
      expectedPublicSources: [placesSourceSummary],
      expectedCardIds: [dapaBreakfastCard.id],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [],
      expectedArtifactSelection: {
        selectedCardCount: 1,
        unselectedCardCount: 1,
        selectedDecisionSummaryCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [irrelevantBeachCard.title],
    },
    {
      name: "open_activity_cloud9_rain",
      prompt: "We have 3 hours near Cloud 9 today and rain may come. What should we do?",
      toolCalls: [
        {
          callId: "call_cloud9_activity_plan",
          name: "plan_local_itinerary",
          arguments: {
            theme: "rainy_cloud_9_afternoon",
            origin: "Cloud 9",
            duration_hours: 3,
            needs_weather_check: true,
          },
        },
        {
          callId: "call_cloud9_weather",
          name: "get_weather_forecast",
          arguments: { location: "Cloud 9", date_range: "today" },
        },
      ],
      toolResults: {
        plan_local_itinerary: {
          name: "plan_local_itinerary",
          status: "success",
          text: "Prepared a rainy Cloud 9 local-fit plan.",
          sources: [localGuideSourceSummary],
          itineraries: [cloud9RainPlan],
        },
        get_weather_forecast: {
          name: "get_weather_forecast",
          status: "success",
          text: "Open-Meteo forecast loaded for Cloud 9.",
          sources: [weatherSourceSummary],
        },
      },
      finalPayload: {
        answer:
          "Do the short Cloud 9 boardwalk first, then switch to the covered cafe if showers build within your 3-hour window.",
        usedToolCallIds: ["call_cloud9_activity_plan", "call_cloud9_weather"],
        displayItineraryIds: [cloud9RainPlan.id ?? ""],
      },
      expectedOpening: "Do the short Cloud 9 boardwalk first",
      expectedMessageText: ["Cloud 9", "covered cafe", "3-hour", "showers"],
      expectedDecisionGuidance: "if showers build",
      expectedPublicSources: [localGuideSourceSummary, weatherSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [cloud9RainPlan.id ?? ""],
      expectedDecisionSummaryIds: [],
      expectedArtifactSelection: {
        selectedItineraryCount: 1,
        unselectedItineraryCount: 0,
        selectedCardCount: 0,
        selectedDecisionSummaryCount: 0,
      },
      unselectedArtifactText: [],
    },
    {
      name: "weather_go_no_go_cloud9_unavailable",
      prompt: "Given today's weather and tide, should we still go to Cloud 9 for sunset?",
      toolCalls: [
        {
          callId: "call_cloud9_weather_unavailable",
          name: "get_condition_judgment",
          arguments: {
            activity: "sunset",
            location: "Cloud 9",
            date_range: "today",
            beach_name: "Cloud 9",
          },
        },
      ],
      toolResults: {
        get_condition_judgment: {
          name: "get_condition_judgment",
          status: "error",
          text: "Open-Meteo forecast failed before a sunset judgment could be checked.",
          errorCode: "provider_unavailable",
          sources: [weatherProviderUnavailableSourceSummary],
          decisionSummaries: [weatherUnavailableSummary],
        },
      },
      finalPayload: {
        answer:
          "Do not make Cloud 9 sunset the whole plan yet; keep a covered General Luna stop ready until you can confirm the sky locally.",
        usedToolCallIds: ["call_cloud9_weather_unavailable"],
        displayDecisionSummaryIds: [weatherUnavailableSummary.id],
        realityCheck: {
          kind: "immediate_plan",
          verdict: "needs_confirmation",
          subject: "Cloud 9 sunset today",
          bestAction: "Do not make Cloud 9 sunset the whole plan yet.",
          basis: "The current weather and tide picture could not be established.",
          fallback: "Keep a covered General Luna stop ready until the sky is locally clear.",
          avoid: "Avoid committing to a long exposed stop before confirming conditions.",
          timing: "today at sunset",
          area: "Cloud 9",
          evidenceToolCallIds: ["call_cloud9_weather_unavailable"],
        },
      },
      expectedOpening: "**needs confirmation: Cloud 9 sunset today**",
      expectedMessageText: ["Cloud 9", "covered General Luna", "current weather and tide"],
      expectedDecisionGuidance: "Keep a covered General Luna stop ready",
      expectedPublicSources: [weatherProviderUnavailableSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [
        realityCheckSummaryId(
          "agent_request_weather_go_no_go_cloud9_unavailable",
          "immediate_plan",
          "Cloud 9 sunset today",
        ),
      ],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        unselectedDecisionSummaryCount: 1,
        selectedCardCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [],
    },
    {
      name: "surf_tide_pacifico_beginner",
      prompt: "Beginner surf in Pacifico tomorrow morning: does the tide make it worth booking?",
      toolCalls: [
        {
          callId: "call_pacifico_condition",
          name: "get_condition_judgment",
          arguments: {
            activity: "surfing",
            location: "Siargao Island",
            date_range: "next_7_days",
            beach_name: "Pacifico Beach",
            include_local_caveats: true,
            constraints: ["beginner"],
          },
        },
        {
          callId: "call_surf_memory",
          name: "load_agent_memory_file",
          arguments: { documents: ["SURF.md"] },
        },
        {
          callId: "call_pacifico_surf_rank",
          name: "rank_surf_spots_nearby",
          arguments: { skill_level: "beginner", max_results: 3 },
        },
      ],
      toolResults: {
        load_agent_memory_file: {
          name: "load_agent_memory_file",
          status: "success",
          text: "Loaded memory files: SURF.md",
          data: {
            loadedMemoryFileNames: ["SURF.md"],
            files: [{ fileName: "SURF.md", content: "Surf reference body." }],
          },
          sources: [],
        },
        get_condition_judgment: {
          name: "get_condition_judgment",
          status: "success",
          text: "Weather, tide, and modelled marine conditions loaded for Pacifico.",
          sources: [weatherSourceSummary, tideSourceSummary, marineCheckedSourceSummary],
          decisionSummaries: [pacificoSurfSummary],
        },
        rank_surf_spots_nearby: {
          name: "rank_surf_spots_nearby",
          status: "success",
          text: "Pacifico is a relevant north Siargao surf area for beginner coaching.",
          sources: [localGuideSourceSummary],
        },
      },
      finalPayload: {
        answer:
          "Book Pacifico only if your coach confirms a beginner window tomorrow morning; the tide timing helps, but do not paddle out alone.",
        usedMemoryFiles: ["SURF.md"],
        usedToolCallIds: ["call_pacifico_condition", "call_pacifico_surf_rank"],
        displayDecisionSummaryIds: [pacificoSurfSummary.id],
        realityCheck: {
          kind: "surf_session",
          verdict: "change",
          subject: "Pacifico beginner surf tomorrow morning",
          bestAction: "Book only if your coach confirms a beginner window.",
          basis: "The tide timing helps, but it does not confirm lesson or session safety.",
          avoid: "Do not paddle out alone as a beginner.",
          timing: "tomorrow morning",
          area: "Pacifico",
          evidenceToolCallIds: ["call_pacifico_condition"],
        },
      },
      expectedOpening: "**change: Pacifico beginner surf tomorrow morning**",
      expectedMessageText: ["Pacifico", "beginner", "tomorrow morning", "tide"],
      expectedDecisionGuidance: "Do not paddle out alone",
      expectedPublicSources: [
        weatherSourceSummary,
        tideSourceSummary,
        marineCheckedSourceSummary,
        localGuideSourceSummary,
      ],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [
        realityCheckSummaryId(
          "agent_request_surf_tide_pacifico_beginner",
          "surf_session",
          "Pacifico beginner surf tomorrow morning",
        ),
      ],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        unselectedDecisionSummaryCount: 1,
        selectedCardCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [],
    },
    {
      name: "beach_swimming_malinao_kids",
      prompt: "Is Malinao a good beach for swimming with kids today?",
      toolCalls: [
        {
          callId: "call_malinao_swim_condition",
          name: "get_condition_judgment",
          arguments: {
            activity: "swimming",
            location: "General Luna",
            date_range: "today",
            beach_name: "Malinao Beach",
            constraints: ["with kids"],
          },
        },
      ],
      toolResults: {
        get_condition_judgment: {
          name: "get_condition_judgment",
          status: "success",
          text: "Condition judgment loaded for Malinao with kids.",
          sources: [weatherSourceSummary, conditionMarineSourceSummary],
          decisionSummaries: [malinaoSwimSummary],
          cards: [irrelevantSurfCard],
        },
      },
      finalPayload: {
        answer:
          "Use Malinao as a tentative kids swim stop today, but only enter if the water looks calm when you arrive.",
        usedToolCallIds: ["call_malinao_swim_condition"],
        displayDecisionSummaryIds: [malinaoSwimSummary.id],
      },
      expectedOpening: "Use Malinao as a tentative kids swim stop today",
      expectedMessageText: ["Malinao", "kids", "today", "water looks calm"],
      expectedDecisionGuidance: "only enter if the water looks calm",
      expectedPublicSources: [weatherSourceSummary, conditionMarineSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [malinaoSwimSummary.id],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        unselectedCardCount: 1,
        selectedCardCount: 0,
      },
      unselectedArtifactText: [irrelevantSurfCard.title],
    },
    {
      name: "transport_del_carmen_rain_boat",
      prompt: "Can we scooter to Del Carmen before a Sugba boat trip today if it rains?",
      toolCalls: [
        {
          callId: "call_del_carmen_transport",
          name: "get_condition_judgment",
          arguments: {
            activity: "boat_trip",
            location: "Del Carmen",
            date_range: "today",
            beach_name: "Sugba Lagoon",
          },
        },
      ],
      toolResults: {
        get_condition_judgment: {
          name: "get_condition_judgment",
          status: "success",
          text: "Condition judgment loaded for Del Carmen road and boat exposure.",
          sources: [weatherSourceSummary, conditionMarineSourceSummary],
          decisionSummaries: [delCarmenTransportSummary],
        },
      },
      finalPayload: {
        answer:
          "Leave extra time for Del Carmen and keep the Sugba boat leg conditional if rain or chop builds.",
        usedToolCallIds: ["call_del_carmen_transport"],
        displayDecisionSummaryIds: [delCarmenTransportSummary.id],
      },
      expectedOpening: "Leave extra time for Del Carmen",
      expectedMessageText: ["Del Carmen", "Sugba", "rain", "boat"],
      expectedDecisionGuidance: "keep the Sugba boat leg conditional",
      expectedPublicSources: [weatherSourceSummary, conditionMarineSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [delCarmenTransportSummary.id],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        selectedCardCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [],
    },
    {
      name: "accommodation_area_choice_malinao",
      prompt: "Should we stay in General Luna or Malinao with kids, quiet sleep, and a budget?",
      toolCalls: [
        {
          callId: "call_general_luna_area",
          name: "query_local_facts",
          arguments: {
            entityTypes: ["area", "route"],
            area: "general luna",
            text: "General Luna",
            limit: 5,
          },
        },
        {
          callId: "call_malinao_area",
          name: "query_local_facts",
          arguments: {
            entityTypes: ["area", "route"],
            area: "malinao",
            text: "Malinao",
            limit: 5,
          },
        },
      ],
      toolResults: {
        query_local_facts: {
          name: "query_local_facts",
          status: "success",
          text: "Curated local guide returned area-fit tradeoffs.",
          sources: [localGuideSourceSummary],
          decisionSummaries: [areaChoiceSummary],
        },
      },
      finalPayload: {
        answer:
          "Choose Malinao for quiet sleep with kids on a budget; keep General Luna as the meal and errand area by tricycle.",
        usedToolCallIds: ["call_general_luna_area", "call_malinao_area"],
        displayDecisionSummaryIds: [areaChoiceSummary.id],
        realityCheck: {
          kind: "accommodation",
          verdict: "change",
          subject: "General Luna or Malinao",
          bestAction: "Choose Malinao for the area fit. Room noise is not confirmed.",
          basis:
            "The governed area comparison favors Malinao for this family budget and transport profile.",
          fallback:
            "Use General Luna if meal and errand access matters more than the area tradeoff.",
          area: "Malinao",
          evidenceToolCallIds: ["call_general_luna_area", "call_malinao_area"],
        },
      },
      expectedOpening: "**change: General Luna or Malinao**",
      expectedMessageText: ["Malinao", "General Luna", "family", "budget"],
      expectedDecisionGuidance: "Choose Malinao for the area fit",
      expectedPublicSources: [localGuideSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [
        realityCheckSummaryId(
          "agent_request_accommodation_area_choice_malinao",
          "accommodation",
          "General Luna or Malinao",
        ),
      ],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        unselectedDecisionSummaryCount: 1,
        selectedCardCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [],
    },
    {
      name: "itinerary_review_dapa_ferry",
      prompt:
        "Review my plan: Cloud 9 sunset, dinner in Pacifico, then an 8 AM Dapa ferry tomorrow.",
      toolCalls: [
        {
          callId: "call_itinerary_review",
          name: "plan_local_itinerary",
          arguments: {
            theme: "itinerary_review",
            origin: "Cloud 9",
            review_days: [
              {
                day_label: "Day 1",
                stops: [
                  {
                    title: "Cloud 9 sunset",
                    area: "Cloud 9",
                    kind: "activity",
                    time: "17:00",
                    duration_minutes: 60,
                  },
                  {
                    title: "Pacifico dinner",
                    area: "Pacifico",
                    kind: "meal",
                    time: "19:30",
                    duration_minutes: 90,
                  },
                ],
              },
              {
                day_label: "Day 2",
                stops: [
                  {
                    title: "Dapa ferry",
                    area: "Dapa",
                    kind: "transfer",
                    time: "08:00",
                    duration_minutes: 30,
                  },
                ],
              },
            ],
          },
        },
      ],
      toolResults: {
        plan_local_itinerary: {
          name: "plan_local_itinerary",
          status: "success",
          text: "Reviewed the proposed route timing.",
          sources: [localGuideSourceSummary],
          itineraries: [itineraryReviewPlan],
          decisionSummaries: [itineraryReviewSummary],
        },
      },
      finalPayload: {
        answer:
          "Keep Cloud 9 sunset, but move dinner back toward General Luna or Dapa before the 8 AM ferry.",
        usedToolCallIds: ["call_itinerary_review"],
        displayDecisionSummaryIds: [itineraryReviewSummary.id],
        realityCheck: {
          kind: "itinerary",
          verdict: "change",
          subject: "Cloud 9, Pacifico, and early Dapa ferry plan",
          bestAction: "Keep Cloud 9 sunset, but move dinner toward General Luna or Dapa.",
          basis:
            "The submitted sequence leaves a weak overnight position before the 8 AM Dapa ferry.",
          fallback: "Drop Pacifico dinner and travel south before dark.",
          timing: "the evening before the 8 AM ferry",
          area: "Pacifico to Dapa",
          evidenceToolCallIds: ["call_itinerary_review"],
        },
      },
      expectedOpening: "**change: Cloud 9, Pacifico, and early Dapa ferry plan**",
      expectedMessageText: ["General Luna", "Dapa", "8 AM ferry"],
      expectedDecisionGuidance: "move dinner toward General Luna or Dapa",
      expectedPublicSources: [localGuideSourceSummary],
      expectedCardIds: [],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [
        realityCheckSummaryId(
          "agent_request_itinerary_review_dapa_ferry",
          "itinerary",
          "Cloud 9, Pacifico, and early Dapa ferry plan",
        ),
      ],
      expectedArtifactSelection: {
        selectedDecisionSummaryCount: 1,
        unselectedDecisionSummaryCount: 1,
        selectedItineraryCount: 0,
        unselectedItineraryCount: 1,
      },
      unselectedArtifactText: [itineraryReviewPlan.title],
    },
    {
      name: "safety_local_service_dapa_clinic",
      prompt: "Urgent: closest clinic or pharmacy near Dapa ferry for a reef cut?",
      toolCalls: [
        {
          callId: "call_dapa_clinic_places",
          name: "search_places",
          arguments: {
            query: "clinic pharmacy near Dapa ferry Siargao",
            constraints: { included_type: "health", page_size: 5 },
          },
        },
        {
          callId: "call_dapa_service_irrelevant_surf",
          name: "search_local_guide",
          arguments: { query: "Dapa reef cut surf spots", filters: null },
        },
      ],
      toolResults: {
        search_places: {
          name: "search_places",
          status: "success",
          text: "Google Places returned nearby Dapa clinic and pharmacy service options.",
          sources: [placesSourceSummary],
          cards: [dapaClinicCard],
        },
        search_local_guide: {
          name: "search_local_guide",
          status: "success",
          text: "Curated local guide returned an unrelated surf landmark.",
          sources: [localGuideSourceSummary],
          cards: [irrelevantSurfCard],
        },
      },
      finalPayload: {
        answer:
          "Go to the Dapa clinic first for an urgent reef cut; call ahead or use the nearest pharmacy only for basic supplies.",
        usedToolCallIds: ["call_dapa_clinic_places"],
        displayCardIds: [dapaClinicCard.id],
      },
      expectedOpening: "Go to the Dapa clinic first",
      expectedMessageText: ["urgent reef cut", "Dapa", "pharmacy"],
      expectedDecisionGuidance: "call ahead",
      expectedPublicSources: [placesSourceSummary],
      expectedCardIds: [dapaClinicCard.id],
      expectedItineraryIds: [],
      expectedDecisionSummaryIds: [],
      expectedArtifactSelection: {
        selectedCardCount: 1,
        unselectedCardCount: 1,
        selectedDecisionSummaryCount: 0,
        selectedItineraryCount: 0,
      },
      unselectedArtifactText: [irrelevantSurfCard.title],
    },
  ];
}

function recommendationCard({
  caveats,
  fitReasons,
  id,
  kind = "place",
  sourceLabel = "Google Places - live checked",
  sources = [placesSourceSummary],
  subtitle,
  title,
}: {
  id: string;
  title: string;
  subtitle?: string;
  kind?: RecommendationCard["kind"];
  sourceLabel?: string;
  sources?: readonly AnswerSourceSummary[];
  fitReasons: readonly string[];
  caveats: readonly string[];
}): RecommendationCard {
  return {
    id,
    kind,
    title,
    ...(subtitle ? { subtitle } : {}),
    mapsUrl: `https://maps.example/${id}`,
    fitReasons,
    caveats,
    sourceLabel,
    sources,
  };
}

function assertTravelerProseHasNoInternalMechanics(message: string) {
  const normalizedMessage = message.toLowerCase();
  for (const bannedTerm of [
    " tool",
    "api",
    "artifact",
    "required check",
    "fallback promotion",
    "source caveat",
    "live_checked",
    "not_checked",
    "not checked",
    "not verified",
    "source-profile",
    "source profile",
    "vector-store",
    "vector store",
    "validation",
    "repair",
  ]) {
    expect(normalizedMessage).not.toContain(bannedTerm);
  }
}

function assertDecisionGuidanceIsSpecific(message: string, expectedGuidance?: string) {
  const normalizedMessage = message.toLowerCase();
  const guidanceTerms = ["fallback", "avoid", "confirm", "call ahead", "if ", "only if"];
  const hasGuidance = guidanceTerms.some((term) => normalizedMessage.includes(term));

  if (expectedGuidance) {
    expect(message).toContain(expectedGuidance);
    return;
  }

  expect(hasGuidance).toBe(false);
}

function finalPayloadText(overrides: Partial<AgentFinalPayload> = {}) {
  return JSON.stringify({
    answer: overrides.answer ?? "Structured final answer.",
    usedMemoryFiles: overrides.usedMemoryFiles ?? [],
    usedToolCallIds: overrides.usedToolCallIds ?? [],
    displayCardIds: overrides.displayCardIds ?? [],
    displayActionIds: overrides.displayActionIds ?? [],
    displayItineraryIds: overrides.displayItineraryIds ?? [],
    displayDecisionSummaryIds: overrides.displayDecisionSummaryIds ?? [],
    ...(overrides.realityCheck ? { realityCheck: overrides.realityCheck } : {}),
  } satisfies AgentFinalPayload);
}

function realityCheckSummaryId(requestId: string, kind: string, subject: string) {
  const fingerprint = createHash("sha256")
    .update(`${requestId}\u0000${kind}\u0000${subject}`)
    .digest("hex")
    .slice(0, 16);
  return `reality_check:${kind}:${fingerprint}`;
}

function fakeResponsesClient(responses: AgentResponsesCreateResult[]) {
  const pending = [...responses];
  const requests: Record<string, unknown>[] = [];
  const client = {
    requests,
    responses: {
      create: async (params: Record<string, unknown>) => {
        requests.push(params);
        const response = pending.shift();
        if (!response) {
          throw new Error("No fake model response queued.");
        }
        return response;
      },
    },
  } satisfies AgentResponsesClient & { requests: Record<string, unknown>[] };
  return client;
}

function responseWithToolCall({
  arguments: args,
  callId,
  id,
  name,
  requestId,
}: {
  id: string;
  requestId: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}): AgentResponsesCreateResult {
  return {
    id,
    _request_id: requestId,
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
}

function fakeToolExecutor(
  results: Partial<Record<AgentToolResult["name"], AgentToolResult>>,
): AgentToolExecutor {
  return async (request) => {
    const result = results[request.name];
    if (!result) {
      return {
        name: request.name,
        status: "error",
        text: `No fake result queued for ${request.name}.`,
        errorCode: "fake_tool_missing",
        sources: [],
      };
    }
    return {
      ...result,
      toolCallId: request.toolCallId,
    };
  };
}

function memoryLoadExecutor(): AgentToolExecutor {
  return async (request) => {
    const documents = readDocumentsArgument(request.arguments);
    return {
      name: request.name,
      status: "success",
      text: `Loaded memory files: ${documents.join(", ")}`,
      toolCallId: request.toolCallId,
      data: {
        loadedMemoryFileNames: documents,
        files: documents.map((fileName) => ({
          fileName,
          content: `${fileName} loaded reference body.`,
        })),
      },
      sources: [],
    };
  };
}

function readDocumentsArgument(args: Record<string, unknown>) {
  return Array.isArray(args.documents)
    ? args.documents.filter((item): item is string => typeof item === "string")
    : [];
}

function steppedClock(isoTimes: string[]) {
  const pending = [...isoTimes];
  return () => new Date(pending.shift() ?? isoTimes.at(-1) ?? "2026-06-26T00:00:00.000Z");
}

function parseFirstInput(input: unknown): {
  conversation?: Array<{ content?: string }>;
  deterministicSignals?: Record<string, unknown>;
  agentMemory?: {
    versionId?: string;
    vectorStoreId?: string;
    files?: Array<Record<string, unknown>>;
  };
  responseContract?: {
    deterministicSignals?: string;
    finalOutput?: string;
  };
} {
  return parseLastUserInputMessage(input) ?? {};
}

function parseAutomaticRequiredCheckInput(input: unknown): {
  automaticRequiredToolChecks?: Array<{ name?: string }>;
} {
  return parseLastUserInputMessage(input) ?? {};
}

function parseAutomaticRequiredPlanInput(input: unknown): {
  validationRepairItineraryPlan?: { name?: string };
} {
  return parseLastUserInputMessage(input) ?? {};
}

function parseAutomaticConditionInput(input: unknown): {
  instruction?: string;
  validationRepairConditionJudgment?: { name?: string };
} {
  return parseLastUserInputMessage(input) ?? {};
}

function parseAutomaticMemoryInput(input: unknown): {
  validationRepairMemoryLoad?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
} {
  return parseLastUserInputMessage(input) ?? {};
}

function parseToolOutput(
  input: unknown,
  index: number,
): {
  text?: string;
  errorCode?: string;
} & Record<string, unknown> {
  if (!Array.isArray(input)) {
    return {};
  }

  const item = responseInputItemsByType(input, "function_call_output")[index];
  if (!isRecord(item) || typeof item.output !== "string") {
    return {};
  }

  return JSON.parse(item.output);
}

function parseLastUserInputMessage(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "string") {
    return JSON.parse(input);
  }
  if (!Array.isArray(input)) {
    return undefined;
  }

  const item = [...input]
    .reverse()
    .find(
      (candidate) =>
        isRecord(candidate) && candidate.type === "message" && candidate.role === "user",
    );
  if (!isRecord(item) || !Array.isArray(item.content)) {
    return undefined;
  }

  const textPart = item.content.find(
    (candidate) => isRecord(candidate) && candidate.type === "input_text",
  );
  if (!isRecord(textPart) || typeof textPart.text !== "string") {
    return undefined;
  }

  return JSON.parse(textPart.text);
}

function responseInputItemsByType(input: unknown, type: string) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item) => isRecord(item) && item.type === type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureLogger() {
  const childBindings: Record<string, unknown>[] = [];
  const events: Array<{ level: string; payload: Record<string, unknown>; message: string }> = [];
  const logger = {
    child: (bindings: Record<string, unknown>) => {
      childBindings.push(bindings);
      return logger;
    },
    debug: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "debug", payload, message });
    },
    error: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "error", payload, message });
    },
    info: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "info", payload, message });
    },
    warn: (payload: Record<string, unknown>, message: string) => {
      events.push({ level: "warn", payload, message });
    },
  } as unknown as Logger;

  return { childBindings, events, logger };
}

function memorySnapshotFixture({
  instructionContent = "Use INDEX.md to choose which detailed memory files to load.",
  sourcePolicyContent = "Never create source labels from memory retrieval alone.",
}: {
  instructionContent?: string;
  sourcePolicyContent?: string;
} = {}): AgentMemorySnapshot {
  return {
    versionId: "agent-memory:testmemory000000000000",
    files: [
      {
        id: "ask_siargao_memory_index",
        title: "Ask Siargao Agent Memory Index",
        fileName: "INDEX.md",
        relativePath: "docs/agent-memory/INDEX.md",
        role: "instruction",
        checksum: "a".repeat(64),
        byteLength: instructionContent.length,
        content: instructionContent,
      },
      {
        id: "ask_siargao_source_policy",
        title: "Ask Siargao Source Policy",
        fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
        role: "reference",
        description: "Source-label policy and memory retrieval boundaries.",
        triggerTerms: ["source labels", "memory policy"],
        checksum: "b".repeat(64),
        byteLength: sourcePolicyContent.length,
        content: sourcePolicyContent,
      },
    ],
    instructionMarkdown: instructionContent,
    referenceFiles: [
      {
        id: "ask_siargao_source_policy",
        title: "Ask Siargao Source Policy",
        fileName: "ASK_SIARGAO_SOURCE_POLICY.md",
        relativePath: "docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md",
        role: "reference",
        description: "Source-label policy and memory retrieval boundaries.",
        triggerTerms: ["source labels", "memory policy"],
        checksum: "b".repeat(64),
        byteLength: sourcePolicyContent.length,
        content: sourcePolicyContent,
      },
    ],
  };
}

function requiredMemoryContent(memorySnapshot: AgentMemorySnapshot, fileName: string) {
  const memoryFile = memorySnapshot.files.find((file) => file.fileName === fileName);
  if (!memoryFile) {
    throw new Error(`Missing memory fixture file ${fileName}`);
  }
  return memoryFile.content;
}

function fakePaidUsageSession({
  reserveDecisionMeter,
}: {
  reserveDecisionMeter: (meterType: PaidDecisionMeterType) => Promise<PaidDecisionMeterReservation>;
}): Extract<PaidChatUsageSessionResult, { status: "allowed" }> {
  return {
    status: "allowed",
    allowance: {
      chatMessages: {
        limit: 150,
        remaining: 149,
        used: 1,
      },
    },
    passId: "trip_pass_test",
    release: async () => {},
    reserveDecisionMeter: ({ meterType }) => reserveDecisionMeter(meterType),
    settle: async () => ({
      status: "settled",
      allowance: {
        chatMessages: {
          limit: 150,
          remaining: 149,
          used: 1,
        },
      },
    }),
  };
}

function reservedDecisionMeter(
  meterType: PaidDecisionMeterType,
  options: {
    onRelease?: () => void;
    onSettle?: (success: boolean, providerRequestIds: readonly string[]) => void;
    reuseSettlement?: boolean;
  } = {},
): Extract<PaidDecisionMeterReservation, { status: "reserved" }> {
  let settled = false;
  return {
    status: "reserved",
    meterType,
    release: async () => {
      options.onRelease?.();
    },
    settle: async ({ providerRequestIds = [], success }) => {
      if (!options.reuseSettlement || !settled) {
        options.onSettle?.(success, providerRequestIds);
      }
      settled = true;
      if (!success) {
        return {
          status: "released",
          allowance: { meterType, limit: 40, remaining: 40, used: 0 },
        };
      }
      return {
        status: "settled",
        allowance: { meterType, limit: 40, remaining: 39, used: 1 },
      };
    },
  };
}

const weatherSourceSummary: AnswerSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["forecast for Siargao Island"],
  notChecked: ["surf reports"],
};

const conditionMarineSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Condition judgment unchecked marine signals",
  confidence: "medium",
  checked: [],
  notChecked: ["tide", "surf", "swell", "currents", "lifeguard or swimming safety"],
};

const marineCheckedSourceSummary: AnswerSourceSummary = {
  label: "marine_checked",
  sourceName: "Open-Meteo Marine API",
  sourceProfileId: "source_open_meteo_marine",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["modelled wave height", "modelled swell height", "modelled current velocity"],
  notChecked: ["exact-break conditions", "rip currents", "lifeguard status", "surf safety"],
};

const placesSourceSummary: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "high",
  checked: ["place identity", "map link"],
  notChecked: ["review text", "bookings"],
};

const openNowPlacesSourceSummary: AnswerSourceSummary = {
  ...placesSourceSummary,
  checked: ["place identity", "map link", "open-now signal"],
};

const localGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach surface notes", "ride-time notes"],
  notChecked: ["live tide", "lifeguard status"],
};

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Itinerary planner unchecked live signals",
  confidence: "medium",
  checked: [],
  notChecked: ["live open-now status", "weather forecast"],
};

const rainyCloud9Plan: ItineraryPlan = {
  title: "Rainy Cloud 9 Afternoon",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Cloud 9 boardwalk",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep the exposed stop short.",
      caveats: ["Weather still needs a forecast check."],
    },
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 2,
      area: "Cloud 9",
      travelTimeFromPreviousMinutes: 5,
      rationale: "Fallback if rain builds.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [
    {
      title: "Covered cafe near Cloud 9",
      kind: "meal",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Use when rain is active.",
      caveats: ["Open status needs Places."],
    },
  ],
  skip: ["Exposed beach hopping"],
  sources: [localGuideSourceSummary],
};

const sunsetDinnerPlan: ItineraryPlan = {
  title: "Sunset plus Dinner",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Cloud 9 sunset stop",
      kind: "activity",
      sequence: 1,
      area: "Cloud 9",
      rationale: "Keep sunset close to General Luna.",
      caveats: ["Weather still needs a forecast check."],
    },
    {
      title: "Dinner in General Luna",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 10,
      rationale: "Avoid a long ride after sunset.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [],
  skip: ["Far north dinner detours after sunset"],
  sources: [localGuideSourceSummary],
};

const sandyBeachPlan: ItineraryPlan = {
  title: "Sandy Beach Half-Day",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "Doot Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna side",
      rationale: "Use the sandy beach option instead of surf-only Cloud 9.",
      caveats: ["Tide and lifeguard status were not checked."],
    },
    {
      title: "General Luna snack stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      travelTimeFromPreviousMinutes: 15,
      rationale: "Keep the route compact for a half-day.",
      caveats: ["Open status needs Places if a specific venue is selected."],
    },
  ],
  fallbackStops: [
    {
      title: "Malinao Beach",
      kind: "beach",
      sequence: 1,
      area: "General Luna side",
      rationale: "Use as a quieter sandy fallback.",
      caveats: ["Tide and swim conditions were not checked."],
    },
  ],
  skip: ["Surf-only Cloud 9 sessions", "Far north beach detours"],
  sources: [localGuideSourceSummary],
};

const foodCrawlPlan: ItineraryPlan = {
  title: "General Luna Food Crawl",
  durationLabel: "3-4 hours",
  stops: [
    {
      title: "First food stop",
      kind: "meal",
      sequence: 1,
      area: "General Luna",
      rationale: "Start central.",
      caveats: ["Open status needs Places."],
    },
    {
      title: "Second food stop",
      kind: "meal",
      sequence: 2,
      area: "General Luna",
      rationale: "Keep the crawl compact.",
      caveats: ["Open status needs Places."],
    },
  ],
  fallbackStops: [],
  skip: ["Venue names without Places evidence"],
  sources: [genericSourceSummary],
};

const providerUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};

const weatherProviderUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  confidence: "low",
  checked: [],
  notChecked: ["weather forecast"],
};
