import { CheckCircle2, FileJson, FileText, LinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { serializeJsonForHtmlScript } from "@/server/public-pages/html-json";
import {
  buildPublicJsonLd,
  type PublicKnowledgePage as PublicKnowledgePageData,
} from "@/server/public-pages/public-content";

const backdropClass =
  "min-h-screen bg-[radial-gradient(circle_at_18%_8%,rgba(135,92,246,0.2),transparent_32rem),linear-gradient(135deg,#05082a_0%,#090d3a_48%,#17105a_100%)] text-text-on-dark";
const contentShell = "mx-auto grid max-w-[1120px] gap-6 px-5 py-8 md:px-8 md:py-12";
const panelClass =
  "rounded-lg border border-border-default bg-surface-default p-5 shadow-card md:p-6";
const cardClass = "grid gap-2 rounded-md border border-border-default bg-surface-tint p-4";
const cardContentClass = "grid gap-2 p-0";
const labelClass = "m-0 text-xs font-extrabold text-brand-violet-650 uppercase";
const bodyClass = "m-0 text-sm leading-[1.65] text-text-muted";

export function PublicKnowledgePage({ page }: { page: PublicKnowledgePageData }) {
  return (
    <main className={backdropClass}>
      <script type="application/ld+json">
        {serializeJsonForHtmlScript(buildPublicJsonLd(page))}
      </script>
      <section className={contentShell}>
        <header className="grid max-w-[820px] gap-4 text-text-on-dark">
          <p className="m-0 text-xs font-extrabold text-text-on-dark-muted uppercase">
            Public {page.family.slice(0, -1)} page · {page.indexingStatus}
          </p>
          <h1 className="m-0 text-3xl leading-[1.1] font-extrabold text-text-on-dark md:text-4xl">
            {page.title}
          </h1>
          <p className="m-0 text-base leading-[1.7] text-text-on-dark-muted">{page.summary}</p>
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
        </header>

        <section className={panelClass}>
          <PanelHeading title="Public claims" />
          <div className="grid gap-4">
            {page.facts.map((fact) => (
              <Card className={cardClass} key={fact.id} size="sm">
                <CardContent className={cardContentClass}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={labelClass}>{fact.evidenceId}</p>
                    <Badge variant="outline">{fact.confidence} confidence</Badge>
                  </div>
                  <h2 className="m-0 text-base leading-[1.35] font-extrabold text-text-strong">
                    {fact.claim}
                  </h2>
                  <p className={bodyClass}>
                    {fact.sourceName} · {fact.sourceType} · {fact.freshness}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className={panelClass}>
          <PanelHeading title="Freshness, confidence, limitations" />
          <div className="grid gap-4 md:grid-cols-3">
            <Info title="Freshness" value={page.facts.map((fact) => fact.freshness).join(", ")} />
            <Info title="Confidence" value={page.facts.map((fact) => fact.confidence).join(", ")} />
            <Info title="Limitations" value={page.limitations.join(" ")} />
          </div>
        </section>
      </section>
    </main>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <Card className={cardClass} size="sm">
      <CardContent className={cardContentClass}>
        <p className={labelClass}>{title}</p>
        <p className={bodyClass}>{value}</p>
      </CardContent>
    </Card>
  );
}

function PanelHeading({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="inline-flex size-10 items-center justify-center rounded-md bg-surface-tint text-brand-violet-650">
        <CheckCircle2 aria-hidden="true" size={21} />
      </span>
      <h2 className="m-0 text-xl font-extrabold text-text-strong">{title}</h2>
    </div>
  );
}

const pillLinkClass =
  "inline-flex min-h-[34px] items-center gap-2 rounded-full border border-border-on-dark bg-white/15 px-3 text-xs font-extrabold text-text-on-dark no-underline";
