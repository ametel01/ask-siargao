import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  closureSubjectHashCandidates,
  currentClosureSubjectHash,
  readClosureSubjectHashPolicy,
} from "@/server/privacy/closure-subject";

export const accountClosureVerificationConfig = {
  level: "second_factor",
  // Clerk's factor age is an integer number of minutes and its helper compares
  // `afterMinutes > age`. Six therefore gives the required inclusive 0..5 range.
  afterMinutes: 6,
} as const;

const closureStepTypes = [
  "clerk_deletion",
  "checkout_expiry",
  "local_erasure",
  "commerce_minimization",
  "identity_erasure",
] as const;

type ClosureStepType = (typeof closureStepTypes)[number];

export type AccountClosurePolicy = {
  alertAfterAttempts: number;
  closurePolicyVersion: string;
  closureRetentionMs: number;
  commercePolicyVersion: string;
  commerceRetentionMs: number;
  providerSubjectEncryptionKey: string;
  providerSubjectEncryptionKeyVersion: number;
  tombstoneHashKey: string;
  tombstoneHashVersion: number;
  tombstonePreviousHashKeys?: ReadonlyArray<{ key: string; version: number }>;
};

export type AccountClosureProviders = {
  deleteClerkUser(userId: string): Promise<void>;
  expireCheckoutSession(sessionId: string): Promise<void>;
};

type BeginAccountClosureDependencies = {
  afterCommit?: (result: AccountClosureResult) => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  createId?: (prefix: string) => string;
  db: DatabaseQueryClient;
  policy: AccountClosurePolicy;
};

export type AccountClosureResult = {
  status: "closed" | "already_closed";
  operationRef: string;
  tombstoneRef: string;
};

type ClosureStepRow = {
  id: string;
  operation_id: string;
  step_type: ClosureStepType;
  attempts: number;
  lease_token: string;
  lease_expires_at: Date | string;
};

export async function beginAccountClosure(
  input: {
    userId: string;
    now: Date;
    allowMissingUser?: boolean;
    clerkDeletionConfirmed?: boolean;
    operationType?: "traveler_requested_closure" | "clerk_deletion_identity_sync";
  },
  dependencies: BeginAccountClosureDependencies,
): Promise<AccountClosureResult> {
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  const result = await withDatabaseTransaction(dependencies.db, async (transaction) => {
    await lockTripPassFamily(input.userId, transaction);
    await lockAccountWrites(input.userId, transaction);
    const phaseOneAt = await readDatabaseClock(transaction);

    const subjectHash = currentClosureSubjectHash(input.userId, dependencies.policy).hash;
    let existingClosure: { tombstone_id: string; operation_id: string } | undefined;
    for (const candidate of closureSubjectHashCandidates(input.userId, dependencies.policy)) {
      const existing = await transaction.query<{
        tombstone_id: string;
        operation_id: string;
      }>(
        `select t.id as tombstone_id, o.id as operation_id
         from account_closure_tombstones t
         join account_closure_operations o on o.tombstone_id = t.id
         where t.subject_type = 'clerk_user_id'
           and t.subject_hash_version = $1 and t.subject_hash = $2
         order by o.created_at asc limit 1`,
        [candidate.version, candidate.hash],
      );
      existingClosure = existing.rows[0];
      if (existingClosure) break;
    }
    if (existingClosure) {
      await convergeExistingClosure(input, dependencies, existingClosure, transaction, phaseOneAt);
      return {
        status: "already_closed" as const,
        operationRef: existingClosure.operation_id,
        tombstoneRef: existingClosure.tombstone_id,
      };
    }

    const user = await transaction.query<{ id: string }>(
      "select id from users where id = $1 for update",
      [input.userId],
    );
    if (!user.rows[0] && !input.allowMissingUser) {
      throw new Error("account_not_found");
    }
    if (!user.rows[0]) {
      await transaction.query(
        `insert into users (id, deleted_at, created_at, updated_at)
         values ($1, null, $2, $2) on conflict (id) do nothing`,
        [input.userId, phaseOneAt],
      );
    }

    const tombstoneRef = createId("closure_tombstone");
    const operationRef = createId("closure_operation");
    const purgeAfter = new Date(phaseOneAt.getTime() + dependencies.policy.closureRetentionMs);
    const encryptedSubject = encryptProviderSubject(
      input.userId,
      dependencies.policy.providerSubjectEncryptionKey,
    );

    await transaction.query(
      `
        insert into account_closure_tombstones (
          id, subject_hash, subject_hash_version, subject_type,
          closure_policy_version, closed_at, purge_after, created_at, updated_at
        ) values ($1, $2, $3, 'clerk_user_id', $4, $5, $6, $5, $5)
      `,
      [
        tombstoneRef,
        subjectHash,
        dependencies.policy.tombstoneHashVersion,
        dependencies.policy.closurePolicyVersion,
        phaseOneAt,
        purgeAfter,
      ],
    );
    await transaction.query(
      `
        insert into account_closure_write_barriers (
          id, tombstone_id, subject_hash, subject_hash_version, subject_type,
          status, opened_at, created_at, updated_at
        ) values ($1, $2, $3, $4, 'clerk_user_id', 'active', $5, $5, $5)
      `,
      [
        createId("closure_barrier"),
        tombstoneRef,
        subjectHash,
        dependencies.policy.tombstoneHashVersion,
        phaseOneAt,
      ],
    );
    await transaction.query(
      `
        insert into account_closure_operations (
          id, tombstone_id, operation_type, status, attempts,
          phase_one_committed_at, closure_policy_version, commerce_policy_version,
          alert_after_attempts, created_at, updated_at
        ) values ($1, $2, $7, 'pending', 0,
          $3, $4, $5, $6, $3, $3)
      `,
      [
        operationRef,
        tombstoneRef,
        phaseOneAt,
        dependencies.policy.closurePolicyVersion,
        dependencies.policy.commercePolicyVersion,
        dependencies.policy.alertAfterAttempts,
        input.operationType ?? "traveler_requested_closure",
      ],
    );
    await transaction.query(
      `
        insert into account_closure_provider_subjects (
          operation_id, ciphertext, iv, auth_tag, key_version, created_at
        ) values ($1, $2, $3, $4, $5, $6)
      `,
      [
        operationRef,
        encryptedSubject.ciphertext,
        encryptedSubject.iv,
        encryptedSubject.authTag,
        dependencies.policy.providerSubjectEncryptionKeyVersion,
        phaseOneAt,
      ],
    );

    for (const stepType of closureStepTypes) {
      await transaction.query(
        `
          insert into account_closure_steps (
            id, operation_id, step_type, status, attempts, next_attempt_at,
            created_at, updated_at, completed_at
          ) values ($1, $2, $3, $5, 0, $4, $4, $4, $6)
        `,
        [
          `${operationRef}:${stepType}`,
          operationRef,
          stepType,
          input.now,
          input.clerkDeletionConfirmed && stepType === "clerk_deletion" ? "succeeded" : "pending",
          input.clerkDeletionConfirmed && stepType === "clerk_deletion" ? input.now : null,
        ],
      );
    }

    await transaction.query(
      `
        insert into account_closure_checkout_sessions (
          operation_id, stripe_checkout_session_id, status, created_at, updated_at
        )
        select $1, stripe_checkout_session_id, 'pending', $2, $2
        from trip_pass_orders
        where user_id = $3
          and status in ('pending', 'checkout_created')
          and stripe_checkout_session_id is not null
        on conflict (operation_id, stripe_checkout_session_id) do nothing
      `,
      [operationRef, input.now, input.userId],
    );
    await transaction.query(
      `
        delete from shared_trip_plans
        where trip_id in (select id from saved_trips where user_id = $1)
      `,
      [input.userId],
    );
    await transaction.query(
      `
        update trip_usage_events
        set event_type = 'released', occurred_at = $2, created_at = least(created_at, $2)
        where user_id = $1 and event_type = 'reserved'
      `,
      [input.userId, phaseOneAt],
    );
    await transaction.query(
      `update trip_passes set status = 'cancelled', updated_at = $2
       where user_id = $1 and status = 'active'`,
      [input.userId, phaseOneAt],
    );
    await transaction.query(
      `
        update trip_pass_orders
        set user_id = null, email = null, stripe_customer_id = null,
            metadata_json = '{}'::jsonb, closure_tombstone_id = $2,
            closure_outcome = case
              when status in ('pending', 'checkout_created') then 'blocked_at_closure'
              else closure_outcome
            end,
            updated_at = $3
        where user_id = $1
      `,
      [input.userId, tombstoneRef, phaseOneAt],
    );
    await dependencies.beforeCommit?.();
    await linearizeNewClosurePhaseOne({
      clerkDeletionConfirmed: input.clerkDeletionConfirmed ?? false,
      closureRetentionMs: dependencies.policy.closureRetentionMs,
      operationRef,
      tombstoneRef,
      transaction,
      userId: input.userId,
    });
    return { status: "closed" as const, operationRef, tombstoneRef };
  });

  await dependencies.afterCommit?.(result);
  return result;
}

