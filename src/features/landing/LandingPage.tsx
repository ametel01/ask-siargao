import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  ClipboardCheck,
  CloudSun,
  FilePenLine,
  FileText,
  Menu,
  Plane,
  Play,
  Search,
  ShieldCheck,
  ShieldPlus,
  TrendingUp,
  Users,
  Wifi,
} from "lucide-react";

import { IntakeForm } from "@/features/intake/IntakeForm";
import { WeatherTelemetryPanel } from "@/features/weather/WeatherTelemetryPanel";
import type { WeatherSnapshot } from "@/server/public-pages/weather-snapshot";
import {
  AccordionItem,
  Badge,
  Button,
  Card,
  Input,
  LinkButton,
  Table,
  Tooltip,
} from "@/ui/components/primitives";
import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";
import { faqAccordion } from "../../../styled-system/recipes/faq-accordion";
import { footer } from "../../../styled-system/recipes/footer";
import { header } from "../../../styled-system/recipes/header";
import { miniFeatureCard } from "../../../styled-system/recipes/mini-feature-card";
import { pageShell } from "../../../styled-system/recipes/page-shell";
import { pricingCard } from "../../../styled-system/recipes/pricing-card";
import { processCard } from "../../../styled-system/recipes/process-card";
import { reportPreview } from "../../../styled-system/recipes/report-preview";
import { riskGauge } from "../../../styled-system/recipes/risk-gauge";
import { riskPreviewCard } from "../../../styled-system/recipes/risk-preview-card";
import { sectionPanel } from "../../../styled-system/recipes/section-panel";
import { trustCard } from "../../../styled-system/recipes/trust-card";

const checks = [
  {
    icon: CloudSun,
    title: "Weather exposure",
    body: "Rain, wind, swell, typhoons, and heat.",
  },
  {
    icon: Plane,
    title: "Arrival logistics",
    body: "Ferries, flights, transfers, and timing risks.",
  },
  {
    icon: BedDouble,
    title: "Accommodation reality",
    body: "Location, reviews, noise, comfort, and reliability.",
  },
  {
    icon: Wifi,
    title: "Internet and power",
    body: "Mobile signal, Wi-Fi, and generator backup.",
  },
  {
    icon: ShieldPlus,
    title: "Safety and health",
    body: "Crime, road safety, clinic access, and medical gaps.",
  },
  {
    icon: ClipboardCheck,
    title: "Rules and fees",
    body: "Local rules, permits, and extra costs.",
  },
];

const steps = [
  {
    icon: FilePenLine,
    title: "Enter details",
    body: "Share dates, stay, route, and constraints.",
  },
  {
    icon: Search,
    title: "Verify sources",
    body: "We check live data and trusted records.",
  },
  {
    icon: ShieldCheck,
    title: "Score risk",
    body: "Every category gets confidence labels.",
  },
  {
    icon: FileText,
    title: "Build audit",
    body: "If completable, we compile your report.",
  },
  {
    icon: TrendingUp,
    title: "Read report",
    body: "Get recommendations and next steps.",
  },
];

const trustItems = [
  {
    icon: FileText,
    title: "Cited evidence",
    body: "Every claim links to source records and timestamps.",
  },
  {
    icon: CalendarDays,
    title: "Freshness windows",
    body: "Each data point shows when it was last updated.",
  },
  {
    icon: TrendingUp,
    title: "Confidence labels",
    body: "High, medium, or low confidence is never a guess.",
  },
  {
    icon: Users,
    title: "Local signals",
    body: "On-the-ground and community signals where they matter.",
  },
];

const faq = [
  {
    question: "When do I pay?",
    answer: "Only after the system verifies it can complete the audit to the promised standard.",
  },
  {
    question: "Is this an itinerary planner?",
    answer: "No. It audits the plan you already have and explains what may break.",
  },
  {
    question: "What if my stay cannot be matched?",
    answer:
      "You get the preview risk, but the full audit does not unlock checkout until confidence is sufficient.",
  },
  {
    question: "Do you scrape Airbnb?",
    answer:
      "No. V1 uses permitted sources, user-submitted details, official sources, and partner or local records.",
  },
];

