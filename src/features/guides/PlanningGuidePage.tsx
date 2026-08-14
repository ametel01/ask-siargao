import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  Compass,
  ExternalLink,
  Map as MapIcon,
  MessageCircle,
  Navigation,
  Route,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildPlanningGuideJsonLd,
  planningGuidePath,
  planningGuidesPath,
} from "@/server/guides/planning-guide-output";
import {
  buildGuideChatHref,
  getPlanningGuide,
  type PlanningGuide,
} from "@/server/guides/planning-guides";
import { serializeJsonForHtmlScript } from "@/server/public-pages/html-json";

const guideDateFormatter = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export function PlanningGuidePage({ guide }: { guide: PlanningGuide }) {
  const relatedGuides = guide.relatedSlugs.flatMap((slug) => {
    const relatedGuide = getPlanningGuide(slug);
    return relatedGuide ? [relatedGuide] : [];
  });

  return (
    <main
      className="min-h-screen bg-brand-navy-980 text-text-on-dark"
      id="main-content"
      tabIndex={-1}
    >
      <script type="application/ld+json">
        {serializeJsonForHtmlScript(buildPlanningGuideJsonLd(guide))}
      </script>

      <header className="border-b border-border-on-dark bg-brand-navy-980/95">
        <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
          <Link
            className="inline-flex min-h-11 items-center gap-3 rounded-md font-bold no-underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
            href="/"
          >
            <Image
              alt=""
              aria-hidden="true"
              className="size-10 rounded-full border border-border-on-dark object-contain p-1"
              height={40}
              src="/ask_siargao_palm_icon.svg"
              width={40}
            />
            <span className="font-heading text-xl font-semibold sm:text-2xl">Ask Siargao</span>
          </Link>
          <Button
            asChild
            className="min-h-11 bg-brand-lagoon-700 font-extrabold hover:bg-brand-lagoon-600"
          >
            <Link href={buildGuideChatHref(guide, guide.realityChecks[0])}>
              <MessageCircle aria-hidden="true" size={18} />
              <span className="hidden sm:inline">Reality-check this guide</span>
              <span className="sm:hidden">Reality Check</span>
            </Link>
          </Button>
        </div>
      </header>

      <article>
        <GuideHero guide={guide} />

        <div className="bg-brand-paper-100 text-text-default">
          <div className="mx-auto grid w-full max-w-[90rem] gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-12 lg:py-16">
            <GuideContents guide={guide} />
            <div className="min-w-0 space-y-12 lg:space-y-16">
              <QuickRecommendation guide={guide} />
              <GuideComparison guide={guide} />
              <GuideRoute guide={guide} />
              <TravelPlanning guide={guide} />
              <RealityCheckPanel guide={guide} />
              <TrustSection guide={guide} />
              <FaqSection guide={guide} />
              <RelatedGuides guides={relatedGuides} />
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}

function GuideHero({ guide }: { guide: PlanningGuide }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border-on-dark bg-brand-navy-980">
      <div className="mx-auto grid w-full max-w-[90rem] gap-8 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(28rem,1.08fr)] lg:items-center lg:px-12 lg:py-16">
        <div className="grid min-w-0 gap-6 lg:py-6">
          <Link
            className="inline-flex w-fit min-h-11 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 underline decoration-brand-lagoon-300/50 underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
            href={planningGuidesPath}
          >
            <ArrowLeft aria-hidden="true" size={17} /> Planning guides
          </Link>
          <h1 className="m-0 max-w-[13ch] text-balance font-heading text-[clamp(3.25rem,8vw,6rem)] leading-[0.92] font-semibold tracking-[-0.025em] text-text-on-dark">
            {guide.title}
          </h1>
          <p className="m-0 max-w-[58ch] text-lg leading-relaxed font-semibold text-text-on-dark-muted sm:text-xl">
            {guide.description}
          </p>
          <dl className="m-0 grid gap-3 border-t border-border-on-dark pt-5 text-sm text-text-on-dark-muted sm:grid-cols-2">
            <Byline label="Written by" name={guide.author.name} role={guide.author.role} />
            <Byline label="Reviewed by" name={guide.reviewer.name} role={guide.reviewer.role} />
          </dl>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-text-on-dark-muted">
            <span className="inline-flex items-center gap-2">
              <CalendarCheck2 aria-hidden="true" className="text-brand-lagoon-300" size={18} />
              Last checked {formatDate(guide.lastChecked)}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 aria-hidden="true" className="text-brand-lagoon-300" size={18} />
              {guide.readingMinutes} min read
            </span>
          </div>
        </div>

        <figure className="m-0 overflow-hidden rounded-2xl bg-brand-reef-900 shadow-coastal-frame">
          <Image
            alt={guide.image.alt}
            className="aspect-[3/2] h-auto w-full object-cover"
            height={1024}
            preload
            sizes="(min-width: 1024px) 52vw, 100vw"
            src={guide.image.src}
            width={1536}
          />
          <figcaption className="border-t border-border-on-dark bg-brand-reef-900 px-4 py-3 text-xs leading-relaxed text-text-on-dark-muted">
            {guide.image.caption}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function Byline({ label, name, role }: { label: string; name: string; role: string }) {
  return (
    <div>
      <dt className="font-extrabold text-text-on-dark">{label}</dt>
      <dd className="m-0">
        {name} · {role}
      </dd>
    </div>
  );
}

function GuideContents({ guide }: { guide: PlanningGuide }) {
  const links = [
    { href: "#quick-recommendation", label: "Quick recommendation" },
    { href: "#compare", label: guide.comparison.title },
    ...guide.sections.map((section) => ({ href: `#${section.id}`, label: section.title })),
    { href: "#travel-planning", label: "Travel times and map" },
    { href: "#reality-check", label: "Live Reality Check" },
    { href: "#sources", label: "Sources and limitations" },
    { href: "#faqs", label: "FAQs" },
  ];

  return (
    <aside className="self-start lg:sticky lg:top-6">
      <nav
        aria-label="On this page"
        className="rounded-xl border border-border-default bg-surface-default p-4 shadow-none"
      >
        <p className="m-0 flex items-center gap-2 font-extrabold text-text-strong">
          <Compass aria-hidden="true" className="text-brand-lagoon-700" size={19} />
          Follow the route
        </p>
        <ol className="mt-4 mb-0 grid list-none gap-1 border-l border-border-default pl-0">
          {links.map((link) => (
            <li className="relative pl-4" key={link.href}>
              <span className="absolute top-[1.08rem] -left-[0.28rem] size-2 rounded-full bg-brand-lagoon-600" />
              <a
                className="block rounded-md px-2 py-2 text-sm font-bold text-text-muted no-underline hover:bg-brand-lagoon-100 hover:text-brand-lagoon-700 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
                href={link.href}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function QuickRecommendation({ guide }: { guide: PlanningGuide }) {
  return (
    <section
      className="rounded-2xl bg-brand-navy-950 p-6 text-text-on-dark shadow-surface-panel sm:p-8"
      id="quick-recommendation"
    >
      <h2 className="m-0 flex items-center gap-3 font-heading text-3xl leading-tight font-semibold sm:text-4xl">
        <CheckCircle2 aria-hidden="true" className="shrink-0 text-brand-lagoon-300" size={30} />
        Quick recommendation
      </h2>
      <p className="mt-4 mb-0 max-w-[70ch] text-lg leading-relaxed text-text-on-dark-muted">
        {guide.quickRecommendation}
      </p>
    </section>
  );
}

function GuideComparison({ guide }: { guide: PlanningGuide }) {
  return (
    <section className="scroll-mt-6" id="compare">
      <SectionTitle icon={Navigation} title={guide.comparison.title} />
      <p className="mt-3 max-w-[70ch] leading-relaxed text-text-muted">
        {guide.comparison.introduction}
      </p>
      <section
        aria-label={`${guide.comparison.title} comparison table`}
        className="mt-6 overflow-x-auto rounded-xl border border-border-default bg-surface-default"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll this region.
        tabIndex={0}
      >
        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
          <thead className="bg-brand-lagoon-100 text-text-strong">
            <tr>
              {guide.comparison.columns.map((column) => (
                <th className="px-4 py-3 font-extrabold" key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guide.comparison.rows.map((row) => (
              <tr className="border-t border-border-default align-top" key={row[0]}>
                {row.map((cell, index) => (
                  <td
                    className={cn(
                      "px-4 py-4 leading-relaxed",
                      index === 0 && "font-extrabold text-text-strong",
                    )}
                    key={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function GuideRoute({ guide }: { guide: PlanningGuide }) {
  return (
    <div className="grid gap-12">
      {guide.sections.map((section) => (
        <section className="scroll-mt-6" id={section.id} key={section.id}>
          <SectionTitle icon={Route} title={section.title} />
          <p className="mt-3 max-w-[70ch] leading-relaxed text-text-muted">
            {section.introduction}
          </p>
          <div className="mt-7 grid gap-0 border-y border-border-default bg-surface-default">
            {section.items.map((content, index) => (
              <div
                className={cn(
                  "grid gap-2 py-5 sm:grid-cols-[minmax(10rem,0.36fr)_minmax(0,0.64fr)] sm:gap-7",
                  index > 0 && "border-t border-border-default",
                )}
                key={content.title}
              >
                <h3 className="m-0 text-base leading-snug font-extrabold text-text-strong">
                  {content.title}
                </h3>
                <div>
                  <p className="m-0 max-w-[65ch] leading-relaxed text-text-default">
                    {content.body}
                  </p>
                  {content.note ? (
                    <p className="mt-2 mb-0 max-w-[65ch] text-sm leading-relaxed font-bold text-brand-lagoon-700">
                      {content.note}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TravelPlanning({ guide }: { guide: PlanningGuide }) {
  return (
    <section className="scroll-mt-6" id="travel-planning">
      <SectionTitle icon={MapIcon} title="Travel planning" />
      <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
        <div>
          <h3 className="m-0 text-xl font-extrabold text-text-strong">
            Realistic travel-time guide
          </h3>
          <p className="mt-2 mb-5 max-w-[65ch] text-sm leading-relaxed text-text-muted">
            These are planning ranges, not live traffic estimates. Use the longer end for a timed
            boat, flight, or ferry connection.
          </p>
          <ul className="m-0 list-none divide-y divide-border-default border-y border-border-default bg-surface-default p-0">
            {guide.travelTimes.map((time) => (
              <li
                className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:gap-5"
                key={`${time.from}-${time.to}`}
              >
                <div>
                  <p className="m-0 font-extrabold text-text-strong">
                    {time.from} <ArrowRight aria-hidden="true" className="inline" size={15} />{" "}
                    {time.to}
                  </p>
                  <p className="m-0 mt-1 text-sm leading-relaxed text-text-muted">{time.planFor}</p>
                </div>
                <p className="m-0 font-extrabold text-brand-lagoon-700">{time.estimate}</p>
              </li>
            ))}
          </ul>
        </div>
        <PlanningMap guide={guide} />
      </div>
    </section>
  );
}

function PlanningMap({ guide }: { guide: PlanningGuide }) {
  return (
    <figure className="m-0 rounded-xl bg-brand-reef-900 p-5 text-text-on-dark shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="m-0 text-xl font-extrabold">Planning map</h3>
          <p className="mt-1 mb-0 text-sm text-text-on-dark-muted">Schematic · not to scale</p>
        </div>
        <Navigation aria-hidden="true" className="text-brand-lagoon-300" size={24} />
      </div>
      <div className="relative mt-6 grid min-h-[22rem] grid-cols-3 grid-rows-5 gap-3 overflow-hidden rounded-lg border border-border-on-dark bg-brand-navy-980 p-4">
        <div className="absolute top-8 bottom-8 left-1/2 w-px -translate-x-1/2 bg-brand-lagoon-300/60" />
        {guide.mapStops.map((stop) => (
          <div
            className={cn(
              "relative z-10 max-w-[10rem] self-center rounded-lg border border-border-on-dark bg-brand-reef-900 px-3 py-2 text-xs shadow-night-card",
              stop.label === "Dapa Port"
                ? "col-start-1 row-start-5 justify-self-start"
                : mapPositionClass[stop.position],
            )}
            key={`${stop.label}-${stop.note}`}
          >
            <span className="block font-extrabold text-text-on-dark">{stop.label}</span>
            <span className="mt-1 block leading-snug text-text-on-dark-muted">{stop.note}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-4 text-xs leading-relaxed text-text-on-dark-muted">
        Use the map to group days by area. Open the source map for navigation, then confirm the
        actual pickup route locally.
      </figcaption>
      <a
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
        href="https://www.openstreetmap.org/#map=11/9.8565/126.0498"
        rel="noreferrer"
        target="_blank"
      >
        Open Siargao in OpenStreetMap <ExternalLink aria-hidden="true" size={16} />
      </a>
    </figure>
  );
}

const mapPositionClass = {
  north: "col-start-2 row-start-1 justify-self-center",
  west: "col-start-1 row-start-2 justify-self-start",
  center: "col-start-2 row-start-3 justify-self-center",
  east: "col-start-3 row-start-4 justify-self-end",
  south: "col-start-2 row-start-5 justify-self-center",
} as const;

function RealityCheckPanel({ guide }: { guide: PlanningGuide }) {
  return (
    <section
      className="scroll-mt-6 overflow-hidden rounded-2xl bg-brand-lagoon-100 text-text-strong shadow-surface-panel"
      id="reality-check"
    >
      <div className="grid gap-3 border-b border-brand-lagoon-300 p-6 sm:p-8">
        <h2 className="m-0 font-heading text-3xl leading-tight font-semibold sm:text-4xl">
          Turn the guide into today’s decision
        </h2>
        <p className="m-0 max-w-[65ch] leading-relaxed text-text-muted">
          The static plan stays complete. Ask Siargao adds current weather, tide, transport, and
          your real constraints when you explicitly submit a Reality Check.
        </p>
      </div>
      <div className="grid gap-0 sm:grid-cols-2">
        {guide.realityChecks.map((action, index) => (
          <Link
            className={cn(
              "group flex min-h-20 items-center justify-between gap-4 p-5 font-extrabold text-brand-lagoon-700 no-underline transition-colors hover:bg-brand-lagoon-300/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-brand-lagoon-700",
              index > 0 && "border-t border-brand-lagoon-300",
              index === 1 && "sm:border-t-0 sm:border-l",
              index === 3 && "sm:border-l",
            )}
            href={buildGuideChatHref(guide, action)}
            key={action.label}
          >
            {action.label}
            <ArrowRight
              aria-hidden="true"
              className="shrink-0 transition-transform group-hover:translate-x-1"
              size={18}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

function TrustSection({ guide }: { guide: PlanningGuide }) {
  return (
    <section className="scroll-mt-6" id="sources">
      <SectionTitle icon={ShieldCheck} title="Sources and limitations" />
      <p className="mt-3 max-w-[70ch] leading-relaxed text-text-muted">
        Stable guidance is separated from facts that require a current check. Sources are linked
        directly; their presence does not turn a seasonal pattern into a live forecast.
      </p>

      <div className="mt-7 grid gap-0 border-y border-border-default bg-surface-default">
        {guide.sources.map((source, index) => (
          <a
            className={cn(
              "grid gap-2 py-5 text-inherit no-underline hover:text-brand-lagoon-700 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,0.62fr)] sm:gap-6",
              index > 0 && "border-t border-border-default",
            )}
            href={source.url}
            key={source.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="font-extrabold">
              {source.name} <ExternalLink aria-hidden="true" className="inline" size={14} />
            </span>
            <span className="text-sm leading-relaxed text-text-muted">
              {source.publisher} · {source.usedFor}
            </span>
          </a>
        ))}
      </div>

      <ul className="mt-6 grid gap-3 pl-5 text-sm leading-relaxed text-text-muted">
        {guide.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>

      <div className="mt-7 grid gap-4 rounded-xl bg-brand-paper-150 p-5 sm:grid-cols-3">
        <TrustNote
          title="Editorial method"
          body="We separate durable planning advice from changeable facts, prefer primary public sources, and expose the caveats that can change the decision."
        />
        <TrustNote
          title="Corrections policy"
          body="Material errors are reviewed against a source, corrected in the guide, and reflected in the checked date. Unverified chat reports are not silently published."
        />
        <TrustNote
          title="Commercial disclosure"
          body="This guide contains no paid placement, affiliate booking link, or operator endorsement."
        />
      </div>
    </section>
  );
}

function TrustNote({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="m-0 text-sm font-extrabold text-text-strong">{title}</h3>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}

function FaqSection({ guide }: { guide: PlanningGuide }) {
  return (
    <section className="scroll-mt-6" id="faqs">
      <SectionTitle title="Frequently asked questions" />
      <div className="mt-6 divide-y divide-border-default border-y border-border-default">
        {guide.faqs.map((faq) => (
          <details className="group bg-surface-default py-1" key={faq.question}>
            <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-md px-2 py-3 font-extrabold text-text-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300">
              {faq.question}
              <span
                aria-hidden="true"
                className="text-xl text-brand-lagoon-700 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-0 mb-5 max-w-[70ch] px-2 leading-relaxed text-text-muted">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function RelatedGuides({ guides }: { guides: readonly PlanningGuide[] }) {
  return (
    <section>
      <SectionTitle icon={Compass} title="Related planning guides" />
      <div className="mt-6 divide-y divide-border-default border-y border-border-default">
        {guides.map((guide) => (
          <Link
            className="group grid gap-2 py-5 text-inherit no-underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300 sm:grid-cols-[minmax(12rem,0.38fr)_minmax(0,0.62fr)_auto] sm:items-center sm:gap-6"
            href={planningGuidePath(guide)}
            key={guide.slug}
          >
            <span className="font-extrabold text-text-strong group-hover:text-brand-lagoon-700">
              {guide.shortTitle}
            </span>
            <span className="text-sm leading-relaxed text-text-muted">{guide.description}</span>
            <ArrowRight aria-hidden="true" className="text-brand-lagoon-700" size={18} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ icon: Icon, title }: { icon?: typeof Compass; title: string }) {
  return (
    <h2 className="m-0 flex items-center gap-3 font-heading text-3xl leading-tight font-semibold text-text-strong sm:text-4xl">
      {Icon ? (
        <Icon aria-hidden="true" className="shrink-0 text-brand-lagoon-700" size={28} />
      ) : null}
      {title}
    </h2>
  );
}

function formatDate(value: string) {
  return guideDateFormatter.format(new Date(`${value}T00:00:00+08:00`));
}
