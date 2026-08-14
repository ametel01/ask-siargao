import { describe, expect, test } from "bun:test";

import {
  AgentTurnRecoveryInvariantError,
  type AgentTurnRecoveryStrategy,
  createAgentTurnRecovery,
  mapRecoveryDispositionToPublicOutcome,
} from "@/server/chat/agent-turn-recovery";

describe("agent turn recovery", () => {
  test("runs a dependency-aware strategy catalog once and returns an ordinary completion", async () => {
    const order: string[] = [];
    const summaries: unknown[] = [];
    const strategies: AgentTurnRecoveryStrategy<{ value: string }, string>[] = [
      {
        name: "finalize-evidence",
        run: () => {
          order.push("evidence");
          return { type: "continuation" };
        },
      },
      {
        name: "finalize-output",
        dependsOn: ["finalize-evidence"],
        run: ({ input }) => {
          order.push("output");
          return { type: "ordinary_completion", value: `${input.value}:output` };
        },
      },
    ];

    const recovery = createAgentTurnRecovery({
      requestId: "recovery_request_1",
      strategies,
      onSummary: (summary) => summaries.push(summary),
    });

    const result = await recovery.run({ value: "answer" });
    const replay = await recovery.run({ value: "ignored" });

    expect(order).toEqual(["evidence", "output"]);
    expect(result).toMatchObject({ type: "ordinary_completion", value: "answer:output" });
    expect(replay).toEqual(result);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      requestId: "recovery_request_1",
      outcome: "ordinary_completion",
      attempts: 2,
    });
  });

  test("returns a limited answer candidate with one of the public coarse reasons", async () => {
    const recovery = createAgentTurnRecovery<{ value: string }, string>({
      requestId: "recovery_request_2",
      strategies: [
        {
          name: "bounded-terminal",
          run: () => ({
            type: "limited_answer_candidate",
            value: "checked answer with limits",
            reason: "model_response_budget_exhausted",
          }),
        },
      ],
    });

    const result = await recovery.run({ value: "ignored" });

    expect(result).toMatchObject({
      type: "limited_answer_candidate",
      value: "checked answer with limits",
      reason: "model_response_budget_exhausted",
    });
    expect(mapRecoveryDispositionToPublicOutcome(result)).toEqual({
      completionStatus: "completed_with_limits",
      terminationReason: "model_response_budget_exhausted",
    });
  });

  test("does not let terminal synthesis start tools or recursively re-enter recovery", async () => {
    const recovery = createAgentTurnRecovery<{ value: string }, string>({
      requestId: "recovery_request_3",
      strategies: [
        {
          name: "terminal",
          run: ({ lifecycle }) => {
            lifecycle.beginTerminalSynthesis();
            expect(() => lifecycle.assertCanStartTool()).toThrow(AgentTurnRecoveryInvariantError);
            expect(() => lifecycle.assertCanReenter()).toThrow(AgentTurnRecoveryInvariantError);
            return {
              type: "limited_answer_candidate",
              value: "limited",
              reason: "model_response_invalid",
            };
          },
        },
      ],
    });

    await expect(recovery.run({ value: "ignored" })).resolves.toMatchObject({
      type: "limited_answer_candidate",
    });
  });

  test("only a server generation abort stops the lifecycle; client cancellation is not consulted", async () => {
    const generation = new AbortController();
    const client = new AbortController();
    const recovery = createAgentTurnRecovery<{ value: string }, string>({
      requestId: "recovery_request_4",
      generationSignal: generation.signal,
      strategies: [
        {
          name: "client-independent",
          run: () => ({ type: "ordinary_completion", value: "stored" }),
        },
      ],
    });

    client.abort();
    await expect(recovery.run({ value: "ignored" })).resolves.toMatchObject({
      type: "ordinary_completion",
      value: "stored",
    });

    const aborted = createAgentTurnRecovery<{ value: string }, string>({
      requestId: "recovery_request_5",
      generationSignal: generation.signal,
      strategies: [
        {
          name: "never-run",
          run: () => ({ type: "ordinary_completion", value: "unexpected" }),
        },
      ],
    });
    generation.abort();
    await expect(aborted.run({ value: "ignored" })).resolves.toMatchObject({
      type: "failure",
      reason: "generation_aborted",
    });
  });
});
