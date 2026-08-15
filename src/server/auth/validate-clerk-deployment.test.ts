import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const productionOrigin = "https://asksiargao.com";
const stagingOrigin = "https://staging.asksiargao.com";
const productionProjectUrl = "asksiargao.com";
const productionVercelUrl = "ask-siargao-production-a1b2c3.vercel.app";
const stagingBranch = "protected-staging";
const stagingTargetEnv = "staging";
const vercelProjectId = "prj_askSiargaoStableProject";
const validationScript = fileURLToPath(new URL("./validate-clerk-deployment.ts", import.meta.url));

const completeProductionEnv = {
  CHAT_MODEL_PROVIDER: "openai",
  CLERK_AUTH_MODE: "enabled",
  CLERK_AUTHORIZED_PARTIES: `${productionOrigin},${stagingOrigin}`,
  CLERK_DEPLOYMENT_CONTEXT: "production",
  CLERK_PRODUCTION_ORIGIN: productionOrigin,
  CLERK_PROTECTED_STAGING_GIT_COMMIT_REF: stagingBranch,
  CLERK_PROTECTED_STAGING_ORIGIN: stagingOrigin,
  CLERK_PROTECTED_STAGING_VERCEL_TARGET_ENV: stagingTargetEnv,
  CLERK_SECRET_KEY: "sk_live_never_print",
  CLERK_VERCEL_PROJECT_ID: vercelProjectId,
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_never_print",
  NEXT_PUBLIC_APP_URL: productionOrigin,
  NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
  OPENAI_API_KEY: "sk-openai-never-print",
  OPEN_METEO_API_MODE: "off",
  REDIS_URL: "rediss://production.example.test:6379",
  TIDE_FORECAST_MODE: "off",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: vercelProjectId,
  VERCEL_PROJECT_PRODUCTION_URL: productionProjectUrl,
  VERCEL_URL: productionVercelUrl,
} as const;

describe("Clerk deployment validation command", () => {
  test("passes a complete production matrix without printing secrets", async () => {
    const result = await runValidationCommand(completeProductionEnv);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("production/enabled");
    expect(result.stderr).not.toContain("sk_live_never_print");
    expect(result.stderr).not.toContain("whsec_never_print");
    expect(result.stderr).not.toContain("sk-openai-never-print");
  });

  test("passes production redeploys with changed generated Vercel URLs", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      VERCEL_URL: "ask-siargao-production-x9y8z7.vercel.app",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("production/enabled");
  });

  test("passes a complete bounded production public-web configuration", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      WEB_RESEARCH_PROVIDER: "openai",
      WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE: "true",
      OPENAI_DAILY_USD_LIMIT: "10",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("public-web research openai");
    expect(result.stdout).not.toContain("sk-openai-never-print");
  });

  test("fails incomplete production public-web configuration before startup", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      WEB_RESEARCH_PROVIDER: "openai",
      WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE: "false",
      OPENAI_DAILY_USD_LIMIT: "10",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("WEB_RESEARCH_SECURITY_BOUNDARY_COMPLETE");
    expect(result.stderr).not.toContain("sk-openai-never-print");
  });

  test("passes when Vercel selects the root project domain for a www canonical origin", async () => {
    const canonicalOrigin = "https://www.asksiargao.com";
    const result = await runValidationCommand({
      ...completeProductionEnv,
      CLERK_AUTHORIZED_PARTIES: `${canonicalOrigin},${stagingOrigin}`,
      CLERK_PRODUCTION_ORIGIN: canonicalOrigin,
      NEXT_PUBLIC_APP_URL: canonicalOrigin,
      VERCEL_PROJECT_PRODUCTION_URL: "asksiargao.com",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("production/enabled");
  });

  test("fails missing production mode before a request can be served", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      CLERK_AUTH_MODE: undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing_clerk_auth_mode");
    expect(result.stderr).not.toContain("sk_live_never_print");
  });

  test("fails partial enabled production configuration before startup", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      CLERK_SECRET_KEY: undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLERK_SECRET_KEY");
    expect(result.stderr).toContain("missing_required_clerk_field");
  });

  test("does not hydrate missing production secrets from local environment files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ask-siargao-clerk-validation-"));
    const localEnvMarker = `test-env-marker-${randomUUID()}`;

    try {
      await writeFile(join(cwd, ".env.local"), `CLERK_SECRET_KEY=${localEnvMarker}\n`);

      const result = await runValidationCommand(
        {
          ...completeProductionEnv,
          CLERK_SECRET_KEY: undefined,
        },
        cwd,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("CLERK_SECRET_KEY");
      expect(result.stderr).toContain("missing_required_clerk_field");
      expect(result.stderr).not.toContain(localEnvMarker);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });

  test("fails contradictory Vercel production pretending to be local and disabled", async () => {
    const result = await runValidationCommand({
      CLERK_AUTH_MODE: "disabled",
      CLERK_DEPLOYMENT_CONTEXT: "local",
      NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
      VERCEL_ENV: "production",
      VERCEL_URL: productionVercelUrl,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("vercel_production_context_mismatch");
  });

  test("fails complete production config when VERCEL_ENV is absent", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      VERCEL_ENV: undefined,
      VERCEL_URL: productionVercelUrl,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("production_platform_context_mismatch");
  });

  test("fails ordinary previews pretending to be protected staging with live secrets", async () => {
    const result = await runValidationCommand({
      ...completeProductionEnv,
      CLERK_DEPLOYMENT_CONTEXT: "protected-staging",
      NEXT_PUBLIC_APP_URL: stagingOrigin,
      VERCEL_ENV: "preview",
      VERCEL_URL: "random-preview.vercel.app",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing_vercel_target_env");
    expect(result.stderr).not.toContain("sk_live_never_print");
  });

  test("fails local protected UI harness config with Vercel deployment signals", async () => {
    const result = await runValidationCommand({
      CLERK_AUTH_MODE: "disabled",
      CLERK_DEPLOYMENT_CONTEXT: "local",
      NEXT_PUBLIC_CLERK_AUTH_MODE: "disabled",
      PLAYWRIGHT_PROTECTED_UI_HARNESS: "1",
      PLAYWRIGHT_PROTECTED_UI_HARNESS_TOKEN: "local-test-harness-token-1234567890",
      VERCEL_PROJECT_ID: vercelProjectId,
      VERCEL_PROJECT_PRODUCTION_URL: productionProjectUrl,
      VERCEL_URL: productionVercelUrl,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("protected_ui_harness_platform_signal");
  });
});

async function runValidationCommand(env: Record<string, string | undefined>, cwd = process.cwd()) {
  const subprocess = Bun.spawn([process.execPath, "--no-env-file", "run", validationScript], {
    cwd,
    env: commandEnv(env),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return { exitCode, stderr, stdout };
}

function commandEnv(overrides: Record<string, string | undefined>) {
  const preservedPathEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["BUN_INSTALL", "HOME", "PATH", "SHELL", "TMPDIR"].includes(key),
    ),
  ) as Record<string, string>;

  return {
    ...preservedPathEnv,
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  };
}
