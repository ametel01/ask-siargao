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

import { BrandLockup, GradientLink, SignalBadge } from "@/ui/components/ask-siargao";
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
      <section aria-label="Ask Siargao landing page" className={frame()}>
        <div className={contentLayer()}>
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
    <header className={header()}>
      <Link className={brandLink()} href="/">
        <BrandLockup />
      </Link>
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
      <Link aria-label="Open navigation menu" className={mobileMenu()} href="/chat">
        <Menu aria-hidden="true" size={20} />
      </Link>
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
      <div className={heroPanels()}>
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
        <Sparkles aria-hidden="true" className={css({ color: "violet.550", flexShrink: 0 })} />
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
          <Link className={chip()} href="/chat" key={label as string}>
            <Icon aria-hidden="true" size={15} />
            {label as string}
          </Link>
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
          <Link
            className={featureLink()}
            href="/chat"
            style={{ color: "var(--colors-violet-550)" }}
          >
            {link} <ArrowRight aria-hidden="true" size={15} />
          </Link>
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
    background: "#05082a",
    minH: "100vh",
    overflowX: "hidden",
    px: "0",
    py: "0",
  });
}

function frame() {
  return css({
    background:
      "linear-gradient(90deg, rgba(5,8,42,0.96) 0%, rgba(7,10,48,0.86) 34%, rgba(43,24,106,0.34) 62%, rgba(5,8,42,0.52) 100%), linear-gradient(180deg, rgba(5,8,42,0.04) 0%, rgba(5,8,42,0.2) 46%, rgba(5,8,42,0.9) 100%), url('/images/hero-bg.png')",
    backgroundPosition: "center, center, center",
    backgroundRepeat: "no-repeat, no-repeat, no-repeat",
    backgroundSize: "100% 100%, 100% 100%, cover",
    borderColor: "transparent",
    borderRadius: "0",
    borderWidth: "0",
    boxShadow: "none",
    minH: "100vh",
    overflow: "hidden",
    position: "relative",
    width: "100%",
    _before: {
      background:
        "radial-gradient(circle at 61% 27%, rgba(255,155,131,0.14), transparent 25rem), radial-gradient(circle at 84% 18%, rgba(135,92,246,0.12), transparent 26rem)",
      content: '""',
      inset: 0,
      pointerEvents: "none",
      position: "absolute",
      zIndex: 0,
    },
  });
}

function contentLayer() {
  return css({
    display: "flex",
    flexDirection: "column",
    maxW: "1680px",
    minH: "100vh",
    mx: "auto",
    position: "relative",
    width: "100%",
    zIndex: 2,
  });
}

function header() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "5",
    justifyContent: "space-between",
    minH: { base: "72px", md: "94px" },
    px: { base: "5", md: "9", xl: "11" },
    pt: { base: "2", md: "4" },
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
    display: "none",
    gap: "8",
    ml: "auto",
    "@media (min-width: 900px)": {
      display: "flex",
    },
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
    alignContent: { base: "start", md: "space-between" },
    display: "grid",
    flex: "1",
    gap: { base: "7", md: "12" },
    gridTemplateColumns: "1fr",
    minH: { base: "auto", md: "calc(100vh - 112px)" },
    pb: { base: "6", md: "9", xl: "11" },
    px: { base: "5", md: "9", xl: "11" },
    pt: { base: "5", md: "8", lg: "10" },
  });
}

function heroCopy() {
  return css({
    alignSelf: "start",
    maxW: "660px",
  });
}

function heroTitle() {
  return css({
    color: "#fff7df",
    fontFamily: "display",
    fontSize: { base: "3xl", sm: "4xl", md: "4.85rem", xl: "5.6rem" },
    fontWeight: "800",
    lineHeight: "0.96",
    m: 0,
    textWrap: "balance",
    "& em": {
      color: "violet.400",
      fontStyle: "italic",
      fontWeight: "700",
    },
  });
}

