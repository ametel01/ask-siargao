import { assertProviderReleaseCandidateContext } from "@/server/qa/provider-release-candidate";

const checkedOutCommitSha = await readHeadSha();
assertProviderReleaseCandidateContext({ checkedOutCommitSha, lane: "stripe" });

await run("bunx", [
  "playwright",
  "test",
  "--config=playwright.stripe.config.ts",
  "--grep-invert=final live boundary",
]);
await run("bun", [
  "test",
  "src/server/trip-pass/commerce.test.ts",
  "src/server/trip-pass/webhook-application.test.ts",
  "src/server/trip-pass/payment-lifecycle.test.ts",
  "src/server/trip-pass/reconciliation.test.ts",
  "src/server/trip-pass/paid-after-closure-refund.test.ts",
  "src/server/trip-pass/usage.test.ts",
  "src/server/qa/provider-release-candidate.test.ts",
]);

console.log(
  JSON.stringify({
    checkedOutCommitSha,
    lane: "stripe",
    protectedAppBoundary: "verified",
    providerMode: "test",
    semanticOrdering: "provider_lookup_completed_before_application_started",
  }),
);

async function run(command: string, args: string[]) {
  const process = Bun.spawn([command, ...args], { stdout: "inherit", stderr: "inherit" });
  if ((await process.exited) !== 0) {
    throw new Error("A protected Stripe release-candidate gate failed.");
  }
}

async function readHeadSha() {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}
