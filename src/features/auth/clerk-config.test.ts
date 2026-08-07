import { describe, expect, test } from "bun:test";

import { readPublicClerkAuthMode } from "@/features/auth/clerk-config";

describe("public Clerk auth mode", () => {
  test("enables client Clerk UI only from the public mode mirror and publishable key", () => {
    expect(
      readPublicClerkAuthMode({
        NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
      }),
    ).toBe("enabled");

    expect(
      readPublicClerkAuthMode({
        NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
      }),
    ).toBe("disabled");
    expect(readPublicClerkAuthMode({ NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled" })).toBe("disabled");
  });
});
