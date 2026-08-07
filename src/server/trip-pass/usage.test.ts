import { describe, expect, test } from "bun:test";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";
import {
  createMemoryQuotaStore,
  type QuotaStore,
  type RollingWindowReservationResult,
} from "@/server/security/rate-limit";
import {
  finalizePaidAnswer,
  purgeExpiredPaidAnswerDetails,
  releasePaidAnswer,
  reservePaidAnswer,
} from "@/server/trip-pass/paid-answer-reservations";
import { openChatUsageSession } from "@/server/trip-pass/usage";

const startsAt = new Date("2020-07-01T00:00:00.000Z");
const expiresAt = new Date("2099-07-15T00:00:00.000Z");
const now = new Date("2026-07-14T04:00:00.000Z");

describe("paid Trip Pass chat usage", () => {
  test("settles one successful chat unit exactly once per request idempotency key", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_once", "trip_pass_paid_once");
      const session = await openChatUsageSession({
        bodyHash: "body_hash_once",
        db,
        idempotencyKey: "token_hash_once",
        now,
        requestId: "request_paid_once",
        store: createMemoryQuotaStore(),
        userId: "user_paid_once",
      });
      expect(session.status).toBe("allowed");
      if (session.status !== "allowed") {
        return;
      }

      const first = await session.settle({
        answerMessageId: "answer_once",
        persistAnswer: paidAnswerPersistence(db, "user_paid_once", "answer_once"),
        success: true,
        providerRequestIds: ["deepseek_request_once"],
      });
      const duplicate = await session.settle({
        answerMessageId: "answer_once",
        persistAnswer: paidAnswerPersistence(db, "user_paid_once", "answer_once"),
        success: true,
        providerRequestIds: ["deepseek_request_once_duplicate"],
      });

      expect(first).toMatchObject({
        status: "settled",
        allowance: { chatMessages: { used: 1, remaining: 149, limit: 150 } },
      });
      expect(duplicate).toMatchObject({
        status: "duplicate",
        allowance: { chatMessages: { used: 1, remaining: 149, limit: 150 } },
      });
      await expectMeterUsed(db, "trip_pass_paid_once", 1);
      await expectUsageEvents(db, {
        eventType: "settled",
        providerRequestIds: ["deepseek_request_once"],
        requestHash: "body_hash_once",
      });
    });
  });

  test("scopes durable idempotency reservations to the owning account", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_scope_a", "trip_pass_paid_scope_a");
      await seedActivePass(db, "user_paid_scope_b", "trip_pass_paid_scope_b");
      const store = createMemoryQuotaStore();

      const [first, second] = await Promise.all([
        openChatUsageSession({
          bodyHash: "body_hash_scope_a",
          db,
          idempotencyKey: "shared_token_hash_after_redis_expiry",
          now,
          requestId: "request_paid_scope_a",
          store,
          userId: "user_paid_scope_a",
        }),
        openChatUsageSession({
          bodyHash: "body_hash_scope_b",
          db,
          idempotencyKey: "shared_token_hash_after_redis_expiry",
          now,
          requestId: "request_paid_scope_b",
          store,
          userId: "user_paid_scope_b",
        }),
      ]);

      expect(first.status).toBe("allowed");
      expect(second.status).toBe("allowed");
      const reservations = await db.query<{ count: string }>(
        `select count(*)::text as count from paid_answer_reservations
         where idempotency_key_hash = 'shared_token_hash_after_redis_expiry'`,
      );
      expect(reservations.rows[0]?.count).toBe("2");
    });
  });

  test("does not let another account finalize an owned reservation", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_owner", "trip_pass_paid_owner");
      await seedActivePass(db, "user_paid_intruder", "trip_pass_paid_intruder");
      const reservation = await reservePaidAnswer({
        accountId: "user_paid_owner",
        bodyHash: "body_hash_owner",
        db,
        idempotencyKeyHash: "token_hash_owner",
        requestId: "request_paid_owner",
      });
      expect(reservation.status).toBe("reserved");
      if (reservation.status !== "reserved") return;

      const result = await finalizePaidAnswer({
        accountId: "user_paid_intruder",
        answerMessageId: "answer_paid_intruder",
        db,
        leaseToken: reservation.leaseToken,
        providerRequestIds: [],
        reservationId: reservation.reservationId,
        persistAnswer: async () => {
          throw new Error("an unowned reservation must not reach answer persistence");
        },
      });

      expect(result).toEqual({ status: "lease_lost", allowance: null });
      await expect(
        releasePaidAnswer({
          accountId: "user_paid_intruder",
          db,
          leaseToken: reservation.leaseToken,
          reason: "internal_failure",
          reservationId: reservation.reservationId,
        }),
      ).resolves.toBe("unchanged");
      await expectMeterUsed(db, "trip_pass_paid_owner", 0);
      await expectReservationStatus(db, "body_hash_owner", "open");
    });
  });

  test("releases pre-billable failures without consuming chat allowance", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_release", "trip_pass_paid_release");
      const store = createMemoryQuotaStore();
      const failed = await openChatUsageSession({
        bodyHash: "body_hash_release",
        db,
        idempotencyKey: "token_hash_release",
        now,
        requestId: "request_paid_release",
        store,
        userId: "user_paid_release",
      });
      expect(failed.status).toBe("allowed");
      if (failed.status !== "allowed") {
        return;
      }

      await expect(failed.settle({ success: false })).resolves.toMatchObject({
        status: "released",
      });
      await expectMeterUsed(db, "trip_pass_paid_release", 0);
      await expectReservationStatus(db, "body_hash_release", "released");

      const retry = await openChatUsageSession({
        bodyHash: "body_hash_retry",
        db,
        idempotencyKey: "token_hash_retry",
        now,
        requestId: "request_paid_retry",
        store,
        userId: "user_paid_release",
      });
      expect(retry.status).toBe("allowed");
    });
  });

  test("does not overspend when parallel requests race for the final chat unit", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_final", "trip_pass_paid_final");
      await setMeterUsed(db, "trip_pass_paid_final", "chat_message", 149);
      const store = createMemoryQuotaStore();

      const results = await Promise.all([
        openChatUsageSession({
          bodyHash: "body_hash_final_a",
          db,
          idempotencyKey: "token_hash_final_a",
          now,
          requestId: "request_paid_final_a",
          store,
          userId: "user_paid_final",
        }),
        openChatUsageSession({
          bodyHash: "body_hash_final_b",
          db,
          idempotencyKey: "token_hash_final_b",
          now,
          requestId: "request_paid_final_b",
          store,
          userId: "user_paid_final",
        }),
      ]);

      expect(results.map((result) => result.status).toSorted()).toEqual([
        "allowed",
        "usage_limit_reached",
      ]);
      const allowed = results.find((result) => result.status === "allowed");
      if (allowed?.status === "allowed") {
        await allowed.settle({
          answerMessageId: "answer_final",
          persistAnswer: paidAnswerPersistence(db, "user_paid_final", "answer_final"),
          success: true,
          providerRequestIds: ["deepseek_final"],
        });
      }
      await expectMeterUsed(db, "trip_pass_paid_final", 150);
    });
  });

  test("enforces paid chat concurrency before model execution", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_concurrency", "trip_pass_paid_concurrency");
      const store = createMemoryQuotaStore();

      const results = await Promise.all(
        ["a", "b", "c"].map((suffix) =>
          openChatUsageSession({
            bodyHash: `body_hash_concurrency_${suffix}`,
            db,
            idempotencyKey: `token_hash_concurrency_${suffix}`,
            now,
            requestId: `request_paid_concurrency_${suffix}`,
            store,
            userId: "user_paid_concurrency",
          }),
        ),
      );

      expect(results.map((result) => result.status).toSorted()).toEqual([
        "allowed",
        "allowed",
        "usage_limit_reached",
      ]);
      expect(results.find((result) => result.status === "usage_limit_reached")).toMatchObject({
        reason: "paid_chat_concurrency_exceeded",
      });
    });
  });

  test("fails closed and compensates earlier Redis reservations when shared storage breaks", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_store_down", "trip_pass_paid_store_down");
      const store = createFailingSharedQuotaStore();

      const result = await openChatUsageSession({
        bodyHash: "body_hash_store_down",
        db,
        env: {
          NODE_ENV: "production",
          PAID_ANSWER_DETAIL_RETENTION_DAYS: "30",
          REDIS_URL: "redis://redis.test.local:6379/0",
        },
        idempotencyKey: "token_hash_store_down",
        now,
        requestId: "request_paid_store_down",
        store,
        userId: "user_paid_store_down",
      });

      expect(result).toEqual({
        status: "unavailable",
        reason: "paid_usage_store_unavailable",
      });
      expect(store.releasedRollingReservations).toEqual([
        "paid:trip_pass_paid_store_down:chat-starts:1m:request_paid_store_down",
      ]);
      await expectMeterUsed(db, "trip_pass_paid_store_down", 0);
      await expectUsageEventCount(db, "body_hash_store_down", 0);
    });
  });

  test("fails paid use closed before operational controls when PostgreSQL is unavailable", async () => {
    const db: DatabaseQueryClient = {
      async query() {
        throw new Error("postgres unavailable");
      },
    };
    const store = createCountingQuotaStore();

    await expect(
      openChatUsageSession({
        bodyHash: "body_hash_database_down",
        db,
        idempotencyKey: "token_hash_database_down",
        now,
        requestId: "request_paid_database_down",
        store,
        userId: "user_paid_database_down",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "paid_usage_database_unavailable",
    });
    expect(store.calls).toBe(0);
  });

  test("keeps a durable settlement when Redis lease cleanup fails after generation", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_cleanup_down", "trip_pass_paid_cleanup_down");
      const delegate = createMemoryQuotaStore();
      const store: QuotaStore = {
        ...delegate,
        async releaseConcurrency() {
          throw new Error("Redis failed after durable answer completion");
        },
      };
      const session = await openChatUsageSession({
        bodyHash: "body_hash_cleanup_down",
        db,
        idempotencyKey: "token_hash_cleanup_down",
        now,
        requestId: "request_paid_cleanup_down",
        store,
        userId: "user_paid_cleanup_down",
      });
      expect(session.status).toBe("allowed");
      if (session.status !== "allowed") return;

      await expect(
        session.settle({
          answerMessageId: "answer_cleanup_down",
          persistAnswer: paidAnswerPersistence(db, "user_paid_cleanup_down", "answer_cleanup_down"),
          success: true,
        }),
      ).resolves.toMatchObject({ status: "settled" });
      await expectMeterUsed(db, "trip_pass_paid_cleanup_down", 1);
    });
  });

  test("does not impose the removed paid successful-chat daily cap", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_daily", "trip_pass_paid_daily");
      const store = createMemoryQuotaStore();

      for (let index = 0; index < 30; index += 1) {
        const requestNow = new Date(now.getTime() + index * 60_000);
        const session = await openChatUsageSession({
          bodyHash: `body_hash_daily_${index}`,
          db,
          idempotencyKey: `token_hash_daily_${index}`,
          now: requestNow,
          requestId: `request_paid_daily_${index}`,
          store,
          userId: "user_paid_daily",
        });
        expect(session.status).toBe("allowed");
        if (session.status === "allowed") {
          await expect(
            session.settle({
              answerMessageId: `answer_daily_${index}`,
              persistAnswer: paidAnswerPersistence(db, "user_paid_daily", `answer_daily_${index}`),
              success: true,
            }),
          ).resolves.toMatchObject({
            status: "settled",
          });
        }
      }

      const thirtyFirst = await openChatUsageSession({
        bodyHash: "body_hash_daily_31",
        db,
        idempotencyKey: "token_hash_daily_31",
        now: new Date(now.getTime() + 31 * 60_000),
        requestId: "request_paid_daily_31",
        store,
        userId: "user_paid_daily",
      });

      expect(thirtyFirst).toMatchObject({ status: "allowed" });
      await expectMeterUsed(db, "trip_pass_paid_daily", 30);
    });
  });

  test("fences a stale worker when database time recovers an expired reservation lease", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_stale", "trip_pass_paid_stale");
      const store = createMemoryQuotaStore();
      const first = await openChatUsageSession({
        bodyHash: "body_hash_stale",
        db,
        idempotencyKey: "token_hash_stale",
        now,
        requestId: "request_paid_stale_first",
        store,
        userId: "user_paid_stale",
      });
      expect(first.status).toBe("allowed");
      await db.query(
        `update paid_answer_reservations
         set reserved_at = clock_timestamp() - interval '20 minutes',
           lease_expires_at = clock_timestamp() - interval '10 minutes'`,
      );

      const recovered = await openChatUsageSession({
        bodyHash: "body_hash_stale",
        db,
        idempotencyKey: "token_hash_stale",
        now: new Date(now.getTime() + 1_000),
        requestId: "request_paid_stale_recovered",
        store,
        userId: "user_paid_stale",
      });
      expect(recovered.status).toBe("allowed");
      if (first.status !== "allowed" || recovered.status !== "allowed") return;

      await expect(
        first.settle({
          answerMessageId: "answer_stale_old",
          persistAnswer: paidAnswerPersistence(db, "user_paid_stale", "answer_stale_old"),
          success: true,
        }),
      ).resolves.toMatchObject({ status: "lease_lost" });
      await expect(
        recovered.settle({
          answerMessageId: "answer_stale_current",
          persistAnswer: paidAnswerPersistence(db, "user_paid_stale", "answer_stale_current"),
          success: true,
        }),
      ).resolves.toMatchObject({ status: "settled" });
      await expectMeterUsed(db, "trip_pass_paid_stale", 1);
    });
  });

  test("recovers expired capacity when a different idempotency key reserves the final unit", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_stale_capacity", "trip_pass_paid_stale_capacity");
      await setMeterUsed(db, "trip_pass_paid_stale_capacity", "chat_message", 149);
      const store = createMemoryQuotaStore();
      const stale = await openChatUsageSession({
        bodyHash: "body_hash_stale_capacity_old",
        db,
        idempotencyKey: "token_hash_stale_capacity_old",
        now,
        requestId: "request_paid_stale_capacity_old",
        store,
        userId: "user_paid_stale_capacity",
      });
      expect(stale.status).toBe("allowed");
      await db.query(
        `update paid_answer_reservations
         set reserved_at = clock_timestamp() - interval '20 minutes',
           lease_expires_at = clock_timestamp() - interval '10 minutes'
         where idempotency_key_hash = 'token_hash_stale_capacity_old'`,
      );

      const fresh = await openChatUsageSession({
        bodyHash: "body_hash_stale_capacity_new",
        db,
        idempotencyKey: "token_hash_stale_capacity_new",
        now,
        requestId: "request_paid_stale_capacity_new",
        store,
        userId: "user_paid_stale_capacity",
      });

      expect(fresh.status).toBe("allowed");
      await expectReservationStatus(db, "body_hash_stale_capacity_old", "released");
      await expectReservationStatus(db, "body_hash_stale_capacity_new", "open");
      if (stale.status === "allowed") {
        await expect(
          stale.settle({
            answerMessageId: "answer_stale_capacity_old",
            persistAnswer: paidAnswerPersistence(
              db,
              "user_paid_stale_capacity",
              "answer_stale_capacity_old",
            ),
            success: true,
          }),
        ).resolves.toMatchObject({ status: "released" });
      }
      await expectMeterUsed(db, "trip_pass_paid_stale_capacity", 149);
    });
  });

  test("rolls answer persistence and meter settlement back together, then retries", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_atomic", "trip_pass_paid_atomic");
      const session = await openChatUsageSession({
        bodyHash: "body_hash_atomic",
        db,
        idempotencyKey: "token_hash_atomic",
        now,
        requestId: "request_paid_atomic",
        store: createMemoryQuotaStore(),
        userId: "user_paid_atomic",
      });
      expect(session.status).toBe("allowed");
      if (session.status !== "allowed") return;

      await expect(
        session.settle({
          answerMessageId: "answer_atomic",
          persistAnswer: async () => {
            throw new Error("injected persistence failure");
          },
          success: true,
        }),
      ).rejects.toThrow("injected persistence failure");
      await expectMeterUsed(db, "trip_pass_paid_atomic", 0);
      await expectReservationStatus(db, "body_hash_atomic", "open");

      await expect(
        session.settle({
          answerMessageId: "answer_atomic",
          persistAnswer: paidAnswerPersistence(db, "user_paid_atomic", "answer_atomic"),
          success: true,
        }),
      ).resolves.toMatchObject({ status: "settled" });
      await expectMeterUsed(db, "trip_pass_paid_atomic", 1);
    });
  });

  test("purges per-request reservation details after the database-time policy deadline", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_purge", "trip_pass_paid_purge");
      const session = await openChatUsageSession({
        bodyHash: "body_hash_purge",
        db,
        idempotencyKey: "token_hash_purge",
        now,
        requestId: "request_paid_purge",
        store: createMemoryQuotaStore(),
        userId: "user_paid_purge",
      });
      expect(session.status).toBe("allowed");
      if (session.status !== "allowed") return;
      await session.settle({
        answerMessageId: "answer_purge",
        persistAnswer: paidAnswerPersistence(db, "user_paid_purge", "answer_purge"),
        providerRequestIds: ["provider_purge"],
        success: true,
      });
      await expect(purgeExpiredPaidAnswerDetails(db)).resolves.toBe(0);
      await db.query(
        `update paid_answer_reservations
         set reserved_at = clock_timestamp() - interval '40 days',
           details_purge_at = clock_timestamp() - interval '1 second'`,
      );

      await db.query(`
        create function fail_paid_answer_event_purge() returns trigger language plpgsql as $$
        begin raise exception 'forced event purge failure'; end $$
      `);
      await db.query(`
        create trigger fail_paid_answer_event_purge
          before update of request_id on trip_usage_events
          for each row execute function fail_paid_answer_event_purge()
      `);
      await expect(purgeExpiredPaidAnswerDetails(db)).rejects.toThrow("forced event purge failure");
      const rolledBack = await db.query<{
        details_purged_at: Date | null;
        request_hash: string | null;
      }>(
        `select r.details_purged_at, e.request_hash
         from paid_answer_reservations r
         join trip_usage_events e on e.id = 'trip_usage_event_' || r.id`,
      );
      expect(rolledBack.rows[0]?.details_purged_at).toBeNull();
      expect(rolledBack.rows[0]?.request_hash).toBe("body_hash_purge");
      await db.query("drop trigger fail_paid_answer_event_purge on trip_usage_events");
      await db.query("drop function fail_paid_answer_event_purge()");

      await expect(purgeExpiredPaidAnswerDetails(db)).resolves.toBe(1);
      const details = await db.query<{
        details_purged_at: Date | null;
        provider_request_ids_json: unknown;
        result_json: unknown;
      }>(
        `select details_purged_at, provider_request_ids_json, result_json
         from paid_answer_reservations`,
      );
      expect(details.rows[0]?.details_purged_at).not.toBeNull();
      expect(details.rows[0]?.provider_request_ids_json).toEqual([]);
      expect(details.rows[0]?.result_json).toBeNull();
      const event = await db.query<{
        meter_type: string;
        provider_request_ids_json: unknown;
        quantity: number;
        request_hash: string | null;
        request_id: string | null;
      }>(
        `select meter_type, quantity, request_id, request_hash, provider_request_ids_json
         from trip_usage_events where idempotency_key like 'paid-answer:%'`,
      );
      expect(event.rows[0]).toEqual({
        meter_type: "chat_message",
        provider_request_ids_json: [],
        quantity: 1,
        request_hash: null,
        request_id: null,
      });
      await expectMeterUsed(db, "trip_pass_paid_purge", 1);
    });
  });

  test("treats expired and other-owner passes as not paid-applicable", async () => {
    await withTestDb(async (db) => {
      await seedActivePass(db, "user_paid_expired", "trip_pass_paid_expired", {
        expiresAt: new Date("2021-07-10T00:00:00.000Z"),
      });
      await seedActivePass(db, "user_paid_owner", "trip_pass_paid_owner");

      await expect(
        openChatUsageSession({
          db,
          now,
          requestId: "request_expired",
          store: createMemoryQuotaStore(),
          userId: "user_paid_expired",
        }),
      ).resolves.toMatchObject({ status: "not_applicable", reason: "expired" });
      await expect(
        openChatUsageSession({
          db,
          now,
          requestId: "request_owner_mismatch",
          store: createMemoryQuotaStore(),
          userId: "user_without_pass",
        }),
      ).resolves.toMatchObject({ status: "not_applicable", reason: "no_active_pass" });
    });
  });
});

