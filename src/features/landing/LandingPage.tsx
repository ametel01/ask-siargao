import {
  ArrowRight,
  CloudRain,
  Compass,
  Home,
  Info,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Send,
  Utensils,
  Waves,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const heroPrompt = "What should we do today if rain hits Cloud 9?";

const navigationItems = [
  { label: "Start a question", href: "#start-a-question" },
  { label: "Planning inputs", href: "#planning-inputs" },
  { label: "Plan smarter", href: "#plan-smarter" },
] as const;

const quickChips = [
  {
    label: "Quiet base",
    prompt:
      "Where should we stay in Siargao if we want quiet sleep, surf access, and easy dinner options?",
    icon: Waves,
    tone: "lagoon",
  },
  {
    label: "Food route",
    prompt:
      "Plan coffee, dinner, and a low-key drink around General Luna without a long scooter loop.",
    icon: Utensils,
    tone: "coral",
  },
] as const;

const planningInputs = [
  { label: "Weather", detail: "Checked on request", icon: CloudRain, tone: "lagoon" },
  { label: "Places", detail: "Checked on request", icon: MapPin, tone: "lagoon" },
  { label: "Local caveats", detail: "Added when relevant", icon: Info, tone: "gold" },
] as const;

const planningCards: {
  title: string;
  body: string;
  prompt: string;
  icon: LucideIcon;
  tone: "lagoon" | "gold";
}[] = [
  {
    title: "Choose the right base",
    body: "Compare sleep, surf access, dinner radius, and airport transfer ease.",
    prompt:
      "Where should we stay in Siargao if we want quiet sleep, surf access, and easy dinner options?",
    icon: Home,
    tone: "lagoon",
  },
  {
    title: "Make the weather call",
    body: "Turn forecast into a smarter plan with indoor fallbacks and timing advice.",
    prompt: "Build a Siargao plan for today that adapts if rain gets heavy around Cloud 9.",
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
        className="ml-auto hidden items-center rounded-full border border-border-on-dark bg-surface-night-card p-1 shadow-night-card backdrop-blur-md lg:flex"
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
        className="min-h-12 shrink-0 rounded-xl border border-border-on-dark bg-surface-night-card px-4 text-sm font-extrabold text-text-on-dark shadow-night-card backdrop-blur-md hover:border-border-on-dark-strong hover:bg-surface-night-card-strong landing-focus-ring focus-visible:outline-offset-3 sm:px-5"
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
      <span className="relative inline-flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-text-on-dark bg-surface-night-card shadow-night-card backdrop-blur-sm sm:size-16 lg:size-[4.4rem]">
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
        <p className="m-0 text-xs font-black tracking-[0.18em] text-brand-sunset-gold uppercase md:text-sm">
          Your island decision desk
        </p>
        <h1 className="m-0 max-w-[12ch] min-w-0 font-heading text-[clamp(3rem,12.6vw,5.3rem)] leading-[0.92] font-semibold text-text-on-dark tracking-[-0.02em] [overflow-wrap:anywhere] md:max-w-[13ch] md:text-[clamp(5.3rem,10.5vw,7.8rem)] lg:text-[clamp(4.6rem,6.1vw,7.25rem)] 2xl:text-[7.6rem]">
          Plan the island around your{" "}
          <span className="text-brand-lagoon-300">real constraints</span>
        </h1>
        <p className="m-0 max-w-[38ch] text-base leading-[1.42] font-semibold text-text-on-dark-muted md:text-xl lg:max-w-[40ch] lg:text-lg xl:text-xl">
          Ask about surf, sleep, food, transport, or weather. Get local, caveated answers that
          explain what still needs checking.
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
      className="grid min-h-[7.15rem] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-[1.55rem] border border-brand-paper-200 bg-brand-paper-50 px-5 py-4 text-text-default shadow-panel sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-6 sm:px-6 sm:py-6 lg:max-w-[48rem]"
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
          className="min-h-11 w-full rounded-lg bg-[image:var(--gradient-cta)] px-4 text-sm font-extrabold text-text-on-dark shadow-cta hover:shadow-lagoon-glow landing-focus-ring landing-focus-ring-strong focus-visible:outline-offset-3 sm:w-auto"
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
          className="min-h-11 rounded-full border border-border-on-dark bg-surface-night-card px-5 text-sm font-extrabold text-text-on-dark shadow-night-card backdrop-blur-md hover:border-border-on-dark-strong hover:bg-surface-night-card-strong landing-focus-ring focus-visible:outline-offset-3"
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
      className="grid gap-3 rounded-[1.35rem] border border-border-on-dark bg-surface-night-card px-5 py-4 shadow-night-card backdrop-blur-md sm:grid-cols-3 sm:px-3 lg:max-w-[48rem]"
      id="planning-inputs"
    >
      <h2 className="sr-only" id="planning-inputs-title">
        Planning inputs available in chat
      </h2>
      {planningInputs.map(({ detail, icon: Icon, label, tone }) => (
        <div
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
              {detail}
            </span>
          </span>
        </div>
      ))}
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
      <div className="absolute right-6 bottom-6 left-6 rounded-[1.5rem] border border-border-on-dark bg-surface-dark-glass p-5 shadow-night-card backdrop-blur-md xl:right-8 xl:bottom-8 xl:left-8 xl:p-6">
        <p className="m-0 text-xs font-black tracking-[0.16em] text-brand-sunset-gold uppercase">
          Siargao, in context
        </p>
        <p className="mt-2 mb-0 max-w-[31ch] font-heading text-2xl leading-tight font-semibold text-text-on-dark xl:text-3xl">
          One route, one weather window, one honest trade-off at a time.
        </p>
      </div>
    </aside>
  );
}

function PlanningPanel() {
  return (
    <section
      aria-labelledby="plan-smarter-title"
      className="-mx-5 mt-1 grid gap-6 rounded-t-[1.8rem] bg-brand-paper-50 px-5 pt-6 pb-8 text-text-default shadow-strong sm:-mx-8 sm:px-8 md:-mx-10 md:gap-8 md:px-10 md:pt-9 lg:mx-0 lg:mt-4 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:rounded-[2rem] lg:px-10 lg:py-10 xl:px-12"
      id="plan-smarter"
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 lg:sticky lg:top-6">
        <div className="inline-flex size-14 items-center justify-center rounded-full border border-border-default bg-surface-default text-brand-lagoon-700 shadow-card">
          <Compass aria-hidden="true" size={30} strokeWidth={1.9} />
        </div>
        <div className="grid min-w-0 gap-2">
          <h2
            className="m-0 min-w-0 font-heading text-[clamp(1.55rem,6vw,2.2rem)] leading-[1.04] font-semibold text-text-strong lg:text-[2.65rem]"
            id="plan-smarter-title"
          >
            Plan smarter in Siargao
          </h2>
          <p className="m-0 max-w-[38ch] text-[0.94rem] leading-[1.42] font-medium text-text-muted lg:text-base">
            Bring your real constraints. Ask Siargao can consult available tools and tell you what
            remains uncertain.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:gap-5">
        {planningCards.map(({ body, icon: Icon, prompt, title, tone }) => (
          <article
            className={cn(
              "grid min-w-0 content-start gap-4 rounded-[1.35rem] p-5 lg:min-h-[17rem] lg:p-6",
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
              Ask about this
              <ArrowRight aria-hidden="true" size={20} strokeWidth={2.1} />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function chatPromptHref(prompt: string) {
  return `/chat?prompt=${encodeURIComponent(prompt)}`;
}
