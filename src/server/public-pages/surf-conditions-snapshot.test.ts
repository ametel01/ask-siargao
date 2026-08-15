import { describe, expect, test } from "bun:test";

import { getSiargaoSurfConditionsSnapshot } from "@/server/public-pages/surf-conditions-snapshot";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

describe("public surf conditions snapshot", () => {
  test("combines MET Norway wind with PacIOOS modeled tide without inventing waves", async () => {
    const now = new Date("2026-08-15T02:00:00Z");
    const tideTimestamp = Math.floor(new Date("2026-08-15T04:00:00Z").getTime() / 1000);
    const snapshot = await getSiargaoSurfConditionsSnapshot({
      location: "Cloud 9",
      dependencies: {
        now,
        getWeatherSnapshot: async () => ({
          ...fallbackWeatherSnapshot,
          status: "live",
          sourceName: "MET Norway Locationforecast",
          sourceProfileId: "source_met_norway",
          fetchedAt: now.toISOString(),
          expiresAt: "2026-08-15T03:00:00.000Z",
          freshness: "fresh",
          citationUrl: "https://api.met.no/weatherapi/locationforecast/2.0/compact",
          today: {
            ...fallbackWeatherSnapshot.today,
            date: "2026-08-15",
            condition: "Rain showers",
            precipitationSum: 0.7,
            rainSum: 0.7,
            windSpeed: 16.6,
            windGust: null,
          },
        }),
        buildTideSnapshot: async (input) => ({
          status: "live",
          sourceName: "NOAA/PacIOOS Pacific tide model",
          sourceProfileId: "source_pacioos_tide",
          stationName: "PacIOOS Pacific tide grid (10°N, 126°E)",
          stationUrl: "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/tide_pac",
          stationLatitude: 10,
          stationLongitude: 126,
          requestedLocation: input.requestedLocation,
          proxyFor: "Siargao planning",
          fetchedAt: now.toISOString(),
          serverTime: null,
          forecastUpdatedAt: null,
          dateRange: input.dateRange,
          targetDates: ["2026-08-15"],
          days: [
            {
              date: "2026-08-15",
              sunriseTimestamp: null,
              sunsetTimestamp: null,
              tides: [
                {
                  timestamp: tideTimestamp,
                  time: "12:00 PM",
                  heightMeters: 0.88,
                  type: "high",
                },
              ],
            },
          ],
          seaPeriods: [],
          recommendedWindows: [],
          caveats: [
            "The nearest model point is on a coarse 2-degree grid.",
            "This is not a safety clearance.",
          ],
        }),
      },
    });

    expect(snapshot.status).toBe("live");
    expect(snapshot.sourceName).toBe(
      "MET Norway Locationforecast + NOAA/PacIOOS Pacific tide model",
    );
    expect(snapshot.metrics).toEqual({
      waves: "Unavailable",
      tide: "High 12:00 PM 0.9m",
      wind: "16.6km/h",
    });
    expect(snapshot.weather.windSpeed).toBe(16.6);
    expect(snapshot.caveats.join(" ")).toContain("coarse 2-degree grid");
    expect(snapshot.caveats.join(" ")).toContain("not a safety clearance");
  });
});