async function linearizeNewClosurePhaseOne(input: {
  clerkDeletionConfirmed: boolean;
  closureRetentionMs: number;
  operationRef: string;
  tombstoneRef: string;
  transaction: DatabaseQueryClient;
  userId: string;
}) {
  const result = await input.transaction.query<{ phase_one_at: Date | string }>(
    `with boundary as materialized (
       select clock_timestamp() as phase_one_at
     ), tombstone_update as (
       update account_closure_tombstones
       set closed_at = boundary.phase_one_at,
         purge_after = boundary.phase_one_at + ($4 * interval '1 millisecond'),
         created_at = boundary.phase_one_at, updated_at = boundary.phase_one_at
       from boundary where id = $1 returning id
     ), barrier_update as (
       update account_closure_write_barriers
       set opened_at = boundary.phase_one_at,
         created_at = boundary.phase_one_at, updated_at = boundary.phase_one_at
       from boundary where tombstone_id = $1 returning id
     ), operation_update as (
       update account_closure_operations
       set phase_one_committed_at = boundary.phase_one_at,
         created_at = boundary.phase_one_at, updated_at = boundary.phase_one_at
       from boundary where id = $2 returning id
     ), subject_update as (
       update account_closure_provider_subjects
       set created_at = boundary.phase_one_at
       from boundary where operation_id = $2 returning operation_id
     ), usage_update as (
       update trip_usage_events
       set occurred_at = boundary.phase_one_at,
         created_at = least(created_at, boundary.phase_one_at)
       from boundary where user_id = $3 and event_type = 'released' returning id
     ), pass_update as (
       update trip_passes
       set updated_at = boundary.phase_one_at
       from boundary where user_id = $3 and status = 'cancelled' returning id
     ), order_update as (
       update trip_pass_orders
       set updated_at = boundary.phase_one_at
       from boundary where closure_tombstone_id = $1 returning id
     ), user_update as (
       update users
       set email = case when $5 then null else email end,
         first_name = case when $5 then null else first_name end,
         last_name = case when $5 then null else last_name end,
         image_url = case when $5 then null else image_url end,
         clerk_updated_at = case when $5 then null else clerk_updated_at end,
         last_seen_at = case when $5 then null else last_seen_at end,
         deleted_at = boundary.phase_one_at, updated_at = boundary.phase_one_at
       from boundary
       where id = $3
         and (select count(*) from usage_update) >= 0
         and (select count(*) from pass_update) >= 0
         and (select count(*) from order_update) >= 0
       returning id
     )
     select phase_one_at from boundary`,
    [
      input.tombstoneRef,
      input.operationRef,
      input.userId,
      input.closureRetentionMs,
      input.clerkDeletionConfirmed,
    ],
  );
  if (!result.rows[0]?.phase_one_at) throw new Error("database_clock_unavailable");
}

