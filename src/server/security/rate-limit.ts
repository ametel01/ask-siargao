import {
  getRedisCommandClient,
  type RedisCommandClient,
} from "@/server/security/redis-command-client";

export type RateLimitPolicy =
  | "intake"
  | "chat"
  | "checkout"
  | "public_api"
  | "report_access"
  | "provider_call";

export type RateLimitBlockedReason =
  | "limit_exceeded"
  | "production_store_required"
  | "quota_store_unavailable";

export type RateLimitResult = {
  allowed: boolean;
  blockedReason?: RateLimitBlockedReason;
  limit: number;
  remaining: number;
  resetAt: string;
  headers: HeadersInit;
};

export type FixedWindowIncrementResult = {
  count: number;
  resetAt: number;
};

export type ConcurrencyLeaseResult =
  | { status: "acquired"; count: number; leaseId: string; expiresAt: number }
  | { status: "duplicate"; count: number; leaseId: string; expiresAt: number }
  | { status: "rejected"; count: number; expiresAt: number };

export type IdempotencyRecordResult =
  | { status: "stored"; key: string; expiresAt: number }
  | { status: "duplicate"; key: string; value: string | null; expiresAt: number };

export type RollingWindowReservationResult =
  | { status: "reserved"; count: number; reservationId: string; resetAt: number }
  | { status: "duplicate"; count: number; reservationId: string; resetAt: number }
  | { status: "rejected"; count: number; resetAt: number };

export type BudgetConsumptionResult =
  | { status: "consumed"; used: number; limit: number; resetAt: number }
  | { status: "exceeded"; used: number; limit: number; resetAt: number };

export type QuotaStore = {
  readonly scope: "process" | "shared";
  consumeBudget(input: {
    amount: number;
    key: string;
    limit: number;
    nowMs: number;
    windowMs: number;
  }): Promise<BudgetConsumptionResult>;
  incrementFixedWindow(input: {
    key: string;
    nowMs: number;
    windowMs: number;
  }): Promise<FixedWindowIncrementResult>;
  recordIdempotency(input: {
    key: string;
    nowMs: number;
    ttlMs: number;
    value: string;
  }): Promise<IdempotencyRecordResult>;
  releaseBudget(input: { amount: number; key: string }): Promise<void>;
  releaseConcurrency(input: { key: string; leaseId: string }): Promise<void>;
  releaseRollingWindow(input: { key: string; reservationId: string }): Promise<void>;
  reserveRollingWindow(input: {
    key: string;
    limit: number;
    nowMs: number;
    reservationId: string;
    windowMs: number;
  }): Promise<RollingWindowReservationResult>;
  reserveConcurrency(input: {
    key: string;
    leaseId: string;
    limit: number;
    nowMs: number;
    ttlMs: number;
  }): Promise<ConcurrencyLeaseResult>;
  reset?(): void | Promise<void>;
};

export type RateLimiter = {
  checkRateLimit(input: RateLimitInput): Promise<RateLimitResult>;
  rateLimitRequest(
    request: Request,
    policy: RateLimitPolicy,
    options?: RateLimitRequestOptions,
  ): Promise<RateLimitResult>;
  resetRateLimitStore(): Promise<void>;
};

type RateLimitInput = {
  key: string;
  policy: RateLimitPolicy;
  now?: Date;
};

type RateLimitRequestOptions = {
  now?: Date;
};

export type RateLimiterOptions = {
  env?: string;
  store?: QuotaStore;
  trustProxyHeaders?: boolean;
};

type DefaultRateLimiterOptions = {
  env?: Record<string, string | undefined>;
  redisStore?: QuotaStore;
};

type MemoryQuotaStore = QuotaStore & {
  size(): number;
};

type MemoryCounter = {
  count: number;
  resetAt: number;
};

type MemoryLease = {
  leaseIds: Map<string, number>;
};

type MemoryIdempotencyRecord = {
  expiresAt: number;
  value: string;
};

type MemoryRollingWindow = Map<string, number>;

