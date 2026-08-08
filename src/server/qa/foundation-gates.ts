export type FoundationGate = {
  readonly command: readonly string[];
  readonly id: string;
};

export const foundationGateContract = [
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
] as const satisfies readonly FoundationGate[];

export const localFoundationGates: readonly FoundationGate[] = foundationGateContract.slice(0, 8);

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
