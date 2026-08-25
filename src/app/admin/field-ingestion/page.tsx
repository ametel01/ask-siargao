import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { LegacyImportDiagnostics } from "@/features/field-ingestion/LegacyImportDiagnostics";
import {
  canonicalLegacyImportRoute,
  legacyImportAliasMode,
} from "@/features/field-ingestion/legacy-import-routing";
import { FieldSecuritySessionProvider } from "@/features/field-security/FieldSecuritySessionProvider";
import { FieldWorkspaceNavigation } from "@/features/field-workspace/FieldWorkspaceNavigation";
import { isProtectedUiHarnessRequest } from "@/server/auth/protected-ui-harness";
import { readFieldResearcherAccountAllowlist } from "@/server/field-security/authorization";

export default async function LegacyFieldImportAlias() {
  if (legacyImportAliasMode(process.env.FIELD_LEGACY_IMPORT_ALIAS_MODE) === "redirect") {
    redirect(canonicalLegacyImportRoute);
  }

  const requestHeaders = await headers();
  const harness = isProtectedUiHarnessRequest({ headers: requestHeaders });
  if (!harness) {
    const snapshot = await auth();
    if (!snapshot.userId || !readFieldResearcherAccountAllowlist().has(snapshot.userId)) notFound();
  }
  return (
    <FieldSecuritySessionProvider>
      <FieldWorkspaceNavigation />
      <main id="main-content">
        <LegacyImportDiagnostics harness={harness} rollbackAlias />
      </main>
    </FieldSecuritySessionProvider>
  );
}