const policies: Record<RateLimitPolicy, { limit: number; windowMs: number }> = {
  intake: { limit: 8, windowMs: 60_000 },
  chat: { limit: 20, windowMs: 60_000 },
  checkout: { limit: 4, windowMs: 60_000 },
  public_api: { limit: 120, windowMs: 60_000 },
  report_access: { limit: 30, windowMs: 60_000 },
  provider_call: { limit: 40, windowMs: 60_000 },
};

export function createMemoryRateLimitStore(): MemoryQuotaStore {
  return createMemoryQuotaStore();
}

export function createMemoryQuotaStore(): MemoryQuotaStore {
  const counters = new Map<string, MemoryCounter>();
  const leases = new Map<string, MemoryLease>();
  const idempotency = new Map<string, MemoryIdempotencyRecord>();
  const rollingWindows = new Map<string, MemoryRollingWindow>();

  function cleanup(nowMs: number) {
    for (const [key, counter] of counters) {
      if (counter.resetAt <= nowMs) {
        counters.delete(key);
      }
    }
    for (const [key, lease] of leases) {
      for (const [leaseId, expiresAt] of lease.leaseIds) {
        if (expiresAt <= nowMs) {
          lease.leaseIds.delete(leaseId);
        }
      }
      if (lease.leaseIds.size === 0) {
        leases.delete(key);
      }
    }
    for (const [key, record] of idempotency) {
      if (record.expiresAt <= nowMs) {
        idempotency.delete(key);
      }
    }
    for (const [key, rollingWindow] of rollingWindows) {
      for (const [reservationId, expiresAt] of rollingWindow) {
        if (expiresAt <= nowMs) {
          rollingWindow.delete(reservationId);
        }
      }
      if (rollingWindow.size === 0) {
        rollingWindows.delete(key);
      }
    }
  }

  return {
    scope: "process",
    async consumeBudget(input) {
      cleanup(input.nowMs);
      const counter = counters.get(input.key) ?? {
        count: 0,
        resetAt: input.nowMs + input.windowMs,
      };
      counter.count += input.amount;
      counters.set(input.key, counter);

      if (counter.count > input.limit) {
        counter.count -= input.amount;
        return {
          status: "exceeded",
          used: counter.count,
          limit: input.limit,
          resetAt: counter.resetAt,
        };
      }
      return {
        status: "consumed",
        used: counter.count,
        limit: input.limit,
        resetAt: counter.resetAt,
      };
    },
    async incrementFixedWindow(input) {
      cleanup(input.nowMs);
      const counter = counters.get(input.key) ?? {
        count: 0,
        resetAt: input.nowMs + input.windowMs,
      };

      counter.count += 1;
      counters.set(input.key, counter);

      return { count: counter.count, resetAt: counter.resetAt };
    },
    async recordIdempotency(input) {
      cleanup(input.nowMs);
      const existing = idempotency.get(input.key);
      if (existing) {
        return {
          status: "duplicate",
          key: input.key,
          value: existing.value,
          expiresAt: existing.expiresAt,
        };
      }
      const expiresAt = input.nowMs + input.ttlMs;
      idempotency.set(input.key, { value: input.value, expiresAt });
      return { status: "stored", key: input.key, expiresAt };
    },
    async releaseBudget(input) {
      const counter = counters.get(input.key);
      if (!counter) {
        return;
      }
      counter.count = Math.max(counter.count - input.amount, 0);
      if (counter.count === 0) {
        counters.delete(input.key);
      }
    },
    async releaseConcurrency(input) {
      const lease = leases.get(input.key);
      if (!lease) {
        return;
      }
      lease.leaseIds.delete(input.leaseId);
      if (lease.leaseIds.size === 0) {
        leases.delete(input.key);
      }
    },
    async releaseRollingWindow(input) {
      const rollingWindow = rollingWindows.get(input.key);
      if (!rollingWindow) {
        return;
      }
      rollingWindow.delete(input.reservationId);
      if (rollingWindow.size === 0) {
        rollingWindows.delete(input.key);
      }
    },
    async reserveRollingWindow(input) {
      cleanup(input.nowMs);
      const rollingWindow = rollingWindows.get(input.key) ?? new Map<string, number>();
      const existingExpiresAt = rollingWindow.get(input.reservationId);
      if (existingExpiresAt) {
        rollingWindows.set(input.key, rollingWindow);
        return {
          status: "duplicate",
          count: rollingWindow.size,
          reservationId: input.reservationId,
          resetAt: earliestExpiry(rollingWindow.values(), input.nowMs + input.windowMs),
        };
      }

      if (rollingWindow.size >= input.limit) {
        rollingWindows.set(input.key, rollingWindow);
        return {
          status: "rejected",
          count: rollingWindow.size,
          resetAt: earliestExpiry(rollingWindow.values(), input.nowMs + input.windowMs),
        };
      }

      const expiresAt = input.nowMs + input.windowMs;
      rollingWindow.set(input.reservationId, expiresAt);
      rollingWindows.set(input.key, rollingWindow);
      return {
        status: "reserved",
        count: rollingWindow.size,
        reservationId: input.reservationId,
        resetAt: earliestExpiry(rollingWindow.values(), expiresAt),
      };
    },
    async reserveConcurrency(input) {
      cleanup(input.nowMs);
      const lease = leases.get(input.key) ?? {
        leaseIds: new Map<string, number>(),
      };
      const existingExpiresAt = lease.leaseIds.get(input.leaseId);
      if (existingExpiresAt) {
        leases.set(input.key, lease);
        return {
          status: "duplicate",
          count: lease.leaseIds.size,
          leaseId: input.leaseId,
          expiresAt: existingExpiresAt,
        };
      }

      if (lease.leaseIds.size >= input.limit) {
        leases.set(input.key, lease);
        return {
          status: "rejected",
          count: lease.leaseIds.size,
          expiresAt: earliestExpiry(lease.leaseIds.values(), input.nowMs + input.ttlMs),
        };
      }

      const expiresAt = input.nowMs + input.ttlMs;
      lease.leaseIds.set(input.leaseId, expiresAt);
      leases.set(input.key, lease);
      return {
        status: "acquired",
        count: lease.leaseIds.size,
        leaseId: input.leaseId,
        expiresAt,
      };
    },
    reset() {
      counters.clear();
      leases.clear();
      idempotency.clear();
      rollingWindows.clear();
    },
    size() {
      return counters.size + leases.size + idempotency.size + rollingWindows.size;
    },
  };
}

