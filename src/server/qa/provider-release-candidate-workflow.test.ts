import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const workflowPath = ".github/workflows/provider-release-candidate.yml";

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
});

test("both lanes prove the checked-out SHA is exact and already trusted by main", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow.match(/ref: \$\{\{ inputs\.release_candidate_sha \}\}/g)).toHaveLength(2);
  expect(workflow.match(/git rev-parse HEAD/g)).toHaveLength(2);
  expect(workflow.match(/git merge-base --is-ancestor/g)).toHaveLength(2);
  const shaExpression = "${" + "{ inputs.release_candidate_sha }}";
  expect(workflow).toContain(`provider-rc-clerk-${shaExpression}`);
  expect(workflow).toContain(`provider-rc-stripe-${shaExpression}`);
});

test("protected evidence is emitted only after its semantic provider lane", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  expect(workflow.indexOf("bun run test:e2e:clerk")).toBeLessThan(
    workflow.indexOf("bun run privacy:closure-worker"),
  );
  expect(workflow.indexOf("bun run privacy:closure-worker")).toBeLessThan(
    workflow.indexOf("bun run test:e2e:clerk:verify-deletion"),
  );
  expect(workflow.indexOf("bun run test:e2e:clerk:verify-deletion")).toBeLessThan(
    workflow.indexOf("bun run qa:provider-rc-evidence -- --lane clerk"),
  );
  expect(workflow.indexOf("bun run test:smoke:trip-pass-stripe")).toBeLessThan(
    workflow.indexOf("bun run qa:provider-rc-evidence -- --lane stripe"),
  );
});
