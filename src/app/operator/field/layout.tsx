import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { readFieldResearcherAccountAllowlist } from "@/server/field-security/authorization";
import { isFieldSecurityProductionHarnessRequest } from "@/server/field-security/test-harness";

export const metadata: Metadata = {
  manifest: "/operator/field/manifest.webmanifest",
  robots: { follow: false, index: false },
  title: "Field Workspace · Ask Siargao",
};

export default async function FieldWorkspaceLayout(props: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const harness = isFieldSecurityProductionHarnessRequest({
    headers: requestHeaders,
    pathname: requestHeaders.get("x-invoke-path") ?? "/operator/field",
  });
  if (harness) return props.children;

  const snapshot = await auth();
  if (!snapshot.userId || !readFieldResearcherAccountAllowlist().has(snapshot.userId)) {
    notFound();
  }
  return props.children;
}
