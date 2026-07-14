import { getReportAccess } from "@/server/audit/report-access";
import { checkRateLimit } from "@/server/security/rate-limit";

export type AuditReportRouteDependencies = {
  getReportAccess: typeof getReportAccess;
};

const defaultDependencies: AuditReportRouteDependencies = {
  getReportAccess,
};

export async function resolveAuditReportRoute(
  input: {
    auditRequestId: string;
    token?: string;
  },
  dependencies: AuditReportRouteDependencies = defaultDependencies,
) {
  const rateLimit = await checkRateLimit({ key: input.auditRequestId, policy: "report_access" });

  if (!rateLimit.allowed) {
    return { status: "rate_limited" as const };
  }

  const access = await dependencies.getReportAccess({
    auditRequestId: input.auditRequestId,
    token: input.token,
  });

  if (access.status !== "authorized") {
    return { status: "not_found" as const, accessStatus: access.status };
  }

  return {
    status: "authorized" as const,
    report: access.report,
  };
}
