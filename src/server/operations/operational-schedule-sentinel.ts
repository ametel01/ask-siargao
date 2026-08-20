import type { DatabaseQueryClient } from "@/server/db/query-client";
import { readOpenMeteoApiMode } from "@/server/providers/production-provider-mode";

export const operationalScheduleDefinitions = {
  marine: { graceMinutes: 30, scheduleMinutes: 180 },
  places_prune: { graceMinutes: 60, scheduleMinutes: 1440 },
  commerce_reconciliation: { graceMinutes: 5, scheduleMinutes: 5 },
  weather: { graceMinutes: 30, scheduleMinutes: 180 },
} as const;

export type OperationalScheduleKey = keyof typeof operationalScheduleDefinitions;
export type OperationalScheduleStatus = "observing" | "healthy" | "failed" | "stale";

type OperationalScheduleStateRow = {
  consecutive_failures: number;
  grace_minutes: number;
  last_error_code: string | null;
  last_succeeded_at: Date | string | null;
  lifecycle: number | string;
  monitoring_started_at: Date | string;
  schedule_key: OperationalScheduleKey;
  schedule_minutes: number;
  status: OperationalScheduleStatus;
};

export type OperationalScheduleIssue = {
  errorCode: string;
  lifecycle: number;
  scheduleKey: OperationalScheduleKey;
  status: "failed" | "stale";
};

export async function runTrackedOperationalSchedule<T>(
  scheduleKey: OperationalScheduleKey,
  run: () => Promise<T>,
  dependencies: { db: DatabaseQueryClient; now?: () => Date },
) {
  const now = dependencies.now ?? (() => new Date());
  await recordOperationalScheduleStart(scheduleKey, dependencies.db, now());
  try {
    const result = await run();
    await recordOperationalScheduleSuccess(scheduleKey, dependencies.db, now());
    return result;
  } catch (error) {
    await recordOperationalScheduleFailure(scheduleKey, dependencies.db, now());
    throw error;
  }
}

export async function recordOperationalScheduleStart(
  scheduleKey: OperationalScheduleKey,
  db: DatabaseQueryClient,
  now = new Date(),
) {
  const definition = operationalScheduleDefinitions[scheduleKey];
  await db.query(
    `insert into operational_schedule_states (
       schedule_key, schedule_minutes, grace_minutes, monitoring_started_at,
       last_started_at, updated_at
     ) values ($1, $2, $3, $4, $4, $4)
     on conflict (schedule_key) do update set
       schedule_minutes = excluded.schedule_minutes,
       grace_minutes = excluded.grace_minutes,
       last_started_at = excluded.last_started_at,
       updated_at = excluded.updated_at`,
    [scheduleKey, definition.scheduleMinutes, definition.graceMinutes, now],
  );
}

export async function recordOperationalScheduleSuccess(
  scheduleKey: OperationalScheduleKey,
  db: DatabaseQueryClient,
  now = new Date(),
) {
  const definition = operationalScheduleDefinitions[scheduleKey];
  await db.query(
    `insert into operational_schedule_states (
       schedule_key, schedule_minutes, grace_minutes, status, monitoring_started_at,
       last_started_at, last_succeeded_at, consecutive_failures, updated_at
     ) values ($1, $2, $3, 'healthy', $4, $4, $4, 0, $4)
     on conflict (schedule_key) do update set
       schedule_minutes = excluded.schedule_minutes,
       grace_minutes = excluded.grace_minutes,
       status = 'healthy',
       last_succeeded_at = excluded.last_succeeded_at,
       consecutive_failures = 0,
       last_error_code = null,
       updated_at = excluded.updated_at`,
    [scheduleKey, definition.scheduleMinutes, definition.graceMinutes, now],
  );
}

