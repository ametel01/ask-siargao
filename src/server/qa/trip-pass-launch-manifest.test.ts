import { describe, expect, test } from "bun:test";

import {
  attestFoundationCiGates,
  buildTripPassLaunchManifest,
  checksumManifestJson,
  createFoundationBlockers,
  createFoundationGateResults,
  serializeTripPassLaunchManifest,
  tripPassLaunchManifestArtifactPath,
  validateTripPassLaunchManifest,
} from "@/server/qa/trip-pass-launch-manifest";

const sha = "0123456789abcdef0123456789abcdef01234567";
const migrations = [
  {
    checksum: "a".repeat(64),
    name: "0000_initial_schema.sql",
  },
  {
    checksum: "b".repeat(64),
    name: "0008_trip_pass_commerce_ledger.sql",
  },
];

describe("Trip Pass launch manifest", () => {
  test("accepts foundation readiness only from exact trusted CI context", () => {
    const trusted = {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "ametel01/ask-siargao",
      GITHUB_SHA: sha,
    };
    expect(
      attestFoundationCiGates({ checkedOutCommitSha: sha, env: trusted, requested: true }),
    ).toBe("pass");
    expect(attestFoundationCiGates({ checkedOutCommitSha: sha, env: {}, requested: false })).toBe(
      "blocked",
    );
    expect(() =>
      attestFoundationCiGates({
        checkedOutCommitSha: sha,
        env: { ...trusted, GITHUB_SHA: "f".repeat(40) },
        requested: true,
      }),
    ).toThrow("foundation_ci_gate_attestation_untrusted");
  });

  test("builds deterministic redacted engineering evidence for explicit inputs", () => {
    const input = {
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: {
        CLERK_SECRET_KEY: "sentinel-secret-that-must-not-serialize",
        DATABASE_URL: "postgres://user:password@example.test/db",
        TRIP_PASS_CHECKOUT_MODE: "off",
      },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    };

    const manifest = buildTripPassLaunchManifest(input);
    const repeat = buildTripPassLaunchManifest(input);
    const json = serializeTripPassLaunchManifest(manifest);

    expect(json).toBe(serializeTripPassLaunchManifest(repeat));
    expect(checksumManifestJson(json)).toMatch(/^[a-f0-9]{64}$/);
    expect(json).not.toContain("sentinel-secret-that-must-not-serialize");
    expect(json).not.toContain("postgres://user:password");
    expect(manifest.source.checkedOutCommitSha).toBe(sha);
    expect(manifest.artifact.path).toBe(tripPassLaunchManifestArtifactPath(sha));
    expect(manifest.configurationPresence.CLERK_SECRET_KEY).toBe(true);
    expect(manifest.configurationPresence.DATABASE_URL).toBe(true);
    expect(manifest.configurationPresence.TRIP_PASS_CHECKOUT_MODE_OFF).toBe(true);
    expect(manifest.humanLaunchAuthorization.launchAuthorized).toBe(false);
    expect(manifest.humanLaunchAuthorization.checkoutModeMayBeEnabled).toBe(false);
    expect((manifest as unknown as { checkout: { mode: string } }).checkout.mode).toBe("off");
    expect(manifest.engineeringReadiness.engineeringReady).toBe(true);
    expect(manifest.productAndPolicyVersions).toMatchObject({
      commercialMeter: "chat_message:150",
      durationHours: "336",
      launchPrice: "usd:999",
      privacyPolicyVersion: "privacy-2026-08-07",
      productCode: "siargao_trip_pass_14d_v2",
      refundPolicyVersion: "trip-pass-refund-2026-08-07",
      stripeApiVersion: "2026-07-29.dahlia",
      stripeEventSchemaVersion: "2",
      termsVersion: "trip-pass-terms-2026-08-07",
      tripPassProductVersion: "2",
    });
    expect(manifest.engineeringReadiness.gateResults.map((gate) => gate.id)).toEqual([
      "bun_run_lint",
      "bun_run_typecheck_incremental_false",
      "bun_test",
      "bun_run_db_migrate_test",
      "bun_run_db_seed_test",
      "bun_run_build",
      "bun_run_test_e2e",
      "bun_run_test_e2e_production_perf",
      "bun_run_test_integration_postgres",
      "bun_run_test_integration_redis",
    ]);
  });

  test("is stable for one exact SHA and migration set regardless of wall-clock invocation", () => {
    const input = {
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    };
    const first = serializeTripPassLaunchManifest(buildTripPassLaunchManifest(input));
    const second = serializeTripPassLaunchManifest(
      buildTripPassLaunchManifest({
        ...input,
        sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      }),
    );

    expect(first).toBe(second);
    expect(first).not.toContain("issue-146-154-engineering-readiness-pending");
    expect(first).not.toContain("issue-155-156-human-launch-evidence-pending");
    expect(first).toContain("dedicated_github_launch_issue");
    expect(first).toContain("protected_provider_release_candidate");
  });

  test("rejects invalid source, migration, gate, blocker, and authorization shapes", () => {
    const manifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });

    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        source: { ...manifest.source, checkedOutCommitSha: "not-a-sha" },
      }).errors,
    ).toContain("invalid_checked_out_commit_sha");
    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        migrations: [
          { checksum: "b".repeat(64), filename: "0008_trip_pass_commerce_ledger.sql" },
          { checksum: "not-a-checksum", filename: "0000_initial_schema.sql" },
        ],
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "migration_checksum_invalid:0000_initial_schema.sql",
        "migration_unordered:0000_initial_schema.sql",
      ]),
    );
    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        engineeringReadiness: {
          ...manifest.engineeringReadiness,
          gateResults: [{ id: "bun_run_lint", status: "pass", evidenceLinks: [] }],
        },
      }).errors,
    ).toContain("gate_result_evidence_missing:bun_run_lint");
    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        blockers: [
          { id: "external-launch", owner: "operator", reason: "Pending." },
          { id: "external-launch", owner: "operator", reason: "Pending." },
        ],
      }).errors,
    ).toContain("blocker_duplicate:external-launch");
    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        humanLaunchAuthorization: {
          ...manifest.humanLaunchAuthorization,
          checkoutModeMayBeEnabled: true,
          launchAuthorized: true,
        },
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "human_launch_authorization_must_be_false",
        "checkout_permission_must_be_false",
      ]),
    );
  });

  test("rejects configuration values and checkout modes that are not off", () => {
    const manifest = buildTripPassLaunchManifest({
      blockers: [],
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });

    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        configurationPresence: {
          ...manifest.configurationPresence,
          STRIPE_SECRET_KEY: "sk_live_sentinel",
        },
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "configuration_presence_not_boolean:STRIPE_SECRET_KEY",
        "manifest_contains_unredacted_secret_shape",
      ]),
    );
    expect(() =>
      buildTripPassLaunchManifest({
        blockers: [],
        checkedOutCommitSha: sha,
        env: { TRIP_PASS_CHECKOUT_MODE: "on" },
        gateResults: createFoundationGateResults("pass"),
        sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
        migrations,
      }),
    ).toThrow("trip_pass_checkout_mode_not_off");
  });

  test("rejects missing versions, wrong source, malformed time, and inconsistent readiness", () => {
    const blockedManifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("blocked"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });
    const readyManifest = buildTripPassLaunchManifest({
      blockers: [],
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });

    const withoutVersions = { ...blockedManifest } as Record<string, unknown>;
    delete withoutVersions.productAndPolicyVersions;

    expect(validateTripPassLaunchManifest(withoutVersions).errors).toContain(
      "product_and_policy_versions_missing",
    );
    expect(
      validateTripPassLaunchManifest({
        ...blockedManifest,
        source: { ...blockedManifest.source, repository: "ametel01/not-ask-siargao" },
      }).errors,
    ).toContain("invalid_source_repository");
    expect(
      validateTripPassLaunchManifest({
        ...blockedManifest,
        sourceCommitCommittedAt: "2026-08-07",
      }).errors,
    ).toContain("source_commit_committed_at_invalid");
    expect(
      validateTripPassLaunchManifest({
        ...blockedManifest,
        engineeringReadiness: {
          ...blockedManifest.engineeringReadiness,
          engineeringReady: true,
        },
      }).errors,
    ).toContain("engineering_readiness_inconsistent");
    expect(
      validateTripPassLaunchManifest({
        ...readyManifest,
        engineeringReadiness: {
          ...readyManifest.engineeringReadiness,
          engineeringReady: false,
        },
      }).errors,
    ).toContain("engineering_readiness_inconsistent");
    expect(
      validateTripPassLaunchManifest({
        ...readyManifest,
        engineeringReadiness: {
          engineeringReady: true,
          gateResults: [
            {
              ...readyManifest.engineeringReadiness.gateResults[0],
              status: "fail",
            },
          ],
        },
      }).errors,
    ).toContain("engineering_readiness_inconsistent");
  });

  test("rejects single-gate manifests that omit required foundation gates", () => {
    const manifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });

    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        engineeringReadiness: {
          ...manifest.engineeringReadiness,
          gateResults: [
            {
              evidenceLinks: ["local-command://bun_run_lint"],
              id: "bun_run_lint",
              status: "pass",
            },
          ],
        },
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "gate_result_missing:bun_run_typecheck_incremental_false",
        "gate_result_missing:bun_test",
        "gate_result_missing:bun_run_db_migrate_test",
        "gate_result_missing:bun_run_db_seed_test",
        "gate_result_missing:bun_run_build",
        "gate_result_missing:bun_run_test_e2e",
        "gate_result_missing:bun_run_test_e2e_production_perf",
        "gate_result_missing:bun_run_test_integration_postgres",
        "gate_result_missing:bun_run_test_integration_redis",
      ]),
    );
  });

  test("rejects unknown gate IDs even when all foundation gates are present", () => {
    const manifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      sourceCommitCommittedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });

    expect(
      validateTripPassLaunchManifest({
        ...manifest,
        engineeringReadiness: {
          ...manifest.engineeringReadiness,
          gateResults: [
            ...manifest.engineeringReadiness.gateResults,
            {
              evidenceLinks: ["local-command://adversarial_extra_gate"],
              id: "adversarial_extra_gate",
              status: "pass",
            },
          ],
        },
      }).errors,
    ).toContain("gate_result_unknown:adversarial_extra_gate");
  });
});
