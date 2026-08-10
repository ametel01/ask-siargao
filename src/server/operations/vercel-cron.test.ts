import { describe, expect, test } from "bun:test";

import { authorizeVercelCron } from "@/server/operations/vercel-cron";

describe("authenticated Vercel Cron adapters", () => {
  test("requires the exact bearer secret", () => {
    const request = (authorization?: string) =>
      new Request("https://siargao.test/api/cron/operations", {
        headers: authorization ? { authorization } : {},
      });

    expect(authorizeVercelCron(request(), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer wrong-secret"), "cron-secret-value")).toBe(false);
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), "cron-secret-value")).toBe(
      true,
    );
    expect(authorizeVercelCron(request("Bearer cron-secret-value"), undefined)).toBe(false);
  });
});
