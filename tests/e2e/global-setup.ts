const playwrightOrigin = "http://127.0.0.1:3100";

export const functionalPrewarmRoutes = [
  "/",
  "/chat",
  "/sign-in",
  "/sign-up",
  "/legal/privacy",
  "/legal/trip-pass",
  "/audits/demo/report",
] as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<{ status: number }>;

type PrewarmOptions = {
  fetchImpl?: FetchLike;
  routes: readonly string[];
  wait?: () => Promise<void>;
};

export async function prewarmPlaywrightRoutes({
  fetchImpl = fetch,
  routes,
  wait = () => new Promise((resolve) => setTimeout(resolve, 250)),
}: PrewarmOptions) {
  for (const route of routes) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetchImpl(`${playwrightOrigin}${route}`, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status < 500) {
          ready = true;
          break;
        }
      } catch {
        // The dev server can close the first connection while installing a compiled route.
      }
      await wait();
    }
    if (!ready) {
      throw new Error(`Playwright route prewarm failed for ${route}.`);
    }
  }
}

export default async function globalSetup() {
  await prewarmPlaywrightRoutes({
    routes: process.env.PLAYWRIGHT_PRODUCTION_PERF === "1" ? ["/chat"] : functionalPrewarmRoutes,
  });
}
