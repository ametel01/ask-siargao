export type ClerkRouteClassification =
  | "protected"
  | "public"
  | "externally_verified"
  | "rate_limit_public"
  | "unclassified"
  | "public-by-default";

const publicRouteExpressions = [
  /^\/$/,
  /^\/chat\/?$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
  /^\/trips\/shared(?:\/.*)?$/,
] as const;

const publicApiRouteExpressions = [
  /^\/api\/chat\/?$/,
  /^\/api\/trips\/saved(?:\/.*)?$/,
  /^\/api\/trips\/share(?:\/.*)?$/,
  /^\/api\/public(?:\/.*)?$/,
] as const;

const externallyVerifiedApiRouteExpressions = [
  /^\/api\/stripe\/webhook\/?$/,
  /^\/api\/clerk\/webhooks\/?$/,
] as const;

const rateLimitPublicApiRouteExpressions = [
  /^\/api\/audit\/checkout\/?$/,
  /^\/api\/audit\/intake\/?$/,
  /^\/api\/observability\/events\/?$/,
] as const;

const protectedRouteExpressions = [
  /^\/settings(?:\/.*)?$/,
  /^\/profile(?:\/.*)?$/,
  /^\/chat\/history(?:\/.*)?$/,
  /^\/api\/me(?:\/.*)?$/,
  /^\/api\/chat\/threads(?:\/.*)?$/,
  /^\/api\/chat\/ratings(?:\/.*)?$/,
] as const;

export function classifyClerkRoute(pathnameOrUrl: string): ClerkRouteClassification {
  const pathname = normalizePathname(pathnameOrUrl);

  if (protectedRouteExpressions.some((expression) => expression.test(pathname))) {
    return "protected";
  }

  if (externallyVerifiedApiRouteExpressions.some((expression) => expression.test(pathname))) {
    return "externally_verified";
  }

  if (rateLimitPublicApiRouteExpressions.some((expression) => expression.test(pathname))) {
    return "rate_limit_public";
  }

  if (publicApiRouteExpressions.some((expression) => expression.test(pathname))) {
    return "public";
  }

  if (publicRouteExpressions.some((expression) => expression.test(pathname))) {
    return "public";
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return "unclassified";
  }

  return "public-by-default";
}

function normalizePathname(pathnameOrUrl: string) {
  if (pathnameOrUrl.startsWith("http://") || pathnameOrUrl.startsWith("https://")) {
    return new URL(pathnameOrUrl).pathname;
  }

  const [pathname] = pathnameOrUrl.split("?");
  return pathname?.startsWith("/") ? pathname : `/${pathname ?? ""}`;
}
