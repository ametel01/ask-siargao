import { auth } from "@clerk/nextjs/server";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { SettingsDashboardPage } from "@/features/settings/SettingsDashboardPage";

export default async function SettingsPage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return <SettingsDashboardPage />;
}
