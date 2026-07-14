import { createHash, createHmac } from "node:crypto";

import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
} from "@/server/security/rate-limit";

export type RequestIdempotencyResult =
  | { status: "not_requested" }
  | { status: "stored"; actorHash: string; bodyHash: string; tokenHash: string }
  | { status: "duplicate"; actorHash: string; bodyHash: string; tokenHash: string }
  | { status: "conflict"; actorHash: string; bodyHash: string; tokenHash: string }
  | { status: "unavailable" };

export type RequestIdempotencyInput = {
  actorId: string;
  body: string;
  env?: Record<string, string | undefined>;
  headerValue: string | null;
  nowMs: number;
  policyVersion?: string;
  store?: QuotaStore;
  ttlMs?: number;
};

const defaultPolicyVersion = "trip-pass-chat-idempotency-v1";
const defaultTtlMs = 10 * 60 * 1_000;
const localDevelopmentKey = "ask-siargao-local-request-idempotency-key";

let defaultStore: QuotaStore | undefined;

export async function checkRequestIdempotency(
  input: RequestIdempotencyInput,
): Promise<RequestIdempotencyResult> {
  const token = input.headerValue?.trim();
  if (!token) {
    return { status: "not_requested" };
  }
  const key = idempotencyKey(input.env);
  if (!key) {
    return { status: "unavailable" };
  }

  const policyVersion = input.policyVersion ?? defaultPolicyVersion;
  const actorHash = hmac(key, `actor:${policyVersion}:${input.actorId}`);
  const bodyHash = hashBody(input.body);
  const tokenHash = hmac(key, `token:${policyVersion}:${token}`);
  const value = JSON.stringify({ actorHash, bodyHash, policyVersion });
  const store = input.store ?? defaultRequestIdempotencyStore(input.env);

  try {
    const result = await store.recordIdempotency({
      key: `idempotency:${policyVersion}:${tokenHash}`,
      value,
      nowMs: input.nowMs,
      ttlMs: input.ttlMs ?? defaultTtlMs,
    });
    if (result.status === "stored") {
      return { status: "stored", actorHash, bodyHash, tokenHash };
    }
    return result.value === value
      ? { status: "duplicate", actorHash, bodyHash, tokenHash }
      : { status: "conflict", actorHash, bodyHash, tokenHash };
  } catch {
    return { status: "unavailable" };
  }
}

export function idempotencyJson(
  result: Extract<RequestIdempotencyResult, { status: "conflict" | "duplicate" | "unavailable" }>,
) {
  if (result.status === "unavailable") {
    return Response.json({ error: "idempotency_unavailable" }, { status: 503 });
  }
  return Response.json(
    {
      error:
        result.status === "duplicate" ? "idempotent_request_replay" : "idempotency_key_conflict",
    },
    { status: 409 },
  );
}

function idempotencyKey(env: Record<string, string | undefined> = process.env) {
  const configured = env.TRIP_PASS_IDEMPOTENCY_HMAC_KEY?.trim();
  if (configured) {
    return configured;
  }
  if (env.NODE_ENV === "production" || env.APP_ENV === "production") {
    return undefined;
  }
  return localDevelopmentKey;
}

function defaultRequestIdempotencyStore(env: Record<string, string | undefined> = process.env) {
  if (!defaultStore) {
    defaultStore =
      env.REDIS_URL && env.NODE_ENV !== "test" ? createRedisQuotaStore() : createMemoryQuotaStore();
  }
  return defaultStore;
}

function hashBody(body: string) {
  return createHash("sha256").update(body).digest("base64url");
}

function hmac(key: string, value: string) {
  return createHmac("sha256", key).update(value).digest("base64url");
}
