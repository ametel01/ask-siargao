import { createLemonSqueezyHttpClient } from "@/server/payments/lemon-squeezy";
import { verifyProtectedLemonSqueezyCatalog } from "@/server/qa/lemon-squeezy-release-candidate";
import {
  assertProviderReleaseCandidateContext,
  type ProviderReleaseCandidateEnv,
} from "@/server/qa/provider-release-candidate";

const checkedOutCommitSha = await readHeadSha();
const env = process.env as ProviderReleaseCandidateEnv;
assertProviderReleaseCandidateContext({
  checkedOutCommitSha,
  env,
  lane: "lemon-squeezy",
});

const http = createLemonSqueezyHttpClient();
await verifyProtectedLemonSqueezyCatalog({
  expected: {
    productId: required("LEMON_SQUEEZY_PRODUCT_ID"),
    storeId: required("LEMON_SQUEEZY_STORE_ID"),
    variantId: required("LEMON_SQUEEZY_VARIANT_ID"),
  },
  request: (path) => http.request({ method: "GET", path }),
});

await run("bunx", [
  "playwright",
  "test",
  "--config=playwright.lemon-squeezy.config.ts",
  "--grep-invert=final live boundary",
]);
await run("bun", [
  "test",
  "src/server/payments/lemon-squeezy.test.ts",
  "src/server/trip-pass/lemon-squeezy-adapter.test.ts",
  "src/server/trip-pass/lemon-commerce.test.ts",
  "src/server/trip-pass/lemon-squeezy-refund-worker.test.ts",
  "src/server/trip-pass/payment-lifecycle.test.ts",
  "src/server/trip-pass/usage.test.ts",
  "src/server/qa/lemon-squeezy-release-candidate.test.ts",
  "src/server/qa/provider-release-candidate.test.ts",
]);

console.log(
  JSON.stringify({
    checkedOutCommitSha,
    lane: "lemon-squeezy",
    protectedAppBoundary: "verified",
    providerMode: "test",
    providerResources: "verified-before-mutation",
  }),
);

async function run(command: string, args: string[]) {
  const child = Bun.spawn([command, ...args], { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) {
    throw new Error("A protected Lemon Squeezy release-candidate gate failed.");
  }
}

async function readHeadSha() {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exitCode !== 0) throw new Error("Unable to resolve the checked-out commit.");
  return stdout.trim();
}

function required(name: keyof ProviderReleaseCandidateEnv) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for protected Lemon Squeezy verification.`);
  return value;
}
