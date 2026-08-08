import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { assertProviderReleaseCandidateContext } from "@/server/qa/provider-release-candidate";

setup("validate exact protected context and initialize Clerk testing token", async () => {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  assertProviderReleaseCandidateContext({ checkedOutCommitSha: stdout.trim(), lane: "stripe" });
  await clerkSetup();
});