async function withTestDb(work: (db: DatabaseQueryClient) => Promise<void>) {
  await resetTestDatabase();
  const db = await openTestDatabase();
  try {
    await runInitialMigration(db);
    await work(db);
  } finally {
    await db.close();
  }
}

async function seedActivePass(
  db: DatabaseQueryClient,
  userId: string,
  tripPassId: string,
  input: { expiresAt?: Date } = {},
) {
  await db.query("insert into users (id, email) values ($1, $2)", [
    userId,
    `${userId}@example.com`,
  ]);
  await createActiveTripPassWithMeters(
    {
      id: tripPassId,
      userId,
      email: `${userId}@example.com`,
      startsAt,
      expiresAt: input.expiresAt ?? expiresAt,
      now,
    },
    db,
  );
}

async function setMeterUsed(
  db: DatabaseQueryClient,
  tripPassId: string,
  meterType: string,
  used: number,
) {
  await db.query(
    `
      update trip_usage_meters
      set used = $2
      where trip_pass_id = $1
        and meter_type = $3
    `,
    [tripPassId, used, meterType],
  );
}

function paidAnswerPersistence(_db: DatabaseQueryClient, userId: string, answerMessageId: string) {
  return async (transaction: DatabaseQueryClient) => {
    const threadId = `thread_${userId}`;
    await transaction.query(
      `insert into chat_threads (id, user_id, title)
       values ($1, $2, 'Paid answer test')
       on conflict (id) do nothing`,
      [threadId, userId],
    );
    await transaction.query(
      `insert into chat_messages (id, thread_id, user_id, role, content)
       values ($1, $2, $3, 'assistant', 'Durable paid answer')`,
      [answerMessageId, threadId, userId],
    );
    return { message: "Durable paid answer", answerMessageId };
  };
}

