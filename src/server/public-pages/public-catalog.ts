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
  listPages(): Promise<PublicKnowledgePage[]>;
  listEligiblePages(): Promise<PublicKnowledgePage[]>;
};

let defaultCatalog: PublicKnowledgeCatalog | null = null;

export function createFixturePublicKnowledgeCatalog(
  repository: PublicPageRepository = createFixturePublicPageRepository(),
): PublicKnowledgeCatalog {
  return {
    async getPage(family, slug) {
      const page = repository.getPage(family, slug);
      return page && evaluatePublicPageEligibility(page).eligible ? page : undefined;
    },
    async listPages() {
      return repository.listPages();
    },
    async listEligiblePages() {
      return repository.listEligiblePages();
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
