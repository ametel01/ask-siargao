import { describe, expect, test } from "bun:test";

import {
  type PublicFactRecord,
  buildLlmsTxt,
  buildPublicJsonLd,
  buildPublicPageJson,
  buildPublicPageMarkdown,
  buildSitemapXml,
  evaluatePublicEligibility,
  getPublicPage,
  publicPagesForIndex,
} from "@/server/public-pages/public-content";

describe("public knowledge surfaces", () => {
  test("builds human, LLM Markdown, JSON, and JSON-LD from the same facts", () => {
    const page = getPublicPage("accommodations", "example-surf-stay");

    expect(page).toBeDefined();
    if (!page) {
      throw new Error("Expected public page fixture.");
    }

    const json = buildPublicPageJson(page);
    const markdown = buildPublicPageMarkdown(page);
    const jsonLd = buildPublicJsonLd(page);
    const firstClaim = page.facts[0]?.claim;

    expect(firstClaim).toBeTruthy();
    expect(JSON.stringify(json)).toContain(firstClaim as string);
    expect(markdown).toContain(firstClaim as string);
    expect(JSON.stringify(jsonLd)).toContain(firstClaim as string);
    expect(json.canonicalUrl).toBe(page.canonicalUrl);
    expect(markdown).toContain(page.canonicalUrl);
  });

  test("blocks private paid report, raw provider, unsupported, and low-confidence facts", () => {
    const baseFact: PublicFactRecord = {
      id: "fact_private",
      claim: "Private paid report says the traveler arrives late.",
      factType: "private_paid_report",
      sourceType: "user_submitted",
      sourceName: "Private audit",
      evidenceId: "ev_private",
      fetchedAt: "2026-06-23T00:00:00.000Z",
      confidence: "high",
      freshness: "fresh",
      publicRepublishAllowed: true,
      criticalPublicEvidence: true,
      canonicalEntityMatch: "confident",
    };

    const privateResult = evaluatePublicEligibility({
      facts: [{ ...baseFact, containsPrivateUserData: true }],
    });
    const rawResult = evaluatePublicEligibility({
      facts: [{ ...baseFact, includesRawProviderPayload: true }],
    });
    const lowConfidenceResult = evaluatePublicEligibility({
      facts: [{ ...baseFact, confidence: "low" }],
    });
    const restrictedResult = evaluatePublicEligibility({
      facts: [{ ...baseFact, publicRepublishAllowed: false }],
    });
    const weakMatchResult = evaluatePublicEligibility({
      facts: [{ ...baseFact, canonicalEntityMatch: "ambiguous" }],
    });

    expect(privateResult.eligible).toBe(false);
    expect(rawResult.eligible).toBe(false);
    expect(lowConfidenceResult.eligible).toBe(false);
    expect(restrictedResult.eligible).toBe(false);
    expect(weakMatchResult.eligible).toBe(false);
  });

  test("includes only approved public pages in sitemap and llms.txt", () => {
    const pages = publicPagesForIndex();
    const sitemap = buildSitemapXml(pages);
    const llms = buildLlmsTxt(pages);

    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(sitemap).toContain("/accommodations/example-surf-stay");
    expect(llms).toContain("/api/public/entities");
    expect(llms).toContain("/accommodations/example-surf-stay/llm.md");
    expect(sitemap).not.toContain("audit_");
    expect(llms).not.toContain("paid report");
  });
});
