import type { DatabaseQueryClient } from "@/server/db/query-client";

export type PrivacyRestoreRequirement = {
  privacySnapshotVersion: string;
  sourceMaxClosedAt: Date;
};

export async function assertPrivacyRestoreReady(
  db: DatabaseQueryClient,
  requirement: PrivacyRestoreRequirement,
) {
  const state = await db.query<{
    privacy_snapshot_version: string;
    source_max_closed_at: Date | string;
    applied_at: Date | string;
  }>(
    `select privacy_snapshot_version, source_max_closed_at, applied_at
     from privacy_restore_guard_state where id = 'current'`,
  );
  const current = state.rows[0];
  if (!current) throw new Error("privacy_restore_state_missing");
  if (current.privacy_snapshot_version !== requirement.privacySnapshotVersion) {
    throw new Error("privacy_restore_snapshot_version_stale");
  }
  if (new Date(current.source_max_closed_at).getTime() < requirement.sourceMaxClosedAt.getTime()) {
    throw new Error("privacy_restore_closure_watermark_stale");
  }
  if (new Date(current.applied_at).getTime() < new Date(current.source_max_closed_at).getTime()) {
    throw new Error("privacy_restore_reapplication_incomplete");
  }
  return { status: "ready" as const };
}

export async function recordPrivacyRestoreApplied(
  db: DatabaseQueryClient,
  input: PrivacyRestoreRequirement & { appliedAt: Date },
) {
  if (input.appliedAt.getTime() < input.sourceMaxClosedAt.getTime()) {
    throw new Error("privacy_restore_application_precedes_snapshot");
  }
  await db.query(
    `
      insert into privacy_restore_guard_state (
        id, privacy_snapshot_version, source_max_closed_at, applied_at, created_at
      ) values ('current', $1, $2, $3, $3)
      on conflict (id) do update set
        privacy_snapshot_version = excluded.privacy_snapshot_version,
        source_max_closed_at = greatest(
          privacy_restore_guard_state.source_max_closed_at,
          excluded.source_max_closed_at
        ),
        applied_at = excluded.applied_at
    `,
    [input.privacySnapshotVersion, input.sourceMaxClosedAt, input.appliedAt],
  );
}
