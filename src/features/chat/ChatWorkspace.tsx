"use client";

import {
  Clock,
  ExternalLink,
  Home,
  LoaderCircle,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group-addon";
import { InputGroupButton } from "@/components/ui/input-group-button";
import { InputGroupInput } from "@/components/ui/input-group-input";
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

const suggestedPrompts = [
  "What should I do near Cloud 9 today?",
  "Where should I eat in General Luna tonight?",
  "Help me plan a quiet Siargao day",
];

const chatErrorMessage = "Ask Siargao could not answer right now. Please try again.";
const maxChatRequestMessageLength = 2_000;
const maxPriorChatRequestMessages = 6;
const chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

type ChatClientGeolocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: string;
  consentScope: "single_request";
};

type ChatClientContext = {
  geolocation: ChatClientGeolocation;
};

type LocationCaptureState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "ready"; geolocation: ChatClientGeolocation }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "unsupported" }
  | { status: "consumed" };

type InteractiveChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status?: "pending" | "complete" | "error";
  retryPrompt?: string;
  cards?: readonly RecommendationCardArtifact[];
  actions?: readonly ChatActionArtifact[];
  itineraries?: readonly ItineraryPlanArtifact[];
};

type RecommendationCardArtifact = {
  id: string;
  kind: "place" | "beach";
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: readonly string[];
  caveats: readonly string[];
  sourceLabel: string;
};

type ChatActionArtifact = {
  id: string;
  label: string;
  type?: "link" | "prompt" | "navigation";
  href?: string;
  prompt?: string;
};

type ItineraryStopArtifact = {
  title: string;
  kind: "place" | "beach" | "activity" | "meal" | "transfer";
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: readonly string[];
};

type ItineraryPlanArtifact = {
  title: string;
  durationLabel: string;
  stops: readonly ItineraryStopArtifact[];
  fallbackStops: readonly ItineraryStopArtifact[];
  skip: readonly string[];
  sources: readonly {
    label: string;
    sourceName: string;
    sourceProfileId?: string;
    fetchedAt?: string;
    confidence?: "high" | "medium" | "low";
    checked: readonly string[];
    notChecked: readonly string[];
  }[];
};

type ChatComposerProps = {
  inputValue: string;
  isSending: boolean;
  locationState: LocationCaptureState;
  onInputValueChange: (value: string) => void;
  onRequestLocation: () => void;
  onSubmitPrompt: (prompt: string) => void;
};

type AssistantMarkdownBlock =
  | {
      key: string;
      type: "heading";
      text: string;
    }
  | {
      key: string;
      type: "paragraph";
      text: string;
    }
  | {
      key: string;
      type: "source";
      label: string;
      text: string;
    }
  | {
      key: string;
      type: "list";
      ordered: boolean;
      items: Array<{
        key: string;
        text: string;
      }>;
    };
type AssistantMarkdownListItems = Extract<AssistantMarkdownBlock, { type: "list" }>["items"];

