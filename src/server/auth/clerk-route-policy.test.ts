import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  type ClerkRouteClassification,
  classifyClerkRoute,
} from "@/server/auth/clerk-route-policy";

const apiRoutePolicyCases: Array<{
  routeFile: string;
  pathname: string;
  classification: ClerkRouteClassification;
  intent: string;
}> = [
  {
    routeFile: "src/app/api/audit/checkout/route.ts",
    pathname: "/api/audit/checkout",
    classification: "rate_limit_public",
    intent: "rate-limit-only audit checkout surface",
  },
  {
    routeFile: "src/app/api/audit/intake/route.ts",
    pathname: "/api/audit/intake",
    classification: "rate_limit_public",
    intent: "rate-limit-only audit intake surface",
  },
  {
    routeFile: "src/app/api/chat/ratings/route.ts",
    pathname: "/api/chat/ratings",
    classification: "protected",
    intent: "authenticated chat rating surface",
  },
  {
    routeFile: "src/app/api/chat/route.ts",
    pathname: "/api/chat",
    classification: "public",
    intent: "anonymous public chat surface",
  },
  {
    routeFile: "src/app/api/chat/threads/[threadId]/route.ts",
    pathname: "/api/chat/threads/thread_123",
    classification: "protected",
    intent: "authenticated chat thread detail surface",
  },
  {
    routeFile: "src/app/api/chat/threads/route.ts",
    pathname: "/api/chat/threads",
    classification: "protected",
    intent: "authenticated chat thread collection surface",
  },
  {
    routeFile: "src/app/api/clerk/webhooks/route.ts",
    pathname: "/api/clerk/webhooks",
    classification: "externally_verified",
    intent: "Clerk signature-verified webhook",
  },
  {
    routeFile: "src/app/api/me/profile/route.ts",
    pathname: "/api/me/profile",
    classification: "protected",
    intent: "authenticated profile surface",
  },
  {
    routeFile: "src/app/api/me/privacy/route.ts",
    pathname: "/api/me/privacy",
    classification: "protected",
    intent: "authenticated privacy controls surface",
  },
  {
    routeFile: "src/app/api/public/accommodations/[...slug]/route.ts",
    pathname: "/api/public/accommodations/example-stay",
    classification: "public",
    intent: "anonymous public accommodation JSON surface",
  },
  {
    routeFile: "src/app/api/public/areas/[...slug]/route.ts",
    pathname: "/api/public/areas/general-luna",
    classification: "public",
    intent: "anonymous public area JSON surface",
  },
  {
    routeFile: "src/app/api/public/entities/route.ts",
    pathname: "/api/public/entities",
    classification: "public",
    intent: "anonymous public entity index",
  },
  {
    routeFile: "src/app/api/public/evidence/route.ts",
    pathname: "/api/public/evidence",
    classification: "public",
    intent: "anonymous public evidence index",
  },
  {
    routeFile: "src/app/api/public/operators/[...slug]/route.ts",
    pathname: "/api/public/operators/example-operator",
    classification: "public",
    intent: "anonymous public operator JSON surface",
  },
  {
    routeFile: "src/app/api/public/risk-preview/route.ts",
    pathname: "/api/public/risk-preview",
    classification: "public",
    intent: "anonymous public risk preview index",
  },
  {
    routeFile: "src/app/api/public/risks/[...slug]/route.ts",
    pathname: "/api/public/risks/late-arrival-transfer-risk",
    classification: "public",
    intent: "anonymous public risk JSON surface",
  },
  {
    routeFile: "src/app/api/public/routes/[...slug]/route.ts",
    pathname: "/api/public/routes/cloud-9-to-general-luna",
    classification: "public",
    intent: "anonymous public route JSON surface",
  },
  {
    routeFile: "src/app/api/public/surf/siargao/route.ts",
    pathname: "/api/public/surf/siargao",
    classification: "public",
    intent: "anonymous public surf forecast",
  },
  {
    routeFile: "src/app/api/public/weather/siargao/route.ts",
    pathname: "/api/public/weather/siargao",
    classification: "public",
    intent: "anonymous public weather forecast",
  },
  {
    routeFile: "src/app/api/stripe/webhook/route.ts",
    pathname: "/api/stripe/webhook",
    classification: "externally_verified",
    intent: "Stripe signature-verified webhook",
  },
  {
    routeFile: "src/app/api/trips/saved/[itemId]/route.ts",
    pathname: "/api/trips/saved/place_123",
    classification: "public",
    intent: "anonymous local-first saved trip item surface",
  },
  {
    routeFile: "src/app/api/trips/saved/route.ts",
    pathname: "/api/trips/saved",
    classification: "public",
    intent: "anonymous local-first saved trip collection surface",
  },
  {
    routeFile: "src/app/api/trips/share/[token]/route.ts",
    pathname: "/api/trips/share/public-token",
    classification: "public",
    intent: "anonymous shared trip token surface",
  },
  {
    routeFile: "src/app/api/trips/share/route.ts",
    pathname: "/api/trips/share",
    classification: "public",
    intent: "anonymous shared trip creation surface",
  },
];