async function convergeExistingClosure(
  input: Parameters<typeof beginAccountClosure>[0],
  dependencies: BeginAccountClosureDependencies,
  existingClosure: { operation_id: string; tombstone_id: string },
  transaction: DatabaseQueryClient,
  phaseOneAt: Date,
) {
  const encryptedSubject = encryptProviderSubject(
    input.userId,
    dependencies.policy.providerSubjectEncryptionKey,
  );
  await transaction.query(
    `update account_closure_operations set
       phase_one_committed_at = coalesce(phase_one_committed_at, $2),
       closure_policy_version = coalesce(closure_policy_version, $3),
       commerce_policy_version = coalesce(commerce_policy_version, $4),
       alert_after_attempts = $5,
       status = case when status = 'failed' then 'pending' else status end,
       updated_at = $2
     where id = $1`,
    [
      existingClosure.operation_id,
      phaseOneAt,
      dependencies.policy.closurePolicyVersion,
      dependencies.policy.commercePolicyVersion,
      dependencies.policy.alertAfterAttempts,
    ],
  );
  await transaction.query(
    `insert into account_closure_provider_subjects
       (operation_id, ciphertext, iv, auth_tag, key_version, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (operation_id) do nothing`,
    [
      existingClosure.operation_id,
      encryptedSubject.ciphertext,
      encryptedSubject.iv,
      encryptedSubject.authTag,
      dependencies.policy.providerSubjectEncryptionKeyVersion,
      phaseOneAt,
    ],
  );
  for (const stepType of closureStepTypes) {
    const clerkConfirmed = input.clerkDeletionConfirmed && stepType === "clerk_deletion";
    await transaction.query(
      `insert into account_closure_steps
         (id, operation_id, step_type, status, attempts, next_attempt_at,
          created_at, updated_at, completed_at)
       values ($1, $2, $3, $5, 0, $4, $4, $4, $6)
       on conflict (operation_id, step_type) do update set
         status = case when $5 = 'succeeded' then 'succeeded' else account_closure_steps.status end,
         completed_at = case when $5 = 'succeeded'
           then coalesce(account_closure_steps.completed_at, $6)
           else account_closure_steps.completed_at end,
         next_attempt_at = case when $5 = 'succeeded' then null
           else account_closure_steps.next_attempt_at end,
         lease_token = case when $5 = 'succeeded' then null
           else account_closure_steps.lease_token end,
         lease_expires_at = case when $5 = 'succeeded' then null
           else account_closure_steps.lease_expires_at end,
         last_error_category = case when $5 = 'succeeded' then null
           else account_closure_steps.last_error_category end,
         updated_at = $4`,
      [
        `${existingClosure.operation_id}:${stepType}`,
        existingClosure.operation_id,
        stepType,
        input.now,
        clerkConfirmed ? "succeeded" : "pending",
        clerkConfirmed ? input.now : null,
      ],
    );
  }
  await transaction.query(
    `insert into account_closure_checkout_sessions
       (operation_id, stripe_checkout_session_id, status, created_at, updated_at)
     select $1, stripe_checkout_session_id, 'pending', $2, $2
     from trip_pass_orders
     where user_id = $3 and status in ('pending', 'checkout_created')
       and stripe_checkout_session_id is not null
     on conflict (operation_id, stripe_checkout_session_id) do nothing`,
    [existingClosure.operation_id, input.now, input.userId],
  );
  await transaction.query(
    `delete from shared_trip_plans
     where trip_id in (select id from saved_trips where user_id = $1)`,
    [input.userId],
  );
  await transaction.query(
    `update trip_usage_events set event_type = 'released', occurred_at = $2,
       created_at = least(created_at, $2)
     where user_id = $1 and event_type = 'reserved'`,
    [input.userId, phaseOneAt],
  );
  await transaction.query(
    `update trip_passes set status = 'cancelled', updated_at = $2
     where user_id = $1 and status = 'active'`,
    [input.userId, phaseOneAt],
  );
  await transaction.query(
    `update trip_pass_orders set user_id = null, email = null, stripe_customer_id = null,
       metadata_json = '{}'::jsonb, closure_tombstone_id = $2,
       closure_outcome = case when status in ('pending', 'checkout_created')
         then 'blocked_at_closure' else closure_outcome end,
       updated_at = $3 where user_id = $1`,
    [input.userId, existingClosure.tombstone_id, phaseOneAt],
  );
  await transaction.query(
    `update users set email = case when $3 then null else email end,
       first_name = case when $3 then null else first_name end,
       last_name = case when $3 then null else last_name end,
       image_url = case when $3 then null else image_url end,
       clerk_updated_at = case when $3 then null else clerk_updated_at end,
       last_seen_at = case when $3 then null else last_seen_at end,
       deleted_at = $2, updated_at = $2 where id = $1 and deleted_at is null`,
    [input.userId, phaseOneAt, input.clerkDeletionConfirmed ?? false],
  );
  if (input.clerkDeletionConfirmed) {
    await transaction.query(
      `update users set email = null, first_name = null, last_name = null, image_url = null,
         clerk_updated_at = null, last_seen_at = null, updated_at = $2
       where id = $1 and deleted_at is not null`,
      [input.userId, phaseOneAt],
    );
  }
}

