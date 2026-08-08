export type ClerkRouteClassification = "externally_verified" | "protected" | "public";

export type ClerkRoutePolicyEntry = {
  classification: ClerkRouteClassification;
  intent: string;
  pathPattern: string;
  routeFile: string;
  samplePath: string;
  supplementalPolicy?: string;
};

export const clerkRoutePolicyEntries = [
  page("src/app/page.tsx", "/", "public", "public chat-first landing page"),
  page("src/app/chat/page.tsx", "/chat", "public", "anonymous chat workspace"),
  page(
    "src/app/sign-in/[[...sign-in]]/page.tsx",
    "/sign-in/[[...sign-in]]",
    "public",
    "Clerk sign-in page",
    "Next optional catch-all segments remain public for Clerk callbacks and factors",
  ),
  page(
    "src/app/sign-up/[[...sign-up]]/page.tsx",
    "/sign-up/[[...sign-up]]",
    "public",
    "Clerk sign-up page",
    "Next optional catch-all segments remain public for Clerk callbacks and verification",
  ),
  page("src/app/settings/page.tsx", "/settings", "protected", "authenticated traveler settings"),
  page("src/app/profile/page.tsx", "/profile", "protected", "authenticated profile alias"),
  page(
    "src/app/admin/diagnostics/page.tsx",
    "/admin/diagnostics",
    "protected",
    "operator diagnostics surface",
    "admin token remains required by the page",
  ),
  page(
    "src/app/audits/[auditRequestId]/status/page.tsx",
    "/audits/audit_123/status",
    "protected",
    "private audit status surface",
  ),
  page(
    "src/app/audits/[auditRequestId]/report/page.tsx",
    "/audits/audit_123/report",
    "public",
    "signed paid audit report delivery",
    "signed report token remains required by the page",
  ),
  page(
    "src/app/audits/demo/report/page.tsx",
    "/audits/demo/report",
    "public",
    "non-production QA audit fixture",
    "available only in designated QA context",
  ),
  page("src/app/legal/trip-pass/page.tsx", "/legal/trip-pass", "public", "public Trip Pass terms"),
  page(
    "src/app/trips/shared/[token]/page.tsx",
    "/trips/shared/public-token",
    "public",
    "public saved-trip share page",
    "share token validation remains required by the page",
  ),
  publicKnowledgePage("accommodations"),
  publicKnowledgePage("areas"),
  publicKnowledgePage("operators"),
  publicKnowledgePage("risks"),
  publicKnowledgePage("routes"),
  llmMarkdownRoute("accommodations"),
  llmMarkdownRoute("areas"),
  llmMarkdownRoute("operators"),
  llmMarkdownRoute("risks"),
  llmMarkdownRoute("routes"),
  route("src/app/llms.txt/route.ts", "/llms.txt", "public", "public LLM route index"),
  route("src/app/robots.txt/route.ts", "/robots.txt", "public", "public robots route"),
  route("src/app/sitemap.xml/route.ts", "/sitemap.xml", "public", "public sitemap route"),
  api("src/app/api/audit/checkout/route.ts", "/api/audit/checkout", "public", "audit checkout"),
  api("src/app/api/audit/intake/route.ts", "/api/audit/intake", "public", "audit intake"),
  api(
    "src/app/api/admin/repairs/route.ts",
    "/api/admin/repairs",
    "protected",
    "MFA-gated Operator Repair Actions",
  ),
  api("src/app/api/chat/route.ts", "/api/chat", "public", "anonymous chat API"),
  api(
    "src/app/api/chat/ratings/route.ts",
    "/api/chat/ratings",
    "protected",
    "authenticated chat rating API",
  ),
  api(
    "src/app/api/chat/threads/route.ts",
    "/api/chat/threads",
    "protected",
    "authenticated chat thread collection API",
  ),
  api(
    "src/app/api/chat/threads/[threadId]/route.ts",
    "/api/chat/threads/thread_123",
    "protected",
    "authenticated chat thread detail API",
  ),
  api(
    "src/app/api/clerk/webhooks/route.ts",
    "/api/clerk/webhooks",
    "externally_verified",
    "Clerk signature-verified webhook",
  ),
  api(
    "src/app/api/me/privacy/route.ts",
    "/api/me/privacy",
    "protected",
    "authenticated privacy controls API",
  ),
  api(
    "src/app/api/me/account-closure/route.ts",
    "/api/me/account-closure",
    "protected",
    "recently reverified terminal Account Closure API",
  ),
  api(
    "src/app/api/me/profile/route.ts",
    "/api/me/profile",
    "protected",
    "authenticated profile API",
  ),
  api(
    "src/app/api/me/provider-release-candidate/route.ts",
    "/api/me/provider-release-candidate",
    "protected",
    "authenticated protected-staging deployment identity probe",
    "handler returns 404 outside protected staging",
  ),
  api(
    "src/app/api/me/trip-pass/checkout/route.ts",
    "/api/me/trip-pass/checkout",
    "protected",
    "authenticated Trip Pass checkout API",
  ),
  api(
    "src/app/api/me/trip-pass/route.ts",
    "/api/me/trip-pass",
    "protected",
    "authenticated Trip Pass account API",
  ),
  api(
    "src/app/api/observability/events/route.ts",
    "/api/observability/events",
    "public",
    "client analytics event API",
    "public API rate limit remains required by handler",
  ),
  publicApi("accommodations", "/api/public/accommodations/example-stay"),
  publicApi("areas", "/api/public/areas/general-luna"),
  api("src/app/api/public/entities/route.ts", "/api/public/entities", "public", "public entities"),
  api("src/app/api/public/evidence/route.ts", "/api/public/evidence", "public", "public evidence"),
  publicApi("operators", "/api/public/operators/example-operator"),
  api(
    "src/app/api/public/risk-preview/route.ts",
    "/api/public/risk-preview",
    "public",
    "public risk preview",
  ),
  publicApi("risks", "/api/public/risks/late-arrival-transfer-risk"),
  publicApi("routes", "/api/public/routes/cloud-9-to-general-luna"),
  api(
    "src/app/api/public/surf/siargao/route.ts",
    "/api/public/surf/siargao",
    "public",
    "public surf forecast",
  ),
  api(
    "src/app/api/public/weather/siargao/route.ts",
    "/api/public/weather/siargao",
    "public",
    "public weather forecast",
  ),
  api(
    "src/app/api/stripe/webhook/route.ts",
    "/api/stripe/webhook",
    "externally_verified",
    "Stripe signature-verified webhook",
  ),
  api(
    "src/app/api/trips/saved/route.ts",
    "/api/trips/saved",
    "public",
    "saved-trip collection API",
    "handler enforces anonymous or Clerk ownership",
  ),
  api(
    "src/app/api/trips/saved/[itemId]/route.ts",
    "/api/trips/saved/place_123",
    "public",
    "saved-trip item API",
    "handler enforces anonymous or Clerk ownership",
  ),
  api(
    "src/app/api/trips/share/route.ts",
    "/api/trips/share",
    "public",
    "saved-trip share creation API",
    "handler validates selected owned artifacts",
  ),
  api(
    "src/app/api/trips/share/[token]/route.ts",
    "/api/trips/share/public-token",
    "public",
    "saved-trip share token API",
    "share token validation remains required by handler",
  ),
] as const satisfies readonly ClerkRoutePolicyEntry[];

