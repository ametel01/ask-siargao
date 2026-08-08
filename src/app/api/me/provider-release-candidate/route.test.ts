import { describe, expect, test } from "bun:test";

import { getProviderReleaseCandidateResponse } from "@/app/api/me/provider-release-candidate/provider-release-candidate-route";

const sha = "a".repeat(40);

describe("provider release candidate deployment identity probe", () => {
  test("is absent outside protected staging without attempting authentication", async () => {
    let authenticationStarted = false;
    const response = await getProviderReleaseCandidateResponse({
      authenticate: async () => {
        authenticationStarted = true;
        return { userId: "user_test" };
      },
      env: { CLERK_DEPLOYMENT_CONTEXT: "production", VERCEL_GIT_COMMIT_SHA: sha },
    });

    expect(response.status).toBe(404);
    expect(authenticationStarted).toBe(false);
  });

  test("requires an authenticated protected-staging session", async () => {
    const response = await getProviderReleaseCandidateResponse({
      authenticate: async () => ({ userId: null }),
      env: { CLERK_DEPLOYMENT_CONTEXT: "protected-staging", VERCEL_GIT_COMMIT_SHA: sha },
    });

    expect(response.status).toBe(401);
  });

  test("fails closed without an exact deployed commit identity", async () => {
    const response = await getProviderReleaseCandidateResponse({
      authenticate: async () => ({ userId: "user_test" }),
      env: {
        CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
        VERCEL_GIT_COMMIT_SHA: "short",
      },
    });

    expect(response.status).toBe(503);
  });

  test("returns only the exact deployed SHA to an authenticated staging user", async () => {
    const response = await getProviderReleaseCandidateResponse({
      authenticate: async () => ({ userId: "user_test" }),
      env: { CLERK_DEPLOYMENT_CONTEXT: "protected-staging", VERCEL_GIT_COMMIT_SHA: sha },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ releaseCandidateSha: sha });
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });
});