export function createRedisQuotaStore(
  input: { client?: RedisCommandClient; keyPrefix?: string; redisUrl?: string } = {},
): QuotaStore {
  const client = input.client ?? getRedisCommandClient(input.redisUrl ?? process.env.REDIS_URL);
  const keyPrefix = input.keyPrefix ?? "ask-siargao";

  return {
    scope: "shared",
    async consumeBudget(budgetInput) {
      const key = redisKey(keyPrefix, budgetInput.key);
      const used = await client.incrby(key, budgetInput.amount);
      if (used === budgetInput.amount) {
        await client.pexpire(key, budgetInput.windowMs);
      }
      const resetAt = await redisResetAt(client, key, budgetInput.nowMs, budgetInput.windowMs);
      if (used > budgetInput.limit) {
        const reverted = await client.decrby(key, budgetInput.amount);
        return {
          status: "exceeded",
          used: reverted,
          limit: budgetInput.limit,
          resetAt,
        };
      }
      return { status: "consumed", used, limit: budgetInput.limit, resetAt };
    },
    async incrementFixedWindow(windowInput) {
      const key = redisKey(keyPrefix, windowInput.key);
      const count = await client.incr(key);
      if (count === 1) {
        await client.pexpire(key, windowInput.windowMs);
      }
      return {
        count,
        resetAt: await redisResetAt(client, key, windowInput.nowMs, windowInput.windowMs),
      };
    },
    async recordIdempotency(idempotencyInput) {
      const key = redisKey(keyPrefix, idempotencyInput.key);
      const stored = await client.set(key, idempotencyInput.value, "NX");
      const expiresAt = idempotencyInput.nowMs + idempotencyInput.ttlMs;
      if (stored) {
        await client.pexpire(key, idempotencyInput.ttlMs);
        return { status: "stored", key: idempotencyInput.key, expiresAt };
      }

      return {
        status: "duplicate",
        key: idempotencyInput.key,
        value: await client.get(key),
        expiresAt: await redisResetAt(client, key, idempotencyInput.nowMs, idempotencyInput.ttlMs),
      };
    },
    async releaseBudget(input) {
      await client.decrby(redisKey(keyPrefix, input.key), input.amount);
    },
    async releaseConcurrency(input) {
      await client.send("ZREM", [redisKey(keyPrefix, input.key), input.leaseId]);
    },
    async releaseRollingWindow(input) {
      await client.send("ZREM", [redisKey(keyPrefix, input.key), input.reservationId]);
    },
    async reserveRollingWindow(input) {
      const result = await client.send("EVAL", [
        rollingWindowReservationScript,
        "1",
        redisKey(keyPrefix, input.key),
        String(input.nowMs),
        String(input.windowMs),
        input.reservationId,
        String(input.limit),
      ]);
      const [status, count, resetAt] = parseRedisScriptTuple(result);
      if (status === "reserved" || status === "duplicate") {
        return {
          status,
          count,
          reservationId: input.reservationId,
          resetAt,
        };
      }
      return { status: "rejected", count, resetAt };
    },
    async reserveConcurrency(input) {
      const result = await client.send("EVAL", [
        concurrencyLeaseScript,
        "1",
        redisKey(keyPrefix, input.key),
        String(input.nowMs),
        String(input.ttlMs),
        input.leaseId,
        String(input.limit),
      ]);
      const [status, count, expiresAt] = parseRedisScriptTuple(result);
      if (status === "acquired" || status === "duplicate") {
        return { status, count, leaseId: input.leaseId, expiresAt };
      }
      return { status: "rejected", count, expiresAt };
    },
  };
}

