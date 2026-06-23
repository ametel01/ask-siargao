import { FinalReportPage } from "@/features/report/FinalReportPage";
import { sampleReport } from "@/server/audit/sample-report";
import { checkRateLimit } from "@/server/security/rate-limit";

export default async function AuditReportRoute({
  params,
}: {
  params: Promise<{ auditRequestId: string }>;
}) {
  const { auditRequestId } = await params;
  const rateLimit = checkRateLimit({ key: auditRequestId, policy: "report_access" });

  if (!rateLimit.allowed) {
    throw new Error("Report access rate limit exceeded.");
  }

  return <FinalReportPage auditRequestId={auditRequestId} report={sampleReport} />;
}
