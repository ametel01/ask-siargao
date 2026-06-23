export type RateLimitPolicy =
  | "intake"
  | "checkout"
  | "public_api"
  | "report_access"
  | "provider_call";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  headers: HeadersInit;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitStore = {
  readonly scope: "process" | "shared";
  increment(bucketKey: string, windowMs: number, nowMs: number): RateLimitBucket;
  reset?(): void;
};

export type RateLimiter = {
  checkRateLimit(input: RateLimitInput): RateLimitResult;
  rateLimitRequest(
    request: Request,
    policy: RateLimitPolicy,
    options?: RateLimitRequestOptions,
  ): RateLimitResult;
  resetRateLimitStore(): void;
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
  store?: RateLimitStore;
  trustProxyHeaders?: boolean;
  env?: string;
  warn?: (message: string) => void;
};

type MemoryRateLimitStore = Omit<RateLimitStore, "reset"> & {
  reset(): void;
  size(): number;
};

const policies: Record<RateLimitPolicy, { limit: number; windowMs: number }> = {
  intake: { limit: 8, windowMs: 60_000 },
  checkout: { limit: 4, windowMs: 60_000 },
  public_api: { limit: 120, windowMs: 60_000 },
  report_access: { limit: 30, windowMs: 60_000 },
  provider_call: { limit: 40, windowMs: 60_000 },
};

export function createMemoryRateLimitStore(): MemoryRateLimitStore {
  const buckets = new Map<string, RateLimitBucket>();

  return {
    scope: "process",
    increment(bucketKey, windowMs, nowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= nowMs) {
          buckets.delete(key);
        }
      }

      const existing = buckets.get(bucketKey);
      const bucket =
        existing && existing.resetAt > nowMs ? existing : { count: 0, resetAt: nowMs + windowMs };

      bucket.count += 1;
      buckets.set(bucketKey, bucket);

      return bucket;
    },
    reset() {
      buckets.clear();
    },
    size() {
      return buckets.size;
    },
  };
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const store = options.store ?? defaultMemoryStore;
  const trustProxyHeaders = options.trustProxyHeaders ?? process.env.TRUST_PROXY_HEADERS === "true";
  const env = options.env ?? process.env.NODE_ENV;
  const warn = options.warn ?? console.warn;
  let warnedAboutMemoryStore = false;

  function checkRateLimit(input: RateLimitInput): RateLimitResult {
    if (env === "production" && store.scope !== "shared" && !warnedAboutMemoryStore) {
      warn(
        "Production rate limiting is using process-local memory. Configure a shared RateLimitStore before deployment.",
      );
      warnedAboutMemoryStore = true;
    }

    const policy = policies[input.policy];
    const nowMs = (input.now ?? new Date()).getTime();
    const bucketKey = `${input.policy}:${input.key}`;
    const bucket = store.increment(bucketKey, policy.windowMs, nowMs);

    const remaining = Math.max(policy.limit - bucket.count, 0);
    const allowed = bucket.count <= policy.limit;
    const resetAt = new Date(bucket.resetAt).toISOString();

    return {
      allowed,
      limit: policy.limit,
      remaining,
      resetAt,
      headers: {
        "x-ratelimit-limit": String(policy.limit),
        "x-ratelimit-remaining": String(remaining),
        "x-ratelimit-reset": resetAt,
      },
    };
  }

  return {
    checkRateLimit,
    rateLimitRequest(request, policy, requestOptions) {
      return checkRateLimit({
        key: requestClientKey(request, trustProxyHeaders),
        policy,
        now: requestOptions?.now,
      });
    },
    resetRateLimitStore() {
      store.reset?.();
    },
  };
}

const defaultMemoryStore = createMemoryRateLimitStore();
let defaultRateLimiter = createRateLimiter({ store: defaultMemoryStore });

export function configureRateLimitStore(
  store: RateLimitStore,
  options: Omit<RateLimiterOptions, "store"> = {},
) {
  defaultRateLimiter = createRateLimiter({ ...options, store });
}

export function checkRateLimit(input: RateLimitInput): RateLimitResult {
  return defaultRateLimiter.checkRateLimit(input);
}

export function rateLimitRequest(
  request: Request,
  policy: RateLimitPolicy,
  options?: RateLimitRequestOptions,
) {
  return defaultRateLimiter.rateLimitRequest(request, policy, options);
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

export function resetRateLimitStoreForTests() {
  defaultMemoryStore.reset();
  defaultRateLimiter = createRateLimiter({ store: defaultMemoryStore });
}

function requestClientKey(request: Request, trustProxyHeaders: boolean) {
  if (!trustProxyHeaders) {
    return "local";
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwarded || realIp || "local";
}
