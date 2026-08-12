import { describe, expect, test } from "bun:test";

import {
  hasModelProviderConsent,
  modelProviderConsentCookie,
  modelProviderConsentCookieName,
  modelProviderConsentVersion,
  requiresBrowserModelProviderConsent,
  requiresModelProviderConsent,
} from "@/lib/model-provider-consent";

describe("model provider consent", () => {
  test("requires the acknowledgement only for production DeepSeek chat", () => {
    expect(
      requiresModelProviderConsent({ APP_ENV: "production", CHAT_MODEL_PROVIDER: "deepseek" }),
    ).toBe(true);
    expect(
      requiresModelProviderConsent({ APP_ENV: "production", CHAT_MODEL_PROVIDER: "openai" }),
    ).toBe(false);
    expect(
      requiresModelProviderConsent({
        APP_ENV: "protected-staging",
        CHAT_MODEL_PROVIDER: "deepseek",
      }),
    ).toBe(false);
  });

  test("accepts only the exact current version from the consent cookie", () => {
    expect(
      hasModelProviderConsent(
        `unrelated=1; ${modelProviderConsentCookieName}=${modelProviderConsentVersion}`,
      ),
    ).toBe(true);
    expect(hasModelProviderConsent(`${modelProviderConsentCookieName}=stale-version`)).toBe(false);
    expect(hasModelProviderConsent(null)).toBe(false);
  });

  test("serializes a bounded same-site cookie and enables the browser gate explicitly", () => {
    expect(modelProviderConsentCookie({ secure: true })).toContain("Max-Age=15552000");
    expect(modelProviderConsentCookie({ secure: true })).toContain("SameSite=Lax");
    expect(modelProviderConsentCookie({ secure: true })).toContain("HttpOnly");
    expect(modelProviderConsentCookie({ secure: true })).toContain("Secure");
    expect(
      requiresBrowserModelProviderConsent({
        NEXT_PUBLIC_MODEL_PROVIDER_CONSENT_REQUIRED: "true",
      }),
    ).toBe(true);
    expect(requiresBrowserModelProviderConsent({})).toBe(false);
  });
});
