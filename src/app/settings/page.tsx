import { auth } from "@clerk/nextjs/server";
import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { SettingsDashboardPage } from "@/features/settings/SettingsDashboardPage";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";

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
