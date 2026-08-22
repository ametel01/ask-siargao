import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  formatClerkConfigErrors,
  readClerkDeploymentConfig,
} from "@/server/auth/clerk-deployment-config";
import { getClerkRoutePolicy } from "@/server/auth/clerk-route-policy";
import { isProtectedUiHarnessRequest } from "@/server/auth/protected-ui-harness";
import { isFieldSecurityProductionHarnessRequest } from "@/server/field-security/test-harness";

type ClerkProxyAuth = {
  protect: () => Promise<unknown>;
};

const enabledClerkProxy = clerkMiddleware(
  async (auth, request) => applyEnabledClerkRoutePolicy(auth, request),
  () => {
    const result = readClerkDeploymentConfig();
    if (!result.ok || result.config.mode !== "enabled") {
      return {};
    }

    return { authorizedParties: result.config.authorizedParties };
  },
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const config = readClerkDeploymentConfig();

  if (!config.ok) {
    return clerkConfigurationFailure(config.errors);
  }

  if (config.config.mode === "disabled") {
    return applyDisabledClerkRoutePolicy(request);
  }

  return enabledClerkProxy(request, event);
}

export async function applyEnabledClerkRoutePolicy(
  auth: ClerkProxyAuth,
  requestOrPathname: NextRequest | string,
) {
  const decision = getClerkPerimeterDecision(requestOrPathname);

  if (decision.action === "deny") {
    return denyClerkPerimeter(decision.reason);
  }

  if (decision.action === "protect") {
    await auth.protect();
  }

  return NextResponse.next();
}

export function applyDisabledClerkRoutePolicy(requestOrPathname: NextRequest | string) {
  const decision = getClerkPerimeterDecision(requestOrPathname);

  if (
    decision.action === "allow" ||
    (decision.action === "protect" &&
      (isProtectedUiHarnessProxyRequest(requestOrPathname) ||
        isFieldSecurityHarnessRequest(requestOrPathname)))
  ) {
    return NextResponse.next();
  }

  return denyClerkPerimeter(
    decision.action === "protect" ? "clerk_disabled_protected_route" : decision.reason,
  );
}

function isFieldSecurityHarnessRequest(requestOrPathname: NextRequest | string) {
  if (typeof requestOrPathname === "string") return false;
  return isFieldSecurityProductionHarnessRequest({
    headers: requestOrPathname.headers,
    pathname: requestOrPathname.nextUrl.pathname,
  });
}

export function getClerkPerimeterDecision(
  requestOrPathname: NextRequest | string,
):
  | { action: "allow"; classification: "externally_verified" | "public" }
  | { action: "deny"; reason: "unknown_route" }
  | { action: "protect"; classification: "protected" } {
  const pathname =
    typeof requestOrPathname === "string" ? requestOrPathname : requestOrPathname.nextUrl.pathname;

  if (pathname === "/__clerk" || pathname.startsWith("/__clerk/")) {
    return { action: "allow", classification: "public" };
  }

  const policy = getClerkRoutePolicy(pathname);

  if (!policy) {
    return { action: "deny", reason: "unknown_route" };
  }

  if (policy.classification === "protected") {
    return { action: "protect", classification: policy.classification };
  }

  return { action: "allow", classification: policy.classification };
}

function clerkConfigurationFailure(errors: Parameters<typeof formatClerkConfigErrors>[0]) {
  return NextResponse.json(
    {
      error: "invalid_clerk_configuration",
      fields: errors.map((error) => error.field),
      message: "Clerk deployment configuration is invalid.",
    },
    {
      headers: {
        "x-clerk-config-error": formatClerkConfigErrors(errors),
      },
      status: 500,
    },
  );
}

function isProtectedUiHarnessProxyRequest(requestOrPathname: NextRequest | string) {
  return (
    typeof requestOrPathname !== "string" &&
    isProtectedUiHarnessRequest({ headers: requestOrPathname.headers })
  );
}

function denyClerkPerimeter(reason: "clerk_disabled_protected_route" | "unknown_route") {
  return NextResponse.json(
    {
      error: "not_found",
      reason,
    },
    { status: 404 },
  );
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/llms.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/accommodations/:slug/llm.md",
    "/areas/:slug/llm.md",
    "/operators/:slug/llm.md",
    "/risks/:slug/llm.md",
    "/routes/:slug/llm.md",
    "/guides/:slug/llm.md",
    "/__clerk/:path*",
    "/(api|trpc)(.*)",
  ],
};
