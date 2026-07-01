import { parseSiargaoPublicForecastLocation } from "@/server/public-pages/siargao-forecast-location";
import { getSiargaoSurfConditionsSnapshot } from "@/server/public-pages/surf-conditions-snapshot";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

type SurfConditionsProvider = typeof getSiargaoSurfConditionsSnapshot;

export function createPublicSiargaoSurfHandler(
  getSurfConditions: SurfConditionsProvider = getSiargaoSurfConditionsSnapshot,
) {
  return async function GET(request: Request) {
    const rateLimit = rateLimitRequest(request, "public_api");
    if (!rateLimit.allowed) {
      return rateLimitedJson(rateLimit);
    }

    const requestedLocation = parseSiargaoPublicForecastLocation(
      new URL(request.url).searchParams.get("location"),
    );
    const surf = await getSurfConditions({ location: requestedLocation });

    return Response.json(
      { requestedLocation, surf },
      {
        headers: {
          ...rateLimit.headers,
          "cache-control": cacheControlForSurfStatus(surf.status),
        },
      },
    );
  };
}

function cacheControlForSurfStatus(status: Awaited<ReturnType<SurfConditionsProvider>>["status"]) {
  return status === "live" ? "public, max-age=300" : "no-store";
}
