export type ModelProviderName = "deepseek" | "openai";

export type ModelUsageMode = "thinking_high" | "thinking_disabled" | "unknown";

export type NormalizedModelUsage = {
  provider: ModelProviderName;
  model: string;
  mode: ModelUsageMode;
  upstreamRequestId?: string;
  inputCacheHitTokens?: number;
  inputCacheMissTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type ModelCostLineItem = NormalizedModelUsage & {
  callIndex: number;
  latencyMs: number;
  fallback: boolean;
  priceVersion: string;
  modeledCostUsd: string;
};

export type ModelCostSummary = {
  requestId: string;
  priceVersion: string;
  callCount: number;
  fallbackUsed: boolean;
  totalLatencyMs: number;
  totalModeledCostUsd: string;
  totals: {
    inputCacheHitTokens?: number;
    inputCacheMissTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  calls: readonly ModelCostLineItem[];
};

export type ModelCostPriceCatalog = {
  version: string;
  currency: "USD";
  pricesPerToken: {
    deepseek: {
      "deepseek-v4-flash": {
        inputCacheHitTokens: string;
        inputCacheMissTokens: string;
        outputTokens: string;
      };
    };
    openai: {
      "gpt-5.4-mini": {
        inputTokens: string;
        outputTokens: string;
      };
    };
  };
};

export type ResponsesClientForCostTracking = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{ usage?: NormalizedModelUsage }>;
  };
};

export const modelCostPriceCatalog = {
  version: "deepseek-v4-flash+gpt-5.4-mini-2026-08-12",
  currency: "USD",
  pricesPerToken: {
    deepseek: {
      "deepseek-v4-flash": {
        inputCacheHitTokens: "0.0000000028",
        inputCacheMissTokens: "0.00000014",
        outputTokens: "0.00000028",
      },
    },
    openai: {
      "gpt-5.4-mini": {
        inputTokens: "0.00000075",
        outputTokens: "0.0000045",
      },
    },
  },
} as const satisfies ModelCostPriceCatalog;

export function estimateModelCallCostUsd(
  usage: NormalizedModelUsage,
  catalog: ModelCostPriceCatalog = modelCostPriceCatalog,
) {
  if (usage.provider === "openai" && isGpt54MiniModel(usage.model)) {
    const prices = catalog.pricesPerToken.openai["gpt-5.4-mini"];
    return addDecimalStrings([
      multiplyDecimalByInteger(prices.inputTokens, usage.inputTokens ?? 0),
      multiplyDecimalByInteger(prices.outputTokens, usage.outputTokens ?? 0),
    ]);
  }
  if (usage.provider === "deepseek" && usage.model === "deepseek-v4-flash") {
    const prices = catalog.pricesPerToken.deepseek["deepseek-v4-flash"];
    const costs = [
      multiplyDecimalByInteger(prices.inputCacheHitTokens, usage.inputCacheHitTokens ?? 0),
      multiplyDecimalByInteger(prices.inputCacheMissTokens, usage.inputCacheMissTokens ?? 0),
      multiplyDecimalByInteger(prices.outputTokens, usage.outputTokens ?? 0),
    ];
    return addDecimalStrings(costs);
  }
  return "0";
}

export function canEstimateModelCallCost(usage: NormalizedModelUsage) {
  if (usage.provider === "openai" && isGpt54MiniModel(usage.model)) {
    return usage.inputTokens !== undefined || usage.outputTokens !== undefined;
  }
  if (usage.provider === "deepseek" && usage.model === "deepseek-v4-flash") {
    return (
      usage.inputCacheHitTokens !== undefined ||
      usage.inputCacheMissTokens !== undefined ||
      usage.outputTokens !== undefined
    );
  }
  return false;
}

function isGpt54MiniModel(model: string) {
  return model === "gpt-5.4-mini" || model.startsWith("gpt-5.4-mini-");
}

export function normalizeDeepSeekChatCompletionUsage({
  mode,
  requestedModel,
  response,
}: {
  response: Record<string, unknown>;
  requestedModel: string;
  mode: ModelUsageMode;
}): NormalizedModelUsage | undefined {
  const usage = isRecord(response.usage) ? response.usage : undefined;
  if (!usage) {
    return undefined;
  }

  return omitUndefined({
    provider: "deepseek" as const,
    model: readString(response.model) ?? requestedModel,
    mode,
    upstreamRequestId: readString(response._request_id) ?? readString(response.id),
    inputCacheHitTokens:
      readFiniteInteger(usage.prompt_cache_hit_tokens) ??
      readFiniteIntegerPath(usage, ["prompt_tokens_details", "cached_tokens"]),
    inputCacheMissTokens: readFiniteInteger(usage.prompt_cache_miss_tokens),
    inputTokens: readFiniteInteger(usage.prompt_tokens),
    outputTokens: readFiniteInteger(usage.completion_tokens),
    reasoningTokens:
      readFiniteIntegerPath(usage, ["completion_tokens_details", "reasoning_tokens"]) ??
      readFiniteInteger(usage.reasoning_tokens),
    totalTokens: readFiniteInteger(usage.total_tokens),
  });
}

