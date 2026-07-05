import { describe, expect, test } from "bun:test";

import {
  createConfiguredChatResponsesClient,
  defaultDeepSeekChatModel,
  type ResponsesClientLike,
  resolvePrimaryChatModel,
} from "@/server/llm/chat-model-provider";

describe("chat model provider", () => {
  test("defaults primary chat model to DeepSeek flash", () => {
    const originalModel = process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_MODEL;

    try {
      expect(resolvePrimaryChatModel()).toBe(defaultDeepSeekChatModel);
    } finally {
      restoreEnv("DEEPSEEK_MODEL", originalModel);
    }
  });

  test("adapts Responses-style prompts and tools to DeepSeek chat completions", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = createConfiguredChatResponsesClient({
      deepSeekClient: {
        chat: {
          completions: {
            create: async (params) => {
              requests.push(params);
              return {
                id: "deepseek_response_1",
                model: "deepseek-v4-flash",
                choices: [
                  {
                    message: {
                      content: "",
                      reasoning_content: "I should check the weather tool.",
                      tool_calls: [
                        {
                          id: "call_weather",
                          type: "function",
                          function: {
                            name: "get_weather_forecast",
                            arguments: '{"location":"General Luna"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            },
          },
        },
      },
      deepSeekModel: "deepseek-v4-flash",
    });

    const response = await client.responses.create({
      model: "deepseek-v4-flash",
      instructions: "Return JSON final answers.",
      max_output_tokens: 300,
      tools: [
        {
          type: "function",
          name: "get_weather_forecast",
          description: "Get weather.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
        { type: "file_search", vector_store_ids: ["vs_123"] },
      ],
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: '{"conversation":[]}' }],
        },
      ],
    });

    expect(response.model).toBe("deepseek-v4-flash");
    expect(response.output_text).toBeUndefined();
    expect(response.output).toEqual([
      {
        type: "function_call",
        id: "call_weather",
        call_id: "call_weather",
        name: "get_weather_forecast",
        arguments: '{"location":"General Luna"}',
        reasoning_content: "I should check the weather tool.",
      },
    ]);
    expect(requests[0]?.model).toBe("deepseek-v4-flash");
    expect(requests[0]?.max_tokens).toBe(300);
    expect(requests[0]?.thinking).toEqual({ type: "enabled" });
    expect(requests[0]?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather_forecast",
          description: "Get weather.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ]);
  });

  test("falls back to OpenAI after a DeepSeek request failure", async () => {
    const fallbackRequests: Record<string, unknown>[] = [];
    const fallbackClient: ResponsesClientLike = {
      responses: {
        create: async (params) => {
          fallbackRequests.push(params);
          return {
            id: "openai_response_1",
            model: "gpt-5.4-mini",
            output_text: "Fallback answer.",
          };
        },
      },
    };
    const client = createConfiguredChatResponsesClient({
      deepSeekClient: {
        chat: {
          completions: {
            create: async () => {
              throw new Error("DeepSeek unavailable");
            },
          },
        },
      },
      deepSeekModel: "deepseek-v4-flash",
      openAiClient: fallbackClient,
      openAiFallbackModel: "gpt-5.4-mini",
    });

    const response = await client.responses.create({
      model: "deepseek-v4-flash",
      input: "Hello",
    });

    expect(response.output_text).toBe("Fallback answer.");
    expect(response.model).toBe("gpt-5.4-mini");
    expect(fallbackRequests).toHaveLength(1);
    expect(fallbackRequests[0]?.model).toBe("gpt-5.4-mini");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
