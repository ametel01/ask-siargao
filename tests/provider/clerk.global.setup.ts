import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { assertProviderReleaseCandidateContext } from "@/server/qa/provider-release-candidate";

setup.describe.configure({ mode: "serial" });

setup("validate exact protected context and initialize Clerk testing token", async () => {
  const checkedOutCommitSha = await readHeadSha();
  assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane: "clerk" });
  await clerkSetup();
});

async function readHeadSha() {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}
