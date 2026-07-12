import postgres, { type Sql } from "postgres";

import { createPostgresConnectionOptions } from "@/server/db/connection-options";

export type QueryResult<T> = { rows: T[] };

export type DatabaseQueryClient = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction?<T>(callback: (transactionClient: DatabaseQueryClient) => Promise<T>): Promise<T>;
};

type PostgresTemplateExecutor = (
  strings: TemplateStringsArray,
  ...params: never[]
) => Promise<unknown>;

let defaultQueryClient: DatabaseQueryClient | null = null;

function createDatabaseQueryClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database query client.");
  }

  const sql = postgres(databaseUrl, createPostgresConnectionOptions("app"));
  return createPostgresQueryClient(sql);
}

export function createPostgresQueryClient(sql: PostgresTemplateExecutor) {
  const client: DatabaseQueryClient = {
    async query<T>(query: string, params: unknown[] = []) {
      const preparedQuery = toTemplateQuery(query, params);
      const rows = await sql(preparedQuery.strings, ...(preparedQuery.params as never[]));
      return { rows: rows as unknown as T[] };
    },
  };
  if (isPostgresSql(sql)) {
    client.transaction = async <T>(
      callback: (transactionClient: DatabaseQueryClient) => Promise<T>,
    ) =>
      (await sql.begin(async (transactionSql) =>
        callback(createPostgresQueryClient(transactionSql)),
      )) as T;
  }

  return client;
}

export function getDefaultDatabaseQueryClient() {
  defaultQueryClient ??= createDatabaseQueryClient();
  return defaultQueryClient;
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
