import { describe, expect, test } from "bun:test";

import { accountIdentityFromProfile } from "@/features/settings/account-identity";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";

describe("settings account identity presentation", () => {
  test.each([
    {
      name: "editable display name wins",
      profile: profileResponse({
        displayName: "  Alex in Siargao  ",
        firstName: "Clerk",
        lastName: "Traveler",
      }),
      expectedName: "Alex in Siargao",
    },
    {
      name: "authoritative first and last name fill in",
      profile: profileResponse({ displayName: " ", firstName: "  Alex  ", lastName: " Traveler" }),
      expectedName: "Alex Traveler",
    },
    {
      name: "partial first name is usable",
      profile: profileResponse({ firstName: "Alex", lastName: " " }),
      expectedName: "Alex",
    },
    {
      name: "partial last name is usable",
      profile: profileResponse({ firstName: " ", lastName: "Traveler" }),
      expectedName: "Traveler",
    },
    {
      name: "neutral fallback never uses provider id",
      profile: profileResponse({ firstName: " ", lastName: null }),
      expectedName: "Signed-in account",
    },
  ])("$name", ({ profile, expectedName }) => {
    expect(accountIdentityFromProfile(profile).name).toBe(expectedName);
  });

  test.each([
    ["usable email", "traveler@example.com", "traveler@example.com", "Email"],
    ["missing email", null, null, "Email unavailable"],
    [
      "active internal fallback",
      "unavailable+user_hidden@clerk.ask-siargao.local",
      null,
      "Email unavailable",
    ],
    [
      "deleted internal fallback",
      "deleted+user_hidden@clerk.ask-siargao.local",
      null,
      "Email unavailable",
    ],
  ] as const)("presents %s safely", (_caseName, email, expectedEmail, expectedLabel) => {
    expect(accountIdentityFromProfile(profileResponse({ email }))).toMatchObject({
      email: expectedEmail,
      emailLabel: expectedLabel,
    });
  });

  test("keeps long Unicode identity values intact for accessible rendering", () => {
    const longName = "  María-Luisa Ngọc Nguyễn Siargao ".repeat(5);
    const longEmail = "maría-luisa.ngọc.nguyễn.surf-planning@example.travel";

    expect(
      accountIdentityFromProfile(profileResponse({ displayName: longName, email: longEmail })),
    ).toMatchObject({
      name: longName.trim().replace(/\s+/gu, " "),
      email: longEmail,
    });
  });

  test("does not put provider identifiers or provider brands in presentation output", () => {
    const presentation = accountIdentityFromProfile(
      profileResponse({
        displayName: " ",
        firstName: " ",
        lastName: " ",
        email: "unavailable+user_secret@clerk.ask-siargao.local",
      }),
    );

    expect(JSON.stringify(presentation)).not.toContain("user_secret");
    expect(JSON.stringify(presentation)).not.toContain("Clerk");
    expect(presentation.name).toBe("Signed-in account");
  });
});

function profileResponse(
  identity: Partial<UserProfileResponse["identity"]> & {
    displayName?: string | null;
  } = {},
): UserProfileResponse {
  return {
    identity: {
      email: "email" in identity ? (identity.email ?? null) : "traveler@example.com",
      firstName: identity.firstName ?? null,
      lastName: identity.lastName ?? null,
    },
    profile: {
      displayName: identity.displayName ?? null,
      homeCountry: null,
      travelStyle: null,
      budgetLevel: null,
      dietaryNotes: null,
      foodNeeds: [],
      accessibilityNotes: null,
      surfAbility: null,
      quietSleepPreference: null,
      weatherPreference: null,
      interests: [],
      preferredAreas: [],
      tripContext: {},
      marketingConsent: false,
      createdAt: null,
      updatedAt: null,
    },
  };
}
