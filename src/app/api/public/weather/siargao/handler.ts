import {
  openMeteoLocationForPublicLabel,
  parseSiargaoPublicForecastLocation,
} from "@/server/public-pages/siargao-forecast-location";
import { getLatestSiargaoWeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

type WeatherSnapshotProvider = typeof getLatestSiargaoWeatherSnapshot;

export function createPublicSiargaoWeatherHandler(
  getWeatherSnapshot: WeatherSnapshotProvider = getLatestSiargaoWeatherSnapshot,
) {
  return async function GET(request: Request) {
    const rateLimit = await rateLimitRequest(request, "public_api");
    if (!rateLimit.allowed) {
      return rateLimitedJson(rateLimit);
    }

    const requestedLocation = parseSiargaoPublicForecastLocation(
      new URL(request.url).searchParams.get("location"),
    );
    const providerLocation = openMeteoLocationForPublicLabel(requestedLocation);
    const weather = await getWeatherSnapshot(
      providerLocation ? { location: providerLocation } : {},
    );

    return Response.json(
      { requestedLocation, weather },
      {
        headers: {
          ...rateLimit.headers,
          "cache-control": weather.status === "live" ? "public, max-age=300" : "no-store",
        },
      },
    );
  };
}
