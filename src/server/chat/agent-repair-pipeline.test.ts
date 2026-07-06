import { describe, expect, test } from "bun:test";
import {
  type AgentRepairAdapter,
  type AgentRepairFunctionCall,
  type AgentRepairToolOutput,
  runAgentRepairPipeline,
} from "@/server/chat/agent-repair-pipeline";
import type {
  AgentResponsesClient,
  AgentResponsesCreateResult,
  AgentToolCallAudit,
  AgentToolResult,
} from "@/server/chat/agent-runtime";

describe("agent repair pipeline", () => {
  test.each([
    {
      adapterName: "condition-judgment",
      payloadKey: "validationRepairConditionJudgment",
      functionCall: {
        callId: "auto_condition_1",
        name: "get_condition_judgment",
        arguments: { activity: "surfing", location: "Cloud 9" },
      },
    },
    {
      adapterName: "memory-load",
      payloadKey: "validationRepairMemoryLoad",
      functionCall: {
        callId: "auto_memory_1",
        name: "load_agent_memory_file",
        arguments: { documents: ["SURF.md"] },
      },
    },
  ])("runs shared tool execution and retry mechanics for $adapterName", async (scenario) => {
    const client = fakeResponsesClient([
      {
        id: `resp_repaired_${scenario.adapterName}`,
        output_text: "Repaired final answer.",
        _request_id: `req_repaired_${scenario.adapterName}`,
      },
    ]);
    const executedFunctionCalls: AgentRepairFunctionCall[][] = [];
    const toolCalls: AgentToolCallAudit[] = [];
    const toolResults: AgentToolResult[] = [];
    const collectedRequestIds: Array<string | undefined> = [];
    const collectedHostedMemoryResponses: AgentResponsesCreateResult[] = [];

    const result = await runAgentRepairPipeline({
      adapters: [
        repairAdapter({
          name: scenario.adapterName,
          payloadKey: scenario.payloadKey,
          functionCall: scenario.functionCall,
        }),
      ],
      client,
      executeToolCalls: async (functionCalls) => {
        executedFunctionCalls.push([...functionCalls]);
        return functionCalls.map((functionCall) => repairOutput(functionCall));
      },
      finalText: "Premature final answer.",
      instructions: "agent instructions",
      maxToolCalls: 3,
      model: "gpt-test",
      response: {
        id: "resp_initial",
        output_text: "Premature final answer.",
        output: [{ type: "message", id: "msg_initial" }],
        _request_id: "req_initial",
      },
      responseInput: [{ type: "message", role: "user", content: "initial input" }],
      responseTools: [{ type: "function", name: scenario.functionCall.name }],
      responseContract: { finalOutput: "json" },
      collectHostedMemory: (response) => collectedHostedMemoryResponses.push(response),
      collectUpstreamRequestId: (requestId) => collectedRequestIds.push(requestId),
      serializeToolOutput: (toolResult) => JSON.stringify(toolResult),
      publicToolArguments: (functionCall) => functionCall.arguments,
      toolCalls,
      toolResults,
    });

    expect(result.repaired).toBe(true);
    expect(executedFunctionCalls).toEqual([[scenario.functionCall]]);
    expect(toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual([
      scenario.functionCall.callId,
    ]);
    expect(toolResults.map((toolResult) => toolResult.toolCallId)).toEqual([
      scenario.functionCall.callId,
    ]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "gpt-test",
      store: false,
      max_output_tokens: 3_000,
      instructions: "agent instructions",
      tools: [{ type: "function", name: scenario.functionCall.name }],
    });
    const retryInput = client.requests[0]?.input;
    expect(retryInput).toEqual(expect.arrayContaining([{ type: "message", id: "msg_initial" }]));
    const repairInput = parseLastUserInputMessage(retryInput);
    expect(repairInput).toMatchObject({
      product: "Ask Siargao",
      instruction: `Repair through ${scenario.adapterName}.`,
      responseContract: { finalOutput: "json" },
    });
    expect(repairInput[scenario.payloadKey]).toEqual([
      {
        toolCallId: scenario.functionCall.callId,
        name: scenario.functionCall.name,
        arguments: scenario.functionCall.arguments,
        result: expect.objectContaining({
          toolCallId: scenario.functionCall.callId,
          name: scenario.functionCall.name,
          status: "success",
        }),
      },
    ]);
    expect(collectedRequestIds).toEqual([`req_repaired_${scenario.adapterName}`]);
    expect(collectedHostedMemoryResponses.map((response) => response.id)).toEqual([
      `resp_repaired_${scenario.adapterName}`,
    ]);
  });

  test("does not execute tools or retry the model when no adapter matches", async () => {
    const client = fakeResponsesClient([]);
    const toolCalls: AgentToolCallAudit[] = [];
    const toolResults: AgentToolResult[] = [];
    let executeCount = 0;

    const result = await runAgentRepairPipeline({
      adapters: [
        {
          name: "non-matching",
          createRepair: () => undefined,
        },
      ],
      client,
      executeToolCalls: async () => {
        executeCount += 1;
        return [];
      },
      finalText: "Ordinary final answer.",
      instructions: "agent instructions",
      maxToolCalls: 3,
      model: "gpt-test",
      response: {
        id: "resp_initial",
        output_text: "Ordinary final answer.",
        output: [{ type: "message", id: "msg_initial" }],
      },
      responseInput: [{ type: "message", role: "user", content: "initial input" }],
      responseTools: [],
      responseContract: { finalOutput: "json" },
      collectHostedMemory: () => {
        throw new Error("Hosted memory should not be collected without a retry.");
      },
      collectUpstreamRequestId: () => {
        throw new Error("Upstream request IDs should not be collected without a retry.");
      },
      serializeToolOutput: (toolResult) => JSON.stringify(toolResult),
      publicToolArguments: (functionCall) => functionCall.arguments,
      toolCalls,
      toolResults,
    });

    expect(result).toEqual({ repaired: false });
    expect(executeCount).toBe(0);
    expect(client.requests).toEqual([]);
    expect(toolCalls).toEqual([]);
    expect(toolResults).toEqual([]);
  });

  test("forces a no-tools final retry when a tool repair would exceed the tool budget", async () => {
    const functionCall = {
      callId: "auto_condition_over_budget",
      name: "get_condition_judgment",
      arguments: { activity: "surfing", location: "Cloud 9" },
    } satisfies AgentRepairFunctionCall;
    const client = fakeResponsesClient([
      {
        id: "resp_budget_fallback",
        output_text: "Budget-aware final answer with caveats.",
        _request_id: "req_budget_fallback",
      },
    ]);
    const existingToolCall = repairOutput({
      callId: "existing_weather",
      name: "get_weather_forecast",
      arguments: { location: "General Luna" },
    });
    const toolCalls = [existingToolCall.audit];
    const toolResults = [existingToolCall.result];
    const collectedRequestIds: Array<string | undefined> = [];

    const result = await runAgentRepairPipeline({
      adapters: [
        repairAdapter({
          name: "condition-judgment",
          payloadKey: "validationRepairConditionJudgment",
          functionCall,
        }),
      ],
      client,
      executeToolCalls: async () => {
        throw new Error("Tool execution should be skipped when the budget is exhausted.");
      },
      finalText: "Premature final answer.",
      instructions: "agent instructions",
      maxToolCalls: 1,
      model: "gpt-test",
      response: {
        id: "resp_initial",
        output_text: "Premature final answer.",
        output: [{ type: "message", id: "msg_initial" }],
        _request_id: "req_initial",
      },
      responseInput: [{ type: "message", role: "user", content: "initial input" }],
      responseTools: [{ type: "function", name: functionCall.name }],
      responseContract: { finalOutput: "json" },
      collectHostedMemory: () => undefined,
      collectUpstreamRequestId: (requestId) => collectedRequestIds.push(requestId),
      serializeToolOutput: (toolResult) => JSON.stringify(toolResult),
      publicToolArguments: (repairFunctionCall) => repairFunctionCall.arguments,
      toolCalls,
      toolResults,
    });

    expect(result).toMatchObject({
      repaired: true,
      adapterName: "condition-judgment",
    });
    expect(toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(["existing_weather"]);
    expect(toolResults.map((toolResult) => toolResult.toolCallId)).toEqual(["existing_weather"]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "gpt-test",
      store: false,
      max_output_tokens: 3_000,
      instructions: "agent instructions",
    });
    expect(client.requests[0]).not.toHaveProperty("tools");
    expect(client.requests[0]).not.toHaveProperty("include");
    const repairInput = parseLastUserInputMessage(client.requests[0]?.input);
    expect(repairInput).toMatchObject({
      product: "Ask Siargao",
      responseContract: { finalOutput: "json" },
      validationRepairToolBudgetExhausted: {
        adapterName: "condition-judgment",
        requestedToolCalls: [
          {
            name: "get_condition_judgment",
            arguments: functionCall.arguments,
          },
        ],
        existingToolCallCount: 1,
        maxToolCalls: 1,
      },
    });
    expect(repairInput.instruction).toEqual(expect.stringContaining("Do not call tools"));
    expect(collectedRequestIds).toEqual(["req_budget_fallback"]);
  });

  test("does not repeat the same exhausted tool-budget repair", async () => {
    const functionCall = {
      callId: "auto_condition_over_budget",
      name: "get_condition_judgment",
      arguments: { activity: "surfing", location: "Cloud 9" },
    } satisfies AgentRepairFunctionCall;
    const client = fakeResponsesClient([]);
    const existingToolCall = repairOutput({
      callId: "existing_weather",
      name: "get_weather_forecast",
      arguments: { location: "General Luna" },
    });
    let executeCount = 0;

    const result = await runAgentRepairPipeline({
      adapters: [
        repairAdapter({
          name: "condition-judgment",
          payloadKey: "validationRepairConditionJudgment",
          functionCall,
        }),
      ],
      client,
      executeToolCalls: async () => {
        executeCount += 1;
        return [];
      },
      finalText: "Still imperfect final answer.",
      instructions: "agent instructions",
      maxToolCalls: 1,
      model: "gpt-test",
      response: {
        id: "resp_initial",
        output_text: "Still imperfect final answer.",
        output: [{ type: "message", id: "msg_initial" }],
        _request_id: "req_initial",
      },
      responseInput: [
        { type: "message", role: "user", content: "initial input" },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                product: "Ask Siargao",
                validationRepairToolBudgetExhausted: {
                  adapterName: "condition-judgment",
                },
              }),
            },
          ],
        },
      ],
      responseTools: [{ type: "function", name: functionCall.name }],
      responseContract: { finalOutput: "json" },
      collectHostedMemory: () => undefined,
      collectUpstreamRequestId: () => undefined,
      serializeToolOutput: (toolResult) => JSON.stringify(toolResult),
      publicToolArguments: (repairFunctionCall) => repairFunctionCall.arguments,
      toolCalls: [existingToolCall.audit],
      toolResults: [existingToolCall.result],
    });

    expect(result).toEqual({ repaired: false });
    expect(executeCount).toBe(0);
    expect(client.requests).toEqual([]);
  });
});

