import { beforeEach, describe, expect, test } from "bun:test";

import { createPublicSiargaoSurfHandler } from "@/app/api/public/surf/siargao/handler";
import type { SurfConditionsSnapshot } from "@/server/public-pages/surf-conditions-snapshot";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

const surfSnapshot: SurfConditionsSnapshot = {
  status: "live",
  locationName: "Cloud 9",
  sourceName: "Open-Meteo weather API + Tide-Forecast Dapa page",
  fetchedAt: "2026-07-01T02:00:00.000Z",
  confidence: "low",
  level: "medium",
  recommendation: "Keep it flexible and confirm at the break before paddling out.",
  summary: "Rain; rain 6mm; gust 35km/h; best daylight window 5:00 AM-8:00 AM",
  metrics: {
    waves: "0.7m swell / 10s",
    tide: "High 4:55AM 1.7m",
    wind: "10km/h",
  },
  weather: {
    status: "live",
    freshness: "fresh",
    condition: "Rain",
    precipitationProbability: 45,
    rainSum: 6,
    windGust: 35,
    windSpeed: 10,
  },
  tide: {
    status: "live",
    stationName: "Dapa tide station",
    nextEvent: "high 4:55AM 1.68m",
    bestWindow: "5:00 AM-8:00 AM: near high tide",
  },
  caveats: [
    "Surf conditions are inferred from Open-Meteo weather and Tide-Forecast Dapa station page data.",
  ],
};

describe("public Siargao surf route", () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  test("returns inferred surf conditions for the requested location", async () => {
    const requests: string[] = [];
    const GET = createPublicSiargaoSurfHandler(async ({ location }) => {
      requests.push(location);
      return { ...surfSnapshot, locationName: location };
    });

    const response = await GET(
      new Request("https://siargao.test/api/public/surf/siargao?location=Cloud%209"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(requests).toEqual(["Cloud 9"]);
    expect(body.requestedLocation).toBe("Cloud 9");
    expect(body.surf.sourceName).toContain("Tide-Forecast Dapa");
    expect(body.surf.metrics.waves).toBe("0.7m swell / 10s");
    expect(body.surf.weather.freshness).toBe("fresh");
  });
});
