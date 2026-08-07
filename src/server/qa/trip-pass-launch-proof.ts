export const tripPassLaunchProofArtifactPath =
  "docs/evaluations/trip-pass-launch-proof-2026-07-14.json";

type LaunchProofStatus = "pass" | "blocked";

type TripPassLaunchProofCheck = {
  id: string;
  surface:
    | "ui"
    | "api"
    | "database"
    | "stripe"
    | "quota"
    | "model_cost"
    | "analytics"
    | "diagnostics"
    | "perimeter"
    | "operations";
  status: LaunchProofStatus;
  expected: string;
  evidence: string[];
  blocker?: string;
};

type TripPassApprovalCheck = {
  id: string;
  owner: "operator" | "legal" | "engineering" | "security" | "finance";
  requiredBeforeCheckout: true;
  status: "blocked";
  blocker: string;
};

type TripPassExternalSmokeCheck = {
  id: string;
  status: "blocked";
  blocker: string;
  redactedIdentifier: null;
};

export type TripPassLaunchProof = {
  id: string;
  generatedAt: string;
  artifactPath: string;
  launchReady: false;
  checkoutEnablement: {
    productionCheckoutEnabled: boolean;
    extensionEnabled: boolean;
    allowedToEnableCheckout: false;
    reason: string;
  };
  deterministicFlowChecks: TripPassLaunchProofCheck[];
  externalSmokeChecks: TripPassExternalSmokeCheck[];
  approvalChecks: TripPassApprovalCheck[];
  rollback: {
    strategy: "flag_disable_and_forward_repair";
    steps: string[];
  };
};

const deterministicFlowChecks: TripPassLaunchProofCheck[] = [
  {
    id: "anonymous_warning_and_exhaustion",
    surface: "ui",
    status: "pass",
    expected: "Free travelers see warning and exhausted states before paid checkout.",
    evidence: ["Trip Pass account presentation", "anonymous allowance route fixtures"],
  },
  {
    id: "sign_in_transfers_free_context",
    surface: "api",
    status: "pass",
    expected: "Signed-in travelers do not get a second unrestricted anonymous allowance.",
    evidence: ["anonymous identity HMAC cohort fixtures", "account velocity challenge fixtures"],
  },
  {
    id: "duplicate_checkout_is_idempotent",
    surface: "stripe",
    status: "pass",
    expected: "Duplicate Trip Pass checkout submissions reuse or block duplicate effective orders.",
    evidence: ["Trip Pass checkout commerce tests", "local order idempotency keys"],
  },
  {
    id: "delayed_return_does_not_activate",
    surface: "ui",
    status: "pass",
    expected: "Checkout return surfaces pending status until a verified webhook activates access.",
    evidence: ["owner-scoped Trip Pass status route", "settings checkout return UI tests"],
  },
  {
    id: "verified_webhook_activation",
    surface: "stripe",
    status: "pass",
    expected: "Only verified matched Stripe events create or change Trip Pass grants.",
    evidence: ["Stripe webhook route tests", "Trip Pass webhook application tests"],
  },
  {
    id: "multi_tool_consumes_one_answer",
    surface: "quota",
    status: "pass",
    expected:
      "A successful request consumes one travel answer while required evidence tools run automatically.",
    evidence: ["paid Trip Pass answer-meter tests", "chat route tool-planning tests"],
  },
  {
    id: "failure_release_and_post_success_disconnect",
    surface: "quota",
    status: "pass",
    expected:
      "Pre-success provider failures release reservations, while post-success disconnects consume once.",
    evidence: ["Trip Pass bypass matrix", "request idempotency fixtures"],
  },
  {
    id: "expiry_refund_dispute_boundaries",
    surface: "database",
    status: "pass",
    expected:
      "Expiry, refund, and dispute states change effective access without destructive data edits.",
    evidence: ["entitlement effective-pass tests", "webhook refund and dispute fixtures"],
  },
  {
    id: "analytics_delivery_is_sanitized",
    surface: "analytics",
    status: "pass",
    expected:
      "Trip Pass funnel, meter, and cost events use the allowlisted sanitized payload contract.",
    evidence: ["Trip Pass analytics tests", "observability events route tests"],
  },
  {
    id: "reconciliation_is_redacted",
    surface: "diagnostics",
    status: "pass",
    expected:
      "Operator diagnostics can reconcile Trip Pass state without raw payment or traveler data.",
    evidence: ["Trip Pass reconciliation tests", "admin diagnostics redaction tests"],
  },
  {
    id: "cookie_replay_parallel_and_shared_network_controls",
    surface: "perimeter",
    status: "pass",
    expected:
      "Cookie clearing, request-body mismatch, parallel final-unit use, and shared-network velocity are bounded.",
    evidence: ["Trip Pass bypass matrix", "Redis quota-store contract tests"],
  },
  {
    id: "free_outage_and_paid_fallback_budget",
    surface: "model_cost",
    status: "pass",
    expected:
      "Free DeepSeek outage does not silently use OpenAI, while paid fallback is budgeted and observable.",
    evidence: ["cost circuit tests", "Trip Pass quality bypass artifact"],
  },
  {
    id: "global_budget_exhaustion_degrades_safely",
    surface: "model_cost",
    status: "pass",
    expected:
      "Global model-cost exhaustion stops new expensive work and returns safe fallback states.",
    evidence: ["provider/global budget fixtures", "Trip Pass bypass matrix"],
  },
];

