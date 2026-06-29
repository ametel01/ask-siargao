export const clerkProtectedRoutePatterns = [
  "/profile(.*)",
  "/chat/history(.*)",
  "/api/me(.*)",
  "/api/chat/threads(.*)",
  "/api/chat/ratings(.*)",
] as const;

type ClerkRouteClassification = "protected" | "public" | "public-by-default";

const publicRouteExpressions = [
  /^\/$/,
  /^\/chat\/?$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
  /^\/trips\/shared(?:\/.*)?$/,
  /^\/api\/chat\/?$/,
  /^\/api\/trips\/saved(?:\/.*)?$/,
  /^\/api\/trips\/share(?:\/.*)?$/,
  /^\/api\/public(?:\/.*)?$/,
  /^\/api\/stripe\/webhook\/?$/,
  /^\/api\/clerk\/webhooks\/?$/,
] as const;

const protectedRouteExpressions = [
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

  if (publicRouteExpressions.some((expression) => expression.test(pathname))) {
    return "public";
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
