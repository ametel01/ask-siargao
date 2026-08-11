import { defineConfig, devices } from "@playwright/test";

import { createProviderReleaseCandidatePlaywrightConfig } from "@/server/qa/provider-release-candidate-harness";

export default defineConfig(
  createProviderReleaseCandidatePlaywrightConfig("stripe", {
    device: devices["Desktop Chrome"],
    retries: 0,
  }),
);
