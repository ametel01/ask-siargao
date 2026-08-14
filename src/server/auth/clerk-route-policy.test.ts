import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  type ClerkRouteClassification,
  classifyClerkRoute,
  clerkRoutePolicyEntries,
  getClerkRoutePolicy,
  getClerkRoutePolicyForFile,
} from "@/server/auth/clerk-route-policy";

describe("Clerk route policy", () => {
  test("classifies public, protected, and externally verified routes without fallthroughs", () => {
    const cases: Array<[string, ClerkRouteClassification]> = [
      ["/", "public"],
      ["/chat", "public"],
      ["/sign-in", "public"],
      ["/sign-in/factor-one", "public"],
      ["/sign-in/sso-callback", "public"],
      ["/sign-up", "public"],
      ["/sign-up/verify-email-address", "public"],
      ["/trips/shared/public-token", "public"],
      ["/llms.txt", "public"],
      ["/robots.txt", "public"],
      ["/sitemap.xml", "public"],
      ["/accommodations", "public"],
      ["/accommodations/example-stay", "public"],
      ["/accommodations/example-stay/llm.md", "public"],
      ["/settings", "protected"],
      ["/profile", "protected"],
      ["/admin/diagnostics", "protected"],
      ["/api/admin/repairs", "protected"],
      ["/audits/audit_123/status", "protected"],
      ["/api/me/profile", "protected"],
      ["/api/me/provider-release-candidate", "protected"],
      ["/api/me/privacy", "protected"],
      ["/api/me/trip-pass", "protected"],
      ["/api/chat", "protected"],
      ["/api/chat/threads", "protected"],
      ["/api/chat/threads/thread_123", "protected"],
      ["/api/chat/ratings", "protected"],
      ["/api/clerk/webhooks", "externally_verified"],
      ["/api/cron/operations", "externally_verified"],
      ["/api/health/live", "public"],
      ["/api/health/ready", "public"],
      ["/api/stripe/webhook", "externally_verified"],
    ];

    for (const [pathname, classification] of cases) {
      expect(classifyClerkRoute(pathname), pathname).toBe(classification);
    }
  });

  test("denies unknown application routes by leaving them without policy", () => {
    expect(getClerkRoutePolicy("/api/chatbot")).toBeNull();
    expect(getClerkRoutePolicy("/chatty")).toBeNull();
    expect(getClerkRoutePolicy("/settings-public")).toBeNull();
    expect(getClerkRoutePolicy("/api/synthetic/uninventoried")).toBeNull();
  });

  test("keeps every live page and route handler in the explicit inventory", () => {
    const routeFiles = collectAppRouteFiles();
    const policyFiles = clerkRoutePolicyEntries.map((entry) => entry.routeFile).toSorted();

    expect(policyFiles).toEqual(routeFiles.toSorted());
    expect(routeFiles).toHaveLength(68);
  });

  test("proves a seeded omitted route would fail inventory coverage", () => {
    expect(getClerkRoutePolicyForFile("src/app/api/synthetic/uninventoried/route.ts")).toBeNull();
  });

  test("keeps every policy entry to exactly one base classification", () => {
    for (const entry of clerkRoutePolicyEntries) {
      expect(["public", "protected", "externally_verified"], entry.routeFile).toContain(
        entry.classification,
      );
      expect(classifyClerkRoute(entry.samplePath), entry.routeFile).toBe(entry.classification);
    }
  });
});

function collectAppRouteFiles() {
  return collectFiles(join(process.cwd(), "src/app")).map((filePath) =>
    relative(process.cwd(), filePath).split(sep).join("/"),
  );
}

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(entryPath);
    }

    if (!entry.isFile()) {
      return [];
    }

    return entry.name === "page.tsx" || entry.name === "route.ts" ? [entryPath] : [];
  });
}
