import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import net from "node:net";

import {
  createMemoryQuotaStore,
  createRedisQuotaStore,
  type QuotaStore,
} from "@/server/security/rate-limit";
import { tripPassFreeMeterLimits, tripPassRateLimits } from "@/server/trip-pass/catalog";

export const anonymousTripCookieName = "as_trip";

export type FreeUsageMeter = "chat_message" | "live_refresh" | "heavy_recommendation";

export type AnonymousFreeAllowanceBeginResult =
  | {
      status: "allowed";
      actor: AnonymousFreeActor;
      cookie: AnonymousTripCookie;
      headers: Headers;
      release(): Promise<void>;
      settle(input: { success: boolean; meters?: readonly FreeUsageMeter[] }): Promise<void>;
    }
  | {
      status: "challenge_required" | "sign_in_required" | "unavailable";
      actor?: AnonymousFreeActor;
      cookie?: AnonymousTripCookie;
      headers: Headers;
      response: Response;
    };

export type AnonymousFreeAllowanceOptions = {
  createId?: () => string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  requestId?: string;
  store?: QuotaStore;
  trustProxyHeaders?: boolean;
};

export type AnonymousFreeActor = {
  cohortHash: string;
  cohortVersion: number;
  tripHash: string;
  tripVersion: number;
};

export type AnonymousTripCookie = {
  id: string;
  expiresAt: number;
  keyVersion: number;
  state: "valid" | "issued" | "rotated" | "tampered" | "expired" | "missing";
  value: string;
};

type AnonymousIdentityConfig =
  | {
      status: "available";
      enforceCohortLimits: boolean;
      key: string;
      keyVersion: number;
      secureCookie: boolean;
    }
  | { status: "unavailable" };

type Reservation = {
  key: string;
  reservationId: string;
};

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
const oneDayMs = 24 * 60 * 60 * 1_000;
const oneMinuteMs = 60_000;
const defaultIpv6CohortPrefixBits = 64;
const localDevelopmentKey = "ask-siargao-local-anonymous-identity-key";

let defaultStore: QuotaStore | undefined;

export async function beginAnonymousFreeChat(
  request: Request,
  options: AnonymousFreeAllowanceOptions = {},
): Promise<AnonymousFreeAllowanceBeginResult> {
  return beginAnonymousFreeUsage(request, {
    ...options,
    meters: ["chat_message"],
  });
}

