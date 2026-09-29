import { expect, test } from "@playwright/test";

const harnessHeaders = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

test.use({ trace: "off" });

test("keeps a dynamic protected-data canary out of every observable Field egress", async ({
  page,
}) => {
  const sentinel = `field-private-${crypto.randomUUID()}-${Date.now()}`;
  let networkLeak = false;
  let sinkLeak = false;

  page.on("request", (request) => {
    networkLeak ||= containsSentinel(
      [request.url(), request.postData() ?? "", JSON.stringify(request.headers())].join("\n"),
      sentinel,
    );
  });
  page.on("console", (message) => {
    sinkLeak ||= containsSentinel(message.text(), sentinel);
  });
  page.on("pageerror", (error) => {
    sinkLeak ||= containsSentinel(error.message, sentinel);
  });

  await installBrowserProbe(page, sentinel);
  await page.setExtraHTTPHeaders(harnessHeaders);
  await openRecorderCapture(page);

  await page.getByRole("button", { exact: true, name: "Photo or scan" }).click();
  await page.locator('input[name="assetFile"]').setInputFiles({
    buffer: Buffer.from(sentinel),
    mimeType: "image/jpeg",
    name: "synthetic-canary.jpg",
  });
  await page.getByRole("button", { name: "Hash and save asset" }).click();
  await expect(page.getByRole("button", { name: "Capture evidence" })).toBeVisible();
  let browserLeaks = await readBrowserLeaks(page, sentinel);

  await page.goto("/operator/field/review");
  await page.getByLabel("Exclude", { exact: false }).check();
  await page.getByLabel("Review reason").fill("Synthetic privacy-boundary decision.");
  await page.getByRole("button", { name: "Record append-only decision" }).click();
  await expect(page.getByRole("heading", { name: "Review history" })).toBeVisible();
  browserLeaks = mergeLeakFlags(browserLeaks, await readBrowserLeaks(page, sentinel));

  const workerCached = await page.evaluate(async () => {
    const worker = await fetch("/field-service-worker");
    if (!worker.ok) return false;
    const cache = await caches.open("ask-siargao-field-privacy-canary");
    await cache.put("/field-service-worker", worker.clone());
    return Boolean(await cache.match("/field-service-worker"));
  });
  expect(
    workerCached,
    "The real Field service worker must be observable through Cache Storage.",
  ).toBe(true);
  browserLeaks = mergeLeakFlags(browserLeaks, await readBrowserLeaks(page, sentinel));

  await page.goto("/operator/field/exports");
  await page.getByRole("button", { name: "Create Recovery Export" }).click();
  await page.getByRole("button", { name: "Create reviewed Field Batch" }).click();
  await page.getByRole("button", { name: "Restore Recovery Export" }).click();
  await page.getByRole("button", { name: "Verify Field Batch" }).click();
  await expect(page.getByText("Restore preview ready", { exact: false })).toBeVisible();
  await expect(page.getByText("Recipient verification started", { exact: false })).toBeVisible();
  const receiptLeak = await page.evaluate(
    ({ protectedValue }) => document.body.textContent?.includes(protectedValue) ?? false,
    { protectedValue: sentinel },
  );
  browserLeaks = mergeLeakFlags(browserLeaks, await readBrowserLeaks(page, sentinel));

  expect(networkLeak, "Protected canary reached a request body, URL, or headers.").toBe(false);
  expect(sinkLeak, "Protected canary reached a console or page-error sink.").toBe(false);
  expect(browserLeaks.fetch, "Protected canary reached fetch input or output.").toBe(false);
  expect(browserLeaks.xhr, "Protected canary reached XHR input or output.").toBe(false);
  expect(browserLeaks.beacon, "Protected canary reached sendBeacon.").toBe(false);
  expect(browserLeaks.console, "Protected canary reached a browser console call.").toBe(false);
  expect(browserLeaks.error, "Protected canary reached an error sink.").toBe(false);
  expect(browserLeaks.cache, "Protected canary reached Cache Storage or the service worker.").toBe(
    false,
  );
  expect(browserLeaks.storage, "Protected canary reached unencrypted web storage.").toBe(false);
  expect(receiptLeak, "Protected canary reached public receipt presentation.").toBe(false);
});

