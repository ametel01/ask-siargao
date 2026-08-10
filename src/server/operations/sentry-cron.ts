export type SentryCronCheckInStatus = "ok" | "error";

export type SentryCronSink = {
  send(input: {
    durationMs: number;
    environment: string;
    status: SentryCronCheckInStatus;
  }): Promise<void>;
};

export function createSentryCronHttpSink(input: {
  dsn: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  monitorSlug: string;
  timeoutMs?: number;
}): SentryCronSink {
  const endpoint = parseSentryCronEndpoint(input.dsn, input.monitorSlug);
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("invalid_sentry_timeout");
  }

  return {
    async send(checkIn) {
      const url = new URL(endpoint);
      url.searchParams.set("status", checkIn.status);
      url.searchParams.set("environment", normalizeEnvironment(checkIn.environment));
      url.searchParams.set("duration", (Math.max(0, checkIn.durationMs) / 1_000).toFixed(3));
      const response = await fetchImpl(url.toString(), {
        headers: { "cache-control": "no-store" },
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error("sentry_cron_delivery_failed");
    },
  };
}

export function sentryEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return normalizeEnvironment(
    env.SENTRY_ENVIRONMENT ?? env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV ?? "development",
  );
}

function parseSentryCronEndpoint(dsn: string, monitorSlug: string) {
  const parsed = new URL(dsn);
  const publicKey = parsed.username;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!publicKey || !projectId || !/^\d+$/.test(projectId)) {
    throw new Error("invalid_sentry_dsn");
  }
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(monitorSlug)) {
    throw new Error("invalid_sentry_monitor_slug");
  }
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return `${parsed.protocol}//${parsed.host}${prefix}/api/${projectId}/cron/${monitorSlug}/${publicKey}/`;
}

function normalizeEnvironment(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64);
  return normalized || "unknown";
}
