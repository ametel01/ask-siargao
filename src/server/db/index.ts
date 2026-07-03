import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";
import * as schema from "@/server/db/schema";

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database client.");
  }

  const client = postgres(databaseUrl, createPostgresConnectionOptions("app"));
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabaseClient>;
