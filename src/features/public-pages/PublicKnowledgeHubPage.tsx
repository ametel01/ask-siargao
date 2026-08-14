import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { PublicKnowledgePage } from "@/server/public-pages/public-content";
import {
  type PublicSurfaceDefinition,
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";
import {
  AppBackdrop,
  appBodyClass,
  appCardClass,
  appCardContentClass,
  appLabelClass,
  appPanelClass,
  appShellClass,
  BrandHeader,
  PageHeader,
  SectionHeading,
} from "@/ui/components/ask-siargao";

export function PublicKnowledgeHubPage({
  pages,
  surface,
}: {
  pages: readonly PublicKnowledgePage[];
  surface: PublicSurfaceDefinition;
}) {
  const otherSurfaces: PublicSurfaceDefinition[] = [];
  for (const family of publicPageFamilies) {
    const candidate = publicSurfaceRegistry[family];
    if (candidate.family !== surface.family) {
      otherSurfaces.push(candidate);
    }
  }

  return (
    <AppBackdrop>
      <section className={appShellClass}>
        <BrandHeader label="Siargao travel guides" />
        <PageHeader
          description={surface.hubDescription}
          eyebrow="Ask Siargao travel knowledge"
          title={surface.hubTitle}
        />

        <section className={appPanelClass}>
          <SectionHeading icon={Compass} title="Published guides" />
          {pages.length > 0 ? (
            <div className="grid gap-4">
              {pages.map((page) => (
                <Card className={appCardClass} key={page.publicPageId} size="sm">
                  <CardContent className={appCardContentClass}>
                    <p className={appLabelClass}>Checked {page.updatedAt.slice(0, 10)}</p>
                    <h2 className="m-0 text-lg leading-tight font-extrabold text-text-strong">
                      <Link
                        className="inline-flex items-center gap-2 text-inherit underline decoration-brand-lagoon-500/50 underline-offset-4"
                        href={page.humanPath}
                      >
                        {page.title}
                        <ArrowRight aria-hidden="true" size={17} />
                      </Link>
                    </h2>
                    <p className={appBodyClass}>{page.summary}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className={appBodyClass}>
              No guides in this topic are currently approved for public indexing.
            </p>
          )}
        </section>

        <nav aria-label="Other Siargao travel topics" className={appPanelClass}>
          <SectionHeading title="Browse other topics" />
          <div className="flex flex-wrap gap-3">
            {otherSurfaces.map((candidate) => (
              <Link
                className="inline-flex min-h-11 items-center rounded-full border border-border-default bg-surface-default px-4 text-sm font-extrabold text-text-default no-underline"
                href={candidate.hubPath}
                key={candidate.family}
              >
                {candidate.hubTitle}
              </Link>
            ))}
          </div>
        </nav>
      </section>
    </AppBackdrop>
  );
}
