import { AuditStatusPage, parseAuditStatusState } from "@/features/audit-status/AuditStatusPage";

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
