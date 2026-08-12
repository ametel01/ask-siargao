import { describe, expect, test } from "bun:test";

import {
  postRepairResponse,
  type RepairRouteDependencies,
} from "@/app/api/admin/repairs/repair-route";
import type { DatabaseQueryClient } from "@/server/db/query-client";

describe("Operator Repair Action route", () => {
  test("ignores shared tokens and requires an allowlisted Clerk Account", async () => {
    const response = await postRepairResponse(
      request(
        { actionType: "manual_commerce_transition", findingId: "finding_1", mode: "preview" },
        {
          "x-admin-token": "shared-token-cannot-authorize",
        },
      ),
      dependencies({ accountId: null, mfaFresh: false }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("returns a redacted before/after preview to an allowlisted Operator", async () => {
    const response = await postRepairResponse(
      request({
        actionType: "manual_commerce_transition",
        findingId: "finding_1",
        mode: "preview",
      }),
      dependencies({ accountId: "account_operator", mfaFresh: false }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { preview: { before: Record<string, unknown> } };
    expect(body.preview.before).toEqual({ email: "[redacted]", state: "before" });
  });

  test("requires fresh MFA and same-origin execution", async () => {
    const stale = await postRepairResponse(
      request({
        actionType: "manual_commerce_transition",
        confirmation: "APPLY REPAIR",
        findingId: "finding_1",
        idempotencyKey: "repair-key-at-least-16",
        mode: "execute",
        previewDigest: "a".repeat(64),
        reasonCode: "verified_mismatch",
      }),
      dependencies({ accountId: "account_operator", mfaFresh: false }),
    );
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({ error: "fresh_mfa_required" });

    const crossOrigin = await postRepairResponse(
      request(
        { actionType: "manual_commerce_transition", findingId: "finding_1", mode: "preview" },
        { origin: "https://attacker.invalid" },
      ),
      dependencies({ accountId: "account_operator", mfaFresh: true }),
    );
    expect(crossOrigin.status).toBe(403);
  });
});

function dependencies(auth: {
  accountId: string | null;
  mfaFresh: boolean;
}): RepairRouteDependencies {
  return {
    allowlist: new Set(["account_operator"]),
    auth: async () => auth,
    db: {
      async query<T>(query: string) {
        if (query.includes("from operational_findings")) {
          return {
            rows: [
              {
                id: "finding_1",
                kind: "payment_state_mismatch",
                local_entity_ref: "order_private",
                local_entity_type: "trip_pass_order",
                status: "open",
              },
            ] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    } satisfies DatabaseQueryClient,
    executor: {
      async preview() {
        return {
          after: { state: "after" },
          before: { email: "private@example.com", state: "before" },
        };
      },
      async prepareExecution() {
        return {
          async lock() {},
          async preview() {
            return {
              after: { state: "after" },
              before: { email: "private@example.com", state: "before" },
            };
          },
          async apply() {
            return { state: "after" };
          },
        };
      },
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://asksiargao.test/api/admin/repairs", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}
