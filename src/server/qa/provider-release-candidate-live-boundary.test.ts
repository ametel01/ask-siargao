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
  const helperEnd = acceptance.indexOf("async function retrieveCheckout", helperStart);

  expect(helperStart).toBeGreaterThan(-1);
  expect(helperEnd).toBeGreaterThan(helperStart);
  const hostedCheckout = acceptance.slice(helperStart, helperEnd);
  expect(hostedCheckout.indexOf("AccordionItemHeader--clickable")).toBeLessThan(
    hostedCheckout.indexOf("cardNumberInput.fill(cardNumber)"),
  );
  expect(hostedCheckout.indexOf("AccordionItemHeader--clickable")).toBeLessThan(
    hostedCheckout.indexOf('input[name="email"]:visible'),
  );
  expect(hostedCheckout).toContain('input[name="email"]:visible');
  expect(hostedCheckout).toContain('input[name="cardNumber"]:visible');
  expect(hostedCheckout).toContain('input[name="cardExpiry"]:visible');
  expect(hostedCheckout).toContain('input[name="cardCvc"]:visible');
  expect(hostedCheckout).toContain('input[name="billingName"]:visible');
  expect(hostedCheckout).toContain('input[name="termsOfServiceConsentCheckbox"]:visible');
  expect(hostedCheckout).not.toContain("security code|cvc");
  expect(hostedCheckout).not.toContain("getByLabel(/expiration/i)");
  expect(hostedCheckout).not.toContain("name on card");
  expect(hostedCheckout).toContain('data-testid="hosted-payment-submit-button"');
  const prepareStart = hostedCheckout.indexOf('safeProviderCall("prepare hosted test Checkout"');
  const submitStart = hostedCheckout.indexOf('safeProviderCall("submit hosted test Checkout"');
  const confirmationStart = hostedCheckout.indexOf('safeProviderCall("confirm paid test Checkout"');
  const returnStart = hostedCheckout.indexOf(
    'safeProviderCall("return to protected Checkout status"',
  );
  expect(prepareStart).toBeGreaterThan(-1);
  expect(submitStart).toBeGreaterThan(prepareStart);
  expect(confirmationStart).toBeGreaterThan(submitStart);
  expect(returnStart).toBeGreaterThan(confirmationStart);

  const preparation = hostedCheckout.slice(prepareStart, submitStart);
  expect(preparation).toContain("I am an AI agent acting on behalf of someone else");
  expect(preparation).toContain("expect(agentDisclosureLabel).toBeVisible()");
  expect(preparation).toContain("expect(agentDisclosure).toHaveCount(1)");
  expect(preparation).toContain("await agentDisclosure.focus()");
  expect(preparation).toContain('await page.keyboard.press("Space")');
  expect(preparation).not.toContain('agentDisclosure.dispatchEvent("click")');
  expect(preparation).not.toContain("agentDisclosure.check(");
  expect(preparation).toContain("expect(agentDisclosure,");
  expect(preparation).toContain(".toBeChecked()");

  const submission = hostedCheckout.slice(submitStart, confirmationStart);
  expect(submission).toContain("clickHostedCheckoutSubmit(page)");
  expect(submission).not.toContain('submit.dispatchEvent("click")');
  expect(hostedCheckout).toContain("await submit.focus()");
  expect(hostedCheckout).toContain('await page.keyboard.press("Enter")');
  expect(hostedCheckout).not.toContain("submit.click({ force: true })");

  const confirmation = hostedCheckout.slice(confirmationStart, returnStart);
  expect(confirmation).toContain("stripe.checkout.sessions.retrieve(sessionId)");
  expect(confirmation).toContain('state === "open:unpaid"');
  expect(confirmation).toContain("retries < 2");
  expect(confirmation).toContain("Date.now() - lastSubmitAt >= 5_000");
  expect(confirmation).toContain("clickHostedCheckoutSubmit(page)");
  expect(confirmation).toContain('toBe("complete:paid")');
  expect(confirmation).toContain("timeout: 60_000");
  expect(confirmation).toContain("intervals: [500, 1_000, 2_000]");

  const returnToApp = hostedCheckout.slice(returnStart);
  expect(returnToApp).toContain("trip_pass_checkout=return");
  expect(hostedCheckout).not.toContain("name: /pay/i");
  expect(hostedCheckout).not.toContain("page.waitForURL");

  const checkoutStart = acceptance.indexOf("async function startCheckout");
  expect(checkoutStart).toBeGreaterThan(-1);
  const startCheckout = acceptance.slice(checkoutStart, helperStart);
  expect(startCheckout).toContain('sessionId?.startsWith("cs_test_")');
  expect(startCheckout).toContain("return { checkoutUrl: body.checkoutUrl, sessionId }");
  expect(hostedCheckout).not.toContain("latestCheckoutSessionId");

  const clickHelperStart = acceptance.indexOf("async function clickHostedCheckoutSubmit");
  const clickHelperEnd = acceptance.indexOf("async function retrieveCheckout", clickHelperStart);
  expect(clickHelperStart).toBeGreaterThan(helperStart);
  expect(clickHelperEnd).toBeGreaterThan(clickHelperStart);
  const clickHelper = acceptance.slice(clickHelperStart, clickHelperEnd);
  expect(clickHelper).toContain("expect(submit).toHaveCount(1)");
  expect(clickHelper).toContain("expect(submit).toBeVisible()");
  expect(clickHelper).toContain("expect(submit).toBeEnabled()");
  expect(clickHelper).toContain("await submit.focus()");
  expect(clickHelper).toContain('await page.keyboard.press("Enter")');
  expect(clickHelper).not.toContain("submit.click({ force: true })");
  expect(clickHelper).not.toContain('submit.dispatchEvent("click")');
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
