import { describe, expect, test } from "bun:test";

import {
  createFixturePublicKnowledgeCatalog,
  createResilientPublicKnowledgeCatalog,
  createRuntimePublicKnowledgeCatalog,
} from "@/server/public-pages/public-catalog";

describe("public knowledge catalog fallback", () => {
  test("never serves synthetic fixture content in production", async () => {
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

    expect(await catalog.listEligiblePages()).toEqual([]);
    expect(await catalog.getPage("accommodations", "example-surf-stay")).toBeUndefined();
  });

  test("fails closed when production has no governed catalog", async () => {
    const catalog = createRuntimePublicKnowledgeCatalog({
      env: { NODE_ENV: "production" },
    });

    await expect(catalog.listEligiblePages()).rejects.toBeDefined();
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
