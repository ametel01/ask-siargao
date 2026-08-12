import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { AgentTurnResult } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  answerTravelQuestion,
  type DurableTravelAnswerDependencies,
} from "@/server/chat/durable-travel-answer";
import { runInitialMigration } from "@/server/db/test-database";
import { createActiveTripPassWithMeters } from "@/server/payments/trip-pass";

describe("durable Travel Answer", () => {
  test("persists, settles, and replays one paid answer", async () => {
    const db = await openTravelAnswerTestDatabase();
    await seedActiveTripPass(db, "user_paid_domain_seam", "trip_pass_paid_domain_seam");
    const modelRequests: string[] = [];
    const dependencies = paidTravelAnswerDependencies(db, "user_paid_domain_seam", modelRequests);
    const input = travelAnswerInput({ "idempotency-key": "paid-domain-seam-token" });

    const first = await answerTravelQuestion(input, dependencies);
    const replay = await answerTravelQuestion(
      travelAnswerInput(input.request.headers),
      dependencies,
    );

    expect(first.status).toBe(200);
    expect(first.body.message).toBe("Paid answer behind the domain seam.");
    expect(replay.status).toBe(200);
    expect(replay.body.message).toBe("Paid answer behind the domain seam.");
    expect(modelRequests).toHaveLength(1);
    await expectChatMeterUsed(db, "trip_pass_paid_domain_seam", 1);
    await expectPaidAnswerReservation(db, "user_paid_domain_seam", "settled");

    await db.close();
  });

  test("releases the paid reservation when preparation fails", async () => {
    const db = await openTravelAnswerTestDatabase();
    await seedActiveTripPass(db, "user_paid_prepare_failure", "trip_pass_paid_prepare_failure");
    const dependencies = paidTravelAnswerDependencies(db, "user_paid_prepare_failure", []);
    dependencies.createId = () => {
      throw new Error("thread preparation failed");
    };

    const answer = await answerTravelQuestion(travelAnswerInput(), dependencies);

    expect(answer.status).toBe(502);
    expect(answer.body.error).toBe("chat_generation_failed");
    await expectChatMeterUsed(db, "trip_pass_paid_prepare_failure", 0);
    await expectPaidAnswerReservation(db, "user_paid_prepare_failure", "released");

    await db.close();
  });

  test("rejects paid input without a user turn before reserving usage", async () => {
    const db = await openTravelAnswerTestDatabase();
    await seedActiveTripPass(db, "user_paid_missing_turn", "trip_pass_paid_missing_turn");
    const dependencies = paidTravelAnswerDependencies(db, "user_paid_missing_turn", []);
    const messages = [{ role: "assistant" as const, content: "Previous answer." }];
    const body = JSON.stringify({ messages });

    const answer = await answerTravelQuestion(
      {
        body,
        messages,
        request: new Request("https://siargao.test/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      },
      dependencies,
    );

    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("invalid_travel_answer_input");
    await expectChatMeterUsed(db, "trip_pass_paid_missing_turn", 0);
    await expectPaidAnswerReservationCount(db, "user_paid_missing_turn", 0);

    await db.close();
  });
});

function paidTravelAnswerDependencies(
  db: PGlite,
  userId: string,
  modelRequests: string[],
): DurableTravelAnswerDependencies {
  return {
    auth: async () => ({
      userId,
      sessionClaims: { email: `${userId}@example.com` },
    }),
    beginAuthenticatedFreeChat: null,
    db,
    now: tripPassTestNow,
    runAskSiargaoAgentTurn: async (request): Promise<AgentTurnResult> => {
      modelRequests.push(request.requestId ?? "missing_request_id");
      return {
        message: "Paid answer behind the domain seam.",
        requestId: request.requestId ?? "missing_request_id",
        upstreamRequestIds: ["req_domain_seam"],
        model: "gpt-test",
        toolCalls: [],
        sources: [genericSourceSummary],
        publicSources: [genericSourceSummary],
      };
    },
  };
}

function travelAnswerInput(headers: HeadersInit = {}) {
  const messages = [{ role: "user" as const, content: "Where should I eat?" }];
  const body = JSON.stringify({ messages });
  return {
    body,
    messages,
    request: new Request("https://siargao.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
      body,
    }),
  };
}

async function openTravelAnswerTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  return db;
}

async function seedActiveTripPass(db: PGlite, userId: string, tripPassId: string) {
  await db.query(
    `
      insert into users (id, email, created_at, updated_at)
      values ($1, $2, now(), now())
    `,
    [userId, `${userId}@example.com`],
  );
  await createActiveTripPassWithMeters(
    {
      id: tripPassId,
      userId,
      email: `${userId}@example.com`,
      startsAt: new Date("2020-07-01T00:00:00.000Z"),
      expiresAt: new Date("2099-07-20T00:00:00.000Z"),
      now: tripPassTestNow(),
    },
    db,
  );
}

function tripPassTestNow() {
  return new Date("2026-07-14T00:00:00.000Z");
}

async function expectChatMeterUsed(db: PGlite, tripPassId: string, used: number) {
  const result = await db.query<{ used: number }>(
    `
      select used
      from trip_usage_meters
      where trip_pass_id = $1
        and meter_type = 'chat_message'
    `,
    [tripPassId],
  );
  expect(result.rows[0]?.used).toBe(used);
}

async function expectPaidAnswerReservation(db: PGlite, userId: string, status: string) {
  const result = await db.query<{ status: string }>(
    `
      select status
      from paid_answer_reservations
      where account_id = $1
      order by reserved_at desc
      limit 1
    `,
    [userId],
  );
  expect(result.rows[0]?.status).toBe(status);
}

async function expectPaidAnswerReservationCount(db: PGlite, userId: string, count: number) {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count from paid_answer_reservations where account_id = $1`,
    [userId],
  );
  expect(result.rows[0]?.count).toBe(count);
}

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Generic model reasoning",
  checked: [],
  notChecked: ["live Google Places", "Open-Meteo weather forecast"],
};
