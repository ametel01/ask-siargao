import { describe, expect, test } from "bun:test";
import type { VercelFetch } from "@/server/deployment/vercel-production-api";
import {
  createProtectedDeploymentRequest,
  createStagedProductionDeployment,
  promoteProductionDeployment,
  waitForLiveProductionDeployment,
} from "@/server/deployment/vercel-production-api";

const identity = {
  projectId: "prj_test",
  releaseSha: "a".repeat(40),
  repositoryId: "123456",
  teamId: "team_test",
  token: "token_test",
};

describe("Vercel production API", () => {
  test("creates a non-aliased production deployment from the exact GitHub SHA", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];
    const fetch = mockFetch(
      [
        {
          id: "dpl_test",
          url: "ask-siargao-test.vercel.app",
        },
        {
          id: "dpl_test",
          url: "ask-siargao-test.vercel.app",
          readyState: "READY",
          target: "production",
          meta: { githubCommitSha: identity.releaseSha },
        },
      ],
      requests,
    );

    const deployment = await createStagedProductionDeployment(identity, {
      fetch,
      pollIntervalMs: 0,
    });

    expect(deployment).toEqual({
      id: "dpl_test",
      url: "https://ask-siargao-test.vercel.app",
    });
    expect(requests[0]?.url).toContain("/v13/deployments?forceNew=1");
    expect(requests[0]?.body).toMatchObject({
      target: "production",
      autoAssignCustomDomains: false,
      gitSource: {
        type: "github",
        ref: "main",
        repoId: identity.repositoryId,
        sha: identity.releaseSha,
      },
    });
  });

  test("uses only the automation bypass secret for staged smoke requests", async () => {
    const requests: Array<{ headers: Headers; url: string }> = [];
    const fetch: VercelFetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ headers, url });
      if (url.includes("api.vercel.com")) {
        return Response.json({
          protectionBypass: {
            ignored_secret: { scope: "other" },
            automation_secret: { scope: "automation-bypass" },
          },
        });
      }
      return Response.json({ status: "ready" });
    };

    const request = await createProtectedDeploymentRequest(
      {
        deploymentOrigin: "https://ask-siargao-test.vercel.app",
        projectId: identity.projectId,
        teamId: identity.teamId,
        token: identity.token,
      },
      { fetch },
    );
    await request("/api/health/ready");

    expect(requests[1]?.headers.get("x-vercel-protection-bypass")).toBe("automation_secret");
    expect(requests[1]?.headers.has("authorization")).toBe(false);
  });

  test("promotes only the selected deployment and waits for the live alias", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];
    const fetch = mockFetch(
      [
        {},
        {
          id: "dpl_test",
          url: "ask-siargao-test.vercel.app",
          readyState: "READY",
        },
      ],
      requests,
    );
    await promoteProductionDeployment(
      {
        deploymentId: "dpl_test",
        projectId: identity.projectId,
        teamId: identity.teamId,
        token: identity.token,
      },
      { fetch },
    );
    await waitForLiveProductionDeployment(
      {
        deploymentId: "dpl_test",
        productionOrigin: "https://www.asksiargao.com",
        teamId: identity.teamId,
        token: identity.token,
      },
      { fetch, pollIntervalMs: 0 },
    );

    expect(requests[0]?.url).toContain("/promote/dpl_test");
    expect(requests[1]?.url).toContain("/deployments/www.asksiargao.com");
  });
});

function mockFetch(
  responses: unknown[],
  requests: Array<{ body: unknown; url: string }>,
): VercelFetch {
  return async (input, init) => {
    requests.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected Vercel API request.");
    return Response.json(response);
  };
}
