import {
  formatAgentMemoryVectorStoreSyncResult,
  syncAgentMemoryVectorStore,
} from "@/server/chat/agent-memory-vector-store";

type SyncCliOptions = {
  dryRun: boolean;
  vectorStoreId?: string;
};

export async function runAgentMemoryVectorStoreSyncCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await syncAgentMemoryVectorStore({
    dryRun: options.dryRun,
    ...(options.vectorStoreId ? { vectorStoreId: options.vectorStoreId } : {}),
  });

  console.log(formatAgentMemoryVectorStoreSyncResult(result));
}

function parseArgs(argv: readonly string[]): SyncCliOptions {
  let dryRun = false;
  let vectorStoreId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--vector-store-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--vector-store-id requires a value.");
      }
      vectorStoreId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown agent memory sync argument: ${arg}`);
  }

  return { dryRun, ...(vectorStoreId ? { vectorStoreId } : {}) };
}

if (import.meta.main) {
  runAgentMemoryVectorStoreSyncCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
