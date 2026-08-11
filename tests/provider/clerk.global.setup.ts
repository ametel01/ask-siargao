import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { initializeProtectedProviderLane } from "@/server/qa/provider-release-candidate-harness";

setup.describe.configure({ mode: "serial" });

setup("validate exact protected context and initialize Clerk testing token", async () => {
  await initializeProtectedProviderLane("clerk", { initialize: clerkSetup });
});
