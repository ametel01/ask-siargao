import { randomUUID } from "node:crypto";
import { createClient } from "redis";

import {
  assertSafeIntegrationServiceUrl,
  disposableIntegrationServiceMarkers,
  parseIntegrationEntrypointOptions,
  redactUrl,
  requireServiceUrl,
  runWithIntegrationLifecycle,
} from "@/server/integration/entrypoint-shared";
import {
  createRedisCommandClient,
  type RedisCommandClient,
} from "@/server/security/redis-command-client";

export type RealRedisHarness = {
  readonly keyPrefix: string;
  readonly namespace: string;
  readonly redisUrl: string;
  createCommandClient(): RedisCommandClient;
  cleanup(): Promise<void>;
};

type HarnessOptions = {
  allowRemote: boolean;
  namespace: string;
  redisUrl: string;
  timeoutMs: number;
};

export async function withRealRedisHarness<T>(
  work: (harness: RealRedisHarness) => Promise<T>,
  options = parseRedisHarnessOptions(),
) {
  return runWithIntegrationLifecycle(async (owner) => {
    const harness = createRealRedisHarness(options);
    let ownsPrefix = false;
    owner.deferCleanup(async () => {
      if (ownsPrefix) {
        await harness.cleanup();
      }
    });

    await claimRedisPrefix(harness.keyPrefix, options.redisUrl, options.timeoutMs);
    ownsPrefix = true;
    return await work(harness);
  });
}

export function parseRedisHarnessOptions(
  argv = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): HarnessOptions {
  const options = parseIntegrationEntrypointOptions(argv, env);
  const redisUrl = requireServiceUrl("REDIS_URL", env);
  const allowRemote = env.INTEGRATION_TEST_ALLOW_REMOTE === "1";
  assertSafeIntegrationServiceUrl({
    allowRemote,
    name: "REDIS_URL",
    requiredText: disposableIntegrationServiceMarkers,
    url: redisUrl,
  });

  return {
    allowRemote,
    namespace: `${options.namespace}_redis`,
    redisUrl,
    timeoutMs: options.timeoutMs,
  };
}

function createRealRedisHarness(input: HarnessOptions): RealRedisHarness {
  const keyPrefix = `ask-siargao:${input.namespace}:${randomUUID().replaceAll("-", "")}`;
  return {
    keyPrefix,
    namespace: input.namespace,
    redisUrl: redactUrl(input.redisUrl),
    createCommandClient() {
      return createRedisCommandClient({ url: input.redisUrl });
    },
    async cleanup() {
      const client = createClient({
        url: input.redisUrl,
        socket: {
          connectTimeout: input.timeoutMs,
          reconnectStrategy: false,
        },
      });
      client.on("error", () => undefined);
      try {
        await client.connect();
        let cursor = "0";
        do {
          const result = await client.sendCommand([
            "SCAN",
            cursor,
            "MATCH",
            `${keyPrefix}:*`,
            "COUNT",
            "100",
          ]);
          const [nextCursor, keys] = parseScanResult(result);
          cursor = nextCursor;
          if (keys.length > 0) {
            await client.sendCommand(["DEL", ...keys]);
          }
        } while (cursor !== "0");
      } finally {
        if (client.isOpen) {
          await client.quit();
        }
      }
    },
  };
}

async function claimRedisPrefix(keyPrefix: string, redisUrl: string, timeoutMs: number) {
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: timeoutMs,
      reconnectStrategy: false,
    },
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.ping();
    const claimed = await client.set(`${keyPrefix}:__owner`, randomUUID(), { NX: true });
    if (!claimed) {
      throw new Error("Redis integration key prefix already exists; refusing shared cleanup.");
    }
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}

function parseScanResult(result: unknown): [string, string[]] {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error("Unexpected Redis SCAN cleanup response.");
  }
  const [cursor, keys] = result;
  if (typeof cursor !== "string" || !Array.isArray(keys)) {
    throw new Error("Unexpected Redis SCAN cleanup tuple.");
  }
  return [cursor, keys.map(String)];
}