const riskRows = [
  { label: "Late arrival route", status: "Low", tone: "low" as const },
  { label: "Accommodation area fit", status: "Medium", tone: "medium" as const },
  { label: "Weather buffer", status: "Low", tone: "low" as const },
  { label: "Scooter dependence", status: "Medium", tone: "medium" as const },
  { label: "Power and internet reliability", status: "Low", tone: "low" as const },
  { label: "Safety and health", status: "Low", tone: "low" as const },
];

export function LandingPage({ weatherSnapshot }: { weatherSnapshot: WeatherSnapshot }) {
  return (
    <main className={pageShell()}>
      <div className={heroBackdrop()}>
        <Header />
        <Hero />
        <WeatherTelemetryPanel initialSnapshot={weatherSnapshot} />
      </div>
      <IntakeForm />
      <WhatWeCheck />
      <HowItWorks />
      <TrustBand />
      <SampleReport />
      <PricingFaq />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className={header()}>
      <a
        className={css({
          alignItems: "center",
          color: "text.onDark",
          display: "flex",
          gap: "3",
          textDecoration: "none",
        })}
        href="#top"
      >
        <span
          aria-hidden="true"
          className={css({
            alignItems: "center",
            borderColor: "rgba(255,255,255,0.76)",
            borderRadius: "pill",
            borderWidth: "2px",
            display: "inline-flex",
            fontFamily: "Georgia, serif",
            fontSize: "xl",
            fontWeight: "800",
            h: "9",
            justifyContent: "center",
            lineHeight: "1",
            width: "9",
          })}
        >
          C
        </span>
        <span className={css({ fontFamily: "Georgia, serif", fontSize: "lg", fontWeight: "800" })}>
          Siargao Audit
        </span>
      </a>

      <nav
        aria-label="Main navigation"
        className={css({
          display: { base: "none", lg: "flex" },
          gap: "8",
          ml: "auto",
        })}
      >
        {[
          ["Why it matters", "checks"],
          ["What we check", "checks"],
          ["How it works", "process"],
          ["Sample report", "report"],
          ["Pricing", "pricing"],
          ["FAQ", "faq"],
        ].map(([item, target]) => (
          <a
            className={css({
              color: "rgba(255,255,255,0.78)",
              fontSize: "xs",
              fontWeight: "800",
              textDecoration: "none",
              _hover: { color: "text.onDark" },
              _focusVisible: {
                outline: "3px solid token(colors.violet.400)",
                outlineOffset: "4px",
              },
            })}
            href={`#${target}`}
            key={item}
          >
            {item}
          </a>
        ))}
      </nav>

      <Tooltip label="Open compact mobile menu">
        <Button
          aria-label="Open navigation"
          className={css({ display: { base: "inline-flex", lg: "none" }, px: "3" })}
          variant="ghost"
        >
          <Menu size={19} />
        </Button>
      </Tooltip>
      <LinkButton
        className={css({
          display: { base: "none", sm: "inline-flex" },
          minH: "40px",
          px: "4",
        })}
        href="#audit-start"
      >
        Start audit
      </LinkButton>
    </header>
  );
}

