import { describe, expect, test } from "bun:test";

import {
  addDecimalStrings,
  createModelCostAccumulator,
  estimateModelCallCostUsd,
  modelCostPriceCatalog,
  modelCostTelemetryPayload,
  multiplyDecimalByInteger,
  type NormalizedModelUsage,
} from "@/server/llm/model-cost";

describe("model cost accounting", () => {
  test("reconciles the supplied DeepSeek export totals exactly", () => {
    const exportRows = [
      {
        requestCount: 24,
        inputCacheHitTokens: 536_832,
        inputCacheMissTokens: 257_653,
        outputTokens: 14_896,
        expectedCostUsd: "0.0417454296",
      },
      {
        requestCount: 38,
        inputCacheHitTokens: 694_784,
        inputCacheMissTokens: 352_593,
        outputTokens: 25_254,
        expectedCostUsd: "0.0583795352",
      },
      {
        requestCount: 14,
        inputCacheHitTokens: 113_664,
        inputCacheMissTokens: 63_630,
        outputTokens: 6_302,
        expectedCostUsd: "0.0109910192",
      },
    ];

    const dailyCosts = exportRows.map((row) =>
      estimateModelCallCostUsd({
        provider: "deepseek",
        model: "deepseek-v4-flash",
        mode: "thinking_high",
        inputCacheHitTokens: row.inputCacheHitTokens,
        inputCacheMissTokens: row.inputCacheMissTokens,
        outputTokens: row.outputTokens,
      }),
    );

    expect(dailyCosts).toEqual(exportRows.map((row) => row.expectedCostUsd));
    expect(addDecimalStrings(dailyCosts)).toBe("0.111115984");
    expect(exportRows.reduce((total, row) => total + row.requestCount, 0)).toBe(76);
    expect(modelCostPriceCatalog.version).toBe("deepseek-v4-flash-2026-07-14-export");
  });

  test("uses decimal arithmetic without floating-point drift", () => {
    expect(multiplyDecimalByInteger("0.0000000028", 536_832)).toBe("0.0015031296");
    expect(addDecimalStrings(["0.0015031296", "0.03607142", "0.00417088"])).toBe("0.0417454296");
  });

  test("accumulates request-scoped calls and emits a sanitized telemetry payload", async () => {
    const accumulator = createModelCostAccumulator({ requestId: "chat_request_cost_1" });
    const usage: NormalizedModelUsage = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      mode: "thinking_high",
      upstreamRequestId: "deepseek_req_1",
      inputCacheHitTokens: 100,
      inputCacheMissTokens: 50,
      inputTokens: 150,
      outputTokens: 25,
      reasoningTokens: 5,
      totalTokens: 175,
    };
    const client = accumulator.wrapClient({
      responses: {
        create: async (params) => {
          expect(JSON.stringify(params)).toContain("raw prompt should stay outside telemetry");
          return { usage };
        },
      },
    });

    await client.responses.create({
      input: "raw prompt should stay outside telemetry",
      cookie: "trip_cookie_secret",
      email: "traveler@example.com",
      latitude: 9.784,
      longitude: 126.158,
      toolOutput: "provider payload should stay outside telemetry",
      reasoning: "private chain of thought should stay outside telemetry",
    });

    const summary = accumulator.summary();
    const payloadJson = JSON.stringify(modelCostTelemetryPayload(summary));

    expect(summary).toMatchObject({
      requestId: "chat_request_cost_1",
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
    expect(payloadJson).not.toContain("raw prompt");
    expect(payloadJson).not.toContain("provider payload");
    expect(payloadJson).not.toContain("private chain");
    expect(payloadJson).not.toContain("traveler@example.com");
    expect(payloadJson).not.toContain("trip_cookie_secret");
    expect(payloadJson).not.toContain("9.784");
    expect(payloadJson).not.toContain("126.158");
  });
});
