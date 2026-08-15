import { describe, expect, test } from "bun:test";

import {
  assertDeepSeekChat,
  assertReadyHealth,
  runProductionChatSmoke,
} from "@/server/deployment/production-chat-smoke";

describe("production chat smoke", () => {
  test("accepts ready infrastructure and a complete DeepSeek Siargao answer", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const responses = [
      { status: 200, body: { status: "ready" } },
      {
        status: 200,
        body: {
          message: "Cloud 9 is on Siargao Island in the Philippines.",
          model: "deepseek-chat",
          completionStatus: "complete",
        },
      },
    ];

    const result = await runProductionChatSmoke({
      request: async (path, init) => {
        requests.push({ path, init });
        const response = responses.shift();
        if (!response) throw new Error("Unexpected smoke request.");
        return response;
      },
    });

    expect(result.model).toBe("deepseek-chat");
    expect(requests.map(({ path }) => path)).toEqual(["/api/health/ready", "/api/chat"]);
    expect(requests[1]?.init).toMatchObject({ method: "POST" });
  });

  test("rejects unhealthy infrastructure, provider errors, wrong models, and limited answers", () => {
    expect(() => assertReadyHealth({ status: 503, body: { status: "unavailable" } })).toThrow(
      "Production readiness smoke failed",
    );
    expect(() =>
      assertDeepSeekChat({
        status: 503,
        body: { error: "travel_answers_unavailable" },
      }),
    ).toThrow("Production chat smoke failed with HTTP 503");
    expect(() =>
      assertDeepSeekChat({
        status: 200,
        body: { message: "Cloud 9 is on Siargao.", model: "gpt-5" },
      }),
    ).toThrow("did not use a DeepSeek model");
    expect(() =>
      assertDeepSeekChat({
        status: 200,
        body: {
          message: "Cloud 9 is on Siargao.",
          model: "deepseek-chat",
          completionStatus: "completed_with_limits",
        },
      }),
    ).toThrow("limited answer candidate");
  });
});
