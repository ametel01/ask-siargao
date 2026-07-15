import { describe, expect, test } from "bun:test";

import {
  assertModelCallAllowed,
  ChatCostPolicyBudgetError,
  resolveChatCostPolicy,
} from "@/server/chat/cost-policy";

describe("chat cost policy", () => {
  test("uses bounded non-thinking chat policy by default", () => {
    const policy = resolveChatCostPolicy(
      { messages: [{ role: "user", content: "Plan a first day." }] },
      { env: {} },
    );

    expect(policy).toMatchObject({
      enabled: true,
      tier: "free",
      deepSeekThinkingMode: "disabled",
      maxOutputTokens: 1500,
      maxToolCalls: 4,
      openAiFallback: { enabled: false, reason: "free_disallowed" },
    });
  });

  test("uses bounded non-thinking free policy and disables automatic OpenAI fallback", () => {
    const policy = resolveChatCostPolicy(
      { messages: [{ role: "user", content: "Plan a first day." }] },
      { env: { DEEPSEEK_COST_POLICY_ENABLED: "true" } },
    );

    expect(policy).toMatchObject({
      enabled: true,
      tier: "free",
      deepSeekThinkingMode: "disabled",
      maxOutputTokens: 1500,
      maxToolCalls: 4,
      normalMaxModelCalls: 3,
      absoluteMaxModelCalls: 7,
      openAiFallback: { enabled: false, reason: "free_disallowed" },
    });
  });

  test("allows paid routine fallback only when explicitly enabled with a budget", () => {
    const policy = resolveChatCostPolicy(
      {
        messages: [{ role: "user", content: "Plan a simple day." }],
        metadata: { tripPassEntitlement: "paid" },
      },
      {
        env: {
          DEEPSEEK_COST_POLICY_ENABLED: "true",
          OPENAI_FALLBACK_ENABLED: "true",
          OPENAI_FALLBACK_DAILY_USD_LIMIT: "5",
        },
      },
    );

    expect(policy).toMatchObject({
      tier: "paid_routine",
      deepSeekThinkingMode: "disabled",
      maxOutputTokens: 2500,
      maxToolCalls: 6,
      normalMaxModelCalls: 4,
      openAiFallback: { enabled: true, reason: "paid_allowed" },
    });
  });

  test("keeps paid heavy turns non-thinking under the response-time ceiling", () => {
    const policy = resolveChatCostPolicy(
      {
        messages: [{ role: "user", content: "Compare current restaurant options open now." }],
        metadata: { tripPassEntitlement: "paid" },
      },
      { env: { DEEPSEEK_COST_POLICY_ENABLED: "true" } },
    );

    expect(policy).toMatchObject({
      tier: "paid_heavy",
      deepSeekThinkingMode: "disabled",
      maxOutputTokens: 3000,
      maxToolCalls: 8,
      normalMaxModelCalls: 6,
      openAiFallback: { enabled: false, reason: "paid_disabled" },
    });
  });

  test("throws typed budget exhaustion at the absolute model-call bound", () => {
    expect(() =>
      assertModelCallAllowed(7, {
        enabled: true,
        tier: "free",
        deepSeekThinkingMode: "disabled",
        maxOutputTokens: 1500,
        maxToolCalls: 4,
        maxTurns: 3,
        normalMaxModelCalls: 3,
        absoluteMaxModelCalls: 7,
        openAiFallback: { enabled: false, reason: "free_disallowed" },
      }),
    ).toThrow(ChatCostPolicyBudgetError);
  });
});
