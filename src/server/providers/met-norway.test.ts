import { describe, expect, test } from "bun:test";

import { buildMetNorwayForecastUrl, fetchMetNorwayForecast } from "@/server/providers/met-norway";

const fixture = {
  properties: {
    meta: {
      updated_at: "2026-08-15T01:17:04Z",
      units: {
        precipitation_amount: "mm",
        wind_speed: "m/s",
      },
    },
    timeseries: [
      forecastPeriod("2026-08-14T16:00:00Z", "clearsky_night", 0, 2),
      forecastPeriod("2026-08-15T00:00:00Z", "lightrainshowers_day", 0.8, 3.2),
      forecastPeriod("2026-08-15T01:00:00Z", "rainshowers_day", 1.4, 4.5),
      forecastPeriod("2026-08-15T15:00:00Z", "partlycloudy_night", 0.2, 2.8),
      forecastPeriod("2026-08-16T00:00:00Z", "fair_day", 0, 5.1),
      sixHourForecastPeriod("2026-08-17T00:00:00Z", "heavyrain_day", 8.5, 4.2),
    ],
  },
  type: "Feature",
};

describe("MET Norway weather provider", () => {
  test("builds the global Locationforecast URL for Siargao", () => {
    expect(buildMetNorwayForecastUrl({ latitude: 9.784, longitude: 126.158 })).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=9.784&lon=126.158",
    );
  });

  test("normalizes Manila-local rain, wind, condition, and attribution", async () => {
    let requestHeaders: Headers | undefined;
    const result = await fetchMetNorwayForecast({
      fetchedAt: new Date("2026-08-15T02:00:00Z"),
      fetcher: async (_url, init) => {
        requestHeaders = new Headers(init?.headers);
        return Response.json(fixture);
      },
      location: {
        id: "siargao_general_luna",
        latitude: 9.784,
        longitude: 126.158,
        name: "Siargao forecast near General Luna",
      },
    });

    expect(requestHeaders?.get("user-agent")).toContain("AskSiargao");
    expect(result).toMatchObject({
      sourceName: "MET Norway Locationforecast",
      sourceProfileId: "source_met_norway",
      locationName: "Siargao forecast near General Luna",
      updatedAt: "2026-08-15T01:17:04.000Z",
      today: {
        date: "2026-08-15",
        condition: "Rain showers",
        precipitationAmount: 2.4,
        windSpeedKmh: 16.2,
      },
      maxDailyRain: { date: "2026-08-17", value: 8.5 },
      maxWindSpeed: { date: "2026-08-16", value: 18.4 },
    });
    expect(result.citationUrl).toContain("api.met.no");
    expect(result.attribution).toContain("Norwegian Meteorological Institute");
  });

  test("rejects malformed upstream payloads", async () => {
    await expect(
      fetchMetNorwayForecast({
        fetcher: async () => Response.json({ properties: { timeseries: [] } }),
      }),
    ).rejects.toThrow("MET Norway");
  });
});

function forecastPeriod(
  time: string,
  symbolCode: string,
  precipitationAmount: number,
  windSpeed: number,
) {
  return {
    time,
    data: {
      instant: { details: { wind_speed: windSpeed } },
      next_1_hours: {
        details: { precipitation_amount: precipitationAmount },
        summary: { symbol_code: symbolCode },
      },
    },
  };
}

function sixHourForecastPeriod(
  time: string,
  symbolCode: string,
  precipitationAmount: number,
  windSpeed: number,
) {
  return {
    time,
    data: {
      instant: { details: { wind_speed: windSpeed } },
      next_6_hours: {
        details: { precipitation_amount: precipitationAmount },
        summary: { symbol_code: symbolCode },
      },
    },
  };
}
