import { AuditStatusPage } from "@/features/audit-status/AuditStatusPage";
import { parseAuditStatusState } from "@/features/audit-status/audit-status-state";

export default async function AuditStatusRoute({
  params,
  searchParams,
}: {
  params: Promise<{ auditRequestId: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const [{ auditRequestId }, query] = await Promise.all([params, searchParams]);

  return (
    <AuditStatusPage auditRequestId={auditRequestId} state={parseAuditStatusState(query.state)} />
  );
}
