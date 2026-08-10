import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { getRedisCommandClient } from "@/server/security/redis-command-client";

export const healthProbeTimeoutMs = 1_500;

export function liveHealthResponse() {
  return Response.json({ status: "live" }, { headers: { "cache-control": "no-store" } });
}

export async function readyHealthResponse(
  dependencies: {
    probePostgres?: () => Promise<void>;
    probeRedis?: () => Promise<void>;
    timeoutMs?: number;
  } = {},
) {
  const timeoutMs = dependencies.timeoutMs ?? healthProbeTimeoutMs;
  const probePostgres = dependencies.probePostgres ?? defaultPostgresProbe;
  const probeRedis = dependencies.probeRedis ?? defaultRedisProbe;
  const results = await Promise.allSettled([
    withTimeout(probePostgres(), timeoutMs),
    withTimeout(probeRedis(), timeoutMs),
  ]);
  const ready = results.every((result) => result.status === "fulfilled");

  return Response.json(
    { status: ready ? "ready" : "unavailable" },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function defaultPostgresProbe() {
  const result = await getDefaultDatabaseQueryClient().query<{ healthy: number }>(
    "select 1 as healthy",
  );
  if (Number(result.rows[0]?.healthy) !== 1) {
    throw new Error("postgres_probe_failed");
  }
}

async function defaultRedisProbe() {
  const response = await getRedisCommandClient(process.env.REDIS_URL).send("PING", []);
  if (response !== "PONG") {
    throw new Error("redis_probe_failed");
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("health_probe_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