function Hero() {
  return (
    <section
      className={css({
        alignItems: "center",
        display: "grid",
        gap: { base: "8", lg: "14" },
        gridTemplateColumns: { base: "1fr", lg: "1.08fr 0.92fr" },
        maxW: "1220px",
        mx: "auto",
        pb: { base: "8", lg: "10" },
        pt: { base: "8", md: "12", lg: "16" },
      })}
      id="top"
    >
      <div>
        <h1
          className={css({
            color: "text.onDark",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: { base: "3xl", sm: "4xl", lg: "4.25rem" },
            fontWeight: "800",
            lineHeight: "0.98",
            maxW: "710px",
            mb: "5",
            mt: 0,
          })}
        >
          Know if your Siargao plan works before you book the risky parts.
        </h1>
        <p
          className={css({
            color: "rgba(255,255,255,0.76)",
            fontSize: { base: "sm", md: "md" },
            lineHeight: "1.65",
            maxW: "620px",
            mb: "7",
          })}
        >
          Evidence-backed trip feasibility audit that checks weather, logistics, accommodation,
          internet, safety, and rules so you only pay if we can complete the audit.
        </p>
        <div
          className={css({
            alignItems: { base: "stretch", sm: "center" },
            display: "flex",
            flexDirection: { base: "column", sm: "row" },
            gap: "4",
            mb: "6",
          })}
        >
          <LinkButton className={css({ minW: { sm: "218px" } })} href="#audit-start">
            Start trip audit <ArrowRight aria-hidden="true" size={18} />
          </LinkButton>
          <LinkButton
            className={css({
              bg: "rgba(255,255,255,0.08)",
              borderColor: "rgba(255,255,255,0.28)",
              color: "text.onDark",
              minW: { sm: "210px" },
            })}
            href="#report"
            variant="ghost"
          >
            See sample report
          </LinkButton>
        </div>
        <div
          className={css({
            display: "grid",
            gap: "3",
            gridTemplateColumns: { base: "1fr", md: "repeat(3, max-content)" },
          })}
        >
          {[
            "One free preview risk before payment",
            "Pay only if we can complete the full audit",
            "USD 9.99 one-time",
          ].map((note) => (
            <span
              className={css({
                alignItems: "center",
                color: "rgba(255,255,255,0.82)",
                display: "flex",
                fontSize: "xs",
                fontWeight: "800",
                gap: "2",
              })}
              key={note}
            >
              <ShieldCheck aria-hidden="true" size={17} /> {note}
            </span>
          ))}
        </div>
      </div>
      <RiskPreviewCard />
    </section>
  );
}

function RiskPreviewCard() {
  return (
    <aside aria-label="Trip risk preview card" className={riskPreviewCard()}>
      <div
        className={css({
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          mb: "4",
        })}
      >
        <h2
          className={css({
            color: "text.onDark",
            fontFamily: "Georgia, serif",
            fontSize: "lg",
            fontWeight: "800",
            m: 0,
          })}
        >
          Trip risk preview
        </h2>
        <Badge className={css({ bg: "rgba(255,255,255,0.16)", color: "text.onDark" })} tone="dark">
          Sample
        </Badge>
      </div>
      <div aria-label="Overall preview rating is low risk" className={riskGauge()}>
        <div
          className={css({
            bg: "conic-gradient(from 270deg, #70c66f 0deg 124deg, #cdb7ff 124deg 180deg, transparent 180deg 360deg)",
            borderRadius: "999px 999px 0 0",
            filter: "drop-shadow(0 18px 24px rgba(0,0,0,0.24))",
            h: "100%",
            position: "absolute",
            top: 0,
            width: "86%",
          })}
        />
        <div
          className={css({
            alignItems: "center",
            bg: "rgba(26,26,63,0.82)",
            borderRadius: "999px 999px 0 0",
            bottom: "-2px",
            boxShadow: "inset 0 18px 28px rgba(255,255,255,0.1)",
            color: "text.onDark",
            display: "flex",
            flexDirection: "column",
            h: "70%",
            justifyContent: "center",
            position: "absolute",
            width: "64%",
          })}
        >
          <span className={css({ color: "#93e68e", fontSize: "xl", fontWeight: "900" })}>
            LOW RISK
          </span>
          <span
            className={css({ color: "rgba(255,255,255,0.84)", fontSize: "xs", fontWeight: "800" })}
          >
            4 of 6 areas look good
          </span>
          <span className={css({ color: "rgba(255,255,255,0.62)", fontSize: "2xs", mt: "2" })}>
            Looks solid. Keep a few medium-risk areas in mind.
          </span>
        </div>
      </div>
      <div className={css({ mt: "5" })}>
        <RiskList />
      </div>
      <LinkButton
        className={css({
          borderColor: "rgba(255,255,255,0.26)",
          color: "text.onDark",
          mt: "5",
          width: "100%",
        })}
        href="#report"
        variant="secondary"
      >
        View sample report <ArrowRight aria-hidden="true" size={16} />
      </LinkButton>
    </aside>
  );
}

