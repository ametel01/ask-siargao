import { auth } from "@clerk/nextjs/server";

import { getFieldPlanningHandoffResponse } from "@/app/api/operator/field/planning/handoff/planning-handoff-route";
import { loadPlannerProtocol } from "@/features/field-planning/load-planner-protocol";
import { readFieldResearcherAccountAllowlist } from "@/server/field-security/authorization";

export async function GET(request: Request) {
  const snapshot = await auth();
  const protocol = await loadPlannerProtocol();
  return getFieldPlanningHandoffResponse(request, {
    allowlist: readFieldResearcherAccountAllowlist(),
    auth: async () => ({ accountId: snapshot.userId, mfaFresh: false }),
    initialHandoff: () => process.env.FIELD_PLANNER_INITIAL_HANDOFF_JSON,
    protocol,
  });
}
