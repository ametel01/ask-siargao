import postgres from "postgres";

export type QueryResult<T> = { rows: T[] };

export type DatabaseQueryClient = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
};

let defaultQueryClient: DatabaseQueryClient | null = null;

export function createDatabaseQueryClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database query client.");
  }

  const sql = postgres(databaseUrl, { prepare: false });
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const rows = await sql.unsafe(query, params as never[]);
      return { rows: rows as unknown as T[] };
    },
  } satisfies DatabaseQueryClient;
}

export function getDefaultDatabaseQueryClient() {
  defaultQueryClient ??= createDatabaseQueryClient();
  return defaultQueryClient;
}