async function expectReservationStatus(
  db: DatabaseQueryClient,
  requestBodyHash: string,
  status: string,
) {
  const result = await db.query<{ status: string }>(
    `select status from paid_answer_reservations where request_body_hash = $1`,
    [requestBodyHash],
  );
  expect(result.rows[0]?.status).toBe(status);
}

async function expectMeterUsed(
  db: DatabaseQueryClient,
  tripPassId: string,
  used: number,
  meterType = "chat_message",
) {
  const result = await db.query<{ used: number }>(
    `
      select used
      from trip_usage_meters
      where trip_pass_id = $1
        and meter_type = $2
    `,
    [tripPassId, meterType],
  );

  expect(result.rows[0]?.used).toBe(used);
}

async function expectUsageEvents(
  db: DatabaseQueryClient,
  expected: {
    eventType: string;
    meterType?: string;
    providerRequestIds?: readonly string[];
    requestHash: string;
  },
) {
  const result = await db.query<{
    event_type: string;
    provider_request_ids_json: string[] | string;
    request_hash: string | null;
  }>(
    `
      select event_type, provider_request_ids_json, request_hash
      from trip_usage_events
      where request_hash = $1
        and ($2::text is null or meter_type = $2)
    `,
    [expected.requestHash, expected.meterType ?? null],
  );
  const row = result.rows[0];
  expect(row?.event_type).toBe(expected.eventType);
  expect(row?.request_hash).toBe(expected.requestHash);
  if (expected.providerRequestIds) {
    const providerRequestIds =
      typeof row?.provider_request_ids_json === "string"
        ? JSON.parse(row.provider_request_ids_json)
        : row?.provider_request_ids_json;
    expect(providerRequestIds).toEqual([...expected.providerRequestIds]);
  }
}

