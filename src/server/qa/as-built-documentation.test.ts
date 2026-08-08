import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseOperationalWorkerArguments } from "@/server/operations/run-operational-worker";

const currentDocs = [
  ".env.example",
  "documentation/user/reference/trip-pass.md",
  "documentation/developer/reference/clerk-auth-session-chat-history-requirements.md",
  "documentation/developer/reference/environment.md",
  "documentation/developer/reference/scripts.md",
  "documentation/developer/reference/trip-pass-reconciliation.md",
  "documentation/developer/how-to-guides/launch-trip-pass.md",
  "documentation/developer/how-to-guides/run-release-candidate-qa.md",
] as const;

test("as-built environment example covers the production-readiness interfaces", async () => {
  const example = await readFile(".env.example", "utf8");
  for (const name of [
    "CLERK_AUTH_MODE",
    "CLERK_AUTHORIZED_PARTIES",
    "CLERK_PRODUCTION_ORIGIN",
    "CLERK_PROTECTED_STAGING_ORIGIN",
    "TRIP_PASS_CHECKOUT_MODE",
    "TRIP_PASS_CHECKOUT_CANARY_ACCOUNT_IDS",
    "COMMERCE_RETENTION_POLICY_VERSION",
    "ACCOUNT_CLOSURE_TOMBSTONE_HMAC_PREVIOUS_KEYS_JSON",
    "TRIP_PASS_IDEMPOTENCY_HMAC_KEY",
    "REDIS_URL",
    "SENTRY_DSN",
    "OPERATOR_ACCOUNT_IDS",
  ]) {
    expect(example).toContain(`${name}=`);
  }
  expect(example).toContain("# Stripe API 2026-07-29.dahlia; normalized event schema 2");
  expect(example).toContain("# Scheduler-neutral worker entrypoints:");
  expect(example).not.toContain("TRIP_PASS_EXTENSION_ENABLED");
  expect(example).not.toContain("INNGEST_EVENT_KEY");
  expect(example).not.toContain("INNGEST_SIGNING_KEY");
});

test("current auth, commerce, operator, and release docs reject stale launch claims", async () => {
  const corpus = (
    await Promise.all(currentDocs.map(async (path) => `${path}\n${await readFile(path, "utf8")}`))
  ).join("\n");
  for (const stale of [
    /TRIP_PASS_CHECKOUT_ENABLED/i,
    /TRIP_PASS_EXTENSION_ENABLED/i,
    /confirmMutation/i,
    /shared[- ]token.{0,40}(?:repair|mutation|authorize)/i,
    /browser (?:return|redirect).{0,40}activat/i,
    /automatic partial[- ]refund revocation/i,
    /secondary commercial meter/i,
    /no stacking/i,
    /Clerk Billing/i,
  ]) {
    expect(corpus).not.toMatch(stale);
  }
  expect(corpus).toContain("Refund Review");
  expect(corpus).toContain("Paid After Closure");
  expect(corpus).toContain("dedicated GitHub launch issue");
});

test("documentation entry points and changed-page relative links resolve", async () => {
  for (const path of [
    "documentation/README.md",
    "documentation/developer/README.md",
    ...currentDocs.filter((path) => path.endsWith(".md")),
  ]) {
    const markdown = await readFile(path, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]?.split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:|\/)/.test(target)) continue;
      await expect(Bun.file(resolve(dirname(path), target)).exists()).resolves.toBe(true);
    }
  }
});

test("CI binds launch evidence to all foundation gates, checkout off, and the exact SHA", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("  trip-pass-launch-manifest:"));
  for (const dependency of ["release-gate", "integration-postgres", "integration-redis"]) {
    expect(job).toContain(`- ${dependency}`);
  }
  expect(job).toContain("TRIP_PASS_CHECKOUT_MODE: off");
  expect(job).toContain("--write --foundation-ci-gates-passed");
  expect(job).toContain("trip-pass-launch-manifest-$" + "{{ github.sha }}.json");
});

test("legacy static launch proof has no remaining import, link, or script consumer", async () => {
  expect(await Bun.file("src/server/qa/trip-pass-launch-proof.ts").exists()).toBe(false);
  expect(await Bun.file("docs/evaluations/trip-pass-launch-proof-2026-07-14.json").exists()).toBe(
    false,
  );
  const packageJson = await Bun.file("package.json").json();
  expect(packageJson.scripts["qa:trip-pass-launch"]).toBe(
    "bun run src/server/qa/run-trip-pass-launch-proof.ts",
  );
  const trackedConsumers = await Promise.all(
    [
      "README.md",
      "documentation/README.md",
      "documentation/developer/README.md",
      "documentation/developer/explanation/auth-payments-production-readiness-assessment-2026-08-07.md",
      "src/server/qa/release-candidate-demo.test.ts",
    ].map((path) => readFile(path, "utf8")),
  );
  expect(trackedConsumers.join("\n")).not.toContain("trip-pass-launch-proof-2026-07-14");
  expect(trackedConsumers.join("\n")).not.toContain("@/server/qa/trip-pass-launch-proof");
});

test("documented operational worker task and lease arguments are executable", () => {
  expect(
    parseOperationalWorkerArguments([
      "--task=commerce_reconciliation",
      "--batch=25",
      "--lease-seconds=60",
    ]),
  ).toMatchObject({ batchSize: 25, leaseSeconds: 60, taskTypes: ["commerce_reconciliation"] });
});
