import {
  ArrowRight,
  ChevronDown,
  CloudSun,
  Coffee,
  Compass,
  ImageIcon,
  MapPin,
  Menu,
  MessageSquarePlus,
  Mic,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Utensils,
} from "lucide-react";
import type { ReactNode } from "react";

import { BrandLockup, GradientLink, PalmMark, SignalBadge } from "@/ui/components/ask-siargao";
import { css } from "../../../styled-system/css/css";
import { cx } from "../../../styled-system/css/cx";

const savedPlaces = [
  ["Cloud 9 shortlist", "4 places"],
  ["General Luna food spots", "7 places"],
  ["Catangnan cafes", "3 places"],
];

const recentQuestions = [
  ["Is this hotel quiet?", "10:42 AM"],
  ["Best dinner near Catangnan", "Yesterday"],
  ["Will it rain this afternoon?", "Yesterday"],
  ["Surf conditions tomorrow?", "2 days ago"],
];

const tripRows = [
  ["Accommodation", "Near Cloud 9 / Catangnan"],
  ["Dates", "Jun 12-22"],
  ["Traveler type", "Couple"],
  ["Nearby area", "Cloud 9"],
  ["Today's weather", "Partly cloudy, 28°C"],
  ["Live refreshes remaining", "4"],
];

const restaurants = [
  {
    icon: Utensils,
    title: "Kermit Siargao",
    meta: "Filipino · Seafood · Sunset views",
    body: "Grilled tuna, kinilaw, fresh prawns",
    updated: "Updated 18m ago",
  },
  {
    icon: Coffee,
    title: "Shaka Cafe",
    meta: "Fusion · Healthy · Vegetarian options",
    body: "Bowls, tacos, smoothies",
    updated: "Updated 22m ago",
  },
  {
    icon: Utensils,
    title: "Bravo Restaurant",
    meta: "Italian · Wood-fired pizza · Pasta",
    body: "Pizza, handmade pasta, great wines",
    updated: "Updated 25m ago",
  },
];

export function ChatWorkspace() {
  return (
    <main className={page()}>
      <section aria-label="Ask Siargao chat workspace" className={desktopFrame()}>
        <DesktopWorkspace />
      </section>
      <MobileWorkspace />
    </main>
  );
}

function DesktopWorkspace() {
  return (
    <div className={desktopWorkspace()}>
      <LeftSidebar />
      <ConversationColumn />
      <RightSidebar />
    </div>
  );
}

function LeftSidebar() {
  return (
    <aside className={leftSidebar()} aria-label="Trip sidebar">
      <a className={logoLink()} href="/">
        <BrandLockup />
      </a>
      <GradientLink className={newQuestionButton()} href="/chat">
        + New question <ArrowRight aria-hidden="true" size={15} />
      </GradientLink>
      <SidebarSection title="CURRENT TRIP">
        <div className={activeTripCard()}>
          <div>
            <strong>June surf trip</strong>
            <span>Jun 12-22</span>
          </div>
          <span className={travelerCount()}>2</span>
        </div>
      </SidebarSection>
      <SidebarSection title="SAVED PLACES">
        {savedPlaces.map(([title, count]) => (
          <SidebarRow key={title} label={title} value={count} />
        ))}
        <a className={sidebarLink()} href="/chat">
          View all saved places
        </a>
      </SidebarSection>
      <SidebarSection title="RECENT QUESTIONS">
        {recentQuestions.map(([title, time]) => (
          <SidebarRow key={title} label={title} value={time} />
        ))}
        <a className={sidebarLink()} href="/chat">
          View all history
        </a>
      </SidebarSection>
      <div className={inviteCard()}>
        <strong>Love Ask Siargao?</strong>
        <span>Invite friends and unlock extra refreshes.</span>
        <a href="/chat">Invite friends →</a>
      </div>
    </aside>
  );
}

function SidebarSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={sidebarSection()}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={sidebarRow()}>
      <span>{label}</span>
      <small>{value}</small>
    </div>
  );
}

