import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  Car,
  CloudSun,
  Compass,
  Globe2,
  MapPinned,
  Menu,
  Plus,
  Send,
  Sparkles,
  Utensils,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";
import { BrandLockup, GradientLink, SignalBadge } from "@/ui/components/ask-siargao";

const navItems = ["How it works", "Where to stay", "What's happening", "Weather", "Saved places"];

const weatherRows = [
  ["Forecast", "Partly cloudy"],
  ["Rain chance", "35%"],
  ["Wind", "18 km/h"],
  ["Freshness", "Updated 12 min ago"],
];

const suggestionChips = [
  ["quiet hotel?", BedDouble],
  ["best restaurants nearby", Utensils],
  ["airport transfer", Car],
  ["parties this weekend", CalendarDays],
  ["weather today", CloudSun],
];

const trustItems = [
  ["Live local data", Globe2],
  ["No booking bias", Compass],
  ["Freshness + confidence shown", Sparkles],
];

const featureCards = [
  {
    icon: MapPinned,
    title: "Find the right areas",
    body: "Compare Cloud 9, General Luna, Catangnan and more to match your vibe.",
    link: "Explore areas",
  },
  {
    icon: CloudSun,
    title: "Live weather updates",
    body: "Real-time conditions, rain chances, wind, and sea changes.",
    link: "Check weather",
  },
  {
    icon: Utensils,
    title: "Local food & drinks",
    body: "Curated spots and hidden gems for every craving and budget.",
    link: "See restaurants",
  },
  {
    icon: Car,
    title: "Get around easily",
    body: "Airport transfers, scooters, tricycles, and local tips that save time.",
    link: "Plan transport",
  },
];

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-brand-navy-980">
      <section
        aria-label="Ask Siargao landing page"
        className={cn(
          "relative min-h-screen w-full overflow-hidden border-0 bg-[image:linear-gradient(90deg,rgba(5,8,42,0.96)_0%,rgba(7,10,48,0.86)_34%,rgba(43,24,106,0.34)_62%,rgba(5,8,42,0.52)_100%),linear-gradient(180deg,rgba(5,8,42,0.04)_0%,rgba(5,8,42,0.2)_46%,rgba(5,8,42,0.9)_100%),url('/images/hero-bg.png')] bg-[size:100%_100%,100%_100%,cover] bg-center bg-no-repeat",
          "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[image:radial-gradient(circle_at_61%_27%,rgba(255,155,131,0.14),transparent_25rem),radial-gradient(circle_at_84%_18%,rgba(135,92,246,0.12),transparent_26rem)] before:content-['']",
        )}
      >
        <div className="relative z-2 mx-auto flex min-h-screen w-full max-w-[1680px] flex-col">
          <Header />
          <Hero />
          <SuggestionChips />
          <TrustRow />
          <FeatureCards />
        </div>
      </section>
      <MobileFooter />
    </main>
  );
}