export function shouldUseRedisQuotaStore(env: Record<string, string | undefined> = process.env) {
  return (
    Boolean(env.REDIS_URL?.trim()) &&
    (env.NODE_ENV === "production" || env.APP_ENV === "production")
  );
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const store = options.store ?? defaultMemoryStore;
  const trustProxyHeaders = options.trustProxyHeaders ?? process.env.TRUST_PROXY_HEADERS === "true";

  async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
    const policy = policies[input.policy];
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const resetAt = new Date(nowMs + policy.windowMs).toISOString();

    if (store.scope !== "shared" && (options.env ?? process.env.NODE_ENV) === "production") {
      return failClosedRateLimit(policy, resetAt, "production_store_required");
    }

    try {
      const counter = await store.incrementFixedWindow({
        key: `${input.policy}:${input.key}`,
        nowMs,
        windowMs: policy.windowMs,
      });
      const remaining = Math.max(policy.limit - counter.count, 0);
      const allowed = counter.count <= policy.limit;

      return {
        allowed,
        ...(allowed ? {} : { blockedReason: "limit_exceeded" as const }),
        limit: policy.limit,
        remaining,
        resetAt: new Date(counter.resetAt).toISOString(),
        headers: rateLimitHeaders(policy.limit, remaining, new Date(counter.resetAt).toISOString()),
      };
    } catch {
      return failClosedRateLimit(policy, resetAt, "quota_store_unavailable");
    }
  }

  return {
    checkRateLimit,
    async rateLimitRequest(request, policy, requestOptions) {
      return checkRateLimit({
        key: requestPolicyKey(request, policy, trustProxyHeaders),
        policy,
        now: requestOptions?.now,
      });
    },
    async resetRateLimitStore() {
      await store.reset?.();
    },
  };
}

const defaultMemoryStore = createMemoryQuotaStore();
let defaultRateLimiter: RateLimiter | null = null;

export function createDefaultRateLimiter(options: DefaultRateLimiterOptions = {}) {
  const env = options.env ?? process.env;
  const productionRuntime = env.NODE_ENV === "production" || env.APP_ENV === "production";
  const store = shouldUseRedisQuotaStore(env)
    ? (options.redisStore ?? createRedisQuotaStore({ redisUrl: env.REDIS_URL }))
    : defaultMemoryStore;

  return createRateLimiter({
    env: productionRuntime ? "production" : env.NODE_ENV,
    store,
    trustProxyHeaders: env.TRUST_PROXY_HEADERS === "true",
  });
}

function getDefaultRateLimiter() {
  defaultRateLimiter ??= createDefaultRateLimiter();
  return defaultRateLimiter;
}

