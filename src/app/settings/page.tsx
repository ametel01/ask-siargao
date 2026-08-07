import { auth } from "@clerk/nextjs/server";
import { SettingsDashboardPage } from "@/features/settings/SettingsDashboardPage";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";

export default async function SettingsPage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return <SettingsDashboardPage />;
}
