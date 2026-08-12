import { describe, expect, test } from "bun:test";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { authorizeVercelCron, runWeatherCron } from "@/server/operations/vercel-cron";

describe("authenticated Vercel Cron adapters", () => {
  test("returns a no-op without touching the database when forecasts are disabled", async () => {
    const db: DatabaseQueryClient = {
      async query() {
        throw new Error("database must not be touched");
      },
    };

    await expect(runWeatherCron("weather", db, { VERCEL_ENV: "production" })).resolves.toEqual({
      kind: "weather",
      status: "disabled",
    });
  });

  test("uses the selected environment for the ingestion provider guard", async () => {
    const db: DatabaseQueryClient = {
      async query() {
        throw new Error("database must not be touched");
      },
    };

    await expect(
      runWeatherCron("weather", db, {
        APP_ENV: "production",
        OPEN_METEO_API_MODE: "noncommercial",
      }),
    ).rejects.toThrow("OPEN_METEO_API_MODE must be off in production");
  });

  test("requires the exact bearer secret", () => {
    const request = (authorization?: string) =>
      new Request("https://siargao.test/api/cron/operations", {
        headers: authorization ? { authorization } : {},
      });

    expect(authorizeVercelCron(request(), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer wrong-secret"), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), "cron-secret-value")).toBe(
      true,
    );
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), undefined)).toBe(false);
  });
});
