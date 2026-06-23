import { FinalReportPage } from "@/features/report/FinalReportPage";
import { sampleReport } from "@/server/audit/sample-report";

export default function DemoAuditReportRoute() {
  return <FinalReportPage auditRequestId="audit_demo_fixture" report={sampleReport} />;
}
