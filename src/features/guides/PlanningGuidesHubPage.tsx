import { ArrowRight, CalendarCheck2, Compass, MessageCircle, Route } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { planningGuidePath } from "@/server/guides/planning-guide-output";
import { planningGuides } from "@/server/guides/planning-guides";

const guideDateFormatter = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export function PlanningGuidesHubPage() {
  const latestChecked = planningGuides
    .map((guide) => guide.lastChecked)
    .toSorted()
    .at(-1);

  return (
    <main
      className="min-h-screen bg-brand-navy-980 text-text-on-dark"
      id="main-content"
      tabIndex={-1}
    >
      <header className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
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
          <Link href="/chat">
            <MessageCircle aria-hidden="true" size={18} /> Ask about your trip
          </Link>
        </Button>
      </header>

      <section className="mx-auto grid w-full max-w-[90rem] gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,1.1fr)] lg:items-center lg:px-12 lg:py-20">
        <div className="grid gap-6">
          <h1 className="m-0 max-w-[12ch] text-balance font-heading text-[clamp(3.75rem,9vw,7rem)] leading-[0.9] font-semibold tracking-[-0.025em]">
            Plan the island. Then check reality.
          </h1>
          <p className="m-0 max-w-[58ch] text-lg leading-relaxed font-semibold text-text-on-dark-muted sm:text-xl">
            Complete, source-visible Siargao planning guides with realistic timing and built-in ways
            to adapt each plan to weather, transport, and your constraints.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold text-text-on-dark-muted">
            <span className="inline-flex items-center gap-2">
              <Route aria-hidden="true" className="text-brand-lagoon-300" size={18} />
              {planningGuides.length} foundation guides
            </span>
            <span className="inline-flex items-center gap-2">
              <CalendarCheck2 aria-hidden="true" className="text-brand-lagoon-300" size={18} />
              {latestChecked
                ? `Latest guide check ${formatShortDate(latestChecked)}`
                : "Check pending"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-[1.08fr_0.92fr] gap-3 sm:gap-4">
          <Image
            alt="A palm-lined coastal road through Siargao"
            className="aspect-[4/5] h-full w-full rounded-2xl object-cover shadow-coastal-frame"
            height={1024}
            preload
            sizes="(min-width: 1024px) 28vw, 54vw"
            src="/images/guides/complete-siargao-guide.webp"
            width={1536}
          />
          <div className="grid gap-3 sm:gap-4">
            <Image
              alt="A small boat on a calm Siargao shore"
              className="aspect-square h-full w-full rounded-2xl object-cover shadow-surface-panel"
              height={1024}
              sizes="(min-width: 1024px) 22vw, 42vw"
              src="/images/guides/siargao-3-day-itinerary.webp"
              width={1536}
            />
            <div className="flex items-end rounded-2xl bg-brand-lagoon-100 p-5 text-text-strong shadow-surface-panel sm:p-6">
              <p className="m-0 font-heading text-xl leading-tight font-semibold sm:text-2xl">
                Evergreen guidance + a live Ask Siargao Reality Check.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-brand-paper-100 text-text-default">
        <div className="mx-auto w-full max-w-[90rem] px-5 py-12 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.72fr)_minmax(18rem,0.28fr)] sm:items-end">
            <h2 className="m-0 max-w-[14ch] font-heading text-4xl leading-[0.98] font-semibold text-text-strong sm:text-5xl">
              Start with the decision in front of you
            </h2>
            <p className="m-0 leading-relaxed text-text-muted">
              Every guide gives a complete static answer before asking you to open chat.
            </p>
          </div>

          <div className="mt-10 divide-y divide-border-default border-y border-border-default">
            {planningGuides.map((guide) => (
              <article
                className="group grid gap-5 py-7 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center sm:gap-7 lg:grid-cols-[15rem_minmax(0,1fr)_auto]"
                key={guide.slug}
              >
                <Image
                  alt={guide.image.alt}
                  className="aspect-[3/2] w-full rounded-xl object-cover shadow-none"
                  height={1024}
                  sizes="(min-width: 1024px) 15rem, (min-width: 640px) 11rem, 100vw"
                  src={guide.image.src}
                  width={1536}
                />
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-3 text-xs font-extrabold text-text-muted">
                    <span>{guide.readingMinutes} min read</span>
                    <span aria-hidden="true">·</span>
                    <span>Checked {formatShortDate(guide.lastChecked)}</span>
                  </div>
                  <h3 className="m-0 font-heading text-2xl leading-tight font-semibold text-text-strong sm:text-3xl">
                    <Link
                      className="rounded-md text-inherit no-underline group-hover:text-brand-lagoon-700 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
                      href={planningGuidePath(guide)}
                    >
                      {guide.title}
                    </Link>
                  </h3>
                  <p className="m-0 max-w-[65ch] leading-relaxed text-text-muted">
                    {guide.description}
                  </p>
                </div>
                <Link
                  aria-label={`Read ${guide.title}`}
                  className="inline-flex size-11 items-center justify-center rounded-full border border-border-default text-brand-lagoon-700 no-underline transition-colors hover:border-brand-lagoon-700 hover:bg-brand-lagoon-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-300"
                  href={planningGuidePath(guide)}
                >
                  <ArrowRight aria-hidden="true" size={20} />
                </Link>
              </article>
            ))}
          </div>

          <div className="mt-12 grid gap-5 rounded-2xl bg-brand-navy-950 p-6 text-text-on-dark shadow-surface-panel sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-8">
            <Compass aria-hidden="true" className="text-brand-lagoon-300" size={36} />
            <div>
              <h2 className="m-0 font-heading text-3xl leading-tight font-semibold">
                Have a hotel or itinerary already?
              </h2>
              <p className="mt-2 mb-0 max-w-[62ch] leading-relaxed text-text-on-dark-muted">
                Bring the real plan. Ask Siargao can check it against current conditions and the way
                you actually travel.
              </p>
            </div>
            <Button
              asChild
              className="min-h-11 bg-brand-lagoon-700 font-extrabold hover:bg-brand-lagoon-600"
            >
              <Link href="/chat">Run a Reality Check</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatShortDate(value: string) {
  return guideDateFormatter.format(new Date(`${value}T00:00:00+08:00`));
}
