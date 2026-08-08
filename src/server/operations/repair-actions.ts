import { createHash, randomUUID } from "node:crypto";

import { redactDiagnosticValue } from "@/server/admin/redaction";
import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { authorizeOperator, type OperatorAuthSnapshot } from "@/server/operations/operator-auth";

export type RepairActionType =
  | "grant_missing_trip_pass"
  | "initialize_missing_meters"
  | "release_stale_reservation"
  | "manual_commerce_transition"
  | "goodwill_grant"
  | "account_recovery";

export type RepairPreview = {
  actionType: RepairActionType;
  after: Record<string, unknown>;
  before: Record<string, unknown>;
  digest: string;
  findingId: string;
};

export type LocalRepairExecutor = {
  preview(input: {
    actionType: RepairActionType;
    finding: RepairFinding;
    db: DatabaseQueryClient;
  }): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  apply(input: {
    actionType: RepairActionType;
    finding: RepairFinding;
    db: DatabaseQueryClient;
  }): Promise<Record<string, unknown>>;
};

type RepairFinding = {
  id: string;
  kind: string;
  local_entity_type: string;
  local_entity_ref: string;
  summary_code: string;
  status: "open" | "resolved";
};

export async function previewRepairAction(
  input: { actionType: RepairActionType; findingId: string },
  dependencies: { db?: DatabaseQueryClient; executor: LocalRepairExecutor },
): Promise<RepairPreview> {
  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  const finding = await loadFinding(input.findingId, db);
  if (finding?.status !== "open") throw new Error("repair_finding_unavailable");
  const preview = sanitizePreview(
    await dependencies.executor.preview({ actionType: input.actionType, db, finding }),
  );
  return {
    actionType: input.actionType,
    after: preview.after,
    before: preview.before,
    digest: previewDigest(input.findingId, input.actionType, preview),
    findingId: input.findingId,
  };
}

