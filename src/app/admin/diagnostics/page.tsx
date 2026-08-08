import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";

import { AdminDiagnosticsPage } from "@/features/admin/AdminDiagnosticsPage";
import { evaluateAdminAccess } from "@/server/admin/access";
import { loadLiveDiagnostics } from "@/server/admin/diagnostics";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { readOperatorAccountAllowlist } from "@/server/operations/operator-auth";

export default async function AdminDiagnosticsRoute() {
  const headerList = await headers();
  const operatorAccountId = isClerkServerConfigured ? (await auth()).userId : null;
  const access = evaluateAdminAccess({
    configuredToken: process.env.ADMIN_ACCESS_TOKEN,
    operatorAccountId,
    operatorAllowlist: readOperatorAccountAllowlist(),
    suppliedToken: headerList.get("x-admin-token"),
  });

  const snapshot =
    access.allowed && process.env.DATABASE_URL
      ? await loadLiveDiagnostics(getDefaultDatabaseQueryClient())
      : await loadLiveDiagnostics(createDeniedDiagnosticsClient());
  return <AdminDiagnosticsPage access={access} snapshot={snapshot} />;
}

function createDeniedDiagnosticsClient() {
  return {
    async query<T>() {
      return { rows: [] as T[] };
    },
  };
}
