import type { DatabaseQueryClient } from "@/server/db/query-client";
import { finalizePaidAnswer, reservePaidAnswer } from "@/server/trip-pass/paid-answer-reservations";

type PostgresHarness = {
  createQueryClient(): DatabaseQueryClient & { end(): Promise<void> };
};

export async function runPaidAnswerReservationPostgresIntegration(harness: PostgresHarness) {
  const setup = harness.createQueryClient();
  const first = harness.createQueryClient();
  const second = harness.createQueryClient();
  try {
    await setup.query(
      `insert into users (id, email) values ('paid_answer_pg_user', 'paid-answer-pg@example.com')`,
    );
    await setup.query(
      `insert into trip_passes (
         id, user_id, status, starts_at, expires_at, created_at, updated_at
       ) values (
         'paid_answer_pg_pass', 'paid_answer_pg_user', 'active',
         clock_timestamp() - interval '1 hour', clock_timestamp() + interval '336 hours',
         clock_timestamp(), clock_timestamp()
       )`,
    );
    await setup.query(
      `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
       values ('paid_answer_pg_meter', 'paid_answer_pg_pass', 'chat_message', 149, 150)`,
    );

    const [left, right] = await Promise.all([
      reservePaidAnswer({
        accountId: "paid_answer_pg_user",
        bodyHash: "paid_answer_pg_body_left",
        db: first,
        idempotencyKeyHash: "paid_answer_pg_key_left",
        requestId: "paid_answer_pg_request_left",
      }),
      reservePaidAnswer({
        accountId: "paid_answer_pg_user",
        bodyHash: "paid_answer_pg_body_right",
        db: second,
        idempotencyKeyHash: "paid_answer_pg_key_right",
        requestId: "paid_answer_pg_request_right",
      }),
    ]);
    const reserved = [left, right].filter((result) => result.status === "reserved");
    const denied = [left, right].filter((result) => result.status === "limit_reached");
    assertEqual(reserved.length, 1, "exactly one final-unit reservation must open");
    assertEqual(denied.length, 1, "the competing final-unit reservation must fail closed");
    const winner = reserved[0];
    if (winner?.status !== "reserved") {
      throw new Error("paid answer final-unit winner was not available");
    }

    const finalized = await finalizePaidAnswer({
      accountId: "paid_answer_pg_user",
      answerMessageId: "paid_answer_pg_message",
      db: first,
      leaseToken: winner.leaseToken,
      providerRequestIds: ["provider_request_one", "provider_request_two"],
      reservationId: winner.reservationId,
      persistAnswer: async (transaction, allowance) => {
        await transaction.query(
          `insert into chat_threads (id, user_id, title)
           values ('paid_answer_pg_thread', 'paid_answer_pg_user', 'Native PG answer')`,
        );
        await transaction.query(
          `insert into chat_messages (id, thread_id, user_id, role, content, request_id)
           values (
             'paid_answer_pg_message', 'paid_answer_pg_thread', 'paid_answer_pg_user',
             'assistant', 'One durable multi-tool answer.', 'paid_answer_pg_request_left'
           )`,
        );
        return { message: "One durable multi-tool answer.", tripPassUsage: allowance };
      },
    });
    assertEqual(finalized.status, "settled", "the winning durable answer must settle");

    const state = await setup.query<{
      messages: string;
      settled_events: string;
      used: number;
    }>(
      `select
         (select used from trip_usage_meters where id = 'paid_answer_pg_meter') as used,
         (select count(*)::text from trip_usage_events
           where trip_pass_id = 'paid_answer_pg_pass' and event_type = 'settled') as settled_events,
         (select count(*)::text from chat_messages
           where id = 'paid_answer_pg_message') as messages`,
    );
    assertEqual(state.rows[0]?.used, 150, "the meter must stop exactly at 150");
    assertEqual(state.rows[0]?.settled_events, "1", "multi-tool work must create one Usage event");
    assertEqual(state.rows[0]?.messages, "1", "settlement must store one durable answer");

    const replay = await reservePaidAnswer({
      accountId: "paid_answer_pg_user",
      bodyHash: "paid_answer_pg_body_left",
      db: second,
      idempotencyKeyHash: "paid_answer_pg_key_left",
      requestId: "paid_answer_pg_request_replay",
    });
    assertEqual(replay.status, "replay", "a retry must retrieve the stored answer");
    if (replay.status === "replay") {
      assertEqual(
        replay.responseBody.message,
        "One durable multi-tool answer.",
        "replay must return the durable result",
      );
    }
  } finally {
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}
