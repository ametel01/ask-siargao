import { getLatestSiargaoWeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export async function GET(request: Request) {
  const rateLimit = rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const weather = await getLatestSiargaoWeatherSnapshot();

  return Response.json(
    { weather },
    {
      headers: {
        ...rateLimit.headers,
        "cache-control": weather.status === "live" ? "public, max-age=300" : "no-store",
      },
    },
  );
}
