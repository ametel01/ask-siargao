type ProviderEnvironment = Record<string, string | undefined>;

export type OpenMeteoApiMode = "noncommercial" | "off";
export type TideForecastMode = "development" | "off";

export function readOpenMeteoApiMode(env: ProviderEnvironment = process.env): OpenMeteoApiMode {
  const rawMode = env.OPEN_METEO_API_MODE?.trim().toLowerCase();
  if (rawMode && rawMode !== "noncommercial" && rawMode !== "off") {
    throw new Error("OPEN_METEO_API_MODE must be one of: off, noncommercial.");
  }
  const mode =
    (rawMode as OpenMeteoApiMode | undefined) ??
    (isProductionProviderEnvironment(env) ? "off" : "noncommercial");
  if (isProductionProviderEnvironment(env) && mode !== "off") {
    throw new Error(
      "OPEN_METEO_API_MODE must be off in production until a commercial API adapter is configured.",
    );
  }
  return mode;
}

export function readTideForecastMode(env: ProviderEnvironment = process.env): TideForecastMode {
  const rawMode = env.TIDE_FORECAST_MODE?.trim().toLowerCase();
  if (rawMode && rawMode !== "development" && rawMode !== "off") {
    throw new Error("TIDE_FORECAST_MODE must be one of: off, development.");
  }
  const mode =
    (rawMode as TideForecastMode | undefined) ??
    (isProductionProviderEnvironment(env) ? "off" : "development");
  if (isProductionProviderEnvironment(env) && mode !== "off") {
    throw new Error(
      "TIDE_FORECAST_MODE must be off in production until a commercial license and adapter are configured.",
    );
  }
  return mode;
}

export function requireValidForecastProviderDeployment(env: ProviderEnvironment = process.env) {
  return {
    openMeteo: readOpenMeteoApiMode(env),
    tideForecast: readTideForecastMode(env),
  };
}

export function requireOpenMeteoApiEnabled(env: ProviderEnvironment = process.env) {
  if (readOpenMeteoApiMode(env) === "off") {
    throw new Error("open_meteo_api_disabled");
  }
}

export function requireTideForecastEnabled(env: ProviderEnvironment = process.env) {
  if (readTideForecastMode(env) === "off") {
    throw new Error("tide_forecast_disabled");
  }
}

export function isProductionProviderEnvironment(env: ProviderEnvironment = process.env) {
  if (env.VERCEL_ENV) {
    return env.VERCEL_ENV === "production";
  }
  if (env.APP_ENV) {
    return env.APP_ENV === "production";
  }
  return env.NODE_ENV === "production";
}