const routePolicyByFile = new Map(
  clerkRoutePolicyEntries.map((entry) => [entry.routeFile, entry] as const),
);

export function classifyClerkRoute(pathnameOrUrl: string): ClerkRouteClassification | null {
  return getClerkRoutePolicy(pathnameOrUrl)?.classification ?? null;
}

export function getClerkRoutePolicy(pathnameOrUrl: string): ClerkRoutePolicyEntry | null {
  const pathname = normalizePathname(pathnameOrUrl);

  for (const entry of clerkRoutePolicyEntries) {
    if (pathMatchesPattern(pathname, entry.pathPattern)) {
      return entry;
    }
  }

  return null;
}

export function getClerkRoutePolicyForFile(routeFile: string) {
  return routePolicyByFile.get(routeFile) ?? null;
}

function page(
  routeFile: string,
  pathPattern: string,
  classification: ClerkRouteClassification,
  intent: string,
  supplementalPolicy?: string,
): ClerkRoutePolicyEntry {
  return {
    classification,
    intent,
    pathPattern,
    routeFile,
    samplePath: samplePathForPattern(pathPattern),
    supplementalPolicy,
  };
}

function route(
  routeFile: string,
  pathPattern: string,
  classification: ClerkRouteClassification,
  intent: string,
  supplementalPolicy?: string,
): ClerkRoutePolicyEntry {
  return page(routeFile, pathPattern, classification, intent, supplementalPolicy);
}

