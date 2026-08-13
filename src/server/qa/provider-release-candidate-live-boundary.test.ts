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
    stripe: [
      "preflight",
      "bun run test:smoke:trip-pass-stripe",
      "bun run privacy:closure-worker",
      "bun run payments:closure-refund-worker",
      "bun run test:e2e:stripe:final-boundary",
      "evidence",
    ],
  } as const;

  for (const lane of ["clerk", "stripe"] as const) {
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

test("Stripe Checkout opens the visible Card accordion before entering hosted fields", async () => {
  const acceptance = await readFile(
    "tests/provider/stripe-release-candidate.stripe.e2e.ts",
    "utf8",
  );
  const helperStart = acceptance.indexOf("async function completeHostedCheckout");
  const helperEnd = acceptance.indexOf("async function retrieveLatestCheckout", helperStart);

  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);
  const hostedCheckout = acceptance.slice(helperStart, helperEnd);
  expect(hostedCheckout.indexOf("AccordionItemHeader--clickable")).toBeLessThan(
    hostedCheckout.indexOf("cardNumberInput.fill(cardNumber)"),
  );
  expect(hostedCheckout.indexOf("AccordionItemHeader--clickable")).toBeLessThan(
    hostedCheckout.indexOf('input[name="email"]:visible'),
  );
  expect(hostedCheckout).not.toContain("check({ force: true })");
  expect(hostedCheckout).toContain('input[name="email"]:visible');
  expect(hostedCheckout).toContain('input[name="cardCvc"]');
  expect(hostedCheckout).toContain('input[name="billingName"]:visible');
  expect(hostedCheckout).not.toContain("security code|cvc");
  expect(hostedCheckout).not.toContain("name on card");
  expect(hostedCheckout).toContain('data-testid="hosted-payment-submit-button"');
  expect(hostedCheckout).not.toContain("name: /pay/i");
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
  expect(stderr).toContain("Use --lane clerk or --lane stripe.");
  expect(stdout).not.toContain("checkedOutCommitSha");
});
