import { describe, expect, test } from "bun:test";

import { liveHealthResponse, readyHealthResponse } from "@/server/operations/health";

describe("health contracts", () => {
  test("reports process liveness without dependency checks", async () => {
    const response = liveHealthResponse();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "live" });
  });

  test("reports ready only when PostgreSQL and Redis probes succeed", async () => {
    const ready = await readyHealthResponse({
      probePostgres: async () => undefined,
      probeRedis: async () => undefined,
    });
    const unavailable = await readyHealthResponse({
      probePostgres: async () => undefined,
      probeRedis: async () => {
        throw new Error("redis unavailable");
      },
    });

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable" });
  });

  test("returns unavailable within the bounded probe timeout", async () => {
    const response = await readyHealthResponse({
      probePostgres: async () => new Promise(() => undefined),
      probeRedis: async () => undefined,
      timeoutMs: 10,
    });
    expect(response.status).toBe(503);
  });
});
