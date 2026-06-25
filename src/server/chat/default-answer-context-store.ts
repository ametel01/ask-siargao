import postgres from "postgres";

import { AnswerContextStore } from "@/server/chat/answer-context-store";
import type { GooglePlacesStoreDatabase } from "@/server/providers/google-places-store";

type PostgresParameter = postgres.ParameterOrJSON<never>;

let cachedDatabaseUrl: string | undefined;
let cachedStore: AnswerContextStore | undefined;

export function getDefaultAnswerContextStore(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return undefined;
  }

  if (cachedStore && cachedDatabaseUrl === databaseUrl) {
    return cachedStore;
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db: GooglePlacesStoreDatabase = {
    async query<T>(query: string, params: unknown[] = []) {
      const rows = await sql.unsafe(query, params as PostgresParameter[]);
      return { rows: rows as unknown as T[] };
    },
  };

  cachedDatabaseUrl = databaseUrl;
  cachedStore = new AnswerContextStore({ db });
  return cachedStore;
}