function Header() {
  return (
    <header className="flex min-h-[72px] items-center justify-between gap-5 px-5 pt-2 md:min-h-[94px] md:px-9 md:pt-4 xl:px-11">
      <Link
        className="no-underline [&_span:last-child]:text-sm md:[&_span:last-child]:text-base"
        href="/"
      >
        <BrandLockup />
      </Link>
      <NavigationMenu className="ml-auto hidden min-[900px]:flex" viewport={false}>
        <NavigationMenuList className="gap-8">
          {navItems.map((item) => (
            <NavigationMenuItem key={item}>
              <NavigationMenuLink asChild>
                <a
                  className="text-xs font-extrabold text-white/75 no-underline transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:text-text-on-dark focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-brand-violet-400"
                  href={`#${slug(item)}`}
                >
                  {item}
                </a>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
      <GradientLink className="hidden shrink-0 md:inline-flex" href="/chat">
        Open assistant
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

function Hero() {
  return (
    <section
      className="grid flex-1 content-start gap-7 px-5 pt-5 pb-6 md:min-h-[calc(100vh-112px)] md:content-between md:gap-12 md:px-9 md:pt-8 md:pb-9 lg:pt-10 xl:px-11 xl:pb-11"
      id="how-it-works"
    >
      <div className="max-w-[700px] self-start">
        <h1 className="m-0 text-balance font-heading text-[3.25rem] leading-[0.88] font-semibold text-[#fff7df] sm:text-[4.25rem] md:text-[5.25rem] xl:text-[6.1rem]">
          Ask Siargao
          <br />
          anything about
          <br />
          <em className="font-semibold text-brand-violet-400 italic">your trip.</em>
        </h1>
        <p className="mt-5 mb-0 max-w-[420px] text-sm leading-[1.55] font-bold text-text-on-dark-muted md:text-base">
          Local answers for where to stay, what to do, how to get around, and what today's weather
          changes.
        </p>
      </div>
      <div className="grid w-full max-w-[1360px] grid-cols-1 gap-4 self-start md:gap-5 md:self-end xl:gap-6 min-[900px]:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
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
      className="relative grid min-h-[190px] gap-5 border-brand-violet-400/75 bg-white/95 p-5 text-text-default shadow-[0_0_0_1px_rgba(255,255,255,0.22),0_22px_68px_rgba(76,49,184,0.38)] md:min-h-[194px] md:p-6"
    >
      <CardContent className="grid gap-5 p-0">
        <div className="flex items-start gap-3">
          <Sparkles aria-hidden="true" className="shrink-0 text-brand-violet-550" />
          <p className="m-0 text-sm leading-[1.5] font-bold text-text-strong md:text-base">
            I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants,
            and easy airport transfer. What should we know?
          </p>
        </div>
        <ButtonGroup className="self-end">
          <Button
            aria-label="Add trip detail"
            className="size-10 border-[rgba(8,47,57,0.16)] bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            size="icon"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" size={18} />
          </Button>
          <Button
            aria-label="Browse local sources"
            className="size-10 border-[rgba(8,47,57,0.16)] bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            size="icon"
            type="button"
            variant="outline"
          >
            <Globe2 aria-hidden="true" size={18} />
          </Button>
          <GradientLink className="ml-auto min-h-10 px-3 whitespace-nowrap sm:px-4" href="/chat">
            Ask Siargao <Send aria-hidden="true" size={16} />
          </GradientLink>
        </ButtonGroup>
      </CardContent>
    </Card>
  );
}

function WeatherCard() {
  return (
    <Card
      className="min-h-auto overflow-hidden border-brand-lavender-200/95 bg-white/95 p-0 text-text-default shadow-[0_20px_58px_rgba(8,8,38,0.24)] backdrop-blur-md lg:min-h-[194px]"
      id="weather"
    >
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border-default p-4">
          <CloudSun aria-hidden="true" className="text-brand-violet-650" size={22} />
          <h2 className="m-0 text-base font-extrabold text-text-strong">Today in Siargao</h2>
        </div>
        <div className="grid">
          {weatherRows.map(([label, value]) => (
            <div
              className="flex min-h-[35px] items-center justify-between gap-3 px-4 text-xs text-text-muted"
              key={label}
            >
              <span>{label}</span>
              {label === "Freshness" ? (
                <SignalBadge tone="fresh">{value}</SignalBadge>
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
    <section className="px-5 pb-5 md:px-9 md:pb-5 xl:px-11" id="where-to-stay">
      <p className="mt-0 mb-3 text-xs font-extrabold text-brand-lavender-200/85">
        Try asking about...
      </p>
      <div className="flex flex-wrap gap-3 md:gap-4">
        {suggestionChips.map(([label, Icon]) => (
          <Button
            asChild
            className="min-h-9 rounded-full border border-brand-lavender-400/55 bg-brand-navy-980/40 px-4 text-xs font-bold text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.16)] hover:bg-brand-navy-900/60 hover:text-white"
            key={label as string}
            variant="outline"
          >
            <Link href="/chat">
              <Icon aria-hidden="true" size={15} />
              {label as string}
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
      className="mx-5 flex flex-wrap items-center justify-center gap-3 border-t border-white/10 py-4 md:mx-9 md:gap-0 md:py-5 xl:mx-11"
      id="saved-places"
    >
      {trustItems.map(([label, Icon]) => (
        <div
          className="inline-flex items-center gap-2 px-2 text-xs font-extrabold text-white/85 not-last:md:border-r not-last:md:border-white/20 md:px-6 [&_svg]:text-brand-violet-400"
          key={label as string}
        >
          <Icon aria-hidden="true" size={18} />
          <span>{label as string}</span>
        </div>
      ))}
    </section>
  );
}

function FeatureCards() {
  return (
    <section
      aria-label="Ask Siargao feature cards"
      className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 md:px-9 md:pb-9 xl:px-11 min-[900px]:grid-cols-4"
    >
      {featureCards.map(({ body, icon: Icon, link, title }) => (
        <Card
          className="min-h-56 border-0 bg-white/95 p-5 shadow-[0_18px_48px_rgba(8,8,38,0.18)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-[#fff7df] md:min-h-[228px]"
          key={title}
        >
          <CardContent className="p-0">
            <span className="inline-flex size-11 items-center justify-center rounded-full bg-[rgba(108,70,232,0.1)] text-brand-violet-600">
              <Icon aria-hidden="true" size={22} />
            </span>
            <h2 className="mt-4 mb-2 text-base leading-tight font-extrabold text-text-strong">
              {title}
            </h2>
            <p className="mt-0 mb-5 text-sm leading-[1.55] text-text-muted">{body}</p>
            <Link
              className="inline-flex items-center gap-1 text-sm font-extrabold text-brand-violet-550 no-underline"
              href="/chat"
            >
              {link} <ArrowRight aria-hidden="true" size={15} />
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

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
