import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  Car,
  CloudRain,
  CloudSun,
  Compass,
  Globe2,
  type LucideIcon,
  MapPinned,
  Menu,
  Plus,
  Send,
  Sparkles,
  TreePalm,
  Utensils,
  Waves,
  Wind,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";
import { GradientLink, SignalBadge } from "@/ui/components/ask-siargao";

const tripModeItems = [
  { label: "Stay fit", href: "#where-to-stay" },
  { label: "Rain plan", href: "#weather" },
  { label: "Save route", href: "#saved-places" },
];

const weatherRows: {
  label: string;
  value: string;
  icon: LucideIcon;
}[] = [
  { label: "Forecast", value: "Ask in chat", icon: CloudSun },
  { label: "Rain planning", value: "Open-Meteo", icon: CloudRain },
  { label: "Wind planning", value: "Snapshot", icon: Wind },
  { label: "Data status", value: "Caveated in chat", icon: Waves },
];

const examplePrompt =
  "Staying near Cloud 9 for 10 days with quiet sleep, surfing, good restaurants, and easy airport transfer. What should we know?";

const suggestionChips = [
  {
    label: "Cloud 9 quiet sleep",
    prompt: "Is my accommodation near Cloud 9 quiet enough for sleep?",
    icon: BedDouble,
  },
  {
    label: "Dinner near the break",
    prompt: "What are the best restaurants near Cloud 9 tonight?",
    icon: Utensils,
  },
  {
    label: "Airport to General Luna",
    prompt: "What is the easiest airport transfer option to General Luna?",
    icon: Car,
  },
  {
    label: "Weekend events",
    prompt: "What parties or events are worth checking this weekend in Siargao?",
    icon: CalendarDays,
  },
  {
    label: "Weather-adjusted plan",
    prompt: "How should Siargao weather change our plans today?",
    icon: CloudSun,
  },
];

const trustItems = [
  ["GPT-backed answers", Globe2],
  ["No booking bias", Compass],
  ["Weather snapshot support", Sparkles],
];

const planningTasks = [
  {
    icon: MapPinned,
    title: "Choose the right base",
    signal: "Area fit",
    body: "Compare Cloud 9, General Luna, Catangnan, Pacifico, and ferry timing against how you actually want to spend the day.",
    prompt:
      "Where should we stay in Siargao if we want quiet sleep, surf access, and easy dinner options?",
    rows: ["Sleep noise", "Surf access", "Dinner radius"],
    className: "md:col-span-5 md:row-span-2",
  },
  {
    icon: CloudSun,
    title: "Make the weather call",
    signal: "Open-Meteo caveats",
    body: "Turn a rainy or windy forecast into an indoor fallback, exposed-road warning, or beach timing check.",
    prompt: "Build a Siargao plan for today that adapts if rain gets heavy around Cloud 9.",
    rows: ["Rain window", "Wind exposure", "Fallback stop"],
    className: "md:col-span-7",
  },
  {
    icon: Utensils,
    title: "Stack food around the route",
    signal: "Place checks",
    body: "Ask for breakfast, coffee, dinner, or party stops in the same route instead of a generic list.",
    prompt:
      "Plan coffee, dinner, and a low-key drink around General Luna without a long scooter loop.",
    rows: ["Open status", "Map link", "Budget fit"],
    className: "md:col-span-4",
  },
  {
    icon: Car,
    title: "Keep transfers realistic",
    signal: "Route friction",
    body: "Pressure-test airport, ferry, scooter, tricycle, and van assumptions before the itinerary gets too tight.",
    prompt:
      "Check if our airport transfer and first-night dinner plan in General Luna is realistic.",
    rows: ["Arrival time", "Vehicle choice", "Backup move"],
    className: "md:col-span-3",
  },
];

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-brand-navy-980">
      <section
        aria-label="Ask Siargao landing page"
        className={cn(
          "relative min-h-screen w-full overflow-hidden bg-[image:var(--gradient-hero-overlay),linear-gradient(180deg,rgba(5,8,42,0.05)_0%,rgba(6,47,53,0.16)_42%,rgba(5,8,42,0.86)_100%),url('/images/hero-bg.png')] bg-[position:center_center,center_center,center_center] bg-[size:100%_100%,100%_100%,cover] bg-no-repeat shadow-coastal-frame",
          "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[image:radial-gradient(circle_at_62%_26%,rgba(255,155,131,0.08),transparent_23rem),radial-gradient(circle_at_86%_14%,rgba(142,230,216,0.1),transparent_21rem)] before:content-['']",
        )}
      >
        <div className="relative z-2 flex min-h-screen w-full flex-col px-[clamp(1.25rem,5vw,5.5rem)]">
          <Header />
          <Hero />
          <SuggestionChips />
          <TrustRow />
          <PlanningWorkbench />
        </div>
      </section>
      <MobileFooter />
    </main>
  );
}