export async function beginAnonymousFreeUsage(
  request: Request,
  options: AnonymousFreeAllowanceOptions & { meters: readonly FreeUsageMeter[] },
): Promise<AnonymousFreeAllowanceBeginResult> {
  const now = options.now?.() ?? new Date();
  const nowMs = now.getTime();
  const config = readAnonymousIdentityConfig(options.env, request);
  const headers = new Headers();

  if (config.status === "unavailable") {
    return denied("unavailable", headers, "anonymous_identity_unavailable", null);
  }
  if (!options.store && isProductionEnvironment(options.env) && !options.env?.REDIS_URL) {
    return denied("unavailable", headers, "anonymous_quota_store_unavailable", null);
  }

  const cookie = resolveAnonymousTripCookie({
    config,
    cookieHeader: request.headers.get("cookie"),
    createId: options.createId,
    nowMs,
  });
  headers.append(
    "set-cookie",
    serializeAnonymousTripCookie({
      cookie,
      nowMs,
      secure: config.secureCookie,
    }),
  );

  const cohortHash = hmacIdentifier(
    config,
    normalizeNetworkCohort(request, {
      env: options.env,
      trustProxyHeaders: options.trustProxyHeaders,
    }),
    "network",
  );
  const tripHash = hmacIdentifier(config, cookie.id, "trip");
  const actor = {
    cohortHash,
    cohortVersion: config.keyVersion,
    tripHash,
    tripVersion: cookie.keyVersion,
  } satisfies AnonymousFreeActor;
  const keyVersion = config.keyVersion;
  const store = options.store ?? getDefaultAnonymousFreeAllowanceStore(options.env);
  const requestId = options.requestId ?? createReservationId(options.createId);

  if (config.enforceCohortLimits && cookie.state !== "valid" && cookie.state !== "rotated") {
    const velocity = await store.reserveRollingWindow({
      key: `anon:v${config.keyVersion}:cohort:${cohortHash}:fresh-trip-ids:1d`,
      reservationId: tripHash,
      limit: 4,
      nowMs,
      windowMs: oneDayMs,
    });
    if (velocity.status === "rejected") {
      return denied("challenge_required", headers, "anonymous_identity_challenge_required", actor);
    }
  }

  const start = await store.reserveRollingWindow({
    key: `anon:v${config.keyVersion}:trip:${tripHash}:starts:1m`,
    reservationId: requestId,
    limit: tripPassRateLimits.free.chatStartsPerMinute,
    nowMs,
    windowMs: oneMinuteMs,
  });
  if (start.status === "rejected") {
    return denied("sign_in_required", headers, "free_chat_start_limit_exceeded", actor);
  }

  const leaseId = requestId;
  const lease = await store.reserveConcurrency({
    key: `anon:v${config.keyVersion}:trip:${tripHash}:chat-concurrency`,
    leaseId,
    limit: tripPassRateLimits.free.concurrentChatRequests,
    nowMs,
    ttlMs: 2 * oneMinuteMs,
  });
  if (lease.status === "rejected") {
    return denied("sign_in_required", headers, "free_chat_concurrency_exceeded", actor);
  }

  const successReservations: Reservation[] = [];
  const successCheck = await reserveSuccessMeters({
    actor,
    config,
    meters: options.meters,
    nowMs,
    requestId,
    store,
  });
  if (successCheck.status !== "allowed") {
    await store.releaseConcurrency({
      key: `anon:v${config.keyVersion}:trip:${tripHash}:chat-concurrency`,
      leaseId,
    });
    return denied(successCheck.status, headers, successCheck.reason, actor);
  }
  successReservations.push(...successCheck.reservations);

  let released = false;

  async function release() {
    if (released) {
      return;
    }
    released = true;
    await store.releaseConcurrency({
      key: `anon:v${keyVersion}:trip:${tripHash}:chat-concurrency`,
      leaseId,
    });
  }

  return {
    status: "allowed",
    actor,
    cookie,
    headers,
    release,
    async settle(input) {
      if (!input.success) {
        await Promise.all(
          successReservations.map((reservation) => store.releaseRollingWindow(reservation)),
        );
      }
      await release();
    },
  };
}

export function getAnonymousFreeAllowanceResponseHeaders(
  result: AnonymousFreeAllowanceBeginResult | null,
) {
  if (!result) {
    return undefined;
  }
  return result.headers;
}

export function mergeHeaders(first?: HeadersInit, second?: HeadersInit) {
  const headers = new Headers(first);
  if (!second) {
    return headers;
  }
  for (const [key, value] of new Headers(second)) {
    headers.append(key, value);
  }
  return headers;
}

function denied(
  status: "challenge_required" | "sign_in_required" | "unavailable",
  headers: Headers,
  reason: string,
  actor: AnonymousFreeActor | null,
): Extract<AnonymousFreeAllowanceBeginResult, { response: Response }> {
  const statusCode = status === "unavailable" ? 503 : status === "challenge_required" ? 403 : 429;
  const response = Response.json(
    {
      error: status,
      reason,
      ...(status === "sign_in_required"
        ? {
            limit: tripPassFreeMeterLimits.chat_message,
          }
        : {}),
    },
    { status: statusCode, headers },
  );

  return {
    status,
    ...(actor ? { actor } : {}),
    headers,
    response,
  };
}

async function reserveSuccessMeters(input: {
  actor: AnonymousFreeActor;
  config: Extract<AnonymousIdentityConfig, { status: "available" }>;
  meters: readonly FreeUsageMeter[];
  nowMs: number;
  requestId: string;
  store: QuotaStore;
}): Promise<
  | { status: "allowed"; reservations: Reservation[] }
  | { status: "challenge_required" | "sign_in_required"; reason: string }
