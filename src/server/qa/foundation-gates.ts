export type FoundationGate = {
  readonly command: readonly string[];
  readonly execution: "local" | "real-service";
  readonly id: string;
};

export const foundationGateContract = [
  { command: ["bun", "run", "lint"], execution: "local", id: "bun_run_lint" },
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
  { command: ["bun", "run", "build"], execution: "local", id: "bun_run_build" },
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
] as const satisfies readonly FoundationGate[];

export const localFoundationGates: readonly FoundationGate[] = foundationGateContract.filter(
  (gate) => gate.execution === "local",
);

export const foundationGateIds = foundationGateContract.map((gate) => gate.id);

export async function runFoundationGatePlan(
  gates: readonly FoundationGate[],
  runGate: (gate: FoundationGate) => Promise<number>,
) {
  for (const gate of gates) {
    const exitCode = await runGate(gate);
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}
