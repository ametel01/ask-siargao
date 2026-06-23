import { describe, expect, test } from "bun:test";

import { serializeJsonForHtmlScript } from "@/server/public-pages/html-json";
import {
  type PublicFactRecord,
  buildLlmsTxt,
  buildPublicJsonLd,
  buildPublicPageJson,
  buildPublicPageMarkdown,
  buildSitemapXml,
  createFixturePublicPageRepository,
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
    expect(page.generationSourceFactIds).toEqual(page.facts.map((fact) => fact.id));
    expect(json.evidenceBundle.evidenceIds).toEqual(page.facts.map((fact) => fact.evidenceId));
  });

  test("serializes JSON-LD safely for inline script markup", () => {
    const serialized = serializeJsonForHtmlScript({
      text: "</script><script>alert('xss')</script>&",
    });

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).toContain("\\u003c/script\\u003e");
  });

  test("blocks private paid report, raw provider, unsupported, and low-confidence facts", () => {
    const baseFact: PublicFactRecord = {
      id: "fact_private",
      claim: "Private paid report says the traveler arrives late.",
      factType: "private_paid_report",
      sourceProfileId: "source_public_tourism_directory",
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

  test("derives public republication rights from source policy", () => {
    const citationOnlyOfficial: PublicFactRecord = {
      id: "fact_citation_only_official",
      claim: "An official transport source can support private audit citation only.",
      factType: "route_profile",
      sourceProfileId: "source_official_transport",
      sourceType: "official",
      sourceName: "Official transport source",
      evidenceId: "public_ev_citation_only",
      fetchedAt: "2026-06-23T00:00:00.000Z",
      confidence: "high",
      freshness: "fresh",
      publicRepublishAllowed: true,
      criticalPublicEvidence: true,
      canonicalEntityMatch: "confident",
    };
    const publicRepublishFact: PublicFactRecord = {
      ...citationOnlyOfficial,
      id: "fact_public_republish",
      claim: "A public tourism directory fact can appear in public surfaces.",
      sourceProfileId: "source_public_tourism_directory",
      sourceName: "Public tourism directory",
      evidenceId: "public_ev_allowed",
    };

    const citationOnlyResult = evaluatePublicEligibility({ facts: [citationOnlyOfficial] });
    const publicResult = evaluatePublicEligibility({ facts: [publicRepublishFact] });
    const page = {
      publicPageId: "public_page_public_source_policy",
      family: "risks" as const,
      slug: "public-source-policy",
      title: "Public source policy",
      summary: "Public source policy fixture.",
      limitations: ["Fixture only."],
      canonicalUrl: "https://siargao.example/risks/public-source-policy",
      humanPath: "/risks/public-source-policy",
      llmMarkdownPath: "/risks/public-source-policy/llm.md",
      jsonApiPath: "/api/public/risks/public-source-policy.json",
      visibility: "eligible" as const,
      indexingStatus: "index" as const,
      updatedAt: "2026-06-23T00:00:00.000Z",
      evidenceBundle: {
        id: "public_bundle_public_source_policy",
        slug: "risks-public-source-policy",
        evidenceIds: [publicRepublishFact.evidenceId],
        allowedUse: "public_republish" as const,
      },
      generationSourceFactIds: [publicRepublishFact.id],
      facts: [publicRepublishFact],
    };

    expect(citationOnlyResult.eligible).toBe(false);
    expect(citationOnlyResult.reasons).toContain(
      "fact:fact_citation_only_official:public_republish_not_allowed",
    );
    expect(publicResult.eligible).toBe(true);
    expect(buildPublicPageMarkdown(page)).toContain(publicRepublishFact.claim);
    expect(JSON.stringify(buildPublicPageJson(page))).toContain(publicRepublishFact.claim);
    expect(JSON.stringify(buildPublicJsonLd(page))).toContain(publicRepublishFact.claim);
    expect(buildSitemapXml([page])).toContain(page.canonicalUrl);
    expect(buildLlmsTxt([page])).toContain(page.llmMarkdownPath);
    expect(buildLlmsTxt([page])).not.toContain(citationOnlyOfficial.claim);
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

  test("repository-backed pages exclude ineligible persisted records from outputs", () => {
    const blockedFact: PublicFactRecord = {
      id: "fact_blocked_private",
      claim: "Private traveler notes must not publish.",
      factType: "private_paid_report",
      sourceProfileId: "source_public_tourism_directory",
      sourceType: "official",
      sourceName: "Public tourism directory",
      evidenceId: "ev_blocked_private",
      fetchedAt: "2026-06-23T00:00:00.000Z",
      confidence: "high",
      freshness: "fresh",
      publicRepublishAllowed: true,
      criticalPublicEvidence: true,
      containsPrivateUserData: true,
      canonicalEntityMatch: "confident",
    };
    const repository = createFixturePublicPageRepository([
      {
        publicPageId: "public_page_blocked",
        family: "risks",
        slug: "blocked-private",
        title: "Blocked private",
        summary: "Blocked fixture.",
        limitations: ["Fixture only."],
        canonicalUrl: "https://siargao.example/risks/blocked-private",
        humanPath: "/risks/blocked-private",
        llmMarkdownPath: "/risks/blocked-private/llm.md",
        jsonApiPath: "/api/public/risks/blocked-private.json",
        visibility: "blocked",
        indexingStatus: "noindex",
        updatedAt: "2026-06-23T00:00:00.000Z",
        evidenceBundle: {
          id: "public_bundle_blocked",
          slug: "risks-blocked-private",
          evidenceIds: [blockedFact.evidenceId],
          allowedUse: "public_republish",
        },
        generationSourceFactIds: [blockedFact.id],
        facts: [blockedFact],
      },
    ]);

    expect(repository.getPage("risks", "blocked-private")?.visibility).toBe("blocked");
    expect(publicPagesForIndex(repository)).toEqual([]);
    expect(buildSitemapXml(publicPagesForIndex(repository))).not.toContain("blocked-private");
    expect(buildLlmsTxt(publicPagesForIndex(repository))).not.toContain("blocked-private");
  });
});
