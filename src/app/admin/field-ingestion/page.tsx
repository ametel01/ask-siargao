import { auth } from "@clerk/nextjs/server";
import { Lock } from "lucide-react";
import { headers } from "next/headers";

import { FieldIngestionDashboard } from "@/features/field-ingestion/FieldIngestionDashboard";
import { evaluateAdminAccess } from "@/server/admin/access";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { readOperatorAccountAllowlist } from "@/server/operations/operator-auth";
import {
  AppBackdrop,
  appBodyClass,
  appPanelClass,
  appShellClass,
  SectionHeading,
} from "@/ui/components/ask-siargao";

export default async function FieldIngestionRoute() {
  const headerList = await headers();
  const operatorAccountId = isClerkServerConfigured ? (await auth()).userId : null;
  const access = evaluateAdminAccess({
    configuredToken: process.env.ADMIN_ACCESS_TOKEN,
    operatorAccountId,
    operatorAllowlist: readOperatorAccountAllowlist(),
    suppliedToken: headerList.get("x-admin-token"),
  });

  if (!access.allowed) {
    return (
      <AppBackdrop>
        <section className={appShellClass}>
          <div className={appPanelClass}>
            <SectionHeading icon={Lock} title="Admin access required" />
            <p className={appBodyClass}>
              The field desk is environment gated. Sign in with an allowlisted Operator Account in
              production or use the configured local admin token.
            </p>
          </div>
        </section>
      </AppBackdrop>
    );
  }

  return <FieldIngestionDashboard accessMode={access.mode} />;
}
