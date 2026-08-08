import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

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
  const profile = await page.request.get("/api/me/profile");
  expect(profile.status()).toBe(200);
  expect(
    await page.evaluate(() => window.Clerk.user?.primaryEmailAddress?.verification.status),
  ).toBe("verified");

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
});

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