export function ChatWorkspace({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [inputValue, setInputValue] = useState(() => initialPrompt.trim());
  const [isSending, setIsSending] = useState(false);
  const [locationState, setLocationState] = useState<LocationCaptureState>({ status: "idle" });
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationState({ status: "unsupported" });
      return;
    }

    setLocationState({ status: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationState({
          status: "ready",
          geolocation: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            ...(Number.isFinite(position.coords.accuracy)
              ? { accuracyMeters: position.coords.accuracy }
              : {}),
            capturedAt: new Date(position.timestamp).toISOString(),
            consentScope: "single_request",
          },
        });
      },
      (error) => {
        setLocationState({
          status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  }, []);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || isSending) {
        return;
      }

      const timestamp = formatTimestamp();
      const userMessage: InteractiveChatMessage = {
        id: createMessageId("user"),
        role: "user",
        text: trimmedPrompt,
        timestamp,
        status: "complete",
      };
      const pendingAssistantId = createMessageId("assistant");
      const pendingAssistant: InteractiveChatMessage = {
        id: pendingAssistantId,
        role: "assistant",
        text: "Thinking through that with Ask Siargao...",
        timestamp,
        status: "pending",
      };
      const requestMessages = buildChatRequestMessages(messages, trimmedPrompt);
      const requestBody = buildChatRequestBody(requestMessages, locationState);

      setInputValue("");
      setIsSending(true);
      setMessages((currentMessages) => [...currentMessages, userMessage, pendingAssistant]);
      if (requestBody.clientContext?.geolocation.consentScope === "single_request") {
        setLocationState({ status: "consumed" });
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const body = (await response.json()) as {
          message?: string;
          cards?: RecommendationCardArtifact[];
          actions?: ChatActionArtifact[];
          itineraries?: ItineraryPlanArtifact[];
        };

        const responseMessage = body.message;

        if (!response.ok || !responseMessage) {
          throw new Error(chatErrorMessage);
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  text: responseMessage,
                  timestamp: formatTimestamp(),
                  status: "complete",
                  cards: body.cards,
                  actions: body.actions,
                  itineraries: body.itineraries,
                }
              : message,
          ),
        );
      } catch {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  text: chatErrorMessage,
                  timestamp: formatTimestamp(),
                  status: "error",
                  retryPrompt: trimmedPrompt,
                }
              : message,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, locationState, messages],
  );

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  });

  const hasMessages = messages.length > 0;
  const handlePromptSubmit = (prompt: string) => {
    void submitPrompt(prompt);
  };

  return (
    <main
      aria-label="Ask Siargao chat workspace"
      className="h-dvh min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_10%,rgba(135,92,246,0.22),transparent_28rem),linear-gradient(135deg,#05082a_0%,#091133_46%,#0e2c3d_100%)] text-text-on-dark"
    >
      <section className="mx-auto grid h-full min-h-0 w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex min-h-[72px] items-center justify-between gap-4 border-white/12 border-b px-4 py-3 sm:px-6 lg:min-h-[88px] lg:px-8">
          <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
            <BrandLockup className="[&_span:last-child]:text-xl sm:[&_span:last-child]:text-[1.7rem]" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-text-on-dark-muted sm:inline-flex">
              <span className="size-2 rounded-full bg-[#20d59b]" />
              Siargao trip assistant
            </span>
            <Button
              aria-label="Go to home"
              asChild
              className="size-10 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
              size="icon"
              variant="outline"
            >
              <Link href="/">
                <Home aria-hidden="true" size={18} />
              </Link>
            </Button>
            <Button
              aria-label="Start a new chat"
              asChild
              className="size-10 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
              size="icon"
              variant="outline"
            >
              <Link href="/chat">
                <MessageSquarePlus aria-hidden="true" size={18} />
              </Link>
            </Button>
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto grid min-h-full max-w-3xl content-start gap-5">
            {hasMessages ? (
              <>
                <SuggestedPromptBar
                  disabled={isSending}
                  onSubmitPrompt={handlePromptSubmit}
                  prompts={suggestedPrompts}
                />
                <div className="grid gap-4" role="log" aria-label="Conversation messages">
                  {messages.map((message) => (
                    <ChatMessage
                      disabled={isSending}
                      key={message.id}
                      message={message}
                      onRetryPrompt={handlePromptSubmit}
                      onSubmitPrompt={handlePromptSubmit}
                    />
                  ))}
                </div>
              </>
            ) : (
              <ChatEmptyState
                disabled={isSending}
                onSubmitPrompt={handlePromptSubmit}
                prompts={suggestedPrompts}
              />
            )}
            <div ref={messageEndRef} />
          </div>
        </div>

        <ChatComposer
          inputValue={inputValue}
          isSending={isSending}
          locationState={locationState}
          onInputValueChange={setInputValue}
          onRequestLocation={requestLocation}
          onSubmitPrompt={handlePromptSubmit}
        />
      </section>
    </main>
  );
}

