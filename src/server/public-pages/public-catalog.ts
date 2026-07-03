import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { createDatabasePublicKnowledgeCatalog } from "@/server/public-pages/database-public-catalog";
import {
  createFixturePublicPageRepository,
  evaluatePublicPageEligibility,
  type PublicKnowledgePage,
  type PublicPageFamily,
  type PublicPageRepository,
} from "@/server/public-pages/public-content";

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

export function getPublicKnowledgeCatalog() {
  if (defaultCatalog) {
    return defaultCatalog;
  }

  defaultCatalog = process.env.DATABASE_URL
    ? createDatabasePublicKnowledgeCatalog({ client: getDefaultDatabaseQueryClient() })
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
