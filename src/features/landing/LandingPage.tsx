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

import { BrandLockup, BrowserFrame, GradientLink, SignalBadge } from "@/ui/components/ask-siargao";
import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";

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
    <main className={page()}>
      <BrowserFrame className={frame()} label="Ask Siargao landing page">
        <div className={imageLayer()} />
        <div className={overlayLayer()} />
        <div className={contentLayer()}>
          <Header />
          <Hero />
          <SuggestionChips />
          <TrustRow />
        </div>
      </BrowserFrame>
      <FeatureCards />
      <MobileFooter />
    </main>
  );
}

function Header() {
  return (
    <header className={header()}>
      <a className={brandLink()} href="/">
        <BrandLockup />
      </a>
      <nav aria-label="Main navigation" className={nav()}>
        {navItems.map((item) => (
          <a className={navLink()} href={`#${slug(item)}`} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <GradientLink className={desktopCta()} href="/chat">
        Open assistant
      </GradientLink>
      <a aria-label="Open navigation menu" className={mobileMenu()} href="/chat">
        <Menu aria-hidden="true" size={20} />
      </a>
    </header>
  );
}

function Hero() {
  return (
    <section className={hero()} id="how-it-works">
      <div className={heroCopy()}>
        <h1 className={heroTitle()}>
          Ask Siargao
          <br />
          anything about
          <br />
          <em>your trip.</em>
        </h1>
        <p className={heroBody()}>
          Local answers for where to stay, what to do, how to get around, and what today's weather
          changes.
        </p>
      </div>
      <div className={promptWeatherRow()}>
        <PromptCard />
        <WeatherCard />
      </div>
    </section>
  );
}

function PromptCard() {
  return (
    <section aria-label="Example Ask Siargao prompt" className={promptCard()}>
      <div className={promptTextRow()}>
        <Sparkles aria-hidden="true" className={css({ color: "violet.600", flexShrink: 0 })} />
        <p className={promptText()}>
          I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants, and
          easy airport transfer. What should we know?
        </p>
      </div>
      <div className={promptControls()}>
        <button aria-label="Add trip detail" className={squareButton()} type="button">
          <Plus aria-hidden="true" size={18} />
        </button>
        <button aria-label="Browse local sources" className={squareButton()} type="button">
          <Globe2 aria-hidden="true" size={18} />
        </button>
        <GradientLink className={askButton()} href="/chat">
          Ask Siargao <Send aria-hidden="true" size={16} />
        </GradientLink>
      </div>
    </section>
  );
}

function WeatherCard() {
  return (
    <aside className={weatherCard()} id="weather">
      <div className={weatherTitleRow()}>
        <CloudSun aria-hidden="true" className={css({ color: "violet.650" })} size={22} />
        <h2 className={weatherTitle()}>Today in Siargao</h2>
      </div>
      <div className={css({ display: "grid" })}>
        {weatherRows.map(([label, value]) => (
          <div className={weatherRow()} key={label}>
            <span>{label}</span>
            {label === "Freshness" ? (
              <SignalBadge tone="fresh">{value}</SignalBadge>
            ) : (
              <strong>{value}</strong>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function SuggestionChips() {
  return (
    <section className={suggestions()} id="where-to-stay">
      <p className={suggestionsLabel()}>Try asking about...</p>
      <div className={chipRow()}>
        {suggestionChips.map(([label, Icon]) => (
          <a className={chip()} href="/chat" key={label as string}>
            <Icon aria-hidden="true" size={15} />
            {label as string}
          </a>
        ))}
      </div>
    </section>
  );
}

function TrustRow() {
  return (
    <section className={trustRow()} id="saved-places">
      {trustItems.map(([label, Icon]) => (
        <div className={trustItem()} key={label as string}>
          <Icon aria-hidden="true" size={18} />
          <span>{label as string}</span>
        </div>
      ))}
    </section>
  );
}

function FeatureCards() {
  return (
    <section className={features()} aria-label="Ask Siargao feature cards">
      {featureCards.map(({ body, icon: Icon, link, title }) => (
        <article className={featureCard()} key={title}>
          <span className={featureIcon()}>
            <Icon aria-hidden="true" size={22} />
          </span>
          <h2>{title}</h2>
          <p>{body}</p>
          <a href="/chat">
            {link} <ArrowRight aria-hidden="true" size={15} />
          </a>
        </article>
      ))}
    </section>
  );
}

function MobileFooter() {
  return <p className={mobileFooter()}>Built for travelers · Loved by locals</p>;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function page() {
  return css({
    background:
      "radial-gradient(circle at 12% 12%, rgba(255,155,131,0.12), transparent 28rem), linear-gradient(135deg, #05082a 0%, #090d3a 48%, #17105a 100%)",
    minH: "100vh",
    overflowX: "hidden",
    px: { base: "3", md: "5" },
    py: { base: "3", md: "5" },
  });
}

function frame() {
  return css({
    maxW: "1240px",
    minH: { base: "calc(100vh - 24px)", md: "760px" },
    mx: "auto",
  });
}

function imageLayer() {
  return css({
    background:
      "linear-gradient(180deg, rgba(5,8,42,0.1), rgba(5,8,42,0.32)), url('/images/siargao-sunset.png') center / cover no-repeat",
    inset: 0,
    position: "absolute",
    zIndex: 0,
  });
}

function overlayLayer() {
  return css({
    background:
      "linear-gradient(90deg, rgba(5,8,42,0.94) 0%, rgba(8,10,48,0.78) 44%, rgba(69,42,152,0.34) 100%)",
    inset: 0,
    position: "absolute",
    zIndex: 1,
  });
}

function contentLayer() {
  return css({
    display: "flex",
    flexDirection: "column",
    minH: { base: "calc(100vh - 24px)", md: "760px" },
    position: "relative",
    zIndex: 2,
  });
}

function header() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "5",
    justifyContent: "space-between",
    minH: { base: "72px", md: "86px" },
    pl: { base: "14", md: "16" },
    pr: { base: "4", md: "6" },
    pt: "1",
  });
}

function brandLink() {
  return css({
    textDecoration: "none",
    "& span:last-child": {
      fontSize: { base: "sm", md: "md" },
    },
  });
}

function nav() {
  return css({
    alignItems: "center",
    display: { base: "none", lg: "flex" },
    gap: "7",
    ml: "auto",
  });
}

function navLink() {
  return css({
    color: "rgba(255,255,255,0.74)",
    fontSize: "xs",
    fontWeight: "800",
    textDecoration: "none",
    transition: "color token(durations.fast) token(easings.standard)",
    _focusVisible: {
      outline: "3px solid token(colors.violet.400)",
      outlineOffset: "4px",
    },
    _hover: {
      color: "text.onDark",
    },
  });
}

function desktopCta() {
  return css({
    display: { base: "none", md: "inline-flex" },
    flexShrink: 0,
  });
}

function mobileMenu() {
  return css({
    alignItems: "center",
    bg: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: "md",
    borderWidth: "1px",
    color: "text.onDark",
    display: { base: "inline-flex", md: "none" },
    h: "10",
    justifyContent: "center",
    textDecoration: "none",
    width: "10",
  });
}

function hero() {
  return css({
    display: "grid",
    flex: "1",
    gap: { base: "8", lg: "10" },
    gridTemplateColumns: { base: "1fr", lg: "minmax(0, 0.88fr) minmax(420px, 0.9fr)" },
    pb: { base: "6", md: "8" },
    pl: { base: "5", md: "10", xl: "16" },
    pr: { base: "5", md: "10", xl: "14" },
    pt: { base: "5", md: "8", lg: "12" },
  });
}

function heroCopy() {
  return css({
    alignSelf: "start",
    maxW: "560px",
  });
}

function heroTitle() {
  return css({
    color: "text.onDark",
    fontFamily: "display",
    fontSize: { base: "3xl", sm: "4xl", md: "4.75rem", xl: "5.25rem" },
    fontWeight: "800",
    lineHeight: "0.96",
    m: 0,
    textWrap: "balance",
    "& em": {
      color: "lavender.400",
      fontStyle: "italic",
      fontWeight: "700",
    },
  });
}

function heroBody() {
  return css({
    color: "rgba(226,220,247,0.9)",
    fontSize: { base: "sm", md: "md" },
    lineHeight: "1.55",
    maxW: "430px",
    mb: 0,
    mt: "6",
  });
}

function promptWeatherRow() {
  return css({
    alignSelf: { base: "stretch", lg: "end" },
    display: "grid",
    gap: "4",
    gridTemplateColumns: { base: "1fr", md: "minmax(0, 1.3fr) minmax(240px, 0.7fr)" },
  });
}

function promptCard() {
  return css({
    alignSelf: "end",
    bg: "surface.glass",
    borderColor: "rgba(255,255,255,0.64)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "violetGlow",
    color: "text",
    display: "grid",
    gap: "5",
    minH: { base: "220px", md: "248px" },
    p: { base: "5", md: "6" },
  });
}

function promptTextRow() {
  return css({
    alignItems: "start",
    display: "flex",
    gap: "3",
  });
}

function promptText() {
  return css({
    color: "text.strong",
    fontSize: { base: "md", md: "lg" },
    fontWeight: "800",
    lineHeight: "1.44",
    m: 0,
  });
}

function promptControls() {
  return css({
    alignItems: "center",
    alignSelf: "end",
    display: "flex",
    gap: "3",
  });
}

function squareButton() {
  return css({
    alignItems: "center",
    bg: "lavender.100",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    color: "violet.650",
    cursor: "pointer",
    display: "inline-flex",
    h: "10",
    justifyContent: "center",
    width: "10",
  });
}

function askButton() {
  return css({
    ml: "auto",
    minH: "40px",
    px: { base: "3", sm: "4" },
    whiteSpace: "nowrap",
  });
}

function weatherCard() {
  return css({
    alignSelf: "end",
    bg: "rgba(255,255,255,0.92)",
    borderColor: "rgba(255,255,255,0.7)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    color: "text",
    minH: { base: "auto", md: "248px" },
    p: "5",
  });
}

function weatherTitleRow() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "2",
    mb: "4",
  });
}

function weatherTitle() {
  return css({
    color: "text.strong",
    fontSize: "md",
    fontWeight: "900",
    m: 0,
  });
}

function weatherRow() {
  return css({
    alignItems: "center",
    borderTopColor: "rgba(13,16,74,0.12)",
    borderTopWidth: "1px",
    color: "text.muted",
    display: "flex",
    fontSize: "xs",
    gap: "3",
    justifyContent: "space-between",
    minH: "38px",
    "& strong": {
      color: "text.strong",
      fontWeight: "900",
    },
  });
}

function suggestions() {
  return css({
    px: { base: "5", md: "10", xl: "16" },
    pb: { base: "5", md: "6" },
  });
}

function suggestionsLabel() {
  return css({
    color: "rgba(226,220,247,0.84)",
    fontSize: "xs",
    fontWeight: "900",
    mb: "3",
    mt: 0,
  });
}

function chipRow() {
  return css({
    display: "flex",
    flexWrap: "wrap",
    gap: "3",
  });
}

function chip() {
  return css({
    alignItems: "center",
    bg: "rgba(9,13,58,0.52)",
    borderColor: "rgba(180,160,255,0.52)",
    borderRadius: "pill",
    borderWidth: "1px",
    color: "lavender.150",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "800",
    gap: "2",
    minH: "34px",
    px: "3",
    textDecoration: "none",
  });
}

function trustRow() {
  return css({
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.12)",
    borderTopWidth: "1px",
    display: "flex",
    flexWrap: "wrap",
    gap: { base: "3", md: "0" },
    justifyContent: "center",
    mx: { base: "5", md: "10", xl: "16" },
    py: { base: "4", md: "5" },
  });
}

function trustItem() {
  return css({
    alignItems: "center",
    color: "rgba(255,255,255,0.86)",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "900",
    gap: "2",
    px: { base: "2", md: "6" },
    "&:not(:last-child)": {
      borderRightColor: { base: "transparent", md: "rgba(255,255,255,0.2)" },
      borderRightWidth: { base: "0", md: "1px" },
    },
    "& svg": {
      color: "lavender.400",
    },
  });
}

function features() {
  return css({
    display: "grid",
    gap: "4",
    gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
    maxW: "1180px",
    mx: "auto",
    px: { base: "1", md: "0" },
    py: { base: "4", md: "5" },
  });
}

function featureCard() {
  return css({
    bg: "surface.glass",
    borderColor: "rgba(255,255,255,0.54)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    minH: "210px",
    p: "5",
    "& h2": {
      color: "text.strong",
      fontSize: "md",
      fontWeight: "900",
      lineHeight: "1.25",
      mb: "2",
      mt: "4",
    },
    "& p": {
      color: "text.muted",
      fontSize: "sm",
      lineHeight: "1.55",
      mb: "5",
      mt: 0,
    },
    "& a": {
      alignItems: "center",
      color: "violet.650",
      display: "inline-flex",
      fontSize: "sm",
      fontWeight: "900",
      gap: "1",
      textDecoration: "none",
    },
  });
}

function featureIcon() {
  return css({
    alignItems: "center",
    bg: "violet.650",
    borderRadius: "pill",
    color: "text.onDark",
    display: "inline-flex",
    h: "11",
    justifyContent: "center",
    width: "11",
  });
}

function mobileFooter() {
  return css({
    color: "rgba(255,255,255,0.72)",
    display: { base: "block", md: "none" },
    fontSize: "xs",
    fontWeight: "800",
    m: 0,
    pb: "2",
    pt: "1",
    textAlign: "center",
  });
}
