import postgres from "postgres";

export type QueryResult<T> = { rows: T[] };

export type DatabaseQueryClient = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
};

let defaultQueryClient: DatabaseQueryClient | null = null;

function createDatabaseQueryClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database query client.");
  }

  const sql = postgres(databaseUrl, { prepare: false });
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const preparedQuery = toTemplateQuery(query, params);
      const rows = await sql(preparedQuery.strings, ...(preparedQuery.params as never[]));
      return { rows: rows as unknown as T[] };
    },
  } satisfies DatabaseQueryClient;
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
