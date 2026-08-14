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

test("Stripe automation uses supported server-side test payments instead of hosted UI", async () => {
  const acceptance = await readFile(
    "tests/provider/stripe-release-candidate.stripe.e2e.ts",
    "utf8",
  );
  const helperStart = acceptance.indexOf("async function createTestModePaymentForCheckout");
  const helperEnd = acceptance.indexOf("async function retrieveCheckout", helperStart);

  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);
  const serverPayment = acceptance.slice(helperStart, helperEnd);
  expect(serverPayment).toContain("stripe.paymentIntents.create");
  expect(serverPayment).toContain("payment_method: paymentMethod");
  expect(serverPayment).toContain("confirm: true");
  expect(serverPayment).toContain(
    'automatic_payment_methods: { allow_redirects: "never", enabled: true }',
  );
  expect(serverPayment).toContain('paymentIntent.status === "succeeded"');
  expect(serverPayment).toContain("stripe.checkout.sessions.expire(sessionId)");
  expect(serverPayment).toContain("const amount = checkout.amount_total");
  expect(serverPayment).toContain("const currency = checkout.currency");
  expect(serverPayment).toContain("amount,");
  expect(serverPayment).toContain("currency,");
  expect(serverPayment).toContain('payment_status: "paid"');
  expect(serverPayment).toContain('status: "complete"');
  expect(serverPayment).toContain("simulate only the frontend's successful Checkout output");
  expect(serverPayment).not.toContain("payment_method_types");

  const checkoutStart = acceptance.indexOf("async function startCheckout");
  expect(checkoutStart).toBeGreaterThan(-1);
  const startCheckout = acceptance.slice(checkoutStart, helperStart);
  expect(startCheckout).toContain('sessionId?.startsWith("cs_test_")');
  expect(startCheckout).toContain("return { checkoutUrl: body.checkoutUrl, sessionId }");

  expect(acceptance).not.toContain("completeHostedCheckout");
  expect(acceptance).not.toContain('input[name="cardNumber"]');
  expect(acceptance).not.toContain('data-testid="hosted-payment-submit-button"');
  expect(acceptance).not.toContain("4242424242424242");
});

test("Stripe ambiguity proof is not hidden by the SDK's forced connection retry", async () => {
  const acceptance = await readFile(
    "tests/provider/stripe-release-candidate.stripe.e2e.ts",
    "utf8",
  );
  const helperStart = acceptance.indexOf("async function proveAmbiguousRefundRetry");
  const helperEnd = acceptance.indexOf("async function expectTripPassRefundedAmount", helperStart);

  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);
  const ambiguityProof = acceptance.slice(helperStart, helperEnd);
  expect(ambiguityProof).toContain('code: "EAI_AGAIN"');
  expect(ambiguityProof).not.toContain('code: "ECONNRESET"');
  expect(ambiguityProof).not.toContain('code: "EPIPE"');
  expect(ambiguityProof).toContain("maxNetworkRetries: 0");
  expect(ambiguityProof.indexOf("await upstreamClient.makeRequest(...args)")).toBeLessThan(
    ambiguityProof.indexOf('code: "EAI_AGAIN"'),
  );
});

test("reversed Stripe delivery proves the durable inbox retry state", async () => {
  const acceptance = await readFile(
    "tests/provider/stripe-release-candidate.stripe.e2e.ts",
    "utf8",
  );
  const scenarioStart = acceptance.indexOf(
    'test("reversed delivery retries authoritative dispute lookup before app suspension"',
  );
  const scenarioEnd = acceptance.indexOf(
    'test("closure race records Paid After Closure',
    scenarioStart,
  );

  expect(scenarioStart).toBeGreaterThan(-1);
  expect(scenarioEnd).toBeGreaterThan(scenarioStart);
  const reversedDelivery = acceptance.slice(scenarioStart, scenarioEnd);
  expect(reversedDelivery).toContain('inboxStatus: "pending"');
  expect(reversedDelivery).toContain('reason: "trip_pass_payment_intent_not_found"');
  expect(reversedDelivery).not.toContain('applicationStatus: "rejected"');
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
