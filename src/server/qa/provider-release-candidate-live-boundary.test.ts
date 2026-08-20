import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { runProviderReleaseCandidateLane } from "@/server/qa/provider-release-candidate";
import { createLiveProviderReleaseCandidateLaneAdapter } from "@/server/qa/provider-release-candidate-live-boundary";

test("live adapters execute both provider lanes through the semantic phase interface", async () => {
  const commandsByLane = {
    clerk: [
      "preflight",
      "bun run test:e2e:clerk",
      "bun run privacy:closure-worker",
      "bun run test:e2e:clerk:verify-deletion",
      "bun run test:e2e:clerk:final-boundary",
      "evidence",
    ],
    "lemon-squeezy": [
      "preflight",
      "bun run test:smoke:trip-pass-lemon-squeezy",
      "bun run privacy:closure-worker",
      "bun run operations:worker -- --enqueue --task=lemon_squeezy_refund",
      "bun run operations:worker -- --enqueue --task=commerce_reconciliation",
      "bun run test:e2e:lemon-squeezy:final-boundary",
      "evidence",
    ],
  } as const;

  for (const lane of ["clerk", "lemon-squeezy"] as const) {
    const events: string[] = [];
    const adapter = createLiveProviderReleaseCandidateLaneAdapter(lane, async (command) => {
      events.push(command.join(" "));
    });

    await runProviderReleaseCandidateLane(lane, {
      lifecycle: {
        async begin() {
          events.push("preflight");
        },
        async complete() {
          events.push("evidence");
        },
      },
      runPhase: adapter.runPhase,
    });

    expect(events).toEqual([...commandsByLane[lane]]);
  }
});

test("Clerk acceptance cannot forge deletion convergence before the cleanup worker", async () => {
  const acceptance = await readFile("tests/provider/clerk-release-candidate.clerk.e2e.ts", "utf8");
  const closureStart = acceptance.indexOf(
    'test("ownership denial precedes terminal step-up closure"',
  );
  const closureEnd = acceptance.indexOf('test("final live boundary', closureStart);

  expect(closureStart).toBeGreaterThan(-1);
  expect(closureEnd).toBeGreaterThan(closureStart);
  const closureScenario = acceptance.slice(closureStart, closureEnd);
  expect(closureScenario).not.toContain('type: "user.deleted"');
  expect(closureScenario).not.toContain("assertClerkUserConverged");
});

test("Lemon Squeezy acceptance uses the isolated provider checkout and signed webhook boundary", async () => {
  const acceptance = await readFile(
    "tests/provider/lemon-squeezy-release-candidate.lemon-squeezy.e2e.ts",
    "utf8",
  );
  expect(acceptance).toContain("completeLemonSqueezyTestCheckout");
  expect(acceptance).toContain("page.goto(checkout.checkoutUrl)");
  expect(acceptance).toContain("retrieveOrder");
  expect(acceptance).toContain("deliverSignedLemonSqueezyEvent");
  expect(acceptance).toContain('"/api/payments/lemon-squeezy/webhook"');
  expect(acceptance).toContain("refundOrder");
  expect(acceptance).toContain("recordRecoveryOrder");
  expect(acceptance).toContain("resource_ref");
  expect(acceptance).not.toContain("interval '1 hour'");
  expect(acceptance).not.toContain("STRIPE_");
  expect(acceptance).not.toContain("/api/stripe");
});

test("out-of-order Lemon Squeezy facts prove the durable inbox retry state", async () => {
  const acceptance = await readFile(
    "tests/provider/lemon-squeezy-release-candidate.lemon-squeezy.e2e.ts",
    "utf8",
  );
  const scenarioStart = acceptance.indexOf(
    'test("out-of-order and fraudulent facts converge through the signed inbox"',
  );
  const scenarioEnd = acceptance.indexOf(
    'test("closure race records Paid After Closure',
    scenarioStart,
  );

  expect(scenarioStart).toBeGreaterThan(-1);
  expect(scenarioEnd).toBeGreaterThan(scenarioStart);
  const outOfOrder = acceptance.slice(scenarioStart, scenarioEnd);
  expect(outOfOrder).toContain('inboxStatus: "applied"');
  expect(outOfOrder).toContain('applicationResult: { status: "duplicate" }');
  expect(outOfOrder).toContain('status: "fraudulent"');
});

test("provider lane command rejects an invalid lane before protected execution", async () => {
  const child = Bun.spawn(["bun", "run", "qa:provider-rc", "--", "--lane", "invalid"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
    child.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("Use --lane clerk or --lane lemon-squeezy.");
  expect(stdout).not.toContain("checkedOutCommitSha");
});
