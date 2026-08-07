import { createClient } from "redis";

import {
  assertSafeIntegrationServiceUrl,
  parseIntegrationEntrypointOptions,
  redactUrl,
  requireServiceUrl,
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
  const harness = createRealRedisHarness(options);
  try {
    await pingRedis(options.redisUrl, options.timeoutMs);
    return await work(harness);
  } finally {
    await harness.cleanup();
  }
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
    requiredText: ["0", "test", "integration", "issue", "local", "ci"],
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
  const keyPrefix = `ask-siargao:${input.namespace}:${process.pid}:${Date.now()}`;
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
        const keys: string[] = [];
        for await (const key of client.scanIterator({
          MATCH: `${keyPrefix}:*`,
          COUNT: 100,
        })) {
          keys.push(String(key));
        }
        for (let index = 0; index < keys.length; index += 100) {
          const batch = keys.slice(index, index + 100);
          if (batch.length > 0) {
            await client.del(batch);
          }
        }
      } finally {
        if (client.isOpen) {
          await client.quit();
        }
      }
    },
  };
}

async function pingRedis(redisUrl: string, timeoutMs: number) {
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
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}
