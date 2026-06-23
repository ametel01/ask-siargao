import { notFound } from "next/navigation";

import { resolveAuditReportRoute } from "@/app/audits/report-route";
import { FinalReportPage } from "@/features/report/FinalReportPage";

export default async function AuditReportRoute({
  params,
  searchParams,
}: {
  params: Promise<{ auditRequestId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ auditRequestId }, query] = await Promise.all([params, searchParams]);
  const result = await resolveAuditReportRoute({
    auditRequestId,
    token: firstQueryValue(query?.token),
  });

  if (result.status === "rate_limited") {
    throw new Error("Report access rate limit exceeded.");
  }
  if (result.status !== "authorized") {
    notFound();
  }

  return <FinalReportPage auditRequestId={auditRequestId} report={result.report} />;
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
