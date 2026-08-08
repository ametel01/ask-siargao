import { describe, expect, test } from "bun:test";

import {
  foundationGateContract,
  localFoundationGates,
  runFoundationGatePlan,
} from "@/server/qa/foundation-gates";
import { runLocalFoundationGates } from "@/server/qa/run-foundation-local";

describe("Foundation Gate contract", () => {
  test("keeps the ten manifest gates in command execution order", () => {
    expect(foundationGateContract).toEqual([
      { command: ["bun", "run", "lint"], id: "bun_run_lint" },
      {
        command: ["bun", "run", "typecheck", "--incremental", "false"],
        id: "bun_run_typecheck_incremental_false",
      },
      { command: ["bun", "test"], id: "bun_test" },
      { command: ["bun", "run", "db:migrate:test"], id: "bun_run_db_migrate_test" },
      { command: ["bun", "run", "db:seed:test"], id: "bun_run_db_seed_test" },
      { command: ["bun", "run", "build"], id: "bun_run_build" },
      { command: ["bun", "run", "test:e2e"], id: "bun_run_test_e2e" },
      {
        command: ["bun", "run", "test:e2e:production-perf"],
        id: "bun_run_test_e2e_production_perf",
      },
      {
        command: ["bun", "run", "test:integration:postgres"],
        id: "bun_run_test_integration_postgres",
      },
      {
        command: ["bun", "run", "test:integration:redis"],
        id: "bun_run_test_integration_redis",
      },
    ]);
  });

  test("limits the local aggregate to the first eight non-provider gates", () => {
    expect(localFoundationGates.map((gate) => gate.id)).toEqual([
      "bun_run_lint",
      "bun_run_typecheck_incremental_false",
      "bun_test",
      "bun_run_db_migrate_test",
      "bun_run_db_seed_test",
      "bun_run_build",
      "bun_run_test_e2e",
      "bun_run_test_e2e_production_perf",
    ]);
    expect(localFoundationGates.flatMap((gate) => gate.command)).not.toContain(
      "--foundation-ci-gates-passed",
    );
  });

  test("does not start a downstream local gate while its upstream gate is pending", async () => {
    const lintResult = deferred<number>();
    const started: string[] = [];
    const result = runFoundationGatePlan(localFoundationGates, (gate) => {
      started.push(gate.id);
      return gate.id === "bun_run_lint" ? lintResult.promise : Promise.resolve(0);
    });

    await Promise.resolve();
    expect(started).toEqual(["bun_run_lint"]);

    lintResult.resolve(0);
    expect(await result).toBe(0);
    expect(started).toEqual(localFoundationGates.map((gate) => gate.id));
  });

  test("returns each local failure and does not start any later gate", async () => {
    for (const [failedIndex, failedGate] of localFoundationGates.entries()) {
      const started: string[] = [];
      const result = await runFoundationGatePlan(localFoundationGates, async (gate) => {
        started.push(gate.id);
        return gate.id === failedGate.id ? 17 : 0;
      });

      expect(result).toBe(17);
      expect(started).toEqual(
        localFoundationGates.slice(0, failedIndex + 1).map((gate) => gate.id),
      );
    }
  });

  test("runs the local command plan through the subprocess boundary", async () => {
    const commands: string[][] = [];

    const exitCode = await runLocalFoundationGates(async (command) => {
      commands.push([...command]);
      return 0;
    });

    expect(exitCode).toBe(0);
    expect(commands).toEqual(localFoundationGates.map((gate) => [...gate.command]));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