function ConversationColumn() {
  return (
    <section className={conversationColumn()} aria-label="Ask Siargao conversation">
      <ChatHeader />
      <div className={messageList()}>
        <UserMessage text="Is this accommodation near Cloud 9 quiet at night?" />
        <AssistantMessage
          text="Yes, it's generally quiet at night. It sits on a small lane set back from the main road, and most guests mention low noise after 10pm."
          timestamp="10:44 AM"
        >
          <EvidenceCard />
        </AssistantMessage>
        <UserMessage text="Where should we eat tonight near Cloud 9?" />
        <AssistantMessage
          text="Here are great dinner spots within 10 minutes of Cloud 9 with good reviews tonight."
          timestamp="10:48 AM"
        >
          <RestaurantCards />
        </AssistantMessage>
        <UserMessage text="What weather changes should we expect today?" />
        <AssistantMessage
          text="Expect more clouds and a higher chance of rain this afternoon, with stronger winds later. Best surf early morning."
          timestamp="10:51 AM"
        >
          <WeatherEvidenceCard />
        </AssistantMessage>
      </div>
      <Composer />
    </section>
  );
}

function ChatHeader() {
  return (
    <header className={chatHeader()}>
      <div>
        <h1>Ask Siargao</h1>
        <span className={statusLabel()}>
          <span className={statusDot()} />
          Local travel assistant
        </span>
      </div>
      <div className={headerActions()}>
        <button aria-label="Refresh answer context" type="button">
          <RefreshCw aria-hidden="true" size={17} />
        </button>
        <button aria-label="Share trip chat" type="button">
          <Share2 aria-hidden="true" size={17} />
        </button>
        <span aria-label="Traveler profile" className={avatar()}>
          A
        </span>
      </div>
    </header>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className={userMessage()}>
      <p>{text}</p>
    </div>
  );
}

function AssistantMessage({
  children,
  text,
  timestamp,
}: {
  children?: ReactNode;
  text: string;
  timestamp: string;
}) {
  return (
    <div className={assistantWrap()}>
      <PalmMark className={assistantAvatar()} />
      <div className={assistantMessage()}>
        <p>{text}</p>
        {children}
        <small>{timestamp}</small>
      </div>
    </div>
  );
}

function EvidenceCard() {
  return (
    <article className={evidenceCard()}>
      <div className={thumb()}>
        <ImageIcon aria-hidden="true" size={20} />
      </div>
      <div>
        <h2>Harana Surf Resort</h2>
        <p>Guest reviews (May 2024)</p>
        <blockquote>"Very quiet at night, slept well every night." — Guest review</blockquote>
        <BadgeRow updated="Updated 12m ago" />
      </div>
    </article>
  );
}

function RestaurantCards() {
  return (
    <div className={restaurantGrid()}>
      {restaurants.map(({ body, icon: Icon, meta, title, updated }) => (
        <article className={restaurantCard()} key={title}>
          <span className={restaurantThumb()}>
            <Icon aria-hidden="true" size={18} />
          </span>
          <h2>{title}</h2>
          <p>{meta}</p>
          <strong>{body}</strong>
          <BadgeRow updated={updated} />
        </article>
      ))}
    </div>
  );
}

function WeatherEvidenceCard() {
  return (
    <article className={weatherEvidence()}>
      <CloudSun aria-hidden="true" size={24} />
      <div>
        <h2>Siargao Weather Update</h2>
        <p>PAGASA + Local Station Data</p>
        <ul>
          <li>Rain chance up to 60% after 2pm.</li>
          <li>Winds increase to 22-25 km/h from the southwest.</li>
        </ul>
        <BadgeRow updated="Updated 12m ago" />
      </div>
    </article>
  );
}

function BadgeRow({ updated }: { updated: string }) {
  return (
    <div className={badgeRow()}>
      <SignalBadge>Fresh</SignalBadge>
      <SignalBadge tone="high">High confidence</SignalBadge>
      <SignalBadge tone="local">{updated}</SignalBadge>
      <SignalBadge tone="local">Local source</SignalBadge>
    </div>
  );
}

