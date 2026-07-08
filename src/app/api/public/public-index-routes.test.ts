import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET as entitiesGet } from "@/app/api/public/entities/route";
import { GET as evidenceGet } from "@/app/api/public/evidence/route";
import { GET as riskPreviewGet } from "@/app/api/public/risk-preview/route";
import {
  createFixturePublicKnowledgeCatalog,
  resetPublicKnowledgeCatalogForTests,
} from "@/server/public-pages/public-catalog";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

describe("public knowledge index routes", () => {
  beforeEach(() => {
    resetPublicKnowledgeCatalogForTests(createFixturePublicKnowledgeCatalog());
    resetRateLimitStoreForTests();
  });

  afterEach(() => {
    resetPublicKnowledgeCatalogForTests();
    resetRateLimitStoreForTests();
  });

  test("serve fixture-backed entity, evidence, and risk-preview indexes through the catalog", async () => {
    const request = new Request("https://siargao.test/api/public/entities");
    const entitiesResponse = await entitiesGet(request);
    const evidenceResponse = await evidenceGet(
      new Request("https://siargao.test/api/public/evidence"),
    );
    const riskPreviewResponse = await riskPreviewGet(
      new Request("https://siargao.test/api/public/risk-preview"),
    );

    const entities = await entitiesResponse.json();
    const evidence = await evidenceResponse.json();
    const riskPreview = await riskPreviewResponse.json();

    expect(entitiesResponse.status).toBe(200);
    expect(evidenceResponse.status).toBe(200);
    expect(riskPreviewResponse.status).toBe(200);
    expect(JSON.stringify(entities)).toContain("Example Surf Stay");
    expect(JSON.stringify(evidence)).toContain("public_ev_example_surf_stay_area");
    expect(JSON.stringify(riskPreview)).toContain("late-arrival-transfer-risk");
    expect(JSON.stringify(entities)).not.toContain("paid report");
    expect(JSON.stringify(evidence)).not.toContain("audit_");
  });

  test("keeps the public_api rate-limit 429 headers and shape on index routes", async () => {
    let response: Response | undefined;

    for (let index = 0; index < 121; index += 1) {
      response = await entitiesGet(new Request("https://siargao.test/api/public/entities"));
    }

    if (!response) {
      throw new Error("Expected rate limit response.");
    }

    const body = (await response.json()) as { error: string; resetAt: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("x-ratelimit-limit")).toBe("120");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe(body.resetAt);
    expect(body.error).toBe("rate_limited");
    expect(body.resetAt).toBeTruthy();
  });
});
