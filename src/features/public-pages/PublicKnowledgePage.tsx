import { CheckCircle2, FileJson, FileText, LinkIcon } from "lucide-react";

import {
  type PublicKnowledgePage as PublicKnowledgePageData,
  buildPublicJsonLd,
} from "@/server/public-pages/public-content";
import { css } from "../../../styled-system/css/css";
import { pageShell } from "../../../styled-system/recipes/page-shell";

export function PublicKnowledgePage({ page }: { page: PublicKnowledgePageData }) {
  return (
    <main className={pageShell()}>
      <script type="application/ld+json">{JSON.stringify(buildPublicJsonLd(page))}</script>
      <section
        className={css({
          display: "grid",
          gap: "6",
          maxW: "1120px",
          mx: "auto",
          px: { base: "5", md: "8" },
          py: { base: "8", md: "12" },
        })}
      >
        <header className={css({ color: "text.onDark", display: "grid", gap: "4", maxW: "820px" })}>
          <p className={eyebrowDarkClass()}>
            Public {page.family.slice(0, -1)} page · {page.indexingStatus}
          </p>
          <h1 className={titleClass()}>{page.title}</h1>
          <p className={introClass()}>{page.summary}</p>
          <div className={linkRowClass()}>
            <a className={pillLinkClass()} href={page.llmMarkdownPath}>
              <FileText aria-hidden="true" size={16} /> LLM Markdown
            </a>
            <a className={pillLinkClass()} href={page.jsonApiPath}>
              <FileJson aria-hidden="true" size={16} /> JSON
            </a>
            <a className={pillLinkClass()} href={page.canonicalUrl}>
              <LinkIcon aria-hidden="true" size={16} /> Canonical
            </a>
          </div>
        </header>

        <section className={panelClass()}>
          <PanelHeading title="Public claims" />
          <div className={css({ display: "grid", gap: "4" })}>
            {page.facts.map((fact) => (
              <article className={cardClass()} key={fact.id}>
                <p className={labelClass()}>{fact.evidenceId}</p>
                <h2 className={cardTitleClass()}>{fact.claim}</h2>
                <p className={bodyClass()}>
                  {fact.sourceName} · {fact.sourceType} · {fact.confidence} confidence ·{" "}
                  {fact.freshness}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className={panelClass()}>
          <PanelHeading title="Freshness, confidence, limitations" />
          <div
            className={css({
              display: "grid",
              gap: "4",
              gridTemplateColumns: { base: "1fr", md: "repeat(3, 1fr)" },
            })}
          >
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
    <article className={cardClass()}>
      <p className={labelClass()}>{title}</p>
      <p className={bodyClass()}>{value}</p>
    </article>
  );
}

function PanelHeading({ title }: { title: string }) {
  return (
    <div className={css({ alignItems: "center", display: "flex", gap: "3", mb: "4" })}>
      <span
        className={css({
          alignItems: "center",
          bg: "surface.tint",
          borderRadius: "md",
          color: "violet.650",
          display: "inline-flex",
          h: "10",
          justifyContent: "center",
          width: "10",
        })}
      >
        <CheckCircle2 aria-hidden="true" size={21} />
      </span>
      <h2 className={css({ color: "text.strong", fontSize: "xl", fontWeight: "800", m: 0 })}>
        {title}
      </h2>
    </div>
  );
}

function panelClass() {
  return css({
    bg: "surface",
    borderColor: "border",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    p: { base: "5", md: "6" },
  });
}

function cardClass() {
  return css({
    bg: "surface.tint",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    p: "4",
  });
}

function titleClass() {
  return css({
    color: "text.onDark",
    fontSize: { base: "3xl", md: "4xl" },
    fontWeight: "800",
    lineHeight: "1.1",
    m: 0,
  });
}

function introClass() {
  return css({ color: "text.onDarkMuted", fontSize: "md", lineHeight: "1.7", m: 0 });
}

function eyebrowDarkClass() {
  return css({
    color: "text.onDarkMuted",
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    textTransform: "uppercase",
  });
}

function labelClass() {
  return css({
    color: "violet.650",
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    textTransform: "uppercase",
  });
}

function cardTitleClass() {
  return css({ color: "text.strong", fontSize: "md", fontWeight: "800", lineHeight: "1.35", m: 0 });
}

function bodyClass() {
  return css({ color: "text.muted", fontSize: "sm", lineHeight: "1.65", m: 0 });
}

function linkRowClass() {
  return css({
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "3",
  });
}

function pillLinkClass() {
  return css({
    alignItems: "center",
    bg: "rgba(255,255,255,0.14)",
    borderColor: "border.onDark",
    borderRadius: "pill",
    borderWidth: "1px",
    color: "text.onDark",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "800",
    gap: "2",
    minH: "34px",
    px: "3",
    textDecoration: "none",
  });
}
