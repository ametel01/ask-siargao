import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = await rateLimitRequest(request, "intake");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  return Response.json(
    {
      error: "audit_intake_retired",
      message: "Legacy Trip Risk Audit intake is no longer available.",
    },
    { status: 410, headers: rateLimit.headers },
  );
}
