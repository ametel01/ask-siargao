import { z } from "zod";

import { trackServerEvent } from "@/server/observability/events";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";

export const runtime = "nodejs";

const clientEventSchema = z.object({
  name: z.literal("trip_pass_pricing_viewed"),
  surface: z.literal("landing"),
});

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "public_api");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: rateLimit.headers });
  }

  const parsed = clientEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_analytics_event" },
      { status: 400, headers: rateLimit.headers },
    );
  }

  trackServerEvent({
    name: parsed.data.name,
    payload: {
      productCode: tripPassProductCode,
      productVersion: tripPassProductVersion,
      status: "viewed",
      surface: parsed.data.surface,
    },
  });

  return Response.json({ status: "accepted" }, { headers: rateLimit.headers });
}
