import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublicKnowledgeHubPage } from "@/features/public-pages/PublicKnowledgeHubPage";
import { PublicKnowledgePage } from "@/features/public-pages/PublicKnowledgePage";
import { trackServerEvent } from "@/server/observability/events";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import {
  buildPublicPageJson,
  buildPublicPageMarkdown,
  normalizeJsonSlug,
  type PublicKnowledgePage as PublicKnowledgePageData,
} from "@/server/public-pages/public-content";
import type { PublicSurfaceDefinition } from "@/server/public-pages/public-surface-registry";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";
import { buildIndexablePageMetadata } from "@/server/seo/metadata";

const PUBLIC_INDEX_PAGE_LIMIT = 1_000;

export function publicKnowledgeHubMetadata(surface: PublicSurfaceDefinition): Metadata {
  return buildIndexablePageMetadata({
    title: `${surface.hubTitle} | Ask Siargao`,
    description: surface.hubDescription,
    canonicalUrl: buildCanonicalSiteUrl(surface.hubPath),
  });
}

export function publicKnowledgePageMetadata(page: PublicKnowledgePageData): Metadata {
  return buildIndexablePageMetadata({
    title: `${page.title} | Ask Siargao`,
    description: page.summary,
    canonicalUrl: buildCanonicalSiteUrl(page.humanPath),
  });
}

export async function generatePublicKnowledgePageMetadata(
  surface: PublicSurfaceDefinition,
  slug: string,
) {
  return publicKnowledgePageMetadata(await requirePublicKnowledgePage(surface, slug));
}

export async function renderPublicKnowledgeHub(surface: PublicSurfaceDefinition) {
  const pages = await getPublicKnowledgeCatalog().listEligiblePages({
    limit: PUBLIC_INDEX_PAGE_LIMIT,
  });

  return (
    <PublicKnowledgeHubPage
      pages={pages.filter((page) => page.family === surface.catalogFamilyKey)}
      surface={surface}
    />
  );
}

export async function renderPublicHumanPage(surface: PublicSurfaceDefinition, slug: string) {
  return <PublicKnowledgePage page={await requirePublicKnowledgePage(surface, slug)} />;
}

const loadPublicKnowledgePage = cache((surface: PublicSurfaceDefinition, slug: string) =>
  getPublicKnowledgeCatalog().getPage(surface.catalogFamilyKey, slug),
);

async function requirePublicKnowledgePage(surface: PublicSurfaceDefinition, slug: string) {
  const page = await loadPublicKnowledgePage(surface, slug);

  if (!page) {
    notFound();
  }

  return page;
}

export async function publicMarkdownResponse(surface: PublicSurfaceDefinition, slug: string) {
  const family = surface.catalogFamilyKey;
  const page = await getPublicKnowledgeCatalog().getPage(family, slug);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buildPublicPageMarkdown(page), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export async function publicJsonResponse(
  surface: PublicSurfaceDefinition,
  slug: string,
  request?: Request,
) {
  const family = surface.catalogFamilyKey;
  if (request) {
    const rateLimit = await rateLimitRequest(request, "public_api");
    if (!rateLimit.allowed) {
      return rateLimitedJson(rateLimit);
    }
  }

  const page = await getPublicKnowledgeCatalog().getPage(family, normalizeJsonSlug(slug));

  if (!page) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  trackServerEvent({
    name: "public_api_used",
    payload: {
      family,
      slug: page.slug,
      evidenceIds: page.facts.map((fact) => fact.evidenceId),
    },
  });

  return Response.json(buildPublicPageJson(page), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
