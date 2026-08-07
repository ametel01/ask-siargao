import { createClient } from "redis";

import {
  parseIntegrationEntrypointOptions,
  redactUrl,
  requireServiceUrl,
  withTimeout,
} from "@/server/integration/entrypoint-shared";

const options = parseIntegrationEntrypointOptions(process.argv.slice(2));
const redisUrl = requireServiceUrl("REDIS_URL");
const key = `${options.namespace}:redis:entrypoint-probe`;
const client = createClient({
  url: redisUrl,
  socket: {
    connectTimeout: options.timeoutMs,
    reconnectStrategy: false,
  },
});

client.on("error", () => undefined);

try {
  await withTimeout(
    client.connect().then(() => undefined),
    options.timeoutMs,
    "Redis integration service did not respond before the bounded timeout.",
  );
  await client.set(key, "ready", { PX: 60_000 });

  const value = await client.get(key);
  if (value !== "ready") {
    throw new Error("Redis integration dry-run probe did not round-trip its namespaced key.");
  }

  console.log(
    JSON.stringify(
      {
        checked: "redis-integration-entrypoint",
        dryRun: options.dryRun,
        namespace: options.namespace,
        redisUrl: redactUrl(redisUrl),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const cause = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Redis integration service is required and must be reachable through REDIS_URL; no process-local fallback is allowed. Cause: ${cause}`,
  );
} finally {
  if (client.isOpen) {
    await client.del(key);
    await client.quit();
  }
}
