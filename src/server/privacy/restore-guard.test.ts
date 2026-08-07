import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import {
  assertPrivacyRestoreReady,
  recordPrivacyRestoreApplied,
} from "@/server/privacy/restore-guard";

describe("privacy restore guard", () => {
  test("fails closed for a restored pre-closure fixture until current privacy state is reapplied", async () => {
    const database = new PGlite();
    await runInitialMigration(database);
    const db = client(database);
    await database.query(
      "insert into users (id, email) values ('restored_user', 'restored@example.com')",
    );
    const requirement = {
      privacySnapshotVersion: "privacy-snapshot-42",
      sourceMaxClosedAt: new Date("2026-08-07T04:00:00.000Z"),
    };

    await expect(assertPrivacyRestoreReady(db, requirement)).rejects.toThrow(
      "privacy_restore_state_missing",
    );
    await recordPrivacyRestoreApplied(db, {
      ...requirement,
      appliedAt: new Date("2026-08-07T04:05:00.000Z"),
    });
    await expect(assertPrivacyRestoreReady(db, requirement)).resolves.toEqual({ status: "ready" });
    await expect(
      assertPrivacyRestoreReady(db, {
        privacySnapshotVersion: "privacy-snapshot-43",
        sourceMaxClosedAt: new Date("2026-08-07T05:00:00.000Z"),
      }),
    ).rejects.toThrow("privacy_restore_snapshot_version_stale");
    await database.close();
  });
});

function client(database: PGlite): DatabaseQueryClient {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => {
      const result = await database.query<T>(sql, params);
      return { rows: result.rows };
    },
  };
}
