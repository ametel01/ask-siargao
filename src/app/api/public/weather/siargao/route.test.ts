import { beforeEach, describe, expect, test } from "bun:test";

import { createPublicSiargaoWeatherHandler } from "@/app/api/public/weather/siargao/handler";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

describe("public Siargao weather route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  test("returns a frontend-safe fallback when no database is configured", async () => {
    const GET = createPublicSiargaoWeatherHandler(async () => fallbackWeatherSnapshot);
    const response = await GET(new Request("https://siargao.test/api/public/weather/siargao"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.weather.status).toBe("fallback");
    expect(body.weather.sourceProfileId).toBe("source_open_meteo");
    expect(JSON.stringify(body)).not.toContain("rawPayload");
  });
});