function Composer() {
  return (
    <footer className={composerWrap()}>
      <div className={quickChips()}>
        {["quiet hotels", "restaurants tonight", "weather now"].map((chip) => (
          <a href="/chat" key={chip}>
            {chip}
          </a>
        ))}
      </div>
      <div className={composer()}>
        <button aria-label="Add attachment" type="button">
          <Plus aria-hidden="true" size={18} />
        </button>
        <input
          aria-label="Ask anything about your Siargao trip"
          placeholder="Ask anything about your Siargao trip..."
        />
        <button aria-label="Send question" type="button">
          <Send aria-hidden="true" size={18} />
        </button>
      </div>
      <p>Answers use live local data. Check important details before you go.</p>
    </footer>
  );
}

function RightSidebar() {
  return (
    <aside className={rightSidebar()} aria-label="Trip context sidebar">
      <ContextCard title="Trip context">
        {tripRows.map(([label, value]) => (
          <div className={contextRow()} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </ContextCard>
      <ContextCard title="Cloud 9 Weather">
        <WeatherMetric temperature="28°C" />
        <MetricGrid
          rows={[
            ["Rain chance", "35%"],
            ["Wind", "18 km/h"],
            ["Humidity", "77%"],
          ]}
        />
        <SignalBadge>Updated 12 min ago</SignalBadge>
      </ContextCard>
      <ContextCard title="Live surf conditions">
        <div className={surfHeader()}>
          <strong>Cloud 9</strong>
          <SignalBadge>Good</SignalBadge>
        </div>
        <MetricGrid
          rows={[
            ["Waves", "2-3 ft"],
            ["Tide", "Low 0.6 m"],
            ["Wind", "18 km/h SW"],
          ]}
        />
        <SignalBadge tone="local">Updated 20 min ago</SignalBadge>
      </ContextCard>
      <a className={areaGuideCard()} href="/chat">
        <span>General Luna, Siargao</span>
        <strong>View area guide →</strong>
      </a>
    </aside>
  );
}

function ContextCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={contextCard()}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function WeatherMetric({ temperature }: { temperature: string }) {
  return (
    <div className={weatherMetric()}>
      <CloudSun aria-hidden="true" size={24} />
      <div>
        <strong>{temperature}</strong>
        <span>Feels like 30°C</span>
      </div>
    </div>
  );
}

function MetricGrid({ rows }: { rows: string[][] }) {
  return (
    <div className={metricGrid()}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function MobileWorkspace() {
  return (
    <section className={mobileWorkspace()} aria-label="Ask Siargao mobile chat">
      <header className={mobileHeader()}>
        <a aria-label="Open menu" href="/">
          <Menu aria-hidden="true" size={22} />
        </a>
        <h1>Ask Siargao</h1>
        <a aria-label="New chat" href="/chat">
          <MessageSquarePlus aria-hidden="true" size={22} />
        </a>
      </header>
      <button className={tripPill()} type="button">
        <MapPin aria-hidden="true" size={15} />
        <span>Cloud 9 area · Jun 24-Jul 7 · </span>
        <strong>24 live refreshes left</strong>
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      <div className={mobileMessages()}>
        <div className={mobileUserMessage()}>
          Will my place be quiet and where should we eat tonight?
        </div>
        <div className={mobileAssistantMessage()}>
          <PalmMark className={assistantAvatar()} />
          <div>
            <p>
              Yes, your place should be quiet most nights. Cloud 9 is lively in the late afternoon
              and early evening, then it settles down.
            </p>
            <p>
              For dinner, you have great options within a short trike ride-fresh, local, and good
              vibes.
            </p>
            <div className={mobileCards()}>
              <MobileRecommendation title="Kermit Siargao" subtitle="Seafood · Sunset views" />
              <MobileRecommendation title="Bravo Restaurant" subtitle="Pizza · Pasta · Wine" />
            </div>
          </div>
        </div>
      </div>
      <div className={mobileComposer()}>
        <button aria-label="Add detail" type="button">
          <Plus aria-hidden="true" size={18} />
        </button>
        <input aria-label="Ask Ask Siargao on mobile" placeholder="Ask anything..." />
        <button aria-label="Record voice question" type="button">
          <Mic aria-hidden="true" size={18} />
        </button>
        <button aria-label="Send mobile question" type="button">
          <Send aria-hidden="true" size={18} />
        </button>
      </div>
    </section>
  );
}

function MobileRecommendation({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <article>
      <Utensils aria-hidden="true" size={17} />
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <SignalBadge>Fresh</SignalBadge>
    </article>
  );
}

function page() {
  return css({
    background: "linear-gradient(180deg, #062f39 0%, #08232e 44%, #07141d 100%)",
    minH: "100vh",
    overflowX: "hidden",
    p: { base: "0", lg: "5" },
  });
}

function desktopFrame() {
  return css({
    background:
      "linear-gradient(140deg, rgba(7,20,29,0.98), rgba(8,35,46,0.96) 52%, rgba(92,61,43,0.72))",
    borderColor: "rgba(255,247,223,0.18)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "0 28px 90px rgba(0,0,0,0.38)",
    display: { base: "none", lg: "block" },
    maxW: "1320px",
    minH: "820px",
    mx: "auto",
    overflow: "hidden",
  });
}

function desktopWorkspace() {
  return css({
    display: "grid",
    gridTemplateColumns: "286px minmax(0, 1fr) 320px",
    minH: "820px",
  });
}

function leftSidebar() {
  return css({
    bg: "rgba(5,22,28,0.94)",
    borderRightColor: "rgba(255,247,223,0.12)",
    borderRightWidth: "1px",
    display: "flex",
    flexDirection: "column",
    gap: "5",
    p: "5",
  });
}

function logoLink() {
  return css({ textDecoration: "none" });
}

function newQuestionButton() {
  return css({
    justifyContent: "space-between",
    width: "100%",
  });
}

function sidebarSection() {
  return css({
    borderTopColor: "rgba(255,247,223,0.12)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "2",
    pt: "4",
    "& h2": {
      color: "rgba(255,247,223,0.5)",
      fontSize: "2xs",
      fontWeight: "900",
      letterSpacing: "0.08em",
      m: 0,
    },
  });
}

function activeTripCard() {
  return css({
    alignItems: "center",
    bg: "rgba(255,247,223,0.08)",
    borderColor: "rgba(127,226,192,0.18)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "flex",
    justifyContent: "space-between",
    p: "3",
    "& strong": {
      color: "text.onDark",
      display: "block",
      fontSize: "sm",
    },
    "& span": {
      color: "text.onDarkMuted",
      display: "block",
      fontSize: "xs",
      mt: "1",
    },
  });
}

function travelerCount() {
  return css({
    alignItems: "center",
    bg: "rgba(127,226,192,0.18)",
    borderRadius: "pill",
    color: "text.onDark",
    display: "inline-flex",
    h: "7",
    justifyContent: "center",
    width: "7",
  });
}

function sidebarRow() {
  return css({
    display: "grid",
    gap: "1",
    py: "1",
    "& span": {
      color: "text.onDark",
      fontSize: "xs",
      fontWeight: "800",
    },
    "& small": {
      color: "rgba(226,220,247,0.58)",
      fontSize: "2xs",
    },
  });
}

function sidebarLink() {
  return css({
    color: "#7fe2c0",
    fontSize: "xs",
    fontWeight: "900",
    mt: "1",
    textDecoration: "none",
  });
}

function inviteCard() {
  return css({
    background:
      "linear-gradient(180deg, rgba(6,47,57,0.08), rgba(6,47,57,0.88)), url('/images/siargao-sunset.png') center / cover",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    mt: "auto",
    p: "4",
    "& strong": { color: "text.onDark", fontSize: "sm" },
    "& span": { color: "text.onDarkMuted", fontSize: "xs", lineHeight: "1.45" },
    "& a": {
      color: "text.onDark",
      fontSize: "xs",
      fontWeight: "900",
      textDecoration: "none",
    },
  });
}

function conversationColumn() {
  return css({
    bg: "#fff7df",
    color: "text",
    display: "grid",
    gridTemplateRows: "74px 1fr auto",
    minW: 0,
  });
}

function chatHeader() {
  return css({
    alignItems: "center",
    bg: "rgba(255,247,223,0.9)",
    borderBottomColor: "rgba(8,47,57,0.12)",
    borderBottomWidth: "1px",
    display: "flex",
    justifyContent: "space-between",
    px: "6",
    "& h1": {
      color: "#08232e",
      fontSize: "lg",
      fontWeight: "900",
      m: 0,
    },
  });
}

function statusLabel() {
  return css({
    alignItems: "center",
    color: "text.muted",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "800",
    gap: "2",
  });
}

function statusDot() {
  return css({
    bg: "#0f9f74",
    borderRadius: "pill",
    display: "inline-block",
    h: "2",
    width: "2",
  });
}

function headerActions() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "2",
    "& button": {
      alignItems: "center",
      bg: "#fffdf5",
      borderColor: "rgba(8,47,57,0.14)",
      borderRadius: "md",
      borderWidth: "1px",
      color: "#0a6574",
      cursor: "pointer",
      display: "inline-flex",
      h: "9",
      justifyContent: "center",
      width: "9",
    },
  });
}

function avatar() {
  return css({
    alignItems: "center",
    bg: "#0a6574",
    borderRadius: "pill",
    color: "text.onDark",
    display: "inline-flex",
    fontSize: "xs",
    fontWeight: "900",
    h: "9",
    justifyContent: "center",
    width: "9",
  });
}

function messageList() {
  return css({
    background:
      "linear-gradient(90deg, rgba(8,47,57,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(8,47,57,0.04) 1px, transparent 1px)",
    backgroundSize: "54px 54px",
    display: "grid",
    gap: "5",
    overflowY: "auto",
    p: "6",
  });
}

function userMessage() {
  return css({
    justifySelf: "end",
    maxW: "74%",
    "& p": {
      background: "linear-gradient(135deg, #0a6574, #083f4b)",
      borderRadius: "md",
      color: "text.onDark",
      fontSize: "sm",
      fontWeight: "800",
      lineHeight: "1.45",
      m: 0,
      p: "4",
    },
  });
}

function assistantWrap() {
  return css({
    alignItems: "start",
    display: "grid",
    gap: "3",
    gridTemplateColumns: "36px minmax(0, 1fr)",
    maxW: "86%",
  });
}

function assistantAvatar() {
  return css({
    h: "8",
    width: "8",
  });
}

function assistantMessage() {
  return css({
    bg: "#fffdf5",
    borderColor: "rgba(8,47,57,0.12)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "0 16px 42px rgba(8,47,57,0.1)",
    display: "grid",
    gap: "4",
    p: "4",
    "& > p": {
      color: "text",
      fontSize: "sm",
      lineHeight: "1.55",
      m: 0,
    },
    "& small": {
      color: "text.soft",
      fontSize: "2xs",
      fontWeight: "800",
    },
  });
}

function evidenceCard() {
  return css({
    bg: "rgba(10,101,116,0.06)",
    borderColor: "rgba(8,47,57,0.14)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "3",
    gridTemplateColumns: "84px minmax(0, 1fr)",
    p: "3",
    "& h2": { color: "text.strong", fontSize: "sm", m: 0 },
    "& p": { color: "text.muted", fontSize: "xs", m: 0 },
    "& blockquote": {
      color: "text",
      fontSize: "xs",
      lineHeight: "1.45",
      m: "2 0",
    },
  });
}

function thumb() {
  return css({
    alignItems: "center",
    background:
      "linear-gradient(rgba(5,8,42,0.1), rgba(5,8,42,0.2)), url('/images/siargao-sunset.png') center / cover",
    borderRadius: "md",
    color: "text.onDark",
    display: "flex",
    justifyContent: "center",
    minH: "96px",
  });
}

function badgeRow() {
  return css({
    display: "flex",
    flexWrap: "wrap",
    gap: "2",
  });
}

function restaurantGrid() {
  return css({
    display: "grid",
    gap: "3",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  });
}

function restaurantCard() {
  return css({
    bg: "rgba(255,255,255,0.64)",
    borderColor: "rgba(8,47,57,0.14)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    p: "3",
    "& h2": { color: "text.strong", fontSize: "xs", m: 0 },
    "& p": { color: "text.muted", fontSize: "2xs", lineHeight: "1.35", m: 0 },
    "& strong": { color: "text", fontSize: "2xs", lineHeight: "1.35" },
  });
}

function restaurantThumb() {
  return css({
    alignItems: "center",
    bg: "#0a6574",
    borderRadius: "md",
    color: "text.onDark",
    display: "inline-flex",
    h: "9",
    justifyContent: "center",
    width: "9",
  });
}

function weatherEvidence() {
  return css({
    bg: "rgba(255,211,111,0.16)",
    borderColor: "rgba(141,91,50,0.18)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "3",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    p: "3",
    "& svg": { color: "#0a6574" },
    "& h2": { color: "text.strong", fontSize: "sm", m: 0 },
    "& p": { color: "text.muted", fontSize: "xs", m: 0 },
    "& ul": { color: "text", fontSize: "xs", lineHeight: "1.45", m: "2 0", pl: "4" },
  });
}

function composerWrap() {
  return css({
    bg: "rgba(255,247,223,0.94)",
    borderTopColor: "rgba(8,47,57,0.12)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "3",
    p: "5",
    "& > p": {
      color: "text.soft",
      fontSize: "2xs",
      m: 0,
      textAlign: "center",
    },
  });
}

function quickChips() {
  return css({
    display: "flex",
    gap: "2",
    justifyContent: "center",
    "& a": {
      bg: "#fffdf5",
      borderColor: "rgba(8,47,57,0.14)",
      borderRadius: "pill",
      borderWidth: "1px",
      color: "#0a6574",
      fontSize: "xs",
      fontWeight: "900",
      px: "3",
      py: "1",
      textDecoration: "none",
    },
  });
}

function composer() {
  return css({
    alignItems: "center",
    bg: "#fffdf5",
    borderColor: "rgba(8,47,57,0.14)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "40px 1fr 40px",
    minH: "56px",
    p: "2",
    "& button": {
      alignItems: "center",
      borderRadius: "md",
      borderWidth: "0",
      cursor: "pointer",
      display: "inline-flex",
      h: "10",
      justifyContent: "center",
      width: "10",
    },
    "& button:first-child": {
      bg: "rgba(10,101,116,0.1)",
      color: "#0a6574",
    },
    "& button:last-child": {
      bg: "#0a6574",
      color: "text.onDark",
    },
    "& input": {
      borderWidth: "0",
      color: "text",
      fontSize: "sm",
      minW: 0,
      outline: "none",
      width: "100%",
    },
  });
}

function rightSidebar() {
  return css({
    bg: "#f6ead2",
    borderLeftColor: "rgba(8,47,57,0.14)",
    borderLeftWidth: "1px",
    display: "grid",
    gap: "4",
    p: "5",
  });
}

function contextCard() {
  return css({
    bg: "#fffdf5",
    borderColor: "rgba(8,47,57,0.13)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "0 14px 36px rgba(8,47,57,0.09)",
    display: "grid",
    gap: "3",
    p: "4",
    "& h2": {
      color: "text.strong",
      fontSize: "sm",
      fontWeight: "900",
      m: 0,
    },
  });
}

function contextRow() {
  return css({
    display: "grid",
    gap: "1",
    "& span": { color: "text.soft", fontSize: "2xs", fontWeight: "900" },
    "& strong": { color: "text", fontSize: "xs", lineHeight: "1.35" },
  });
}

function weatherMetric() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "3",
    "& svg": { color: "#0a6574" },
    "& strong": { color: "text.strong", display: "block", fontSize: "2xl" },
    "& span": { color: "text.muted", fontSize: "xs" },
  });
}