const approvalChecks: TripPassApprovalCheck[] = [
  {
    id: "production_price_currency",
    owner: "finance",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Confirm the live Stripe Price is USD 9.99 for the 14-day Trip Pass.",
  },
  {
    id: "legal_refund_policy",
    owner: "legal",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker:
      "Approve Trip Pass Terms, Privacy copy, full-refund revocation, and dispute suspension.",
  },
  {
    id: "redis_provider_retention",
    owner: "engineering",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Confirm production Redis provider, eviction policy, and key-retention expectations.",
  },
  {
    id: "analytics_host_retention",
    owner: "operator",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Approve PostHog-compatible host, key, retention, and consent wording.",
  },
  {
    id: "stripe_account_eligibility_fees",
    owner: "finance",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker:
      "Confirm Stripe account eligibility, settlement currency, payment fees, and tax handling.",
  },
  {
    id: "webhook_endpoint_events",
    owner: "engineering",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker:
      "Confirm production webhook endpoint secret and subscribed Checkout, refund, and dispute events.",
  },
  {
    id: "deepseek_price_version",
    owner: "operator",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Approve DeepSeek model price catalog version used for launch budgets and alerts.",
  },
  {
    id: "paid_fallback_budget",
    owner: "operator",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Approve paid OpenAI fallback policy and daily budget before enabling fallback.",
  },
  {
    id: "waf_log_to_challenge",
    owner: "security",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Record Vercel WAF log-mode evidence before promoting any rule to challenge.",
  },
  {
    id: "hmac_rotation",
    owner: "security",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Record Trip Pass HMAC key owner, rotation date, and rollback key handling.",
  },
  {
    id: "provider_global_budgets",
    owner: "operator",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker: "Approve DeepSeek, OpenAI fallback, and global daily model-cost budgets.",
  },
  {
    id: "secrets_monitoring_non_author_review",
    owner: "operator",
    requiredBeforeCheckout: true,
    status: "blocked",
    blocker:
      "Complete production secret inventory, monitoring alerts, and non-author release review.",
  },
];

const externalSmokeChecks: TripPassExternalSmokeCheck[] = [
  {
    id: "stripe_sandbox_lifecycle",
    status: "blocked",
    blocker:
      "Run a redacted Stripe test-mode checkout, delayed return, verified webhook, refund, and dispute fixture.",
    redactedIdentifier: null,
  },
  {
    id: "redis_integration",
    status: "blocked",
    blocker:
      "Run quota, idempotency, concurrency, and budget fixtures against production-like Redis.",
    redactedIdentifier: null,
  },
  {
    id: "waf_verification",
    status: "blocked",
    blocker: "Record Vercel WAF log-mode matches and app telemetry before challenge promotion.",
    redactedIdentifier: null,
  },
  {
    id: "analytics_sink_smoke",
    status: "blocked",
    blocker: "Send test Trip Pass funnel, meter, and cost events to the approved analytics sink.",
    redactedIdentifier: null,
  },
];

export function buildTripPassLaunchProof(
  env: Record<string, string | undefined> = process.env,
): TripPassLaunchProof {
  const productionCheckoutEnabled =
    env.TRIP_PASS_CHECKOUT_MODE === "canary" || env.TRIP_PASS_CHECKOUT_MODE === "on";
  const extensionEnabled = env.TRIP_PASS_EXTENSION_ENABLED === "true";

  return {
    id: "trip-pass-launch-proof-2026-07-14",
    generatedAt: "2026-07-14T00:00:00.000Z",
    artifactPath: tripPassLaunchProofArtifactPath,
    launchReady: false,
    checkoutEnablement: {
      productionCheckoutEnabled,
      extensionEnabled,
      allowedToEnableCheckout: false,
      reason: "External approvals and sandbox/live smoke checks remain launch blockers.",
    },
    deterministicFlowChecks,
    externalSmokeChecks,
    approvalChecks,
    rollback: {
      strategy: "flag_disable_and_forward_repair",
      steps: [
        "Set TRIP_PASS_CHECKOUT_MODE=off and redeploy.",
        "Keep TRIP_PASS_EXTENSION_ENABLED=false.",
        "Disable paid OpenAI fallback by setting OPENAI_FALLBACK_ENABLED=false if cost circuits misfire.",
        "Set TRIP_PASS_WAF_MODE=log or disable promoted WAF rules if shared-network users are challenged incorrectly.",
        "Use dry-run Trip Pass reconciliation first; repair only with confirmMutation=true after operator approval.",
        "Forward-repair order, grant, meter, and stale-reservation mismatches; do not drop launch ledger data.",
      ],
    },
  };
}

export function validateTripPassLaunchProof(
  proof: TripPassLaunchProof = buildTripPassLaunchProof(),
) {
  const errors: string[] = [];

  for (const check of proof.deterministicFlowChecks) {
    if (check.status !== "pass") {
      errors.push(`deterministic_check_not_passed:${check.id}`);
    }
  }

  if (proof.approvalChecks.length < 10) {
    errors.push("approval_checklist_incomplete");
  }

  for (const check of proof.approvalChecks) {
    if (!check.blocker.trim()) {
      errors.push(`approval_blocker_missing:${check.id}`);
    }
  }

  for (const check of proof.externalSmokeChecks) {
    if (!check.blocker.trim()) {
      errors.push(`external_smoke_blocker_missing:${check.id}`);
    }
    if (check.redactedIdentifier !== null) {
      errors.push(`external_smoke_identifier_not_redacted:${check.id}`);
    }
  }

  if (proof.checkoutEnablement.productionCheckoutEnabled) {
    errors.push("production_checkout_enabled_with_launch_blockers");
  }

  if (proof.checkoutEnablement.extensionEnabled) {
    errors.push("trip_pass_extension_enabled_before_launch_approval");
  }

  if (proof.launchReady) {
    errors.push("launch_ready_true_with_required_blockers");
  }

  return {
    valid: errors.length === 0,
    errors,
    blockerCount: proof.approvalChecks.length + proof.externalSmokeChecks.length,
  };
}
