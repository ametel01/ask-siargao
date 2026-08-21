import postgres, { type Sql } from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";

export type QueryResult<T> = { rows: T[] };

export type DatabaseQueryClient = {
  dialect?: "pglite" | "postgres";
  inTransaction?: boolean;
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
  queryWithSignal?<T>(
    query: string,
    params: unknown[],
    signal: AbortSignal,
  ): Promise<QueryResult<T>>;
  transaction?<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>): Promise<T>;
};

type CancelableQuery = Promise<unknown> & { cancel?: () => void };

type PostgresTemplateExecutor = (
  strings: TemplateStringsArray,
  ...params: never[]
) => CancelableQuery;

let defaultQueryClient: DatabaseQueryClient | null = null;

function createDatabaseQueryClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database query client.");
  }

  const sql = postgres(databaseUrl, createPostgresConnectionOptions("app"));
  return createPostgresQueryClient(sql);
}

export function createPostgresQueryClient(
  sql: PostgresTemplateExecutor,
  options: { inTransaction?: boolean } = {},
) {
  const client: DatabaseQueryClient = {
    dialect: "postgres",
    inTransaction: options.inTransaction,
    async query<T>(query: string, params: unknown[] = []) {
      const preparedQuery = toTemplateQuery(query, params);
      const rows = await sql(preparedQuery.strings, ...(preparedQuery.params as never[]));
      return { rows: rows as unknown as T[] };
    },
    async queryWithSignal<T>(query: string, params: unknown[], signal: AbortSignal) {
      signal.throwIfAborted();
      const preparedQuery = toTemplateQuery(query, params);
      const pending = sql(preparedQuery.strings, ...(preparedQuery.params as never[]));
      const cancel = () => pending.cancel?.();
      signal.addEventListener("abort", cancel, { once: true });
      let rows: unknown;
      try {
        rows = await pending;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
      return { rows: rows as unknown as T[] };
    },
  };
  if (isPostgresSql(sql) && !options.inTransaction) {
    client.transaction = async <T>(
      callback: (transactionClient: DatabaseQueryClient) => Promise<T>,
    ) =>
      (await sql.begin(async (transactionSql) =>
        callback(createPostgresQueryClient(transactionSql, { inTransaction: true })),
      )) as T;
  }

  return client;
}

export function getDefaultDatabaseQueryClient() {
  defaultQueryClient ??= createDatabaseQueryClient();
  return defaultQueryClient;
}

export function queryDatabaseWithSignal<T>(
  db: DatabaseQueryClient,
  query: string,
  params: unknown[],
  signal?: AbortSignal,
) {
  if (!signal) return db.query<T>(query, params);
  if (db.queryWithSignal) return db.queryWithSignal<T>(query, params, signal);
  signal.throwIfAborted();
  return db.query<T>(query, params);
}

function toTemplateQuery(query: string, params: readonly unknown[]) {
  const strings: string[] = [];
  const boundParams: unknown[] = [];
  let lastIndex = 0;

  for (const match of query.matchAll(/\$(\d+)\b/g)) {
    strings.push(query.slice(lastIndex, match.index));
    const paramIndex = Number(match[1]) - 1;
    if (!Number.isInteger(paramIndex) || paramIndex < 0 || paramIndex >= params.length) {
      throw new Error(`Missing SQL parameter for ${match[0]}.`);
    }
    boundParams.push(params[paramIndex]);
    lastIndex = match.index + match[0].length;
  }

  strings.push(query.slice(lastIndex));
  return {
    strings: toTemplateStringsArray(strings),
    params: boundParams,
  };
}

function toTemplateStringsArray(strings: readonly string[]): TemplateStringsArray {
  const cooked = [...strings];
  return Object.assign(cooked, { raw: [...strings] }) as unknown as TemplateStringsArray;
}

function isPostgresSql(sql: PostgresTemplateExecutor): sql is Sql {
  return "begin" in sql && typeof (sql as Partial<Sql>).begin === "function";
}
