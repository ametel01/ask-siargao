import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { assertPrivacyRestoreReady } from "@/server/privacy/restore-guard";

const privacySnapshotVersion = process.env.PRIVACY_RESTORE_SNAPSHOT_VERSION?.trim();
const sourceMaxClosedAt = process.env.PRIVACY_RESTORE_SOURCE_MAX_CLOSED_AT?.trim();
if (!privacySnapshotVersion || !sourceMaxClosedAt) {
  throw new Error(
    "PRIVACY_RESTORE_SNAPSHOT_VERSION and PRIVACY_RESTORE_SOURCE_MAX_CLOSED_AT are required.",
  );
}
const parsedClosedAt = new Date(sourceMaxClosedAt);
if (Number.isNaN(parsedClosedAt.getTime())) {
  throw new Error("PRIVACY_RESTORE_SOURCE_MAX_CLOSED_AT must be an ISO timestamp.");
}

await assertPrivacyRestoreReady(getDefaultDatabaseQueryClient(), {
  privacySnapshotVersion,
  sourceMaxClosedAt: parsedClosedAt,
});
console.info("Privacy restore guard is ready for traffic.");
