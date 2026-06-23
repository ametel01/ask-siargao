import { headers } from "next/headers";

import { AdminDiagnosticsPage } from "@/features/admin/AdminDiagnosticsPage";
import { evaluateAdminAccess } from "@/server/admin/access";
import { createSampleDiagnosticsSnapshot } from "@/server/admin/diagnostics";

export default async function AdminDiagnosticsRoute() {
  const headerList = await headers();
  const access = evaluateAdminAccess({
    configuredToken: process.env.ADMIN_ACCESS_TOKEN,
    suppliedToken: headerList.get("x-admin-token"),
  });

  return <AdminDiagnosticsPage access={access} snapshot={createSampleDiagnosticsSnapshot()} />;
}
