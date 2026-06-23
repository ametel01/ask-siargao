import { describe, expect, test } from "bun:test";

import {
  releaseCandidateDemoScenario,
  validateReleaseCandidateDemoScenario,
} from "@/server/qa/release-candidate-demo";

describe("release-candidate demo scenario", () => {
  test("documents local QA paths backed by synthetic or permitted fixtures", () => {
    const validation = validateReleaseCandidateDemoScenario();

    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(releaseCandidateDemoScenario.paths.map((entry) => entry.path)).toContain(
      "/audits/audit_123/report",
    );
    expect(releaseCandidateDemoScenario.publicEvidenceIds.length).toBeGreaterThanOrEqual(5);
  });
});