export function normalizeOpenAIResponsesUsage({
  fallback,
  model,
  response,
}: {
  response: Record<string, unknown>;
  model: string;
  fallback: boolean;
}): NormalizedModelUsage | undefined {
  const usage = isRecord(response.usage) ? response.usage : undefined;
  if (!usage) {
    return undefined;
  }

  return omitUndefined({
    provider: "openai" as const,
    model: readString(response.model) ?? model,
    mode: "unknown" as const,
    upstreamRequestId: readString(response._request_id) ?? readString(response.id),
    inputTokens: readFiniteInteger(usage.input_tokens),
    outputTokens: readFiniteInteger(usage.output_tokens),
    reasoningTokens: readFiniteIntegerPath(usage, ["output_tokens_details", "reasoning_tokens"]),
    totalTokens: readFiniteInteger(usage.total_tokens),
    // The fallback flag is held on line items; keeping this parameter explicit prevents callers
    // from accidentally treating OpenAI usage as primary DeepSeek usage.
    ...(fallback ? {} : {}),
  });
}

export function createModelCostAccumulator({
  primaryProvider = "deepseek",
  requestId,
  priceCatalog = modelCostPriceCatalog,
}: {
  requestId: string;
  primaryProvider?: ModelProviderName;
  priceCatalog?: ModelCostPriceCatalog;
}) {
  const calls: ModelCostLineItem[] = [];

  return {
    recordUsage({
      fallback = false,
      latencyMs,
      usage,
    }: {
      usage: NormalizedModelUsage | undefined;
      latencyMs: number;
      fallback?: boolean;
    }) {
      if (!usage) {
        return;
      }
      calls.push({
        ...usage,
        callIndex: calls.length + 1,
        fallback,
        latencyMs: Math.max(0, Math.round(latencyMs)),
        priceVersion: priceCatalog.version,
        modeledCostUsd: estimateModelCallCostUsd(usage, priceCatalog),
      });
    },
    wrapClient<T extends ResponsesClientForCostTracking>(client: T): T {
      return {
        ...client,
        responses: {
          ...client.responses,
          create: async (params: Record<string, unknown>) => {
            const startedAt = Date.now();
            const response = await client.responses.create(params);
            this.recordUsage({
              fallback: response.usage ? response.usage.provider !== primaryProvider : false,
              latencyMs: Date.now() - startedAt,
              usage: response.usage,
            });
            return response;
          },
        },
      };
    },
    summary(): ModelCostSummary {
      return {
        requestId,
        priceVersion: priceCatalog.version,
        callCount: calls.length,
        fallbackUsed: calls.some((call) => call.fallback),
        totalLatencyMs: sumNumbers(calls.map((call) => call.latencyMs)),
        totalModeledCostUsd: addDecimalStrings(calls.map((call) => call.modeledCostUsd)),
        totals: omitUndefined({
          inputCacheHitTokens: sumOptionalTokenCounts(calls, "inputCacheHitTokens"),
          inputCacheMissTokens: sumOptionalTokenCounts(calls, "inputCacheMissTokens"),
          inputTokens: sumOptionalTokenCounts(calls, "inputTokens"),
          outputTokens: sumOptionalTokenCounts(calls, "outputTokens"),
          reasoningTokens: sumOptionalTokenCounts(calls, "reasoningTokens"),
          totalTokens: sumOptionalTokenCounts(calls, "totalTokens"),
        }),
        calls,
      };
    },
  };
}

export function modelCostTelemetryPayload(summary: ModelCostSummary) {
  return {
    requestId: summary.requestId,
    priceVersion: summary.priceVersion,
    callCount: summary.callCount,
    fallbackUsed: summary.fallbackUsed,
    totalLatencyMs: summary.totalLatencyMs,
    totalModeledCostUsd: summary.totalModeledCostUsd,
    totals: summary.totals,
    calls: summary.calls.map((call) => ({
      callIndex: call.callIndex,
      provider: call.provider,
      model: call.model,
      mode: call.mode,
      upstreamRequestId: call.upstreamRequestId,
      latencyMs: call.latencyMs,
      fallback: call.fallback,
      priceVersion: call.priceVersion,
      modeledCostUsd: call.modeledCostUsd,
      inputCacheHitTokens: call.inputCacheHitTokens,
      inputCacheMissTokens: call.inputCacheMissTokens,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      reasoningTokens: call.reasoningTokens,
      totalTokens: call.totalTokens,
    })),
  };
}

function sumOptionalTokenCounts<K extends keyof NormalizedModelUsage>(
  calls: readonly ModelCostLineItem[],
  key: K,
) {
  const values = calls.flatMap((call) => {
    const value = call[key];
    return typeof value === "number" ? [value] : [];
  });
  return values.length ? sumNumbers(values) : undefined;
}

function sumNumbers(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function addDecimalStrings(values: readonly string[]) {
  const scale = Math.max(0, ...values.map(decimalScale));
  const sum = values.reduce(
    (total, value) => total + decimalToScaledBigInt(value, scale),
    BigInt(0),
  );
  return scaledBigIntToDecimal(sum, scale);
}

export function multiplyDecimalByInteger(value: string, integer: number) {
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new Error("Decimal multiplication requires a non-negative safe integer.");
  }
  const scale = decimalScale(value);
  return scaledBigIntToDecimal(decimalToScaledBigInt(value, scale) * BigInt(integer), scale);
}

function decimalScale(value: string) {
  return value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
}

function decimalToScaledBigInt(value: string, scale: number) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const [integerPart, fractionPart = ""] = normalized.split(".");
  const paddedFraction = fractionPart.padEnd(scale, "0");
  return BigInt(`${integerPart}${paddedFraction || "0"}`);
}

function scaledBigIntToDecimal(value: bigint, scale: number) {
  if (scale === 0) {
    return value.toString();
  }
  const raw = value.toString().padStart(scale + 1, "0");
  const integerPart = raw.slice(0, -scale);
  const fractionPart = raw.slice(-scale).replace(/0+$/u, "");
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFiniteInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readFiniteIntegerPath(value: unknown, path: readonly string[]) {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return readFiniteInteger(current);
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
