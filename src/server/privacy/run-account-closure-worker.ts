import { type DatabaseQueryClient, getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import {
  type AccountClosureProviders,
  readAccountClosurePolicy,
  runClosureCleanupBatch,
} from "@/server/privacy/account-closure";
import { createProductionAccountClosureProviders } from "@/server/privacy/account-closure-providers";

export async function runAccountClosureWorker(
  dependencies: {
    db?: DatabaseQueryClient;
    env?: Record<string, string | undefined>;
    log?: (message: string) => void;
    now?: Date;
    providers?: AccountClosureProviders;
  } = {},
) {
  const env = dependencies.env ?? process.env;
  const result = await runClosureCleanupBatch({
    db: dependencies.db ?? getDefaultDatabaseQueryClient(),
    limit: readPositiveLimit(env.ACCOUNT_CLOSURE_WORKER_BATCH_SIZE),
    now: dependencies.now ?? new Date(),
    policy: readAccountClosurePolicy(env),
    providers: dependencies.providers ?? createProductionAccountClosureProviders({ env }),
  });

  (dependencies.log ?? console.info)(
    JSON.stringify({ attempted: result.attempted, checked: "account-closure-worker" }),
  );
  return result;
}

if (import.meta.main) await runAccountClosureWorker();

function readPositiveLimit(raw: string | undefined) {
  if (!raw?.trim()) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("ACCOUNT_CLOSURE_WORKER_BATCH_SIZE must be a positive integer.");
  }
  return value;
}
