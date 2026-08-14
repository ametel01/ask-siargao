import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { SettingsDashboardPage } from "@/features/settings/SettingsDashboardPage";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Settings | Ask Siargao",
});

export default async function SettingsPage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return (
    <ClerkProviderBoundary>
      <SettingsDashboardPage />
    </ClerkProviderBoundary>
  );
}