function repairAdapter({
  functionCall,
  name,
  payloadKey,
}: {
  functionCall: AgentRepairFunctionCall;
  name: string;
  payloadKey: string;
}): AgentRepairAdapter {
  return {
    name,
    createRepair: () => ({
      type: "tool",
      functionCalls: [functionCall],
      payloadKey,
      instruction: `Repair through ${name}.`,
    }),
  };
}

function repairOutput(functionCall: AgentRepairFunctionCall): AgentRepairToolOutput {
  const result = {
    toolCallId: functionCall.callId,
    name: functionCall.name,
    status: "success",
    text: `Executed ${functionCall.name}.`,
    sources: [],
  } satisfies AgentToolResult;

  return {
    functionCall,
    result,
    audit: {
      id: `audit_${functionCall.callId}`,
      toolCallId: functionCall.callId,
      name: functionCall.name,
      arguments: functionCall.arguments,
      status: "success",
      durationMs: 1,
      startedAt: "2026-07-03T00:00:00.000Z",
      completedAt: "2026-07-03T00:00:00.001Z",
      resultText: result.text,
      sourceProfileIds: [],
      sources: [],
    },
  };
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

function parseLastUserInputMessage(input: unknown) {
  if (!Array.isArray(input)) {
    throw new Error("Expected response input array.");
  }
  const lastMessage = [...input]
    .reverse()
    .find((item) => item?.type === "message" && item?.role === "user");
  const text = lastMessage?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Expected user input text.");
  }
  return JSON.parse(text) as Record<string, unknown>;
}
