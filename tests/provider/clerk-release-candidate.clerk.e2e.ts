import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { APIRequestContext, Browser } from "@playwright/test";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { Webhook } from "standardwebhooks";

import { clerkInstancePolicy } from "@/server/auth/clerk-instance-policy";
import { requireVerifiedGoogleOAuthIdentity } from "@/server/qa/clerk-google-oauth-identity";
import { createLiveProtectedProviderHarness } from "@/server/qa/provider-release-candidate-live-boundary";

test.describe.configure({ mode: "serial" });

const providerHarness = await createLiveProtectedProviderHarness("clerk", {
  providerTimeoutMs: 20_000,
});
const {
  authorizePage: authorizeProtectedPage,
  newBrowserContext: newProtectedContext,
  providerCall: safeProviderStep,
  recordScenarios,
  requiredEnvironment,
  revalidate: assertLiveBoundary,
} = providerHarness;
const emailCodeUser = requiredTestEmail("PROVIDER_RC_CLERK_EMAIL_CODE_USER");
const closureUser = requiredTestEmail("PROVIDER_RC_CLERK_CLOSURE_USER");
const googleOAuthUser = requiredEnvironment("PROVIDER_RC_CLERK_GOOGLE_EMAIL");

test.beforeEach(async ({ page }) => {
  await authorizeProtectedPage(page);
});

