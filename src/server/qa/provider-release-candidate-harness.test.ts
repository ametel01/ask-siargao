import { describe, expect, test } from "bun:test";
import type { Browser, BrowserContext, Page } from "@playwright/test";

import type {
  ProviderReleaseCandidateEnv,
  ProviderReleaseCandidateScenario,
} from "@/server/qa/provider-release-candidate";
import {
  createProtectedProviderHarness,
  createProviderReleaseCandidatePlaywrightConfig,
  initializeProtectedProviderLane,
  readProviderReleaseCandidateHeadSha,
} from "@/server/qa/provider-release-candidate-harness";

const sha = "a".repeat(40);

describe("protected provider harness", () => {
  test("resolves the checked-out candidate in the Playwright Node runtime", async () => {
    expect(await readProviderReleaseCandidateHeadSha()).toMatch(/^[0-9a-f]{40}$/);
  });

  test("guards the exact candidate before provider setup starts", async () => {
    let initialized = false;

    await expect(
      initializeProtectedProviderLane("clerk", {
        env: protectedEnvironment("clerk"),
        initialize: async () => {
          initialized = true;
        },
        readCheckedOutCommitSha: async () => "b".repeat(40),
      }),
    ).rejects.toThrow("checked_out_sha_does_not_match_input");

    expect(initialized).toBe(false);
  });

  test("builds both lane configs from one protected browser policy", () => {
    const device = { browserName: "chromium" as const };
    const clerk = createProviderReleaseCandidatePlaywrightConfig("clerk", {
      device,
      env: protectedEnvironment("clerk"),
      retries: 1,
    });
    const stripe = createProviderReleaseCandidatePlaywrightConfig("stripe", {
      device,
      env: protectedEnvironment("stripe"),
      retries: 0,
    });

    for (const [lane, config] of [
      ["clerk", clerk],
      ["stripe", stripe],
    ] as const) {
      expect(config.testMatch).toBe(`**/*.${lane}.e2e.ts`);
      expect(config.timeout).toBe(120_000);
      expect(config.workers).toBe(1);
      expect(config.use).toMatchObject({
        baseURL: "https://provider-rc.asksiargao.test",
        screenshot: "off",
        trace: "off",
        video: "off",
      });
      expect(config.use?.extraHTTPHeaders).toBeUndefined();
      expect(config.projects).toEqual([
        {
          name: `${lane} setup`,
          testMatch: `**/${lane}.global.setup.ts`,
        },
        {
          name: `${lane} protected chromium`,
          dependencies: [`${lane} setup`],
          testIgnore: `**/${lane}.global.setup.ts`,
          use: device,
        },
      ]);
    }
  });

  test("redacts provider failures and applies the adapter timeout", async () => {
    const harness = createProtectedProviderHarness("clerk", {
      env: protectedEnvironment("clerk"),
      lifecycle: lifecycleStub("clerk"),
      providerTimeoutMs: 1,
    });

    await expect(
      harness.providerCall("Clerk secret operation", async () => {
        throw new Error("sk_test_never-expose-this");
      }),
    ).rejects.toThrow("Clerk secret operation failed without provider details.");
    await expect(
      harness.providerCall("Clerk stalled operation", () => new Promise<never>(() => undefined)),
    ).rejects.toThrow("Clerk stalled operation failed without provider details.");
  });

  test("revalidates and records only through the guarded lifecycle", async () => {
    const calls: string[] = [];
    const lifecycle = lifecycleStub("stripe", calls);
    const harness = createProtectedProviderHarness("stripe", {
      env: protectedEnvironment("stripe"),
      lifecycle,
    });
    const page = deploymentPage(sha);

    await harness.revalidate(page);
    await harness.recordScenarios(["test_mode_card_payment", "verified_activation"]);
    await harness.seal(page);

    expect(calls).toEqual([
      `revalidate:${sha}`,
      "record:test_mode_card_payment,verified_activation",
      `seal:${sha}`,
    ]);
  });

  test("rejects a changed deployment before lifecycle mutation", async () => {
    const calls: string[] = [];
    const harness = createProtectedProviderHarness("stripe", {
      env: protectedEnvironment("stripe"),
      lifecycle: lifecycleStub("stripe", calls),
    });

    await expect(harness.revalidate(deploymentPage("b".repeat(40)))).rejects.toThrow(
      "Protected app deployment changed before the Stripe scenario.",
    );
    expect(calls).toEqual([]);
  });

  test("authorizes isolated browser contexts without globally forwarding bypass headers", async () => {
    let contextOptions: object | undefined;
    let authorizationRequest: object | undefined;
    const browser = {
      async newContext(options: object) {
        contextOptions = options;
        return {
          marker: "protected-context",
          request: {
            async get(url: string, requestOptions: object) {
              authorizationRequest = { requestOptions, url };
              return { status: () => 200 };
            },
          },
        } as unknown as BrowserContext;
      },
    } as unknown as Browser;
    const harness = createProtectedProviderHarness("clerk", {
      env: protectedEnvironment("clerk"),
      lifecycle: lifecycleStub("clerk"),
    });

    const context = await harness.newBrowserContext(browser);

    expect((context as unknown as { marker: string }).marker).toBe("protected-context");
    expect(contextOptions).toEqual({
      baseURL: "https://provider-rc.asksiargao.test",
    });
    expect(authorizationRequest).toEqual({
      requestOptions: {
        headers: {
          "x-vercel-protection-bypass": "vercel-bypass-redacted",
          "x-vercel-set-bypass-cookie": "true",
        },
      },
      url: "https://provider-rc.asksiargao.test",
    });
  });

  test("authorizes a default page through a scoped cookie-setting request", async () => {
    let authorizationRequest: object | undefined;
    const harness = createProtectedProviderHarness("stripe", {
      env: protectedEnvironment("stripe"),
      lifecycle: lifecycleStub("stripe"),
    });
    const page = {
      request: {
        async get(url: string, requestOptions: object) {
          authorizationRequest = { requestOptions, url };
          return { status: () => 200 };
        },
      },
    } as unknown as Page;

    await harness.authorizePage(page);

    expect(authorizationRequest).toEqual({
      requestOptions: {
        headers: {
          "x-vercel-protection-bypass": "vercel-bypass-redacted",
          "x-vercel-set-bypass-cookie": "true",
        },
      },
      url: "https://provider-rc.asksiargao.test",
    });
  });
});