function Header() {
  return (
    <header className="flex min-h-[80px] items-center justify-between gap-5 pt-1 lg:pt-0">
      <Link className="no-underline" href="/">
        <LandingBrand />
      </Link>
      <NavigationMenu className="ml-auto hidden min-[900px]:flex" viewport={false}>
        <NavigationMenuList className="rounded-full border border-border-on-dark bg-surface-night-card px-2 py-1 backdrop-blur-md">
          {tripModeItems.map((item) => (
            <NavigationMenuItem key={item.label}>
              <NavigationMenuLink asChild>
                <a
                  className="rounded-full px-3 py-2 text-xs font-extrabold text-text-on-dark-muted no-underline transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-surface-night-card-strong hover:text-text-on-dark focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-brand-lagoon-300 xl:text-sm"
                  href={item.href}
                >
                  {item.label}
                </a>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
      <Button
        asChild
        className="hidden min-h-[46px] rounded-full border-border-on-dark bg-surface-night-card px-4 text-xs font-extrabold text-text-on-dark hover:bg-surface-night-card-strong min-[900px]:inline-flex"
        variant="outline"
      >
        <Link href="/chat">
          <Send aria-hidden="true" size={15} /> Ask a trip question
        </Link>
      </Button>
      <GradientLink
        className="hidden min-h-[54px] shrink-0 rounded-lg px-6 md:inline-flex min-[900px]:hidden"
        href="/chat"
      >
        <Sparkles aria-hidden="true" size={17} /> Open assistant
      </GradientLink>
      <Button
        aria-label="Open navigation menu"
        asChild
        className="inline-flex size-10 border border-white/25 bg-white/10 text-text-on-dark hover:bg-white/15 md:hidden"
        size="icon"
        variant="outline"
      >
        <Link href="/chat">
          <Menu aria-hidden="true" size={20} />
        </Link>
      </Button>
    </header>
  );
}

function LandingBrand() {
  return (
    <span className="inline-flex items-center gap-4 text-text-on-dark">
      <span className="inline-flex size-12 items-center justify-center rounded-full border-2 border-text-on-dark text-text-on-dark shadow-night-card">
        <TreePalm aria-hidden="true" size={30} strokeWidth={2.1} />
      </span>
      <span className="font-heading text-2xl leading-none font-bold md:text-3xl">Ask Siargao</span>
    </span>
  );
}

function Hero() {
  return (
    <section
      className="grid content-start gap-4 pt-7 pb-3 md:pt-7 md:pb-4 xl:gap-3"
      id="how-it-works"
    >
      <div className="max-w-[620px] self-start">
        <h1 className="m-0 text-balance font-heading text-[3.35rem] leading-[0.88] font-semibold text-text-on-dark sm:text-[4.35rem] md:text-[5rem] xl:text-[6rem]">
          Ask Siargao
          <br />
          anything about
          <br />
          <span className="font-semibold text-brand-lagoon-300">your trip.</span>
        </h1>
        <p className="mt-4 mb-0 max-w-[470px] text-sm leading-[1.45] font-bold text-text-on-dark-muted md:text-lg">
          GPT-backed answers for where to stay, what to do, how to get around, and how the
          configured weather snapshot could affect your plans.
        </p>
      </div>
      <div className="grid w-full max-w-[1118px] grid-cols-1 gap-4 self-start md:gap-6 min-[900px]:grid-cols-[minmax(0,785px)_309px]">
        <PromptCard />
        <WeatherCard />
      </div>
    </section>
  );
}

function PromptCard() {
  return (
    <Card
      aria-label="Example Ask Siargao prompt"
      className="relative grid min-h-[186px] gap-5 rounded-xl border-brand-lagoon-300/75 bg-white/97 p-5 text-text-default shadow-[0_0_0_1px_rgba(255,255,255,0.24),0_20px_56px_rgba(20,184,166,0.22)] md:p-6"
    >
      <CardContent className="grid gap-3 p-0">
        <div className="flex items-start gap-3">
          <Sparkles aria-hidden="true" className="shrink-0 text-brand-lagoon-700" />
          <p className="m-0 max-w-[520px] text-sm leading-[1.48] font-bold text-text-strong md:text-lg">
            {examplePrompt}
          </p>
        </div>
        <div className="flex w-full items-end gap-2 self-end">
          <Button
            aria-label="Add trip detail"
            className="size-10 border-[rgba(8,47,57,0.16)] bg-white text-brand-lagoon-700 hover:bg-brand-lagoon-100"
            size="icon"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" size={18} />
          </Button>
          <Button
            aria-label="Other source-backed local data is not connected yet"
            className="size-10 border-[rgba(8,47,57,0.16)] bg-white text-brand-lagoon-700 hover:bg-brand-lagoon-100"
            size="icon"
            type="button"
            variant="outline"
          >
            <Globe2 aria-hidden="true" size={18} />
          </Button>
          <GradientLink
            className="ml-auto min-h-12 rounded-lg px-8 whitespace-nowrap"
            href={chatPromptHref(examplePrompt)}
          >
            Ask Siargao <Send aria-hidden="true" size={16} />
          </GradientLink>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherCard() {
  return (
    <Card
      className="min-h-auto overflow-hidden rounded-xl border-brand-lavender-200/95 bg-white/96 p-0 text-text-default shadow-[0_20px_58px_rgba(8,8,38,0.24)] backdrop-blur-md min-[900px]:min-h-[193px]"
      id="weather"
    >
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border-default px-6 py-3">
          <h2 className="m-0 text-base font-extrabold text-text-strong">
            Planning checks for Siargao
          </h2>
        </div>
        <div className="grid">
          {weatherRows.map(({ icon: Icon, label, value }) => (
            <div
              className="grid min-h-[35px] grid-cols-[1.25rem_1fr_auto] items-center gap-3 px-6 text-xs text-text-muted"
              key={label}
            >
              <Icon aria-hidden="true" className="text-brand-lagoon-700" size={17} />
              <span>{label}</span>
              {label === "Data status" ? (
                <SignalBadge tone="medium">{value}</SignalBadge>
              ) : (
                <strong className="font-extrabold text-text-strong">{value}</strong>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestionChips() {
  return (
    <section className="w-full max-w-[1118px] pb-3 md:pb-4" id="where-to-stay">
      <p className="mt-0 mb-3 text-xs font-extrabold text-brand-lavender-200/85">
        Start with a real trip constraint
      </p>
      <div className="flex flex-wrap gap-3">
        {suggestionChips.map(({ icon: Icon, label, prompt }) => (
          <Button
            asChild
            className="min-h-9 rounded-full border border-brand-lavender-400/65 bg-brand-navy-980/36 px-5 text-xs font-bold text-white/92 shadow-[0_10px_30px_rgba(0,0,0,0.16)] hover:bg-brand-navy-900/60 hover:text-white"
            key={label}
            variant="outline"
          >
            <Link href={chatPromptHref(prompt)}>
              <Icon aria-hidden="true" size={15} />
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </section>
  );
}

function TrustRow() {
  return (
    <section
      className="mx-auto flex w-full max-w-[970px] flex-wrap items-center justify-center gap-3 px-5 py-2 md:gap-0 md:py-2"
      id="saved-places"
    >
      {trustItems.map(([label, Icon]) => (
        <div
          className="inline-flex items-center gap-2 px-2 text-xs font-extrabold text-white/88 not-last:md:border-r not-last:md:border-white/22 md:px-12 [&_svg]:text-brand-lagoon-300"
          key={label as string}
        >
          <Icon aria-hidden="true" size={18} />
          <span>{label as string}</span>
        </div>
      ))}
    </section>
  );
}

function PlanningWorkbench() {
  return (
    <section
      aria-label="Ask Siargao trip planning workbench"
      className="grid grid-cols-1 gap-3 pt-3 pb-6 md:grid-cols-12 md:gap-4 md:pt-2 md:pb-5"
    >
      {planningTasks.map(({ body, className, icon: Icon, prompt, rows, signal, title }) => (
        <Card
          className={cn(
            "min-h-0 rounded-xl border border-border-on-dark bg-surface-glass p-4 text-text-default shadow-card transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-brand-paper-100 md:p-5",
            className,
          )}
          key={title}
        >
          <CardContent className="grid gap-3 p-0">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h2 className="m-0 text-lg leading-tight font-extrabold text-text-strong">{title}</h2>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-lagoon-700/10 bg-brand-lagoon-100 px-2 py-1 text-[0.68rem] font-black text-brand-lagoon-700">
                <Icon aria-hidden="true" size={13} />
                {signal}
              </span>
            </div>
            <p className="m-0 text-sm leading-[1.55] text-text-muted">{body}</p>
            <div className="flex flex-wrap gap-2">
              {rows.map((row) => (
                <span
                  className="rounded-md border border-border-default bg-surface-soft px-2 py-1 text-xs font-bold text-text-muted"
                  key={row}
                >
                  {row}
                </span>
              ))}
            </div>
            <Link
              className="inline-flex w-fit items-center gap-1 text-sm font-extrabold text-brand-lagoon-700 no-underline"
              href={chatPromptHref(prompt)}
            >
              Ask about this <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function MobileFooter() {
  return (
    <p className="m-0 block pt-1 pb-2 text-center text-xs font-extrabold text-white/70 md:hidden">
      Built for travelers · Loved by locals
    </p>
  );
}

function chatPromptHref(prompt: string) {
  return `/chat?prompt=${encodeURIComponent(prompt)}`;
}
