import { createAuditIntake } from "@/server/audit/intake-service";
import { intakeInputSchema } from "@/server/audit/schemas";

export async function POST(request: Request) {
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

  return Response.json(createAuditIntake(parsed.data));
}
