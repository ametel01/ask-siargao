import {
  ArrowRight,
  ChevronDown,
  CloudRain,
  Compass,
  CreditCard,
  Home,
  Info,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  Waves,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { projectCapabilityEvidencePresentation } from "@/features/chat/evidence-presentation-state";
import { tripPassPublicOffer } from "@/features/trip-pass/public-copy";
import { TripPassPricingTelemetry } from "@/features/trip-pass/TripPassPricingTelemetry";
import { cn } from "@/lib/utils";
import {
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";
import { appSurfaceInsetClass, appSurfacePanelClass } from "@/ui/components/ask-siargao";

const heroPrompt = "Given today's weather and tide, should we still go to Cloud 9?";
const landingPrimaryActionClass =
  "landing-primary-action min-h-11 rounded-lg px-4 text-sm font-semibold shadow-cta landing-focus-ring landing-focus-ring-strong focus-visible:outline-offset-3";

const navigationItems = [
  { label: "Example", href: "#example-reality-check" },
  { label: "Planning inputs", href: "#planning-inputs" },
  { label: "Plan smarter", href: "#plan-smarter" },
  { label: "Travel guides", href: "#travel-guides" },
  { label: "Trip Pass", href: "#trip-pass" },
] as const;

const tourismTopics = [
  {
    family: "guides",
    hubPath: "/guides",
    hubTitle: "Siargao planning guides",
    hubDescription:
      "Start with complete itineraries and first-timer guidance, then adapt the plan in chat.",
  },
  ...publicPageFamilies.map((family) => publicSurfaceRegistry[family]),
];

const quickChips = [
  {
    label: "Check a stay",
    prompt:
      "Reality-check this Siargao hotel before I book: is it a good fit for quiet sleep and no scooter?",
    icon: Home,
    tone: "lagoon",
  },
  {
    label: "Review a route",
    prompt: "Is this four-day Siargao itinerary actually feasible for a family without a scooter?",
    icon: Compass,
    tone: "coral",
  },
] as const;

const planningInputs = [
  {
    label: "Weather",
    evidence: projectCapabilityEvidencePresentation("Can check forecasts when asked"),
    icon: CloudRain,
    tone: "lagoon",
  },
  {
    label: "Places",
    evidence: projectCapabilityEvidencePresentation("Can check places when asked"),
    icon: MapPin,
    tone: "lagoon",
  },
  {
    label: "Local caveats",
    evidence: projectCapabilityEvidencePresentation("Can explain limits when relevant"),
    icon: Info,
    tone: "gold",
  },
] as const;

const planningCards: {
  title: string;
  body: string;
  prompt: string;
  icon: LucideIcon;
  tone: "lagoon" | "gold";
}[] = [
  {
    title: "Match a surf session",
    body: "Match ability, place, timing, tide, and modelled conditions while leaving exact-break safety to local confirmation.",
    prompt: "I am a beginner near Pacifico. Reality-check a surf session for tomorrow morning.",
    icon: Waves,
    tone: "lagoon",
  },
  {
    title: "Replace a disrupted plan",
    body: "Turn a cancellation, closure, downpour, or lost ride into one workable alternative for right now.",
    prompt: "Our island tour was cancelled. Give us a workable replacement in General Luna.",
    icon: CloudRain,
    tone: "gold",
  },
];

const realityCheckExampleSteps = [
  {
    title: "Your plan",
    body: "Cloud 9 today, with weather and tide in the decision.",
  },
  {
    title: "What gets checked",
    body: "Your trip details plus current conditions, when you ask.",
  },
  {
    title: "The bounded call",
    body: "Keep, change, avoid, or confirm locally.",
  },
  {
    title: "Your next move",
    body: "One practical action and what still needs checking.",
  },
] as const;

export function LandingPage() {
  return (
    <main
      className="min-h-screen overflow-x-clip bg-brand-navy-980 text-text-on-dark"
      id="main-content"
      tabIndex={-1}
    >
      <section
        aria-label="Ask Siargao landing page"
        className="relative isolate overflow-hidden bg-brand-navy-980"
      >
        <div className="relative z-10 mx-auto grid w-full max-w-[112rem] gap-6 px-5 pt-5 pb-0 sm:px-8 md:gap-10 md:px-10 md:pt-7 lg:px-12 lg:pt-8 xl:px-16 2xl:px-20">
          <Header />
          <div className="relative isolate grid min-w-0 gap-7 md:gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(25rem,0.92fr)] lg:items-stretch lg:gap-10 xl:gap-16">
            <Hero />
            <CoastalFrame />
          </div>
          <PlanningPanel />
          <TourismNavigation />
          <TripPassPricingSection />
        </div>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="flex min-h-16 items-center justify-between gap-4 lg:min-h-[4.75rem]">
      <Link
        aria-label="Ask Siargao home"
        className="min-w-0 rounded-md no-underline landing-focus-ring focus-visible:outline-offset-4"
        href="/"
      >
        <LandingBrand />
      </Link>

      <nav
        aria-label="Landing page"
        className="ml-auto hidden items-center rounded-full border border-border-on-dark bg-surface-night-card p-1 shadow-none backdrop-blur-md xl:flex"
      >
        {navigationItems.map(({ href, label }) => (
          <a
            className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-extrabold text-text-on-dark-muted no-underline transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-surface-night-card-strong hover:text-text-on-dark landing-focus-ring focus-visible:outline-offset-2 xl:px-5"
            href={href}
            key={href}
          >
            {label}
          </a>
        ))}
      </nav>

      <Button
        asChild
        className="min-h-12 shrink-0 rounded-xl border border-border-on-dark bg-surface-night-card px-4 text-sm font-semibold text-text-on-dark shadow-none backdrop-blur-md hover:border-border-on-dark-strong hover:bg-surface-night-card-strong landing-focus-ring focus-visible:outline-offset-3 sm:px-5"
        variant="outline"
      >
        <Link href="/chat">
          <MessageCircle aria-hidden="true" size={19} />
          <span className="hidden sm:inline">Ask in chat</span>
          <span className="sm:hidden">Chat</span>
        </Link>
      </Button>
    </header>
  );
}

function LandingBrand() {
  return (
    <span className="inline-flex min-w-0 items-center gap-3 text-text-on-dark sm:gap-4">
      <span className="relative inline-flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-text-on-dark bg-surface-night-card shadow-none backdrop-blur-sm sm:size-16 lg:size-[4.4rem]">
        <Image
          alt=""
          aria-hidden="true"
          className="size-[72%] object-contain"
          height={58}
          src="/ask_siargao_palm_icon.svg"
          width={58}
        />
      </span>
      <span className="min-w-0 font-heading text-2xl leading-none font-semibold whitespace-nowrap text-text-on-dark sm:text-3xl lg:text-4xl">
        Ask Siargao
      </span>
    </span>
  );
}

function Hero() {
  return (
    <section
      className="grid min-w-0 content-start gap-5 pt-3 md:gap-7 md:pt-10 lg:gap-6 lg:pt-10 xl:pt-16"
      id="example-reality-check"
    >
      <div className="grid min-w-0 gap-3">
        <h1 className="m-0 max-w-[12ch] min-w-0 text-balance font-heading text-[clamp(3rem,12.6vw,5.3rem)] leading-[0.92] font-semibold text-text-on-dark tracking-[-0.02em] [overflow-wrap:anywhere] md:max-w-[13ch] md:text-[clamp(5.3rem,10.5vw,7.6rem)] lg:text-[clamp(4.6rem,6.1vw,7.25rem)] 2xl:text-[7.6rem]">
          Live, local Siargao <span className="text-brand-lagoon-300">travel advice</span>
        </h1>
        <p className="m-0 max-w-[38ch] text-base leading-normal font-semibold text-text-on-dark-muted md:text-xl lg:max-w-[40ch] lg:text-lg xl:text-xl">
          Bring a hotel, itinerary, surf session, immediate plan, or disruption. Ask Siargao checks
          the relevant details when you ask, then returns a clear keep, change, or avoid call—plus
          what to confirm locally.
        </p>
      </div>
      <PromptComposer />
      <QuickChips />
      <PlanningInputs />
    </section>
  );
}

function PromptComposer() {
  return (
    <section
      aria-labelledby="example-reality-check-title"
      className={cn(
        appSurfacePanelClass,
        "grid gap-4 rounded-2xl px-5 py-5 sm:px-6 sm:py-6 lg:max-w-[48rem]",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <MessageCircle
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-brand-lagoon-700"
          size={26}
          strokeWidth={2}
        />
        <div className="grid min-w-0 gap-1">
          <h2
            className="m-0 font-heading text-xl leading-tight font-semibold text-text-strong sm:text-2xl"
            id="example-reality-check-title"
          >
            Example Reality Check
          </h2>
          <p className="m-0 text-sm leading-normal font-semibold text-text-muted">
            Opens chat with this example ready to review before you send it.
          </p>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 border-border-default border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="m-0 min-w-0 text-base leading-normal font-semibold text-text-muted sm:text-lg">
          “{heroPrompt}”
        </p>
        <Button asChild className={cn(landingPrimaryActionClass, "w-full sm:w-auto")}>
          <Link href={chatPromptHref(heroPrompt)}>
            <Send aria-hidden="true" size={19} />
            Try this example
          </Link>
        </Button>
      </div>
    </section>
  );
}

function QuickChips() {
  return (
    <section aria-label="Common trip constraints" className="flex flex-wrap items-center gap-3">
      {quickChips.map(({ icon: Icon, label, prompt, tone }) => (
        <Button
          asChild
          className="min-h-11 rounded-full border border-border-on-dark bg-surface-night-card px-5 text-sm font-semibold text-text-on-dark shadow-none backdrop-blur-md hover:border-border-on-dark-strong hover:bg-surface-night-card-strong landing-focus-ring focus-visible:outline-offset-3"
          key={label}
          variant="outline"
        >
          <Link href={chatPromptHref(prompt)}>
            <Icon
              aria-hidden="true"
              className={cn(tone === "coral" ? "text-brand-sunset-coral" : "text-brand-lagoon-300")}
              size={22}
              strokeWidth={2.1}
            />
            {label}
          </Link>
        </Button>
      ))}
    </section>
  );
}

function PlanningInputs() {
  return (
    <section
      aria-labelledby="planning-inputs-title"
      className="grid gap-3 rounded-2xl border border-border-on-dark bg-surface-night-card px-5 py-4 shadow-none backdrop-blur-md sm:grid-cols-3 sm:px-3 lg:max-w-[48rem]"
      id="planning-inputs"
    >
      <h2 className="sr-only" id="planning-inputs-title">
        Planning inputs available in chat
      </h2>
      <ul className="contents">
        {planningInputs.map(({ evidence, icon: Icon, label, tone }) => (
          <li
            className="flex min-w-0 items-center gap-3 sm:justify-center sm:border-border-on-dark sm:px-2 sm:not-last:border-r"
            key={label}
          >
            <Icon
              aria-hidden="true"
              className={tone === "gold" ? "text-brand-sunset-gold" : "text-brand-lagoon-300"}
              size={22}
              strokeWidth={2.1}
            />
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-sm leading-tight text-text-on-dark">{label}</strong>
              <span className="text-xs leading-tight font-semibold text-text-on-dark-muted">
                {evidence.summary}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoastalFrame() {
  return (
    <aside
      aria-label="A coastal view from Siargao"
      className="pointer-events-none absolute -inset-x-5 -top-5 bottom-0 -z-10 overflow-hidden sm:-inset-x-8 md:-inset-x-10 lg:pointer-events-auto lg:relative lg:inset-auto lg:z-auto lg:min-h-[39rem] lg:rounded-[2.25rem] lg:border lg:border-border-on-dark lg:shadow-coastal-frame"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="object-cover object-[72%_34%] lg:object-[58%_42%]"
        data-testid="responsive-hero-image"
        fill
        loading="eager"
        sizes="(min-width: 1536px) 42vw, (min-width: 1024px) 38vw, 100vw"
        src="/images/ask-siargao-mobile-hero-bg.png"
      />
      <div className="absolute inset-0 bg-[image:var(--gradient-landing-coastal-overlay)] lg:hidden" />
      <div className="absolute inset-0 hidden bg-gradient-to-t from-brand-navy-980/90 via-transparent to-brand-navy-980/10 lg:block" />
      <div className="absolute right-6 bottom-6 left-6 hidden rounded-2xl border border-border-on-dark bg-surface-dark-glass p-5 shadow-surface-panel backdrop-blur-md lg:block xl:right-8 xl:bottom-8 xl:left-8 xl:p-6">
        <p className="m-0 max-w-[31ch] text-balance font-heading text-2xl leading-tight font-semibold text-text-on-dark xl:text-3xl">
          One request, one evidence-backed call, one workable fallback at a time.
        </p>
      </div>
    </aside>
  );
}

function PlanningPanel() {
  return (
    <section
      aria-labelledby="plan-smarter-title"
      className={cn(
        appSurfacePanelClass,
        "-mx-5 mt-1 grid gap-6 rounded-t-2xl border-x-0 border-b-0 px-5 pt-6 pb-8 sm:-mx-8 sm:px-8 md:-mx-10 md:gap-8 md:px-10 md:pt-9 lg:mx-0 lg:mt-4 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:rounded-2xl lg:border lg:px-10 lg:py-10 xl:px-12",
      )}
      id="plan-smarter"
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 lg:sticky lg:top-6">
        <div className="inline-flex size-14 items-center justify-center rounded-full border border-border-default bg-surface-default text-brand-lagoon-700 shadow-none">
          <Compass aria-hidden="true" size={30} strokeWidth={1.9} />
        </div>
        <div className="grid min-w-0 gap-2">
          <h2
            className="m-0 min-w-0 text-balance font-heading text-2xl leading-none font-semibold text-text-strong sm:text-4xl lg:text-5xl"
            id="plan-smarter-title"
          >
            Reality-check a Siargao plan
          </h2>
          <p className="m-0 max-w-[38ch] text-base leading-normal font-normal text-text-muted">
            Ask when a choice matters. You get current evidence, local context, a practical next
            move, and a clear note on what still needs checking.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:gap-5">
        {planningCards.map(({ body, icon: Icon, prompt, title, tone }) => (
          <article
            className={cn(
              appSurfaceInsetClass,
              "grid min-w-0 content-start gap-4 rounded-xl p-5 lg:min-h-[17rem] lg:p-6",
              tone === "gold" ? "bg-confidence-medium-soft" : "bg-brand-lagoon-100",
            )}
            key={title}
          >
            <span
              className={cn(
                "inline-flex size-12 items-center justify-center rounded-full bg-surface-default",
                tone === "gold" ? "text-confidence-medium-foreground" : "text-brand-lagoon-700",
              )}
            >
              <Icon aria-hidden="true" size={27} strokeWidth={2} />
            </span>
            <div className="grid min-w-0 gap-2">
              <h3 className="m-0 min-w-0 text-balance font-heading text-2xl leading-none font-semibold text-text-strong [overflow-wrap:anywhere]">
                {title}
              </h3>
              <p className="m-0 text-base leading-normal font-normal text-text-muted">{body}</p>
            </div>
            <Link
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-700 no-underline hover:text-brand-lagoon-600 landing-focus-ring landing-focus-ring-strong focus-visible:outline-offset-3"
              href={chatPromptHref(prompt)}
            >
              Run this check
              <ArrowRight aria-hidden="true" size={20} strokeWidth={2.1} />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function TourismNavigation() {
  return (
    <section
      aria-labelledby="travel-guides-title"
      className="grid min-w-0 gap-6 border-border-on-dark border-t pt-8 md:gap-8 md:pt-10 lg:grid-cols-[minmax(18rem,0.62fr)_minmax(0,1.38fr)] lg:items-start"
      id="travel-guides"
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 lg:sticky lg:top-6">
        <span className="inline-flex size-14 items-center justify-center rounded-full border border-border-on-dark bg-surface-night-card text-brand-lagoon-300">
          <Compass aria-hidden="true" size={29} strokeWidth={1.9} />
        </span>
        <div className="grid min-w-0 gap-2">
          <h2
            className="m-0 max-w-[12ch] text-balance font-heading text-[clamp(2.35rem,8vw,4.1rem)] leading-[0.98] font-semibold text-text-on-dark"
            id="travel-guides-title"
          >
            Explore Siargao travel guides
          </h2>
          <p className="m-0 max-w-[39ch] text-base leading-normal font-semibold text-text-on-dark-muted">
            Browse published guidance by topic, then open any guide through a regular web link.
          </p>
        </div>
      </div>

      <nav aria-label="Siargao travel guide topics">
        <ul className="m-0 grid list-none border-border-on-dark border-y p-0">
          {tourismTopics.map((topic) => (
            <li className="border-border-on-dark border-t first:border-t-0" key={topic.family}>
              <Link
                className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-2 py-4 text-text-on-dark no-underline transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-surface-night-card landing-focus-ring focus-visible:outline-offset-2 sm:px-4"
                href={topic.hubPath}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="text-base font-extrabold sm:text-lg">{topic.hubTitle}</span>
                  <span className="max-w-[68ch] text-sm leading-normal font-semibold text-text-on-dark-muted">
                    {topic.hubDescription}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="text-brand-lagoon-300 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  size={21}
                  strokeWidth={2.1}
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

function TripPassPricingSection() {
  return (
    <section
      aria-labelledby="trip-pass-title"
      className="grid min-w-0 gap-6 border-border-on-dark border-t px-0 pt-8 pb-10 md:gap-8 md:pt-10 lg:grid-cols-[minmax(18rem,0.62fr)_minmax(0,1.38fr)] lg:items-start lg:pb-14"
      id="trip-pass"
    >
      <TripPassPricingTelemetry />
      <div className="grid min-w-0 gap-4 lg:sticky lg:top-6">
        <h2
          className="m-0 max-w-[12ch] text-balance font-heading text-[clamp(2.35rem,8vw,4.1rem)] leading-[0.98] font-semibold text-text-on-dark"
          id="trip-pass-title"
        >
          One clear Siargao travel pass
        </h2>
        <p className="m-0 max-w-[39ch] text-base leading-normal font-semibold text-text-on-dark-muted">
          Start with 10 free on-demand travel answers. Upgrade when you want more reality checks
          throughout your trip.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild className={landingPrimaryActionClass}>
            <Link href={tripPassPublicOffer.links.chat}>
              <MessageCircle aria-hidden="true" size={18} />
              Start {tripPassPublicOffer.freeAnswerLimit} free answers
            </Link>
          </Button>
          <Button
            asChild
            className="min-h-11 rounded-lg border-border-on-dark bg-surface-night-card px-4 text-sm font-semibold text-text-on-dark shadow-none hover:bg-surface-night-card-strong landing-focus-ring focus-visible:outline-offset-3"
            variant="outline"
          >
            <Link href={tripPassPublicOffer.links.legal}>Read terms</Link>
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:gap-5">
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <OfferCard
            body={`${tripPassPublicOffer.freeAnswerLimit} Siargao travel answers over ${tripPassPublicOffer.freeWindowDays} days.`}
            icon={ShieldCheck}
            label="Free"
            title="Try the decision desk"
          />
          <OfferCard
            action={{
              href: tripPassPublicOffer.links.settings,
              label: "Get Trip Pass in settings",
            }}
            body={`${tripPassPublicOffer.paidAnswerLimit} Siargao travel answers for ${tripPassPublicOffer.durationDays} days.`}
            icon={CreditCard}
            label={tripPassPublicOffer.priceLabel}
            title={tripPassPublicOffer.headline}
          />
        </div>

        <section
          aria-labelledby="trip-pass-why-title"
          className="grid min-w-0 gap-3 rounded-2xl border border-border-on-dark bg-surface-night-card p-5 shadow-none backdrop-blur-md md:p-6"
        >
          <h3
            className="m-0 text-balance font-heading text-2xl leading-tight font-semibold text-text-on-dark"
            id="trip-pass-why-title"
          >
            From a real plan to one workable next move
          </h3>
          <p className="m-0 text-sm leading-normal font-semibold text-text-on-dark-muted">
            The Cloud 9 example shows the four parts of every Reality Check.
          </p>
          <ol
            aria-label="Four-step decision flow"
            className="m-0 grid list-none border-border-on-dark border-y p-0 md:grid-cols-2"
          >
            {realityCheckExampleSteps.map(({ body, title }, index) => (
              <li
                className={cn(
                  "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 border-border-on-dark border-t py-3 first:border-t-0",
                  index === 1 && "md:border-t-0",
                  index % 2 === 0 ? "md:pr-4" : "md:border-l md:pl-4",
                )}
                key={title}
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-sunset-gold/15 text-sm font-extrabold text-brand-sunset-gold">
                  {index + 1}
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="text-sm text-text-on-dark">{title}</strong>
                  <span className="text-sm leading-normal font-semibold text-text-on-dark-muted">
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <details className="group border-border-on-dark border-b">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-2 text-sm font-extrabold text-brand-lagoon-300 landing-focus-ring focus-visible:outline-offset-3">
              What may inform this check
              <ChevronDown
                aria-hidden="true"
                className="transition-transform group-open:rotate-180 motion-reduce:transition-none motion-reduce:group-open:rotate-0"
                size={18}
              />
            </summary>
            <div className="grid gap-2 border-border-on-dark border-t py-3 text-sm leading-normal font-semibold text-text-on-dark-muted">
              <p className="m-0">
                When relevant, Ask Siargao can use your trip context, governed local knowledge, and
                request-time weather, surf, Places, event, or public-web evidence.
              </p>
              <p className="m-0">
                It labels unavailable or stale evidence and does not guarantee exact surf-break
                safety, live availability, or future conditions.
              </p>
            </div>
          </details>
          <p className="m-0 max-w-[70ch] text-sm leading-normal font-semibold text-text-on-dark-muted">
            {`Checkout opens in signed-in settings when available. Your ${tripPassPublicOffer.durationDays}-day pass starts after payment is confirmed.`}
          </p>
          <div className="flex flex-wrap items-center gap-3 border-border-on-dark border-t pt-4">
            <Button asChild className={landingPrimaryActionClass}>
              <Link href={tripPassPublicOffer.links.settings}>
                Get Trip Pass in settings
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
            </Button>
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 no-underline landing-focus-ring focus-visible:outline-offset-3"
              href={tripPassPublicOffer.links.legal}
            >
              Trip Pass terms and refunds
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 no-underline landing-focus-ring focus-visible:outline-offset-3"
              href="/legal/privacy"
            >
              Privacy notice
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}

function OfferCard({
  action,
  body,
  icon: Icon,
  label,
  title,
}: {
  action?: {
    href: string;
    label: string;
  };
  body: string;
  icon: LucideIcon;
  label: string;
  title: string;
}) {
  return (
    <article className="grid min-w-0 content-start gap-4 rounded-2xl border border-border-on-dark bg-surface-night-card p-5 shadow-none backdrop-blur-md md:p-6">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-brand-lagoon-100 text-brand-lagoon-700">
          <Icon aria-hidden="true" size={24} strokeWidth={2} />
        </span>
        <span className="rounded-md border border-brand-sunset-gold/55 bg-brand-sunset-gold/15 px-3 py-1 text-sm font-extrabold text-brand-sunset-gold">
          {label}
        </span>
      </div>
      <div className="grid min-w-0 gap-2">
        <h3 className="m-0 text-balance font-heading text-2xl leading-tight font-semibold text-text-on-dark">
          {title}
        </h3>
        <p className="m-0 text-sm leading-normal font-semibold text-text-on-dark-muted">{body}</p>
      </div>
      {action ? (
        <Button asChild className={cn(landingPrimaryActionClass, "mt-auto w-full")}>
          <Link href={action.href}>
            {action.label}
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </Button>
      ) : null}
    </article>
  );
}

function chatPromptHref(prompt: string) {
  return `/chat?prompt=${encodeURIComponent(prompt)}`;
}