function metricGrid() {
  return css({
    display: "grid",
    gap: "2",
    gridTemplateColumns: "repeat(3, 1fr)",
    "& div": {
      bg: "rgba(10,101,116,0.08)",
      borderRadius: "md",
      p: "2",
    },
    "& span": {
      color: "text.soft",
      display: "block",
      fontSize: "2xs",
      fontWeight: "900",
    },
    "& strong": {
      color: "text.strong",
      fontSize: "xs",
    },
  });
}

function surfHeader() {
  return css({
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    "& strong": { color: "text.strong", fontSize: "md" },
  });
}

function areaGuideCard() {
  return css({
    background:
      "linear-gradient(180deg, rgba(5,8,42,0.1), rgba(5,8,42,0.72)), url('/images/siargao-sunset.png') center / cover",
    borderRadius: "md",
    color: "text.onDark",
    display: "grid",
    minH: "154px",
    p: "4",
    textDecoration: "none",
    "& span": { alignSelf: "end", fontSize: "xs", fontWeight: "800" },
    "& strong": {
      bg: "surface",
      borderRadius: "md",
      color: "text.strong",
      display: "inline-flex",
      fontSize: "xs",
      fontWeight: "900",
      justifySelf: "start",
      mt: "2",
      px: "3",
      py: "2",
    },
  });
}

