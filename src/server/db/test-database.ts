import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { listMigrationPaths, loadMigrationFiles } from "@/server/db/migration-files";
import type { MigrationDatabase, MigrationQueryValue } from "@/server/db/migration-runner";
import { runLedgerBackedMigrations } from "@/server/db/migration-runner";

const testDatabaseRoot = path.join(process.cwd(), ".tmp");
const testDatabasePrefix = "pglite-";
const testDatabaseSignals = ["SIGINT", "SIGTERM"] as const;

type TestDatabaseSignal = (typeof testDatabaseSignals)[number];

const activeTestDatabaseOwners = new Set<PgliteTestDatabaseOwner>();
const testDatabaseSignalHandlers = new Map<TestDatabaseSignal, () => void>();
let signalCleanupPromise: Promise<void> | undefined;

class PgliteTestDatabaseOwner {
  readonly directory: string;

  private readonly openDatabases = new Map<PGlite, () => Promise<void>>();
  private cleanupPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(directory: string) {
    this.directory = directory;
    registerTestDatabaseOwner(this);
  }

  get closed() {
    return this.cleanupPromise !== undefined;
  }

  async open() {
    if (this.closePromise || this.cleanupPromise) {
      throw new Error(`Test database owner for ${this.directory} is already closed.`);
    }

    let database: PGlite;
    try {
      database = new PGlite(this.directory);
    } catch (error) {
      await this.close();
      throw error;
    }

    const closeDatabase = database.close.bind(database);
    let databaseClosePromise: Promise<void> | undefined;
    const close = () => {
      databaseClosePromise ??= (async () => {
        try {
          await closeDatabase();
        } finally {
          this.openDatabases.delete(database);
          await this.cleanupWhenIdle();
        }
      })();
      return databaseClosePromise;
    };

    this.openDatabases.set(database, close);
    database.close = close;
    return database;
  }

  close() {
    this.closePromise ??= (async () => {
      const errors: unknown[] = [];
      const closeResults = await Promise.allSettled(
        [...this.openDatabases.values()].map((closeDatabase) => closeDatabase()),
      );
      errors.push(
        ...closeResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason),
      );

      try {
        await this.cleanupWhenIdle();
      } catch (error) {
        errors.push(error);
      } finally {
        unregisterTestDatabaseOwner(this);
      }

      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "PGlite test database cleanup failed.");
      }
    })();
    return this.closePromise;
  }

  private async cleanupWhenIdle() {
    if (this.openDatabases.size > 0) {
      return;
    }

    this.cleanupPromise ??= rm(this.directory, { force: true, recursive: true });
    await this.cleanupPromise;
  }
}

function registerTestDatabaseOwner(owner: PgliteTestDatabaseOwner) {
  activeTestDatabaseOwners.add(owner);
  if (testDatabaseSignalHandlers.size > 0) {
    return;
  }

  for (const signal of testDatabaseSignals) {
    const handler = () => {
      signalCleanupPromise ??= cleanupActiveTestDatabaseOwners()
        .catch(() => {
          console.error("PGlite test database cleanup failed during termination.");
        })
        .finally(() => {
          detachTestDatabaseSignalHandlers();
          process.exit(signal === "SIGINT" ? 130 : 143);
        });
    };
    testDatabaseSignalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
}

function unregisterTestDatabaseOwner(owner: PgliteTestDatabaseOwner) {
  activeTestDatabaseOwners.delete(owner);
  if (activeTestDatabaseOwners.size === 0 && !signalCleanupPromise) {
    detachTestDatabaseSignalHandlers();
  }
}

function detachTestDatabaseSignalHandlers() {
  for (const [signal, handler] of testDatabaseSignalHandlers) {
    process.off(signal, handler);
  }
  testDatabaseSignalHandlers.clear();
}

async function cleanupActiveTestDatabaseOwners() {
  const results = await Promise.allSettled(
    [...activeTestDatabaseOwners].map((owner) => owner.close()),
  );
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "PGlite test database signal cleanup failed.");
  }
}

export async function createTestDatabase() {
  await mkdir(testDatabaseRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testDatabaseRoot, testDatabasePrefix));
  return new PgliteTestDatabaseOwner(directory);
}

let defaultTestDatabaseOwner: ReturnType<typeof createTestDatabase> | undefined;

export async function withTestDatabase<T>(
  callback: (database: PGlite, directory: string) => Promise<T>,
) {
  const owner = await createTestDatabase();

  try {
    const database = await owner.open();
    return await callback(database, owner.directory);
  } finally {
    await owner.close();
  }
}

export async function resetTestDatabase() {
  const previousOwner = defaultTestDatabaseOwner;
  defaultTestDatabaseOwner = undefined;
  if (previousOwner) {
    await (await previousOwner).close();
  }

  const nextOwner = createTestDatabase();
  defaultTestDatabaseOwner = nextOwner;
  await nextOwner;
}

export async function openTestDatabase() {
  return (await getDefaultTestDatabaseOwner()).open();
}

export async function runInitialMigration(db: PGlite) {
  const migrationFiles = await loadMigrationFiles();
  return runLedgerBackedMigrations(createPgliteMigrationDatabase(db), migrationFiles);
}

export async function getMigrationPaths() {
  return listMigrationPaths();
}

export function createPgliteSeedQueryRunner(database: PGlite) {
  return async (query: TemplateStringsArray, ...params: unknown[]) => {
    const text = query.reduce(
      (statement, part, index) =>
        `${statement}${part}${index < params.length ? `$${index + 1}` : ""}`,
      "",
    );

    const result = await database.query<Record<string, unknown>>(text, params);
    return result.rows;
  };
}

export function createPgliteMigrationDatabase(db: PGlite): MigrationDatabase {
  return {
    async query<T extends Record<string, unknown>>(
      statement: string,
      params: readonly MigrationQueryValue[] = [],
    ) {
      const result = await db.query<T>(statement, [...params]);
      return result.rows;
    },
    async execute(statement: string) {
      await db.exec(statement);
    },
    async transaction<T>(callback: (database: MigrationDatabase) => Promise<T>) {
      await db.exec("begin");
      try {
        const result = await callback(createPgliteMigrationDatabase(db));
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
}

async function getDefaultTestDatabaseOwner() {
  while (true) {
    let ownerPromise = defaultTestDatabaseOwner;
    if (!ownerPromise) {
      ownerPromise = createTestDatabase();
      defaultTestDatabaseOwner = ownerPromise;
    }
    const owner = await ownerPromise;

    if (!owner.closed) {
      return owner;
    }

    if (defaultTestDatabaseOwner === ownerPromise) {
      defaultTestDatabaseOwner = undefined;
    }
  }
}
