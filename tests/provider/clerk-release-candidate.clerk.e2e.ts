import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { Webhook } from "standardwebhooks";

test.describe.configure({ mode: "serial" });

const emailCodeUser = requiredTestEmail("PROVIDER_RC_CLERK_EMAIL_CODE_USER");
const closureUser = requiredTestEmail("PROVIDER_RC_CLERK_CLOSURE_USER");

test("email-code, verified-email, session persistence, route/API denial, and sign-out", async ({
  browser,
  page,
}) => {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: { strategy: "email_code", identifier: emailCodeUser },
  });

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings/);
  await assertExactProtectedDeployment(page.request);
  const profile = await page.request.get("/api/me/profile");
  expect(profile.status()).toBe(200);
  expect(
    await page.evaluate(() => window.Clerk.user?.primaryEmailAddress?.verification.status),
  ).toBe("verified");
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
  await assertClerkUserConverged(webhookUser.id, false);

  const persisted = await page.context().newPage();
  await persisted.goto("/settings");
  expect((await persisted.request.get("/api/me/profile")).status()).toBe(200);

  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto("/settings");
  expect((await anonymous.request.get("/api/me/profile")).status()).toBe(401);
  await anonymousContext.close();

  await clerk.signOut({ page });
  expect((await page.request.get("/api/me/profile")).status()).toBe(401);
});

test("Google OAuth is offered by the dedicated Clerk test instance", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  const google = page.getByRole("button", { name: /continue with google/i });
  await expect(google).toBeVisible();
  await google.click();
  await expect(page).toHaveURL(/accounts\.google\.com|clerk\.accounts\.dev/);

  await page.goto("/");
  await clerk.signIn({ page, emailAddress: required("PROVIDER_RC_CLERK_GOOGLE_USER") });
  const verifiedGoogleAccount = await page.evaluate(() =>
    window.Clerk.user?.externalAccounts.some(
      (account) => account.provider === "google" && account.verification?.status === "verified",
    ),
  );
  expect(verifiedGoogleAccount).toBe(true);
});

test("single-session policy invalidates the older browser session", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const first = await firstContext.newPage();
  await setupClerkTestingToken({ page: first });
  await first.goto("/");
  await clerk.signIn({ page: first, emailAddress: emailCodeUser });
  expect((await first.request.get("/api/me/profile")).status()).toBe(200);

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await setupClerkTestingToken({ page: second });
  await second.goto("/");
  await clerk.signIn({ page: second, emailAddress: emailCodeUser });
  expect((await second.request.get("/api/me/profile")).status()).toBe(200);
  await expect.poll(async () => (await first.request.get("/api/me/profile")).status()).toBe(401);

  await secondContext.close();
  await firstContext.close();
});

test("ownership denial precedes terminal step-up closure and provider deletion convergence", async ({
  page,
}) => {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: closureUser });
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
  await expect.poll(async () => (await page.request.get("/api/me/profile")).status()).toBe(401);
  await deliverSignedClerkWebhook(page.request, {
    type: "user.deleted",
    object: "event",
    data: { id: closingUserId, deleted: true, object: "user" },
  });
  await assertClerkUserConverged(closingUserId, true);
});

async function assertExactProtectedDeployment(request: APIRequestContext) {
  const response = await request.get("/api/me/provider-release-candidate");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { releaseCandidateSha?: string };
  expect(body.releaseCandidateSha).toBe(required("PROVIDER_RC_EXPECTED_SHA"));
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

async function assertClerkUserConverged(userId: string, deleted: boolean) {
  const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
  try {
    await expect
      .poll(async () => {
        const rows = await sql<{ converged: boolean }[]>`
          select exists (
            select 1 from users
            where id = ${userId}
              and deleted_at is null
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
