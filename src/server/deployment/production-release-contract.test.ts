import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("production releases are exact-SHA gated, migrate before deploy, smoke, and promote", async () => {
  const [workflow, releaseApi, vercelConfig] = await Promise.all([
    readFile(".github/workflows/production-release.yml", "utf8"),
    readFile("src/server/deployment/vercel-production-api.ts", "utf8"),
    readFile("vercel.json", "utf8").then((content) => JSON.parse(content)),
  ]);

  expect(vercelConfig.git?.deploymentEnabled?.main).toBe(false);
  expect(workflow).toContain('workflows: ["CI"]');
  expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
  expect(workflow).toContain("environment: Production");
  expect(workflow.search(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/)).toBeGreaterThan(
    workflow.indexOf("Build a staged production deployment"),
  );
  expect(workflow).toContain('gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"');
  expect(workflow).toContain('test "$current_main" = "$RELEASE_SHA"');
  expect(workflow.indexOf("bun run db:migrate")).toBeLessThan(
    workflow.indexOf("production-release.ts deploy"),
  );
  expect(workflow).not.toContain("npm install");
  expect(releaseApi).toContain("/v13/deployments?forceNew=1");
  expect(releaseApi).toContain("autoAssignCustomDomains: false");
  expect(releaseApi).toContain("sha: input.releaseSha");
  expect(releaseApi).toMatch(/\/promote\/\$\{encodeURIComponent\(input\.deploymentId\)\}/);
  expect(workflow.indexOf("Smoke staged production health and DeepSeek chat")).toBeLessThan(
    workflow.indexOf("Promote the verified deployment"),
  );
  expect(workflow.indexOf("Promote the verified deployment")).toBeLessThan(
    workflow.indexOf("Smoke live production health and DeepSeek chat"),
  );
  expect(workflow).not.toContain("pull_request_target");
  expect(workflow).not.toContain("permissions:\n  contents: write");
});
