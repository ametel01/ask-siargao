import { CheckCircle2, FileJson, FileText, LinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { serializeJsonForHtmlScript } from "@/server/public-pages/html-json";
import {
  buildPublicJsonLd,
  type PublicKnowledgePage as PublicKnowledgePageData,
} from "@/server/public-pages/public-content";
import {
  AppBackdrop,
  appBodyClass,
  appCardClass,
  appCardContentClass,
  appLabelClass,
  appOutlineBadgeClass,
  appPanelClass,
  appShellClass,
  PageHeader,
  SectionHeading,
} from "@/ui/components/ask-siargao";

export function PublicKnowledgePage({ page }: { page: PublicKnowledgePageData }) {
  return (
    <AppBackdrop>
      <script type="application/ld+json">
        {serializeJsonForHtmlScript(buildPublicJsonLd(page))}
      </script>
      <section className={appShellClass}>
        <PageHeader
          description={page.summary}
          eyebrow={`Public ${page.family.slice(0, -1)} page · ${page.indexingStatus}`}
          title={page.title}
        >
          <Badge className="w-fit" variant="secondary">
            {page.indexingStatus}
          </Badge>
          <div className="flex flex-wrap items-center gap-3">
            <a className={pillLinkClass} href={page.llmMarkdownPath}>
              <FileText aria-hidden="true" size={16} /> LLM Markdown
            </a>
            <a className={pillLinkClass} href={page.jsonApiPath}>
              <FileJson aria-hidden="true" size={16} /> JSON
            </a>
            <a className={pillLinkClass} href={page.canonicalUrl}>
              <LinkIcon aria-hidden="true" size={16} /> Canonical
            </a>
          </div>
        </PageHeader>

        <section className={appPanelClass}>
          <SectionHeading icon={CheckCircle2} title="Public claims" />
          <div className="grid gap-4">
            {page.facts.map((fact) => (
              <Card className={appCardClass} key={fact.id} size="sm">
                <CardContent className={appCardContentClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={appLabelClass}>{fact.evidenceId}</p>
                    <Badge className={appOutlineBadgeClass} variant="outline">
                      {fact.confidence} confidence
                    </Badge>
                  </div>
                  <h2 className="m-0 text-base leading-[1.35] font-extrabold text-text-strong">
                    {fact.claim}
                  </h2>
                  <p className={appBodyClass}>
                    {fact.sourceName} · {fact.sourceType} · {fact.freshness}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className={appPanelClass}>
          <SectionHeading icon={CheckCircle2} title="Freshness, confidence, limitations" />
          <div className="grid gap-4 md:grid-cols-3">
            <Info title="Freshness" value={page.facts.map((fact) => fact.freshness).join(", ")} />
            <Info title="Confidence" value={page.facts.map((fact) => fact.confidence).join(", ")} />
            <Info title="Limitations" value={page.limitations.join(" ")} />
          </div>
        </section>
      </section>
    </AppBackdrop>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <Card className={appCardClass} size="sm">
      <CardContent className={appCardContentClass}>
        <p className={appLabelClass}>{title}</p>
        <p className={appBodyClass}>{value}</p>
      </CardContent>
    </Card>
  );
}

const pillLinkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 text-xs font-extrabold text-text-on-dark no-underline shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition hover:bg-white/18";
