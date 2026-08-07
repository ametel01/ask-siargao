import { createClient } from "redis";

export type RedisCommandClient = {
  close(): Promise<void>;
  decrby(key: string, amount: number): Promise<number>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  incrby(key: string, amount: number): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  send(command: string, args: string[]): Promise<unknown>;
  set(key: string, value: string, condition?: "NX"): Promise<unknown>;
};

type NodeRedisCommandClient = {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  decrBy(key: string, amount: number): Promise<number>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  incrBy(key: string, amount: number): Promise<number>;
  on(event: "error", listener: (error: Error) => void): unknown;
  pExpire(key: string, milliseconds: number): Promise<unknown>;
  pTTL(key: string): Promise<number>;
  sendCommand(command: readonly string[]): Promise<unknown>;
  set(key: string, value: string, options?: { NX: true }): Promise<unknown>;
  quit(): Promise<unknown>;
};

type RedisClientFactory = (url: string) => NodeRedisCommandClient;

const clientsByUrl = new Map<string, RedisCommandClient>();

export function getRedisCommandClient(redisUrl: string | undefined) {
  const url = redisUrl?.trim();
  if (!url) {
    throw new Error("REDIS_URL is required for the shared quota store.");
  }

  const existing = clientsByUrl.get(url);
  if (existing) {
    return existing;
  }

  const client = createRedisCommandClient({ url });
  clientsByUrl.set(url, client);
  return client;
}

export function createRedisCommandClient(input: {
  createClient?: RedisClientFactory;
  url: string;
}): RedisCommandClient {
  const redisClient = (input.createClient ?? defaultRedisClientFactory)(input.url);
  let connectPromise: Promise<void> | null = null;

  // Node Redis requires an error listener. Command failures still reject their own promises.
  redisClient.on("error", () => undefined);

  async function connectedClient() {
    if (!redisClient.isOpen) {
      connectPromise ??= redisClient.connect().then(() => undefined);
      try {
        await connectPromise;
      } finally {
        connectPromise = null;
      }
    }
    return redisClient;
  }

  return {
    async close() {
      if (redisClient.isOpen) {
        await redisClient.quit();
      }
    },
    async decrby(key, amount) {
      return (await connectedClient()).decrBy(key, amount);
    },
    async get(key) {
      return (await connectedClient()).get(key);
    },
    async incr(key) {
      return (await connectedClient()).incr(key);
    },
    async incrby(key, amount) {
      return (await connectedClient()).incrBy(key, amount);
    },
    async pexpire(key, milliseconds) {
      return (await connectedClient()).pExpire(key, milliseconds);
    },
    async pttl(key) {
      return (await connectedClient()).pTTL(key);
    },
    async send(command, args) {
      return (await connectedClient()).sendCommand([command, ...args]);
    },
    async set(key, value, condition) {
      const client = await connectedClient();
      return condition === "NX" ? client.set(key, value, { NX: true }) : client.set(key, value);
    },
  };
}

function defaultRedisClientFactory(url: string): NodeRedisCommandClient {
  return createClient({
    url,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: false,
    },
  });
}
