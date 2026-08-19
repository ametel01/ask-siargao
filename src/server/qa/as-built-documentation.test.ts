import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { liveCommerceFindingKinds } from "@/server/operations/live-reconciliation";
import { parseOperationalWorkerArguments } from "@/server/operations/run-operational-worker";
import { foundationGateContract } from "@/server/qa/foundation-gates";

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

const verificationDocs = [
  "README.md",
  "documentation/developer/reference/scripts.md",
  "documentation/developer/how-to-guides/run-release-candidate-qa.md",
  "documentation/developer/how-to-guides/operate-the-production-database.md",
  "documentation/developer/how-to-guides/extend-a-reality-check-kind.md",
] as const;

const legacyVerificationAlias = ["verify", "ci"].join(":");
const verificationContractPathspecs = [
  ".",
  ":(exclude).agents/**",
  ":(exclude).github/skills/**",
  ":(exclude)CHANGELOG*",
  ":(exclude)**/CHANGELOG*",
  ":(exclude)documentation/developer/explanation/*assessment*.md",
  ":(exclude)docs/adr/**",
  ":(exclude)docs/evaluations/**",
  ":(exclude)docs/visual-evidence/**",
  ":(exclude)drizzle/**",
  ":(exclude)plans/**",
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
    "SENTRY_CRON_MONITOR_SLUG",
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

test("production builds use the documented reliable Next bundler", async () => {
  const [packageJson, scriptsReference] = await Promise.all([
    Bun.file("package.json").json(),
    readFile("documentation/developer/reference/scripts.md", "utf8"),
  ]);
  const buildCommand = packageJson.scripts?.build;

  expect(buildCommand).toBe(
    "bun run validate:deployment && rm -rf .next && NEXT_PRIVATE_BUILD_WORKER=0 ./node_modules/.bin/next build --webpack",
  );
  expect(scriptsReference).toContain(`| \`bun run build\` | \`${buildCommand}\` |`);
});

test("environment template, reference, and code stay aligned for release-owned variables", async () => {
  const [example, reference, reportAccess, repositoryEnvUse] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("documentation/developer/reference/environment.md", "utf8"),
    readFile("src/server/audit/report-access.ts", "utf8"),
    readFile("src/server/operations/run-operational-worker.ts", "utf8"),
  ]);
  const exampleNames = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
  for (const name of exampleNames) expect(reference).toContain(`\`${name}\``);
  expect(reportAccess).toContain("process.env.REPORT_ACCESS_TOKEN_SECRET");
  expect(example).toContain("REPORT_ACCESS_TOKEN_SECRET=");
  expect(reference).toContain("`REPORT_ACCESS_TOKEN_SECRET`");
  for (const unusedSchedulerKey of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) {
    expect(`${example}\n${reference}\n${repositoryEnvUse}`).not.toContain(unusedSchedulerKey);
  }
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
  const paths = new Set([
    "documentation/README.md",
    "documentation/developer/README.md",
    ...currentDocs.filter((path) => path.endsWith(".md")),
    ...verificationDocs,
  ]);
  for (const path of paths) {
    const markdown = await readFile(path, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]?.split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:|\/)/.test(target)) continue;
      await expect(Bun.file(resolve(dirname(path), target)).exists()).resolves.toBe(true);
    }
  }
});

test("first-party verification docs expose the complete Foundation Gate without the obsolete alias", async () => {
  const [readme, scriptReference, releaseCandidateQaGuide, ...otherVerificationDocs] =
    await Promise.all(verificationDocs.map((path) => readFile(path, "utf8")));
  const corpus = [readme, scriptReference, releaseCandidateQaGuide, ...otherVerificationDocs].join(
    "\n",
  );
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");
  const normalizedReleaseCandidateQaGuide = releaseCandidateQaGuide.replaceAll(/\s+/g, " ");

  expect(corpus).not.toContain(legacyVerificationAlias);
  expect(readme).toContain("bun run verify:foundation");
  expect(scriptReference).toContain("`bun run verify:foundation`");
  expect(releaseCandidateQaGuide).toContain("bun run verify:foundation");
  for (const boundary of [
    "Foundation Gate Status",
    "provider QA",
    "Production Readiness",
    "Launch Authorization",
  ]) {
    expect(normalizedReadme).toContain(boundary);
    expect(normalizedReleaseCandidateQaGuide).toContain(boundary);
  }
  for (const prerequisite of ["DATABASE_URL", "REDIS_URL", "Docker daemon", "run-owned"]) {
    expect(scriptReference).toContain(prerequisite);
  }
});

test("active first-party files have no stale verification alias consumers", async () => {
  const search = Bun.spawn(
    [
      "git",
      "grep",
      "--line-number",
      "--fixed-strings",
      legacyVerificationAlias,
      "--",
      ...verificationContractPathspecs,
    ],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    search.exited,
    new Response(search.stderr).text(),
    new Response(search.stdout).text(),
  ]);

  expect(stderr).toBe("");
  expect(exitCode, stdout).toBe(1);
  expect(stdout).toBe("");
});

test("script reference names every canonical Foundation Gate command", async () => {
  const reference = await readFile("documentation/developer/reference/scripts.md", "utf8");

  for (const gate of foundationGateContract) {
    expect(reference).toContain(`\`${gate.command.join(" ")}\``);
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

test("reconciliation docs match the exact finding scope and keep mutation at the repair API", async () => {
  const reference = await readFile(
    "documentation/developer/reference/trip-pass-reconciliation.md",
    "utf8",
  );
  for (const finding of liveCommerceFindingKinds) {
    expect(reference).toContain(`\`${finding}\``);
  }
  for (const overclaim of [
    "cumulative refunds",
    "disputes",
    "closure/payment race",
    "Paid After Closure",
    "paid-answer settlement",
  ]) {
    expect(reference).not.toContain(overclaim);
  }
  expect(reference).toContain("read-only `operations:worker -- --task=commerce_reconciliation`");
  expect(reference).toMatch(/concurrently claims at most 50 reconciliation\s+tasks/);
  expect(reference).toContain("less than 46 seconds remain");
  expect(reference).not.toContain("drains that lane");
  expect(reference).toContain("`buildTripPassDiagnostics`");
  expect(reference).toContain("no `mode`");
  expect(await Bun.file("src/server/trip-pass/diagnostics.ts").exists()).toBe(true);
  expect(await Bun.file("src/server/trip-pass/reconciliation.ts").exists()).toBe(false);
  expect(reference).toContain("`POST /api/admin/repairs`");
  for (const repairBoundary of [
    "`OPERATOR_ACCOUNT_IDS`",
    "fresh Clerk MFA",
    "preview digest",
    "`APPLY REPAIR`",
    "idempotency key",
    "audit",
  ]) {
    expect(reference).toContain(repairBoundary);
  }
  expect(reference).not.toContain(
    "The worker uses database-time leases, retry fencing, and idempotency",
  );
});
