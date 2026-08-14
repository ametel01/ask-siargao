import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

import { ClerkProviderBoundary } from "@/features/auth/ClerkProviderBoundary";
import { ProfileSettingsPage } from "@/features/profile/ProfileSettingsPage";
import { isClerkServerConfigured } from "@/server/auth/clerk-deployment-config";
import { buildNoIndexPageMetadata } from "@/server/seo/metadata";

export const metadata: Metadata = buildNoIndexPageMetadata({
  title: "Profile | Ask Siargao",
});

export default async function ProfilePage() {
  if (isClerkServerConfigured) {
    await auth.protect();
  }

  return (
    <ClerkProviderBoundary>
      <ProfileSettingsPage />
    </ClerkProviderBoundary>
  );
}
