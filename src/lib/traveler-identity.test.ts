import { describe, expect, test } from "bun:test";

import { travelerEmailFromStoredEmail } from "@/lib/traveler-identity";

describe("traveler identity helpers", () => {
  test.each([
    ["traveler@example.com", "traveler@example.com"],
    ["  traveler@example.com  ", "traveler@example.com"],
    ["unavailable+user_123@clerk.ask-siargao.local", null],
    ["deleted+user_123@clerk.ask-siargao.local", null],
    ["", null],
    [null, null],
  ] satisfies Array<
    [string | null, string | null]
  >)("filters stored email value %p", (storedEmail, expected) => {
    expect(travelerEmailFromStoredEmail(storedEmail)).toBe(expected);
  });
});
