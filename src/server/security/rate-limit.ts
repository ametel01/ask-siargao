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

const policies: Record<RateLimitPolicy, { limit: number; windowMs: number }> = {
  intake: { limit: 8, windowMs: 60_000 },
  checkout: { limit: 4, windowMs: 60_000 },
  public_api: { limit: 120, windowMs: 60_000 },
  report_access: { limit: 30, windowMs: 60_000 },
  provider_call: { limit: 40, windowMs: 60_000 },
};

const store = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(input: {
  key: string;
  policy: RateLimitPolicy;
  now?: Date;
}): RateLimitResult {
  const policy = policies[input.policy];
  const nowMs = (input.now ?? new Date()).getTime();
  const bucketKey = `${input.policy}:${input.key}`;
  const existing = store.get(bucketKey);
  const bucket =
    existing && existing.resetAt > nowMs
      ? existing
      : { count: 0, resetAt: nowMs + policy.windowMs };

  bucket.count += 1;
  store.set(bucketKey, bucket);

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

export function rateLimitRequest(request: Request, policy: RateLimitPolicy) {
  return checkRateLimit({
    key: requestClientKey(request),
    policy,
  });
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
  store.clear();
}

function requestClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwarded || realIp || "local";
}
