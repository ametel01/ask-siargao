import { describe, expect, test } from "bun:test";

import {
  createConfiguredChatResponsesClient,
  defaultChatProviderMaxRetries,
  defaultChatProviderTimeoutMs,
  defaultDeepSeekChatModel,
  defaultOpenAiChatModel,
  type ResponsesClientLike,
  type ResponsesCreateResult,
  requireValidChatModelDeployment,
  resolveChatModelProvider,
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

  test("selects OpenAI explicitly as primary without enabling fallback semantics", async () => {
    const deepSeekRequests: Record<string, unknown>[] = [];
    const openAiRequests: Record<string, unknown>[] = [];
    const client = createConfiguredChatResponsesClient({
      provider: "openai",
      openAiFallbackEnabled: false,
      deepSeekClient: {
        chat: {
          completions: {
            create: async (params) => {
              deepSeekRequests.push(params);
              return { choices: [{ message: { content: "wrong provider" } }] };
            },
          },
        },
      },
      openAiClient: {
        responses: {
          create: async (params) => {
            openAiRequests.push(params);
            return {
              model: "gpt-5.4-mini",
              output_text: "OpenAI primary answer.",
              usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
            };
          },
        },
      },
    });

    const response = await client.responses.create({ input: "Hello" });

    expect(response.output_text).toBe("OpenAI primary answer.");
    expect(response.usage?.provider).toBe("openai");
    expect(openAiRequests).toHaveLength(1);
    expect(deepSeekRequests).toHaveLength(0);
  });

  test("resolves and validates the production provider explicitly", () => {
    expect(resolveChatModelProvider({ CHAT_MODEL_PROVIDER: "openai" })).toBe("openai");
    expect(resolvePrimaryChatModel(undefined, { CHAT_MODEL_PROVIDER: "openai" })).toBe(
      defaultOpenAiChatModel,
    );
    expect(
      requireValidChatModelDeployment({
        APP_ENV: "production",
        CHAT_MODEL_PROVIDER: "openai",
        OPENAI_API_KEY: "test_api_key",
      }),
    ).toBe("openai");
    expect(() =>
      requireValidChatModelDeployment({
        APP_ENV: "production",
        CHAT_MODEL_PROVIDER: "openai",
      }),
    ).toThrow("OPENAI_API_KEY");
    expect(() => requireValidChatModelDeployment({ CHAT_MODEL_PROVIDER: "unknown" })).toThrow(
      "CHAT_MODEL_PROVIDER must be one of",
    );
    expect(
      requireValidChatModelDeployment({
        CHAT_MODEL_PROVIDER: "openai",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe("openai");
  });

  test("uses bounded provider timeout and retry defaults", () => {
    expect(defaultChatProviderTimeoutMs).toBe(15_000);
    expect(defaultChatProviderMaxRetries).toBe(1);
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
                _request_id: "deepseek_req_1",
                model: "deepseek-v4-flash",
                usage: {
                  prompt_tokens: 1200,
                  prompt_cache_hit_tokens: 800,
                  prompt_cache_miss_tokens: 400,
                  completion_tokens: 90,
                  completion_tokens_details: {
                    reasoning_tokens: 30,
                  },
                  total_tokens: 1290,
                },
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
      text: { format: { type: "json_object" } },
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
    expect(response.usage).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      mode: "thinking_high",
      upstreamRequestId: "deepseek_req_1",
      inputCacheHitTokens: 800,
      inputCacheMissTokens: 400,
      inputTokens: 1200,
      outputTokens: 90,
      reasoningTokens: 30,
      totalTokens: 1290,
    });
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
    expect(requests[0]?.response_format).toEqual({ type: "json_object" });
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

  test("parses DeepSeek DSML tool-call content into Responses function calls", async () => {
    const client = createConfiguredChatResponsesClient({
      deepSeekClient: {
        chat: {
          completions: {
            create: async () => ({
              id: "deepseek_dsml_response",
              model: "deepseek-v4-flash",
              choices: [
                {
                  message: {
                    content:
                      '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="load_agent_memory_file"> <｜｜DSML｜｜parameter name="file_id" string="true">ASK_SIARGAO_ANSWER_PATTERNS.md</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>',
                  },
                },
              ],
            }),
          },
        },
      },
      deepSeekModel: "deepseek-v4-flash",
    });

    const response = await client.responses.create({
      model: "deepseek-v4-flash",
      input: "Compare Bravo, CEV, Shaka, and Kurvada.",
    });

    expect(response.output_text).toBeUndefined();
    expect(response.output).toEqual([
      {
        type: "function_call",
        id: "dsml_call_1",
        call_id: "dsml_call_1",
        name: "load_agent_memory_file",
        arguments: '{"documents":["ASK_SIARGAO_ANSWER_PATTERNS.md"]}',
      },
    ]);
  });

  test("keeps partial DeepSeek usage fields without inventing missing token classes", async () => {
    const client = createConfiguredChatResponsesClient({
      deepSeekClient: {
        chat: {
          completions: {
            create: async () => ({
              id: "deepseek_partial_usage",
              model: "deepseek-v4-flash",
              usage: {
                prompt_cache_hit_tokens: 7,
                completion_tokens: 3,
              },
              choices: [{ message: { content: "Partial usage answer." } }],
            }),
          },
        },
      },
      deepSeekModel: "deepseek-v4-flash",
    });

    const response = await client.responses.create({ input: "Hello" });

    expect(response.usage).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      mode: "thinking_high",
      upstreamRequestId: "deepseek_partial_usage",
      inputCacheHitTokens: 7,
      outputTokens: 3,
    });
  });

  test("builds explicit non-thinking DeepSeek requests for cost-policy candidate calls", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = createConfiguredChatResponsesClient({
      deepSeekClient: {
        chat: {
          completions: {
            create: async (params) => {
              requests.push(params);
              return {
                id: "deepseek_non_thinking_response",
                model: "deepseek-v4-flash",
                usage: { completion_tokens: 10 },
                choices: [{ message: { content: "Non-thinking answer." } }],
              };
            },
          },
        },
      },
      deepSeekModel: "deepseek-v4-flash",
    });

    const response = await client.responses.create({
      input: "Hello",
      modelCostPolicy: { deepSeekThinkingMode: "disabled" },
    });

    expect(requests[0]?.thinking).toEqual({ type: "disabled" });
    expect(requests[0]).not.toHaveProperty("reasoning_effort");
    expect(response.usage?.mode).toBe("thinking_disabled");
  });

  test("falls back to OpenAI after a DeepSeek request failure", async () => {
    const fallbackRequests: Record<string, unknown>[] = [];
    const fallbackClient: ResponsesClientLike = {
      responses: {
        create: async (params) => {
          fallbackRequests.push(params);
          return {
            id: "openai_response_1",
            _request_id: "openai_req_1",
            model: "gpt-5.4-mini",
            output_text: "Fallback answer.",
            usage: {
              input_tokens: 123,
              output_tokens: 45,
              output_tokens_details: {
                reasoning_tokens: 6,
              },
              total_tokens: 168,
            },
          } as unknown as ResponsesCreateResult;
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
    expect(response.usage).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
      mode: "unknown",
      upstreamRequestId: "openai_req_1",
      inputTokens: 123,
      outputTokens: 45,
      reasoningTokens: 6,
      totalTokens: 168,
    });
    expect(fallbackRequests).toHaveLength(1);
    expect(fallbackRequests[0]?.model).toBe("gpt-5.4-mini");
  });

  test("does not create automatic OpenAI fallback when fallback is disabled", async () => {
    const fallbackClient: ResponsesClientLike = {
      responses: {
        create: async () => {
          throw new Error("Fallback should not run.");
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
      openAiApiKey: "configured-but-disabled-openai-key",
      openAiFallbackEnabled: false,
      openAiFallbackModel: "gpt-5.4-mini",
    });

    await expect(client.responses.create({ input: "Hello" })).rejects.toThrow(
      "DeepSeek unavailable",
    );
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
