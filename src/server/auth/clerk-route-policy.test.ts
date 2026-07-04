import { describe, expect, test } from "bun:test";

import { classifyClerkRoute } from "@/server/auth/clerk-route-policy";

describe("Clerk route policy", () => {
  test("keeps anonymous chat and public integrations open", () => {
    expect(classifyClerkRoute("/")).toBe("public");
    expect(classifyClerkRoute("/chat")).toBe("public");
    expect(classifyClerkRoute("/api/chat")).toBe("public");
    expect(classifyClerkRoute("/api/clerk/webhooks")).toBe("public");
    expect(classifyClerkRoute("/api/stripe/webhook")).toBe("public");
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
    expect(classifyClerkRoute("/api/chat/threads")).toBe("protected");
    expect(classifyClerkRoute("/api/chat/threads/thread_123")).toBe("protected");
    expect(classifyClerkRoute("/api/chat/ratings")).toBe("protected");
  });

  test("does not protect similarly named public routes", () => {
    expect(classifyClerkRoute("/api/chat")).toBe("public");
    expect(classifyClerkRoute("/api/chatbot")).toBe("public-by-default");
    expect(classifyClerkRoute("/chatty")).toBe("public-by-default");
    expect(classifyClerkRoute("/settings-public")).toBe("public-by-default");
    expect(classifyClerkRoute("https://ask-siargao.test/sign-in")).toBe("public");
  });

  test("leaves Clerk auto-proxy traffic public by route policy", () => {
    expect(classifyClerkRoute("/__clerk/some/path")).toBe("public-by-default");
  });
});
