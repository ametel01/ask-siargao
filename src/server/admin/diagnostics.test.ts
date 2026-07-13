import { describe, expect, test } from "bun:test";

import { evaluateAdminAccess } from "@/server/admin/access";
import {
  buildAuditDiagnostics,
  createDiagnosticLogEvent,
  createSampleDiagnosticsSnapshot,
} from "@/server/admin/diagnostics";
import { redactDiagnosticValue } from "@/server/admin/redaction";

const now = new Date("2026-06-23T08:00:00.000Z");

function credentialFragment(...parts: string[]) {
  return parts.join("-");
}

function underscoreCredential(...parts: string[]) {
  return parts.join("_");
}

function bearerFragment(scope: string, suffix: string) {
  return ["Bearer", credentialFragment("provider", "sample", scope, suffix)].join(" ");
}

function keyValueCredential(key: string, separator: "=" | ": ", scope: string, suffix: string) {
  return `${key}${separator}${credentialFragment("provider", "sample", scope, suffix)}`;
}

describe("admin access", () => {
  test("requires a token in production and accepts matching configured tokens", () => {
    expect(evaluateAdminAccess({ nodeEnv: "production" })).toEqual({
      allowed: false,
      reason: "production_token_required",
    });
    expect(
      evaluateAdminAccess({
        configuredToken: "operator-token",
        suppliedToken: "operator-token",
        nodeEnv: "production",
      }),
    ).toEqual({ allowed: true, mode: "token" });
    expect(
      evaluateAdminAccess({
        configuredToken: "operator-token",
        suppliedToken: "wrong-token",
        nodeEnv: "production",
      }),
    ).toEqual({ allowed: false, reason: "invalid_token" });
  });
});

describe("admin diagnostics", () => {
  test("summarizes blocked audits, stale facts, provider errors, reviewer blocks, costs, and jobs", () => {
    const snapshot = createSampleDiagnosticsSnapshot(now);

    expect(snapshot.blockedAudits).toHaveLength(2);
    expect(snapshot.failedAccommodationMatches[0]?.status).toBe("ambiguous");
    expect(snapshot.providerErrors[0]?.providerName).toBe("Weather source");
    expect(snapshot.sourceFreshnessIssues[0]?.factId).toBe("fact_weather_stale");
    expect(snapshot.reviewerRejections[0]?.blockedReasons).toContain("stale_critical_fact");
    expect(snapshot.llmCostEstimates[0]?.estimatedUsd).toBeGreaterThan(0);
    expect(snapshot.jobFailures[0]?.lastError).toBe("Provider refresh exhausted.");
  });

  test("redacts secrets, emails, and raw payloads from traces", () => {
    const apiToken = underscoreCredential("sk", "test", "should", "not", "render");
    const webhookToken = underscoreCredential("whsec", "test", "should", "not", "render");
    const redacted = redactDiagnosticValue({
      email: "traveler@example.com",
      apiKey: apiToken,
      nested: {
        rawPayload: { token: webhookToken },
        message: `sent to traveler@example.com with ${apiToken}`,
      },
    });

    expect(JSON.stringify(redacted)).not.toContain("traveler@example.com");
    expect(JSON.stringify(redacted)).not.toContain("sk_test");
    expect(JSON.stringify(redacted)).not.toContain("whsec_test");
    expect(JSON.stringify(redacted)).toContain("[redacted]");
  });

  test("redacts free-text provider credential fragments from traces", () => {
    const hyphenatedToken = credentialFragment("sk", "provider", "sample", "issue85", "alpha");
    const bearerToken = bearerFragment("issue85", "beta");
    const redacted = redactDiagnosticValue({
      message: `provider failed with ${hyphenatedToken} and ${bearerToken}`,
      notes: [
        keyValueCredential("token", "=", "issue85", "gamma"),
        keyValueCredential("secret", ": ", "issue85", "delta"),
        keyValueCredential("api_key", "=", "issue85", "epsilon"),
        keyValueCredential("apikey", ": ", "issue85", "zeta"),
        keyValueCredential("api-key", "=", "issue85", "eta"),
      ],
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("issue85-alpha");
    expect(serialized).not.toContain("issue85-beta");
    expect(serialized).not.toContain("issue85-gamma");
    expect(serialized).not.toContain("issue85-delta");
    expect(serialized).not.toContain("issue85-epsilon");
    expect(serialized).not.toContain("issue85-zeta");
    expect(serialized).not.toContain("issue85-eta");
    expect(serialized).toContain("[redacted-secret]");
  });

  test("structured logging hooks redact payloads before emission", () => {
    const apiToken = underscoreCredential("sk", "test", "should", "not", "render");
    const event = createDiagnosticLogEvent({
      type: "llm_tool_call",
      at: now,
      payload: {
        auditRequestId: "audit_123",
        rawEvent: { secret: apiToken },
        result: "email traveler@example.com",
      },
    });

    expect(event.type).toBe("llm_tool_call");
    expect(JSON.stringify(event)).not.toContain("traveler@example.com");
    expect(JSON.stringify(event)).not.toContain("sk_test");
  });

  test("keeps admin drilldowns redacted and free of raw non-republishable payloads", () => {
    const snapshot = createSampleDiagnosticsSnapshot(now);

    expect(JSON.stringify(snapshot.drilldowns.toolCallLogs)).not.toContain("should not render");
    expect(JSON.stringify(snapshot.blockedAudits)).not.toContain("traveler@example.com");
  });

  test("supports empty diagnostic inputs", () => {
    const snapshot = buildAuditDiagnostics({
      audits: [],
      completenessChecks: [],
      accommodationMatches: [],
      providerErrors: [],
      facts: [],
      jobs: [],
      reviewerResults: [],
      llmRuns: [],
      toolCalls: [],
      sourceProfiles: [],
      now,
    });

    expect(snapshot.blockedAudits).toHaveLength(0);
    expect(snapshot.drilldowns.sourceProfiles).toHaveLength(0);
  });
});