function lifecycleStub<Lane extends "clerk" | "stripe">(lane: Lane, calls: string[] = []) {
  return {
    async recordScenarios(scenarios: readonly ProviderReleaseCandidateScenario<Lane>[]) {
      calls.push(`record:${scenarios.join(",")}`);
    },
    async revalidate(deployedCommitSha: string) {
      calls.push(`revalidate:${deployedCommitSha}`);
      return "database-fingerprint";
    },
    async seal(deployedCommitSha: string) {
      calls.push(`seal:${deployedCommitSha}`);
      return {
        checkedOutCommitSha: sha,
        databaseFingerprint: "database-fingerprint",
        deployedCommitSha,
        lane,
      };
    },
  };
}

function deploymentPage(deployedCommitSha: string) {
  return {
    request: {
      async get() {
        return {
          async json() {
            return { releaseCandidateSha: deployedCommitSha };
          },
          status() {
            return 200;
          },
        };
      },
    },
  } as unknown as Page;
}

function protectedEnvironment(lane: "clerk" | "stripe"): ProviderReleaseCandidateEnv {
  return {
    CLERK_PUBLISHABLE_KEY: "pk_test_redacted",
    CLERK_SECRET_KEY: "sk_test_redacted",
    CLERK_WEBHOOK_SIGNING_SECRET: lane === "clerk" ? "whsec_redacted" : undefined,
    DATABASE_URL: "postgres://provider-rc-db.test/ask_siargao_provider_rc_test",
    GITHUB_ENVIRONMENT: "provider-release-candidate",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "ametel01/ask-siargao",
    PROVIDER_RC_APP_ORIGIN: "https://provider-rc.asksiargao.test",
    PROVIDER_RC_BOUNDARY_USER: "boundary+clerk_test@example.test",
    PROVIDER_RC_CLERK_GOOGLE_EMAIL: lane === "clerk" ? "oauth@example.test" : undefined,
    PROVIDER_RC_DATABASE_ENVIRONMENT: "protected-test",
    PROVIDER_RC_DATABASE_EXPECTED_HOST: "provider-rc-db.test",
    PROVIDER_RC_DATABASE_EXPECTED_NAME: "ask_siargao_provider_rc_test",
    PROVIDER_RC_DATABASE_RESOURCE_NAME: "ask-siargao-staging",
    PROVIDER_RC_DATABASE_SENTINEL_FINGERPRINT: "sentinel",
    PROVIDER_RC_EXPECTED_SHA: sha,
    PROVIDER_RC_PRODUCTION_ORIGIN: "https://asksiargao.com",
    PROVIDER_RC_STRIPE_ACTIVE_USER:
      lane === "stripe" ? "active+clerk_test@example.test" : undefined,
    PROVIDER_RC_STRIPE_CLOSURE_USER:
      lane === "stripe" ? "closure+clerk_test@example.test" : undefined,
    PROVIDER_RC_STRIPE_REVERSED_USER:
      lane === "stripe" ? "reversed+clerk_test@example.test" : undefined,
    PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET: "vercel-bypass-redacted",
    STRIPE_RESTRICTED_KEY: "rk_test_redacted",
    STRIPE_TRIP_PASS_PRICE_ID: lane === "stripe" ? "price_test" : undefined,
    STRIPE_WEBHOOK_SECRET: lane === "stripe" ? "whsec_redacted" : undefined,
  };
}
