import { describe, expect, test } from "bun:test";

import { FieldSecuritySession } from "@/features/field-security/security-state";

describe("Field security inactivity lock", () => {
  test("erases access to key material after inactivity without touching ciphertext", () => {
    const session = new FieldSecuritySession(1_000);
    session.unlock(new Uint8Array(32).fill(7), 1_000);
    expect(session.withKey((key) => key[0])).toBe(7);
    expect(session.enforceInactivity(1_999)).toBe(false);
    expect(session.enforceInactivity(2_000)).toBe(true);
    expect(session.state).toEqual({ reason: "inactivity", status: "locked" });
    expect(() => session.withKey(() => true)).toThrow("field_key_unavailable");
  });

  test("only lends disposable key copies and zeroizes them after sync and async work", async () => {
    const session = new FieldSecuritySession();
    session.unlock(new Uint8Array(32).fill(9), 1_000);

    let syncCopy: Uint8Array | undefined;
    expect(
      session.withKey((key) => {
        syncCopy = key;
        key[0] = 4;
        return key[0];
      }),
    ).toBe(4);
    expect(syncCopy).toEqual(new Uint8Array(32));
    expect(session.withKey((key) => key[0])).toBe(9);

    let asyncCopy: Uint8Array | undefined;
    await expect(
      session.withKey(async (key) => {
        asyncCopy = key;
        await Promise.resolve();
        expect(key[0]).toBe(9);
        throw new Error("controlled_failure");
      }),
    ).rejects.toThrow("controlled_failure");
    expect(asyncCopy).toEqual(new Uint8Array(32));
    expect(session.withKey((key) => key[0])).toBe(9);
  });

  test("zeroizes a borrowed async copy immediately when the session locks", async () => {
    const session = new FieldSecuritySession();
    session.unlock(new Uint8Array(32).fill(5), 1_000);
    let borrowed: Uint8Array | undefined;
    let finish: (() => void) | undefined;
    const pending = session.withKey(
      (key) =>
        new Promise<void>((resolve) => {
          borrowed = key;
          finish = resolve;
        }),
    );
    expect(borrowed?.[0]).toBe(5);
    session.lock("grant");
    expect(borrowed).toEqual(new Uint8Array(32));
    finish?.();
    await pending;
  });
});
