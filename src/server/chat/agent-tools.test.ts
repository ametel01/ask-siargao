import { describe, expect, test } from "bun:test";

import {
  agentToolDefinitions,
  describeAvailableTools,
  executeAgentTool,
} from "@/server/chat/agent-tools";

describe("agent tools", () => {
  test("defines the source-policy tool as a strict Responses function tool", () => {
    expect(agentToolDefinitions).toEqual([
      {
        type: "function",
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        strict: true,
      },
    ]);
  });

  test("describes available tools without exposing the helper as model-callable", () => {
    expect(describeAvailableTools()).toEqual([
      {
        name: "describe_source_policy",
        description:
          "Explain Ask Siargao source labels, checked/not-checked boundaries, and provider caveats.",
      },
    ]);
    expect(agentToolDefinitions.map((tool) => tool.name)).not.toContain("describe_available_tools");
  });

  test("returns machine-readable source policy output", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      toolCallId: "call_source_policy",
      name: "describe_source_policy",
      arguments: {},
    });

    expect(result.status).toBe("success");
    expect(result.text).toContain("live_checked");
    expect(result.text).toContain("fresh_cache");
    expect(result.text).toContain("curated_local_guide");
    expect(result.text).toContain("weather_checked");
    expect(result.text).toContain("not_verified");
    expect(result.text).toContain("provider_unavailable");
    expect(result.text).toContain("Never label generic model reasoning as live checked");
    expect(result.sources.map((source) => source.label)).toEqual([
      "live_checked",
      "fresh_cache",
      "curated_local_guide",
      "weather_checked",
      "not_verified",
      "provider_unavailable",
    ]);
    expect(result.sources[0]?.checked.join(" ")).toContain("allowed live place identity");
    expect(result.sources[0]?.notChecked.join(" ")).toContain("review text");
    const data = result.data as { policies: Array<{ label: string }> };
    expect(data.policies[0]?.label).toBe("live_checked");
  });

  test("rejects invalid arguments before tool execution", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      name: "describe_source_policy",
      arguments: { label: "live_checked" },
    });

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("invalid_tool_arguments");
    expect(result.text).toContain("Invalid arguments");
    expect(result.sources).toEqual([]);
  });

  test("returns unknown tool errors without throwing", async () => {
    const result = await executeAgentTool({
      requestId: "agent_request_1",
      name: "query_local_facts",
      arguments: {},
    });

    expect(result).toMatchObject({
      name: "query_local_facts",
      status: "error",
      errorCode: "unknown_tool",
      sources: [],
    });
  });
});
