import { auth } from "@clerk/nextjs/server";
import { ProfileSettingsPage } from "@/features/profile/ProfileSettingsPage";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";

export default async function ProfilePage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return <ProfileSettingsPage />;
}
