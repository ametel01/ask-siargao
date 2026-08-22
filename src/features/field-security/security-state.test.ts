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
});
