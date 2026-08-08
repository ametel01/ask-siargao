import { seedSiargaoBaseline } from "@/server/db/seed";
import {
  createPgliteSeedQueryRunner,
  runInitialMigration,
  withTestDatabase,
} from "@/server/db/test-database";

await withTestDatabase(async (db) => {
  await runInitialMigration(db);

  const counts = await seedSiargaoBaseline(createPgliteSeedQueryRunner(db));

  console.log(
    `Seeded ${counts.areas} areas, ${counts.routes} routes, and ${counts.sources} source profiles in the Step 3 test database.`,
  );
});
