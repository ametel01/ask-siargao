import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CloudSun,
  FilePenLine,
  FileText,
  House,
  Menu,
  Play,
  Quote,
  Search,
  ShieldCheck,
  ShieldPlus,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  Wifi,
} from "lucide-react";

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
import { css, cx } from "../../../styled-system/css";
import {
  faqAccordion,
  footer,
  header,
  miniFeatureCard,
  pageShell,
  pricingCard,
  processCard,
  reportPreview,
  riskGauge,
  riskPreviewCard,
  sectionPanel,
  testimonialCard,
  trustCard,
} from "../../../styled-system/recipes";

const checks = [
  {
    icon: Truck,
    title: "Arrival logistics",
    body: "Ferry, airport transfer, late arrival, and route timing risks.",
  },
  {
    icon: CloudSun,
    title: "Weather exposure",
    body: "Seasonal rain, surf windows, and backup-day pressure.",
  },
  {
    icon: House,
    title: "Accommodation reality",
    body: "Area fit, access constraints, and host questions to ask.",
  },
  {
    icon: Wifi,
    title: "Remote work basics",
    body: "Internet, power, quiet sleep, and workspace assumptions.",
  },
  {
    icon: ShieldPlus,
    title: "Safety and health",
    body: "Clinic access, scooter exposure, and night transport gaps.",
  },
  {
    icon: ClipboardCheck,
    title: "Rules and fees",
    body: "Environmental fees, operator policies, and verification gaps.",
  },
];

const steps = [
  {
    icon: FilePenLine,
    title: "Enter details",
    body: "Paste your current plan, dates, stay, and constraints.",
  },
  {
    icon: Search,
    title: "Verify sources",
    body: "We check permitted sources before asking for payment.",
  },
  {
    icon: ShieldCheck,
    title: "Score risk",
    body: "Each finding gets severity, confidence, freshness, and evidence.",
  },
  {
    icon: FileText,
    title: "Read report",
    body: "You get recommendations, host questions, and explicit limitations.",
  },
];

const trustItems = [
  {
    icon: FileText,
    title: "Cited evidence",
    body: "Every claim is tied to source records and evidence IDs.",
  },
  {
    icon: CalendarDays,
    title: "Freshness windows",
    body: "Outdated facts are flagged instead of quietly reused.",
  },
  {
    icon: Users,
    title: "Local signals",
    body: "Official, partner, and permitted public sources stay separated.",
  },
  {
    icon: TrendingUp,
    title: "Confidence labels",
    body: "Source credibility and fact confidence are scored separately.",
  },
];

