import { Clock, ExternalLink, MapPin, Navigation } from "lucide-react";

import type { SavedTripItem, SharedTripPlan } from "@/server/trips/shared-trip-types";
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

export function SharedTripPlanPage({ plan }: { plan: SharedTripPlan | null }) {
  if (!plan) {
    return <SharedTripUnavailableState />;
  }

  return (
    <main
      aria-label="Shared Siargao trip plan"
      className="min-h-screen bg-[linear-gradient(135deg,#f7fbf8_0%,#eef7f1_48%,#f7f1e4_100%)] text-text-default"
    >
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex min-w-0 items-center justify-between gap-4 border-[#14624a]/12 border-b pb-5">
          <BrandLockup className="[&_span:first-child]:text-text-strong [&_span:last-child]:text-text-strong" />
          <span className="inline-flex shrink-0 items-center rounded-md border border-[#14624a]/18 bg-white/70 px-3 py-2 text-xs font-extrabold text-[#14624a]">
            Shared plan
          </span>
        </header>

        <section className="grid min-w-0 gap-3">
          <p className="m-0 text-xs font-extrabold tracking-[0.08em] text-[#14624a] uppercase">
            Ask Siargao
          </p>
          <h1 className="m-0 max-w-3xl text-3xl leading-[1.05] font-black text-text-strong sm:text-5xl">
            {plan.title}
          </h1>
          <p className="m-0 max-w-2xl text-sm leading-[1.7] text-text-soft sm:text-base">
            Selected saved recommendations and itinerary stops only. Full chat history is not part
            of this shared page.
          </p>
        </section>

        <section className="grid gap-4" data-testid="shared-trip-items">
          {plan.items.map((item) => (
            <SharedTripItem item={item} key={item.id} />
          ))}
        </section>
      </div>
    </main>
  );
}

function SharedTripUnavailableState() {
  return (
    <main
      aria-label="Shared Siargao trip plan unavailable"
      className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,#f7fbf8_0%,#eef7f1_48%,#f7f1e4_100%)] px-4 text-text-default"
    >
      <section className="grid max-w-xl justify-items-start gap-5">
        <PalmMark className="size-12" />
        <div className="grid gap-3">
          <h1 className="m-0 text-3xl leading-[1.1] font-black text-text-strong sm:text-4xl">
            Shared plan unavailable
          </h1>
          <p className="m-0 text-sm leading-[1.7] text-text-soft sm:text-base">
            This shared Siargao plan cannot be opened. Ask the traveler for a fresh link.
          </p>
        </div>
      </section>
    </main>
  );
}

function SharedTripItem({ item }: { item: SavedTripItem }) {
  if (item.payload.type === "itinerary_plan") {
    return <SharedItineraryItem item={item} />;
  }

  if (item.payload.type === "recommendation_card") {
    return <SharedRecommendationItem item={item} />;
  }

  return (
    <article className="grid min-w-0 gap-2 rounded-lg border border-[#14624a]/12 bg-white/82 p-4 shadow-[0_16px_44px_rgba(22,60,49,0.08)]">
      <h2 className="m-0 text-lg font-black text-text-strong">{item.title}</h2>
      <p className="m-0 text-sm leading-[1.6] text-text-default">{item.payload.text}</p>
    </article>
  );
}

function SharedRecommendationItem({ item }: { item: SavedTripItem }) {
  if (item.payload.type !== "recommendation_card") {
    return null;
  }

  const card = item.payload.card;
  return (
    <article
      className="grid min-w-0 gap-4 rounded-lg border border-[#14624a]/12 bg-white/86 p-4 shadow-[0_16px_44px_rgba(22,60,49,0.08)]"
      data-testid="shared-trip-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[#d8f1e6] text-[#14624a]">
          {card.kind === "beach" ? (
            <Navigation aria-hidden="true" size={18} />
          ) : (
            <MapPin aria-hidden="true" size={18} />
          )}
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="m-0 text-lg leading-[1.2] font-black break-words text-text-strong">
            {card.title}
          </h2>
          {card.subtitle ? (
            <p className="m-0 text-sm leading-[1.5] break-words text-text-soft">{card.subtitle}</p>
          ) : null}
        </div>
      </div>

      <SignalList labels={[card.distanceLabel, card.openStatusLabel, card.sourceLabel]} />
      <BulletList items={card.fitReasons} />
      <CaveatList items={card.caveats} />
      <SourceSummaryList sources={item.sources} />
      {card.mapsUrl ? <MapLink href={card.mapsUrl} title={card.title} /> : null}
    </article>
  );
}

function SharedItineraryItem({ item }: { item: SavedTripItem }) {
  if (item.payload.type !== "itinerary_plan") {
    return null;
  }

  const plan = item.payload.plan;
  return (
    <article
      className="grid min-w-0 gap-5 rounded-lg border border-[#14624a]/12 bg-white/86 p-4 shadow-[0_16px_44px_rgba(22,60,49,0.08)]"
      data-testid="shared-trip-itinerary"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[#d8f1e6] text-[#14624a]">
          <Navigation aria-hidden="true" size={18} />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="m-0 text-lg leading-[1.2] font-black break-words text-text-strong">
            {plan.title}
          </h2>
          <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-[#14624a]/10 bg-[#f7fbf8] px-2.5 py-1 text-xs font-extrabold text-text-soft">
            <Clock aria-hidden="true" className="shrink-0" size={13} />
            <span className="min-w-0 break-words">{plan.durationLabel}</span>
          </span>
        </div>
      </div>

      <ol className="m-0 grid gap-4 p-0" data-testid="shared-trip-itinerary-stops">
        {plan.stops
          .toSorted((first, second) => first.sequence - second.sequence)
          .map((stop) => (
            <li className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3" key={stop.title}>
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-[#ecf5f0] text-xs font-black text-[#14624a]">
                {stop.sequence}
              </span>
              <div className="grid min-w-0 gap-1.5">
                <h3 className="m-0 text-sm font-black break-words text-text-strong">
                  {stop.title}
                </h3>
                {stop.area ? (
                  <p className="m-0 text-xs font-extrabold text-text-soft">{stop.area}</p>
                ) : null}
                <p className="m-0 text-sm leading-[1.55] break-words text-text-default">
                  {stop.rationale}
                </p>
                <CaveatList items={stop.caveats} />
                {stop.mapsUrl ? <MapLink href={stop.mapsUrl} title={stop.title} /> : null}
              </div>
            </li>
          ))}
      </ol>

      {plan.fallbackStops.length ? (
        <PlanNoteSection
          items={plan.fallbackStops.map((stop) => [stop.title, stop.rationale].join(" - "))}
          title="Fallbacks"
        />
      ) : null}
      {plan.skip.length ? <PlanNoteSection items={plan.skip} title="Skip" /> : null}
      <SourceSummaryList sources={plan.sources} />
    </article>
  );
}

function SignalList({ labels }: { labels: Array<string | undefined> }) {
  const values = labels.filter((label): label is string => Boolean(label));
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {values.map((label) => (
        <span
          className="inline-flex max-w-full rounded-md border border-[#14624a]/10 bg-[#f7fbf8] px-2.5 py-1.5 text-xs font-extrabold text-text-soft"
          key={label}
        >
          <span className="min-w-0 break-words">{label}</span>
        </span>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 grid gap-1.5 pl-4 text-sm leading-[1.5] text-text-default">
      {items.map((item) => (
        <li className="break-words" key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function CaveatList({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 grid gap-1.5 rounded-md border border-[#e4d8b8] bg-[#fff9e8] px-4 py-3 text-xs leading-[1.45] text-[#66521c]">
      {items.map((item) => (
        <li className="break-words" key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function SourceSummaryList({ sources }: { sources: SharedTripPlan["items"][number]["sources"] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2" data-testid="shared-trip-sources">
      <h3 className="m-0 text-xs font-black text-text-strong">Sources</h3>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <span
            className="inline-flex max-w-full rounded-md border border-[#14624a]/10 bg-[#f7fbf8] px-2.5 py-1.5 text-xs font-extrabold text-text-soft"
            key={`${source.label}-${source.sourceName}-${source.fetchedAt ?? "no-fetch"}`}
          >
            <span className="min-w-0 break-words">
              {source.sourceName} - {source.label.replaceAll("_", " ")}
              {source.fetchedAt ? ` - fetched ${source.fetchedAt}` : ""}
            </span>
          </span>
        ))}
      </div>
      <BulletList
        items={sources.flatMap((source) =>
          source.notChecked.map((item) => `Not checked by ${source.sourceName}: ${item}`),
        )}
      />
    </section>
  );
}

function PlanNoteSection({ items, title }: { title: string; items: readonly string[] }) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-xs font-black text-text-strong">{title}</h3>
      <BulletList items={items} />
    </section>
  );
}

function MapLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      aria-label={`Open ${title} in Google Maps`}
      className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-[#14624a]/25 bg-white px-3 py-2 text-xs font-extrabold text-[#14624a] no-underline hover:bg-[#edf8f2]"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <MapPin aria-hidden="true" className="shrink-0" size={15} />
      <span className="min-w-0 break-words">Open map</span>
      <ExternalLink aria-hidden="true" className="shrink-0" size={14} />
    </a>
  );
}
