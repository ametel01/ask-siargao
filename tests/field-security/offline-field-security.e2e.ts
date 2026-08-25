import AxeBuilder from "@axe-core/playwright";
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
  const responseCsp = response?.headers()["content-security-policy"] ?? "";
  expect(responseCsp).toContain("connect-src 'self'");
  expect(responseCsp).toMatch(/'nonce-[A-Za-z0-9]+'/);
  expect(responseCsp).not.toContain("unsafe-inline");
  await expect(page.getByRole("heading", { name: "Prepare this field device" })).toBeVisible();
  const readinessAccessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(readinessAccessibility.violations).toEqual([]);

  await page.evaluate(
    async ({ sentinel }) => {
      const registration = await navigator.serviceWorker.register("/field-service-worker", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      (registration.active ?? registration.installing)?.postMessage({
        activeVisit: false,
        buildId: "playwright-239",
        preparationId: "playwright-preparation-239",
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
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("ask-siargao-field-shell-active");
        const response = await cache.match("/__ask-siargao-active-field-build__");
        return response
          ? ((await response.json()) as { buildId?: string; preparationId?: string })
          : undefined;
      }),
    )
    .toEqual({ buildId: "playwright-239", preparationId: "playwright-preparation-239" });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open("ask-siargao-field-shell-playwright-239");
        const response = await cache.match("/__ask-siargao-field-shell-dependencies__");
        if (!response) return false;
        const manifest = (await response.json()) as { assets?: string[]; version?: number };
        return (
          manifest.version === 1 &&
          manifest.assets?.some((path) =>
            path.includes("/chunks/app/operator/field/offline-shell/page-"),
          ) === true &&
          (await Promise.all(manifest.assets.map((path) => cache.match(path)))).every(Boolean)
        );
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
    "Prepared offline areas: Plan, Recorder, Review, and Exports. Diagnostics and Recovery is an exceptional recovery surface.",
  );
  expect(JSON.stringify(browserStorage)).not.toContain(protectedSentinel);
  expect(requests.join("\n")).not.toContain(protectedSentinel);

  await context.setOffline(true);
  await page.goto("/operator/field/offline-shell", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Protected fieldwork is locked" })).toBeVisible();
  const lockedShellAccessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(lockedShellAccessibility.violations).toEqual([]);
  await context.setOffline(false);
});

test("consumes first-use evidence only after a challenged offline reload", async ({
  context,
  page,
}) => {
  const setupPath = "/operator/field/security-workspace";
  await page.goto(setupPath);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await indexedDB.databases()).some(
          (database) => database.name === "ask-siargao-protected-field-vault",
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Prepare offline shell" }).click();
  await expect(page.getByText(/Offline shell prepared/)).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole("button", { name: "Reload and verify offline" }).click();
  await page.waitForLoadState("domcontentloaded");
  expect(new URL(page.url()).pathname).toBe(setupPath);
  await expect(page.getByRole("heading", { name: "Protected fieldwork is locked" })).toBeVisible();
  await expect(page.getByText(/Offline hard reload verified/)).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ask-siargao-protected-field-vault");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("crypto-metadata", "readonly");
      const evidenceStore = transaction.objectStore("crypto-metadata");
      const row = await new Promise<{
        value: {
          offlineReloadChallenge?: string;
          readinessEvidence: { offlineReloadVerified: boolean };
        };
      }>((resolve, reject) => {
        const request = evidenceStore.get("field-readiness-evidence");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const finalized = await new Promise<unknown>((resolve, reject) => {
        const request = evidenceStore.get("field-readiness");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return {
        challenge: row.value.offlineReloadChallenge,
        finalized: Boolean(finalized),
        sessionChallenge: sessionStorage.getItem("ask-siargao-field-offline-reload-challenge"),
        verified: row.value.readinessEvidence.offlineReloadVerified,
      };
    }),
  ).toEqual({ challenge: undefined, finalized: false, sessionChallenge: null, verified: true });
  await expect(page.getByRole("button", { name: "Verify and unlock" })).toBeDisabled();

  await page.reload({ waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe(setupPath);
  await expect(page.getByRole("heading", { name: "Protected fieldwork is locked" })).toBeVisible();
  await expect(page.getByText(/Offline hard reload verified/)).toHaveCount(0);
  await expect(page.getByText(/not fully prepared/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify and unlock" })).toBeDisabled();
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ask-siargao-protected-field-vault");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("crypto-metadata", "readonly");
      const row = await new Promise<{
        value: {
          offlineReloadChallenge?: string;
          readinessEvidence: { offlineReloadVerified: boolean };
        };
      }>((resolve, reject) => {
        const request = transaction.objectStore("crypto-metadata").get("field-readiness-evidence");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return {
        challenge: row.value.offlineReloadChallenge,
        sessionChallenge: sessionStorage.getItem("ask-siargao-field-offline-reload-challenge"),
        verified: row.value.readinessEvidence.offlineReloadVerified,
      };
    }),
  ).toEqual({ challenge: undefined, sessionChallenge: null, verified: true });
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