async function expectUsageEventCount(db: DatabaseQueryClient, requestHash: string, count: number) {
  const result = await db.query<{ count: string }>(
    `
      select count(*)::text as count
      from trip_usage_events
      where request_hash = $1
    `,
    [requestHash],
  );

  expect(Number(result.rows[0]?.count ?? 0)).toBe(count);
}

function createFailingSharedQuotaStore() {
  const releasedRollingReservations: string[] = [];
  let rollingAttempts = 0;
  const store: QuotaStore & { releasedRollingReservations: string[] } = {
    scope: "shared",
    releasedRollingReservations,
    async consumeBudget() {
      throw new Error("not used");
    },
    async incrementFixedWindow() {
      throw new Error("not used");
    },
    async recordIdempotency() {
      throw new Error("not used");
    },
    async releaseBudget() {
      throw new Error("not used");
    },
    async releaseConcurrency() {
      throw new Error("not used");
    },
    async releaseRollingWindow(input) {
      releasedRollingReservations.push(`${input.key}:${input.reservationId}`);
    },
    async reserveConcurrency() {
      throw new Error("configured Redis unavailable");
    },
    async reserveRollingWindow(input): Promise<RollingWindowReservationResult> {
      rollingAttempts += 1;
      if (rollingAttempts > 1) {
        throw new Error("not used");
      }
      return {
        status: "reserved",
        count: 1,
        reservationId: input.reservationId,
        resetAt: input.nowMs + input.windowMs,
      };
    },
  };
  return store;
}

function createCountingQuotaStore() {
  const delegate = createMemoryQuotaStore();
  let calls = 0;
  return {
    ...delegate,
    get calls() {
      return calls;
    },
    async reserveConcurrency(input: Parameters<QuotaStore["reserveConcurrency"]>[0]) {
      calls += 1;
      return delegate.reserveConcurrency(input);
    },
    async reserveRollingWindow(input: Parameters<QuotaStore["reserveRollingWindow"]>[0]) {
      calls += 1;
      return delegate.reserveRollingWindow(input);
    },
  };
}
