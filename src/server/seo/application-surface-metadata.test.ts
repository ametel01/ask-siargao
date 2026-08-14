import { describe, expect, test } from "bun:test";

import { metadata as chatMetadata } from "@/app/chat/page";
import { metadata as profileMetadata } from "@/app/profile/page";
import { metadata as settingsMetadata } from "@/app/settings/page";
import { metadata as signInMetadata } from "@/app/sign-in/[[...sign-in]]/page";
import { metadata as signUpMetadata } from "@/app/sign-up/[[...sign-up]]/page";
import { metadata as sharedTripMetadata } from "@/app/trips/shared/[token]/page";

describe("application surface metadata", () => {
  for (const [route, metadata] of [
    ["/chat?prompt=surf%20tomorrow", chatMetadata],
    ["/sign-in", signInMetadata],
    ["/sign-up", signUpMetadata],
    ["/profile", profileMetadata],
    ["/settings", settingsMetadata],
    ["/trips/shared/[token]", sharedTripMetadata],
  ] as const) {
    test(`${route} is noindex, follow`, () => {
      expect(metadata.robots).toEqual({ index: false, follow: true });
    });
  }
});