> {
  const reservations: Reservation[] = [];
  const seenMeters = new Set(input.meters);

  async function reserve(key: string, reservationId: string, limit: number, windowMs: number) {
    const result = await input.store.reserveRollingWindow({
      key,
      reservationId,
      limit,
      nowMs: input.nowMs,
      windowMs,
    });
    if (result.status === "rejected") {
      return false;
    }
    reservations.push({ key, reservationId });
    return true;
  }

  for (const meter of seenMeters) {
    const limit = tripPassFreeMeterLimits[meter];
    const reservationId = `${input.requestId}:${meter}`;
    const sevenDayKey = `anon:v${input.config.keyVersion}:trip:${input.actor.tripHash}:${meter}:7d`;
    if (!(await reserve(sevenDayKey, reservationId, limit, sevenDaysMs))) {
      await releaseReservations(input.store, reservations);
      return { status: "sign_in_required", reason: `${meter}_free_allowance_exhausted` };
    }
  }

  if (seenMeters.has("chat_message")) {
    const dailyKey = `anon:v${input.config.keyVersion}:trip:${input.actor.tripHash}:chat-success:1d`;
    if (
      !(await reserve(
        dailyKey,
        `${input.requestId}:chat-daily`,
        tripPassRateLimits.free.successfulChatsPerDay,
        oneDayMs,
      ))
    ) {
      await releaseReservations(input.store, reservations);
      return { status: "sign_in_required", reason: "free_chat_daily_limit_exceeded" };
    }

    if (input.config.enforceCohortLimits) {
      const cohortKey = `anon:v${input.config.keyVersion}:cohort:${input.actor.cohortHash}:chat-success:7d`;
      if (!(await reserve(cohortKey, `${input.requestId}:cohort-chat`, 40, sevenDaysMs))) {
        await releaseReservations(input.store, reservations);
        return { status: "challenge_required", reason: "cohort_free_chat_challenge_required" };
      }
    }
  }

  return { status: "allowed", reservations };
}

async function releaseReservations(store: QuotaStore, reservations: readonly Reservation[]) {
  await Promise.all(reservations.map((reservation) => store.releaseRollingWindow(reservation)));
}

function resolveAnonymousTripCookie(input: {
  config: Extract<AnonymousIdentityConfig, { status: "available" }>;
  cookieHeader: string | null;
  createId?: () => string;
  nowMs: number;
}): AnonymousTripCookie {
  const parsed = parseCookieHeader(input.cookieHeader).get(anonymousTripCookieName);
  if (!parsed) {
    return issueCookie(input.config, "missing", input.nowMs, input.createId);
  }

  const parts = parsed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return issueCookie(input.config, "tampered", input.nowMs, input.createId);
  }

  const [, encodedId, encodedExpiresAt, signature] = parts;
  const id = decodeBase64Url(encodedId);
  const expiresAtText = decodeBase64Url(encodedExpiresAt);
  const expiresAt = Number(expiresAtText);
  if (!id || !Number.isFinite(expiresAt)) {
    return issueCookie(input.config, "tampered", input.nowMs, input.createId);
  }
  if (expiresAt <= input.nowMs) {
    return issueCookie(input.config, "expired", input.nowMs, input.createId);
  }

  const signedValue = `${encodedId}.${encodedExpiresAt}.${input.config.keyVersion}`;
  if (!verifySignature(input.config.key, signedValue, signature)) {
    return issueCookie(input.config, "tampered", input.nowMs, input.createId);
  }

  const state = expiresAt - input.nowMs < oneDayMs ? "rotated" : "valid";
  if (state === "rotated") {
    return issueCookie(input.config, "rotated", input.nowMs, input.createId, id);
  }

  return {
    id,
    expiresAt,
    keyVersion: input.config.keyVersion,
    state,
    value: parsed,
  };
}

function issueCookie(
  config: Extract<AnonymousIdentityConfig, { status: "available" }>,
  state: AnonymousTripCookie["state"],
  nowMs: number,
  createId?: () => string,
  existingId?: string,
): AnonymousTripCookie {
  const id = existingId ?? createId?.() ?? randomBytes(18).toString("base64url");
  const expiresAt = nowMs + sevenDaysMs;
  const encodedId = Buffer.from(id).toString("base64url");
  const encodedExpiresAt = Buffer.from(String(expiresAt)).toString("base64url");
  const signedValue = `${encodedId}.${encodedExpiresAt}.${config.keyVersion}`;
  const signature = sign(config.key, signedValue);

  return {
    id,
    expiresAt,
    keyVersion: config.keyVersion,
    state,
    value: `v1.${encodedId}.${encodedExpiresAt}.${signature}`,
  };
}