function mobileWorkspace() {
  return css({
    bg: "#07141d",
    color: "text.onDark",
    display: { base: "grid", lg: "none" },
    gridTemplateRows: "auto auto 1fr auto",
    minH: "100vh",
  });
}

function mobileHeader() {
  return css({
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.1)",
    borderBottomWidth: "1px",
    display: "grid",
    gridTemplateColumns: "44px 1fr 44px",
    minH: "62px",
    px: "3",
    "& h1": {
      fontSize: "md",
      fontWeight: "900",
      m: 0,
      textAlign: "center",
    },
    "& a": {
      alignItems: "center",
      color: "text.onDark",
      display: "inline-flex",
      h: "11",
      justifyContent: "center",
      textDecoration: "none",
      width: "11",
    },
  });
}

function tripPill() {
  return css({
    alignItems: "center",
    bg: "rgba(255,247,223,0.08)",
    borderColor: "rgba(127,226,192,0.2)",
    borderRadius: "pill",
    borderWidth: "1px",
    color: "text.onDarkMuted",
    display: "flex",
    fontSize: "2xs",
    fontWeight: "800",
    gap: "1",
    justifySelf: "center",
    maxW: "calc(100vw - 24px)",
    minH: "34px",
    mt: "3",
    px: "3",
    "& strong": {
      color: "#67d889",
    },
  });
}

