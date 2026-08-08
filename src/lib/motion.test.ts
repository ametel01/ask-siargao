import { describe, expect, test } from "bun:test";

import { motionAwareScrollBehavior } from "@/lib/motion";

describe("motion preferences", () => {
  test("keeps spatial scrolling immediate when reduced motion is requested", () => {
    expect(motionAwareScrollBehavior(true)).toBe("auto");
  });

  test("preserves continuity scrolling when motion is allowed", () => {
    expect(motionAwareScrollBehavior(false)).toBe("smooth");
  });
});
