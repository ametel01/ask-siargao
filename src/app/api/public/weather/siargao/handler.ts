import { getLatestSiargaoWeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

type WeatherSnapshotProvider = typeof getLatestSiargaoWeatherSnapshot;

export function createPublicSiargaoWeatherHandler(
  getWeatherSnapshot: WeatherSnapshotProvider = getLatestSiargaoWeatherSnapshot,
) {
  return async function GET(request: Request) {
    const rateLimit = rateLimitRequest(request, "public_api");
    if (!rateLimit.allowed) {
      return rateLimitedJson(rateLimit);
    }

    const weather = await getWeatherSnapshot();

    return Response.json(
      { weather },
      {
        headers: {
          ...rateLimit.headers,
          "cache-control": weather.status === "live" ? "public, max-age=300" : "no-store",
        },
      },
    );
  };
}