export async function runClosureCleanupBatch(input: {
  db: DatabaseQueryClient;
  now: Date;
  policy: AccountClosurePolicy;
  providers: AccountClosureProviders;
  leaseMs?: number;
  jitterUnit?: number;
  limit?: number;
}) {
  const limit = input.limit ?? 100;
  let attempted = 0;
  for (const stepType of closureStepTypes) {
    while (attempted < limit) {
      const step = await claimClosureStep(input.db, stepType, input.now, input.leaseMs ?? 60_000);
      if (!step) {
        break;
      }
      attempted += 1;
      try {
        await executeClosureStep(step, input);
        await markClosureStepSucceeded(input.db, step, input.now);
      } catch (error) {
        await markClosureStepRetryable(input.db, step, input.now, input.jitterUnit ?? 0.5, error);
      }
    }
  }
  await completeFinishedClosureOperations(input.db, input.now);
  return { attempted };
}

export function closureRetryDelayMs(attempt: number, jitterUnit = 0.5) {
  const boundedAttempt = Math.max(1, Math.min(attempt, 16));
  const base = Math.min(60_000 * 2 ** (boundedAttempt - 1), 24 * 60 * 60 * 1_000);
  const unit = Math.max(0, Math.min(jitterUnit, 1));
  return Math.round(base * (0.75 + unit * 0.5));
}

export async function purgeEligibleClosureTombstones(
  db: DatabaseQueryClient,
  now: Date,
  limit = 100,
) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("purge_limit_invalid");
  return withDatabaseTransaction(db, async (transaction) => {
    await transaction.query(
      `delete from retained_commerce_evidence where id in (
         select id from retained_commerce_evidence
         where retention_expires_at < $1 order by retention_expires_at, id limit $2
       )`,
      [now, limit],
    );
    const eligible = await transaction.query<{ id: string }>(
      `
        select t.id
        from account_closure_tombstones t
        where t.purge_after is not null and t.purge_after < $1
          and not exists (
            select 1 from account_closure_operations o
            where o.tombstone_id = t.id and o.status <> 'succeeded'
          )
          and not exists (
            select 1 from account_closure_refund_obligations r
            where r.tombstone_id = t.id and r.status <> 'succeeded'
          )
          and not exists (
            select 1 from retained_commerce_evidence e where e.tombstone_id = t.id
          )
        order by t.purge_after, t.id
        for update skip locked
        limit $2
      `,
      [now, limit],
    );
    for (const tombstone of eligible.rows) {
      await transaction.query(
        `delete from trip_pass_refund_facts where order_id in (
           select id from trip_pass_orders
           where closure_tombstone_id = $1
              or closure_refund_obligation_id in (
                select id from account_closure_refund_obligations where tombstone_id = $1
              )
         )`,
        [tombstone.id],
      );
      await transaction.query(
        `delete from trip_pass_dispute_facts where order_id in (
           select id from trip_pass_orders
           where closure_tombstone_id = $1
              or closure_refund_obligation_id in (
                select id from account_closure_refund_obligations where tombstone_id = $1
              )
         )`,
        [tombstone.id],
      );
      await transaction.query(
        `delete from trip_pass_orders
         where closure_tombstone_id = $1
            or closure_refund_obligation_id in (
              select id from account_closure_refund_obligations where tombstone_id = $1
            )`,
        [tombstone.id],
      );
      await transaction.query(
        "delete from account_closure_refund_obligations where tombstone_id = $1",
        [tombstone.id],
      );
      await transaction.query("delete from account_closure_operations where tombstone_id = $1", [
        tombstone.id,
      ]);
      await transaction.query(
        "delete from account_closure_write_barriers where tombstone_id = $1",
        [tombstone.id],
      );
      await transaction.query("delete from account_closure_tombstones where id = $1", [
        tombstone.id,
      ]);
    }
    return { purged: eligible.rows.length };
  });
}

async function claimClosureStep(
  db: DatabaseQueryClient,
  stepType: ClosureStepType,
  now: Date,
  leaseMs: number,
) {
  return withDatabaseTransaction(db, async (transaction) => {
    const candidate = await transaction.query<ClosureStepRow>(
      `
        select id, operation_id, step_type, attempts, lease_token, lease_expires_at
        from account_closure_steps
        where step_type = $1
          and status <> 'succeeded'
          and (next_attempt_at is null or next_attempt_at <= $2)
          and (status = 'pending' or lease_expires_at <= clock_timestamp())
        order by created_at, id
        for update skip locked
        limit 1
      `,
      [stepType, now],
    );
    const row = candidate.rows[0];
    if (!row) {
      return null;
    }
    const leaseToken = randomUUID();
    const leaseStartedAt = await readDatabaseClock(transaction);
    const claimed = await transaction.query<ClosureStepRow>(
      `
        update account_closure_steps
        set status = 'running', attempts = attempts + 1, lease_token = $2,
            lease_expires_at = $3, updated_at = $4
        where id = $1
        returning id, operation_id, step_type, attempts, lease_token, lease_expires_at
      `,
      [row.id, leaseToken, new Date(leaseStartedAt.getTime() + leaseMs), now],
    );
    return claimed.rows[0] ?? null;
  });
}

