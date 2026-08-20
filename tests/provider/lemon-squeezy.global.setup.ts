import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { initializeProtectedProviderLane } from "@/server/qa/provider-release-candidate-harness";

setup("validate exact protected context and initialize Clerk testing token", async () => {
  await initializeProtectedProviderLane("lemon-squeezy", { initialize: clerkSetup });
});
