import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  ChevronDown,
  Clock3,
  CloudSun,
  ImageIcon,
  MapPin,
  Menu,
  MessageSquarePlus,
  Mic,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Users,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BrandLockup,
  BrowserDots,
  GradientLink,
  PalmMark,
  SignalBadge,
} from "@/ui/components/ask-siargao";
import { css } from "../../../styled-system/css/css";

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
  { icon: BedDouble, label: "Accommodation", value: "Near Cloud 9 / Catangnan" },
  { icon: CalendarDays, label: "Dates", value: "Jun 12-22" },
  { icon: Users, label: "Traveler type", value: "Couple" },
  { icon: MapPin, label: "Nearby area", value: "Cloud 9" },
  { icon: CloudSun, label: "Today's weather", value: "Partly cloudy, 28°C" },
  { icon: Clock3, label: "Live refreshes remaining", value: "4" },
];

const restaurants = [
  {
    image:
      "linear-gradient(rgba(24,12,40,0.06), rgba(24,12,40,0.12)), url('/images/siargao-sunset.png')",
    title: "Kermit Siargao",
    meta: "Filipino · Seafood · Sunset views",
    body: "Grilled tuna, kinilaw, fresh prawns",
    updated: "Updated 18m ago",
  },
  {
    image: "linear-gradient(rgba(24,12,40,0.08), rgba(24,12,40,0.18)), url('/images/hero-bg.png')",
    title: "Shaka Cafe",
    meta: "Fusion · Healthy · Vegetarian options",
    body: "Bowls, tacos, smoothies",
    updated: "Updated 22m ago",
  },
  {
    image:
      "linear-gradient(rgba(24,12,40,0.08), rgba(24,12,40,0.18)), url('/images/siargao-sunset.png')",
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
        <BrowserDots />
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
      <Link className={logoLink()} href="/">
        <BrandLockup />
      </Link>
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
        <Link className={sidebarLink()} href="/chat">
          View all saved places
        </Link>
      </SidebarSection>
      <SidebarSection title="RECENT QUESTIONS">
        {recentQuestions.map(([title, time]) => (
          <SidebarRow key={title} label={title} value={time} />
        ))}
        <Link className={sidebarLink()} href="/chat">
          View all history
        </Link>
      </SidebarSection>
      <div className={inviteCard()}>
        <strong>Love Ask Siargao?</strong>
        <span>Invite friends and unlock extra refreshes.</span>
        <Link href="/chat">Invite friends →</Link>
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
        <HeaderIconButton label="Refresh answer context">
          <RefreshCw aria-hidden="true" size={17} />
        </HeaderIconButton>
        <HeaderIconButton label="Share trip chat">
          <Share2 aria-hidden="true" size={17} />
        </HeaderIconButton>
        <span aria-label="Traveler profile" className={avatar()} role="img">
          A
        </span>
      </div>
    </header>
  );
}

function HeaderIconButton({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="h-9 w-9 rounded-lg border-[#c8bee9] bg-white text-[#5d3ed1] hover:bg-[#f5f3ff] hover:text-[#4c31b8]"
          size="icon"
          type="button"
          variant="outline"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
      {restaurants.map(({ body, image, meta, title, updated }) => (
        <article className={restaurantCard()} key={title}>
          <span aria-hidden="true" className={restaurantPhoto()} style={{ backgroundImage: image }}>
            <Utensils size={16} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{meta}</p>
            <strong>{body}</strong>
            <BadgeRow updated={updated} />
          </div>
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
          <Link href="/chat" key={chip}>
            {chip}
          </Link>
        ))}
      </div>
      <div className={composer()}>
        <Button
          aria-label="Add attachment"
          className="h-8 w-8 rounded-lg border-0 bg-[rgba(108,70,232,0.1)] text-[#5d3ed1] hover:bg-[rgba(108,70,232,0.16)]"
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" size={18} />
        </Button>
        <Input
          aria-label="Ask anything about your Siargao trip"
          className="h-8 border-0 bg-transparent px-0 text-sm text-[#17184f] shadow-none placeholder:text-[#8483a8] focus-visible:border-transparent focus-visible:ring-0"
          placeholder="Ask anything about your Siargao trip..."
        />
        <Button
          aria-label="Send question"
          className="h-8 w-8 rounded-lg border-0 bg-[#5d3ed1] text-white hover:bg-[#6c46e8]"
          size="icon"
          type="button"
        >
          <Send aria-hidden="true" size={18} />
        </Button>
      </div>
      <p>Answers use live local data. Check important details before you go.</p>
    </footer>
  );
}

