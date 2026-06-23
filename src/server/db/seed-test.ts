import { seedSiargaoBaseline } from "@/server/db/seed";
import { openTestDatabase } from "@/server/db/test-database";

const db = await openTestDatabase();

const counts = await seedSiargaoBaseline(async (query, params = []) => {
  const result = await db.query(query, params);
  return result.rows as Record<string, unknown>[];
});

await db.close();

console.log(
  `Seeded ${counts.areas} areas, ${counts.routes} routes, and ${counts.sources} source profiles in the Step 3 test database.`,
);
