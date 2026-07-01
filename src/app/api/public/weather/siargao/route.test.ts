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

  test("passes requested known locations to the forecast provider", async () => {
    const requestedLocations: string[] = [];
    const GET = createPublicSiargaoWeatherHandler(async (options) => {
      if (options?.location) {
        requestedLocations.push(options.location.id);
      }
      return fallbackWeatherSnapshot;
    });

    const response = await GET(
      new Request("https://siargao.test/api/public/weather/siargao?location=Del%20Carmen"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requestedLocation).toBe("Del Carmen");
    expect(requestedLocations).toEqual(["siargao_del_carmen"]);
  });
});
