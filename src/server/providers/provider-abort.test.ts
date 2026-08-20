import { describe, expect, test } from "bun:test";

import { runProviderOperation } from "@/server/providers/provider-abort";

describe("provider operation lifetime", () => {
  test("does not start an operation after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    let started = false;

    await expect(
      runProviderOperation(async () => {
        started = true;
      }, controller.signal),
    ).rejects.toThrow("deadline");
    expect(started).toBe(false);
  });

  test("waits for an in-flight operation to settle after cancellation", async () => {
    const controller = new AbortController();
    let resolveOperation!: (value: string) => void;
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });
    let settled = false;
    const running = runProviderOperation(() => operation, controller.signal).finally(() => {
      settled = true;
    });

    controller.abort(new Error("deadline"));
    await Bun.sleep(10);
    expect(settled).toBe(false);

    resolveOperation("completed");
    await expect(running).resolves.toBe("completed");
  });
});
