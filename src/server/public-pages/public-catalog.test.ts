import { describe, expect, test } from "bun:test";

import {
  createFixturePublicKnowledgeCatalog,
  createResilientPublicKnowledgeCatalog,
  createRuntimePublicKnowledgeCatalog,
} from "@/server/public-pages/public-catalog";

describe("public knowledge catalog fallback", () => {
  test("serves only the governed baseline when the production catalog is empty", async () => {
    const emptyPrimary = {
      async getPage() {
        return undefined;
      },
      async listPages() {
        return [];
      },
      async listEligiblePages() {
        return [];
      },
    };
    const catalog = createRuntimePublicKnowledgeCatalog({
      databaseUrl: "postgres://configured.example/ask_siargao",
      env: { NODE_ENV: "production" },
      primary: emptyPrimary,
    });

    const pages = await catalog.listEligiblePages();

    expect(pages.map((page) => page.slug)).toEqual([
      "general-luna-stays",
      "general-luna",
      "surigao-city-to-dapa",
      "siargao-transfer-operator-checks",
      "late-arrival-transfer-risk",
    ]);
    expect(
      pages.every((page) =>
        page.facts.every((fact) => fact.sourceProfileId === "source_curated_ask_siargao_guide"),
      ),
    ).toBe(true);
    expect(await catalog.getPage("areas", "general-luna")).toBeDefined();
    expect(await catalog.getPage("routes", "surigao-city-to-dapa")).toBeDefined();
    expect(await catalog.getPage("accommodations", "example-surf-stay")).toBeUndefined();
  });

  test("fails closed when production has no governed catalog", async () => {
    const catalog = createRuntimePublicKnowledgeCatalog({
      env: { NODE_ENV: "production" },
    });

    await expect(catalog.listEligiblePages()).rejects.toBeDefined();
  });

  test("does not hide a production database catalog failure behind the baseline", async () => {
    const catalog = createRuntimePublicKnowledgeCatalog({
      databaseUrl: "postgres://configured.example/ask_siargao",
      env: { NODE_ENV: "production" },
      primary: {
        async getPage() {
          throw new Error("primary unavailable");
        },
        async listPages() {
          throw new Error("primary unavailable");
        },
        async listEligiblePages() {
          throw new Error("primary unavailable");
        },
      },
    });

    await expect(catalog.listEligiblePages()).rejects.toThrow("primary unavailable");
  });

  test("falls back to fixture pages when the primary catalog cannot list pages", async () => {
    const catalog = createResilientPublicKnowledgeCatalog({
      primary: {
        async getPage() {
          throw new Error("primary unavailable");
        },
        async listPages() {
          throw new Error("primary unavailable");
        },
        async listEligiblePages() {
          throw new Error("primary unavailable");
        },
      },
      fallback: createFixturePublicKnowledgeCatalog(),
    });

    const pages = await catalog.listEligiblePages();
    const page = await catalog.getPage("accommodations", "example-surf-stay");

    expect(pages.some((candidate) => candidate.slug === "example-surf-stay")).toBe(true);
    expect(page?.title).toBe("Example Surf Stay");
  });

  test("falls back to fixture pages when the primary catalog is empty", async () => {
    const catalog = createResilientPublicKnowledgeCatalog({
      primary: {
        async getPage() {
          return undefined;
        },
        async listPages() {
          return [];
        },
        async listEligiblePages() {
          return [];
        },
      },
      fallback: createFixturePublicKnowledgeCatalog(),
    });

    const pages = await catalog.listEligiblePages();
    const page = await catalog.getPage("accommodations", "example-surf-stay");

    expect(pages.some((candidate) => candidate.slug === "example-surf-stay")).toBe(true);
    expect(page?.title).toBe("Example Surf Stay");
  });
});
