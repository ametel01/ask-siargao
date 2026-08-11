import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { assertProviderReleaseCandidateContext } from "@/server/qa/provider-release-candidate";

const execFileAsync = promisify(execFile);

setup("validate exact protected context and initialize Clerk testing token", async () => {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  assertProviderReleaseCandidateContext({ checkedOutCommitSha: stdout.trim(), lane: "stripe" });
  await clerkSetup();
});
