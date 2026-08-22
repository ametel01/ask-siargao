import { expect, test } from "@playwright/test";

test("prepares an identity-free shell and hard reloads offline without leakage", async ({
  context,
  page,
}) => {
  const protectedSentinel = "PROTECTED_FIELD_SENTINEL_NEVER_LEAVE_239";
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const response = await page.goto("/operator/field/security-workspace");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["content-security-policy"]).toContain("connect-src 'self'");
  await expect(page.getByRole("heading", { name: "Prepare this field device" })).toBeVisible();

  await page.evaluate(
    async ({ sentinel }) => {
      const registration = await navigator.serviceWorker.register("/field-service-worker", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      (registration.active ?? registration.installing)?.postMessage({
        activeVisit: false,
        buildId: "playwright-239",
        shellPath: "/operator/field/offline-shell",
        type: "PREPARE_FIELD_OFFLINE",
      });
      localStorage.setItem("unrelated-test-control", "ordinary-control");
      Object.defineProperty(window, "__fieldSentinel", { value: sentinel });
    },
    { sentinel: protectedSentinel },
  );

  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await caches.keys()).some((key) => key === "ask-siargao-field-shell-playwright-239"),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("ask-siargao-field-shell-playwright-239");
        return Boolean(await cache.match("/operator/field/offline-shell"));
      }),
    )
    .toBe(true);

  const browserStorage = await page.evaluate(async () => {
    const cacheBodies: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const response of await cache.matchAll()) cacheBodies.push(await response.text());
    }
    return {
      cacheBodies,
      cookies: document.cookie,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    };
  });
  expect(browserStorage.cacheBodies.join("\n")).toContain("Evidence station");
  expect(browserStorage.cacheBodies.join("\n")).toContain(
    "Prepared offline areas: Recorder, Review, and Exports",
  );
  expect(JSON.stringify(browserStorage)).not.toContain(protectedSentinel);
  expect(requests.join("\n")).not.toContain(protectedSentinel);

  await context.setOffline(true);
  await page.goto("/operator/field/offline-shell", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Protected fieldwork is locked" })).toBeVisible();
  await context.setOffline(false);
});

test("worker bypasses unrelated routes, APIs, RSC and blobs", async ({ page }) => {
  const script = await (await page.request.get("/field-service-worker")).text();
  expect(script).toContain('url.pathname.startsWith("/api/")');
  expect(script).toContain('url.searchParams.has("_rsc")');
  expect(script).toContain('url.pathname.startsWith("/operator/field/")');
  expect(script).not.toContain("backgroundsync");
  expect(script).not.toContain("periodicsync");
  expect(script.match(/self\.skipWaiting\(\)/g)).toHaveLength(1);
  expect(script).toContain('data.type === "ACTIVATE_SAFE_FIELD_UPDATE" && activeVisit === false');
  expect(script).toContain('data.type === "FIELD_VISIT_STATE"');
  expect(script).toContain("activeVisit = data.activeVisit");
  expect(script).toContain("let activeVisit = true");
  expect(script.match(/self\.addEventListener\("install",[\s\S]*?\}\);/)?.[0]).not.toContain(
    "skipWaiting",
  );
});
