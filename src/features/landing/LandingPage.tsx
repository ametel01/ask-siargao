import {
  ArrowRight,
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
import { tripPassDifferentiators, tripPassPublicOffer } from "@/features/trip-pass/public-copy";
import { TripPassPricingTelemetry } from "@/features/trip-pass/TripPassPricingTelemetry";
import { cn } from "@/lib/utils";
import { appSurfaceInsetClass, appSurfacePanelClass } from "@/ui/components/ask-siargao";

const heroPrompt = "Given today's weather and tide, should we still go to Cloud 9?";

const navigationItems = [
  { label: "Start a question", href: "#start-a-question" },
  { label: "Planning inputs", href: "#planning-inputs" },
  { label: "Plan smarter", href: "#plan-smarter" },
  { label: "Trip Pass", href: "#trip-pass" },
] as const;

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
    body: "Match ability, place, timing, tide, and modelled conditions while keeping exact-break safety with local eyes.",
    prompt: "I am a beginner near Pacifico. Reality-check a surf session for tomorrow morning.",
    icon: Waves,
    tone: "lagoon",
  },
  {
    title: "Replace a disrupted plan",
    body: "Turn a cancellation, closure, downpour, or lost ride into one workable request-time alternative.",
    prompt: "Our island tour was cancelled. Give us a workable replacement in General Luna.",
    icon: CloudRain,
    tone: "gold",
  },
];

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-brand-navy-980 text-text-on-dark">
      <section
        aria-label="Ask Siargao landing page"
        className="relative isolate overflow-hidden bg-brand-navy-980"
      >
        <div className="pointer-events-none absolute inset-0 z-0 lg:hidden">
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover object-[72%_34%]"
            fill
            priority
            sizes="(min-width: 1024px) 0px, 100vw"
            src="/images/ask-siargao-mobile-hero-bg.png"
          />
          <div className="absolute inset-0 bg-[image:var(--gradient-landing-coastal-overlay)]" />
        </div>

        <div className="relative z-10 mx-auto grid w-full max-w-[112rem] gap-6 px-5 pt-5 pb-0 sm:px-8 md:gap-10 md:px-10 md:pt-7 lg:px-12 lg:pt-8 xl:px-16 2xl:px-20">
          <Header />
          <div className="grid min-w-0 gap-7 md:gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(25rem,0.92fr)] lg:items-stretch lg:gap-10 xl:gap-16">
            <Hero />
            <CoastalFrame />
          </div>
          <PlanningPanel />
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
        className="ml-auto hidden items-center rounded-full border border-border-on-dark bg-surface-night-card p-1 shadow-none backdrop-blur-md lg:flex"
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
      <span className="min-w-0 font-heading text-[1.55rem] leading-none font-semibold whitespace-nowrap text-text-on-dark sm:text-[2rem] lg:text-[2.25rem]">
        Ask Siargao
      </span>
    </span>
  );
}

function Hero() {
  return (
    <section
      className="grid min-w-0 content-start gap-5 pt-3 md:gap-7 md:pt-10 lg:gap-6 lg:pt-10 xl:pt-16"
      id="start-a-question"
    >
      <div className="grid min-w-0 gap-3">
        <p className="m-0 text-xs font-semibold tracking-[0.18em] text-brand-sunset-gold uppercase md:text-sm">
          On-demand Siargao reality checks
        </p>
        <h1 className="m-0 max-w-[12ch] min-w-0 font-heading text-[clamp(3rem,12.6vw,5.3rem)] leading-[0.92] font-semibold text-text-on-dark tracking-[-0.02em] [overflow-wrap:anywhere] md:max-w-[13ch] md:text-[clamp(5.3rem,10.5vw,7.8rem)] lg:text-[clamp(4.6rem,6.1vw,7.25rem)] 2xl:text-[7.6rem]">
          Reality-check the island around your{" "}
          <span className="text-brand-lagoon-300">real constraints</span>
        </h1>
        <p className="m-0 max-w-[38ch] text-base leading-[1.42] font-semibold text-text-on-dark-muted md:text-xl lg:max-w-[40ch] lg:text-lg xl:text-xl">
          Bring a hotel, itinerary, surf session, immediate plan, or disruption. Ask Siargao checks
          it when you ask and returns a clear keep, change, avoid, or needs-confirmation call.
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
      aria-label="Example Ask Siargao prompt"
      className={cn(
        appSurfacePanelClass,
        "grid min-h-[7.15rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-2xl px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6 sm:px-6 sm:py-6 lg:max-w-[48rem]",
      )}
    >
      <MessageCircle
        aria-hidden="true"
        className="shrink-0 text-brand-lagoon-700"
        size={28}
        strokeWidth={2}
      />
      <p className="m-0 min-w-0 text-[0.94rem] leading-[1.35] font-semibold text-text-muted sm:text-lg lg:text-base xl:text-lg">
        {heroPrompt}
      </p>
      <div className="col-span-2 flex min-w-0 items-center border-border-default sm:col-span-1 sm:border-l sm:pl-6">
        <Button
          asChild
          className="min-h-11 w-full rounded-lg bg-[image:var(--gradient-cta)] px-4 text-sm font-semibold text-text-on-dark shadow-cta hover:shadow-cta landing-focus-ring landing-focus-ring-strong focus-visible:outline-offset-3 sm:w-auto"
        >
          <Link href={chatPromptHref(heroPrompt)}>
            <Send aria-hidden="true" size={19} />
            Ask Siargao
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
              <span className="text-[0.68rem] leading-tight font-semibold text-text-on-dark-muted">
                <span className="sr-only">{evidence.label}. </span>
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
      className="relative hidden min-h-[39rem] overflow-hidden rounded-[2.25rem] border border-border-on-dark shadow-coastal-frame lg:block"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="object-cover object-[58%_42%]"
        fill
        priority
        sizes="(min-width: 1536px) 42vw, (min-width: 1024px) 38vw, 0px"
        src="/images/ask-siargao-mobile-hero-bg.png"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-navy-980/90 via-transparent to-brand-navy-980/10" />
      <div className="absolute right-6 bottom-6 left-6 rounded-2xl border border-border-on-dark bg-surface-dark-glass p-5 shadow-surface-panel backdrop-blur-md xl:right-8 xl:bottom-8 xl:left-8 xl:p-6">
        <p className="m-0 text-xs font-semibold tracking-[0.16em] text-brand-sunset-gold uppercase">
          Siargao, in context
        </p>
        <p className="mt-2 mb-0 max-w-[31ch] font-heading text-2xl leading-tight font-semibold text-text-on-dark xl:text-3xl">
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
            className="m-0 min-w-0 font-heading text-[clamp(1.55rem,6vw,2.2rem)] leading-[1.04] font-semibold text-text-strong lg:text-[2.65rem]"
            id="plan-smarter-title"
          >
            Reality-check a Siargao plan
          </h2>
          <p className="m-0 max-w-[38ch] text-[0.94rem] leading-[1.42] font-medium text-text-muted lg:text-base">
            Ask when a choice matters. You get request-time evidence, local operating context, and
            an honest boundary around what remains uncertain.
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
                tone === "gold" ? "text-confidence-medium" : "text-brand-lagoon-700",
              )}
            >
              <Icon aria-hidden="true" size={27} strokeWidth={2} />
            </span>
            <div className="grid min-w-0 gap-2">
              <h3 className="m-0 min-w-0 font-heading text-[1.45rem] leading-[1.06] font-semibold text-text-strong [overflow-wrap:anywhere] lg:text-[1.7rem]">
                {title}
              </h3>
              <p className="m-0 text-[0.96rem] leading-[1.44] font-medium text-text-muted">
                {body}
              </p>
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

