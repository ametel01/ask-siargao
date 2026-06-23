import { createAuditIntake } from "@/server/audit/intake-service";
import { intakeInputSchema } from "@/server/audit/schemas";
import { trackServerEvent } from "@/server/observability/events";
import { sanitizeIntakeForMetrics } from "@/server/security/privacy";
import { rateLimitRequest, rateLimitedJson } from "@/server/security/rate-limit";

export async function POST(request: Request) {
  const rateLimit = rateLimitRequest(request, "intake");
  if (!rateLimit.allowed) {
    return rateLimitedJson(rateLimit);
  }

  const body: unknown = await request.json();
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
      completenessReasons: result.completeness.blockingReasons,
      intake: sanitizeIntakeForMetrics(parsed.data),
    },
  });

  return Response.json(result, { headers: rateLimit.headers });
}