export async function executeRepairAction(
  input: {
    actionType: RepairActionType;
    auth: OperatorAuthSnapshot;
    confirmation: string;
    findingId: string;
    idempotencyKey: string;
    previewDigest: string;
    reasonCode: string;
  },
  dependencies: {
    allowlist: ReadonlySet<string>;
    createId?: (prefix: string) => string;
    db?: DatabaseQueryClient;
    executor: LocalRepairExecutor;
  },
) {
  const authorization = authorizeOperator({
    allowlist: dependencies.allowlist,
    auth: input.auth,
    mutation: true,
  });
  if (!authorization.allowed) return { status: "denied" as const, reason: authorization.reason };
  if (input.confirmation !== "APPLY REPAIR") {
    return { status: "denied" as const, reason: "explicit_confirmation_required" as const };
  }
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.reasonCode)) {
    return { status: "denied" as const, reason: "invalid_reason_code" as const };
  }
  if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
    return { status: "denied" as const, reason: "invalid_idempotency_key" as const };
  }

  const db = dependencies.db ?? getDefaultDatabaseQueryClient();
  if (!db.transaction) throw new Error("database_transactions_required");
  const idempotencyHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
  const commandHash = repairCommandHash(input);
  const createId = dependencies.createId ?? ((prefix: string) => `${prefix}_${randomUUID()}`);
  return db.transaction(async (transaction) => {
    const replay = await transaction.query<{
      id: string;
      after_state: Record<string, unknown>;
      command_hash: string;
    }>(
      `select id, after_state, command_hash from operator_repair_actions
       where operator_account_id = $1 and idempotency_key_hash = $2`,
      [authorization.accountId, idempotencyHash],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].command_hash !== commandHash) {
        throw new Error("repair_idempotency_mismatch");
      }
      return {
        actionId: replay.rows[0].id,
        after: replay.rows[0].after_state,
        status: "replayed" as const,
      };
    }
    const findingResult = await transaction.query<RepairFinding>(
      `select id, kind, local_entity_type, local_entity_ref, summary_code, status
       from operational_findings where id = $1 for update`,
      [input.findingId],
    );
    const finding = findingResult.rows[0];
    const replayAfterFindingLock = await transaction.query<{
      id: string;
      after_state: Record<string, unknown>;
      command_hash: string;
    }>(
      `select id, after_state, command_hash from operator_repair_actions
       where operator_account_id = $1 and idempotency_key_hash = $2`,
      [authorization.accountId, idempotencyHash],
    );
    if (replayAfterFindingLock.rows[0]) {
      if (replayAfterFindingLock.rows[0].command_hash !== commandHash) {
        throw new Error("repair_idempotency_mismatch");
      }
      return {
        actionId: replayAfterFindingLock.rows[0].id,
        after: replayAfterFindingLock.rows[0].after_state,
        status: "replayed" as const,
      };
    }
    if (finding?.status !== "open") throw new Error("repair_finding_unavailable");
    const preview = sanitizePreview(
      await dependencies.executor.preview({
        actionType: input.actionType,
        db: transaction,
        finding,
      }),
    );
    if (previewDigest(finding.id, input.actionType, preview) !== input.previewDigest) {
      throw new Error("repair_preview_changed");
    }
    const actionId = createId("repair_action");
    const clock = await transaction.query<{ now: Date | string }>(
      "select clock_timestamp() as now",
    );
    const at = new Date(clock.rows[0]?.now ?? Date.now());
    const reserved = await transaction.query<{ id: string }>(
      `insert into operator_repair_actions (
         id, finding_id, operator_account_id, idempotency_key_hash, command_hash,
         action_type, reason_code, before_state, after_state, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       on conflict (operator_account_id, idempotency_key_hash) do nothing
       returning id`,
      [
        actionId,
        finding.id,
        authorization.accountId,
        idempotencyHash,
        commandHash,
        input.actionType,
        input.reasonCode,
        JSON.stringify(preview.before),
        JSON.stringify(preview.after),
        at,
      ],
    );
    if (!reserved.rows[0]) {
      const conflict = await transaction.query<{
        id: string;
        after_state: Record<string, unknown>;
        command_hash: string;
      }>(
        `select id, after_state, command_hash from operator_repair_actions
         where operator_account_id = $1 and idempotency_key_hash = $2`,
        [authorization.accountId, idempotencyHash],
      );
      if (!conflict.rows[0] || conflict.rows[0].command_hash !== commandHash) {
        throw new Error("repair_idempotency_mismatch");
      }
      return {
        actionId: conflict.rows[0].id,
        after: conflict.rows[0].after_state,
        status: "replayed" as const,
      };
    }
    const after = sanitizeState(
      await dependencies.executor.apply({ actionType: input.actionType, db: transaction, finding }),
    );
    await transaction.query(
      "update operator_repair_actions set after_state = $2::jsonb where id = $1",
      [actionId, JSON.stringify(after)],
    );
    await transaction.query(
      `update operational_findings set status = 'resolved', resolved_at = $2
       where id = $1 and status = 'open'`,
      [finding.id, at],
    );
    return { actionId, after, status: "applied" as const };
  });
}

function repairCommandHash(input: {
  actionType: RepairActionType;
  findingId: string;
  previewDigest: string;
  reasonCode: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actionType: input.actionType,
        findingId: input.findingId,
        previewDigest: input.previewDigest,
        reasonCode: input.reasonCode,
      }),
    )
    .digest("hex");
}

function sanitizePreview(preview: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return { before: sanitizeState(preview.before), after: sanitizeState(preview.after) };
}

function sanitizeState(state: Record<string, unknown>): Record<string, unknown> {
  const sanitized = redactDiagnosticValue(state) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > 16_384) throw new Error("repair_state_too_large");
  return sanitized;
}

function previewDigest(
  findingId: string,
  actionType: RepairActionType,
  preview: { before: Record<string, unknown>; after: Record<string, unknown> },
) {
  return createHash("sha256")
    .update(JSON.stringify({ actionType, findingId, ...preview }))
    .digest("hex");
}

async function loadFinding(findingId: string, db: DatabaseQueryClient) {
  const result = await db.query<RepairFinding>(
    `select id, kind, local_entity_type, local_entity_ref, summary_code, status
     from operational_findings where id = $1`,
    [findingId],
  );
  return result.rows[0] ?? null;
}