async function executeClosureStep(
  step: ClosureStepRow,
  input: {
    db: DatabaseQueryClient;
    now: Date;
    policy: AccountClosurePolicy;
    providers: AccountClosureProviders;
  },
) {
  if (step.step_type === "clerk_deletion") {
    const userId = await decryptOperationSubject(step.operation_id, input.db, input.policy);
    await input.providers.deleteClerkUser(userId);
    return;
  }
  if (step.step_type === "checkout_expiry") {
    const sessions = await input.db.query<{ stripe_checkout_session_id: string }>(
      `select stripe_checkout_session_id from account_closure_checkout_sessions
       where operation_id = $1 and status = 'pending' order by stripe_checkout_session_id`,
      [step.operation_id],
    );
    for (const session of sessions.rows) {
      await input.providers.expireCheckoutSession(session.stripe_checkout_session_id);
      await input.db.query(
        `update account_closure_checkout_sessions
         set status = 'succeeded', completed_at = $3, updated_at = $3, last_error_category = null
         where operation_id = $1 and stripe_checkout_session_id = $2
           and exists (
             select 1 from account_closure_steps s
             where s.id = $4 and s.status = 'running' and s.lease_token = $5
               and s.lease_expires_at > clock_timestamp()
           )`,
        [
          step.operation_id,
          session.stripe_checkout_session_id,
          input.now,
          step.id,
          step.lease_token,
        ],
      );
    }
    return;
  }
  if (step.step_type === "local_erasure") {
    await eraseLocalProductData(step.operation_id, step.lease_token, input.db, input.policy);
    return;
  }
  if (step.step_type === "commerce_minimization") {
    await minimizeCommerceData(
      step.operation_id,
      step.lease_token,
      input.db,
      input.now,
      input.policy,
    );
    return;
  }

  const prerequisites = await input.db.query<{ count: string }>(
    `select count(*)::text as count from account_closure_steps
     where operation_id = $1 and step_type in ('local_erasure', 'commerce_minimization')
       and status <> 'succeeded'`,
    [step.operation_id],
  );
  if (Number(prerequisites.rows[0]?.count ?? 0) > 0) {
    throw new ClosureStepDeferredError();
  }
  const userId = await decryptOperationSubject(step.operation_id, input.db, input.policy);
  await withDatabaseTransaction(input.db, async (transaction) => {
    await configureCleanupBypass(transaction, step.lease_token);
    await transaction.query("delete from users where id = $1", [userId]);
  });
}

async function eraseLocalProductData(
  operationId: string,
  leaseToken: string,
  db: DatabaseQueryClient,
  policy: AccountClosurePolicy,
) {
  const userId = await decryptOperationSubject(operationId, db, policy);
  await withDatabaseTransaction(db, async (transaction) => {
    await configureCleanupBypass(transaction, leaseToken);
    await transaction.query(
      `delete from chat_response_ratings where user_id = $1
       or thread_id in (select id from chat_threads where user_id = $1)`,
      [userId],
    );
    await transaction.query(
      `delete from chat_messages where user_id = $1
       or thread_id in (select id from chat_threads where user_id = $1)`,
      [userId],
    );
    await transaction.query("delete from chat_threads where user_id = $1", [userId]);
    await transaction.query(
      `delete from shared_trip_plans
       where trip_id in (select id from saved_trips where user_id = $1)`,
      [userId],
    );
    await transaction.query(
      `delete from saved_trip_items
       where trip_id in (select id from saved_trips where user_id = $1)`,
      [userId],
    );
    await transaction.query("delete from saved_trips where user_id = $1", [userId]);
    await transaction.query("delete from user_profiles where user_id = $1", [userId]);

    await transaction.query(
      `delete from llm_tool_calls where llm_run_id in (
        select l.id from llm_runs l join audit_runs r on r.id = l.audit_run_id
        join audit_requests a on a.id = r.audit_request_id where a.user_id = $1
      )`,
      [userId],
    );
    await transaction.query(
      `delete from reviewer_results where audit_run_id in (
         select r.id from audit_runs r join audit_requests a on a.id = r.audit_request_id
         where a.user_id = $1
       ) or llm_run_id in (
         select l.id from llm_runs l join audit_runs r on r.id = l.audit_run_id
         join audit_requests a on a.id = r.audit_request_id where a.user_id = $1
       )`,
      [userId],
    );
    await transaction.query(
      `delete from llm_runs where audit_run_id in (
        select r.id from audit_runs r join audit_requests a on a.id = r.audit_request_id
        where a.user_id = $1
      )`,
      [userId],
    );
    for (const table of ["audit_reports", "audit_completeness_checks", "audit_inputs"]) {
      await transaction.query(
        `delete from ${table} where audit_request_id in (select id from audit_requests where user_id = $1)`,
        [userId],
      );
    }
    await transaction.query(
      "delete from audit_runs where audit_request_id in (select id from audit_requests where user_id = $1)",
      [userId],
    );
  });
}