describe("Clerk route policy", () => {
  test("keeps anonymous chat and public integrations open", () => {
    expect(classifyClerkRoute("/")).toBe("public");
    expect(classifyClerkRoute("/chat")).toBe("public");
    expect(classifyClerkRoute("/api/chat")).toBe("public");
    expect(classifyClerkRoute("/api/clerk/webhooks")).toBe("externally_verified");
    expect(classifyClerkRoute("/api/stripe/webhook")).toBe("externally_verified");
    expect(classifyClerkRoute("/trips/shared/public-token")).toBe("public");
    expect(classifyClerkRoute("/api/trips/share/public-token")).toBe("public");
  });

  test("protects authenticated data surfaces", () => {
    expect(classifyClerkRoute("/settings")).toBe("protected");
    expect(classifyClerkRoute("/settings/profile")).toBe("protected");
    expect(classifyClerkRoute("/profile")).toBe("protected");
    expect(classifyClerkRoute("/profile/settings")).toBe("protected");
    expect(classifyClerkRoute("/chat/history")).toBe("protected");
    expect(classifyClerkRoute("/api/me/profile")).toBe("protected");
    expect(classifyClerkRoute("/api/me/privacy")).toBe("protected");
    expect(classifyClerkRoute("/api/chat/threads")).toBe("protected");
    expect(classifyClerkRoute("/api/chat/threads/thread_123")).toBe("protected");
    expect(classifyClerkRoute("/api/chat/ratings")).toBe("protected");
  });

  test("does not protect similarly named public routes", () => {
    expect(classifyClerkRoute("/api/chat")).toBe("public");
    expect(classifyClerkRoute("/api/chatbot")).toBe("unclassified");
    expect(classifyClerkRoute("/chatty")).toBe("public-by-default");
    expect(classifyClerkRoute("/settings-public")).toBe("public-by-default");
    expect(classifyClerkRoute("https://ask-siargao.test/sign-in")).toBe("public");
  });

  test("leaves Clerk auto-proxy traffic public by route policy", () => {
    expect(classifyClerkRoute("/__clerk/some/path")).toBe("public-by-default");
  });

  test("classifies every current API route family explicitly", () => {
    for (const routeCase of apiRoutePolicyCases) {
      expect(classifyClerkRoute(routeCase.pathname), routeCase.intent).toBe(
        routeCase.classification,
      );
      expect(classifyClerkRoute(routeCase.pathname), routeCase.intent).not.toBe("unclassified");
      expect(classifyClerkRoute(routeCase.pathname), routeCase.intent).not.toBe(
        "public-by-default",
      );
    }
  });

  test("keeps the route-policy cases aligned with the live API route inventory", () => {
    expect(apiRoutePolicyCases.map((routeCase) => routeCase.routeFile).toSorted()).toEqual(
      collectApiRouteFiles().toSorted(),
    );
  });
});

function collectApiRouteFiles() {
  return collectRouteFiles(join(process.cwd(), "src/app/api")).map((filePath) =>
    relative(process.cwd(), filePath).split(sep).join("/"),
  );
}

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectRouteFiles(entryPath);
    }

    return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
  });
}
