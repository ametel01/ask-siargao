import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { Webhook } from "standardwebhooks";

import { clerkInstancePolicy } from "@/server/auth/clerk-instance-policy";
import { verifyLiveProviderDatabase } from "@/server/qa/provider-release-candidate-live-boundary";
import {
  recordExecutedProviderScenario,
  writeProviderFinalBoundaryReceipt,
} from "@/server/qa/provider-release-candidate-receipts";

test.describe.configure({ mode: "serial" });

const emailCodeUser = requiredTestEmail("PROVIDER_RC_CLERK_EMAIL_CODE_USER");
const closureUser = requiredTestEmail("PROVIDER_RC_CLERK_CLOSURE_USER");

test("email-code, verified-email, session persistence, route/API denial, and sign-out", async ({
  browser,
  page,
}) => {
  await assertScenarioBoundary(browser, "clerk");
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderStep("Clerk email-code sign-in", () =>
    clerk.signIn({
      page,
      signInParams: { strategy: "email_code", identifier: emailCodeUser },
    }),
  );

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings/);
  await assertLiveBoundary(page, "clerk");
  const profile = await page.request.get("/api/me/profile");
  expect(profile.status()).toBe(200);
  expect(
    await page.evaluate(() => window.Clerk.user?.primaryEmailAddress?.verification.status),
  ).toBe("verified");
  const sessionPolicyValid = await page.evaluate((maxSessionAgeDays) => {
    const session = window.Clerk.session;
    const createdAt = session?.createdAt?.getTime();
    const expireAt = session?.expireAt?.getTime();
    return Boolean(
      createdAt &&
        expireAt &&
        expireAt > createdAt &&
        expireAt - createdAt <= maxSessionAgeDays * 24 * 60 * 60 * 1_000,
    );
  }, clerkInstancePolicy.maxSessionAgeDays);
  safeAssert(sessionPolicyValid, "Protected Clerk session exceeds the seven-day maximum.");
  const webhookUser = await page.evaluate(() => {
    const user = window.Clerk.user;
    if (!user) return null;
    return {
      emailAddresses: user.emailAddresses.map((email) => ({
        email_address: email.emailAddress,
        id: email.id,
      })),
      firstName: user.firstName,
      id: user.id,
      imageUrl: user.imageUrl,
      lastName: user.lastName,
      primaryEmailAddressId: user.primaryEmailAddressId,
    };
  });
  if (!webhookUser) throw new Error("The protected Clerk session did not expose its user.");
  await assertLiveBoundary(page, "clerk");
  await deliverSignedClerkWebhook(page.request, {
    type: "user.updated",
    object: "event",
    data: {
      id: webhookUser.id,
      email_addresses: webhookUser.emailAddresses,
      first_name: webhookUser.firstName,
      last_name: webhookUser.lastName,
      image_url: webhookUser.imageUrl,
      primary_email_address_id: webhookUser.primaryEmailAddressId,
      updated_at: Date.now(),
      last_active_at: Date.now(),
    },
  });
  await assertClerkUserConverged(webhookUser.id, false, {
    email:
      webhookUser.emailAddresses.find((email) => email.id === webhookUser.primaryEmailAddressId)
        ?.email_address ?? null,
    firstName: webhookUser.firstName ?? null,
    imageUrl: webhookUser.imageUrl || null,
    lastName: webhookUser.lastName ?? null,
  });

  await assertLiveBoundary(page, "clerk");
  const accountPanel = page.locator("#account");
  await accountPanel.getByRole("button", { name: "Manage account" }).click();
  await safeProviderStep("Protected Clerk account management", () =>
    page.waitForFunction(
      () =>
        (document.querySelector("#ask-siargao-account-management-root")?.childElementCount ?? 0) >
          0 || Boolean(document.querySelector(".cl-userProfile-root")),
    ),
  );
  await page.keyboard.press("Escape");

  const persisted = await page.context().newPage();
  await persisted.goto("/settings");
  expect((await persisted.request.get("/api/me/profile")).status()).toBe(200);

  const anonymousContext = await newProtectedContext(browser);
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto("/settings");
  // Clerk's protected-route perimeter hides the API before its handler-level 401 can run.
  expect((await anonymous.request.get("/api/me/profile")).status()).toBe(404);
  await anonymousContext.close();

  await safeProviderStep("Clerk sign-out", () => clerk.signOut({ page }));
  expect((await page.request.get("/api/me/profile")).status()).toBe(404);
  await recordScenarios([
    "email_code_sign_in",
    "verified_email",
    "session_persistence_and_policy",
    "route_and_api_denial",
    "sign_out",
    "webhook_convergence",
    "profile_convergence",
    "account_management",
  ]);
});

