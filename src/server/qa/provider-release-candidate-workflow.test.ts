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
  expect(workflow.match(/secrets\.PROVIDER_RC_CLERK_GOOGLE_PASSWORD/g)).toHaveLength(1);
});

test("protected provider database probes require verified PostgreSQL TLS", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const databaseUrlSecret = "DATABASE_URL: $" + "{{ secrets.PROVIDER_RC_DATABASE_URL }}";
  const blocks = [
    jobBlock(workflow, "clerk-test-instance", "stripe-test-mode"),
    jobBlock(workflow, "stripe-test-mode"),
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
  expect(jobBlock(workflow, "stripe-test-mode")).toContain("needs: clerk-test-instance");
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
    jobBlock(workflow, "clerk-test-instance", "stripe-test-mode"),
    jobBlock(workflow, "stripe-test-mode"),
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
  expect(workflow).toContain(`provider-rc-stripe-${shaExpression}`);
});

test("protected evidence is emitted only after its semantic provider lane", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow.indexOf("bun run test:e2e:clerk")).toBeLessThan(
    workflow.indexOf("bun run privacy:closure-worker"),
  );
  expect(workflow.indexOf("bun run qa:provider-rc-preflight -- --lane clerk")).toBeLessThan(
    workflow.indexOf("bun run test:e2e:clerk"),
  );
  expect(workflow.indexOf("bun run privacy:closure-worker")).toBeLessThan(
    workflow.indexOf("bun run test:e2e:clerk:verify-deletion"),
  );
  expect(workflow.indexOf("bun run test:e2e:clerk:verify-deletion")).toBeLessThan(
    workflow.indexOf("bun run test:e2e:clerk:final-boundary"),
  );
  expect(workflow.indexOf("bun run test:e2e:clerk:final-boundary")).toBeLessThan(
    workflow.indexOf("bun run qa:provider-rc-evidence -- --lane clerk"),
  );
  expect(workflow.indexOf("bun run test:smoke:trip-pass-stripe")).toBeLessThan(
    workflow.lastIndexOf("bun run privacy:closure-worker"),
  );
  expect(workflow.indexOf("bun run qa:provider-rc-preflight -- --lane stripe")).toBeLessThan(
    workflow.indexOf("bun run test:smoke:trip-pass-stripe"),
  );
  expect(workflow.lastIndexOf("bun run privacy:closure-worker")).toBeLessThan(
    workflow.indexOf("bun run payments:closure-refund-worker"),
  );
  expect(workflow.indexOf("bun run payments:closure-refund-worker")).toBeLessThan(
    workflow.indexOf("bun run test:e2e:stripe:final-boundary"),
  );
  expect(workflow.indexOf("bun run test:e2e:stripe:final-boundary")).toBeLessThan(
    workflow.indexOf("bun run qa:provider-rc-evidence -- --lane stripe"),
  );
});

test("workflow names the lifecycle that owns both protected lanes", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow).toContain(
    "Run protected Clerk acceptance through the Release Evidence lifecycle",
  );
  expect(workflow).toContain(
    "Run protected Stripe acceptance through the Release Evidence lifecycle",
  );
});
