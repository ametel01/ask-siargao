import { notFound } from "next/navigation";

import { PublicKnowledgePage } from "@/features/public-pages/PublicKnowledgePage";
import {
  type PublicPageFamily,
  buildPublicPageJson,
  buildPublicPageMarkdown,
  getPublicPage,
  normalizeJsonSlug,
} from "@/server/public-pages/public-content";

export function renderPublicHumanPage(family: PublicPageFamily, slug: string) {
  const page = getPublicPage(family, slug);

  if (!page || page.visibility !== "eligible") {
    notFound();
  }

  return <PublicKnowledgePage page={page} />;
}

export function publicMarkdownResponse(family: PublicPageFamily, slug: string) {
  const page = getPublicPage(family, slug);

  if (!page || page.visibility !== "eligible") {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buildPublicPageMarkdown(page), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

export function publicJsonResponse(family: PublicPageFamily, slug: string) {
  const page = getPublicPage(family, normalizeJsonSlug(slug));

  if (!page || page.visibility !== "eligible") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(buildPublicPageJson(page), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
