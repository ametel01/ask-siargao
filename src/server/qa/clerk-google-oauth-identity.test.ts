import { describe, expect, test } from "bun:test";

import {
  type ClerkGoogleOAuthIdentityCandidate,
  requireVerifiedGoogleOAuthIdentity,
} from "@/server/qa/clerk-google-oauth-identity";

const verifiedUser: ClerkGoogleOAuthIdentityCandidate = {
  emailAddresses: [
    {
      emailAddress: "oauth@example.test",
      verification: { status: "verified" },
    },
  ],
  externalAccounts: [
    {
      emailAddress: "oauth@example.test",
      provider: "oauth_google",
      verification: { status: "verified" },
    },
  ],
  id: "user_google",
};

describe("protected Clerk Google OAuth identity", () => {
  test("accepts exactly one verified Google-linked identity", () => {
    expect(
      requireVerifiedGoogleOAuthIdentity({
        expectedEmail: "OAUTH@example.test",
        totalCount: 1,
        users: [verifiedUser],
      }).id,
    ).toBe("user_google");

    expect(
      requireVerifiedGoogleOAuthIdentity({
        expectedEmail: "oauth@example.test",
        totalCount: 1,
        users: [
          {
            ...verifiedUser,
            externalAccounts: [{ ...verifiedUser.externalAccounts[0], provider: "google" }],
          },
        ],
      }).id,
    ).toBe("user_google");
  });

  test("denies ambiguous, unverified, non-Google, and mismatched identities", () => {
    const cases = [
      { totalCount: 2, users: [verifiedUser] },
      {
        totalCount: 1,
        users: [
          {
            ...verifiedUser,
            emailAddresses: [
              { emailAddress: "oauth@example.test", verification: { status: "unverified" } },
            ],
          },
        ],
      },
      {
        totalCount: 1,
        users: [
          {
            ...verifiedUser,
            externalAccounts: [
              {
                emailAddress: "oauth@example.test",
                provider: "github",
                verification: { status: "verified" },
              },
            ],
          },
        ],
      },
      {
        totalCount: 1,
        users: [
          {
            ...verifiedUser,
            externalAccounts: [
              {
                emailAddress: "different@example.test",
                provider: "google",
                verification: { status: "verified" },
              },
            ],
          },
        ],
      },
    ];

    for (const candidate of cases) {
      expect(() =>
        requireVerifiedGoogleOAuthIdentity({
          expectedEmail: "oauth@example.test",
          ...candidate,
        }),
      ).toThrow();
    }
  });
});
