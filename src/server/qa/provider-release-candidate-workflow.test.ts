import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const workflowPath = ".github/workflows/provider-release-candidate.yml";

function jobBlock(workflow: string, name: string, nextName?: string) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : workflow.length;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

test("provider credentials are reachable only from manually approved protected jobs", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toContain("pull_request:");
  expect(workflow).not.toContain("push:");
  expect(workflow.match(/environment: provider-release-candidate/g)).toHaveLength(2);
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).not.toContain("sk_live_");
  expect(workflow).not.toContain("rk_live_");
  expect(workflow).not.toContain("TRIP_PASS_CHECKOUT_MODE: on");
  expect(workflow).not.toContain("TRIP_PASS_CHECKOUT_MODE: canary");
  expect(workflow).not.toContain("PROVIDER_RC_CLERK_GOOGLE_USER");
  expect(workflow.match(/secrets\.PROVIDER_RC_CLERK_GOOGLE_EMAIL/g)).toHaveLength(1);
  expect(workflow).not.toContain("PROVIDER_RC_CLERK_GOOGLE_PASSWORD");
  expect(workflow).not.toContain("STRIPE_");
});

test("protected provider database probes require verified PostgreSQL TLS", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const databaseUrlSecret = "DATABASE_URL: $" + "{{ secrets.PROVIDER_RC_DATABASE_URL }}";
  const blocks = [
    jobBlock(workflow, "clerk-test-instance", "lemon-squeezy-test-mode"),
    jobBlock(workflow, "lemon-squeezy-test-mode"),
  ];

  expect(workflow.match(/DATABASE_SSL_MODE: verify-full/g)).toHaveLength(2);
  for (const block of blocks) {
    expect(block).toContain(databaseUrlSecret);
    expect(block).toContain("DATABASE_SSL_MODE: verify-full");
  }
});

test("protected dispatches and lanes cannot overlap or cancel mid-mutation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow).toContain(
    "concurrency:\n  group: provider-release-candidate\n  cancel-in-progress: false",
  );
  expect(workflow).not.toContain("group: provider-release-candidate-${{");
  expect(jobBlock(workflow, "lemon-squeezy-test-mode")).toContain("needs: clerk-test-instance");
});

test("every third-party action is pinned to an immutable reviewed commit", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  expect(actionReferences.length).toBeGreaterThan(0);
  for (const action of actionReferences) {
    expect(action).toMatch(/@[0-9a-f]{40}$/);
  }
  expect(workflow).toContain("permissions:\n  contents: read");
});

test("secrets are step-scoped and unreachable until repository trust is proved", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const workflowPreamble = workflow.slice(0, workflow.indexOf("jobs:"));
  expect(workflowPreamble).not.toContain("secrets.");

  for (const block of [
    jobBlock(workflow, "clerk-test-instance", "lemon-squeezy-test-mode"),
    jobBlock(workflow, "lemon-squeezy-test-mode"),
  ]) {
    const steps = block.indexOf("    steps:");
    expect(block.slice(0, steps)).not.toContain("secrets.");

    const proof = block.indexOf("- name: Verify exact trusted main commit");
    const protectedLane = block.indexOf("- name: Run protected");
    const secretLane = block.indexOf("secrets.");
    expect(proof).toBeGreaterThan(-1);
    expect(protectedLane).toBeGreaterThan(proof);
    expect(secretLane).toBeGreaterThan(proof);
    expect(block.slice(0, secretLane)).not.toContain("secrets.");
    expect(secretLane).toBeGreaterThan(protectedLane);
  }
});

test("forks and non-manual events cannot select a secret-bearing job", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/^\s{2}(pull_request|pull_request_target|push):/m);
  expect(workflow.match(/EXPECTED_EVENT: workflow_dispatch/g)).toHaveLength(2);
  expect(workflow.match(/test "\$GITHUB_EVENT_NAME" = "\$EXPECTED_EVENT"/g)).toHaveLength(2);
  expect(workflow.match(/test "\$GITHUB_REPOSITORY" = "\$EXPECTED_REPOSITORY"/g)).toHaveLength(2);
});

test("both lanes prove the checked-out SHA is exact and already trusted by main", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow.match(/ref: \$\{\{ inputs\.release_candidate_sha \}\}/g)).toHaveLength(2);
  expect(workflow.match(/git rev-parse HEAD/g)).toHaveLength(2);
  expect(workflow.match(/git merge-base --is-ancestor/g)).toHaveLength(2);
  expect(workflow.match(/\^\[0-9a-f\]\{40\}\$/g)).toHaveLength(2);
  const shaExpression = "${" + "{ inputs.release_candidate_sha }}";
  expect(workflow).toContain(`provider-rc-clerk-${shaExpression}`);
  expect(workflow).toContain(`provider-rc-lemon-squeezy-${shaExpression}`);
});

test("workflow selects one lifecycle-owned execution per provider lane", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const clerk = jobBlock(workflow, "clerk-test-instance", "lemon-squeezy-test-mode");
  const lemonSqueezy = jobBlock(workflow, "lemon-squeezy-test-mode");

  expect(clerk).toContain("run: bun run qa:provider-rc -- --lane clerk");
  expect(lemonSqueezy).toContain("run: bun run qa:provider-rc -- --lane lemon-squeezy");
  expect(workflow.match(/bun run qa:provider-rc -- --lane/g)).toHaveLength(2);
  for (const block of [clerk, lemonSqueezy]) {
    expect(block).not.toContain("qa:provider-rc-preflight");
    expect(block).not.toContain("qa:provider-rc-evidence");
    expect(block).not.toContain("privacy:closure-worker");
    expect(block).not.toContain("final-boundary");
  }
});

test("workflow names the lifecycle that owns both protected lanes", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow).toContain(
    "Run protected Clerk acceptance through the Release Evidence lifecycle",
  );
  expect(workflow).toContain(
    "Run protected Lemon Squeezy acceptance through the Release Evidence lifecycle",
  );
});

test("Lemon Squeezy lane is mode-isolated and publishes privacy-safe evidence", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const lemonSqueezy = jobBlock(workflow, "lemon-squeezy-test-mode");
  const acceptance = lemonSqueezy.indexOf(
    "Run protected Lemon Squeezy acceptance through the Release Evidence lifecycle",
  );
  const evidence = lemonSqueezy.indexOf("Upload exact Lemon Squeezy evidence");

  expect(evidence).toBeGreaterThan(acceptance);
  expect(lemonSqueezy).toContain("LEMON_SQUEEZY_ALLOW_TEST_MODE: true");
  for (const name of [
    "LEMON_SQUEEZY_API_KEY",
    "LEMON_SQUEEZY_STORE_ID",
    "LEMON_SQUEEZY_PRODUCT_ID",
    "LEMON_SQUEEZY_VARIANT_ID",
    "LEMON_SQUEEZY_WEBHOOK_SECRET",
  ]) {
    expect(lemonSqueezy).toContain(name);
  }
  expect(lemonSqueezy).not.toContain("failure diagnostics");
  expect(lemonSqueezy).not.toContain("test-results/provider-lemon-squeezy");
  expect(lemonSqueezy).not.toContain("trace.zip");
});
