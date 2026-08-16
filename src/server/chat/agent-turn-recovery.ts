/**
 * The request-scoped boundary for recovering an interrupted agent turn.
 *
 * This module deliberately knows nothing about persistence, allowances, billing, or HTTP
 * delivery. It only schedules bounded in-process recovery work and classifies its terminal
 * disposition. Durable Travel Answer admission consumes the result outside this seam.
 */

export type AgentTurnRecoveryPublicReason =
  | "model_response_budget_exhausted"
  | "model_response_invalid"
  | "model_response_unavailable";

export type AgentTurnRecoveryFailureReason =
  | "generation_aborted"
  | "programming_error"
  | "invariant_violation"
  | "recovery_failed";

export type AgentTurnRecoveryDisposition<T> =
  | {
      type: "continuation";
      value?: T;
    }
  | {
      type: "ordinary_completion";
      value: T;
    }
  | {
      type: "limited_answer_candidate";
      value: T;
      reason: AgentTurnRecoveryPublicReason;
    }
  | {
      type: "failure";
      reason: AgentTurnRecoveryFailureReason;
      error?: unknown;
    };

export type AgentTurnRecoveryResult<T> = AgentTurnRecoveryDisposition<T>;
export type AgentTurnRecoveryOutcome<T> = AgentTurnRecoveryDisposition<T>;

export type AgentTurnRecoveryStrategyContext<C, T> = {
  input: C;
  attempt: number;
  lifecycle: AgentTurnRecoveryLifecycle<C, T>;
};

export type AgentTurnRecoveryStrategy<C, T> = {
  name: string;
  dependsOn?: readonly string[];
  run: (
    context: AgentTurnRecoveryStrategyContext<C, T>,
  ) => AgentTurnRecoveryDisposition<T> | Promise<AgentTurnRecoveryDisposition<T>>;
};

export type AgentTurnRecoverySummary = {
  requestId: string;
  outcome: AgentTurnRecoveryDisposition<unknown>["type"];
  reason?: AgentTurnRecoveryPublicReason | AgentTurnRecoveryFailureReason;
  attempts: number;
  strategies: readonly string[];
  durationMs: number;
};

export type AgentTurnRecoveryOptions<C, T> = {
  requestId: string;
  strategies: readonly AgentTurnRecoveryStrategy<C, T>[];
  generationSignal?: AbortSignal;
  maxAttempts?: number;
  onSummary?: (summary: AgentTurnRecoverySummary) => void;
};

export class AgentTurnRecoveryInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTurnRecoveryInvariantError";
  }
}

export class AgentTurnRecoveryLifecycle<C, T> {
  readonly #requestId: string;
  readonly #strategies: readonly AgentTurnRecoveryStrategy<C, T>[];
  readonly #generationSignal?: AbortSignal;
  readonly #maxAttempts: number;
  readonly #onSummary?: (summary: AgentTurnRecoverySummary) => void;
  #terminal = false;
  #completed: AgentTurnRecoveryDisposition<T> | undefined;
  #failed = false;
  #failure: unknown;
  #running: Promise<AgentTurnRecoveryDisposition<T>> | undefined;
  #attempts = 0;
  #startedAt = Date.now();
  #strategyNames: string[] = [];

  constructor(options: AgentTurnRecoveryOptions<C, T>) {
    this.#requestId = options.requestId;
    this.#strategies = orderStrategies(options.strategies);
    this.#generationSignal = options.generationSignal;
    this.#maxAttempts = normalizeMaxAttempts(options.maxAttempts);
    this.#onSummary = options.onSummary;
  }

  async run(input: C): Promise<AgentTurnRecoveryDisposition<T>> {
    if (this.#failed) {
      throw this.#failure;
    }
    if (this.#completed) {
      return this.#completed;
    }
    if (this.#running) {
      return this.#running;
    }

    this.#running = this.#runSerialized(input);
    try {
      this.#completed = await this.#running;
      return this.#completed;
    } finally {
      this.#running = undefined;
    }
  }

  beginTerminalSynthesis() {
    if (this.#completed) {
      throw new AgentTurnRecoveryInvariantError("Agent turn recovery is already terminal.");
    }
    this.#terminal = true;
  }

  assertCanStartTool() {
    if (this.#terminal) {
      throw new AgentTurnRecoveryInvariantError(
        "Terminal recovery synthesis cannot start another tool call.",
      );
    }
  }