function RightSidebar() {
  return (
    <aside className={rightSidebar()} aria-label="Trip context sidebar">
      <ContextCard title="Trip context">
        {tripRows.map(({ icon: Icon, label, value }) => (
          <div className={contextRow()} key={label}>
            <Icon aria-hidden="true" size={16} />
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
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
      <Link className={areaGuideCard()} href="/chat">
        <span>General Luna, Siargao</span>
        <strong>View area guide →</strong>
      </Link>
    </aside>
  );
}

function ContextCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={contextCard()}>
      <h2>
        <span>{title}</span>
        {title === "Trip context" ? <MoreHorizontal aria-hidden="true" size={15} /> : null}
      </h2>
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
        <MobileMenuSheet />
        <h1>Ask Siargao</h1>
        <Link aria-label="New chat" href="/chat">
          <MessageSquarePlus aria-hidden="true" size={22} />
        </Link>
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
        <Button
          aria-label="Add detail"
          className="h-10 w-10 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/15"
          size="icon"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" size={18} />
        </Button>
        <Input
          aria-label="Ask Ask Siargao on mobile"
          className="h-10 rounded-full border border-white/15 bg-white/10 px-4 text-sm text-white placeholder:text-[#d8d5f4] focus-visible:border-[#a486ff] focus-visible:ring-[#a486ff]/35"
          placeholder="Ask anything..."
        />
        <Button
          aria-label="Record voice question"
          className="h-10 w-10 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/15"
          size="icon"
          type="button"
          variant="outline"
        >
          <Mic aria-hidden="true" size={18} />
        </Button>
        <Button
          aria-label="Send mobile question"
          className="h-10 w-10 rounded-full border border-[#5d3ed1] bg-[#5d3ed1] text-white hover:bg-[#6c46e8]"
          size="icon"
          type="button"
        >
          <Send aria-hidden="true" size={18} />
        </Button>
      </div>
    </section>
  );
}

function MobileMenuSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button aria-label="Open menu" className={mobileHeaderAction()} type="button">
          <Menu aria-hidden="true" size={22} />
        </button>
      </SheetTrigger>
      <SheetContent className={mobileSheetContent()} side="left">
        <SheetHeader className={mobileSheetHeader()}>
          <BrandLockup />
          <SheetTitle className={css({ color: "text.onDark", fontSize: "lg", fontWeight: "900" })}>
            Trip workspace
          </SheetTitle>
          <SheetDescription className={css({ color: "text.onDarkMuted", lineHeight: "1.6" })}>
            Saved places, recent questions, and live trip context.
          </SheetDescription>
        </SheetHeader>
        <div className={mobileSheetSection()}>
          <h2>Saved places</h2>
          {savedPlaces.map(([title, count]) => (
            <SidebarRow key={title} label={title} value={count} />
          ))}
        </div>
        <div className={mobileSheetSection()}>
          <h2>Recent questions</h2>
          {recentQuestions.map(([title, time]) => (
            <SidebarRow key={title} label={title} value={time} />
          ))}
        </div>
        <GradientLink href="/chat">New question</GradientLink>
      </SheetContent>
    </Sheet>
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
    alignItems: { lg: "center" },
    background:
      "linear-gradient(90deg, rgba(5,8,42,0.96) 0%, rgba(7,10,48,0.88) 34%, rgba(43,24,106,0.42) 68%, rgba(5,8,42,0.62) 100%), linear-gradient(180deg, rgba(5,8,42,0.08) 0%, rgba(5,8,42,0.28) 46%, rgba(5,8,42,0.94) 100%), url('/images/hero-bg.png')",
    backgroundPosition: "center, center, center",
    backgroundRepeat: "no-repeat, no-repeat, no-repeat",
    backgroundSize: "100% 100%, 100% 100%, cover",
    display: { lg: "grid" },
    minH: "100vh",
    overflowX: "hidden",
    p: { base: "0", lg: "5" },
  });
}

