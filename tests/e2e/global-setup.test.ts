import { expect, test } from "bun:test";

import { functionalPrewarmRoutes, prewarmPlaywrightRoutes } from "./global-setup";

test("Playwright prewarms every cold route before functional browser work", async () => {
  const requested: string[] = [];

  await prewarmPlaywrightRoutes({
    fetchImpl: async (url) => {
      requested.push(url);
      return { status: 200 };
    },
    routes: functionalPrewarmRoutes,
    wait: async () => undefined,
  });

  expect(requested).toEqual(
    functionalPrewarmRoutes.map((route) => `http://127.0.0.1:3100${route}`),
  );
});

test("Playwright route prewarming retries a transient server compilation response", async () => {
  const statuses = [500, 200];
  let waits = 0;

  await prewarmPlaywrightRoutes({
    fetchImpl: async () => ({ status: statuses.shift() ?? 500 }),
    routes: ["/chat"],
    wait: async () => {
      waits += 1;
    },
  });

  expect(waits).toBe(1);
});
