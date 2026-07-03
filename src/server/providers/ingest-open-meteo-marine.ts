import postgres from "postgres";

import { buildOpenMeteoMarineIngestionBatch } from "@/server/providers/open-meteo-marine";
import {
  type ProviderBatchWriteDatabase,
  upsertProviderFactGraphBatch,
} from "@/server/providers/provider-write-batches";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to ingest Open-Meteo Marine forecasts.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const batch = await buildOpenMeteoMarineIngestionBatch({});

  await sql.begin(async (tx) => {
    await upsertProviderFactGraphBatch(postgresTransactionDatabase(tx), batch);
  });

  console.log(
    `Ingested Open-Meteo Marine forecast: ${batch.facts.length} facts, ${batch.evidence.length} evidence rows, refresh scheduled at ${batch.refreshJob.scheduledAt}.`,
  );
} finally {
  await sql.end();
}

function postgresTransactionDatabase(tx: {
  unsafe(query: string, params?: unknown[]): Promise<object[]>;
}): ProviderBatchWriteDatabase {
  return {
    async query<T>(query: string, params?: unknown[]) {
      const rows = await tx.unsafe(query, params);
      return { rows: rows as T[] };
    },
  };
}
