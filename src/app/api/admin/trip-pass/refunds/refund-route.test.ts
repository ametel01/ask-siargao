import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { postOperatorRefundResponse } from "@/app/api/admin/trip-pass/refunds/refund-route";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import { grantTripPass } from "@/server/trip-pass/entitlement";

const operatorId = "account_operator";
const now = new Date("2026-08-20T00:00:00.000Z");

describe("Operator refund route", () => {
  test("runs preview then requires fresh MFA before queueing an audited full refund", async () => {
    await withDb(async (db) => {
      await seedRefundOrder(db, "order_full_refund", "none");
      let mfaFresh = false;
      const dependencies = {
        allowlist: new Set([operatorId]),
        auth: async () => ({ accountId: operatorId, mfaFresh }),
        db,
      };
      const previewResponse = await postOperatorRefundResponse(
        request({ decision: "full_refund", mode: "preview", orderId: "order_full_refund" }),
        dependencies,
      );
      const previewBody = (await previewResponse.json()) as { preview: { digest: string } };
      expect(previewResponse.status).toBe(200);

      const command = {
        confirmation: "APPLY REFUND",
        decision: "full_refund",
        idempotencyKey: "operator-refund-idempotency-full",
        mode: "execute",
        orderId: "order_full_refund",
        previewDigest: previewBody.preview.digest,
        reasonCode: "traveler_requested_refund",
      } as const;
      const staleResponse = await postOperatorRefundResponse(request(command), dependencies);
      expect(staleResponse.status).toBe(403);
      expect(await staleResponse.json()).toEqual({ error: "fresh_mfa_required" });

      mfaFresh = true;
      const executeResponse = await postOperatorRefundResponse(request(command), dependencies);
      expect(executeResponse.status).toBe(200);
      const records = await db.query<{ action_count: string; operation_count: string }>(
        `select
           (select count(*)::text from operator_refund_actions where order_id = 'order_full_refund') as action_count,
           (select count(*)::text from trip_pass_refund_operations where order_id = 'order_full_refund'
             and reason = 'operator_refund' and amount_minor = 999) as operation_count`,
      );
      expect(records.rows[0]).toEqual({ action_count: "1", operation_count: "1" });
    });
  });

  test("concludes partial-refund review without changing access or meter usage", async () => {
    await withDb(async (db) => {
      await seedRefundOrder(db, "order_partial_final", "review");
      await grantTripPass(
        {
          now,
          orderId: "order_partial_final",
          sourceEventId: "partial_refund_access",
          sourceType: "manual_operator",
          userId: "account_refund_owner",
        },
        db,
      );
      await db.query(
        'update trip_usage_meters set used = 1 where trip_pass_id in (select trip_pass_id from trip_pass_grants where order_id = $1) and "limit" > 0',
        ["order_partial_final"],
      );
      await db.query(
        `insert into trip_pass_refund_operations (
           id, order_id, provider, provider_order_id, reason, amount_minor,
           provider_captured_amount_minor, idempotency_key, next_attempt_at
         ) values ('partial_deadline', 'order_partial_final', 'lemon_squeezy', 'provider_order',
           'partial_refund_deadline', 699, 999, 'partial:deadline', $1)`,
        [new Date(now.getTime() + 86_400_000)],
      );
      const before = await accessState(db, "order_partial_final");
      const dependencies = {
        allowlist: new Set([operatorId]),
        auth: async () => ({ accountId: operatorId, mfaFresh: true }),
        db,
      };
      const previewResponse = await postOperatorRefundResponse(
        request({
          decision: "accept_partial_refund",
          mode: "preview",
          orderId: "order_partial_final",
        }),
        dependencies,
      );
      const previewBody = (await previewResponse.json()) as { preview: { digest: string } };
      const executeResponse = await postOperatorRefundResponse(
        request({
          confirmation: "APPLY REFUND",
          decision: "accept_partial_refund",
          idempotencyKey: "operator-refund-idempotency-partial",
          mode: "execute",
          orderId: "order_partial_final",
          previewDigest: previewBody.preview.digest,
          reasonCode: "accept_partial_resolution",
        }),
        dependencies,
      );
      expect(executeResponse.status).toBe(200);
      expect(await accessState(db, "order_partial_final")).toEqual(before);
      const resolution = await db.query<{ operation_status: string; refund_state: string }>(
        `select o.refund_state, operation.status as operation_status
         from trip_pass_orders o join trip_pass_refund_operations operation
           on operation.order_id = o.id where o.id = 'order_partial_final'`,
      );
      expect(resolution.rows[0]).toEqual({
        operation_status: "cancelled",
        refund_state: "partial_final",
      });
    });
  });
});

async function seedRefundOrder(db: DatabaseQueryClient, orderId: string, refundState: string) {
  await db.query(
    "insert into users (id, email) values ('account_refund_owner', 'owner@example.com') on conflict (id) do nothing",
  );
  await db.query(
    `insert into trip_pass_orders (
       id, user_id, status, product_code, product_family, product_version, amount_total_minor,
       captured_amount_minor, successful_refund_amount_minor, refund_state,
       refund_remaining_amount_minor, currency, checkout_idempotency_key, payment_provider,
       provider_order_id, created_at, updated_at
     ) values ($1, 'account_refund_owner', 'paid', 'siargao_trip_pass_14d_v2',
       'siargao_trip_pass', 2, 999, 999, $2, $3, $4, 'usd', $5,
       'lemon_squeezy', 'provider_order', $6, $6)`,
    [
      orderId,
      refundState === "review" ? 300 : 0,
      refundState,
      refundState === "review" ? 699 : null,
      `checkout:${orderId}`,
      now,
    ],
  );
}

async function accessState(db: DatabaseQueryClient, orderId: string) {
  return (
    await db.query<{ meter_used: string; pass_count: string }>(
      `select count(distinct p.id)::text as pass_count, coalesce(sum(m.used), 0)::text as meter_used
       from trip_pass_grants g join trip_passes p on p.id = g.trip_pass_id
       left join trip_usage_meters m on m.trip_pass_id = p.id where g.order_id = $1`,
      [orderId],
    )
  ).rows[0];
}

function request(body: unknown) {
  return new Request("https://siargao.test/api/admin/trip-pass/refunds", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://siargao.test",
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  });
}

async function withDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  const database = new PGlite();
  await runInitialMigration(database);
  const db = queryClient(database);
  try {
    await work(db);
  } finally {
    await database.close();
  }
}

function queryClient(database: PGlite): DatabaseQueryClient {
  const db: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      return database.query<T>(query, params);
    },
    async transaction<T>(callback: (transaction: DatabaseQueryClient) => Promise<T>) {
      return database.transaction(async (transaction) =>
        callback({
          inTransaction: true,
          async query<Row>(query: string, params: unknown[] = []) {
            return transaction.query<Row>(query, params);
          },
        }),
      );
    },
  };
  return db;
}
