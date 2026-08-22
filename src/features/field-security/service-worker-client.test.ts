import { describe, expect, mock, test } from "bun:test";

import {
  activateSafeFieldUpdate,
  notifyFieldVisitState,
} from "@/features/field-security/service-worker-client";

describe("Field service-worker update pinning", () => {
  test("updates active, waiting, and installing workers and activates only after close", async () => {
    const active = { postMessage: mock(() => undefined) };
    const waiting = { postMessage: mock(() => undefined) };
    const installing = { postMessage: mock(() => undefined) };
    const registration = { active, installing, waiting };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => registration },
    });

    expect(await notifyFieldVisitState({ activeVisit: true, buildId: "build-test" })).toEqual({
      updateWaiting: true,
    });
    for (const worker of [active, waiting, installing]) {
      expect(worker.postMessage).toHaveBeenCalledWith({
        activeVisit: true,
        buildId: "build-test",
        type: "FIELD_VISIT_STATE",
      });
    }
    expect(await activateSafeFieldUpdate(true)).toBe(false);
    expect(await activateSafeFieldUpdate(false)).toBe(true);
    expect(waiting.postMessage).toHaveBeenLastCalledWith({
      type: "ACTIVATE_SAFE_FIELD_UPDATE",
    });
  });
});