function mobileMessages() {
  return css({
    display: "grid",
    gap: "5",
    overflowY: "auto",
    p: "4",
  });
}

function mobileUserMessage() {
  return css({
    background: "linear-gradient(135deg, #0a6574, #083f4b)",
    borderRadius: "md",
    color: "text.onDark",
    fontSize: "sm",
    fontWeight: "800",
    justifySelf: "end",
    lineHeight: "1.45",
    maxW: "82%",
    p: "4",
  });
}

function mobileAssistantMessage() {
  return css({
    alignItems: "start",
    display: "grid",
    gap: "3",
    gridTemplateColumns: "34px minmax(0, 1fr)",
    "& > div": {
      bg: "rgba(255,247,223,0.09)",
      borderColor: "rgba(255,247,223,0.14)",
      borderRadius: "md",
      borderWidth: "1px",
      p: "4",
    },
    "& p": {
      color: "text.onDarkMuted",
      fontSize: "sm",
      lineHeight: "1.55",
      mt: 0,
    },
  });
}

function mobileCards() {
  return css({
    display: "grid",
    gap: "2",
    "& article": {
      alignItems: "center",
      bg: "rgba(127,226,192,0.1)",
      borderRadius: "md",
      display: "grid",
      gap: "2",
      gridTemplateColumns: "24px 1fr auto",
      p: "3",
    },
    "& svg": { color: "#7fe2c0" },
    "& strong": { color: "text.onDark", display: "block", fontSize: "xs" },
    "& span": { color: "text.onDarkMuted", display: "block", fontSize: "2xs" },
  });
}

function mobileComposer() {
  return css({
    alignItems: "center",
    bg: "rgba(7,20,29,0.98)",
    borderTopColor: "rgba(255,247,223,0.1)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "38px 1fr 38px 38px",
    p: "3",
    "& button": {
      alignItems: "center",
      bg: "rgba(255,255,255,0.1)",
      borderColor: "rgba(255,255,255,0.16)",
      borderRadius: "pill",
      borderWidth: "1px",
      color: "text.onDark",
      display: "inline-flex",
      h: "10",
      justifyContent: "center",
      width: "10",
    },
    "& button:last-child": {
      bg: "#0a6574",
      borderColor: "#0a6574",
    },
    "& input": {
      bg: "rgba(255,255,255,0.1)",
      borderColor: "rgba(255,255,255,0.16)",
      borderRadius: "pill",
      borderWidth: "1px",
      color: "text.onDark",
      minH: "40px",
      minW: 0,
      px: "4",
      width: "100%",
      _placeholder: { color: "text.onDarkMuted" },
    },
  });
}
