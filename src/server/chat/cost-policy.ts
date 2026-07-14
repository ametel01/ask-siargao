import type { AgentRuntimeRequest } from "@/server/chat/agent-runtime";
import { readTripPassEnvironment, tripPassProductCatalog } from "@/server/trip-pass/catalog";

export type ChatCostPolicyTier = "baseline" | "free" | "paid_routine" | "paid_heavy";
export type DeepSeekThinkingMode = "baseline_high" | "disabled" | "high";

export type ChatCostPolicy = {
  enabled: boolean;
  tier: ChatCostPolicyTier;
  deepSeekThinkingMode: DeepSeekThinkingMode;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxTurns: number;
  normalMaxModelCalls: number;
  absoluteMaxModelCalls: number;
  openAiFallback: {
    enabled: boolean;
    reason:
      | "baseline"
      | "free_disallowed"
      | "paid_disabled"
      | "paid_budget_missing"
      | "paid_allowed";
  };
};

export class ChatCostPolicyBudgetError extends Error {
  readonly code = "model_budget_exhausted";
  readonly limit: number;

  constructor(limit: number) {
    super(`Ask Siargao model-call budget exhausted at ${limit} call(s).`);
    this.name = "ChatCostPolicyBudgetError";
    this.limit = limit;
  }
}

export function resolveChatCostPolicy(
  request: AgentRuntimeRequest,
  {
    env = process.env,
  }: {
    env?: Record<string, string | undefined>;
  } = {},
): ChatCostPolicy {
  const environment = readTripPassEnvironment(env);
  if (!environment.deepSeekCostPolicy.enabled) {
    return {
      enabled: false,
      tier: "baseline",
      deepSeekThinkingMode: "baseline_high",
      maxOutputTokens: 3_000,
      maxToolCalls: 8,
      maxTurns: 6,
      normalMaxModelCalls: 6,
      absoluteMaxModelCalls: tripPassProductCatalog.costPolicy.absoluteModelCallBound,
      openAiFallback: { enabled: true, reason: "baseline" },
    };
  }

  const tier = resolveCostPolicyTier(request);
  const paid = tier === "paid_routine" || tier === "paid_heavy";
  const fallbackEnabled = paid && environment.fallback.openAiEnabled;
  const fallbackBudgetReady =
    environment.fallback.dailyUsdLimit !== null && environment.fallback.dailyUsdLimit > 0;

  if (tier === "paid_heavy") {
    return {
      enabled: true,
      tier,
      deepSeekThinkingMode: "high",
      maxOutputTokens: tripPassProductCatalog.costPolicy.paid.heavy.maxOutputTokens,
      maxToolCalls: tripPassProductCatalog.costPolicy.paid.heavy.maxToolCalls,
      maxTurns: 5,
      normalMaxModelCalls: tripPassProductCatalog.costPolicy.paid.heavy.normalMaxModelCalls,
      absoluteMaxModelCalls: tripPassProductCatalog.costPolicy.absoluteModelCallBound,
      openAiFallback: {
        enabled: fallbackEnabled && fallbackBudgetReady,
        reason: fallbackReason({ fallbackBudgetReady, fallbackEnabled, paid }),
      },
    };
  }

  if (tier === "paid_routine") {
    return {
      enabled: true,
      tier,
      deepSeekThinkingMode: "disabled",
      maxOutputTokens: tripPassProductCatalog.costPolicy.paid.routine.maxOutputTokens,
      maxToolCalls: tripPassProductCatalog.costPolicy.paid.routine.maxToolCalls,
      maxTurns: 4,
      normalMaxModelCalls: tripPassProductCatalog.costPolicy.paid.routine.normalMaxModelCalls,
      absoluteMaxModelCalls: tripPassProductCatalog.costPolicy.absoluteModelCallBound,
      openAiFallback: {
        enabled: fallbackEnabled && fallbackBudgetReady,
        reason: fallbackReason({ fallbackBudgetReady, fallbackEnabled, paid }),
      },
    };
  }

  return {
    enabled: true,
    tier,
    deepSeekThinkingMode: "disabled",
    maxOutputTokens: tripPassProductCatalog.costPolicy.free.maxOutputTokens,
    maxToolCalls: tripPassProductCatalog.costPolicy.free.maxToolCalls,
    maxTurns: 3,
    normalMaxModelCalls: tripPassProductCatalog.costPolicy.free.maxModelCalls,
    absoluteMaxModelCalls: tripPassProductCatalog.costPolicy.absoluteModelCallBound,
    openAiFallback: { enabled: false, reason: "free_disallowed" },
  };
}

export function responseModelCostPolicy(policy: ChatCostPolicy) {
  return {
    deepSeekThinkingMode: policy.deepSeekThinkingMode,
  };
}

export function assertModelCallAllowed(callCount: number, policy: ChatCostPolicy) {
  if (callCount >= policy.absoluteMaxModelCalls) {
    throw new ChatCostPolicyBudgetError(policy.absoluteMaxModelCalls);
  }
}

function resolveCostPolicyTier(
  request: AgentRuntimeRequest,
): Exclude<ChatCostPolicyTier, "baseline"> {
  const metadata = request.metadata ?? {};
  const explicitTier = metadata.tripPassCostPolicyTier;
  if (explicitTier === "free" || explicitTier === "paid_routine" || explicitTier === "paid_heavy") {
    return explicitTier;
  }

  const entitlement = metadata.tripPassEntitlement;
  if (entitlement === "paid") {
    return isHeavyTurn(request) ? "paid_heavy" : "paid_routine";
  }
  return "free";
}

function isHeavyTurn(request: AgentRuntimeRequest) {
  const text = request.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ");
  return /\b(compare|current|latest|open now|restaurant|nightlife|event|events|research|best)\b/i.test(
    text,
  );
}

function fallbackReason({
  fallbackBudgetReady,
  fallbackEnabled,
  paid,
}: {
  paid: boolean;
  fallbackEnabled: boolean;
  fallbackBudgetReady: boolean;
}): ChatCostPolicy["openAiFallback"]["reason"] {
  if (!paid) {
    return "free_disallowed";
  }
  if (!fallbackEnabled) {
    return "paid_disabled";
  }
  if (!fallbackBudgetReady) {
    return "paid_budget_missing";
  }
  return "paid_allowed";
}