async function minimizeCommerceData(
  operationId: string,
  leaseToken: string,
  db: DatabaseQueryClient,
  now: Date,
  policy: AccountClosurePolicy,
) {
  const userId = await decryptOperationSubject(operationId, db, policy);
  const operation = await db.query<{ tombstone_id: string }>(
    "select tombstone_id from account_closure_operations where id = $1",
    [operationId],
  );
  const tombstoneId = operation.rows[0]?.tombstone_id;
  if (!tombstoneId) {
    throw new Error("closure_operation_missing");
  }
  const retentionExpiresAt = new Date(now.getTime() + policy.commerceRetentionMs);

  await withDatabaseTransaction(db, async (transaction) => {
    await configureCleanupBypass(transaction, leaseToken);
    await transaction.query(
      `
        insert into retained_commerce_evidence (
          id, tombstone_id, source_type, source_ref, amount_minor, currency,
          lifecycle_status, stripe_checkout_session_id, stripe_payment_intent_id,
          stripe_event_id, policy_version, occurred_at, retention_expires_at, created_at
        )
        select 'retained_legacy_payment_' || p.id, $2, 'legacy_payment', p.id,
          round(p.amount_usd * 100)::integer, 'usd', p.status,
          p.stripe_checkout_session_id, p.stripe_payment_intent_id, p.stripe_event_id,
          $3, p.created_at, $4, $5
        from payments p join audit_requests a on a.id = p.audit_request_id
        where a.user_id = $1
        on conflict (source_type, source_ref) do nothing
      `,
      [userId, tombstoneId, policy.commercePolicyVersion, retentionExpiresAt, now],
    );
    await transaction.query(
      `
        insert into retained_commerce_evidence (
          id, tombstone_id, source_type, source_ref, lifecycle_status,
          stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id,
          policy_version, occurred_at, retention_expires_at, created_at
        )
        select 'retained_legacy_event_' || e.id, $2, 'legacy_payment_event', e.id,
          e.event_type, e.stripe_checkout_session_id, e.stripe_payment_intent_id,
          e.stripe_event_id, $3, e.verified_at, $4, $5
        from payment_events e join audit_requests a on a.id = e.audit_request_id
        where a.user_id = $1
        on conflict (source_type, source_ref) do nothing
      `,
      [userId, tombstoneId, policy.commercePolicyVersion, retentionExpiresAt, now],
    );
    await transaction.query(
      `
        insert into retained_commerce_evidence (
          id, tombstone_id, source_type, source_ref, amount_minor, currency,
          product_code, product_version, product_family, lifecycle_status, lifecycle_timestamps,
          stripe_checkout_session_id, stripe_payment_intent_id, policy_version,
          consent_policy_versions, aggregate_service_facts, occurred_at,
          retention_expires_at, created_at
        )
        select 'retained_trip_order_' || o.id, $2, 'trip_pass_order', o.id,
          o.amount_total_minor, o.currency, o.product_code, o.product_version, o.product_family,
          o.status,
          jsonb_strip_nulls(jsonb_build_object(
            'createdAt', o.created_at,
            'updatedAt', o.updated_at,
            'completedAt', o.completed_at,
            'lifecycleUpdatedAt', o.lifecycle_updated_at,
            'capturedAmountMinor', o.captured_amount_minor,
            'successfulRefundAmountMinor', o.successful_refund_amount_minor,
            'refundState', o.refund_state,
            'disputeState', o.dispute_state,
            'terminalRevocationReason', o.terminal_revocation_reason,
            'checkoutSessionExpiresAt', o.checkout_session_expires_at,
            'checkoutCancellationConfirmedAt', o.checkout_cancellation_confirmed_at
          )),
          o.stripe_checkout_session_id, o.stripe_payment_intent_id, $3,
          jsonb_strip_nulls(jsonb_build_object(
            'termsPolicyVersion', o.terms_policy_version,
            'refundPolicyVersion', o.refund_policy_version,
            'privacyPolicyVersion', o.privacy_policy_version,
            'retentionPolicyVersion', o.retention_policy_version,
            'termsConsentPresentedAt', o.terms_consent_presented_at
          )),
          '{}'::jsonb, coalesce(o.completed_at, o.created_at), $4, $5
        from trip_pass_orders o
        where o.user_id = $1 or o.closure_tombstone_id = $2
        on conflict (source_type, source_ref) do update set
          tombstone_id = excluded.tombstone_id,
          amount_minor = excluded.amount_minor,
          currency = excluded.currency,
          product_code = excluded.product_code,
          product_version = excluded.product_version,
          product_family = excluded.product_family,
          lifecycle_status = excluded.lifecycle_status,
          lifecycle_timestamps = excluded.lifecycle_timestamps,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          stripe_payment_intent_id = excluded.stripe_payment_intent_id,
          policy_version = excluded.policy_version,
          consent_policy_versions = excluded.consent_policy_versions,
          aggregate_service_facts = excluded.aggregate_service_facts,
          occurred_at = excluded.occurred_at,
          retention_expires_at = least(
            retained_commerce_evidence.retention_expires_at,
            excluded.retention_expires_at
          )
      `,
      [userId, tombstoneId, policy.commercePolicyVersion, retentionExpiresAt, now],
    );
    await transaction.query(
      `
        insert into retained_commerce_evidence (
          id, tombstone_id, source_type, source_ref, amount_minor, currency,
          product_code, product_version, product_family, lifecycle_status, lifecycle_timestamps,
          stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id,
          policy_version, consent_policy_versions, aggregate_service_facts,
          occurred_at, retention_expires_at, created_at
        )
        select 'retained_trip_pass_' || p.id, $2, 'trip_pass', p.id,
          contract.amount_total_minor, contract.currency, contract.product_code,
          contract.product_version, contract.product_family, p.status,
          jsonb_strip_nulls(jsonb_build_object(
            'startsAt', p.starts_at,
            'expiresAt', p.expires_at,
            'createdAt', p.created_at,
            'updatedAt', p.updated_at
          )),
          p.stripe_checkout_session_id, p.stripe_payment_intent_id, p.stripe_event_id, $3,
          jsonb_strip_nulls(jsonb_build_object(
            'termsPolicyVersion', contract.terms_policy_version,
            'refundPolicyVersion', contract.refund_policy_version,
            'privacyPolicyVersion', contract.privacy_policy_version,
            'retentionPolicyVersion', contract.retention_policy_version,
            'termsConsentPresentedAt', contract.terms_consent_presented_at
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'quantity', contract.quantity,
            'durationDays', contract.duration_days,
            'meterTotals', coalesce(meters.totals, '{}'::jsonb)
          )),
          p.starts_at, $4, $5
        from trip_passes p
        left join lateral (
          select g.product_code, g.product_version, g.quantity, g.duration_days,
            o.amount_total_minor, o.currency, o.product_family,
            o.terms_policy_version, o.refund_policy_version, o.privacy_policy_version,
            o.retention_policy_version, o.terms_consent_presented_at
          from trip_pass_grants g
          left join trip_pass_orders o on o.id = g.order_id
          where g.trip_pass_id = p.id
          order by g.created_at, g.id
          limit 1
        ) contract on true
        left join lateral (
          select jsonb_object_agg(meter_type, facts) as totals
          from (
            select m.meter_type,
              jsonb_build_object('used', m.used, 'limit', m."limit") as facts
            from trip_usage_meters m
            where m.trip_pass_id = p.id
            order by m.meter_type
          ) meter_facts
        ) meters on true
        where p.user_id = $1
        on conflict (source_type, source_ref) do update set
          tombstone_id = excluded.tombstone_id,
          amount_minor = excluded.amount_minor,
          currency = excluded.currency,
          product_code = excluded.product_code,
          product_version = excluded.product_version,
          product_family = excluded.product_family,
          lifecycle_status = excluded.lifecycle_status,
          lifecycle_timestamps = excluded.lifecycle_timestamps,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          stripe_payment_intent_id = excluded.stripe_payment_intent_id,
          stripe_event_id = excluded.stripe_event_id,
          policy_version = excluded.policy_version,
          consent_policy_versions = excluded.consent_policy_versions,
          aggregate_service_facts = excluded.aggregate_service_facts,
          occurred_at = excluded.occurred_at,
          retention_expires_at = least(
            retained_commerce_evidence.retention_expires_at,
            excluded.retention_expires_at
          )
      `,
      [userId, tombstoneId, policy.commercePolicyVersion, retentionExpiresAt, now],
    );

    await transaction.query(
      "delete from payment_events where audit_request_id in (select id from audit_requests where user_id = $1)",
      [userId],
    );
    await transaction.query(
      "delete from payments where audit_request_id in (select id from audit_requests where user_id = $1)",
      [userId],
    );
    await transaction.query("delete from audit_requests where user_id = $1", [userId]);
    await transaction.query(
      `delete from trip_usage_events
       where user_id = $1
          or trip_pass_id in (select id from trip_passes where user_id = $1)`,
      [userId],
    );
    await transaction.query(
      `delete from trip_usage_meters
       where trip_pass_id in (select id from trip_passes where user_id = $1)`,
      [userId],
    );
    await transaction.query(
      `delete from trip_pass_grants
       where user_id = $1
          or trip_pass_id in (select id from trip_passes where user_id = $1)
          or order_id in (select id from trip_pass_orders where closure_tombstone_id = $2)`,
      [userId, tombstoneId],
    );
    await transaction.query("delete from trip_passes where user_id = $1", [userId]);
    await transaction.query(
      `delete from trip_pass_orders o
       where o.closure_tombstone_id = $1
         and o.closure_refund_obligation_id is null
         and o.stripe_checkout_session_id is null
         and not exists (select 1 from trip_pass_refund_facts r where r.order_id = o.id)
         and not exists (select 1 from trip_pass_dispute_facts d where d.order_id = o.id)
         and not (
           o.status in ('pending', 'checkout_created')
           and o.stripe_checkout_session_id is null
         )`,
      [tombstoneId],
    );
    await transaction.query(
      `update trip_pass_orders
       set user_id = null, email = null, stripe_customer_id = null,
         checkout_idempotency_key = 'closed:' || id, metadata_json = '{}'::jsonb,
         closure_tombstone_id = case
           when closure_refund_obligation_id is not null then null
           else closure_tombstone_id
         end,
         updated_at = $2
       where closure_tombstone_id = $1`,
      [tombstoneId, now],
    );
  });
}

