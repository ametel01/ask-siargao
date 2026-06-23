import { describe, expect, test } from "bun:test";

import { resolveAuditReportRoute } from "@/app/audits/report-route";
import {
  type PersistedReportAccessState,
  type ReportAccessStore,
  createReportAccessToken,
  getReportAccess,
} from "@/server/audit/report-access";
import { sampleReport } from "@/server/audit/sample-report";

const now = new Date("2026-06-23T08:00:00.000Z");
const secret = "test_report_access_secret";

describe("audit report route access", () => {
  test("bare report URLs do not render paid report content", async () => {
    const result = await resolveAuditReportRoute(
      { auditRequestId: "audit_bare" },
      routeDependencies({
        auditRequestId: "audit_bare",
        auditState: "published",
        paymentStatus: "paid",
        paymentVerifiedAt: now,
        publishedAt: now,
        reportJson: sampleReport,
        reviewerApproved: true,
      }),
    );

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.accessStatus).toBe("missing_access_token");
    }
  });

  test("unpublished reports do not render with a valid token", async () => {
    const result = await resolveAuditReportRoute(
      {
        auditRequestId: "audit_unpublished",
        token: tokenFor("audit_unpublished"),
      },
      routeDependencies({
        auditRequestId: "audit_unpublished",
        auditState: "generating",
        paymentStatus: "paid",
        paymentVerifiedAt: now,
        publishedAt: null,
        reportJson: sampleReport,
        reviewerApproved: true,
      }),
    );

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.accessStatus).toBe("unpublished");
    }
  });

  test("unpaid reports do not render with a valid token", async () => {
    const result = await resolveAuditReportRoute(
      {
        auditRequestId: "audit_unpaid",
        token: tokenFor("audit_unpaid"),
      },
      routeDependencies({
        auditRequestId: "audit_unpaid",
        auditState: "published",
        paymentStatus: "checkout_started",
        paymentVerifiedAt: null,
        publishedAt: now,
        reportJson: sampleReport,
        reviewerApproved: true,
      }),
    );

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.accessStatus).toBe("unpaid");
    }
  });

  test("unreviewed reports do not render with a valid token", async () => {
    const result = await resolveAuditReportRoute(
      {
        auditRequestId: "audit_unreviewed",
        token: tokenFor("audit_unreviewed"),
      },
      routeDependencies({
        auditRequestId: "audit_unreviewed",
        auditState: "published",
        paymentStatus: "paid",
        paymentVerifiedAt: now,
        publishedAt: now,
        reportJson: sampleReport,
        reviewerApproved: false,
      }),
    );

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.accessStatus).toBe("unreviewed");
    }
  });

  test("valid access token renders only a published, paid, reviewer-approved report", async () => {
    const result = await resolveAuditReportRoute(
      {
        auditRequestId: "audit_authorized",
        token: tokenFor("audit_authorized"),
      },
      routeDependencies({
        auditRequestId: "audit_authorized",
        auditState: "published",
        paymentStatus: "paid",
        paymentVerifiedAt: now,
        publishedAt: now,
        reportJson: sampleReport,
        reviewerApproved: true,
      }),
    );

    expect(result.status).toBe("authorized");
    if (result.status === "authorized") {
      expect(result.report.evidence[0]?.evidenceId).toBe("ev_route");
    }
  });
});

function routeDependencies(state: PersistedReportAccessState) {
  const store: ReportAccessStore = {
    loadReportAccessState: async (auditRequestId) =>
      auditRequestId === state.auditRequestId ? state : null,
  };

  return {
    getReportAccess: (input) =>
      getReportAccess({
        ...input,
        now,
        secret,
        store,
      }),
  } satisfies Parameters<typeof resolveAuditReportRoute>[1];
}

function tokenFor(auditRequestId: string) {
  return createReportAccessToken({
    auditRequestId,
    expiresAt: new Date("2026-06-23T09:00:00.000Z"),
    secret,
  });
}
