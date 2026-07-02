import { notFound } from "next/navigation";

import { PublicKnowledgePage } from "@/features/public-pages/PublicKnowledgePage";
import { trackServerEvent } from "@/server/observability/events";
import { getPublicKnowledgeCatalog } from "@/server/public-pages/public-catalog";
import {
  buildPublicPageJson,
  buildPublicPageMarkdown,
  normalizeJsonSlug,
  type PublicPageFamily,
} from "@/server/public-pages/public-content";
import { rateLimitedJson, rateLimitRequest } from "@/server/security/rate-limit";

export async function renderPublicHumanPage(family: PublicPageFamily, slug: string) {
  const page = await getPublicKnowledgeCatalog().getPage(family, slug);

  if (!page) {
    notFound();
  }

  return <PublicKnowledgePage page={page} />;
}

export async function publicMarkdownResponse(family: PublicPageFamily, slug: string) {
  const page = await getPublicKnowledgeCatalog().getPage(family, slug);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buildPublicPageMarkdown(page), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export async function publicJsonResponse(
  family: PublicPageFamily,
  slug: string,
  request?: Request,
) {
  if (request) {
    const rateLimit = rateLimitRequest(request, "public_api");
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
