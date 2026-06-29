import { Clock, ExternalLink, MapPin, Navigation, ShieldCheck, Star } from "lucide-react";

import type { SavedTripItem, SharedTripPlan } from "@/server/trips/shared-trip-types";
import {
  AppBackdrop,
  appBodyClass,
  appCardClass,
  appPanelClass,
  appShellClass,
  BrandHeader,
  PalmMark,
} from "@/ui/components/ask-siargao";

type SharedItineraryPlan = Extract<SavedTripItem["payload"], { type: "itinerary_plan" }>["plan"];
type SharedItineraryStop = SharedItineraryPlan["stops"][number];

const sharedArticleClass = `${appPanelClass} grid min-w-0 gap-4`;
const sharedIconClass =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700";
const sharedSignalClass =
  "inline-flex max-w-full rounded-md border border-brand-lagoon-700/10 bg-brand-lagoon-100 px-2.5 py-1.5 text-xs font-extrabold text-brand-lagoon-700";
const appNightUnavailableClass =
  "grid max-w-xl justify-items-start gap-5 rounded-md border border-white/14 bg-surface-night-panel p-6 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-md";

export function SharedTripPlanPage({ plan }: { plan: SharedTripPlan | null }) {
  if (!plan) {
    return <SharedTripUnavailableState />;
  }

  return (
    <AppBackdrop aria-label="Shared Siargao trip plan" variant="sunset">
      <div className={`${appShellClass} max-w-5xl gap-8`}>
        <BrandHeader
          action={
            <span className="inline-flex shrink-0 items-center rounded-md border border-brand-lagoon-300/30 bg-brand-lagoon-500/16 px-3 py-2 text-xs font-extrabold text-brand-lagoon-100">
              Shared plan
            </span>
          }
        />

        <section className="grid min-w-0 gap-3 text-text-on-dark">
          <p className="m-0 text-xs font-extrabold tracking-[0.12em] text-brand-lagoon-300 uppercase">
            Ask Siargao
          </p>
          <h1 className="m-0 max-w-3xl text-balance font-heading text-4xl leading-[0.98] font-semibold text-[#fff9e9] sm:text-5xl">
            {plan.title}
          </h1>
          <p className="m-0 max-w-2xl text-sm leading-[1.7] font-bold text-text-on-dark-muted sm:text-base">
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
    </AppBackdrop>
  );
}

function SharedTripUnavailableState() {
  return (
    <AppBackdrop
      aria-label="Shared Siargao trip plan unavailable"
      className="grid place-items-center px-4"
      variant="sunset"
    >
      <section className={appNightUnavailableClass}>
        <PalmMark className="size-12" />
        <div className="grid gap-3">
          <h1 className="m-0 font-heading text-4xl leading-[1] font-semibold text-[#fff9e9]">
            Shared plan unavailable
          </h1>
          <p className="m-0 text-sm leading-[1.7] font-bold text-text-on-dark-muted sm:text-base">
            This shared Siargao plan cannot be opened. Ask the traveler for a fresh link.
          </p>
        </div>
      </section>
    </AppBackdrop>
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
    <article className={appCardClass}>
      <h2 className="m-0 text-lg font-black text-text-strong">{item.title}</h2>
      <p className={appBodyClass}>{item.payload.text}</p>
    </article>
  );
}

function SharedRecommendationItem({ item }: { item: SavedTripItem }) {
  if (item.payload.type !== "recommendation_card") {
    return null;
  }

  const card = item.payload.card;
  return (
    <article className={sharedArticleClass} data-testid="shared-trip-card">
      <div className="flex min-w-0 items-start gap-3">
        <div className={sharedIconClass}>
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
    <article className={`${sharedArticleClass} gap-5`} data-testid="shared-trip-itinerary">
      <div className="flex min-w-0 items-start gap-3">
        <div className={sharedIconClass}>
          <Navigation aria-hidden="true" size={18} />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="m-0 text-lg leading-[1.2] font-black break-words text-text-strong">
            {plan.title}
          </h2>
          <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-brand-lagoon-700/10 bg-brand-lagoon-100 px-2.5 py-1 text-xs font-extrabold text-brand-lagoon-700">
            <Clock aria-hidden="true" className="shrink-0" size={13} />
            <span className="min-w-0 break-words">{plan.durationLabel}</span>
          </span>
        </div>
      </div>

      <ItineraryStopList stops={plan.stops} testId="shared-trip-itinerary-stops" />

      {plan.fallbackStops.length ? (
        <section className="grid gap-3" data-testid="shared-trip-itinerary-fallbacks">
          <h3 className="m-0 text-xs font-black text-text-strong">Fallbacks</h3>
          <ItineraryStopList stops={plan.fallbackStops} />
        </section>
      ) : null}
      {plan.skip.length ? <PlanNoteSection items={plan.skip} title="Skip" /> : null}
      <SourceSummaryList sources={plan.sources} />
    </article>
  );
}

function ItineraryStopList({
  stops,
  testId,
}: {
  stops: readonly SharedItineraryStop[];
  testId?: string;
}) {
  return (
    <ol className="m-0 grid gap-4 p-0" data-testid={testId}>
      {stops
        .toSorted((first, second) => first.sequence - second.sequence)
        .map((stop) => (
          <li
            className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3"
            key={`${stop.sequence}-${stop.title}`}
          >
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-brand-lagoon-100 text-xs font-black text-brand-lagoon-700">
              {stop.sequence}
            </span>
            <div className="grid min-w-0 gap-1.5">
              <h3 className="m-0 text-sm font-black break-words text-text-strong">{stop.title}</h3>
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
        <SharedSignalBadge key={label} label={label} />
      ))}
    </div>
  );
}

