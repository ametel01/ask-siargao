import { describe, expect, test } from "bun:test";

import { fetchWithProviderTimeout } from "@/server/providers/provider-fetch";

describe("provider fetch timeout", () => {
  test("aborts a stalled provider request at the configured deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const stalledFetch = (_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Provider timed out", "AbortError")),
          { once: true },
        );
      });
    };

    expect(fetchWithProviderTimeout(stalledFetch, "https://provider.test", {}, 5)).rejects.toThrow(
      "Provider timed out",
    );
    await Bun.sleep(10);
    expect(observedSignal?.aborted).toBe(true);
  });

  test("preserves an upstream abort signal", async () => {
    const controller = new AbortController();
    const stalledFetch = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Request cancelled", "AbortError")),
          { once: true },
        );
      });
    const request = fetchWithProviderTimeout(
      stalledFetch,
      "https://provider.test",
      { signal: controller.signal },
      1_000,
    );

    controller.abort();

    expect(request).rejects.toThrow("Request cancelled");
  });
});
