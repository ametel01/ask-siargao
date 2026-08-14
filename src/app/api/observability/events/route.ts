import { z } from "zod";

import { getPlanningGuide } from "@/server/guides/planning-guides";
import { trackServerEvent } from "@/server/observability/events";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";
import { tripPassProductCode, tripPassProductVersion } from "@/server/trip-pass/catalog";

export const runtime = "nodejs";

const planningGuideSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((slug) => Boolean(getPlanningGuide(slug)), "Unknown planning guide.");

const clientEventSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("trip_pass_pricing_viewed"),
    surface: z.literal("landing"),
  }),
  z.object({
    guideSlug: planningGuideSlugSchema,
    journeyId: z.uuid(),
    name: z.literal("planning_guide_viewed"),
    surface: z.literal("planning_guide"),
  }),
  z.object({
    action: z.enum(["activity_replacement", "hotel_location", "no_scooter", "weather"]),
    guideSlug: planningGuideSlugSchema,
    journeyId: z.uuid(),
    name: z.literal("planning_guide_reality_check_clicked"),
    surface: z.enum(["header", "panel"]),
  }),
]);

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

  const event =
    parsed.data.name === "trip_pass_pricing_viewed"
      ? trackServerEvent({
          name: parsed.data.name,
          payload: {
            productCode: tripPassProductCode,
            productVersion: tripPassProductVersion,
            status: "viewed",
            surface: parsed.data.surface,
          },
        })
      : trackServerEvent({
          distinctId: `guide:${parsed.data.journeyId}`,
          name: parsed.data.name,
          payload: {
            ...(parsed.data.name === "planning_guide_reality_check_clicked"
              ? { action: parsed.data.action }
              : {}),
            guideSlug: parsed.data.guideSlug,
            status: parsed.data.name === "planning_guide_viewed" ? "viewed" : "clicked",
            surface: parsed.data.surface,
          },
        });

  await event.delivery;

  return Response.json({ status: "accepted" }, { headers: rateLimit.headers });
}