function RiskList() {
  return (
    <div className={css({ display: "grid" })}>
      {riskRows.map((row) => (
        <div
          className={css({
            alignItems: "center",
            borderTopColor: "rgba(255,255,255,0.16)",
            borderTopWidth: "1px",
            color: "rgba(255,255,255,0.82)",
            display: "flex",
            fontSize: "xs",
            fontWeight: "800",
            gap: "3",
            justifyContent: "space-between",
            minH: "36px",
          })}
          key={row.label}
        >
          <span>{row.label}</span>
          <strong
            className={css({
              color:
                row.tone === "low"
                  ? "#91e88d"
                  : row.tone === "medium"
                    ? "risk.medium"
                    : "risk.high",
              fontSize: "xs",
            })}
          >
            {row.status}
          </strong>
        </div>
      ))}
    </div>
  );
}

function WhatWeCheck() {
  return (
    <section className={cx(sectionPanel(), css({ mt: 0, p: { base: "5", md: "7" } }))} id="checks">
      <h2 className={cx(sectionTitle(), css({ textAlign: "center" }))}>What we check</h2>
      <div
        className={css({
          display: "grid",
          gap: "4",
          gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(6, 1fr)" },
        })}
      >
        {checks.map(({ body, icon: Icon, title }) => (
          <Card className={miniFeatureCard()} key={title}>
            <Icon aria-hidden="true" className={css({ color: "violet.600", mb: "3" })} size={28} />
            <h3 className={cardTitle()}>{title}</h3>
            <p className={cardBody()}>{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={processBand()} id="process">
      <div className={css({ maxW: "1220px", mx: "auto" })}>
        <h2 className={cx(sectionTitle(), css({ color: "text.onDark", mb: "6" }))}>How it works</h2>
        <div
          className={css({
            alignItems: "stretch",
            display: "grid",
            gap: "4",
            gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(5, 1fr) 1.45fr" },
          })}
        >
          {steps.map(({ body, icon: Icon, title }, index) => (
            <Card className={processCard()} key={title}>
              <span
                className={css({
                  alignItems: "center",
                  bg: "violet.550",
                  borderRadius: "pill",
                  color: "text.onDark",
                  display: "inline-flex",
                  fontSize: "xs",
                  fontWeight: "900",
                  h: "7",
                  justifyContent: "center",
                  mb: "3",
                  width: "7",
                })}
              >
                {index + 1}
              </span>
              <Icon
                aria-hidden="true"
                className={css({ color: "text.onDark", mb: "3" })}
                size={22}
              />
              <h3 className={cx(cardTitle(), css({ color: "text.onDark" }))}>{title}</h3>
              <p className={cx(cardBody(), css({ color: "rgba(255,255,255,0.72)" }))}>{body}</p>
            </Card>
          ))}
          <div className={videoCard()}>
            <Button
              aria-label="Play audit walkthrough"
              className={css({ borderRadius: "pill", h: "14", px: "0", width: "14" })}
            >
              <Play aria-hidden="true" size={26} />
            </Button>
            <span className={css({ color: "text.onDark", fontSize: "xs", fontWeight: "800" })}>
              30-sec overview
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  return (
    <section
      className={cx(sectionPanel(), css({ mt: 0, overflow: "hidden", p: { base: "5", md: "7" } }))}
    >
      <div
        className={css({
          alignItems: "center",
          display: "grid",
          gap: "6",
          gridTemplateColumns: { base: "1fr", lg: "1.42fr 0.58fr" },
        })}
      >
        <div>
          <h2 className={cx(sectionTitle(), css({ textAlign: "center" }))}>
            Built as a trust layer
          </h2>
          <p
            className={css({
              color: "text.muted",
              fontSize: "sm",
              mb: "6",
              mt: "-3",
              textAlign: "center",
            })}
          >
            We turn messy, scattered data into clear answers you can trust.
          </p>
          <div
            className={css({
              display: "grid",
              gap: "4",
              gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
            })}
          >
            {trustItems.map(({ body, icon: Icon, title }) => (
              <Card className={trustCard()} key={title}>
                <Icon
                  aria-hidden="true"
                  className={css({ color: "violet.600", mb: "3" })}
                  size={25}
                />
                <h3 className={cardTitle()}>{title}</h3>
                <p className={cardBody()}>{body}</p>
              </Card>
            ))}
          </div>
        </div>
        <div className={conditionsCard()}>
          <strong>Real conditions. Right now.</strong>
          <span>We monitor changes daily so your plans match the island's reality.</span>
        </div>
      </div>
    </section>
  );
}

function SampleReport() {
  return (
    <section className={cx(sectionPanel(), css({ mt: 0, p: { base: "5", md: "7" } }))} id="report">
      <div
        className={css({
          display: "grid",
          gap: "6",
          gridTemplateColumns: { base: "1fr", lg: "0.72fr 1.36fr 0.66fr" },
        })}
      >
        <div>
          <h2 className={sectionTitle()}>A report that shows its work</h2>
          <h3
            className={css({
              color: "text.strong",
              fontFamily: "Georgia, serif",
              fontSize: "2xl",
              lineHeight: "1.08",
              mb: "5",
              mt: 0,
            })}
          >
            Sample audit report
          </h3>
          {[
            "Overall risk rating and summary",
            "Detailed scores by category",
            "Evidence, confidence, and freshness",
            "Clear recommendations",
            "What to watch and alternatives",
          ].map((item) => (
            <p
              className={css({
                alignItems: "center",
                color: "text",
                display: "flex",
                fontSize: "sm",
                fontWeight: "800",
                gap: "3",
                mb: "3",
              })}
              key={item}
            >
              <Check aria-hidden="true" className={css({ color: "violet.600" })} size={18} />
              {item}
            </p>
          ))}
        </div>
        <Card className={reportPreview()}>
          <div
            className={css({
              display: "grid",
              gap: "5",
              gridTemplateColumns: { base: "1fr", md: "0.9fr 1.1fr" },
            })}
          >
            <div>
              <span className={eyebrow()}>Overall risk</span>
              <strong className={css({ color: "risk.lowDark", display: "block", fontSize: "2xl" })}>
                Low
              </strong>
              <p className={cardBody()}>Good conditions for your plan.</p>
              <Table rows={riskRows.slice(0, 6)} />
            </div>
            <div>
              <span className={eyebrow()}>Evidence spotlight</span>
              {[
                "PAGASA forecast",
                "Phivolcs advisories",
                "DOT and PCG announcements",
                "Local community signals",
              ].map((source, index) => (
                <p className={reportEvidenceRow()} key={source}>
                  <span>{source}</span>
                  <span>Updated {index + 2}h ago</span>
                </p>
              ))}
              <span className={cx(eyebrow(), css({ mt: "5" }))}>Recommendations</span>
              <p className={cardBody()}>Book with flexible ferry options.</p>
              <p className={cardBody()}>Consider areas with generator backup.</p>
            </div>
          </div>
        </Card>
        <Card className={reportMiniCard()}>
          <span className={css({ color: "text.strong", fontSize: "xs", fontWeight: "900" })}>
            Siargao Audit
          </span>
          <strong
            className={css({ color: "text.strong", display: "block", fontSize: "lg", mt: "3" })}
          >
            Your trip audit
          </strong>
          <div className={cx(riskGauge(), css({ my: "4" }))}>
            <div
              className={css({
                bg: "conic-gradient(from 270deg, #70c66f 0deg 124deg, #cdb7ff 124deg 180deg, transparent 180deg 360deg)",
                borderRadius: "999px 999px 0 0",
                h: "100%",
                position: "absolute",
                top: 0,
                width: "90%",
              })}
            />
            <div
              className={css({
                alignItems: "center",
                bg: "surface",
                borderRadius: "999px 999px 0 0",
                bottom: "-2px",
                display: "flex",
                flexDirection: "column",
                h: "70%",
                justifyContent: "center",
                position: "absolute",
                width: "64%",
              })}
            >
              <span className={css({ color: "risk.lowDark", fontSize: "sm", fontWeight: "900" })}>
                LOW RISK
              </span>
            </div>
          </div>
          <LinkButton className={css({ width: "100%" })} href="#pricing">
            View full sample report
          </LinkButton>
        </Card>
      </div>
    </section>
  );
}

function PricingFaq() {
  return (
    <section
      className={css({
        display: "grid",
        gap: "4",
        gridTemplateColumns: { base: "1fr", lg: "0.9fr 1.1fr" },
        maxW: "1220px",
        mt: 0,
        mx: "auto",
      })}
      id="pricing"
    >
      <Card className={pricingCard()}>
        <p
          className={css({
            fontFamily: "Georgia, serif",
            fontSize: "2xl",
            fontWeight: "800",
            m: 0,
          })}
        >
          Clarity before commitment.
        </p>
        <p className={css({ color: "text.onDarkMuted", lineHeight: "1.6", mb: "5", mt: "2" })}>
          Start with a free risk preview. Pay only if we can complete your audit.
        </p>
        <strong className={css({ display: "block", fontSize: "2xl", mb: "4" })}>
          USD 9.99 <span className={css({ fontSize: "xs", fontWeight: "700" })}>one-time</span>
        </strong>
        <LinkButton className={css({ maxW: "320px", width: "100%" })} href="#audit-start">
          Start free preview <ArrowRight aria-hidden="true" size={18} />
        </LinkButton>
      </Card>
      <div className={faqAccordion()} id="faq">
        <h2 className={cx(sectionTitle(), css({ mb: "2", p: "5", pb: "2", textAlign: "center" }))}>
          FAQ
        </h2>
        {faq.map((item) => (
          <AccordionItem answer={item.answer} key={item.question} question={item.question} />
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={cx(footer(), css({ mt: 0 }))}>
      <div
        className={css({
          display: "grid",
          gap: "6",
          gridTemplateColumns: { base: "1fr", md: "1.3fr 1fr 1fr 1.15fr" },
        })}
      >
        <div>
          <h2 className={css({ fontFamily: "Georgia, serif", fontSize: "lg", mb: "2" })}>
            Siargao Audit
          </h2>
          <p
            className={css({
              color: "text.onDarkMuted",
              fontSize: "sm",
              lineHeight: "1.6",
              maxW: "300px",
            })}
          >
            Data-powered trip reliability for Siargao and beyond.
          </p>
        </div>
        <FooterColumn
          heading="Product"
          links={["Why it matters", "What we check", "How it works", "Pricing"]}
        />
        <FooterColumn heading="Help" links={["FAQ", "Contact", "Status", "Terms"]} />
        <form className={css({ display: "grid", gap: "3" })}>
          <label className={css({ fontSize: "sm", fontWeight: "800" })} htmlFor="newsletter-email">
            Stay updated on conditions
          </label>
          <div
            className={css({
              display: "flex",
              flexDirection: { base: "column", sm: "row" },
              gap: "2",
            })}
          >
            <Input id="newsletter-email" placeholder="Email address" type="email" />
            <Button className={css({ flex: "0 0 auto" })}>Subscribe</Button>
          </div>
        </form>
      </div>
      <div
        className={css({
          borderTopColor: "rgba(255,255,255,0.14)",
          borderTopWidth: "1px",
          color: "text.onDarkMuted",
          display: "flex",
          flexWrap: "wrap",
          fontSize: "xs",
          gap: "2",
          justifyContent: "space-between",
          mt: "6",
          pt: "4",
        })}
      >
        <span>Copyright 2026 Siargao Audit. All rights reserved.</span>
        <span>Made for smart travelers.</span>
      </div>
    </footer>
  );
}

function FooterColumn({ heading, links }: { heading: string; links: string[] }) {
  return (
    <div>
      <h3 className={css({ color: "text.onDark", fontSize: "xs", fontWeight: "900", mb: "3" })}>
        {heading}
      </h3>
      {links.map((link) => (
        <a className={footerLink()} href="#top" key={link}>
          {link}
        </a>
      ))}
    </div>
  );
}

function heroBackdrop() {
  return css({
    background:
      "linear-gradient(90deg, rgba(4,7,36,0.82) 0%, rgba(10,12,58,0.46) 48%, rgba(21,13,68,0.16) 100%), linear-gradient(180deg, rgba(4,7,36,0.18) 0%, rgba(7,9,44,0.42) 100%), url('/images/hero-bg.png') center / cover no-repeat",
    borderBottomColor: "rgba(255,255,255,0.12)",
    borderBottomWidth: "1px",
    boxShadow: "0 28px 70px rgba(7, 8, 38, 0.28)",
    color: "text.onDark",
    mx: { base: "-4", md: "-5" },
    pb: { base: "5", md: "8" },
    px: { base: "4", md: "5" },
    position: "relative",
  });
}

function processBand() {
  return css({
    background:
      "linear-gradient(90deg, rgba(26,16,99,0.96), rgba(88,54,195,0.86)), url('/images/siargao-sunset.png') center / cover",
    color: "text.onDark",
    mt: 0,
    mx: { base: "-4", md: "-5" },
    px: { base: "4", md: "5" },
    py: { base: "7", md: "8" },
  });
}

function videoCard() {
  return css({
    alignItems: "center",
    background:
      "linear-gradient(rgba(5,8,42,0.16), rgba(5,8,42,0.44)), url('/images/siargao-sunset.png') center / cover",
    borderColor: "rgba(255,255,255,0.32)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
    display: "flex",
    flexDirection: "column",
    gap: "3",
    justifyContent: "center",
    minH: "156px",
  });
}

function conditionsCard() {
  return css({
    alignSelf: "stretch",
    background:
      "linear-gradient(180deg, rgba(5,8,42,0.1), rgba(5,8,42,0.78)), url('/images/siargao-sunset.png') center / cover",
    borderRadius: "md",
    color: "text.onDark",
    display: "flex",
    flexDirection: "column",
    justifyContent: "end",
    minH: "190px",
    overflow: "hidden",
    p: "5",
    "& strong": {
      fontSize: "md",
      fontWeight: "900",
    },
    "& span": {
      color: "rgba(255,255,255,0.82)",
      fontSize: "xs",
      lineHeight: "1.5",
      mt: "1",
    },
  });
}

function sectionTitle() {
  return css({
    color: "text.strong",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: { base: "2xl", md: "3xl" },
    fontWeight: "800",
    lineHeight: "1.1",
    mb: "5",
    mt: 0,
  });
}

function cardTitle() {
  return css({ color: "text.strong", fontSize: "sm", fontWeight: "900", lineHeight: "1.25", m: 0 });
}

function cardBody() {
  return css({ color: "text.muted", fontSize: "xs", lineHeight: "1.55", mb: 0, mt: "2" });
}

function reportEvidenceRow() {
  return css({
    borderBottomColor: "border",
    borderBottomWidth: "1px",
    color: "text.muted",
    display: "flex",
    fontSize: "xs",
    gap: "3",
    justifyContent: "space-between",
    m: 0,
    py: "2",
  });
}

function reportMiniCard() {
  return css({
    bg: "surface",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "card",
    p: "5",
  });
}

function eyebrow() {
  return css({
    color: "text.soft",
    display: "block",
    fontSize: "2xs",
    fontWeight: "900",
    mb: "2",
    textTransform: "uppercase",
  });
}

function footerLink() {
  return css({
    color: "text.onDarkMuted",
    display: "block",
    fontSize: "sm",
    fontWeight: "700",
    mb: "2",
    textDecoration: "none",
    _hover: { color: "text.onDark" },
  });
}
