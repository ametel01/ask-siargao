import { createAuditIntake } from "@/server/audit/intake-service";
import { intakeInputSchema } from "@/server/audit/schemas";
import { trackServerEvent } from "@/server/observability/events";
import { sanitizeIntakeForMetrics } from "@/server/security/privacy";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "intake");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400, headers: rateLimit.headers },
    );
  }

  const parsed = intakeInputSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_intake",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const result = createAuditIntake(parsed.data);
  trackServerEvent({
    name: "intake_completed",
    payload: {
      auditRequestStatus: result.auditRequest.status,
      completenessReasons: result.checkoutReadiness.blockingReasons,
      intake: sanitizeIntakeForMetrics(parsed.data),
    },
  });

  return Response.json(result, { headers: rateLimit.headers });
}
