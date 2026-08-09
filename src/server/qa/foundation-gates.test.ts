import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import {
  foundationGateContract,
  localFoundationGates,
  runFoundationGatePlan,
} from "@/server/qa/foundation-gates";
import {
  type LocalFoundationCommandRunner,
  runLocalFoundationGates,
  runLocalFoundationVerification,
} from "@/server/qa/run-foundation-local";

describe("Foundation Gate contract", () => {
  test("keeps the ten manifest gates in command execution order", () => {
    expect(foundationGateContract).toEqual([
      {
        command: ["bun", "run", "lint"],
        execution: "local",
        id: "bun_run_lint",
      },
      {
        command: ["bun", "run", "typecheck", "--incremental", "false"],
        execution: "local",
        id: "bun_run_typecheck_incremental_false",
      },
      { command: ["bun", "test"], execution: "local", id: "bun_test" },
      {
        command: ["bun", "run", "db:migrate:test"],
        execution: "local",
        id: "bun_run_db_migrate_test",
      },
      {
        command: ["bun", "run", "db:seed:test"],
        execution: "local",
        id: "bun_run_db_seed_test",
      },
      {
        command: ["bun", "run", "build"],
        execution: "local",
        id: "bun_run_build",
      },
      {
        command: ["bun", "run", "test:e2e"],
        execution: "local",
        id: "bun_run_test_e2e",
      },
      {
        command: ["bun", "run", "test:e2e:production-perf"],
        execution: "local",
        id: "bun_run_test_e2e_production_perf",
      },
      {
        command: ["bun", "run", "test:integration:postgres"],
        execution: "real-service",
        id: "bun_run_test_integration_postgres",
      },
      {
        command: ["bun", "run", "test:integration:redis"],
        execution: "real-service",
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

  test("forwards termination to the active local gate before exiting", async () => {
    const processLike = new EventEmitter() as EventEmitter & {
      exit(code?: number): void;
    };
    const activeGate = deferred<number>();
    const exited = deferred<number | undefined>();
    const events: string[] = [];
    processLike.exit = (code?: number) => {
      events.push(`exit:${code}`);
      exited.resolve(code);
    };
    const commandRunner: LocalFoundationCommandRunner = {
      async run(command) {
        events.push(`run:${command.join(" ")}`);
        return activeGate.promise;
      },
      async stop(signal) {
        events.push(`stop:${signal}`);
        activeGate.resolve(signal === "SIGINT" ? 130 : 143);
      },
    };

    const verification = runLocalFoundationVerification({
      commandRunner,
      lifecycleProcess: processLike,
    });

    await until(() => events.some((event) => event.startsWith("run:")));
    processLike.emit("SIGTERM");

    expect(await exited.promise).toBe(143);
    expect(await verification).toBe(143);
    expect(events).toEqual(["run:bun run lint", "stop:SIGTERM", "exit:143"]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for local Foundation Gate test event.");
}
