import { travelerEmailFromStoredEmail } from "@/lib/traveler-identity";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";

export type AccountIdentityPresentation = {
  name: string;
  email: string | null;
  emailLabel: "Email" | "Email unavailable";
  status: "Signed in";
};

export function accountIdentityFromProfile(
  profile: Pick<UserProfileResponse, "identity" | "profile">,
): AccountIdentityPresentation {
  const displayName = cleanIdentityPart(profile.profile.displayName);
  const firstName = cleanIdentityPart(profile.identity.firstName);
  const lastName = cleanIdentityPart(profile.identity.lastName);
  const providerName = [firstName, lastName].filter(Boolean).join(" ");
  const email = travelerEmailFromStoredEmail(profile.identity.email);

  return {
    name: displayName || providerName || "Signed-in account",
    email,
    emailLabel: email ? "Email" : "Email unavailable",
    status: "Signed in",
  };
}

function cleanIdentityPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, " ") ?? "";
}
