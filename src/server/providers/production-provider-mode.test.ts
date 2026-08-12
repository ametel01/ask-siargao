import { describe, expect, test } from "bun:test";

import {
  readOpenMeteoApiMode,
  readTideForecastMode,
  requireOpenMeteoApiEnabled,
  requireTideForecastEnabled,
  requireValidForecastProviderDeployment,
} from "@/server/providers/production-provider-mode";

describe("production forecast provider modes", () => {
  test("defaults paid-license-sensitive providers off in production", () => {
    const env = { VERCEL_ENV: "production" };

    expect(requireValidForecastProviderDeployment(env)).toEqual({
      openMeteo: "off",
      tideForecast: "off",
    });
    expect(() => requireOpenMeteoApiEnabled(env)).toThrow("open_meteo_api_disabled");
    expect(() => requireTideForecastEnabled(env)).toThrow("tide_forecast_disabled");
  });

  test("keeps noncommercial sources available in local development and tests", () => {
    expect(readOpenMeteoApiMode({ NODE_ENV: "test" })).toBe("noncommercial");
    expect(readTideForecastMode({ NODE_ENV: "test" })).toBe("development");
    expect(readOpenMeteoApiMode({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(
      "noncommercial",
    );
  });

  test("rejects accidentally enabling development-only sources in production", () => {
    expect(() =>
      readOpenMeteoApiMode({
        OPEN_METEO_API_MODE: "noncommercial",
        VERCEL_ENV: "production",
      }),
    ).toThrow("must be off in production");
    expect(() =>
      readTideForecastMode({
        TIDE_FORECAST_MODE: "development",
        VERCEL_ENV: "production",
      }),
    ).toThrow("must be off in production");
  });

  test("rejects unknown modes", () => {
    expect(() => readOpenMeteoApiMode({ OPEN_METEO_API_MODE: "free" })).toThrow(
      "OPEN_METEO_API_MODE must be one of",
    );
    expect(() => readTideForecastMode({ TIDE_FORECAST_MODE: "licensed" })).toThrow(
      "TIDE_FORECAST_MODE must be one of",
    );
  });
});