export function configureRateLimitStore(
  store: QuotaStore,
  options: Omit<RateLimiterOptions, "store"> = {},
) {
  defaultRateLimiter = createRateLimiter({ ...options, store });
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  return getDefaultRateLimiter().checkRateLimit(input);
}

export async function rateLimitRequest(
  request: Request,
  policy: RateLimitPolicy,
  options?: RateLimitRequestOptions,
) {
  return getDefaultRateLimiter().rateLimitRequest(request, policy, options);
}

export function rateLimitedJson(result: RateLimitResult) {
  return Response.json(
    {
      error: "rate_limited",
      resetAt: result.resetAt,
    },
    { status: 429, headers: result.headers },
  );
}

export async function resetRateLimitStoreForTests() {
  await defaultMemoryStore.reset?.();
  defaultRateLimiter = createRateLimiter({ store: defaultMemoryStore });
}

function failClosedRateLimit(
  policy: { limit: number },
  resetAt: string,
  blockedReason: RateLimitBlockedReason,
): RateLimitResult {
  return {
    allowed: false,
    blockedReason,
    limit: policy.limit,
    remaining: 0,
    resetAt,
    headers: rateLimitHeaders(policy.limit, 0, resetAt),
  };
}

function rateLimitHeaders(limit: number, remaining: number, resetAt: string) {
  return {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": resetAt,
  };
}

async function redisResetAt(
  client: RedisCommandClient,
  key: string,
  nowMs: number,
  fallbackWindowMs: number,
) {
  const ttl = await client.pttl(key);
  return nowMs + (ttl > 0 ? ttl : fallbackWindowMs);
}

function redisKey(prefix: string, key: string) {
  return `${prefix}:${key}`;
}

function earliestExpiry(values: Iterable<number>, fallback: number) {
  let earliest = fallback;
  for (const value of values) {
    earliest = Math.min(earliest, value);
  }
  return earliest;
}

function parseRedisScriptTuple(result: unknown): [string, number, number] {
  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Unexpected Redis quota script response");
  }
  const [status, count, timestamp] = result;
  if (typeof status !== "string") {
    throw new Error("Unexpected Redis quota script status");
  }
  return [status, Number(count), Number(timestamp)];
}

const rollingWindowReservationScript = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1] - ARGV[2])
local existing = redis.call("ZSCORE", KEYS[1], ARGV[3])
local count = redis.call("ZCARD", KEYS[1])
if existing then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local reset_at = ARGV[1] + ARGV[2]
  if oldest[2] then reset_at = oldest[2] + ARGV[2] end
  return {"duplicate", count, reset_at}
end
if count >= tonumber(ARGV[4]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local reset_at = ARGV[1] + ARGV[2]
  if oldest[2] then reset_at = oldest[2] + ARGV[2] end
  return {"rejected", count, reset_at}
end
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[3])
redis.call("PEXPIRE", KEYS[1], ARGV[2])
count = count + 1
local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
local reset_at = ARGV[1] + ARGV[2]
if oldest[2] then reset_at = oldest[2] + ARGV[2] end
return {"reserved", count, reset_at}
`;

const concurrencyLeaseScript = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local existing = redis.call("ZSCORE", KEYS[1], ARGV[3])
local count = redis.call("ZCARD", KEYS[1])
if existing then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  return {"duplicate", count, existing}
end
if count >= tonumber(ARGV[4]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  local expires_at = ARGV[1] + ARGV[2]
  if oldest[2] then expires_at = oldest[2] end
  return {"rejected", count, expires_at}
end
local expires_at = ARGV[1] + ARGV[2]
redis.call("ZADD", KEYS[1], expires_at, ARGV[3])
redis.call("PEXPIRE", KEYS[1], ARGV[2])
return {"acquired", count + 1, expires_at}
`;

function requestClientKey(request: Request, trustProxyHeaders: boolean) {
  if (!trustProxyHeaders) {
    return "local";
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwarded || realIp || "local";
}

function requestPolicyKey(request: Request, policy: RateLimitPolicy, trustProxyHeaders: boolean) {
  const clientKey = requestClientKey(request, trustProxyHeaders);
  if (policy !== "public_api") {
    return clientKey;
  }

  return `${clientKey}:${new URL(request.url).pathname}`;
}
