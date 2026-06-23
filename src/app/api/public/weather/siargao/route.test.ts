import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET } from "@/app/api/public/weather/siargao/route";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("public Siargao weather route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
    process.env.DATABASE_URL = "";
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  test("returns a frontend-safe fallback when no database is configured", async () => {
    const response = await GET(new Request("https://siargao.test/api/public/weather/siargao"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.weather.status).toBe("fallback");
    expect(body.weather.sourceProfileId).toBe("source_open_meteo");
    expect(JSON.stringify(body)).not.toContain("rawPayload");
  });
});
