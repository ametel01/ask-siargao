import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { createDatabasePublicKnowledgeCatalog } from "@/server/public-pages/database-public-catalog";
import {
  createFixturePublicPageRepository,
  evaluatePublicPageEligibility,
  type PublicKnowledgePage,
  type PublicPageRepository,
} from "@/server/public-pages/public-content";
import type { PublicPageFamily } from "@/server/public-pages/public-surface-registry";

export type PublicKnowledgeCatalog = {
  getPage(family: PublicPageFamily, slug: string): Promise<PublicKnowledgePage | undefined>;
  listPages(options?: PublicCatalogListOptions): Promise<PublicKnowledgePage[]>;
  listEligiblePages(options?: PublicCatalogListOptions): Promise<PublicKnowledgePage[]>;
};

export type PublicCatalogListOptions = {
  limit?: number;
};

const PUBLIC_CATALOG_FIXTURE_DEFAULT_LIMIT = 500;
const PUBLIC_CATALOG_FIXTURE_MAX_LIMIT = 1_000;

let defaultCatalog: PublicKnowledgeCatalog | null = null;

export function createFixturePublicKnowledgeCatalog(
  repository: PublicPageRepository = createFixturePublicPageRepository(),
): PublicKnowledgeCatalog {
  return {
    async getPage(family, slug) {
      const page = repository.getPage(family, slug);
      return page && evaluatePublicPageEligibility(page).eligible ? page : undefined;
    },
    async listPages(options) {
      return repository.listPages().slice(0, normalizeFixtureCatalogLimit(options?.limit));
    },
    async listEligiblePages(options) {
      return repository.listEligiblePages().slice(0, normalizeFixtureCatalogLimit(options?.limit));
    },
  };
}

export function createResilientPublicKnowledgeCatalog(input: {
  primary: PublicKnowledgeCatalog;
  fallback?: PublicKnowledgeCatalog;
}): PublicKnowledgeCatalog {
  const fallback = input.fallback ?? createFixturePublicKnowledgeCatalog();

  return {
    async getPage(family, slug) {
      try {
        return (await input.primary.getPage(family, slug)) ?? fallback.getPage(family, slug);
      } catch {
        return fallback.getPage(family, slug);
      }
    },
    async listPages(options) {
      try {
        const pages = await input.primary.listPages(options);
        return pages.length > 0 ? pages : fallback.listPages(options);
      } catch {
        return fallback.listPages(options);
      }
    },
    async listEligiblePages(options) {
      try {
        const pages = await input.primary.listEligiblePages(options);
        return pages.length > 0 ? pages : fallback.listEligiblePages(options);
      } catch {
        return fallback.listEligiblePages(options);
      }
    },
  };
}

export function getPublicKnowledgeCatalog() {
  if (defaultCatalog) {
    return defaultCatalog;
  }

  defaultCatalog = process.env.DATABASE_URL
    ? createResilientPublicKnowledgeCatalog({
        primary: createDatabasePublicKnowledgeCatalog({ client: getDefaultDatabaseQueryClient() }),
      })
    : createFixturePublicKnowledgeCatalog();

  return defaultCatalog;
}

export function resetPublicKnowledgeCatalogForTests(catalog: PublicKnowledgeCatalog | null = null) {
  defaultCatalog = catalog;
}

function normalizeFixtureCatalogLimit(limit: number | undefined) {
  if (limit === undefined) {
    return PUBLIC_CATALOG_FIXTURE_DEFAULT_LIMIT;
  }
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    return 1;
  }
  return Math.min(limit, PUBLIC_CATALOG_FIXTURE_MAX_LIMIT);
}