function TripPassPricingSection() {
  return (
    <section
      aria-labelledby="trip-pass-title"
      className="grid min-w-0 gap-6 border-border-on-dark border-t px-0 pt-8 pb-10 md:gap-8 md:pt-10 lg:grid-cols-[minmax(18rem,0.62fr)_minmax(0,1.38fr)] lg:items-start lg:pb-14"
      id="trip-pass"
    >
      <TripPassPricingTelemetry />
      <div className="grid min-w-0 gap-4 lg:sticky lg:top-6">
        <p className="m-0 text-xs font-semibold tracking-[0.18em] text-brand-sunset-gold uppercase">
          Free trial to Trip Pass
        </p>
        <h2
          className="m-0 max-w-[12ch] font-heading text-[clamp(2.35rem,8vw,4.1rem)] leading-[0.98] font-semibold text-text-on-dark"
          id="trip-pass-title"
        >
          One clear Siargao travel pass
        </h2>
        <p className="m-0 max-w-[39ch] text-base leading-[1.44] font-semibold text-text-on-dark-muted">
          Start with 10 free on-demand travel answers. Upgrade when you want more reality checks
          throughout your trip.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            asChild
            className="min-h-11 rounded-lg bg-[image:var(--gradient-cta)] px-4 text-sm font-semibold text-text-on-dark shadow-cta landing-focus-ring landing-focus-ring-strong focus-visible:outline-offset-3"
          >
            <Link href={tripPassPublicOffer.links.chat}>
              <MessageCircle aria-hidden="true" size={18} />
              Start free
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
            className="m-0 font-heading text-[1.55rem] leading-tight font-semibold text-text-on-dark"
            id="trip-pass-why-title"
          >
            Built for Siargao decisions, not generic destination prose
          </h3>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {tripPassDifferentiators.map((item) => (
              <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3" key={item}>
                <span className="mt-1 size-2 rounded-full bg-brand-sunset-gold" />
                <span className="text-sm leading-[1.45] font-semibold text-text-on-dark-muted">
                  {item}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs leading-[1.45] font-bold text-text-on-dark-muted">
            Checkout is available from signed-in settings only when launch configuration and
            approvals are complete. Stripe remains authoritative for the final charge.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 no-underline landing-focus-ring focus-visible:outline-offset-3"
              href={tripPassPublicOffer.links.settings}
            >
              Manage pass in settings
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-extrabold text-brand-lagoon-300 no-underline landing-focus-ring focus-visible:outline-offset-3"
              href={tripPassPublicOffer.links.legal}
            >
              Terms, privacy, and refunds
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}

function OfferCard({
  body,
  icon: Icon,
  label,
  title,
}: {
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
        <h3 className="m-0 font-heading text-[1.7rem] leading-tight font-semibold text-text-on-dark">
          {title}
        </h3>
        <p className="m-0 text-sm leading-[1.45] font-semibold text-text-on-dark-muted">{body}</p>
      </div>
    </article>
  );
}

function chatPromptHref(prompt: string) {
  return `/chat?prompt=${encodeURIComponent(prompt)}`;
}
