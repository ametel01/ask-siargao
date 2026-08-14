import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PublicKnowledgeHubPage } from "@/features/public-pages/PublicKnowledgeHubPage";
import { publicKnowledgePages } from "@/server/public-pages/public-content";
import { getPublicSurface } from "@/server/public-pages/public-surface-registry";

test("links an eligible topic page and the other public hubs", () => {
  const surface = getPublicSurface("accommodations");
  const pages = publicKnowledgePages.filter((page) => page.family === surface.family);
  const html = renderToStaticMarkup(<PublicKnowledgeHubPage pages={pages} surface={surface} />);

  expect(html).toContain("Where to stay in Siargao");
  expect(html).toContain('href="/accommodations/example-surf-stay"');
  expect(html).toContain('href="/areas"');
  expect(html).not.toContain('href="/accommodations"');
});
