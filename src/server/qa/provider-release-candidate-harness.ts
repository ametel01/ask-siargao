import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  APIRequestContext,
  Browser,
  BrowserContextOptions,
  Page,
  PlaywrightTestConfig,
} from "@playwright/test";

import {
  assertProviderReleaseCandidateContext,
  type ProviderReleaseCandidateEnv,
  type ProviderReleaseCandidateLane,
  type ProviderReleaseCandidateScenario,
} from "@/server/qa/provider-release-candidate";

type ProviderReleaseCandidateHarnessLifecycle<Lane extends ProviderReleaseCandidateLane> = {
  recordScenarios(scenarios: readonly ProviderReleaseCandidateScenario<Lane>[]): Promise<unknown>;
  revalidate(deployedCommitSha: string): Promise<unknown>;
  seal(deployedCommitSha: string): Promise<unknown>;
};

type ProviderReleaseCandidateHarnessDependencies<Lane extends ProviderReleaseCandidateLane> = {
  env?: ProviderReleaseCandidateEnv;
  lifecycle: ProviderReleaseCandidateHarnessLifecycle<Lane>;
  providerTimeoutMs?: number;
};

type ProviderReleaseCandidateSetupDependencies = {
  env?: ProviderReleaseCandidateEnv;
  initialize(): Promise<unknown>;
  readCheckedOutCommitSha?: () => Promise<string>;
};

type ProviderReleaseCandidatePlaywrightConfigOptions = {
  device: NonNullable<PlaywrightTestConfig["projects"]>[number]["use"];
  env?: ProviderReleaseCandidateEnv;
  retries: number;
};

const execFileAsync = promisify(execFile);

export async function initializeProtectedProviderLane(
  lane: ProviderReleaseCandidateLane,
  dependencies: ProviderReleaseCandidateSetupDependencies,
) {
  const checkedOutCommitSha = await (
    dependencies.readCheckedOutCommitSha ?? readProviderReleaseCandidateHeadSha
  )();
  assertProviderReleaseCandidateContext({
    checkedOutCommitSha,
    env: dependencies.env ?? (process.env as ProviderReleaseCandidateEnv),
    lane,
  });
  await dependencies.initialize();
}

export function createProviderReleaseCandidatePlaywrightConfig(
  lane: ProviderReleaseCandidateLane,
  options: ProviderReleaseCandidatePlaywrightConfigOptions,
): PlaywrightTestConfig {
  const env = options.env ?? (process.env as ProviderReleaseCandidateEnv);
  const baseURL = required(env, "PROVIDER_RC_APP_ORIGIN", lane);
  const setupProject = `${lane} setup`;
  const setupFile = `**/${lane}.global.setup.ts`;

  return {
    testDir: "./tests/provider",
    testMatch: `**/*.${lane}.e2e.ts`,
    fullyParallel: false,
    forbidOnly: true,
    outputDir: `test-results/provider-${lane}`,
    reporter: "list",
    retries: options.retries,
    timeout: 120_000,
    workers: 1,
    use: {
      baseURL,
      // Protected sessions and testing tokens must never be persisted in CI artifacts.
      screenshot: "off",
      trace: "off",
      video: "off",
    },
    projects: [
      {
        name: setupProject,
        testMatch: setupFile,
      },
      {
        name: `${lane} protected chromium`,
        dependencies: [setupProject],
        testIgnore: setupFile,
        use: options.device,
      },
    ],
  };
}

export function createProtectedProviderHarness<Lane extends ProviderReleaseCandidateLane>(
  lane: Lane,
  dependencies: ProviderReleaseCandidateHarnessDependencies<Lane>,
) {
  const env = dependencies.env ?? (process.env as ProviderReleaseCandidateEnv);

  async function providerCall<T>(label: string, call: () => Promise<T>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (dependencies.providerTimeoutMs === undefined) return await call();
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Protected provider operation timed out.")),
            dependencies.providerTimeoutMs,
          );
        }),
      ]);
    } catch {
      throw new Error(`${label} failed without provider details.`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function readLiveDeploymentSha(page: Page) {
    const expectedSha = required(env, "PROVIDER_RC_EXPECTED_SHA", lane);
    let status = 0;
    let body: object = {};
    try {
      const response = await page.request.get("/api/me/provider-release-candidate");
      status = response.status();
      if (status === 200) body = (await response.json()) as object;
    } catch {
      // The lane-specific denial below intentionally omits response and provider details.
    }
    const deployedCommitSha =
      "releaseCandidateSha" in body && typeof body.releaseCandidateSha === "string"
        ? body.releaseCandidateSha
        : "";
    if (status !== 200 || deployedCommitSha !== expectedSha) {
      throw new Error(
        `Protected app deployment changed before the ${providerName(lane)} scenario.`,
      );
    }
    return deployedCommitSha;
  }

  async function revalidate(page: Page) {
    return dependencies.lifecycle.revalidate(await readLiveDeploymentSha(page));
  }

  async function seal(page: Page) {
    return dependencies.lifecycle.seal(await readLiveDeploymentSha(page));
  }

  async function recordScenarios(scenarios: readonly ProviderReleaseCandidateScenario<Lane>[]) {
    return dependencies.lifecycle.recordScenarios(scenarios);
  }

  async function authorizeProtectedRequest(request: APIRequestContext) {
    const response = await request.get(required(env, "PROVIDER_RC_APP_ORIGIN", lane), {
      headers: protectedDeploymentHeaders(
        required(env, "PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET", lane),
      ),
    });
    if (response.status() >= 400) {
      throw new Error(`Protected ${providerName(lane)} deployment authorization failed.`);
    }
  }

  async function authorizePage(page: Page) {
    await authorizeProtectedRequest(page.request);
  }

  function requiredEnvironment(name: string) {
    return required(env, name, lane);
  }

  async function newBrowserContext(browser: Browser) {
    const options: BrowserContextOptions = {
      baseURL: required(env, "PROVIDER_RC_APP_ORIGIN", lane),
    };
    const context = await browser.newContext(options);
    await authorizeProtectedRequest(context.request);
    return context;
  }

  return {
    authorizePage,
    newBrowserContext,
    providerCall,
    recordScenarios,
    requiredEnvironment,
    revalidate,
    seal,
  };
}

export async function readProviderReleaseCandidateHeadSha() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    throw new Error("Unable to resolve the checked-out commit.");
  }
}

function protectedDeploymentHeaders(protectionBypass: string) {
  return {
    "x-vercel-protection-bypass": protectionBypass,
    "x-vercel-set-bypass-cookie": "true",
  };
}

function required(
  env: ProviderReleaseCandidateEnv,
  name: string,
  lane: ProviderReleaseCandidateLane,
) {
  const value = (env as Record<string, string | undefined>)[name];
  if (!value) {
    throw new Error(`${name} is required for the protected ${providerName(lane)} lane.`);
  }
  return value;
}

function providerName(lane: ProviderReleaseCandidateLane) {
  return lane === "clerk" ? "Clerk" : "Stripe";
}
