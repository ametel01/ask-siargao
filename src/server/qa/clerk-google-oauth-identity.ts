export type ClerkGoogleOAuthIdentityCandidate = {
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string | null } | null;
  }>;
  externalAccounts: Array<{
    emailAddress: string;
    provider: string;
    verification: { status: string | null } | null;
  }>;
  id: string;
};

export function requireVerifiedGoogleOAuthIdentity(input: {
  expectedEmail: string;
  totalCount: number;
  users: ClerkGoogleOAuthIdentityCandidate[];
}) {
  if (input.totalCount !== 1 || input.users.length !== 1) {
    throw new Error("The protected Clerk Google identity must resolve to exactly one user.");
  }

  const expectedEmail = input.expectedEmail.trim().toLowerCase();
  const user = input.users[0];
  const email = user.emailAddresses.find(
    (candidate) => candidate.emailAddress.trim().toLowerCase() === expectedEmail,
  );
  if (email?.verification?.status !== "verified") {
    throw new Error("The protected Clerk Google identity email is not verified.");
  }

  const googleAccounts = user.externalAccounts.filter(
    (account) =>
      (account.provider === "google" || account.provider === "oauth_google") &&
      account.emailAddress.trim().toLowerCase() === expectedEmail,
  );
  if (googleAccounts.length !== 1 || googleAccounts[0]?.verification?.status !== "verified") {
    throw new Error("The protected Clerk identity lacks one verified Google external account.");
  }

  return user;
}
