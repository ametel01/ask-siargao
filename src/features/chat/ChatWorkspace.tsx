import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  ChevronDown,
  Clock3,
  CloudSun,
  ExternalLink,
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
  Users,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BrandLockup, GradientLink, PalmMark, SignalBadge } from "@/ui/components/ask-siargao";

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
    <main className="min-h-screen overflow-x-hidden bg-white lg:h-dvh">
      <section
        aria-label="Ask Siargao chat workspace"
        className="relative hidden h-dvh min-h-0 w-full overflow-hidden bg-white lg:block"
      >
        <DesktopWorkspace />
      </section>
      <MobileWorkspace />
    </main>
  );
}

function DesktopWorkspace() {
  return (
    <SidebarProvider
      className="h-dvh max-h-dvh min-h-0 overflow-hidden"
      style={{ "--sidebar-width": "400px" } as CSSProperties}
    >
      <div className="grid h-full max-h-full min-h-0 w-full grid-cols-[400px_minmax(0,1fr)_416px] grid-rows-[minmax(0,1fr)] overflow-hidden">
        <LeftSidebar />
        <ConversationColumn />
        <RightSidebar />
      </div>
    </SidebarProvider>
  );
}

function LeftSidebar() {
  return (
    <Sidebar
      aria-label="Trip sidebar"
      className="w-[400px] border-r border-brand-lavender-400/20 bg-[#020a28]"
      collapsible="none"
    >
      <SidebarHeader className="gap-10 p-7 pt-9">
        <Link className="no-underline" href="/">
          <BrandLockup />
        </Link>
        <GradientLink
          className="min-h-[70px] w-full justify-between rounded-lg px-7 text-lg"
          href="/chat"
        >
          <span className="inline-flex items-center gap-2">
            <Plus aria-hidden="true" size={18} />
            New question
          </span>
          <Sparkles aria-hidden="true" size={25} />
        </GradientLink>
      </SidebarHeader>
      <SidebarContent className="gap-5 px-7">
        <SidebarSection title="CURRENT TRIP">
          <div className="flex min-h-[78px] items-center justify-between rounded-lg border border-brand-lavender-400/30 bg-white/10 px-5 py-4">
            <div>
              <strong className="block text-sm text-text-on-dark">June surf trip</strong>
              <span className="mt-1 block text-xs text-text-on-dark-muted">Jun 12 - 22</span>
            </div>
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-violet-400/25 text-base font-black text-text-on-dark">
              2
            </span>
          </div>
        </SidebarSection>
        <SidebarSection title="SAVED PLACES">
          {savedPlaces.map(([title, count]) => (
            <SidebarRow key={title} label={title} value={count} />
          ))}
          <Link
            className="mt-2 inline-flex items-center justify-between text-sm font-extrabold text-text-on-dark no-underline"
            href="/chat"
          >
            <span>View all saved places</span>
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </SidebarSection>
        <SidebarSection title="RECENT QUESTIONS">
          {recentQuestions.map(([title, time]) => (
            <SidebarRow key={title} label={title} value={time} />
          ))}
          <Link
            className="mt-2 inline-flex items-center justify-between text-sm font-extrabold text-text-on-dark no-underline"
            href="/chat"
          >
            <span>View all history</span>
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </SidebarSection>
      </SidebarContent>
      <SidebarFooter className="p-7">
        <div className="mt-auto grid min-h-[165px] gap-2 rounded-lg border border-brand-lavender-400/25 bg-[image:linear-gradient(180deg,rgba(5,8,42,0.05),rgba(5,8,42,0.76)),url('/images/siargao-sunset.png')] bg-cover bg-center p-5">
          <strong className="text-sm text-text-on-dark">Love Ask Siargao?</strong>
          <span className="text-xs leading-[1.45] text-text-on-dark-muted">
            Invite friends and unlock extra refreshes.
          </span>
          <Link
            aria-label="Invite friends"
            className="mt-auto inline-flex size-9 items-center justify-center rounded-md border border-white/70 text-text-on-dark no-underline"
            href="/chat"
          >
            <ExternalLink aria-hidden="true" size={18} />
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function SidebarSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <SidebarGroup className="gap-3 border-t border-brand-lavender-400/20 p-0 pt-6">
      <SidebarGroupLabel className="h-auto px-0 text-xs font-black tracking-[0.08em] text-brand-lavender-200/65">
        {title}
      </SidebarGroupLabel>
      <SidebarGroupContent className="grid gap-3">{children}</SidebarGroupContent>
    </SidebarGroup>
  );
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-0.5">
      <span className="text-sm font-extrabold text-text-on-dark">{label}</span>
      <small className="text-xs text-brand-lavender-200/70">{value}</small>
    </div>
  );
}

