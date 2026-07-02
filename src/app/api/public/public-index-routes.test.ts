import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET as entitiesGet } from "@/app/api/public/entities/route";
import { GET as evidenceGet } from "@/app/api/public/evidence/route";
import { GET as riskPreviewGet } from "@/app/api/public/risk-preview/route";
import { resetPublicKnowledgeCatalogForTests } from "@/server/public-pages/public-catalog";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("public knowledge index routes", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetPublicKnowledgeCatalogForTests();
    resetRateLimitStoreForTests();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
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
});