function desktopFrame() {
  return css({
    background:
      "linear-gradient(140deg, rgba(5,8,42,0.98), rgba(16,18,74,0.95) 54%, rgba(93,62,209,0.48))",
    borderColor: "rgba(180,160,255,0.28)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "coastalFrame",
    display: { base: "none", lg: "block" },
    h: "calc(100vh - 40px)",
    maxW: "1160px",
    minH: "0",
    mx: "auto",
    overflow: "hidden",
    position: "relative",
    width: "100%",
  });
}

function desktopWorkspace() {
  return css({
    display: "grid",
    gridTemplateColumns: "230px minmax(0, 1fr) 284px",
    h: "100%",
    minH: 0,
  });
}

function leftSidebar() {
  return css({
    bg: "rgba(5,8,42,0.9)",
    borderRightColor: "rgba(184,166,255,0.22)",
    borderRightWidth: "1px",
    display: "flex",
    flexDirection: "column",
    gap: "4",
    minH: 0,
    overflow: "hidden",
    p: "4",
    pt: "12",
  });
}

function logoLink() {
  return css({ textDecoration: "none" });
}

function newQuestionButton() {
  return css({
    justifyContent: "space-between",
    minH: "44px",
    width: "100%",
  });
}

function sidebarSection() {
  return css({
    borderTopColor: "rgba(184,166,255,0.18)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "1",
    pt: "3",
    "& h2": {
      color: "rgba(226,220,247,0.58)",
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
    bg: "rgba(255,255,255,0.08)",
    borderColor: "rgba(184,166,255,0.28)",
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
    bg: "rgba(164,134,255,0.24)",
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
    color: "violet.400",
    fontSize: "xs",
    fontWeight: "900",
    mt: "1",
    textDecoration: "none",
  });
}

function inviteCard() {
  return css({
    background:
      "linear-gradient(180deg, rgba(5,8,42,0.08), rgba(5,8,42,0.88)), url('/images/siargao-sunset.png') center / cover",
    borderColor: "rgba(184,166,255,0.24)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    mt: "auto",
    minH: "134px",
    p: "3",
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
    bg: "lavender.50",
    color: "text",
    display: "grid",
    gridTemplateRows: "68px minmax(0, 1fr) auto",
    minH: 0,
    minW: 0,
  });
}

function chatHeader() {
  return css({
    alignItems: "center",
    bg: "rgba(255,255,255,0.9)",
    borderBottomColor: "rgba(200,190,233,0.72)",
    borderBottomWidth: "1px",
    display: "flex",
    justifyContent: "space-between",
    px: "5",
    "& h1": {
      color: "text.strong",
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
  });
}

function avatar() {
  return css({
    alignItems: "center",
    bg: "violet.650",
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
      "linear-gradient(90deg, rgba(108,70,232,0.05) 1px, transparent 1px), linear-gradient(0deg, rgba(108,70,232,0.05) 1px, transparent 1px)",
    backgroundSize: "54px 54px",
    display: "grid",
    gap: "2",
    minH: 0,
    overflowY: "auto",
    p: "3",
  });
}

function userMessage() {
  return css({
    justifySelf: "end",
    maxW: "74%",
    "& p": {
      background: "token(gradients.cta)",
      borderRadius: "md",
      color: "text.onDark",
      fontSize: "xs",
      fontWeight: "800",
      lineHeight: "1.45",
      m: 0,
      px: "4",
      py: "3",
    },
  });
}

function assistantWrap() {
  return css({
    alignItems: "start",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    maxW: "86%",
  });
}

function assistantAvatar() {
  return css({
    h: "7",
    width: "7",
  });
}

function assistantMessage() {
  return css({
    bg: "surface",
    borderColor: "rgba(200,190,233,0.74)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "0 16px 42px rgba(76,49,184,0.1)",
    display: "grid",
    gap: "2",
    p: "3",
    "& > p": {
      color: "text",
      fontSize: "xs",
      lineHeight: "1.42",
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
    bg: "rgba(108,70,232,0.06)",
    borderColor: "rgba(200,190,233,0.82)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "78px minmax(0, 1fr)",
    p: "2",
    "& h2": { color: "text.strong", fontSize: "xs", m: 0 },
    "& p": { color: "text.muted", fontSize: "2xs", m: 0 },
    "& blockquote": {
      color: "text",
      fontSize: "2xs",
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
    minH: "74px",
  });
}

function badgeRow() {
  return css({
    display: "flex",
    flexWrap: "wrap",
    gap: "1",
    "& span": {
      fontSize: "10px",
      minH: "17px",
      px: "1.5",
    },
  });
}

function restaurantGrid() {
  return css({
    display: "grid",
    gap: "2",
  });
}

function restaurantCard() {
  return css({
    alignItems: "center",
    bg: "rgba(255,255,255,0.72)",
    borderColor: "rgba(200,190,233,0.82)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "flex",
    gap: "2",
    p: "1.5",
    "& h2": { color: "text.strong", fontSize: "xs", m: 0 },
    "& p": { color: "text.muted", fontSize: "2xs", lineHeight: "1.35", m: 0 },
    "& strong": { color: "text", display: "block", fontSize: "2xs", lineHeight: "1.25", mb: "1" },
  });
}

function restaurantPhoto() {
  return css({
    alignItems: "center",
    backgroundPosition: "center",
    backgroundSize: "cover",
    borderRadius: "md",
    color: "text.onDark",
    display: "inline-flex",
    flexShrink: 0,
    h: "52px",
    justifyContent: "center",
    overflow: "hidden",
    width: "72px",
    "& svg": {
      filter: "drop-shadow(0 1px 5px rgba(5,8,42,0.5))",
      opacity: 0.9,
    },
  });
}

function weatherEvidence() {
  return css({
    bg: "rgba(255,214,90,0.18)",
    borderColor: "rgba(164,134,255,0.3)",
    borderRadius: "md",
    borderWidth: "1px",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    p: "2",
    "& svg": { color: "violet.650" },
    "& h2": { color: "text.strong", fontSize: "sm", m: 0 },
    "& p": { color: "text.muted", fontSize: "xs", m: 0 },
    "& ul": { color: "text", fontSize: "xs", lineHeight: "1.45", m: "2 0", pl: "4" },
  });
}

function composerWrap() {
  return css({
    bg: "rgba(245,243,255,0.94)",
    borderTopColor: "rgba(200,190,233,0.74)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "1",
    p: "2",
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
      bg: "surface",
      borderColor: "rgba(200,190,233,0.88)",
      borderRadius: "pill",
      borderWidth: "1px",
      color: "violet.650",
      fontSize: "xs",
      fontWeight: "900",
      px: "3",
      py: "0.5",
      textDecoration: "none",
    },
  });
}

function composer() {
  return css({
    alignItems: "center",
    bg: "surface",
    borderColor: "rgba(200,190,233,0.88)",
    borderRadius: "lg",
    borderWidth: "1px",
    boxShadow: "card",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "34px 1fr 34px",
    minH: "42px",
    p: "1",
  });
}

function rightSidebar() {
  return css({
    bg: "lavender.100",
    borderLeftColor: "rgba(200,190,233,0.74)",
    borderLeftWidth: "1px",
    display: "grid",
    gap: "3",
    minH: 0,
    overflow: "hidden",
    p: "4",
  });
}

function contextCard() {
  return css({
    bg: "surface",
    borderColor: "rgba(200,190,233,0.82)",
    borderRadius: "md",
    borderWidth: "1px",
    boxShadow: "0 14px 36px rgba(76,49,184,0.1)",
    display: "grid",
    gap: "3",
    p: "3",
    "& h2": {
      alignItems: "center",
      color: "text.strong",
      display: "flex",
      fontSize: "sm",
      fontWeight: "900",
      justifyContent: "space-between",
      m: 0,
    },
    "& h2 svg": { color: "text.soft" },
  });
}

function contextRow() {
  return css({
    alignItems: "start",
    display: "flex",
    gap: "1",
    "& > svg": { color: "violet.650", flexShrink: 0, mt: "0.5" },
    "& div": { display: "grid", gap: "1" },
    "& span": { color: "text.soft", fontSize: "2xs", fontWeight: "900" },
    "& strong": { color: "text", fontSize: "2xs", lineHeight: "1.25" },
  });
}

function weatherMetric() {
  return css({
    alignItems: "center",
    display: "flex",
    gap: "3",
    "& svg": { color: "violet.650" },
    "& strong": { color: "text.strong", display: "block", fontSize: "xl" },
    "& span": { color: "text.muted", fontSize: "2xs" },
  });
}

function metricGrid() {
  return css({
    display: "grid",
    gap: "2",
    gridTemplateColumns: "repeat(3, 1fr)",
    "& div": {
      bg: "rgba(108,70,232,0.08)",
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
      fontSize: "2xs",
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
    minH: "130px",
    p: "3",
    textDecoration: "none",
    "& span": { alignSelf: "end", fontSize: "xs", fontWeight: "800" },
    "& strong": {
      alignSelf: "start",
      bg: "surface",
      borderRadius: "md",
      color: "text.strong",
      display: "inline-flex",
      fontSize: "xs",
      fontWeight: "900",
      justifySelf: "start",
      lineHeight: "1",
      mt: "2",
      px: "3",
      py: "2",
      whiteSpace: "nowrap",
    },
  });
}

function mobileWorkspace() {
  return css({
    background:
      "linear-gradient(180deg, rgba(5,8,42,0.98) 0%, rgba(16,18,74,0.96) 54%, rgba(5,8,42,0.98) 100%), url('/images/hero-bg.png') center / cover",
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

function mobileHeaderAction() {
  return css({
    alignItems: "center",
    appearance: "none",
    bg: "transparent",
    borderWidth: "0",
    color: "text.onDark",
    cursor: "pointer",
    display: "inline-flex",
    h: "11",
    justifyContent: "center",
    p: 0,
    width: "11",
  });
}

function mobileSheetContent() {
  return css({
    bg: "rgba(5,8,42,0.98)",
    borderColor: "rgba(184,166,255,0.24)",
    color: "text.onDark",
    maxW: "320px",
  });
}

function mobileSheetHeader() {
  return css({
    gap: "3",
    p: "5",
  });
}

function mobileSheetSection() {
  return css({
    borderTopColor: "rgba(184,166,255,0.18)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "1",
    mx: "5",
    py: "4",
    "& h2": {
      color: "rgba(226,220,247,0.58)",
      fontSize: "2xs",
      fontWeight: "900",
      letterSpacing: "0",
      m: 0,
      textTransform: "uppercase",
    },
  });
}

function tripPill() {
  return css({
    alignItems: "center",
    bg: "rgba(255,255,255,0.1)",
    borderColor: "rgba(184,166,255,0.34)",
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
      color: "violet.400",
    },
  });
}

function mobileMessages() {
  return css({
    alignContent: "start",
    display: "grid",
    gap: "5",
    overflowY: "auto",
    p: "4",
  });
}

function mobileUserMessage() {
  return css({
    background: "token(gradients.cta)",
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
      bg: "rgba(255,255,255,0.1)",
      borderColor: "rgba(184,166,255,0.28)",
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
      bg: "rgba(164,134,255,0.14)",
      borderRadius: "md",
      display: "grid",
      gap: "2",
      gridTemplateColumns: "24px 1fr auto",
      p: "3",
    },
    "& svg": { color: "violet.400" },
    "& strong": { color: "text.onDark", display: "block", fontSize: "xs" },
    "& span": { color: "text.onDarkMuted", display: "block", fontSize: "2xs" },
  });
}

function mobileComposer() {
  return css({
    alignItems: "center",
    bg: "rgba(5,8,42,0.98)",
    borderTopColor: "rgba(184,166,255,0.2)",
    borderTopWidth: "1px",
    display: "grid",
    gap: "2",
    gridTemplateColumns: "38px 1fr 38px 38px",
    p: "3",
  });
}
