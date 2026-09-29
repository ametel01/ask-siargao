import { describe, expect, test } from "bun:test";

import { runFieldAuthorizationSingleFlight } from "./FieldSecurityWorkspace";

describe("Field device authorization", () => {
  test("coalesces double activation into one challenge, device, and grant", async () => {
    const inFlight = { current: null as Promise<void> | null };
    let releaseChallenge!: () => void;
    const challengeReady = new Promise<void>((resolve) => {
      releaseChallenge = resolve;
    });
    let challengeUses = 0;
    let deviceRows = 0;
    let grantRows = 0;

    const authorize = () =>
      runFieldAuthorizationSingleFlight(inFlight, async () => {
        challengeUses += 1;
        await challengeReady;
        deviceRows += 1;
        grantRows += 1;
      });

    const firstActivation = authorize();
    const secondActivation = authorize();

    expect(secondActivation).toBe(firstActivation);
    await Promise.resolve();
    expect(challengeUses).toBe(1);
    expect(deviceRows).toBe(0);
    expect(grantRows).toBe(0);

    releaseChallenge();
    await Promise.all([firstActivation, secondActivation]);
    expect(challengeUses).toBe(1);
    expect(deviceRows).toBe(1);
    expect(grantRows).toBe(1);
    expect(inFlight.current).toBeNull();
  });

  test("clears the guard after a failed authorization so retry is possible", async () => {
    const inFlight = { current: null as Promise<void> | null };
    let attempts = 0;

    const authorize = () =>
      runFieldAuthorizationSingleFlight(inFlight, async () => {
        attempts += 1;
        throw new Error("challenge_failed");
      });

    await expect(authorize()).rejects.toThrow("challenge_failed");
    await expect(authorize()).rejects.toThrow("challenge_failed");
    expect(attempts).toBe(2);
    expect(inFlight.current).toBeNull();
  });
});