function SharedSignalBadge({ label }: { label: string }) {
  const Icon = sharedSignalIcon(label);

  return (
    <span className={`${sharedSignalClass} items-center gap-1.5`}>
      <Icon aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

function sharedSignalIcon(label: string) {
  if (/\bopen\b|\bhours?\b/i.test(label)) {
    return Clock;
  }
  if (/\bsource\b|\bchecked\b|\bguide\b/i.test(label)) {
    return ShieldCheck;
  }
  return MapPin;
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
  const visibleItems = publicDisplayCaveats(items);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 grid gap-1.5 rounded-md border border-[#e4d8b8] bg-[#fff9e8] px-4 py-3 text-xs leading-[1.45] text-[#66521c]">
      {visibleItems.map((item) => (
        <li className="break-words" key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function SourceSummaryList({ sources }: { sources: SharedTripPlan["items"][number]["sources"] }) {
  const visibleSources = sources.filter(isActuallyCheckedSource);
  if (visibleSources.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2" data-testid="shared-trip-sources">
      <h3 className="m-0 text-xs font-black text-text-strong">Sources</h3>
      <div className="flex flex-wrap gap-2">
        {visibleSources.map((source) => (
          <span
            className={`${sharedSignalClass} items-center gap-1.5`}
            key={`${source.label}-${source.sourceName}-${source.fetchedAt ?? "no-fetch"}`}
          >
            <SharedSourceIcon source={source} />
            <span className="min-w-0 break-words">{sharedSourceLabel(source)}</span>
          </span>
        ))}
      </div>
      <BulletList
        items={visibleSources.flatMap((source) =>
          source.checked.map((item) => `Checked by ${source.sourceName}: ${item}`),
        )}
      />
    </section>
  );
}

function SharedSourceIcon({
  source,
}: {
  source: SharedTripPlan["items"][number]["sources"][number];
}) {
  const Icon =
    source.label === "weather_checked"
      ? Clock
      : source.label === "curated_local_guide"
        ? Star
        : source.label === "marine_checked" || source.label === "tide_forecast_checked"
          ? Navigation
          : ShieldCheck;

  return <Icon aria-hidden="true" className="shrink-0" size={13} />;
}

function sharedSourceLabel(source: SharedTripPlan["items"][number]["sources"][number]) {
  return `${compactSourceName(source.sourceName)} - ${source.label.replaceAll("_", " ")}`;
}

function compactSourceName(value: string) {
  return value
    .replace(/\s+API(?:\s+profile)?$/i, "")
    .replace(/\s+profile$/i, "")
    .trim();
}

function isActuallyCheckedSource(source: SharedTripPlan["items"][number]["sources"][number]) {
  return source.label !== "not_verified" && source.label !== "provider_unavailable";
}

function publicDisplayCaveats(caveats: readonly string[]) {
  return caveats.filter((caveat) => !isInternalVerificationGap(caveat));
}

function isInternalVerificationGap(value: string) {
  return [
    /\bnot\s+checked\b/i,
    /\bwasn['’]?t\s+(?:separately\s+)?checked\b/i,
    /\bwere\s+not\s+checked\b/i,
    /\bno\s+live\b.{0,90}\bcheck\b/i,
    /\bunchecked\b/i,
    /\bnot\s+verified\b/i,
    /\bI\s+(?:didn['’]?t|did\s+not)\s+(?:live[-\s]?)?check\b/i,
    /\b(?:live[-\s]?)?check(?:ed|ing)?\s+(?:was|were|is|are)?\s*(?:not|needed|needs)\b/i,
    /\bcurated\s+local\s+guide\s+estimate\b/i,
    /\bexact\s+ride\s+time\s+depends\b/i,
    /\buser\s+constraints\s+preserved\b/i,
    /\borigin-specific\s+route\s+timing\b/i,
    /\bthis\s+artifact\b/i,
    /\bsource\s+caveats?\b/i,
    /\bavoid\s+overclaiming\b/i,
    /\buse\s+(?:search_places|places)\b/i,
    /\bplaces\s+evidence\b/i,
    /\b(?:open|opening|cafe|menu|booking|availability|crowd|quietness).{0,80}\bshould\s+be\s+checked\b/i,
    /\bclaim(?:ing)?\b.{0,80}\b(?:open|status|hours|safety|reliability)\b/i,
    /\bwithout\b.{0,80}\b(?:condition|safety|tide|surf|road).{0,40}\bcheck/i,
  ].some((pattern) => pattern.test(value));
}

function PlanNoteSection({ items, title }: { title: string; items: readonly string[] }) {
  const visibleItems = publicDisplayCaveats(items);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-xs font-black text-text-strong">{title}</h3>
      <BulletList items={visibleItems} />
    </section>
  );
}

function MapLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      aria-label={`Open ${title} in Google Maps`}
      className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-brand-lagoon-700/25 bg-white px-3 py-2 text-xs font-extrabold text-brand-lagoon-700 no-underline transition hover:bg-brand-lagoon-100"
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