export async function recordOperationalScheduleFailure(
  scheduleKey: OperationalScheduleKey,
  db: DatabaseQueryClient,
  now = new Date(),
) {
  const definition = operationalScheduleDefinitions[scheduleKey];
  const errorCode = scheduleErrorCode(scheduleKey, "failed");
  const result = await db.query<{ lifecycle: number | string }>(
    `insert into operational_schedule_states (
       schedule_key, schedule_minutes, grace_minutes, status, lifecycle,
       consecutive_failures, monitoring_started_at, last_started_at, last_failed_at,
       last_error_code, updated_at
     ) values ($1, $2, $3, 'failed', 1, 1, $4, $4, $4, $5, $4)
     on conflict (schedule_key) do update set
       schedule_minutes = excluded.schedule_minutes,
       grace_minutes = excluded.grace_minutes,
       status = 'failed',
       lifecycle = case
         when operational_schedule_states.status = 'failed'
           then operational_schedule_states.lifecycle
         else operational_schedule_states.lifecycle + 1
       end,
       consecutive_failures = operational_schedule_states.consecutive_failures + 1,
       last_failed_at = excluded.last_failed_at,
       last_error_code = excluded.last_error_code,
       updated_at = excluded.updated_at
     returning lifecycle`,
    [scheduleKey, definition.scheduleMinutes, definition.graceMinutes, now, errorCode],
  );
  return { lifecycle: Number(result.rows[0]?.lifecycle ?? 1) };
}

export async function evaluateOperationalSchedules(dependencies: {
  db: DatabaseQueryClient;
  env?: Record<string, string | undefined>;
  now?: Date;
}) {
  const now = dependencies.now ?? new Date();
  const evaluate = async (db: DatabaseQueryClient) => {
    await ensureOperationalScheduleStates(db, now);
    const locked = await db.query<OperationalScheduleStateRow>(
      `select schedule_key, schedule_minutes, grace_minutes, status, lifecycle,
         consecutive_failures, monitoring_started_at, last_succeeded_at, last_error_code
       from operational_schedule_states
       order by schedule_key
       for update`,
    );

    const issues: OperationalScheduleIssue[] = [];
    const states: Array<{
      scheduleKey: OperationalScheduleKey;
      status: OperationalScheduleStatus;
    }> = [];
    for (const row of locked.rows) {
      if (!isScheduleEnabled(row.schedule_key, dependencies.env)) {
        continue;
      }
      let status = row.status;
      let lifecycle = Number(row.lifecycle);
      const lastHealthyEvidence = new Date(row.last_succeeded_at ?? row.monitoring_started_at);
      const staleAfterMs = (row.schedule_minutes + row.grace_minutes) * 60_000;
      const stale = now.getTime() - lastHealthyEvidence.getTime() > staleAfterMs;

      if (row.consecutive_failures > 0) {
        status = "failed";
      } else if (stale) {
        if (row.status !== "stale") {
          const transitioned = await db.query<{ lifecycle: number | string }>(
            `update operational_schedule_states set
               status = 'stale', lifecycle = lifecycle + 1,
               last_error_code = $2, updated_at = $3
             where schedule_key = $1
             returning lifecycle`,
            [row.schedule_key, scheduleErrorCode(row.schedule_key, "stale"), now],
          );
          lifecycle = Number(transitioned.rows[0]?.lifecycle ?? lifecycle + 1);
        }
        status = "stale";
      }

      states.push({ scheduleKey: row.schedule_key, status });
      if (status === "failed" || status === "stale") {
        issues.push({
          errorCode: scheduleErrorCode(row.schedule_key, status),
          lifecycle,
          scheduleKey: row.schedule_key,
          status,
        });
      }
    }
    return { issues, ok: issues.length === 0, states };
  };

  return dependencies.db.transaction
    ? dependencies.db.transaction(evaluate)
    : evaluate(dependencies.db);
}

function isScheduleEnabled(
  scheduleKey: OperationalScheduleKey,
  env: Record<string, string | undefined> = process.env,
) {
  if (scheduleKey === "weather" || scheduleKey === "marine") {
    return readOpenMeteoApiMode(env) !== "off";
  }
  return true;
}

async function ensureOperationalScheduleStates(db: DatabaseQueryClient, now: Date) {
  for (const [scheduleKey, definition] of Object.entries(operationalScheduleDefinitions) as Array<
    [OperationalScheduleKey, (typeof operationalScheduleDefinitions)[OperationalScheduleKey]]
  >) {
    await db.query(
      `insert into operational_schedule_states (
         schedule_key, schedule_minutes, grace_minutes, monitoring_started_at, updated_at
       ) values ($1, $2, $3, $4, $4)
       on conflict (schedule_key) do update set
         schedule_minutes = excluded.schedule_minutes,
         grace_minutes = excluded.grace_minutes`,
      [scheduleKey, definition.scheduleMinutes, definition.graceMinutes, now],
    );
  }
}

function scheduleErrorCode(scheduleKey: OperationalScheduleKey, status: "failed" | "stale") {
  return `scheduled_${scheduleKey}_${status}`;
}