const testimonials = [
  {
    quote:
      "It caught the late ferry issue before we paid for the room. The host questions were the useful part.",
    name: "Maya R.",
    location: "Singapore",
  },
  {
    quote:
      "The report was less dreamy than a guide, which is exactly what I needed before traveling solo.",
    name: "Evan T.",
    location: "Melbourne",
  },
  {
    quote:
      "Clear green, yellow, red risks with sources. I changed one transfer and kept the rest of the trip.",
    name: "Sofia L.",
    location: "Manila",
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
];

export function LandingPage() {
  return (
    <main className={pageShell()}>
      <Header />
      <Hero />
      <WhatWeCheck />
      <HowItWorks />
      <TrustBand />
      <SampleReport />
      <Testimonials />
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
            bg: "rgba(255,255,255,0.14)",
            borderColor: "border.onDark",
            borderRadius: "md",
            borderWidth: "1px",
            display: "inline-flex",
            h: "10",
            justifyContent: "center",
            width: "10",
          })}
        >
          <ShieldCheck size={23} />
        </span>
        <span>
          <span className={css({ display: "block", fontSize: "sm", fontWeight: "800" })}>
            SIARGAO AUDIT
          </span>
          <span className={css({ color: "text.onDarkMuted", display: "block", fontSize: "2xs" })}>
            Evidence-led trip checks
          </span>
        </span>
      </a>

      <nav
        aria-label="Main navigation"
        className={css({
          display: { base: "none", md: "flex" },
          gap: { md: "7", lg: "10" },
          ml: "auto",
        })}
      >
        {["Checks", "Process", "Report", "Pricing"].map((item) => (
          <a
            className={css({
              color: "text.onDarkMuted",
              fontSize: "sm",
              fontWeight: "700",
              textDecoration: "none",
              _hover: { color: "text.onDark" },
              _focusVisible: {
                outline: "3px solid token(colors.violet.400)",
                outlineOffset: "4px",
              },
            })}
            href={`#${item.toLowerCase()}`}
            key={item}
          >
            {item}
          </a>
        ))}
      </nav>

      <Tooltip label="Open compact mobile menu">
        <Button
          aria-label="Open navigation"
          className={css({ display: { base: "inline-flex", md: "none" }, px: "3" })}
          variant="ghost"
        >
          <Menu size={19} />
        </Button>
      </Tooltip>
      <LinkButton
        className={css({ display: { base: "none", sm: "inline-flex" } })}
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
        gap: { base: "8", lg: "12" },
        gridTemplateColumns: { base: "1fr", lg: "1.1fr 0.9fr" },
        maxW: "1220px",
        mx: "auto",
        pb: { base: "8", lg: "10" },
        pt: { base: "9", md: "12", lg: "16" },
      })}
      id="top"
    >
      <div>
        <Badge tone="dark">
          <Sparkles aria-hidden="true" size={15} /> One free preview risk before payment
        </Badge>
        <h1
          className={css({
            color: "text.onDark",
            fontSize: { base: "3xl", md: "4xl" },
            fontWeight: "800",
            lineHeight: "1.08",
            maxW: "760px",
            mb: "5",
            mt: "5",
          })}
        >
          Know if your Siargao plan works before you book the risky parts.
        </h1>
        <p
          className={css({
            color: "text.onDarkMuted",
            fontSize: { base: "md", md: "lg" },
            lineHeight: "1.58",
            maxW: "650px",
            mb: "6",
          })}
        >
          A focused trip feasibility audit that checks logistics, accommodation fit, weather
          exposure, local constraints, and source confidence. Pay USD 9.99 only after the
          completeness gate passes.
        </p>
        <div
          className={css({
            alignItems: { base: "stretch", sm: "center" },
            display: "flex",
            flexDirection: { base: "column", sm: "row" },
            gap: "4",
            mb: "5",
          })}
          id="audit-start"
        >
          <LinkButton className={css({ minW: { sm: "206px" } })} href="#pricing">
            Start trip audit <ArrowRight aria-hidden="true" size={18} />
          </LinkButton>
          <strong className={css({ color: "text.onDark", fontSize: "xl" })}>USD 9.99</strong>
        </div>
        <div className={css({ display: "grid", gap: "2" })}>
          {[
            "No charge if the full audit cannot be completed",
            "Evidence, confidence, and freshness labels included",
          ].map((note) => (
            <span
              className={css({
                alignItems: "center",
                color: "text.onDarkMuted",
                display: "flex",
                fontSize: "sm",
                gap: "2",
              })}
              key={note}
            >
              <CheckCircle2 aria-hidden="true" size={17} /> {note}
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
        <h2 className={css({ color: "text.strong", fontSize: "lg", fontWeight: "800", m: 0 })}>
          Trip risk preview
        </h2>
        <Badge tone="sample">Sample</Badge>
      </div>
      <div aria-label="Overall preview rating is low risk" className={riskGauge()}>
        <div
          className={css({
            bg: "conic-gradient(from 270deg, token(colors.risk.low) 0deg 128deg, token(colors.lavender.200) 128deg 180deg, transparent 180deg 360deg)",
            borderRadius: "999px 999px 0 0",
            h: "100%",
            position: "absolute",
            top: 0,
            width: "84%",
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
            h: "72%",
            justifyContent: "center",
            position: "absolute",
            width: "64%",
          })}
        >
          <span className={css({ color: "risk.lowDark", fontSize: "xl", fontWeight: "800" })}>
            LOW RISK
          </span>
          <span className={css({ color: "text.muted", fontSize: "xs", fontWeight: "700" })}>
            4 source checks passed
          </span>
        </div>
      </div>
      <Table rows={riskRows} />
      <LinkButton className={css({ mt: "5", width: "100%" })} href="#report" variant="secondary">
        View sample report
      </LinkButton>
    </aside>
  );
}

function WhatWeCheck() {
  return (
    <section
      className={cx(sectionPanel(), css({ mt: "4", p: { base: "5", md: "6" } }))}
      id="checks"
    >
      <h2 className={sectionTitle()}>What we check</h2>
      <div
        className={css({
          display: "grid",
          gap: "3",
          gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(6, 1fr)" },
        })}
      >
        {checks.map(({ body, icon: Icon, title }) => (
          <Card className={miniFeatureCard()} key={title}>
            <Icon aria-hidden="true" className={css({ color: "violet.600", mb: "3" })} size={25} />
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
    <section
      className={cx(sectionPanel(), css({ mt: "4", p: { base: "5", md: "6" } }))}
      id="process"
    >
      <h2 className={cx(sectionTitle(), css({ textAlign: "center" }))}>How it works</h2>
      <div
        className={css({
          alignItems: "stretch",
          display: "grid",
          gap: "4",
          gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr) 1.25fr" },
        })}
      >
        {steps.map(({ body, icon: Icon, title }, index) => (
          <Card className={processCard()} key={title}>
            <span
              className={css({
                alignItems: "center",
                bg: "violet.600",
                borderRadius: "pill",
                color: "text.onDark",
                display: "inline-flex",
                fontSize: "xs",
                fontWeight: "800",
                h: "6",
                justifyContent: "center",
                left: "50%",
                position: "absolute",
                top: "-12px",
                transform: "translateX(-50%)",
                width: "6",
              })}
            >
              {index + 1}
            </span>
            <Icon
              aria-hidden="true"
              className={css({ color: "violet.600", mb: "3", mt: "2" })}
              size={29}
            />
            <h3 className={cardTitle()}>{title}</h3>
            <p className={cardBody()}>{body}</p>
          </Card>
        ))}
        <div
          className={css({
            alignItems: "center",
            background:
              "linear-gradient(rgba(5,8,42,0.34), rgba(5,8,42,0.64)), url('/images/siargao-sunset.png') center / cover",
            borderRadius: "md",
            color: "text.onDark",
            display: "flex",
            justifyContent: "center",
            minH: "166px",
            position: "relative",
          })}
        >
          <Button
            aria-label="Play audit walkthrough"
            className={css({ borderRadius: "pill", h: "14", px: "0", width: "14" })}
          >
            <Play aria-hidden="true" size={24} />
          </Button>
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  return (
    <section className={cx(sectionPanel(), css({ mt: "4", overflow: "hidden" }))}>
      <div
        className={css({ display: "grid", gridTemplateColumns: { base: "1fr", lg: "280px 1fr" } })}
      >
        <div
          aria-hidden="true"
          className={css({
            background: "url('/images/siargao-sunset.png') left center / cover",
            minH: { base: "120px", lg: "100%" },
          })}
        />
        <div className={css({ p: { base: "5", md: "6" } })}>
          <h2 className={cx(sectionTitle(), css({ textAlign: "center" }))}>
            Built as a trust layer
          </h2>
          <div
            className={css({
              display: "grid",
              gap: "3",
              gridTemplateColumns: { base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
            })}
          >
            {trustItems.map(({ body, icon: Icon, title }) => (
              <Card className={trustCard()} key={title}>
                <Icon
                  aria-hidden="true"
                  className={css({ color: "violet.600", mb: "3" })}
                  size={24}
                />
                <h3 className={cardTitle()}>{title}</h3>
                <p className={cardBody()}>{body}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SampleReport() {
  return (
    <section
      className={cx(sectionPanel(), css({ mt: "4", p: { base: "5", md: "6" } }))}
      id="report"
    >
      <div
        className={css({
          display: "grid",
          gap: "6",
          gridTemplateColumns: { base: "1fr", lg: "0.8fr 1.2fr" },
        })}
      >
        <div>
          <h2 className={sectionTitle()}>A report that shows its work</h2>
          {[
            "Top risks with severity and confidence",
            "Evidence references and source freshness",
            "Specific recommendations and host questions",
          ].map((item) => (
            <p
              className={css({
                alignItems: "center",
                color: "text",
                display: "flex",
                fontWeight: "700",
                gap: "3",
                mb: "4",
              })}
              key={item}
            >
              <Check aria-hidden="true" className={css({ color: "violet.600" })} size={19} />
              {item}
            </p>
          ))}
          <LinkButton href="#pricing" variant="secondary">
            Unlock full audit
          </LinkButton>
        </div>
        <Card className={reportPreview()}>
          <div
            className={css({
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              mb: "4",
            })}
          >
            <h3 className={css({ color: "text.strong", fontSize: "lg", fontWeight: "800", m: 0 })}>
              Siargao audit sample
            </h3>
            <Badge tone="sample">Preview</Badge>
          </div>
          <div
            className={css({
              display: "grid",
              gap: "3",
              gridTemplateColumns: { base: "1fr", md: "1fr 1fr" },
            })}
          >
            <div className={reportTile()}>
              <span className={eyebrow()}>Overall rating</span>
              <strong className={css({ color: "risk.lowDark", display: "block", fontSize: "2xl" })}>
                Green
              </strong>
              <p className={cardBody()}>Main plan works with two yellow watch items.</p>
            </div>
            <div className={reportTile()}>
              <span className={eyebrow()}>Recommendations</span>
              <p className={cardBody()}>
                Book airport transfer before 6 PM and ask the host about generator backup.
              </p>
            </div>
          </div>
          <Table
            rows={[
              { label: "Ferry fallback", status: "Cited", tone: "low" },
              { label: "Power reliability", status: "Ask host", tone: "medium" },
              { label: "Scooter assumption", status: "Verify", tone: "medium" },
            ]}
          />
          <p
            className={css({
              color: "text.soft",
              fontSize: "2xs",
              lineHeight: "1.5",
              mb: 0,
              mt: "4",
            })}
          >
            Could not verify: exact room noise level. Generated timestamp and evidence IDs appear in
            the paid report.
          </p>
        </Card>
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section className={cx(sectionPanel(), css({ mt: "4", p: { base: "5", md: "6" } }))}>
      <h2 className={cx(sectionTitle(), css({ textAlign: "center" }))}>
        Used before money is at risk
      </h2>
      <div
        className={css({
          display: "grid",
          gap: "4",
          gridTemplateColumns: { base: "1fr", md: "repeat(3, 1fr)" },
        })}
      >
        {testimonials.map((testimonial) => (
          <Card className={testimonialCard()} key={testimonial.name}>
            <Quote aria-hidden="true" className={css({ color: "violet.600", mb: "3" })} size={22} />
            <p className={css({ color: "text", fontSize: "sm", lineHeight: "1.6" })}>
              {testimonial.quote}
            </p>
            <strong className={css({ color: "text.strong", display: "block", fontSize: "sm" })}>
              {testimonial.name}
            </strong>
            <span className={css({ color: "text.soft", fontSize: "xs" })}>
              {testimonial.location}
            </span>
          </Card>
        ))}
      </div>
      <div
        aria-hidden="true"
        className={css({ display: "flex", gap: "2", justifyContent: "center", mt: "5" })}
      >
        {[0, 1, 2].map((dot) => (
          <span
            className={css({
              bg: dot === 0 ? "violet.600" : "lavender.200",
              borderRadius: "pill",
              h: "2",
              width: dot === 0 ? "6" : "2",
            })}
            key={dot}
          />
        ))}
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
        mt: "4",
        mx: "auto",
      })}
      id="pricing"
    >
      <Card className={pricingCard()}>
        <Badge tone="dark">One simple price</Badge>
        <h2 className={css({ fontSize: "4xl", lineHeight: "1", mb: "2", mt: "5" })}>USD 9.99</h2>
        <p className={css({ color: "text.onDarkMuted", mb: "5" })}>per trip risk audit</p>
        {["Free preview risk", "Pay only after completeness check", "Secure report link"].map(
          (item) => (
            <p className={css({ alignItems: "center", display: "flex", gap: "2" })} key={item}>
              <CheckCircle2 aria-hidden="true" size={18} /> {item}
            </p>
          ),
        )}
        <LinkButton className={css({ mt: "5", width: "100%" })} href="#audit-start">
          Start audit
        </LinkButton>
      </Card>
      <div className={faqAccordion()}>
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
    <footer className={cx(footer(), css({ mt: "4" }))}>
      <div
        className={css({
          display: "grid",
          gap: "6",
          gridTemplateColumns: { base: "1fr", md: "1.1fr 1fr 1fr" },
        })}
      >
        <div>
          <h2 className={css({ fontSize: "lg", mb: "2" })}>Siargao Trip Risk Audit</h2>
          <p className={css({ color: "text.onDarkMuted", lineHeight: "1.6", maxW: "330px" })}>
            A practical trust layer for travelers who need a current, cited view of what may break.
          </p>
        </div>
        <div
          className={css({
            display: "grid",
            gap: "3",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          })}
        >
          {["Product", "Report", "Company", "Legal"].map((link) => (
            <a className={footerLink()} href="#top" key={link}>
              {link}
            </a>
          ))}
        </div>
        <form className={css({ display: "grid", gap: "3" })}>
          <label className={css({ fontSize: "sm", fontWeight: "800" })} htmlFor="newsletter-email">
            Freshness notes
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
        <span>Copyright 2026 Siargao Trip Risk Audit</span>
        <span>Made with care in Siargao</span>
      </div>
    </footer>
  );
}

function sectionTitle() {
  return css({
    color: "text.strong",
    fontSize: { base: "xl", md: "2xl" },
    fontWeight: "800",
    lineHeight: "1.2",
    mb: "5",
    mt: 0,
  });
}

function cardTitle() {
  return css({ color: "text.strong", fontSize: "sm", fontWeight: "800", lineHeight: "1.25", m: 0 });
}

function cardBody() {
  return css({ color: "text.muted", fontSize: "xs", lineHeight: "1.55", mb: 0, mt: "2" });
}

function reportTile() {
  return css({
    bg: "surface.tint",
    borderColor: "border",
    borderRadius: "md",
    borderWidth: "1px",
    p: "4",
  });
}

function eyebrow() {
  return css({
    color: "text.soft",
    display: "block",
    fontSize: "2xs",
    fontWeight: "800",
    mb: "2",
    textTransform: "uppercase",
  });
}

function footerLink() {
  return css({
    color: "text.onDarkMuted",
    fontSize: "sm",
    fontWeight: "700",
    textDecoration: "none",
    _hover: { color: "text.onDark" },
  });
}
