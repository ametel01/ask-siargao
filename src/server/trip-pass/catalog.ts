import { getServerSecret } from "@/server/security/privacy";

export const tripPassProductCode = "siargao_trip_pass_14d_v1";
export const tripPassProductVersion = 1;

export const tripPassMeterTypes = [
  "chat_message",
  "live_refresh",
  "heavy_recommendation",
  "weather_refresh",
  "route_lookup",
] as const;

export type TripPassMeterType = (typeof tripPassMeterTypes)[number];

export const tripPassPaidMeterLimits = {
  chat_message: 150,
  live_refresh: 40,
  heavy_recommendation: 8,
  weather_refresh: 20,
  route_lookup: 25,
} as const satisfies Record<TripPassMeterType, number>;

export const tripPassFreeMeterLimits = {
  chat_message: 10,
  live_refresh: 3,
  heavy_recommendation: 1,
} as const satisfies Partial<Record<TripPassMeterType, number>>;

export const tripPassWarningThresholds = {
  chatRemaining: 20,
  liveRemaining: 5,
  expiresWithinHours: 48,
} as const;

export const tripPassRateLimits = {
  free: {
    chatStartsPerMinute: 3,
    successfulChatsPerDay: 10,
    concurrentChatRequests: 2,
  },
  paid: {
    chatStartsPerMinute: 10,
    successfulChatsPerDay: 30,
    concurrentChatRequests: 2,
  },
} as const;

export const tripPassCostPolicy = {
  free: {
    maxOutputTokens: 1_500,
    maxToolCalls: 4,
    maxModelCalls: 3,
  },
  paid: {
    maxOutputTokens: 2_500,
    maxToolCalls: 8,
    normalMaxModelCalls: 4,
  },
  absoluteModelCallBound: 7,
} as const;

export const tripPassProductCatalog = {
  code: tripPassProductCode,
  version: tripPassProductVersion,
  label: "Siargao Trip Pass",
  durationDays: 14,
  paidMeterLimits: tripPassPaidMeterLimits,
  freeMeterLimits: tripPassFreeMeterLimits,
  freeWindowDays: 7,
  warningThresholds: tripPassWarningThresholds,
  rateLimits: tripPassRateLimits,
  costPolicy: tripPassCostPolicy,
  presentation: {
    headline: "14-day Siargao Trip Pass",
    priceAuthority: "stripe_price",
    launchPriceLabel: "Configured in Stripe",
  },
} as const;

export type TripPassEnvironment = ReturnType<typeof readTripPassEnvironment>;

type Environment = Record<string, string | undefined>;

export function readTripPassEnvironment(env: Environment = process.env) {
  const checkoutEnabled = parseBooleanFlag(env.TRIP_PASS_CHECKOUT_ENABLED);
  const extensionEnabled = parseBooleanFlag(env.TRIP_PASS_EXTENSION_ENABLED);
  const deepSeekCostPolicyEnabled = parseBooleanFlag(env.DEEPSEEK_COST_POLICY_ENABLED);
  const stripePriceId = optionalServerSecret("STRIPE_TRIP_PASS_PRICE_ID", env);

  return {
    checkout: {
      enabled: checkoutEnabled,
      priceId: stripePriceId,
      status:
        checkoutEnabled && stripePriceId
          ? "available"
          : checkoutEnabled
            ? "unavailable"
            : "disabled",
      unavailableReason:
        checkoutEnabled && !stripePriceId ? "missing_stripe_trip_pass_price_id" : null,
    },
    extension: {
      enabled: extensionEnabled,
      status: extensionEnabled ? "unavailable" : "disabled",
      unavailableReason: extensionEnabled ? "extension_launch_approval_required" : null,
    },
    deepSeekCostPolicy: {
      enabled: deepSeekCostPolicyEnabled,
      status: deepSeekCostPolicyEnabled ? "candidate" : "disabled",
    },
    anonymousIdentity: {
      hmacKeyConfigured: Boolean(optionalServerSecret("TRIP_PASS_ANON_HMAC_KEY", env)),
      keyVersion: parsePositiveInteger(
        "TRIP_PASS_ANON_HMAC_KEY_VERSION",
        env.TRIP_PASS_ANON_HMAC_KEY_VERSION,
        1,
      ),
      status: optionalServerSecret("TRIP_PASS_ANON_HMAC_KEY", env) ? "available" : "unavailable",
    },
    redis: {
      urlConfigured: Boolean(optionalServerSecret("REDIS_URL", env)),
      status: optionalServerSecret("REDIS_URL", env) ? "available" : "unavailable",
    },
    analytics: {
      posthogKeyConfigured: Boolean(env.NEXT_PUBLIC_POSTHOG_KEY),
      posthogHostConfigured: Boolean(env.NEXT_PUBLIC_POSTHOG_HOST),
      status: env.NEXT_PUBLIC_POSTHOG_KEY ? "available" : "unavailable",
    },
    fallback: {
      openAiEnabled: parseBooleanFlag(env.OPENAI_FALLBACK_ENABLED),
      dailyUsdLimit: parseOptionalNonNegativeNumber(
        "OPENAI_FALLBACK_DAILY_USD_LIMIT",
        env.OPENAI_FALLBACK_DAILY_USD_LIMIT,
      ),
    },
    waf: {
      mode: parseEnum(
        "TRIP_PASS_WAF_MODE",
        env.TRIP_PASS_WAF_MODE,
        ["disabled", "log", "challenge"],
        "disabled",
      ),
    },
    costBudgets: {
      deepSeekDailyUsd: parseOptionalNonNegativeNumber(
        "DEEPSEEK_DAILY_USD_LIMIT",
        env.DEEPSEEK_DAILY_USD_LIMIT,
      ),
      openAiDailyUsd: parseOptionalNonNegativeNumber(
        "OPENAI_DAILY_USD_LIMIT",
        env.OPENAI_DAILY_USD_LIMIT,
      ),
      globalDailyUsd: parseOptionalNonNegativeNumber(
        "GLOBAL_MODEL_DAILY_USD_LIMIT",
        env.GLOBAL_MODEL_DAILY_USD_LIMIT,
      ),
    },
  } as const;
}

function optionalServerSecret(name: string, env: Environment) {
  const value = getServerSecret(name, env)?.trim();
  return value ? value : undefined;
}

function parseBooleanFlag(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean feature flag value: ${value}`);
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(name: string, value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return parsed;
}

function parseEnum<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  allowedValues: T,
  fallback: T[number],
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (allowedValues.includes(value)) {
    return value as T[number];
  }
  throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
}
