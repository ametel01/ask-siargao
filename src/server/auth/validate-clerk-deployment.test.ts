import { describe, expect, test } from "bun:test";

const productionOrigin = "https://asksiargao.com";
const stagingOrigin = "https://staging.asksiargao.com";
const productionVercelUrl = "ask-siargao-production.vercel.app";
const stagingVercelUrl = "ask-siargao-staging.vercel.app";

const completeProductionEnv = {
  CLERK_AUTH_MODE: "enabled",
  CLERK_AUTHORIZED_PARTIES: `${productionOrigin},${stagingOrigin}`,
  CLERK_DEPLOYMENT_CONTEXT: "production",
  CLERK_PRODUCTION_ORIGIN: productionOrigin,
  CLERK_PRODUCTION_VERCEL_URL: productionVercelUrl,
  CLERK_PROTECTED_STAGING_ORIGIN: stagingOrigin,
  CLERK_PROTECTED_STAGING_VERCEL_URL: stagingVercelUrl,
  CLERK_SECRET_KEY: "sk_live_never_print",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_never_print",
  NEXT_PUBLIC_APP_URL: productionOrigin,
  NEXT_PUBLIC_CLERK_AUTH_MODE: "enabled",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_public",
  VERCEL_ENV: "production",
  VERCEL_URL: productionVercelUrl,
} as const;

describe("Clerk deployment validation command", () => {
  test("passes a complete production matrix without printing secrets", async () => {
    const result = await runValidationCommand(completeProductionEnv);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("production/enabled");
    expect(result.stderr).not.toContain("sk_live_never_print");
    expect(result.stderr).not.toContain("whsec_never_print");
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
    expect(result.stderr).toContain("vercel_deployment_url_mismatch");
    expect(result.stderr).not.toContain("sk_live_never_print");
  });
});

async function runValidationCommand(env: Record<string, string | undefined>) {
  const subprocess = Bun.spawn(
    [process.execPath, "run", "src/server/auth/validate-clerk-deployment.ts"],
    {
      cwd: process.cwd(),
      env: commandEnv(env),
      stderr: "pipe",
      stdout: "pipe",
    },
  );

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
