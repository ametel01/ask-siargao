import { describe, expect, test } from "bun:test";

import { clerkInstancePolicy } from "@/server/auth/clerk-instance-policy";

describe("Clerk instance policy", () => {
  test("encodes the required production sign-in and session controls", () => {
    expect(clerkInstancePolicy).toEqual({
      allowedSignInMethods: ["email_code", "google_oauth"],
      emailVerificationRequired: true,
      maxSessionAgeDays: 7,
      multipleSessionsEnabled: false,
      operatorMfaRequired: true,
    });
  });
});
