import { expect, test } from "@playwright/test";

test("production Desk routes remain private, no-store, and visibly distinguish transfer completion", async ({
  page,
}) => {
  const protectedSentinel = "PROTECTED_TRANSFER_SENTINEL_NEVER_LEAVE_242";
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const review = await page.goto("/operator/field/review");
  expect(review?.status()).toBe(200);
  expect(review?.headers()["cache-control"]).toContain("no-store");
  expect(review?.headers()["content-security-policy"]).toContain("connect-src 'self'");
  await expect(page.getByRole("heading", { name: "Field review" })).toBeVisible();

  await page.evaluate((sentinel) => {
    Object.defineProperty(window, "__fieldTransferSentinel", { value: sentinel });
  }, protectedSentinel);
  const exportsResponse = await page.goto("/operator/field/exports");
  expect(exportsResponse?.status()).toBe(200);
  await expect(
    page.getByText("A copied file is not a Verified Field Transfer", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Recovery Export" })).toBeDisabled();
  await expect(page.getByText("Not created", { exact: true })).toBeVisible();
  expect(requests.join("\n")).not.toContain(protectedSentinel);
});

test("hard offline reloads of Review and Exports resolve to the generic locked shell", async ({
  context,
  page,
}) => {
  await page.goto("/operator/field/security-workspace");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/field-service-worker", {
      scope: "/",
    });
    await navigator.serviceWorker.ready;
    (registration.active ?? registration.installing)?.postMessage({
      activeVisit: false,
      buildId: "playwright-242",
      shellPath: "/operator/field/offline-shell",
      type: "PREPARE_FIELD_OFFLINE",
    });
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await caches.keys()).includes("ask-siargao-field-shell-playwright-242"),
      ),
    )
    .toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await context.setOffline(true);
  for (const path of ["/operator/field/review", "/operator/field/exports"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Protected fieldwork is locked" }),
    ).toBeVisible();
  }
  await context.setOffline(false);
});
