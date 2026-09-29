import type { PlannerProtocol } from "@/features/field-planning/field-planning-types";
import {
  assertReadinessHandoff,
  parsePreseededPlannerReadiness,
} from "@/features/field-planning/planner-readiness-vault";
import type { FieldResearcherAuthSnapshot } from "@/server/field-security/authorization";
import { authorizeFieldRequest, fieldJson } from "@/server/field-security/http";

export type FieldPlanningHandoffRouteDependencies = {
  allowlist: ReadonlySet<string>;
  auth: () => Promise<FieldResearcherAuthSnapshot>;
  initialHandoff: () => string | undefined;
  protocol: PlannerProtocol;
};

export async function getFieldPlanningHandoffResponse(
  request: Request,
  dependencies: FieldPlanningHandoffRouteDependencies,
): Promise<Response> {
  const authorization = authorizeFieldRequest({
    allowlist: dependencies.allowlist,
    auth: await dependencies.auth(),
    mutation: false,
    request,
  });
  if (authorization instanceof Response) return authorization;

  const configured = dependencies.initialHandoff();
  if (!configured) return fieldJson({ error: "field_planning_handoff_unconfigured" }, 404);

  try {
    const handoff = parsePreseededPlannerReadiness(configured, dependencies.protocol);
    if (!handoff) return fieldJson({ error: "field_planning_handoff_unconfigured" }, 404);
    assertReadinessHandoff(handoff, dependencies.protocol);
    return fieldJson({ handoff });
  } catch {
    return fieldJson({ error: "field_planning_handoff_invalid" }, 503);
  }
}
