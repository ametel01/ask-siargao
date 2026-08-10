import { describe, expect, test } from "bun:test";

import { createRedisCommandClient } from "@/server/security/redis-command-client";

describe("Node Redis quota command adapter", () => {
  test("connects lazily once and translates quota commands to the Node client API", async () => {
    const fake = createFakeNodeRedisClient();
    const client = createRedisCommandClient({
      url: "redis://redis.example.test:6379",
      createClient(url) {
        expect(url).toBe("redis://redis.example.test:6379");
        return fake.client;
      },
    });

    expect(fake.connectCalls).toBe(0);
    expect(await client.incr("quota:fixed-window")).toBe(1);
    expect(await client.incrby("quota:budget", 3)).toBe(3);
    expect(await client.decrby("quota:budget", 2)).toBe(1);
    expect(await client.set("quota:idempotency", "hash", "NX")).toBe("OK");
    expect(await client.send("EVAL", ["return ARGV[1]", "0", "ready"])).toEqual([
      "reserved",
      1,
      60_000,
    ]);

    expect(fake.connectCalls).toBe(1);
    expect(fake.commands).toEqual([
      ["incr", "quota:fixed-window"],
      ["incrBy", "quota:budget", 3],
      ["decrBy", "quota:budget", 2],
      ["set", "quota:idempotency", "hash", { NX: true }],
      ["sendCommand", ["EVAL", "return ARGV[1]", "0", "ready"]],
    ]);
    expect(fake.errorListenerRegistered).toBe(true);
    await client.close();
    expect(fake.quitCalls).toBe(1);
  });

  test("retries a later command after an initial connection failure", async () => {
    const fake = createFakeNodeRedisClient({ failedConnects: 1 });
    const client = createRedisCommandClient({
      url: "redis://redis.example.test:6379",
      createClient: () => fake.client,
    });

    await expect(client.incr("quota:first-attempt")).rejects.toThrow("Redis unavailable");
    expect(await client.incr("quota:retry")).toBe(1);
    expect(fake.connectCalls).toBe(2);
    await client.close();
  });

  test("requires rediss in production and accepts it", () => {
    const fake = createFakeNodeRedisClient();
    expect(() =>
      createRedisCommandClient({
        url: "redis://redis.example.test:6379",
        env: { NODE_ENV: "production" },
        createClient: () => fake.client,
      }),
    ).toThrow("REDIS_URL must use rediss:// in production");

    expect(() =>
      createRedisCommandClient({
        url: "rediss://redis.example.test:6380",
        env: { NODE_ENV: "production" },
        createClient: () => fake.client,
      }),
    ).not.toThrow();

    expect(() =>
      createRedisCommandClient({
        url: "redis://redis.example.test:6379",
        env: { APP_ENV: "production" },
        createClient: () => fake.client,
      }),
    ).toThrow("REDIS_URL must use rediss:// in production");
  });
});

function createFakeNodeRedisClient(input: { failedConnects?: number } = {}) {
  const state = {
    commands: [] as unknown[][],
    connectCalls: 0,
    errorListenerRegistered: false,
    isOpen: false,
    quitCalls: 0,
  };

  const client = {
    async connect() {
      state.connectCalls += 1;
      if (state.connectCalls <= (input.failedConnects ?? 0)) {
        throw new Error("Redis unavailable");
      }
      state.isOpen = true;
      return client;
    },
    async decrBy(key: string, amount: number) {
      state.commands.push(["decrBy", key, amount]);
      return 1;
    },
    async get() {
      return null;
    },
    async incr(key: string) {
      state.commands.push(["incr", key]);
      return 1;
    },
    async incrBy(key: string, amount: number) {
      state.commands.push(["incrBy", key, amount]);
      return amount;
    },
    get isOpen() {
      return state.isOpen;
    },
    on(event: string) {
      state.errorListenerRegistered ||= event === "error";
      return client;
    },
    async pExpire() {
      return 1;
    },
    async pTTL() {
      return 60_000;
    },
    async sendCommand(command: readonly string[]) {
      state.commands.push(["sendCommand", command]);
      return ["reserved", 1, 60_000];
    },
    async set(key: string, value: string, options?: { NX: true }) {
      state.commands.push(["set", key, value, ...(options ? [options] : [])]);
      return "OK";
    },
    async quit() {
      state.quitCalls += 1;
      state.isOpen = false;
      return "OK";
    },
  };

  return {
    client,
    get commands() {
      return state.commands;
    },
    get connectCalls() {
      return state.connectCalls;
    },
    get errorListenerRegistered() {
      return state.errorListenerRegistered;
    },
    get quitCalls() {
      return state.quitCalls;
    },
  };
}