function api(
  routeFile: string,
  pathPattern: string,
  classification: ClerkRouteClassification,
  intent: string,
  supplementalPolicy?: string,
): ClerkRoutePolicyEntry {
  return page(routeFile, pathPattern, classification, intent, supplementalPolicy);
}

function publicKnowledgePage(
  family: "accommodations" | "areas" | "operators" | "risks" | "routes",
) {
  return {
    classification: "public",
    intent: `public ${family} knowledge page`,
    pathPattern: `/${family}/[slug]`,
    routeFile: `src/app/${family}/[slug]/page.tsx`,
    samplePath: `/${family}/example`,
  } satisfies ClerkRoutePolicyEntry;
}

function llmMarkdownRoute(family: "accommodations" | "areas" | "operators" | "risks" | "routes") {
  return {
    classification: "public",
    intent: `public ${family} LLM markdown route`,
    pathPattern: `/${family}/[slug]/llm.md`,
    routeFile: `src/app/${family}/[slug]/llm.md/route.ts`,
    samplePath: `/${family}/example/llm.md`,
  } satisfies ClerkRoutePolicyEntry;
}

function publicApi(
  family: "accommodations" | "areas" | "operators" | "risks" | "routes",
  samplePath: string,
) {
  return {
    classification: "public",
    intent: `public ${family} JSON API`,
    pathPattern: `/api/public/${family}/[...slug]`,
    routeFile: `src/app/api/public/${family}/[...slug]/route.ts`,
    samplePath,
  } satisfies ClerkRoutePolicyEntry;
}

function samplePathForPattern(pathPattern: string) {
  if (pathPattern.includes("[[...")) {
    return pathPattern.replace(/\/\[\[\.\.\.[^\]]+\]\]$/, "") || "/";
  }

  if (pathPattern.includes("[...")) {
    return pathPattern.replace(/\[\.\.\.[^\]]+\]/g, "sample");
  }

  return pathPattern.includes("[") ? pathPattern.replace(/\[[^\]]+\]/g, "sample") : pathPattern;
}

function pathMatchesPattern(pathname: string, pattern: string) {
  const pathnameSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathnameSegment = pathnameSegments[index];

    if (patternSegment?.startsWith("[...") && patternSegment.endsWith("]")) {
      return pathnameSegments.length >= index + 1;
    }

    if (patternSegment?.startsWith("[[...") && patternSegment.endsWith("]]")) {
      return true;
    }

    if (!pathnameSegment) {
      return false;
    }

    if (patternSegment?.startsWith("[") && patternSegment.endsWith("]")) {
      continue;
    }

    if (patternSegment !== pathnameSegment) {
      return false;
    }
  }

  return pathnameSegments.length === patternSegments.length;
}

function normalizePathname(pathnameOrUrl: string) {
  if (pathnameOrUrl.startsWith("http://") || pathnameOrUrl.startsWith("https://")) {
    return new URL(pathnameOrUrl).pathname;
  }

  const [pathname] = pathnameOrUrl.split("?");
  const normalized = pathname?.startsWith("/") ? pathname : `/${pathname ?? ""}`;
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
