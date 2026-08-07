import { describe, expect, test } from "bun:test";

import {
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
      generatedAt: "2026-08-07T00:00:00.000Z",
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
  });

  test("rejects invalid source, migration, gate, blocker, and authorization shapes", () => {
    const manifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      generatedAt: "2026-08-07T00:00:00.000Z",
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
      generatedAt: "2026-08-07T00:00:00.000Z",
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
        generatedAt: "2026-08-07T00:00:00.000Z",
        migrations,
      }),
    ).toThrow("trip_pass_checkout_mode_not_off");
  });

  test("rejects missing versions, wrong source, malformed time, and inconsistent readiness", () => {
    const blockedManifest = buildTripPassLaunchManifest({
      blockers: createFoundationBlockers(),
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      generatedAt: "2026-08-07T00:00:00.000Z",
      migrations,
    });
    const readyManifest = buildTripPassLaunchManifest({
      blockers: [],
      checkedOutCommitSha: sha,
      env: { TRIP_PASS_CHECKOUT_MODE: "off" },
      gateResults: createFoundationGateResults("pass"),
      generatedAt: "2026-08-07T00:00:00.000Z",
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
        generatedAt: "2026-08-07",
      }).errors,
    ).toContain("generated_at_invalid");
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
});