type LeakFlags = Readonly<{
  beacon: boolean;
  cache: boolean;
  console: boolean;
  error: boolean;
  fetch: boolean;
  storage: boolean;
  xhr: boolean;
}>;

async function installBrowserProbe(page: import("@playwright/test").Page, sentinel: string) {
  await page.addInitScript(
    ({ protectedValue }) => {
      const state = {
        beacon: false,
        console: false,
        error: false,
        fetch: false,
        xhr: false,
      };
      const contains = (value: unknown) => {
        if (typeof value === "string") return value.includes(protectedValue);
        try {
          return JSON.stringify(value).includes(protectedValue);
        } catch {
          return false;
        }
      };
      Object.defineProperty(window, "__fieldPrivacyCanaryProbe", { value: state });

      const originalFetch = window.fetch.bind(window);
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: async (...args: Parameters<typeof window.fetch>) => {
          state.fetch ||= contains(args[0]) || contains(args[1]);
          const response = await originalFetch(...args);
          void response
            .clone()
            .text()
            .then((body) => {
              state.fetch ||= contains(body);
            })
            .catch(() => undefined);
          return response;
        },
        writable: true,
      });

      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function send(body) {
        state.xhr ||= contains(body);
        this.addEventListener("loadend", () => {
          state.xhr ||= contains(this.responseText);
        });
        return originalSend.call(this, body);
      };

      const originalBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        state.beacon ||= contains(url) || contains(data);
        return originalBeacon(url, data);
      };

      for (const name of ["debug", "error", "info", "log", "warn"] as const) {
        const original = console[name].bind(console);
        console[name] = (...args) => {
          state.console ||= args.some(contains);
          original(...args);
        };
      }
      window.addEventListener("error", (event) => {
        state.error ||= contains(event.message) || contains(event.error);
      });
      window.addEventListener("unhandledrejection", (event) => {
        state.error ||= contains(event.reason);
      });
    },
    { protectedValue: sentinel },
  );
}

async function openRecorderCapture(page: import("@playwright/test").Page) {
  await page.goto("/operator/field/capture");
  await page.getByRole("button", { name: "Review safety and eligibility" }).click();
  for (const label of [
    "The route and site are safe now",
    "Access is currently allowed",
    "Required eligibility evidence is still valid",
  ]) {
    await page.getByLabel(label).check();
  }
  await page.getByRole("button", { name: "Safety confirmed — start Visit" }).click();
  await page.getByRole("button", { name: "Start Visit and pin this build" }).click();
  await page.getByRole("button", { name: "Capture evidence" }).click();
}

async function readBrowserLeaks(
  page: import("@playwright/test").Page,
  sentinel: string,
): Promise<LeakFlags> {
  return page.evaluate(
    async ({ protectedValue }) => {
      const probe = (
        window as Window & {
          __fieldPrivacyCanaryProbe?: Omit<LeakFlags, "cache" | "storage">;
        }
      ).__fieldPrivacyCanaryProbe;
      let cache = false;
      for (const name of await caches.keys()) {
        cache ||= name.includes(protectedValue);
        const current = await caches.open(name);
        for (const response of await current.matchAll()) {
          cache ||= response.url.includes(protectedValue);
          cache ||= (await response.text()).includes(protectedValue);
        }
      }
      const workerScript = await fetch("/field-service-worker").then((response) => response.text());
      cache ||= workerScript.includes(protectedValue);
      return {
        beacon: probe?.beacon ?? false,
        cache,
        console: probe?.console ?? false,
        error: probe?.error ?? false,
        fetch: probe?.fetch ?? false,
        storage:
          JSON.stringify(localStorage).includes(protectedValue) ||
          JSON.stringify(sessionStorage).includes(protectedValue) ||
          document.cookie.includes(protectedValue),
        xhr: probe?.xhr ?? false,
      };
    },
    { protectedValue: sentinel },
  );
}

function mergeLeakFlags(left: LeakFlags, right: LeakFlags): LeakFlags {
  return {
    beacon: left.beacon || right.beacon,
    cache: left.cache || right.cache,
    console: left.console || right.console,
    error: left.error || right.error,
    fetch: left.fetch || right.fetch,
    storage: left.storage || right.storage,
    xhr: left.xhr || right.xhr,
  };
}

function containsSentinel(value: string, sentinel: string): boolean {
  return value.includes(sentinel);
}