  assertCanReenter() {
    if (this.#terminal) {
      throw new AgentTurnRecoveryInvariantError(
        "Terminal recovery synthesis cannot recursively re-enter recovery.",
      );
    }
  }

  async #runSerialized(input: C): Promise<AgentTurnRecoveryDisposition<T>> {
    if (this.#generationSignal?.aborted) {
      return this.#finish({ type: "failure", reason: "generation_aborted" });
    }

    for (const strategy of this.#strategies) {
      if (this.#attempts >= this.#maxAttempts) {
        return this.#finish({ type: "failure", reason: "recovery_failed" });
      }
      if (this.#generationSignal?.aborted) {
        return this.#finish({ type: "failure", reason: "generation_aborted" });
      }

      this.#attempts += 1;
      this.#strategyNames.push(strategy.name);
      try {
        const disposition = await strategy.run({
          input,
          attempt: this.#attempts,
          lifecycle: this,
        });
        if (disposition.type === "continuation") {
          continue;
        }
        return this.#finish(disposition);
      } catch (error) {
        // Programming errors and invariant violations must remain visible to the outer runtime;
        // only an explicitly returned failure disposition is classified as a recoverable outcome.
        this.#terminal = true;
        this.#failed = true;
        this.#failure = error;
        throw error;
      }
    }

    return this.#finish({ type: "failure", reason: "recovery_failed" });
  }

  #finish(disposition: AgentTurnRecoveryDisposition<T>) {
    this.#terminal = true;
    this.#completed = disposition;
    const reason = "reason" in disposition ? disposition.reason : undefined;
    this.#onSummary?.({
      requestId: this.#requestId,
      outcome: disposition.type,
      ...(reason ? { reason } : {}),
      attempts: this.#attempts,
      strategies: [...this.#strategyNames],
      durationMs: Math.max(0, Date.now() - this.#startedAt),
    });
    return disposition;
  }
}

export function createAgentTurnRecovery<C, T>(
  options: AgentTurnRecoveryOptions<C, T>,
): AgentTurnRecoveryLifecycle<C, T> {
  return new AgentTurnRecoveryLifecycle(options);
}

/** The bounded deterministic terminal strategy used by the runtime's default catalog. */
export function createDeterministicTerminalRecoveryStrategy<C, T>(
  buildCandidate: (input: C) => { value: T; reason: AgentTurnRecoveryPublicReason },
): AgentTurnRecoveryStrategy<C, T> {
  return {
    name: "deterministic-terminal-construction",
    run: ({ input, lifecycle }) => {
      lifecycle.beginTerminalSynthesis();
      const candidate = buildCandidate(input);
      return {
        type: "limited_answer_candidate",
        value: candidate.value,
        reason: candidate.reason,
      };
    },
  };
}

export function mapRecoveryDispositionToPublicOutcome(
  disposition: AgentTurnRecoveryDisposition<unknown>,
):
  | { completionStatus: "completed_with_limits"; terminationReason: AgentTurnRecoveryPublicReason }
  | undefined {
  if (disposition.type !== "limited_answer_candidate") {
    return undefined;
  }
  return {
    completionStatus: "completed_with_limits",
    terminationReason: disposition.reason,
  };
}

function orderStrategies<C, T>(strategies: readonly AgentTurnRecoveryStrategy<C, T>[]) {
  const byName = new Map<string, AgentTurnRecoveryStrategy<C, T>>();
  for (const strategy of strategies) {
    if (!strategy.name.trim() || byName.has(strategy.name)) {
      throw new AgentTurnRecoveryInvariantError(
        `Recovery strategy names must be unique and non-empty: ${strategy.name}`,
      );
    }
    byName.set(strategy.name, strategy);
  }

  const ordered: AgentTurnRecoveryStrategy<C, T>[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new AgentTurnRecoveryInvariantError(
        `Recovery strategy dependency cycle includes ${name}.`,
      );
    }
    const strategy = byName.get(name);
    if (!strategy) {
      throw new AgentTurnRecoveryInvariantError(`Unknown recovery strategy dependency: ${name}.`);
    }
    visiting.add(name);
    for (const dependency of strategy.dependsOn ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(strategy);
  };
  for (const strategy of strategies) visit(strategy.name);
  return ordered;
}

function normalizeMaxAttempts(value: number | undefined) {
  if (value === undefined) return 32;
  if (!Number.isInteger(value) || value < 1) {
    throw new AgentTurnRecoveryInvariantError("Recovery maxAttempts must be a positive integer.");
  }
  return value;
}
