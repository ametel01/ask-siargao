import { expect, test } from "bun:test";

import {
  accountClosureConfirmation,
  accountClosureFailureStatus,
  accountClosureStatusMessages,
  accountClosureWarnings,
} from "@/features/settings/account-closure-copy";

test("Account Closure copy names terminal forfeiture, sharing, and refund boundaries", () => {
  expect(accountClosureConfirmation).toBe("CLOSE MY ACCOUNT");
  const copy = accountClosureWarnings.join(" ");
  expect(copy).toContain("terminal");
  expect(copy).toContain("Public sharing stops");
  expect(copy).toContain("Trip Pass time and answers are forfeited");
  expect(copy).toContain("no automatic proration");
  expect(copy).toContain("support@asksiargao.com");
});

test("Account Closure copy never describes a server-committed closure as still available", () => {
  expect(accountClosureFailureStatus(false)).toBe("request_failed");
  expect(accountClosureStatusMessages.request_failed).toContain("remains available");
  expect(accountClosureFailureStatus(true)).toBe("committed_cleanup_failed");
  expect(accountClosureStatusMessages.committed_cleanup_failed).toContain("permanently closed");
  expect(accountClosureStatusMessages.committed_cleanup_failed).not.toContain("remains available");
});