async function markClosureStepSucceeded(db: DatabaseQueryClient, step: ClosureStepRow, now: Date) {
  return db.query(
    `update account_closure_steps set status = 'succeeded', lease_token = null,
      lease_expires_at = null, next_attempt_at = null, last_error_category = null,
      completed_at = greatest($2, created_at), updated_at = greatest($2, created_at)
      where id = $1 and status = 'running' and lease_token = $3
        and lease_expires_at > clock_timestamp()`,
    [step.id, now, step.lease_token],
  );
}

async function markClosureStepRetryable(
  db: DatabaseQueryClient,
  step: ClosureStepRow,
  now: Date,
  jitterUnit: number,
  error: unknown,
) {
  const deferred = error instanceof ClosureStepDeferredError;
  const nextAttemptAt = new Date(
    now.getTime() + (deferred ? 1_000 : closureRetryDelayMs(step.attempts, jitterUnit)),
  );
  await db.query(
    `
      update account_closure_steps s
      set status = 'pending', lease_token = null, lease_expires_at = null,
        next_attempt_at = $2,
        last_error_category = $3,
        alerted_at = case
          when s.attempts >= o.alert_after_attempts then coalesce(s.alerted_at, $4)
          else s.alerted_at
        end,
        updated_at = $4
      from account_closure_operations o
      where s.id = $1 and o.id = s.operation_id
        and s.status = 'running' and s.lease_token = $5
        and s.lease_expires_at > clock_timestamp()
    `,
    [
      step.id,
      nextAttemptAt,
      deferred ? "prerequisite_pending" : sanitizedErrorCategory(error, step.step_type),
      now,
      step.lease_token,
    ],
  );
}

