import { auth } from "@clerk/nextjs/server";

import { isClerkServerConfigured } from "@/features/auth/clerk-config";
import { ProfileSettingsPage } from "@/features/profile/ProfileSettingsPage";

export default async function ProfilePage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return <ProfileSettingsPage />;
}