test("email-code, verified-email, session persistence, route/API denial, and sign-out", async ({
  browser,
  page,
}) => {
  await assertScenarioBoundary(browser);
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
  await assertLiveBoundary(page);
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
  await assertLiveBoundary(page);
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

  await assertLiveBoundary(page);
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

test("Google OAuth is offered and the linked identity remains verified", async ({
  browser,
  page,
}) => {
  await assertScenarioBoundary(browser);
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  const googleIcon = page.locator('[aria-label="Sign in with Google"]');
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
  const googleIdentity = await safeProviderStep("Clerk verified Google identity", async () => {
    const users = await createClerkClient({
      secretKey: requiredEnvironment("CLERK_SECRET_KEY"),
    }).users.getUserList({ emailAddress: [googleOAuthUser], limit: 2 });
    return requireVerifiedGoogleOAuthIdentity({
      expectedEmail: googleOAuthUser,
      totalCount: users.totalCount,
      users: users.data,
    });
  });

  const googleContext = await newProtectedContext(browser);
  try {
    const googleSession = await googleContext.newPage();
    await setupClerkTestingToken({ page: googleSession });
    await googleSession.goto("/sign-in");
    await safeProviderStep("Clerk linked Google identity sign-in", () =>
      clerk.signIn({ page: googleSession, emailAddress: googleOAuthUser }),
    );
    expect((await googleSession.request.get("/api/me/profile")).status()).toBe(200);
    const authenticatedGoogleIdentity = await googleSession.evaluate(() => ({
      id: window.Clerk.user?.id,
      verifiedGoogleAccount: window.Clerk.user?.externalAccounts.some(
        (account) => account.provider === "google" && account.verification?.status === "verified",
      ),
    }));
    expect(authenticatedGoogleIdentity).toEqual({
      id: googleIdentity.id,
      verifiedGoogleAccount: true,
    });
    await safeProviderStep("Clerk sign-out", () => clerk.signOut({ page: googleSession }));
    expect((await googleSession.request.get("/api/me/profile")).status()).toBe(404);
  } finally {
    await googleContext.close().catch(() => undefined);
  }
  await recordScenarios(["google_sign_in"]);
});

test("single-session policy rejects adding a second account to one browser", async ({
  browser,
}) => {
  await assertScenarioBoundary(browser);
  const context = await newProtectedContext(browser);
  try {
    const page = await context.newPage();
    await setupClerkTestingToken({ page });
    await page.goto("/sign-in");
    await safeProviderStep("First Clerk account sign-in", () =>
      clerk.signIn({ page, emailAddress: emailCodeUser }),
    );
    expect((await page.request.get("/api/me/profile")).status()).toBe(200);
    const originalSession = await page.evaluate(() => ({
      sessionCount: window.Clerk.client?.sessions.length,
      sessionId: window.Clerk.session?.id,
      userId: window.Clerk.user?.id,
    }));
    expect(originalSession.sessionCount).toBe(1);
    safeAssert(
      Boolean(originalSession.sessionId && originalSession.userId),
      "The first Clerk account did not establish a complete browser session.",
    );

    await safeProviderStep("Second Clerk account rejection", async () => {
      await expect(
        clerk.signIn({
          page,
          emailAddress: requiredTestEmail("PROVIDER_RC_BOUNDARY_USER"),
        }),
      ).rejects.toThrow(/already signed in/i);
    });
    const retainedSession = await page.evaluate(() => ({
      sessionCount: window.Clerk.client?.sessions.length,
      sessionId: window.Clerk.session?.id,
      userId: window.Clerk.user?.id,
    }));
    expect(retainedSession).toEqual(originalSession);
    expect((await page.request.get("/api/me/profile")).status()).toBe(200);
    await safeProviderStep("Single-session Clerk sign-out", () => clerk.signOut({ page }));
    expect((await page.request.get("/api/me/profile")).status()).toBe(404);
  } finally {
    await context.close().catch(() => undefined);
  }
  await recordScenarios(["single_session"]);
});

test("ownership denial precedes terminal step-up closure", async ({ page }) => {
  await assertScenarioBoundary(page.context().browser());
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderStep("Closure-user Clerk sign-in", () =>
    clerk.signIn({ page, emailAddress: closureUser }),
  );
  const foreignItemId = process.env.PROVIDER_RC_FOREIGN_SAVED_ITEM_ID;
  if (!foreignItemId) throw new Error("PROVIDER_RC_FOREIGN_SAVED_ITEM_ID is required.");
  const ownershipResponse = await page.request.delete(`/api/trips/saved/${foreignItemId}`, {
    headers: { origin: new URL(requiredEnvironment("PROVIDER_RC_APP_ORIGIN")).origin },
  });
  expect([403, 404]).toContain(ownershipResponse.status());

  await page.goto("/settings#privacy");
  await page.getByRole("button", { name: "Close Account", exact: true }).click();
  await page.getByLabel("Account Closure confirmation").fill("CLOSE MY ACCOUNT");
  await page.getByRole("button", { name: "Close Account permanently" }).click();
  await expect
    .poll(async () => isTerminalAuthDenial((await page.request.get("/api/me/profile")).status()))
    .toBe(true);
  await recordScenarios(["ownership_denial", "step_up_account_closure"]);
});

test("final live boundary matches immediately before Clerk evidence", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await safeProviderStep("Final Clerk boundary sign-in", () =>
    clerk.signIn({ page, emailAddress: requiredTestEmail("PROVIDER_RC_BOUNDARY_USER") }),
  );
  await providerHarness.seal(page);
});

async function assertScenarioBoundary(browser: Browser | null) {
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
    await safeProviderStep("Clerk boundary live deployment", () => assertLiveBoundary(boundary));
    await safeProviderStep("Clerk boundary sign-out", () => clerk.signOut({ page: boundary }));
  } finally {
    await context.close().catch(() => undefined);
  }
}

function safeAssert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isTerminalAuthDenial(status: number) {
  return status === 401 || status === 404;
}

async function deliverSignedClerkWebhook(request: APIRequestContext, event: object) {
  const payload = JSON.stringify(event);
  const messageId = crypto.randomUUID();
  const timestamp = new Date();
  const signature = new Webhook(requiredEnvironment("CLERK_WEBHOOK_SIGNING_SECRET")).sign(
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
  const sql = postgres(requiredEnvironment("DATABASE_URL"), { max: 1, prepare: false });
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

function requiredTestEmail(name: string) {
  const value = requiredEnvironment(name);
  if (!value.includes("+clerk_test@")) {
    throw new Error(`${name} must identify a dedicated +clerk_test user.`);
  }
  return value;
}
