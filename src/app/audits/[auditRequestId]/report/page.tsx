import { FinalReportPage } from "@/features/report/FinalReportPage";
import { sampleReport } from "@/server/audit/sample-report";

export default async function AuditReportRoute({
  params,
}: {
  params: Promise<{ auditRequestId: string }>;
}) {
  const { auditRequestId } = await params;

  return <FinalReportPage auditRequestId={auditRequestId} report={sampleReport} />;
}
