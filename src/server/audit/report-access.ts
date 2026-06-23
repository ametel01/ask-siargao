import { createHmac, timingSafeEqual } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { type ReportOutput, reportOutputSchema } from "@/server/audit/schemas";
import { type Database, createDatabaseClient } from "@/server/db";
import { auditReports, auditRequests, payments, reviewerResults } from "@/server/db/schema";

export type ReportAccessStatus =
  | "authorized"
  | "missing_access_token"
  | "invalid_access_token"
  | "not_found"
  | "unpaid"
  | "unpublished"
  | "unreviewed";

export type ReportAccessResult =
  | {
      status: "authorized";
      auditRequestId: string;
      report: ReportOutput;
    }
  | {
      status: Exclude<ReportAccessStatus, "authorized">;
    };

export type PersistedReportAccessState = {
  auditRequestId: string;
  auditState: string;
  reportJson: unknown;
  publishedAt?: Date | null;
  paymentStatus?: string | null;
  paymentVerifiedAt?: Date | null;
  reviewerApproved: boolean;
};

export type ReportAccessStore = {
  loadReportAccessState: (auditRequestId: string) => Promise<PersistedReportAccessState | null>;
};

export type ReportAccessTokenPayload = {
  auditRequestId: string;
  expiresAt: string;
};

export async function getReportAccess(input: {
  auditRequestId: string;
  token?: string | null;
  secret?: string;
  store?: ReportAccessStore;
  now?: Date;
}): Promise<ReportAccessResult> {
  if (!input.token) {
    return { status: "missing_access_token" };
  }

  const secret = input.secret ?? reportAccessSecretFromEnv();
  if (!secret) {
    return { status: "invalid_access_token" };
  }

  const token = verifyReportAccessToken({
    auditRequestId: input.auditRequestId,
    token: input.token,
    secret,
    now: input.now,
  });

  if (!token.valid) {
    return { status: "invalid_access_token" };
  }

  const store = input.store ?? createDatabaseReportAccessStore();
  const state = await store.loadReportAccessState(input.auditRequestId);

  if (!state) {
    return { status: "not_found" };
  }
  if (state.paymentStatus !== "paid" || !state.paymentVerifiedAt) {
    return { status: "unpaid" };
  }
  if (state.auditState !== "published" || !state.publishedAt) {
    return { status: "unpublished" };
  }
  if (!state.reviewerApproved) {
    return { status: "unreviewed" };
  }

  const report = reportOutputSchema.parse(state.reportJson);

  return {
    status: "authorized",
    auditRequestId: input.auditRequestId,
    report,
  };
}

export function createReportAccessToken(input: {
  auditRequestId: string;
  expiresAt: Date;
  secret: string;
}) {
  const payload: ReportAccessTokenPayload = {
    auditRequestId: input.auditRequestId,
    expiresAt: input.expiresAt.toISOString(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload, input.secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyReportAccessToken(input: {
  auditRequestId: string;
  token: string;
  secret: string;
  now?: Date;
}):
  | { valid: true; payload: ReportAccessTokenPayload }
  | { valid: false; reason: "malformed" | "signature" | "wrong_audit" | "expired" } {
  const [encodedPayload, signature, extra] = input.token.split(".");

  if (!encodedPayload || !signature || extra !== undefined) {
    return { valid: false, reason: "malformed" };
  }

  const expectedSignature = signPayload(encodedPayload, input.secret);
  const provided = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { valid: false, reason: "signature" };
  }

  const payload = parseTokenPayload(encodedPayload);
  if (!payload) {
    return { valid: false, reason: "malformed" };
  }
  if (payload.auditRequestId !== input.auditRequestId) {
    return { valid: false, reason: "wrong_audit" };
  }
  if (new Date(payload.expiresAt).getTime() <= (input.now ?? new Date()).getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}

export function createDatabaseReportAccessStore(
  db: Database = createDatabaseClient(),
): ReportAccessStore {
  return {
    async loadReportAccessState(auditRequestId) {
      const reportRows = await db
        .select({
          auditRequestId: auditReports.auditRequestId,
          auditRunId: auditReports.auditRunId,
          reportJson: auditReports.reportJson,
          publishedAt: auditReports.publishedAt,
        })
        .from(auditReports)
        .where(eq(auditReports.auditRequestId, auditRequestId))
        .orderBy(desc(auditReports.createdAt))
        .limit(1);
      const report = reportRows[0];

      if (!report) {
        return null;
      }

      const auditRows = await db
        .select({ status: auditRequests.status })
        .from(auditRequests)
        .where(eq(auditRequests.id, auditRequestId))
        .limit(1);
      const paymentRows = await db
        .select({
          status: payments.status,
          webhookVerifiedAt: payments.webhookVerifiedAt,
        })
        .from(payments)
        .where(eq(payments.auditRequestId, auditRequestId))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      const reviewerRows = report.auditRunId
        ? await db
            .select({
              verdict: reviewerResults.verdict,
              blockedReasons: reviewerResults.blockedReasons,
            })
            .from(reviewerResults)
            .where(eq(reviewerResults.auditRunId, report.auditRunId))
            .orderBy(desc(reviewerResults.createdAt))
            .limit(1)
        : [];

      return {
        auditRequestId: report.auditRequestId,
        auditState: auditRows[0]?.status ?? "missing",
        reportJson: report.reportJson,
        publishedAt: report.publishedAt,
        paymentStatus: paymentRows[0]?.status,
        paymentVerifiedAt: paymentRows[0]?.webhookVerifiedAt,
        reviewerApproved:
          reviewerRows[0]?.verdict === "approved" && reviewerRows[0].blockedReasons.length === 0,
      };
    },
  };
}

function reportAccessSecretFromEnv() {
  return process.env.REPORT_ACCESS_TOKEN_SECRET ?? "";
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseTokenPayload(encodedPayload: string): ReportAccessTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof parsed?.auditRequestId === "string" &&
      typeof parsed?.expiresAt === "string" &&
      !Number.isNaN(new Date(parsed.expiresAt).getTime())
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}
