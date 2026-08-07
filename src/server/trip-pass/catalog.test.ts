import { describe, expect, test } from "bun:test";

import {
  readTripPassEnvironment,
  tripPassCostPolicy,
  tripPassFreeMeterLimits,
  tripPassLegacyFreeMeterLimits,
  tripPassLegacyPaidMeterLimits,
  tripPassMeterTypes,
  tripPassPaidMeterLimits,
  tripPassProductCatalog,
  tripPassRateLimits,
  tripPassWarningThresholds,
} from "@/server/trip-pass/catalog";

describe("Trip Pass catalog", () => {
  test("defines the launch product contract in one versioned catalog", () => {
    expect(tripPassProductCatalog).toMatchObject({
      code: "siargao_trip_pass_14d_v2",
      family: "siargao_trip_pass",
      version: 2,
      label: "Siargao Trip Pass",
      durationDays: 14,
      durationHours: 336,
      amountTotalMinor: 999,
      currency: "usd",
      policyVersions: {
        terms: "trip-pass-terms-2026-08-07",
        refund: "trip-pass-refund-2026-08-07",
        privacy: "privacy-2026-08-07",
        retention: "commerce-retention-2026-08-07",
      },
      freeWindowDays: 7,
      presentation: {
        priceAuthority: "stripe_price",
        launchPriceLabel: "$9.99",
        launchCurrencyCode: "usd",
      },
    });
    expect(tripPassMeterTypes).toEqual([
      "chat_message",
      "live_refresh",
      "heavy_recommendation",
      "weather_refresh",
      "route_lookup",
    ]);
    expect(tripPassPaidMeterLimits).toEqual({
      chat_message: 150,
    });
    expect(tripPassFreeMeterLimits).toEqual({
      chat_message: 10,
    });
    expect(tripPassLegacyPaidMeterLimits).toEqual({
      chat_message: 150,
      live_refresh: 40,
      heavy_recommendation: 8,
      weather_refresh: 20,
      route_lookup: 25,
    });
    expect(tripPassLegacyFreeMeterLimits).toEqual({
      chat_message: 10,
      live_refresh: 3,
      heavy_recommendation: 1,
    });
    expect(tripPassWarningThresholds).toEqual({
      chatRemaining: 20,
      expiresWithinHours: 48,
    });
    expect(tripPassRateLimits).toEqual({
      free: {
        chatStartsPerMinute: 3,
        successfulChatsPerDay: 10,
        concurrentChatRequests: 2,
      },
      paid: {
        chatStartsPerMinute: 10,
        concurrentChatRequests: 2,
      },
    });
    expect(tripPassCostPolicy).toEqual({
      free: {
        maxOutputTokens: 1_500,
        maxToolCalls: 4,
        maxModelCalls: 3,
      },
      paid: {
        routine: {
          maxOutputTokens: 2_500,
          maxToolCalls: 6,
          normalMaxModelCalls: 4,
        },
        heavy: {
          maxOutputTokens: 3_000,
          maxToolCalls: 8,
          normalMaxModelCalls: 6,
        },
      },
      absoluteModelCallBound: 7,
    });
  });

  test("defaults the promoted cost policy on while other feature flags remain disabled", () => {
    const environment = readTripPassEnvironment({});

    expect(environment.checkout).toEqual({
      enabled: false,
      mode: "off",
      priceId: undefined,
      canaryAccountIds: [],
      status: "disabled",
      unavailableReason: null,
    });
    expect(environment.extension).toEqual({
      enabled: false,
      status: "disabled",
      unavailableReason: null,
    });
    expect(environment.deepSeekCostPolicy).toEqual({ enabled: true, status: "active" });
    expect(environment.anonymousIdentity).toMatchObject({
      hmacKeyConfigured: false,
      keyVersion: 1,
      status: "unavailable",
    });
    expect(environment.redis).toEqual({ urlConfigured: false, status: "unavailable" });
    expect(environment.analytics.status).toBe("unavailable");
  });

  test("reports checkout unavailable when enabled without a Stripe Price", () => {
    const environment = readTripPassEnvironment({
      TRIP_PASS_CHECKOUT_MODE: "on",
    });

    expect(environment.checkout).toEqual({
      enabled: false,
      mode: "on",
      priceId: undefined,
      canaryAccountIds: [],
      status: "unavailable",
      unavailableReason: "missing_stripe_trip_pass_price_id",
    });
  });

  test("reports enabled server configuration without reading public names as secrets", () => {
    const environment = readTripPassEnvironment({
      TRIP_PASS_CHECKOUT_MODE: "canary",
      TRIP_PASS_CHECKOUT_CANARY_ACCOUNT_IDS: "user_canary_2, user_canary_1, user_canary_1",
      TRIP_PASS_EXTENSION_ENABLED: "false",
      DEEPSEEK_COST_POLICY_ENABLED: "on",
      STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass_123",
      TRIP_PASS_ANON_HMAC_KEY: "hmac_test_key",
      TRIP_PASS_ANON_HMAC_KEY_VERSION: "2",
      REDIS_URL: "redis://localhost:6379",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_POSTHOG_HOST: "https://app.posthog.com",
      OPENAI_FALLBACK_ENABLED: "yes",
      OPENAI_FALLBACK_DAILY_USD_LIMIT: "5.5",
      TRIP_PASS_WAF_MODE: "log",
      DEEPSEEK_DAILY_USD_LIMIT: "3",
      OPENAI_DAILY_USD_LIMIT: "4",
      GLOBAL_MODEL_DAILY_USD_LIMIT: "7",
    });

    expect(environment.checkout).toEqual({
      enabled: true,
      mode: "canary",
      priceId: "price_trip_pass_123",
      canaryAccountIds: ["user_canary_1", "user_canary_2"],
      status: "available",
      unavailableReason: null,
    });
    expect(environment.deepSeekCostPolicy).toEqual({ enabled: true, status: "active" });
    expect(environment.anonymousIdentity).toEqual({
      hmacKeyConfigured: true,
      keyVersion: 2,
      status: "available",
    });
    expect(environment.redis).toEqual({ urlConfigured: true, status: "available" });
    expect(environment.analytics).toEqual({
      posthogKeyConfigured: true,
      posthogHostConfigured: true,
      status: "available",
    });
    expect(environment.fallback).toEqual({ openAiEnabled: true, dailyUsdLimit: 5.5 });
    expect(environment.waf.mode).toBe("log");
    expect(environment.costBudgets).toEqual({
      deepSeekDailyUsd: 3,
      openAiDailyUsd: 4,
      globalDailyUsd: 7,
    });
  });

  test("rejects malformed flag and budget configuration", () => {
    expect(() => readTripPassEnvironment({ TRIP_PASS_CHECKOUT_MODE: "maybe" })).toThrow(
      "TRIP_PASS_CHECKOUT_MODE must be one of",
    );
    expect(() => readTripPassEnvironment({ TRIP_PASS_EXTENSION_ENABLED: "maybe" })).toThrow(
      "Invalid boolean feature flag",
    );
    expect(() => readTripPassEnvironment({ TRIP_PASS_ANON_HMAC_KEY_VERSION: "0" })).toThrow(
      "TRIP_PASS_ANON_HMAC_KEY_VERSION must be a positive integer.",
    );
    expect(() => readTripPassEnvironment({ OPENAI_DAILY_USD_LIMIT: "-1" })).toThrow(
      "OPENAI_DAILY_USD_LIMIT must be a non-negative number.",
    );
    expect(() => readTripPassEnvironment({ TRIP_PASS_WAF_MODE: "deny" })).toThrow(
      "TRIP_PASS_WAF_MODE must be one of",
    );
  });

  test("refuses public-prefixed names for server-only configuration paths", () => {
    const environment = readTripPassEnvironment({
      NEXT_PUBLIC_STRIPE_TRIP_PASS_PRICE_ID: "price_123",
      TRIP_PASS_CHECKOUT_MODE: "on",
    });

    expect(environment.checkout).toEqual({
      enabled: false,
      mode: "on",
      priceId: undefined,
      canaryAccountIds: [],
      status: "unavailable",
      unavailableReason: "missing_stripe_trip_pass_price_id",
    });
  });

  test("does not let the legacy checkout boolean open Trip Pass checkout", () => {
    const environment = readTripPassEnvironment({
      TRIP_PASS_CHECKOUT_ENABLED: "true",
      STRIPE_TRIP_PASS_PRICE_ID: "price_trip_pass_123",
    });

    expect(environment.checkout).toEqual({
      enabled: false,
      mode: "off",
      priceId: "price_trip_pass_123",
      canaryAccountIds: [],
      status: "disabled",
      unavailableReason: null,
    });
  });
});
