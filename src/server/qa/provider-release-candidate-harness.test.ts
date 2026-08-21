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
    const lemonSqueezy = createProviderReleaseCandidatePlaywrightConfig("lemon-squeezy", {
      device,
      env: protectedEnvironment("lemon-squeezy"),
      retries: 0,
    });

    for (const [lane, config] of [
      ["clerk", clerk],
      ["lemon-squeezy", lemonSqueezy],
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
    const lifecycle = lifecycleStub("lemon-squeezy", calls);
    const harness = createProtectedProviderHarness("lemon-squeezy", {
      env: protectedEnvironment("lemon-squeezy"),
      lifecycle,
    });
    const page = deploymentPage(sha);

    await harness.revalidate(page);
    await harness.recordScenarios(["test_mode_checkout_creation", "signed_webhook_ingestion"]);
    await harness.seal(page);

    expect(calls).toEqual([
      `revalidate:${sha}`,
      "record:test_mode_checkout_creation,signed_webhook_ingestion",
      `seal:${sha}`,
    ]);
  });

  test("rejects a changed deployment before lifecycle mutation", async () => {
    const calls: string[] = [];
    const harness = createProtectedProviderHarness("lemon-squeezy", {
      env: protectedEnvironment("lemon-squeezy"),
      lifecycle: lifecycleStub("lemon-squeezy", calls),
    });

    await expect(harness.revalidate(deploymentPage("b".repeat(40)))).rejects.toThrow(
      "Protected app deployment changed before the Lemon Squeezy scenario.",
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
    const harness = createProtectedProviderHarness("lemon-squeezy", {
      env: protectedEnvironment("lemon-squeezy"),
      lifecycle: lifecycleStub("lemon-squeezy"),
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

function lifecycleStub<Lane extends "clerk" | "lemon-squeezy">(lane: Lane, calls: string[] = []) {
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

function protectedEnvironment(lane: "clerk" | "lemon-squeezy"): ProviderReleaseCandidateEnv {
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
    LEMON_SQUEEZY_ALLOW_TEST_MODE: lane === "lemon-squeezy" ? "true" : undefined,
    LEMON_SQUEEZY_API_KEY: lane === "lemon-squeezy" ? "lemon_test_key" : undefined,
    LEMON_SQUEEZY_PRODUCT_ID: lane === "lemon-squeezy" ? "202" : undefined,
    LEMON_SQUEEZY_STORE_ID: lane === "lemon-squeezy" ? "101" : undefined,
    LEMON_SQUEEZY_VARIANT_ID: lane === "lemon-squeezy" ? "303" : undefined,
    LEMON_SQUEEZY_WEBHOOK_SECRET:
      lane === "lemon-squeezy" ? "lemon_test_webhook_secret" : undefined,
    PROVIDER_RC_LEMON_SQUEEZY_ACTIVE_USER:
      lane === "lemon-squeezy" ? "active+clerk_test@example.test" : undefined,
    PROVIDER_RC_LEMON_SQUEEZY_CLOSURE_USER:
      lane === "lemon-squeezy" ? "closure+clerk_test@example.test" : undefined,
    PROVIDER_RC_LEMON_SQUEEZY_DUPLICATE_USER:
      lane === "lemon-squeezy" ? "duplicate+clerk_test@example.test" : undefined,
    PROVIDER_RC_LEMON_SQUEEZY_FRAUD_USER:
      lane === "lemon-squeezy" ? "fraud+clerk_test@example.test" : undefined,
    PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET: "vercel-bypass-redacted",
  };
}