function ConversationColumn() {
  return (
    <section
      aria-label="Ask Siargao conversation"
      className="grid h-full min-h-0 min-w-0 overflow-hidden grid-rows-[114px_minmax(0,1fr)_auto] bg-white text-text-default"
    >
      <ChatHeader />
      <ScrollArea className="min-h-0">
        <div className="grid min-h-full content-start gap-3 bg-white px-7 py-4">
          <UserMessage
            text="Is this accommodation near Cloud 9 quiet at night?"
            timestamp="10:43 AM"
          />
          <AssistantMessage
            text="Yes, it's generally quiet at night. It sits on a small lane set back from the main road, and most guests mention low noise after 10pm."
            timestamp="10:44 AM"
          >
            <EvidenceCard />
          </AssistantMessage>
          <UserMessage text="Where should we eat tonight near Cloud 9?" timestamp="10:45 AM" />
          <AssistantMessage
            text="Here are great dinner spots within 10 minutes of Cloud 9 with good reviews tonight."
            timestamp="10:48 AM"
          >
            <RestaurantCards />
          </AssistantMessage>
          <UserMessage text="What weather changes should we expect today?" timestamp="10:49 AM" />
        </div>
      </ScrollArea>
      <Composer />
    </section>
  );
}

function ChatHeader() {
  return (
    <header className="flex items-center justify-between border-b border-brand-lavender-300/55 bg-white px-10">
      <div>
        <h1 className="m-0 text-[1.65rem] font-black text-text-strong">Ask Siargao</h1>
        <span className="mt-2 inline-flex items-center gap-2 text-base font-extrabold text-text-muted">
          <span className="inline-block size-2 rounded-full bg-[#0f9f74]" />
          Local travel assistant
        </span>
      </div>
      <div className="flex items-center gap-3">
        <HeaderIconButton label="Refresh answer context">
          <RefreshCw aria-hidden="true" size={17} />
        </HeaderIconButton>
        <HeaderIconButton label="Share trip chat">
          <Share2 aria-hidden="true" size={17} />
        </HeaderIconButton>
        <Avatar
          aria-label="Traveler profile"
          className="size-12 bg-brand-violet-650 text-text-on-dark"
        >
          <AvatarFallback className="bg-brand-violet-650 text-base font-black text-text-on-dark">
            A
          </AvatarFallback>
        </Avatar>
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
          className="size-12 rounded-lg border-brand-lavender-300 bg-white text-brand-violet-650 shadow-[0_8px_22px_rgba(76,49,184,0.08)] hover:bg-brand-lavender-100 hover:text-brand-violet-700"
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

function UserMessage({ text, timestamp }: { text: string; timestamp: string }) {
  return (
    <div className="max-w-[62%] justify-self-end">
      <p className="m-0 flex min-h-[54px] items-center gap-4 rounded-lg bg-[image:var(--gradient-cta)] px-6 py-3 text-base leading-[1.45] font-extrabold text-text-on-dark shadow-[0_14px_34px_rgba(76,49,184,0.2)]">
        <span>{text}</span>
        <span className="ml-auto whitespace-nowrap text-xs font-bold text-brand-lavender-200">
          {timestamp} ✓✓
        </span>
      </p>
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
    <div className="grid max-w-[71%] grid-cols-[42px_minmax(0,1fr)] items-start gap-8">
      <PalmMark className="mt-2 size-9" />
      <Card className="grid gap-2 rounded-lg border-brand-lavender-300/70 bg-surface-default p-5 shadow-[0_18px_44px_rgba(76,49,184,0.09)]">
        <CardContent className="grid gap-3 p-0">
          <p className="m-0 text-base leading-[1.45] text-text-default">{text}</p>
          {children}
          <small className="text-sm font-extrabold text-text-soft">{timestamp}</small>
        </CardContent>
      </Card>
    </div>
  );
}

function EvidenceCard() {
  return (
    <article className="grid grid-cols-[145px_minmax(0,1fr)] gap-4 rounded-lg border border-brand-lavender-300/80 bg-white p-4">
      <div className="flex min-h-[138px] items-center justify-center rounded-lg bg-[image:linear-gradient(rgba(5,8,42,0.1),rgba(5,8,42,0.2)),url('/images/siargao-sunset.png')] bg-cover bg-center text-text-on-dark">
        <ImageIcon aria-hidden="true" size={20} />
      </div>
      <div>
        <h2 className="m-0 text-base text-text-strong">Harana Surf Resort</h2>
        <p className="m-0 text-sm text-text-muted">Guest reviews (May 2024)</p>
        <blockquote className="my-3 text-sm leading-[1.45] font-extrabold text-text-default">
          "Very quiet at night, slept well every night." — Guest review
        </blockquote>
        <BadgeRow updated="Updated 12m ago" />
      </div>
    </article>
  );
}

function RestaurantCards() {
  return (
    <div className="grid gap-3">
      {restaurants.map(({ body, image, meta, title, updated }) => (
        <article
          className="flex items-center gap-3 rounded-lg border border-brand-lavender-300/80 bg-white p-2"
          key={title}
        >
          <span
            aria-hidden="true"
            className="inline-flex h-[96px] w-[118px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cover bg-center text-text-on-dark [&_svg]:opacity-90 [&_svg]:drop-shadow-[0_1px_5px_rgba(5,8,42,0.5)]"
            style={{ backgroundImage: image }}
          >
            <Utensils size={16} />
          </span>
          <div>
            <h2 className="m-0 text-base text-text-strong">{title}</h2>
            <p className="m-0 text-sm leading-[1.35] text-text-muted">{meta}</p>
            <strong className="mb-2 block text-sm leading-tight text-text-default">{body}</strong>
            <BadgeRow updated={updated} />
          </div>
        </article>
      ))}
    </div>
  );
}

function BadgeRow({ updated }: { updated: string }) {
  return (
    <div className="flex flex-wrap gap-3 [&_span]:min-h-[24px] [&_span]:px-3 [&_span]:text-xs">
      <SignalBadge>Fresh</SignalBadge>
      <SignalBadge tone="high">High confidence</SignalBadge>
      <SignalBadge tone="local">{updated}</SignalBadge>
      <SignalBadge tone="local">Local source</SignalBadge>
    </div>
  );
}

function Composer() {
  return (
    <footer className="grid gap-4 border-t border-brand-lavender-300/65 bg-white px-9 pt-3 pb-4">
      <div className="flex flex-wrap justify-start gap-4">
        {["quiet hotels", "restaurants tonight", "weather now"].map((chip) => (
          <Button
            className="h-10 rounded-full border-brand-lavender-300 bg-surface-default px-6 text-base font-black text-brand-violet-650 hover:bg-brand-lavender-100"
            key={chip}
            size="sm"
            type="button"
            variant="outline"
          >
            {chip}
          </Button>
        ))}
      </div>
      <InputGroup className="min-h-[68px] grid-cols-[56px_1fr_104px] rounded-lg border-brand-lavender-300 bg-surface-default p-2 shadow-card">
        <InputGroupAddon>
          <InputGroupButton
            aria-label="Add attachment"
            className="size-12 rounded-lg border border-brand-lavender-300 bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" size={18} />
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Ask anything about your Siargao trip"
          className="h-12 px-0 text-lg text-text-default placeholder:text-text-soft"
          placeholder="Ask anything about Siargao..."
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="Record voice question"
            className="size-12 rounded-lg bg-transparent text-text-muted hover:bg-brand-lavender-100"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Mic aria-hidden="true" size={22} />
          </InputGroupButton>
          <InputGroupButton
            aria-label="Send question"
            className="size-12 rounded-lg bg-brand-violet-650 text-white hover:bg-brand-violet-600"
            size="icon-sm"
            type="button"
          >
            <Send aria-hidden="true" size={18} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </footer>
  );
}

function RightSidebar() {
  return (
    <aside
      aria-label="Trip context sidebar"
      className="h-full min-h-0 overflow-hidden border-l border-brand-lavender-300/60 bg-[#fcfbff]"
    >
      <ScrollArea className="h-full">
        <div className="grid gap-5 p-5">
          <ContextCard title="Trip context">
            {tripRows.map(({ icon: Icon, label, value }) => (
              <div className="flex items-start gap-4" key={label}>
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-brand-violet-650"
                  size={22}
                />
                <div className="grid gap-1">
                  <span className="text-xs font-black text-text-soft">{label}</span>
                  <strong className="text-sm leading-tight text-text-default">{value}</strong>
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
            <div className="flex items-center justify-between">
              <strong className="text-lg text-text-strong">Cloud 9</strong>
              <SignalBadge>Good</SignalBadge>
            </div>
            <MetricGrid
              rows={[
                ["Waves", "2-3 ft"],
                ["Tide", "Low 0.6 m"],
                ["Wind", "18 km/h SW"],
              ]}
            />
            <SignalBadge>Updated 20 min ago</SignalBadge>
          </ContextCard>
        </div>
      </ScrollArea>
    </aside>
  );
}

function ContextCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Card className="rounded-lg border-brand-lavender-300/75 bg-surface-default p-5 shadow-[0_14px_34px_rgba(76,49,184,0.07)]">
      <CardContent className="grid gap-6 p-0">
        <h2 className="m-0 flex items-center justify-between text-lg font-black text-text-strong">
          <span>{title}</span>
          {title === "Trip context" ? (
            <Button
              className="h-9 rounded-lg border-brand-lavender-300 bg-white px-4 text-xs font-black text-brand-violet-650 hover:bg-brand-lavender-100"
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          ) : null}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}

function WeatherMetric({ temperature }: { temperature: string }) {
  return (
    <div className="flex items-center gap-5 [&_svg]:text-brand-violet-650">
      <CloudSun aria-hidden="true" size={50} />
      <div>
        <strong className="block text-3xl font-medium text-text-strong">{temperature}</strong>
        <span className="text-sm text-text-muted">Feels like 30°C</span>
      </div>
    </div>
  );
}

function MetricGrid({ rows }: { rows: string[][] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {rows.map(([label, value]) => (
        <div className="min-h-[78px] rounded-lg bg-brand-violet-600/8 p-3" key={label}>
          <span className="block text-xs font-black text-text-soft">{label}</span>
          <strong className="mt-2 block text-sm text-text-strong">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function MobileWorkspace() {
  return (
    <section
      aria-label="Ask Siargao mobile chat"
      className="grid min-h-screen grid-rows-[auto_auto_1fr_auto] bg-[image:linear-gradient(180deg,rgba(5,8,42,0.98)_0%,rgba(16,18,74,0.96)_54%,rgba(5,8,42,0.98)_100%),url('/images/hero-bg.png')] bg-cover bg-center text-text-on-dark lg:hidden"
    >
      <header className="grid min-h-[62px] grid-cols-[44px_1fr_44px] items-center border-b border-white/10 px-3">
        <MobileMenuSheet />
        <h1 className="m-0 text-center text-base font-black">Ask Siargao</h1>
        <Link
          aria-label="New chat"
          className="inline-flex size-11 items-center justify-center text-text-on-dark no-underline"
          href="/chat"
        >
          <MessageSquarePlus aria-hidden="true" size={22} />
        </Link>
      </header>
      <button
        className="mt-3 flex min-h-[34px] max-w-[calc(100vw-24px)] items-center gap-1 justify-self-center rounded-full border border-brand-lavender-400/35 bg-white/10 px-3 text-[0.6875rem] font-extrabold text-text-on-dark-muted"
        type="button"
      >
        <MapPin aria-hidden="true" size={15} />
        <span>Cloud 9 area · Jun 24-Jul 7 · </span>
        <strong className="text-brand-violet-400">24 live refreshes left</strong>
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      <ScrollArea className="min-h-0">
        <div className="grid content-start gap-5 p-4">
          <div className="max-w-[82%] justify-self-end rounded-md bg-[image:var(--gradient-cta)] p-4 text-sm leading-[1.45] font-extrabold text-text-on-dark">
            Will my place be quiet and where should we eat tonight?
          </div>
          <div className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3">
            <PalmMark className="size-7" />
            <div className="rounded-md border border-brand-lavender-400/30 bg-white/10 p-4">
              <p className="mt-0 text-sm leading-[1.55] text-text-on-dark-muted">
                Yes, your place should be quiet most nights. Cloud 9 is lively in the late afternoon
                and early evening, then it settles down.
              </p>
              <p className="mt-0 text-sm leading-[1.55] text-text-on-dark-muted">
                For dinner, you have great options within a short trike ride-fresh, local, and good
                vibes.
              </p>
              <div className="grid gap-2">
                <MobileRecommendation title="Kermit Siargao" subtitle="Seafood · Sunset views" />
                <MobileRecommendation title="Bravo Restaurant" subtitle="Pizza · Pasta · Wine" />
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
      <div className="grid grid-cols-[38px_1fr_38px_38px] items-center gap-2 border-t border-brand-lavender-400/20 bg-brand-navy-980/95 p-3">
        <Button
          aria-label="Add detail"
          className="size-10 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15"
          size="icon"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" size={18} />
        </Button>
        <InputGroup className="h-10 rounded-full border-white/15 bg-white/10">
          <InputGroupInput
            aria-label="Ask Ask Siargao on mobile"
            className="h-10 px-4 text-sm text-white placeholder:text-text-on-dark-muted focus-visible:ring-brand-violet-400/35"
            placeholder="Ask anything..."
          />
        </InputGroup>
        <Button
          aria-label="Record voice question"
          className="size-10 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15"
          size="icon"
          type="button"
          variant="outline"
        >
          <Mic aria-hidden="true" size={18} />
        </Button>
        <Button
          aria-label="Send mobile question"
          className="size-10 rounded-full border-brand-violet-650 bg-brand-violet-650 text-white hover:bg-brand-violet-600"
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
        <button
          aria-label="Open menu"
          className="inline-flex size-11 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 text-text-on-dark"
          type="button"
        >
          <Menu aria-hidden="true" size={22} />
        </button>
      </SheetTrigger>
      <SheetContent
        className="max-w-[320px] border-brand-lavender-400/25 bg-brand-navy-980/98 text-text-on-dark"
        side="left"
      >
        <SheetHeader className="gap-3 p-5">
          <BrandLockup />
          <SheetTitle className="text-lg font-black text-text-on-dark">Trip workspace</SheetTitle>
          <SheetDescription className="leading-[1.6] text-text-on-dark-muted">
            Saved places, recent questions, and live trip context.
          </SheetDescription>
        </SheetHeader>
        <MobileSheetSection title="Saved places">
          {savedPlaces.map(([title, count]) => (
            <SidebarRow key={title} label={title} value={count} />
          ))}
        </MobileSheetSection>
        <MobileSheetSection title="Recent questions">
          {recentQuestions.map(([title, time]) => (
            <SidebarRow key={title} label={title} value={time} />
          ))}
        </MobileSheetSection>
        <div className="px-5">
          <GradientLink href="/chat">New question</GradientLink>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MobileSheetSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="mx-5 grid gap-1 border-t border-brand-lavender-400/20 py-4">
      <h2 className="m-0 text-[0.6875rem] font-black tracking-normal text-brand-lavender-200/60 uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}

function MobileRecommendation({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <article className="grid grid-cols-[24px_1fr_auto] items-center gap-2 rounded-md bg-brand-violet-400/15 p-3 [&_svg]:text-brand-violet-400">
      <Utensils aria-hidden="true" size={17} />
      <div>
        <strong className="block text-xs text-text-on-dark">{title}</strong>
        <span className="block text-[0.6875rem] text-text-on-dark-muted">{subtitle}</span>
      </div>
      <SignalBadge>Fresh</SignalBadge>
    </article>
  );
}