async function configureCleanupBypass(db: DatabaseQueryClient, leaseToken: string) {
  await db.query("select set_config('ask_siargao.account_closure_cleanup_lease', $1, true)", [
    leaseToken,
  ]);
}

async function completeFinishedClosureOperations(db: DatabaseQueryClient, now: Date) {
  await db.query(
    `
      update account_closure_operations o
      set status = 'succeeded',
        completed_at = greatest($1, o.phase_one_committed_at),
        updated_at = greatest($1, o.phase_one_committed_at)
      where status <> 'succeeded'
        and not exists (
          select 1 from account_closure_steps s
          where s.operation_id = o.id and s.status <> 'succeeded'
        )
    `,
    [now],
  );
}

async function decryptOperationSubject(
  operationId: string,
  db: DatabaseQueryClient,
  policy: AccountClosurePolicy,
) {
  const subject = await db.query<{
    ciphertext: string;
    iv: string;
    auth_tag: string;
    key_version: number;
  }>(
    `select ciphertext, iv, auth_tag, key_version
     from account_closure_provider_subjects where operation_id = $1`,
    [operationId],
  );
  const row = subject.rows[0];
  if (!row || row.key_version !== policy.providerSubjectEncryptionKeyVersion) {
    throw new Error("provider_subject_key_unavailable");
  }
  return decryptProviderSubject(row, policy.providerSubjectEncryptionKey);
}

function encryptProviderSubject(value: string, encodedKey: string) {
  const key = encryptionKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
  };
}

function decryptProviderSubject(
  row: { ciphertext: string; iv: string; auth_tag: string },
  encodedKey: string,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(encodedKey),
    Buffer.from(row.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptionKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("ACCOUNT_CLOSURE_PROVIDER_SUBJECT_KEY must decode to 32 bytes.");
  }
  return key;
}

async function lockAccountWrites(userId: string, db: DatabaseQueryClient) {
  await db.query(
    "select pg_advisory_xact_lock(hashtext('ask-siargao-account-write'), hashtext($1))",
    [userId],
  );
}

async function lockTripPassFamily(userId: string, db: DatabaseQueryClient) {
  await db.query("select pg_advisory_xact_lock(hashtext($1), hashtext('siargao_trip_pass'))", [
    userId,
  ]);
}

async function readDatabaseClock(db: DatabaseQueryClient) {
  const result = await db.query<{ now: Date | string }>("select clock_timestamp() as now");
  const value = result.rows[0]?.now;
  if (!value) throw new Error("database_clock_unavailable");
  return new Date(value);
}

function sanitizedErrorCategory(error: unknown, stepType?: ClosureStepType) {
  if (error instanceof ClosureStepDeferredError) {
    return "prerequisite_pending";
  }
  if (error instanceof Error && /key|decrypt/i.test(error.message)) {
    return "configuration_unavailable";
  }
  if (stepType === "local_erasure" || stepType === "identity_erasure") {
    return "local_cleanup_failed";
  }
  if (stepType === "commerce_minimization") {
    return "commerce_cleanup_failed";
  }
  return "provider_unavailable";
}

class ClosureStepDeferredError extends Error {}

async function withDatabaseTransaction<T>(
  db: DatabaseQueryClient,
  callback: (transaction: DatabaseQueryClient) => Promise<T>,
) {
  if (db.transaction) {
    return db.transaction(callback);
  }
  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

export function readAccountClosurePolicy(
  env: Record<string, string | undefined> = process.env,
): AccountClosurePolicy {
  const isProduction = env.NODE_ENV === "production";
  const required = (name: string, local: string) => {
    const value = env[name]?.trim();
    if (value) return value;
    if (isProduction) throw new Error(`${name} is required in production.`);
    return local;
  };
  const positiveNumber = (name: string, local: number) => {
    const raw = env[name]?.trim();
    const value = raw ? Number(raw) : local;
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
    return value;
  };
  const hashPolicy = readClosureSubjectHashPolicy(env);
  return {
    alertAfterAttempts: positiveNumber("ACCOUNT_CLOSURE_ALERT_AFTER_ATTEMPTS", 3),
    closurePolicyVersion: required("ACCOUNT_CLOSURE_POLICY_VERSION", "local-closure-v1"),
    closureRetentionMs: positiveNumber("ACCOUNT_CLOSURE_RETENTION_DAYS", 30) * 24 * 60 * 60 * 1_000,
    commercePolicyVersion: required("COMMERCE_RETENTION_POLICY_VERSION", "local-commerce-v1"),
    commerceRetentionMs: positiveNumber("COMMERCE_RETENTION_DAYS", 365) * 24 * 60 * 60 * 1_000,
    providerSubjectEncryptionKey: required(
      "ACCOUNT_CLOSURE_PROVIDER_SUBJECT_KEY",
      Buffer.alloc(32, 1).toString("base64"),
    ),
    providerSubjectEncryptionKeyVersion: positiveNumber(
      "ACCOUNT_CLOSURE_PROVIDER_SUBJECT_KEY_VERSION",
      1,
    ),
    ...hashPolicy,
  };
}