function ChatMessage({
  disabled,
  message,
  onRetryPrompt,
  onSubmitPrompt,
}: {
  disabled: boolean;
  message: InteractiveChatMessage;
  onRetryPrompt: (prompt: string) => void;
  onSubmitPrompt: (prompt: string) => void;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  if (isUser) {
    return (
      <article className="max-w-[min(88%,42rem)] justify-self-end rounded-lg bg-[image:var(--gradient-cta)] px-5 py-4 text-text-on-dark shadow-[0_18px_44px_rgba(76,49,184,0.25)]">
        <p className="m-0 text-sm leading-[1.55] font-extrabold sm:text-base">{message.text}</p>
        <time className="mt-2 block text-right text-xs font-bold text-brand-lavender-200">
          {message.timestamp}
        </time>
      </article>
    );
  }

  return (
    <article className="grid max-w-[min(92%,46rem)] grid-cols-[36px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[44px_minmax(0,1fr)] sm:gap-4">
      <PalmMark className="mt-1 size-8 sm:size-10" />
      <div
        data-testid="assistant-message-bubble"
        className={
          isError
            ? "min-w-0 overflow-hidden rounded-lg border border-[#ffb4a8]/45 bg-[#421915]/82 px-5 py-4 shadow-[0_18px_44px_rgba(0,0,0,0.18)]"
            : "min-w-0 overflow-hidden rounded-lg border border-white/14 bg-white/95 px-5 py-4 text-text-default shadow-[0_18px_44px_rgba(0,0,0,0.16)]"
        }
      >
        <div className="flex min-w-0 items-start gap-3">
          {isPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="mt-0.5 shrink-0 animate-spin text-brand-violet-650"
              size={18}
            />
          ) : null}
          <div className="grid min-w-0 flex-1 gap-4">
            <AssistantMarkdownText text={message.text} tone={isError ? "error" : "default"} />
            {!isError && !isPending && message.itineraries?.length ? (
              <ItineraryPlans plans={message.itineraries} />
            ) : null}
            {!isError && !isPending && message.cards?.length ? (
              <RecommendationCards cards={message.cards} />
            ) : null}
            {!isError && !isPending && message.actions?.length ? (
              <ChatActionButtons
                actions={message.actions}
                disabled={disabled}
                onSubmitPrompt={onSubmitPrompt}
              />
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-extrabold">
          <time className={isError ? "text-[#ffd5ce]" : "text-text-soft"}>{message.timestamp}</time>
        </div>
        {isError && message.retryPrompt ? (
          <Button
            className="mt-4 h-9 rounded-md border-[#ffd5ce]/45 bg-white/10 px-3 text-xs font-extrabold text-text-on-dark hover:bg-white/15"
            disabled={disabled}
            onClick={() => onRetryPrompt(message.retryPrompt ?? "")}
            type="button"
            variant="outline"
          >
            Retry last question
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ItineraryPlans({ plans }: { plans: readonly ItineraryPlanArtifact[] }) {
  return (
    <div className="grid min-w-0 gap-5" data-testid="itinerary-plans">
      {plans.map((plan) => (
        <section
          aria-label={plan.title}
          className="grid min-w-0 gap-4 border-[#c9dfd4] border-t pt-4"
          data-testid="itinerary-plan"
          key={`${plan.title}-${plan.durationLabel}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[#d8f1e6] text-[#14624a]">
              <Navigation aria-hidden="true" size={17} />
            </div>
            <div className="grid min-w-0 flex-1 gap-1">
              <h3 className="m-0 text-sm leading-[1.25] font-black break-words text-text-strong sm:text-base">
                {plan.title}
              </h3>
              <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-black/5 bg-[#f7fbf8] px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold text-text-soft">
                <Clock aria-hidden="true" className="shrink-0" size={13} />
                <span className="min-w-0 break-words">{plan.durationLabel}</span>
              </span>
            </div>
          </div>

          <ol className="m-0 grid min-w-0 gap-3 p-0" data-testid="itinerary-stops">
            {sortItineraryStops(plan.stops).map((stop) => (
              <ItineraryStopRow key={`${stop.sequence}-${stop.title}`} stop={stop} />
            ))}
          </ol>

          {plan.fallbackStops.length ? (
            <ItineraryNoteSection
              items={plan.fallbackStops.map((stop) => formatItineraryStopSummary(stop))}
              testId="itinerary-fallbacks"
              title="Fallbacks"
            />
          ) : null}

          {plan.skip.length ? (
            <ItineraryNoteSection items={plan.skip} testId="itinerary-skip" title="Skip" />
          ) : null}

          {plan.sources.length ? <ItinerarySources sources={plan.sources} /> : null}
        </section>
      ))}
    </div>
  );
}

function ItineraryStopRow({ stop }: { stop: ItineraryStopArtifact }) {
  return (
    <li className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[#ecf5f0] text-xs font-black text-[#14624a]">
        {stop.sequence}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 min-w-0 text-sm leading-[1.3] font-black break-words text-text-strong">
            {stop.title}
          </h4>
          {stop.area ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-black/5 bg-[#f7fbf8] px-2 py-1 text-[0.7rem] leading-tight font-extrabold text-text-soft">
              <MapPin aria-hidden="true" className="shrink-0" size={12} />
              <span className="min-w-0 break-words">{stop.area}</span>
            </span>
          ) : null}
        </div>

        {stop.travelTimeFromPreviousMinutes ? (
          <p className="m-0 inline-flex min-w-0 items-center gap-1.5 text-xs leading-[1.45] font-bold break-words text-text-soft">
            <Clock aria-hidden="true" className="shrink-0" size={13} />
            <span className="min-w-0 break-words">
              About {stop.travelTimeFromPreviousMinutes} minutes from the previous stop.
            </span>
          </p>
        ) : null}

        <p className="m-0 text-xs leading-[1.5] break-words text-text-default sm:text-sm">
          {stop.rationale}
        </p>

        {stop.caveats.length ? (
          <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-[#66521c]">
            {stop.caveats.map((caveat) => (
              <li className="break-words" key={caveat}>
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}

        {stop.mapsUrl ? (
          <a
            aria-label={`Open ${stop.title} in Google Maps`}
            className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-[#14624a]/25 bg-white px-3 py-2 text-xs font-extrabold text-[#14624a] no-underline hover:bg-[#edf8f2]"
            href={stop.mapsUrl}
            rel="noreferrer"
            target="_blank"
          >
            <MapPin aria-hidden="true" className="shrink-0" size={15} />
            <span className="min-w-0 break-words">Open map</span>
            <ExternalLink aria-hidden="true" className="shrink-0" size={14} />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function ItineraryNoteSection({
  items,
  testId,
  title,
}: {
  items: readonly string[];
  testId: string;
  title: string;
}) {
  return (
    <section className="grid min-w-0 gap-1.5" data-testid={testId}>
      <h4 className="m-0 text-xs font-black text-text-strong">{title}</h4>
      <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-text-default sm:text-sm">
        {items.map((item) => (
          <li className="break-words" key={item}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItinerarySources({ sources }: { sources: ItineraryPlanArtifact["sources"] }) {
  return (
    <section className="grid min-w-0 gap-2" data-testid="itinerary-sources">
      <h4 className="m-0 text-xs font-black text-text-strong">Sources</h4>
      <div className="flex min-w-0 flex-wrap gap-2">
        {sources.map((source) => (
          <span
            className="inline-flex max-w-full items-center rounded-md border border-black/5 bg-[#f7fbf8] px-2.5 py-1.5 text-[0.72rem] leading-tight font-extrabold text-text-soft"
            key={`${source.label}-${source.sourceName}-${source.sourceProfileId ?? "profile"}`}
          >
            <span className="min-w-0 break-words">{formatItinerarySourceLabel(source)}</span>
          </span>
        ))}
      </div>
      {sources.some((source) => source.notChecked.length > 0) ? (
        <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-[#66521c]">
          {sources.flatMap((source) =>
            source.notChecked.map((item) => (
              <li className="break-words" key={`${source.sourceName}-${item}`}>
                Not checked by {source.sourceName}: {item}
              </li>
            )),
          )}
        </ul>
      ) : null}
    </section>
  );
}

function sortItineraryStops(stops: readonly ItineraryStopArtifact[]) {
  return stops.toSorted((first, second) => first.sequence - second.sequence);
}

function formatItineraryStopSummary(stop: ItineraryStopArtifact) {
  return [stop.title, stop.area, stop.rationale].filter(Boolean).join(" - ");
}

function formatItinerarySourceLabel(source: ItineraryPlanArtifact["sources"][number]) {
  const confidence = source.confidence ? `, ${source.confidence} confidence` : "";
  return `${formatTrustLabel(source.label)} - ${source.sourceName}${confidence}`;
}

function formatTrustLabel(value: string) {
  return value.replaceAll("_", " ");
}

function RecommendationCards({ cards }: { cards: readonly RecommendationCardArtifact[] }) {
  return (
    <div className="grid min-w-0 gap-3" data-testid="recommendation-cards">
      {cards.map((card) => (
        <article
          className="grid min-w-0 gap-3 rounded-md border border-[#c9dfd4] bg-[#f7fbf8] p-3 shadow-[0_12px_28px_rgba(22,60,49,0.08)]"
          data-testid="recommendation-card"
          key={card.id}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-[#d8f1e6] text-[#14624a]">
              {card.kind === "beach" ? (
                <Navigation aria-hidden="true" size={17} />
              ) : (
                <MapPin aria-hidden="true" size={17} />
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-1">
              <h3 className="m-0 text-sm leading-[1.25] font-black break-words text-text-strong sm:text-base">
                {card.title}
              </h3>
              {card.subtitle ? (
                <p className="m-0 text-xs leading-[1.45] break-words text-text-soft sm:text-sm">
                  {card.subtitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap gap-2">
            {card.distanceLabel ? <CardSignal icon="distance" label={card.distanceLabel} /> : null}
            {card.openStatusLabel ? <CardSignal icon="time" label={card.openStatusLabel} /> : null}
            <CardSignal label={card.sourceLabel} />
          </div>

          {card.fitReasons.length ? (
            <ul className="m-0 grid gap-1.5 pl-4 text-xs leading-[1.45] text-text-default sm:text-sm">
              {card.fitReasons.map((reason) => (
                <li className="break-words" key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}

          {card.caveats.length ? (
            <p className="m-0 rounded-md border border-[#e4d8b8] bg-[#fff9e8] px-3 py-2 text-xs leading-[1.45] break-words text-[#66521c]">
              {card.caveats.join(" ")}
            </p>
          ) : null}

          {card.mapsUrl ? (
            <a
              aria-label={`Open ${card.title} in Google Maps`}
              className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-[#14624a]/25 bg-white px-3 py-2 text-xs font-extrabold text-[#14624a] no-underline hover:bg-[#edf8f2]"
              href={card.mapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              <MapPin aria-hidden="true" className="shrink-0" size={15} />
              <span className="min-w-0 break-words">Open map</span>
              <ExternalLink aria-hidden="true" className="shrink-0" size={14} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CardSignal({ icon, label }: { icon?: "distance" | "time"; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-black/5 bg-white px-2.5 py-1.5 text-[0.72rem] leading-tight font-extrabold text-text-soft">
      {icon === "distance" ? <MapPin aria-hidden="true" className="shrink-0" size={13} /> : null}
      {icon === "time" ? <Clock aria-hidden="true" className="shrink-0" size={13} /> : null}
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

function ChatActionButtons({
  actions,
  disabled,
  onSubmitPrompt,
}: {
  actions: readonly ChatActionArtifact[];
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2" data-testid="chat-action-buttons">
      {actions.map((action) =>
        action.href ? (
          <Button
            asChild
            className="h-auto min-h-9 rounded-md border-[#14624a]/25 bg-white px-3 py-2 text-xs font-extrabold text-[#14624a] hover:bg-[#edf8f2]"
            key={action.id}
            size="sm"
            variant="outline"
          >
            <a href={action.href} rel="noreferrer" target="_blank">
              {action.label}
            </a>
          </Button>
        ) : (
          <Button
            className="h-auto min-h-9 rounded-md border-brand-violet-650/25 bg-brand-violet-650/10 px-3 py-2 text-xs font-extrabold text-brand-violet-650 hover:bg-brand-violet-650/15"
            disabled={disabled || !action.prompt}
            key={action.id}
            onClick={() => {
              if (action.prompt) {
                onSubmitPrompt(action.prompt);
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {action.label}
          </Button>
        ),
      )}
    </div>
  );
}

function AssistantMarkdownText({ text, tone }: { text: string; tone: "default" | "error" }) {
  const blocks = parseAssistantMarkdownBlocks(text);
  const textClass = tone === "error" ? "text-text-on-dark" : "text-text-default";
  const strongClass =
    tone === "error" ? "font-extrabold text-white" : "font-extrabold text-text-strong";
  const linkClass =
    tone === "error"
      ? "font-extrabold text-white underline decoration-white/45 underline-offset-4 break-words"
      : "font-extrabold text-brand-violet-650 underline decoration-brand-violet-650/35 underline-offset-4 break-words";

  return (
    <div className="grid min-w-0 max-w-full flex-1 gap-3 overflow-hidden [overflow-wrap:anywhere]">
      {blocks.map((block) => {
        if (block.type === "heading") {
          return (
            <h3
              className={`m-0 max-w-full text-sm leading-[1.35] font-black break-words sm:text-base ${strongClass}`}
              key={block.key}
            >
              {block.text}
            </h3>
          );
        }

        if (block.type === "list") {
          const listClass = `m-0 max-w-full space-y-1.5 pl-6 text-sm leading-[1.6] break-words sm:text-base ${textClass}`;
          const items = block.items.map((item) => (
            <li className="min-w-0 whitespace-pre-line break-words" key={item.key}>
              <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={item.text} />
            </li>
          ));

          return block.ordered ? (
            <ol
              className={`${listClass} list-outside list-decimal marker:font-black marker:text-brand-violet-650`}
              key={block.key}
            >
              {items}
            </ol>
          ) : (
            <ul className={`${listClass} list-disc`} key={block.key}>
              {items}
            </ul>
          );
        }

        if (block.type === "source") {
          return (
            <p
              className={`m-0 max-w-full rounded-md border border-black/5 bg-black/[0.035] px-3 py-2 text-xs leading-[1.45] break-words sm:text-sm ${
                tone === "error" ? "text-[#ffd5ce]" : "text-text-soft"
              }`}
              data-testid="assistant-source-line"
              key={block.key}
            >
              <span className={strongClass}>{block.label}:</span>{" "}
              <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={block.text} />
            </p>
          );
        }

        return (
          <p
            className={`m-0 max-w-full text-sm leading-[1.6] break-words sm:text-base ${textClass}`}
            key={block.key}
          >
            <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function InlineMarkdown({
  linkClass,
  strongClass,
  value,
}: {
  linkClass: string;
  strongClass: string;
  value: string;
}) {
  return <>{buildInlineMarkdownNodes(value, strongClass, linkClass)}</>;
}

function parseAssistantMarkdownBlocks(text: string): AssistantMarkdownBlock[] {
  const normalizedText = text
    .replace(/\r\n?/g, "\n")
    .replace(/\s+-\s+(\*\*[^*]+?\*\*:)/g, "\n- $1")
    .replace(/(?<![A-Za-z])\s+(\d+\.\s+[A-Z][^:\n]{0,120})/g, "\n$1")
    .replace(/\s+(Weather signal:|Checked:|Not checked:)/g, "\n$1");
  const blocks: AssistantMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: AssistantMarkdownListItems = [];
  let listOrdered = false;
  let blockKeyCount = 0;
  let itemKeyCount = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraphText = paragraphLines.join(" ");
    blocks.push({
      key: createAssistantMarkdownKey("paragraph", paragraphText, blockKeyCount),
      type: "paragraph",
      text: paragraphText,
    });
    blockKeyCount += 1;
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({
      key: createAssistantMarkdownKey(
        "list",
        listItems.map((item) => item.text).join("|"),
        blockKeyCount,
      ),
      type: "list",
      ordered: listOrdered,
      items: listItems,
    });
    blockKeyCount += 1;
    listItems = [];
    listOrdered = false;
  };

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^\s{2,}\S/.test(rawLine) && listItems.length > 0) {
      listItems[listItems.length - 1] = {
        ...listItems[listItems.length - 1],
        text: `${listItems[listItems.length - 1]?.text ?? ""}\n${line}`,
      };
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(line);
    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);
    const sourceMatch = /^(Checked|Weather signal|Not checked):\s*(.+)$/i.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      const headingText = headingMatch[1] ?? "";
      blocks.push({
        key: createAssistantMarkdownKey("heading", headingText, blockKeyCount),
        type: "heading",
        text: headingText,
      });
      blockKeyCount += 1;
      continue;
    }

    if (sourceMatch) {
      flushParagraph();
      flushList();
      const label = sourceMatch[1] ?? "";
      const sourceText = sourceMatch[2] ?? "";
      blocks.push({
        key: createAssistantMarkdownKey("source", `${label}:${sourceText}`, blockKeyCount),
        type: "source",
        label,
        text: sourceText,
      });
      blockKeyCount += 1;
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) {
        flushList();
      }
      listOrdered = false;
      const itemText = bulletMatch[1] ?? "";
      listItems.push({
        key: createAssistantMarkdownKey("item", itemText, itemKeyCount),
        text: itemText,
      });
      itemKeyCount += 1;
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) {
        flushList();
      }
      listOrdered = true;
      const itemText = orderedMatch[1] ?? "";
      listItems.push({
        key: createAssistantMarkdownKey("item", itemText, itemKeyCount),
        text: itemText,
      });
      itemKeyCount += 1;
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.length > 0
    ? blocks
    : [
        {
          key: "paragraph-fallback",
          type: "paragraph",
          text,
        },
      ];
}

function createAssistantMarkdownKey(prefix: string, value: string, count: number) {
  return `${prefix}-${count}-${value.slice(0, 48)}`;
}

function buildInlineMarkdownNodes(
  value: string,
  strongClass: string,
  linkClass: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let currentIndex = 0;
  let match = boldPattern.exec(value);

  while (match) {
    if (match.index > currentIndex) {
      nodes.push(...buildLinkedTextNodes(value.slice(currentIndex, match.index), linkClass));
    }

    nodes.push(
      <strong className={strongClass} key={`strong-${match.index}`}>
        {buildLinkedTextNodes(match[1] ?? "", linkClass)}
      </strong>,
    );
    currentIndex = match.index + match[0].length;
    match = boldPattern.exec(value);
  }

  if (currentIndex < value.length) {
    nodes.push(...buildLinkedTextNodes(value.slice(currentIndex), linkClass));
  }

  return nodes;
}

function buildLinkedTextNodes(value: string, linkClass: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  let currentIndex = 0;
  let match = urlPattern.exec(value);

  while (match) {
    const rawUrl = match[0] ?? "";
    const normalizedUrl = normalizeAssistantUrl(rawUrl);

    if (match.index > currentIndex) {
      nodes.push(value.slice(currentIndex, match.index));
    }

    nodes.push(
      <a
        aria-label={`Open ${formatAssistantLinkText(normalizedUrl)} link`}
        className={linkClass}
        href={normalizedUrl}
        key={`link-${match.index}-${normalizedUrl}`}
        rel="noreferrer"
        target="_blank"
      >
        {formatAssistantLinkText(normalizedUrl)}
      </a>,
    );

    const trailingText = rawUrl.slice(normalizedUrl.length);
    if (trailingText) {
      nodes.push(trailingText);
    }

    currentIndex = match.index + rawUrl.length;
    match = urlPattern.exec(value);
  }

  if (currentIndex < value.length) {
    nodes.push(value.slice(currentIndex));
  }

  return nodes;
}

function normalizeAssistantUrl(value: string) {
  return value.replace(/[),.;:!?]+$/g, "");
}

function formatAssistantLinkText(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (
      host === "maps.google.com" ||
      (host.endsWith(".google.com") && url.pathname.startsWith("/maps"))
    ) {
      return "Google Maps";
    }

    return host;
  } catch {
    return value;
  }
}

function ChatComposer({
  inputValue,
  isSending,
  locationState,
  onInputValueChange,
  onRequestLocation,
  onSubmitPrompt,
}: ChatComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitPrompt(inputValue);
  }

  const locationStatus = locationStatusText(locationState);
  const locationReady = locationState.status === "ready";
  const locationRequesting = locationState.status === "requesting";

  return (
    <footer className="border-white/12 border-t bg-brand-navy-980/92 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
      <form aria-label="Ask Siargao composer" className="mx-auto max-w-3xl" onSubmit={handleSubmit}>
        <InputGroup className="min-h-[58px] rounded-lg border-white/18 bg-white/96 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <InputGroupAddon align="inline-start">
            <InputGroupButton
              aria-label={
                locationReady ? "Location ready for next question" : "Share location once"
              }
              aria-pressed={locationReady}
              className={
                locationReady
                  ? "size-11 rounded-md bg-[#14624a] text-white hover:bg-[#0f503d]"
                  : "size-11 rounded-md text-text-soft hover:bg-[#ecf5f0] hover:text-[#14624a]"
              }
              disabled={isSending || locationRequesting}
              onClick={onRequestLocation}
              size="icon-sm"
              type="button"
            >
              {locationRequesting ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
              ) : (
                <MapPin aria-hidden="true" size={18} />
              )}
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Ask anything about Siargao"
            className="h-11 px-3 text-base text-text-default placeholder:text-text-soft"
            disabled={isSending}
            onInput={(event) => onInputValueChange(event.currentTarget.value)}
            placeholder="Ask anything about Siargao..."
            value={inputValue}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Send question"
              className="size-11 rounded-md bg-brand-violet-650 text-white hover:bg-brand-violet-600"
              disabled={isSending || inputValue.trim().length === 0}
              size="icon-sm"
              type="submit"
            >
              {isSending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
              ) : (
                <Send aria-hidden="true" size={18} />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p
          aria-live="polite"
          className="m-0 mt-2 min-h-4 px-1 text-[0.72rem] leading-tight font-extrabold text-text-on-dark-muted"
        >
          {locationStatus}
        </p>
      </form>
    </footer>
  );
}

function locationStatusText(locationState: LocationCaptureState) {
  switch (locationState.status) {
    case "requesting":
      return "Requesting location...";
    case "ready":
      return "Location ready for the next question.";
    case "denied":
      return "Location permission denied.";
    case "unavailable":
      return "Location unavailable.";
    case "unsupported":
      return "Location unavailable in this browser.";
    case "consumed":
      return "Location used for the last question.";
    case "idle":
      return "Location sharing is optional.";
  }
}

function SuggestedPromptBar({
  disabled,
  onSubmitPrompt,
  prompts,
}: {
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
  prompts: string[];
}) {
  return (
    <fieldset aria-label="Suggested prompts" className="m-0 flex flex-wrap gap-2 border-0 p-0">
      {prompts.map((prompt) => (
        <Button
          className="h-auto min-h-9 rounded-full border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold text-text-on-dark hover:bg-white/15"
          disabled={disabled}
          key={prompt}
          onClick={() => onSubmitPrompt(prompt)}
          type="button"
          variant="outline"
        >
          {prompt}
        </Button>
      ))}
    </fieldset>
  );
}

function ChatEmptyState({
  disabled,
  onSubmitPrompt,
  prompts,
}: {
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
  prompts: string[];
}) {
  return (
    <div className="grid min-h-full content-center gap-8 py-10 sm:py-14">
      <div className="grid max-w-2xl gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-lg bg-white/12 text-brand-violet-400">
          <Sparkles aria-hidden="true" size={24} />
        </div>
        <div className="grid gap-3">
          <p className="m-0 text-xs font-extrabold tracking-[0.08em] text-brand-lavender-200/75 uppercase">
            Ask Siargao
          </p>
          <h1 className="m-0 text-3xl leading-[1.05] font-black text-text-on-dark sm:text-5xl">
            Ask a real question about your Siargao trip.
          </h1>
          <p className="m-0 max-w-xl text-base leading-[1.7] text-text-on-dark-muted">
            Ask about food, weather, transfers, surf areas, quiet stays, and practical trip planning
            around Siargao.
          </p>
        </div>
      </div>
      <SuggestedPromptBar disabled={disabled} onSubmitPrompt={onSubmitPrompt} prompts={prompts} />
    </div>
  );
}

function createMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatTimestamp() {
  return chatTimeFormatter.format(new Date());
}

function buildChatRequestMessages(messages: readonly InteractiveChatMessage[], prompt: string) {
  return [
    ...messages
      .filter((message) => message.status === "complete")
      .slice(-maxPriorChatRequestMessages)
      .map((message) => ({
        role: message.role,
        content: truncateChatRequestMessage(message.text),
      })),
    { role: "user" as const, content: truncateChatRequestMessage(prompt) },
  ];
}

function buildChatRequestBody(
  messages: ReturnType<typeof buildChatRequestMessages>,
  locationState: LocationCaptureState,
): { messages: ReturnType<typeof buildChatRequestMessages>; clientContext?: ChatClientContext } {
  return {
    messages,
    ...(locationState.status === "ready"
      ? { clientContext: { geolocation: locationState.geolocation } }
      : {}),
  };
}

function truncateChatRequestMessage(value: string) {
  return value.length <= maxChatRequestMessageLength
    ? value
    : `${value.slice(0, maxChatRequestMessageLength - 3)}...`;
}