function heroBody() {
  return css({
    color: "text.onDarkMuted",
    fontSize: { base: "sm", md: "md" },
    lineHeight: "1.55",
    maxW: "420px",
    mb: 0,
    mt: "5",
  });
}

function heroPanels() {
  return css({
    alignSelf: { base: "start", md: "end" },
    display: "grid",
    gap: { base: "4", md: "5", xl: "6" },
    gridTemplateColumns: "1fr",
    maxW: "1360px",
    width: "100%",
    "@media (min-width: 900px)": {
      gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 0.9fr)",
    },
  });
}

function promptCard() {
  return css({
    bg: "rgba(255,255,255,0.96)",
    borderColor: "rgba(164,134,255,0.75)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.22), 0 22px 68px rgba(76,49,184,0.38)",
    color: "text",
    display: "grid",
    gap: { base: "5", md: "5" },
    minH: { base: "190px", md: "194px" },
    p: { base: "5", md: "6" },
    position: "relative",
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
    fontSize: { base: "sm", md: "md" },
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
    bg: "#ffffff",
    borderColor: "rgba(8,47,57,0.16)",
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
    bg: "rgba(255,255,255,0.94)",
    backdropFilter: "blur(12px)",
    borderColor: "rgba(226,220,247,0.94)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "0 20px 58px rgba(8,8,38,0.24)",
    color: "text",
    minH: { base: "auto", lg: "194px" },
    overflow: "hidden",
    p: "0",
  });
}

function weatherTitleRow() {
  return css({
    alignItems: "center",
    borderBottomColor: "border",
    borderBottomWidth: "1px",
    display: "flex",
    gap: "2",
    p: "4",
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
    color: "text.muted",
    display: "flex",
    fontSize: "xs",
    gap: "3",
    justifyContent: "space-between",
    minH: "35px",
    px: "4",
    "& strong": {
      color: "text.strong",
      fontWeight: "900",
    },
  });
}

function suggestions() {
  return css({
    px: { base: "5", md: "9", xl: "11" },
    pb: { base: "5", md: "5" },
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
    gap: { base: "3", md: "4" },
  });
}

function chip() {
  return css({
    alignItems: "center",
    bg: "rgba(5,8,42,0.42)",
    borderColor: "rgba(184,166,255,0.54)",
    borderRadius: "pill",
    borderWidth: "1px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.16)",
    color: "rgba(255,255,255,0.88)",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "800",
    gap: "2",
    minH: "36px",
    px: "4",
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
    mx: { base: "5", md: "9", xl: "11" },
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
      color: "violet.400",
    },
  });
}

function features() {
  return css({
    background: "transparent",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: { base: "0", md: "lg" },
    display: "grid",
    gap: { base: "3", lg: "3" },
    gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)" },
    px: { base: "5", md: "9", xl: "11" },
    pb: { base: "5", md: "9" },
    "@media (min-width: 900px)": {
      gridTemplateColumns: "repeat(4, 1fr)",
    },
  });
}

function featureCard() {
  return css({
    bg: "rgba(255,255,255,0.96)",
    borderRightColor: "rgba(8,47,57,0.13)",
    borderRadius: "lg",
    boxShadow: "0 18px 48px rgba(8,8,38,0.18)",
    minH: { base: "224px", md: "228px" },
    p: { base: "5", md: "5" },
    transition: "background token(durations.fast) token(easings.standard)",
    _hover: {
      bg: "#fff7df",
    },
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
  });
}

function featureLink() {
  return css({
    alignItems: "center",
    display: "inline-flex",
    fontSize: "sm",
    fontWeight: "900",
    gap: "1",
    textDecoration: "none",
  });
}

function featureIcon() {
  return css({
    alignItems: "center",
    bg: "rgba(108,70,232,0.1)",
    borderRadius: "pill",
    color: "violet.600",
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
