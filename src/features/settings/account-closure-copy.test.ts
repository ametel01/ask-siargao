import { expect, test } from "bun:test";

import {
  accountClosureConfirmation,
  accountClosureWarnings,
} from "@/features/settings/account-closure-copy";

test("Account Closure copy names terminal forfeiture, sharing, and refund boundaries", () => {
  expect(accountClosureConfirmation).toBe("CLOSE MY ACCOUNT");
  const copy = accountClosureWarnings.join(" ");
  expect(copy).toContain("terminal");
  expect(copy).toContain("Public sharing stops");
  expect(copy).toContain("Trip Pass time and answers are forfeited");
  expect(copy).toContain("no automatic proration");
});