function serializeAnonymousTripCookie(input: {
  cookie: AnonymousTripCookie;
  nowMs: number;
  secure: boolean;
}) {
  const maxAgeSeconds = Math.max(0, Math.floor((input.cookie.expiresAt - input.nowMs) / 1_000));
  return [
    `${anonymousTripCookieName}=${input.cookie.value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}

function readAnonymousIdentityConfig(
  env: Record<string, string | undefined> = process.env,
  request: Request,
): AnonymousIdentityConfig {
  const configuredKey = env.TRIP_PASS_ANON_HMAC_KEY?.trim();
  const key = configuredKey || (isProductionEnvironment(env) ? undefined : localDevelopmentKey);
  if (!key) {
    return { status: "unavailable" };
  }

  return {
    status: "available",
    enforceCohortLimits: Boolean(configuredKey),
    key,
    keyVersion: parsePositiveInteger(env.TRIP_PASS_ANON_HMAC_KEY_VERSION, 1),
    secureCookie: request.url.startsWith("https://") || env.NODE_ENV === "production",
  };
}

function getDefaultAnonymousFreeAllowanceStore(
  env: Record<string, string | undefined> = process.env,
) {
  if (!defaultStore) {
    defaultStore = env.REDIS_URL ? createRedisQuotaStore() : createMemoryQuotaStore();
  }
  return defaultStore;
}

function isProductionEnvironment(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

function normalizeNetworkCohort(
  request: Request,
  input: {
    env?: Record<string, string | undefined>;
    trustProxyHeaders?: boolean;
  } = {},
) {
  const env = input.env ?? process.env;
  const trustProxyHeaders =
    input.trustProxyHeaders ?? (env.TRUST_PROXY_HEADERS === "true" || Boolean(env.VERCEL));
  const candidate = trustProxyHeaders
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim()
    : "local";
  const ip = stripIpPort(candidate || "local");
  const ipVersion = net.isIP(ip);
  if (ipVersion === 4) {
    return `ipv4:${ip}`;
  }
  if (ipVersion === 6) {
    return `ipv6:${cohortIpv6(ip, parsePositiveInteger(env.TRIP_PASS_IPV6_COHORT_BITS, defaultIpv6CohortPrefixBits))}`;
  }
  return "local";
}

function stripIpPort(value: string) {
  if (value.startsWith("[")) {
    return value.slice(1, value.indexOf("]"));
  }
  if (value.includes(":") && value.includes(".")) {
    return value.slice(0, value.lastIndexOf(":"));
  }
  return value;
}

function cohortIpv6(value: string, prefixBits: number) {
  const bytes = parseIpv6Bytes(value);
  const masked = bytes.map((byte, index) => {
    const coveredBits = index * 8;
    if (coveredBits + 8 <= prefixBits) {
      return byte;
    }
    if (coveredBits >= prefixBits) {
      return 0;
    }
    const keepBits = prefixBits - coveredBits;
    return byte & (0xff << (8 - keepBits));
  });
  return Buffer.from(masked).toString("hex");
}

function parseIpv6Bytes(value: string) {
  const [headText, tailText = ""] = value.toLowerCase().split("::");
  const head = headText ? headText.split(":").filter(Boolean) : [];
  const tail = tailText ? tailText.split(":").filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  return groups.flatMap((group) => {
    const parsed = Number.parseInt(group, 16);
    return [(parsed >> 8) & 0xff, parsed & 0xff];
  });
}

function hmacIdentifier(
  config: Extract<AnonymousIdentityConfig, { status: "available" }>,
  value: string,
  purpose: "network" | "trip",
) {
  return createHmac("sha256", config.key)
    .update(`ask-siargao:${purpose}:v${config.keyVersion}:`)
    .update(value)
    .digest("base64url");
}

function sign(key: string, value: string) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function verifySignature(key: string, value: string, signature: string) {
  const expected = Buffer.from(sign(key, value));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name) {
      cookies.set(name, valueParts.join("="));
    }
  }
  return cookies;
}

function decodeBase64Url(value: string | undefined) {
  if (!value) {
    return null;
  }
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createReservationId(createId?: () => string) {
  return createId?.() ?? randomBytes(18).toString("base64url");
}