test("Google OAuth is offered by the dedicated Clerk test instance", async ({ browser, page }) => {
  await assertScenarioBoundary(browser, "clerk");
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  const googleIcon = page.getByRole("img", { name: /sign in with google/i });
  const google = page.getByRole("button").filter({ has: googleIcon });
  await expect(google).toHaveCount(1);
  await expect(google).toBeVisible();
  await google.click();
  await safeProviderStep("Google OAuth redirect", () =>
    page.waitForURL((url) => url.hostname === "accounts.google.com"),
  );
  safeAssert(
    page.url().startsWith("https://accounts.google.com/"),
    "Google OAuth did not reach the configured provider.",
  );
  await safeProviderStep("Google OAuth callback", () => completeGoogleOAuth(page));
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(required("PROVIDER_RC_APP_ORIGIN"))}`));
  expect((await page.request.get("/api/me/profile")).status()).toBe(200);
  const verifiedGoogleAccount = await page.evaluate(() =>
    window.Clerk.user?.externalAccounts.some(
      (account) => account.provider === "google" && account.verification?.status === "verified",
    ),
  );
  expect(verifiedGoogleAccount).toBe(true);
  await safeProviderStep("Clerk sign-out", () => clerk.signOut({ page }));
  expect((await page.request.get("/api/me/profile")).status()).toBe(404);
  await recordScenarios(["google_sign_in"]);
});

async function completeGoogleOAuth(page: Page) {
  const email = page.locator('input[type="email"]');
  await expect(email).toBeVisible();
  await email.fill(required("PROVIDER_RC_CLERK_GOOGLE_EMAIL"));
  await page.getByRole("button", { name: /^next$/i }).click();

  const password = page.locator('input[type="password"]');
  await expect(password).toBeVisible();
  await password.fill(required("PROVIDER_RC_CLERK_GOOGLE_PASSWORD"));
  await page.getByRole("button", { name: /^next$/i }).click();

  if (/challenge|captcha/i.test(page.url())) {
    throw new Error("Google OAuth proof requires a challenge-free dedicated test account.");
  }
  const consent = page.getByRole("button", { name: /^(continue|allow)$/i });
  if (await consent.isVisible({ timeout: 5_000 }).catch(() => false)) await consent.click();
  await page.waitForURL(
    (url) => url.origin === new URL(required("PROVIDER_RC_APP_ORIGIN")).origin,
    { timeout: 90_000 },
  );
  if (/challenge|captcha/i.test(page.url())) {
    throw new Error("Google OAuth provider callback did not complete.");
  }
}

test("single-session policy invalidates the older browser session", async ({ browser }) => {
  await assertScenarioBoundary(browser, "clerk");
  const firstContext = await newProtectedContext(browser);
  const first = await firstContext.newPage();
  await setupClerkTestingToken({ page: first });
  await first.goto("/sign-in");
  await safeProviderStep("First Clerk session sign-in", () =>
    clerk.signIn({ page: first, emailAddress: emailCodeUser }),
  );
  expect((await first.request.get("/api/me/profile")).status()).toBe(200);

  const secondContext = await newProtectedContext(browser);
  const second = await secondContext.newPage();
  await setupClerkTestingToken({ page: second });
  await second.goto("/sign-in");
  await safeProviderStep("Second Clerk session sign-in", () =>
    clerk.signIn({ page: second, emailAddress: emailCodeUser }),
  );
  expect((await second.request.get("/api/me/profile")).status()).toBe(200);
  await expect.poll(async () => (await first.request.get("/api/me/profile")).status()).toBe(404);

  await secondContext.close();
  await firstContext.close();
  await recordScenarios(["single_session"]);
});

test("ownership denial precedes terminal step-up closure and provider deletion convergence", async ({
  page,
}) => {
  await assertScenarioBoundary(page.context().browser(), "clerk");
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderStep("Closure-user Clerk sign-in", () =>
    clerk.signIn({ page, emailAddress: closureUser }),
  );
  const closingUserId = await page.evaluate(() => window.Clerk.user?.id ?? null);
  if (!closingUserId) throw new Error("The closure session did not expose its Clerk user.");

  const foreignItemId = process.env.PROVIDER_RC_FOREIGN_SAVED_ITEM_ID;
  if (!foreignItemId) throw new Error("PROVIDER_RC_FOREIGN_SAVED_ITEM_ID is required.");
  const ownershipResponse = await page.request.delete(`/api/trips/saved/${foreignItemId}`, {
    headers: { origin: new URL(required("PROVIDER_RC_APP_ORIGIN")).origin },
  });
  expect([403, 404]).toContain(ownershipResponse.status());

  await page.goto("/settings#privacy");
  await page.getByRole("button", { name: "Close Account", exact: true }).click();
  await page.getByLabel("Account Closure confirmation").fill("CLOSE MY ACCOUNT");
  await page.getByRole("button", { name: "Close Account permanently" }).click();
  await expect.poll(async () => (await page.request.get("/api/me/profile")).status()).toBe(404);
  await deliverSignedClerkWebhook(page.request, {
    type: "user.deleted",
    object: "event",
    data: { id: closingUserId, deleted: true, object: "user" },
  });
  await assertClerkUserConverged(closingUserId, true);
  await recordScenarios(["ownership_denial", "step_up_account_closure"]);
});

test("final live boundary matches immediately before Clerk evidence", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderStep("Final Clerk boundary sign-in", () =>
    clerk.signIn({ page, emailAddress: requiredTestEmail("PROVIDER_RC_BOUNDARY_USER") }),
  );
  const databaseFingerprint = await assertLiveBoundary(page, "clerk");
  await writeProviderFinalBoundaryReceipt({
    checkedOutCommitSha: required("PROVIDER_RC_EXPECTED_SHA"),
    databaseFingerprint,
    deployedCommitMatched: true,
    lane: "clerk",
  });
});

async function recordScenarios(scenarios: string[]) {
  for (const scenario of scenarios) {
    await recordExecutedProviderScenario({
      checkedOutCommitSha: required("PROVIDER_RC_EXPECTED_SHA"),
      lane: "clerk",
      scenario,
    });
  }
}

async function assertScenarioBoundary(browser: Browser | null, lane: "clerk") {
  if (!browser) throw new Error("Protected boundary browser is unavailable.");
  const context = await newProtectedContext(browser);
  const boundary = await context.newPage();
  try {
    await safeProviderStep("Clerk boundary testing token", () =>
      setupClerkTestingToken({ page: boundary }),
    );
    const navigation = await safeProviderStep("Clerk boundary navigation", () =>
      boundary.goto("/sign-in", { waitUntil: "domcontentloaded" }),
    );
    safeAssert(
      navigation !== null && navigation.status() < 400,
      "Protected Clerk boundary navigation was denied.",
    );
    await safeProviderStep("Clerk boundary readiness", () =>
      boundary.waitForFunction(() => window.Clerk?.loaded === true),
    );
    await safeProviderStep("Clerk boundary sign-in", () =>
      clerk.signIn({
        page: boundary,
        emailAddress: requiredTestEmail("PROVIDER_RC_BOUNDARY_USER"),
      }),
    );
    await safeProviderStep("Clerk boundary live deployment", () =>
      assertLiveBoundary(boundary, lane),
    );
    await safeProviderStep("Clerk boundary sign-out", () => clerk.signOut({ page: boundary }));
  } finally {
    await context.close().catch(() => undefined);
  }
}

function newProtectedContext(browser: Browser) {
  const protectionBypass = required("PROVIDER_RC_VERCEL_AUTOMATION_BYPASS_SECRET");
  return browser.newContext({
    baseURL: required("PROVIDER_RC_APP_ORIGIN"),
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true",
    },
  });
}

async function assertLiveBoundary(page: Page, lane: "clerk") {
  const response = await page.request.get("/api/me/provider-release-candidate");
  const body = response.status() === 200 ? ((await response.json()) as object) : {};
  safeAssert(
    response.status() === 200 &&
      "releaseCandidateSha" in body &&
      body.releaseCandidateSha === required("PROVIDER_RC_EXPECTED_SHA"),
    "Protected app deployment changed before the Clerk scenario.",
  );
  const database = await verifyLiveProviderDatabase({
    checkedOutCommitSha: required("PROVIDER_RC_EXPECTED_SHA"),
    compareInitialReceipt: true,
    lane,
  });
  return database.deployedMigrationLedgerFingerprint;
}

async function safeProviderStep<T>(label: string, step: () => Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      step(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Provider step timed out.")), 20_000);
      }),
    ]);
  } catch {
    throw new Error(`${label} failed without provider details.`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function safeAssert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function deliverSignedClerkWebhook(request: APIRequestContext, event: object) {
  const payload = JSON.stringify(event);
  const messageId = crypto.randomUUID();
  const timestamp = new Date();
  const signature = new Webhook(required("CLERK_WEBHOOK_SIGNING_SECRET")).sign(
    messageId,
    timestamp,
    payload,
  );
  const response = await request.post("/api/clerk/webhooks", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-signature": signature,
      "svix-timestamp": Math.floor(timestamp.getTime() / 1_000).toString(),
      "webhook-id": messageId,
      "webhook-signature": signature,
      "webhook-timestamp": Math.floor(timestamp.getTime() / 1_000).toString(),
    },
  });
  expect(response.status()).toBe(200);
}

async function assertClerkUserConverged(
  userId: string,
  deleted: boolean,
  expected?: {
    email: string | null;
    firstName: string | null;
    imageUrl: string | null;
    lastName: string | null;
  },
) {
  const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
  try {
    await expect
      .poll(async () => {
        const rows = await sql<{ converged: boolean }[]>`
          select exists (
            select 1 from users
            where id = ${userId}
              and deleted_at is null
              and (${expected === undefined} or email is not distinct from ${expected?.email ?? null})
              and (${expected === undefined} or first_name is not distinct from ${expected?.firstName ?? null})
              and (${expected === undefined} or last_name is not distinct from ${expected?.lastName ?? null})
              and (${expected === undefined} or image_url is not distinct from ${expected?.imageUrl ?? null})
          ) = ${!deleted} as converged
        `;
        return rows[0]?.converged ?? false;
      })
      .toBe(true);
  } finally {
    await sql.end();
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the protected Clerk lane.`);
  return value;
}

function requiredTestEmail(name: string) {
  const value = required(name);
  if (!value.includes("+clerk_test@")) {
    throw new Error(`${name} must identify a dedicated +clerk_test user.`);
  }
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
