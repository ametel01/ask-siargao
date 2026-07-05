"use client";

/*
 * Hallmark - pre-emit critique: P4 H4 E4 S5 R4 V4
 * genre: modern-minimal; macrostructure: mobile concierge thread; contrast/mobile: pass.
 */
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import {
  BedDouble,
  Bookmark,
  BookmarkCheck,
  Bus,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudSun,
  Copy,
  EllipsisVertical,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Navigation,
  Plane,
  Plus,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
  Utensils,
  WavesHorizontal,
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group-addon";
import { InputGroupButton } from "@/components/ui/input-group-button";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import type {
  ArtifactDecisionMetadata,
  ChatClientContext,
  ChatClientGeolocation,
  ChatSourceArtifact,
  ItineraryPlanArtifact,
  ItineraryStopArtifact,
  RecommendationCardArtifact,
  SavedTripApiResponse,
  SavedTripItem,
  SavedTripState,
} from "@/features/chat/saved-trip-client";
import {
  buildSavedItemFromCard,
  buildSavedItemFromItinerary,
  buildSharedPlanTitle,
  deleteSavedTripItem,
  fetchAuthenticatedSavedTrip,
  getSavedTripServerSnapshot,
  getSavedTripSnapshot,
  postSavedTripItems,
  postSharedTripPlan,
  savedItemIdForCard,
  savedItemIdForItinerary,
  subscribeSavedTripState,
  syncSavedTripItemsMutation,
  upsertSavedTripItem,
  writeAuthenticatedSavedTripState,
  writeSavedTripState,
} from "@/features/chat/saved-trip-client";
import { cn } from "@/lib/utils";
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

const suggestedPrompts = [
  "What should I do near Cloud 9 today?",
  "Where should I eat in General Luna tonight?",
  "Help me plan a quiet Siargao day",
];

type ChatContextIcon = typeof MapPin;
type RailQuestionItem =
  | { kind: "thread"; id: string; label: string; value: string }
  | { kind: "fallback"; label: string; value: string };
type TripContextDraft = {
  accommodation: string;
  dateRange: string;
  travelerType: string;
  nearbyArea: ForecastLocationLabel;
};
type ForecastLocationLabel = "Siargao Island" | "Cloud 9" | "General Luna" | "Del Carmen";
type WeatherPanelSnapshot = {
  status: "live" | "fallback";
  locationName: string;
  fetchedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  today: {
    condition: string;
    precipitationProbability: number | null;
    rainSum: number | null;
    precipitationSum: number | null;
    windGust: number | null;
  };
};
type WeatherPanelResponse = {
  requestedLocation: ForecastLocationLabel;
  weather: WeatherPanelSnapshot;
};
type SurfPanelSnapshot = {
  status: "live" | "partial" | "unavailable";
  locationName: ForecastLocationLabel;
  fetchedAt: string;
  level: "low" | "medium" | "high";
  recommendation: string;
  summary: string;
  metrics: {
    waves: string;
    tide: string;
    wind: string;
  };
  tide: {
    stationName: string;
    bestWindow: string | null;
  };
  caveats: string[];
};
type SurfPanelResponse = {
  requestedLocation: ForecastLocationLabel;
  surf: SurfPanelSnapshot;
};

const savedPlaceShortlists = [
  { label: "Cloud 9 shortlist", value: "4 places" },
  { label: "General Luna food spots", value: "7 places" },
  { label: "Catangnan cafes", value: "3 places" },
];

const fallbackRecentQuestions = [
  { kind: "fallback", label: "Is this hotel quiet?", value: "Suggested" },
  { kind: "fallback", label: "Best dinner near Catangnan", value: "Suggested" },
  { kind: "fallback", label: "Will it rain this afternoon?", value: "Suggested" },
  { kind: "fallback", label: "Surf conditions tomorrow?", value: "Suggested" },
] satisfies RailQuestionItem[];

const tripContextStorageKey = "ask-siargao:trip-context:v1";
const forecastLocationLabels = [
  "Cloud 9",
  "General Luna",
  "Del Carmen",
  "Siargao Island",
] as const satisfies readonly ForecastLocationLabel[];
const defaultTripContext: TripContextDraft = {
  accommodation: "Near Cloud 9 / Catangnan",
  dateRange: "Jun 12 - 22",
  travelerType: "Couple",
  nearbyArea: "Cloud 9",
};
const tripContextListeners = new Set<() => void>();
let tripContextSnapshotCache: { rawValue: string | null; state: TripContextDraft } | null = null;

const chatSignedOutActions = (
  <>
    <SignInButton mode="modal">
      <Button
        className="hidden h-10 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50 sm:inline-flex"
        type="button"
        variant="outline"
      >
        Sign in
      </Button>
    </SignInButton>
    <SignUpButton mode="modal">
      <Button
        className="h-10 rounded-md border-brand-violet-650 bg-brand-violet-650 px-3 text-xs font-extrabold text-white hover:bg-brand-violet-600"
        type="button"
      >
        Sign up
      </Button>
    </SignUpButton>
  </>
);

const chatErrorMessage = "Ask Siargao could not answer right now. Please try again.";
const shareErrorMessage = "Share link could not be created. Your saved items are still here.";
const maxChatRequestMessageLength = 2_000;
const maxPriorChatRequestMessages = 6;
const chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

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
  messageId?: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status?: "pending" | "complete" | "error";
  rating?: ChatResponseRatingValue | null;
  ratingStatus?: "saving";
  retryPrompt?: string;
  cards?: readonly RecommendationCardArtifact[];
  actions?: readonly ChatActionArtifact[];
  itineraries?: readonly ItineraryPlanArtifact[];
  decisionSummaries?: readonly DecisionSummaryArtifact[];
  sources?: readonly ChatSourceArtifact[];
};

type ChatActionArtifact = {
  id: string;
  label: string;
  type?: "link" | "prompt" | "navigation";
  href?: string;
  prompt?: string;
};

type DecisionSummaryArtifact = {
  id: string;
  bestAction: string;
  basis: string;
  fallback?: string;
  avoid?: string;
  timing?: string;
  area?: string;
  sources: readonly ChatSourceArtifact[];
};
type SavedPlanShareStatus = "idle" | "syncing" | "creating" | "ready" | "error";
type SavedPlanCopyStatus = "idle" | "copied" | "error";
type SavedPlanShareState = {
  excludedShareItemIds: ReadonlySet<string>;
  shareStatus: SavedPlanShareStatus;
  shareUrl: string | null;
  copyStatus: SavedPlanCopyStatus;
};
type SavedPlanShareAction =
  | { type: "reset_link" }
  | { type: "include_item"; itemId: string }
  | { type: "toggle_item"; itemId: string; shouldInclude: boolean }
  | { type: "syncing" }
  | { type: "creating" }
  | { type: "ready"; shareUrl: string }
  | { type: "error" }
  | { type: "copied" }
  | { type: "copy_error" };

type ChatResponseRatingValue = "up" | "down";

type ChatMessageRating = {
  rating: ChatResponseRatingValue;
  reasonCodes?: string[];
  comment?: string | null;
};

type ChatThreadSummary = {
  id: string;
  title: string;
  archivedAt?: string | null;
  updatedAt?: string;
  lastMessageAt?: string | null;
};

type ChatThreadDetailMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  sources?: ChatSourceArtifact[];
  cards?: RecommendationCardArtifact[];
  actions?: ChatActionArtifact[];
  itineraries?: ItineraryPlanArtifact[];
  decisionSummaries?: DecisionSummaryArtifact[];
  rating?: ChatMessageRating | null;
  createdAt: string;
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
      type: "table";
      headers: string[];
      rows: string[][];
      alignments: AssistantMarkdownTableAlignment[];
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
type AssistantMarkdownTableAlignment = "left" | "center" | "right";
type AssistantMarkdownListItems = Extract<AssistantMarkdownBlock, { type: "list" }>["items"];

function useSavedPlanSharing(savedTripState: SavedTripState) {
  const [shareState, dispatchShareState] = useReducer(
    savedPlanShareReducer,
    createInitialSavedPlanShareState(),
  );
  const selectedShareItems = useMemo(
    () => savedTripState.items.filter((item) => !shareState.excludedShareItemIds.has(item.id)),
    [savedTripState.items, shareState.excludedShareItemIds],
  );

  const includeItem = useCallback((itemId: string) => {
    dispatchShareState({ type: "include_item", itemId });
  }, []);
  const toggleItem = useCallback((itemId: string, shouldInclude: boolean) => {
    dispatchShareState({ type: "toggle_item", itemId, shouldInclude });
  }, []);
  const createShareLink = useCallback(async () => {
    if (shareState.shareStatus === "syncing" || shareState.shareStatus === "creating") {
      return;
    }

    if (selectedShareItems.length === 0) {
      dispatchShareState({ type: "error" });
      return;
    }

    dispatchShareState({ type: "syncing" });

    try {
      await postSavedTripItems({
        tripId: savedTripState.tripId,
        items: selectedShareItems,
      });

      dispatchShareState({ type: "creating" });
      const result = await postSharedTripPlan({
        tripId: savedTripState.tripId,
        itemIds: selectedShareItems.map((item) => item.id),
        title: buildSharedPlanTitle(selectedShareItems),
      });

      dispatchShareState({ type: "ready", shareUrl: result.shareUrl });
    } catch {
      dispatchShareState({ type: "error" });
    }
  }, [savedTripState.tripId, selectedShareItems, shareState.shareStatus]);
  const copyShareLink = useCallback(async () => {
    if (!shareState.shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareState.shareUrl);
      dispatchShareState({ type: "copied" });
    } catch {
      dispatchShareState({ type: "copy_error" });
    }
  }, [shareState.shareUrl]);

  return {
    ...shareState,
    selectedShareItems,
    includeItem,
    toggleItem,
    createShareLink,
    copyShareLink,
  };
}

function savedPlanShareReducer(
  state: SavedPlanShareState,
  action: SavedPlanShareAction,
): SavedPlanShareState {
  switch (action.type) {
    case "include_item":
      return resetSavedPlanShareLink({
        ...state,
        excludedShareItemIds: withoutSetValue(state.excludedShareItemIds, action.itemId),
      });
    case "toggle_item":
      return resetSavedPlanShareLink({
        ...state,
        excludedShareItemIds: action.shouldInclude
          ? withoutSetValue(state.excludedShareItemIds, action.itemId)
          : withSetValue(state.excludedShareItemIds, action.itemId),
      });
    case "syncing":
      return { ...state, shareStatus: "syncing", shareUrl: null, copyStatus: "idle" };
    case "creating":
      return { ...state, shareStatus: "creating", shareUrl: null, copyStatus: "idle" };
    case "ready":
      return { ...state, shareStatus: "ready", shareUrl: action.shareUrl, copyStatus: "idle" };
    case "error":
      return { ...state, shareStatus: "error", shareUrl: null, copyStatus: "idle" };
    case "copied":
      return { ...state, copyStatus: "copied" };
    case "copy_error":
      return { ...state, copyStatus: "error" };
  }

  return state;
}

function resetSavedPlanShareLink(state: SavedPlanShareState): SavedPlanShareState {
  return {
    ...state,
    shareStatus: "idle",
    shareUrl: null,
    copyStatus: "idle",
  };
}

function createInitialSavedPlanShareState(): SavedPlanShareState {
  return {
    excludedShareItemIds: new Set<string>(),
    shareStatus: "idle",
    shareUrl: null,
    copyStatus: "idle",
  };
}

export function ChatWorkspace({ initialPrompt = "" }: { initialPrompt?: string }) {
  const controller = useChatWorkspaceController(initialPrompt);

  return <ChatWorkspaceView {...controller} />;
}

type ChatWorkspaceController = {
  chatThreads: ChatThreadSummary[];
  handlePromptSubmit: (prompt: string) => void;
  historyStatus: "idle" | "loading" | "error";
  inputValue: string;
  isSending: boolean;
  locationState: LocationCaptureState;
  messages: InteractiveChatMessage[];
  openChatThread: (threadId: string) => Promise<void>;
  archiveSelectedThread: () => Promise<void>;
  deleteSelectedThread: () => Promise<void>;
  rateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => Promise<void>;
  removeSavedItem: (itemId: string) => void;
  renameSelectedThread: () => Promise<void>;
  requestLocation: () => void;
  saveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  saveRecommendationCard: (card: RecommendationCardArtifact) => void;
  savedItemIds: ReadonlySet<string>;
  savedPlanSharing: ReturnType<typeof useSavedPlanSharing>;
  savedTripState: SavedTripState;
  selectedThreadId: string | null;
  setInputValue: (value: string) => void;
  startNewChat: () => void;
  tripContext: TripContextDraft;
  updateTripContext: (context: TripContextDraft) => void;
};

function useChatWorkspaceController(initialPrompt: string): ChatWorkspaceController {
  const [inputValue, setInputValue] = useState(() => initialPrompt.trim());
  const [isSending, setIsSending] = useState(false);
  const [locationState, setLocationState] = useState<LocationCaptureState>({ status: "idle" });
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "error">("idle");
  const tripContext = useSyncExternalStore(
    subscribeTripContextState,
    getTripContextSnapshot,
    getTripContextServerSnapshot,
  );
  const savedTripState = useSyncExternalStore(
    subscribeSavedTripState,
    getSavedTripSnapshot,
    getSavedTripServerSnapshot,
  );
  const savedItemIds = useMemo(
    () => new Set(savedTripState.items.map((item) => item.id)),
    [savedTripState],
  );
  const savedPlanSharing = useSavedPlanSharing(savedTripState);
  const { data: authenticatedSavedTrip, mutate: refreshAuthenticatedSavedTrip } = useSWR(
    "/api/trips/saved",
    fetchAuthenticatedSavedTrip,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const { trigger: syncAuthenticatedSavedTripItems } = useSWRMutation(
    "/api/trips/saved",
    syncSavedTripItemsMutation,
  );
  const hasSyncedAuthenticatedSavedTrip = useRef(false);

  useEffect(() => {
    if (!authenticatedSavedTrip || hasSyncedAuthenticatedSavedTrip.current) {
      return;
    }

    hasSyncedAuthenticatedSavedTrip.current = true;
    const initialAuthenticatedSavedTrip = authenticatedSavedTrip;
    let isActive = true;

    async function syncAuthenticatedSavedTrip() {
      const currentState = getSavedTripSnapshot();
      let nextSavedTrip: SavedTripApiResponse | null = initialAuthenticatedSavedTrip;
      if (currentState.items.length > 0) {
        await syncAuthenticatedSavedTripItems({
          tripId: currentState.tripId,
          items: currentState.items,
        });
        nextSavedTrip = (await refreshAuthenticatedSavedTrip()) ?? nextSavedTrip;
      }

      if (!isActive) {
        return;
      }
      writeAuthenticatedSavedTripState(nextSavedTrip, currentState.tripId);
    }

    void syncAuthenticatedSavedTrip().catch(() => {});

    return () => {
      isActive = false;
    };
  }, [authenticatedSavedTrip, refreshAuthenticatedSavedTrip, syncAuthenticatedSavedTripItems]);

  const refreshChatThreads = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/threads", { cache: "no-store" });
      if (response.status === 401 || response.status === 404) {
        setChatThreads([]);
        return;
      }
      if (!response.ok) {
        setHistoryStatus("error");
        return;
      }

      const body = (await response.json()) as { threads?: ChatThreadSummary[] };
      setChatThreads(body.threads ?? []);
      setHistoryStatus("idle");
    } catch {
      setHistoryStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshChatThreads();
  }, [refreshChatThreads]);

  const openChatThread = useCallback(async (threadId: string) => {
    setHistoryStatus("loading");
    try {
      const response = await fetch(`/api/chat/threads/${threadId}`, { cache: "no-store" });
      if (!response.ok) {
        setHistoryStatus("error");
        return;
      }

      const body = (await response.json()) as {
        messages?: ChatThreadDetailMessage[];
        thread?: ChatThreadSummary;
      };
      setSelectedThreadId(threadId);
      setMessages((body.messages ?? []).map(interactiveMessageFromThreadMessage));
      setHistoryStatus("idle");
    } catch {
      setHistoryStatus("error");
    }
  }, []);

  const startNewChat = useCallback(() => {
    setSelectedThreadId(null);
    setMessages([]);
    setInputValue("");
  }, []);

  const renameSelectedThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    const currentTitle =
      chatThreads.find((thread) => thread.id === selectedThreadId)?.title ?? "Siargao chat";
    const title = window.prompt("Thread title", currentTitle)?.trim();
    if (!title) {
      return;
    }

    await fetch(`/api/chat/threads/${selectedThreadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await refreshChatThreads();
  }, [chatThreads, refreshChatThreads, selectedThreadId]);

  const archiveSelectedThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    await fetch(`/api/chat/threads/${selectedThreadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await refreshChatThreads();
  }, [refreshChatThreads, selectedThreadId]);

  const deleteSelectedThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    await fetch(`/api/chat/threads/${selectedThreadId}`, { method: "DELETE" });
    startNewChat();
    await refreshChatThreads();
  }, [refreshChatThreads, selectedThreadId, startNewChat]);

  const rateAssistantMessage = useCallback(
    async (messageId: string, rating: ChatResponseRatingValue) => {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.messageId === messageId ? { ...message, ratingStatus: "saving" } : message,
        ),
      );

      try {
        const response = await fetch("/api/chat/ratings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId, rating }),
        });
        const body = (await response.json()) as { rating?: ChatMessageRating };
        if (!response.ok || !body.rating) {
          throw new Error("rating_failed");
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.messageId === messageId
              ? { ...message, rating: body.rating?.rating, ratingStatus: undefined }
              : message,
          ),
        );
      } catch {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.messageId === messageId ? { ...message, ratingStatus: undefined } : message,
          ),
        );
      }
    },
    [],
  );

  const captureLocation = useCallback(
    async (
      consentScope: ChatClientGeolocation["consentScope"] = "single_request",
    ): Promise<LocationCaptureState> => {
      if (!("geolocation" in navigator)) {
        const nextState = { status: "unsupported" } satisfies LocationCaptureState;
        setLocationState(nextState);
        return nextState;
      }

      setLocationState({ status: "requesting" });

      return new Promise<LocationCaptureState>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const nextState = {
              status: "ready",
              geolocation: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                ...(Number.isFinite(position.coords.accuracy)
                  ? { accuracyMeters: position.coords.accuracy }
                  : {}),
                capturedAt: new Date(position.timestamp).toISOString(),
                consentScope,
              },
            } satisfies LocationCaptureState;
            setLocationState(nextState);
            resolve(nextState);
          },
          (error) => {
            const nextState = {
              status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
            } satisfies LocationCaptureState;
            setLocationState(nextState);
            resolve(nextState);
          },
          {
            enableHighAccuracy: true,
            maximumAge: 60_000,
            timeout: 10_000,
          },
        );
      });
    },
    [],
  );

  const requestLocation = useCallback(() => {
    void captureLocation("trip_session");
  }, [captureLocation]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || isSending) {
        return;
      }

      setIsSending(true);
      let requestLocationState = locationState;
      if (shouldCaptureLocationForPrompt(trimmedPrompt, locationState)) {
        requestLocationState = await captureLocation();
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
      const requestBody = buildChatRequestBody(
        requestMessages,
        requestLocationState,
        selectedThreadId,
      );

      setInputValue("");
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
          decisionSummaries?: DecisionSummaryArtifact[];
          sources?: ChatSourceArtifact[];
          threadId?: string;
          assistantMessageId?: string;
        };

        const responseMessage = body.message;

        if (!response.ok || !responseMessage) {
          throw new Error(chatErrorMessage);
        }

        if (body.threadId) {
          setSelectedThreadId(body.threadId);
          void refreshChatThreads();
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  messageId: body.assistantMessageId ?? message.messageId,
                  text: responseMessage,
                  timestamp: formatTimestamp(),
                  status: "complete",
                  cards: body.cards,
                  actions: body.actions,
                  itineraries: body.itineraries,
                  decisionSummaries: body.decisionSummaries,
                  sources: body.sources,
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
    [captureLocation, isSending, locationState, messages, refreshChatThreads, selectedThreadId],
  );

  const saveRecommendationCard = useCallback(
    (card: RecommendationCardArtifact) => {
      const state = getSavedTripSnapshot();
      const nextItem = buildSavedItemFromCard(card, state.tripId);
      writeSavedTripState(upsertSavedTripItem(state, nextItem));
      savedPlanSharing.includeItem(nextItem.id);
    },
    [savedPlanSharing],
  );

  const saveItineraryPlan = useCallback(
    (plan: ItineraryPlanArtifact) => {
      const state = getSavedTripSnapshot();
      const nextItem = buildSavedItemFromItinerary(plan, state.tripId);
      writeSavedTripState(upsertSavedTripItem(state, nextItem));
      savedPlanSharing.includeItem(nextItem.id);
    },
    [savedPlanSharing],
  );

  const removeSavedItem = useCallback(
    (itemId: string) => {
      const state = getSavedTripSnapshot();
      writeSavedTripState({
        ...state,
        items: state.items.filter((item) => item.id !== itemId),
        updatedAt: new Date().toISOString(),
      });
      void deleteSavedTripItem({ itemId, tripId: state.tripId }).catch(() => {});
      savedPlanSharing.includeItem(itemId);
    },
    [savedPlanSharing],
  );

  const handlePromptSubmit = useCallback(
    (prompt: string) => {
      void submitPrompt(prompt);
    },
    [submitPrompt],
  );

  const updateTripContext = useCallback((context: TripContextDraft) => {
    writeStoredTripContext(context);
  }, []);

  return {
    chatThreads,
    handlePromptSubmit,
    historyStatus,
    inputValue,
    isSending,
    locationState,
    messages,
    openChatThread,
    archiveSelectedThread,
    deleteSelectedThread,
    rateAssistantMessage,
    removeSavedItem,
    renameSelectedThread,
    requestLocation,
    saveItineraryPlan,
    saveRecommendationCard,
    savedItemIds,
    savedPlanSharing,
    savedTripState,
    selectedThreadId,
    setInputValue,
    startNewChat,
    tripContext,
    updateTripContext,
  };
}

function ChatWorkspaceView({
  chatThreads,
  handlePromptSubmit,
  historyStatus,
  inputValue,
  isSending,
  locationState,
  messages,
  openChatThread,
  rateAssistantMessage,
  removeSavedItem,
  requestLocation,
  saveItineraryPlan,
  saveRecommendationCard,
  savedItemIds,
  savedPlanSharing,
  savedTripState,
  selectedThreadId,
  setInputValue,
  startNewChat,
  tripContext,
  updateTripContext,
}: ChatWorkspaceController) {
  const hasMessages = messages.length > 0;
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages.at(-1);
  const scrollAnchorVersion = `${messages.length}:${
    lastMessage?.id ?? "empty"
  }:${lastMessage?.status ?? "idle"}:${lastMessage?.text.length ?? 0}:${
    lastMessage?.cards?.length ?? 0
  }:${lastMessage?.itineraries?.length ?? 0}:${
    lastMessage?.decisionSummaries?.length ?? 0
  }:${savedTripState.items.length}`;

  useEffect(() => {
    const chatScrollArea = chatScrollAreaRef.current;
    if (!chatScrollArea) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (!scrollAnchorVersion) {
        return;
      }
      chatScrollArea.scrollTop = chatScrollArea.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [scrollAnchorVersion]);

  return (
    <main
      aria-label="Ask Siargao chat workspace"
      className="fixed inset-0 h-dvh overflow-hidden bg-white text-text-strong min-[1180px]:bg-brand-lavender-50"
    >
      <section className="grid h-full min-h-0 w-full grid-cols-1 min-[1180px]:grid-cols-[15rem_minmax(0,1fr)_18rem] xl:grid-cols-[17rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[19.5rem_minmax(0,1fr)_22.5rem]">
        <ChatTravelRail
          historyStatus={historyStatus}
          onOpenThread={(threadId) => {
            void openChatThread(threadId);
          }}
          onStartNewChat={startNewChat}
          savedItemCount={savedTripState.items.length}
          selectedThreadId={selectedThreadId}
          threads={chatThreads}
        />

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-white min-[1180px]:border-border-default min-[1180px]:border-x min-[1180px]:bg-surface-default">
          <ChatTopBar
            canSharePlan={savedPlanSharing.selectedShareItems.length > 0}
            onSharePlan={() => {
              void savedPlanSharing.createShareLink();
            }}
            onStartNewChat={startNewChat}
          />

          <section
            aria-label="Chat message scroll area"
            className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4 lg:px-8"
            data-testid="chat-message-scroll-area"
            ref={chatScrollAreaRef}
          >
            <div className="mx-auto grid min-h-full max-w-5xl content-start gap-5 pb-5 sm:gap-4 sm:pb-6">
              {savedTripState.items.length ? (
                <SavedPlanTray
                  copyStatus={savedPlanSharing.copyStatus}
                  excludedShareItemIds={savedPlanSharing.excludedShareItemIds}
                  items={savedTripState.items}
                  onCopyShareLink={savedPlanSharing.copyShareLink}
                  onCreateShareLink={() => {
                    void savedPlanSharing.createShareLink();
                  }}
                  onRemoveItem={removeSavedItem}
                  onToggleShareItem={savedPlanSharing.toggleItem}
                  selectedItemCount={savedPlanSharing.selectedShareItems.length}
                  shareStatus={savedPlanSharing.shareStatus}
                  shareUrl={savedPlanSharing.shareUrl}
                />
              ) : null}
              {hasMessages ? (
                <>
                  <div className="grid gap-4" role="log" aria-label="Conversation messages">
                    {messages.map((message) => (
                      <ChatMessage
                        disabled={isSending}
                        key={message.id}
                        message={message}
                        onRateAssistantMessage={(messageId, rating) => {
                          void rateAssistantMessage(messageId, rating);
                        }}
                        onRetryPrompt={handlePromptSubmit}
                        onSaveItineraryPlan={saveItineraryPlan}
                        onSaveRecommendationCard={saveRecommendationCard}
                        onRemoveSavedItem={removeSavedItem}
                        onSubmitPrompt={handlePromptSubmit}
                        savedItemIds={savedItemIds}
                      />
                    ))}
                  </div>
                  <SuggestedPromptBar
                    disabled={isSending}
                    onSubmitPrompt={handlePromptSubmit}
                    prompts={suggestedPrompts}
                  />
                </>
              ) : (
                <ChatEmptyState
                  disabled={isSending}
                  onSubmitPrompt={handlePromptSubmit}
                  prompts={suggestedPrompts}
                />
              )}
            </div>
          </section>

          <ChatComposer
            inputValue={inputValue}
            isSending={isSending}
            locationState={locationState}
            onInputValueChange={setInputValue}
            onRequestLocation={requestLocation}
            onSubmitPrompt={handlePromptSubmit}
          />
        </section>

        <ChatContextRail
          locationState={locationState}
          onRequestLocation={requestLocation}
          tripContext={tripContext}
          onUpdateTripContext={updateTripContext}
        />
      </section>
    </main>
  );
}

function ChatTravelRail({
  historyStatus,
  onOpenThread,
  onStartNewChat,
  savedItemCount,
  selectedThreadId,
  threads,
}: {
  historyStatus: "idle" | "loading" | "error";
  onOpenThread: (threadId: string) => void;
  onStartNewChat: () => void;
  savedItemCount: number;
  selectedThreadId: string | null;
  threads: ChatThreadSummary[];
}) {
  const hasThreads = threads.length > 0;
  const recentQuestions: RailQuestionItem[] = hasThreads
    ? threads.slice(0, 4).map((thread) => ({
        kind: "thread",
        id: thread.id,
        label: thread.title,
        value: formatThreadRecency(thread),
      }))
    : fallbackRecentQuestions;

  return (
    <aside className="hidden min-h-0 bg-brand-navy-980 px-5 py-6 text-text-on-dark min-[1180px]:grid min-[1180px]:grid-rows-[auto_auto_minmax(0,1fr)_auto] min-[1180px]:gap-6">
      <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
        <BrandLockup className="[&_span:last-child]:text-[1.55rem]" />
      </Link>

      <Button
        asChild
        className="h-14 w-full justify-between rounded-lg bg-brand-violet-600 px-5 text-base font-black text-white shadow-violet-glow hover:bg-brand-violet-550"
      >
        <Link aria-label="Start a new chat" href="/chat" onClick={onStartNewChat}>
          <span className="inline-flex items-center gap-2">
            <Plus aria-hidden="true" size={18} />
            New question
          </span>
          <Sparkles aria-hidden="true" size={20} />
        </Link>
      </Button>

      <div className="grid min-h-0 content-start gap-5 overflow-hidden">
        <section className="grid gap-3">
          <p className="m-0 text-xs font-black tracking-[0.08em] text-text-on-dark-muted uppercase">
            Current trip
          </p>
          <div className="grid gap-1 rounded-lg border border-white/16 bg-white/8 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 min-w-0 truncate text-sm font-black text-white">June surf trip</h2>
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-violet-650 text-sm font-black text-white">
                {Math.max(savedItemCount, threads.length)}
              </span>
            </div>
            <p className="m-0 text-sm font-bold text-text-on-dark-muted">Jun 12 - 22</p>
          </div>
        </section>

        <section className="grid gap-3">
          <p className="m-0 text-xs font-black tracking-[0.08em] text-text-on-dark-muted uppercase">
            Saved places
          </p>
          <div className="grid gap-3">
            {savedPlaceShortlists.map((item) => (
              <div className="grid gap-1" key={item.label}>
                <p className="m-0 text-sm font-extrabold text-white">{item.label}</p>
                <p className="m-0 text-sm font-bold text-text-on-dark-muted">{item.value}</p>
              </div>
            ))}
          </div>
          <Link
            className="inline-flex w-fit items-center gap-2 text-sm font-extrabold text-white no-underline hover:text-brand-lagoon-300"
            href="/settings"
          >
            View all saved places
            <ChevronDown aria-hidden="true" className="-rotate-90" size={15} />
          </Link>
        </section>

        <section className="grid gap-3 border-white/12 border-t pt-5">
          <h2 className="m-0 text-xs font-black tracking-[0.08em] text-text-on-dark-muted uppercase">
            {hasThreads ? "Recent questions" : "Suggested questions"}
          </h2>
          {historyStatus === "error" ? (
            <p className="m-0 text-xs font-bold text-text-alert">Chat history unavailable</p>
          ) : null}
          {historyStatus === "loading" ? (
            <p className="m-0 text-xs font-bold text-text-on-dark-muted">Loading thread</p>
          ) : null}
          <nav aria-label={hasThreads ? "Previous chats" : "Suggested questions"}>
            <div className="grid gap-3">
              {recentQuestions.map((item) =>
                item.kind === "thread" ? (
                  <button
                    className={cn(
                      "grid min-w-0 gap-1 rounded-md border border-transparent p-0 text-left",
                      "text-sm transition-[color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                      item.id === selectedThreadId
                        ? "text-brand-lagoon-300"
                        : "text-white hover:text-brand-lagoon-300",
                    )}
                    key={item.id}
                    onClick={() => onOpenThread(item.id)}
                    type="button"
                  >
                    <span className="min-w-0 truncate font-extrabold">{item.label}</span>
                    <span className="text-xs font-bold text-text-on-dark-muted">{item.value}</span>
                  </button>
                ) : (
                  <div className="grid gap-1" key={item.label}>
                    <p className="m-0 min-w-0 truncate text-sm font-extrabold text-white">
                      {item.label}
                    </p>
                    <p className="m-0 text-xs font-bold text-text-on-dark-muted">{item.value}</p>
                  </div>
                ),
              )}
            </div>
          </nav>
        </section>
      </div>

      <Link
        className="grid min-h-28 content-between overflow-hidden rounded-lg border border-brand-violet-400/25 bg-[image:var(--gradient-sunset-backdrop)] bg-cover bg-center p-4 text-white no-underline"
        href="/settings"
      >
        <span className="grid gap-1">
          <span className="text-base font-black">Love Ask Siargao?</span>
          <span className="text-xs font-bold text-white/85">Invite friends and unlock extras.</span>
        </span>
        <ExternalLink aria-hidden="true" size={18} />
      </Link>
    </aside>
  );
}

function ChatTopBar({
  canSharePlan,
  onSharePlan,
  onStartNewChat,
}: {
  canSharePlan: boolean;
  onSharePlan: () => void;
  onStartNewChat: () => void;
}) {
  return (
    <header className="flex min-h-[98px] items-start justify-between gap-3 bg-white px-4 pt-5 pb-4 min-[390px]:min-h-[104px] min-[390px]:gap-4 min-[390px]:px-5 min-[390px]:pt-6 sm:min-h-[76px] sm:items-center sm:border-border-default sm:border-b sm:bg-surface-glass sm:px-6 sm:py-3 lg:px-8">
      <div className="flex min-w-0 items-center gap-2.5 min-[390px]:gap-3 sm:gap-3.5">
        <Link aria-label="Ask Siargao home" className="shrink-0 no-underline" href="/">
          <PalmMark className="size-11 min-[390px]:size-14 sm:size-11" />
        </Link>
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 min-w-0 truncate text-[1.45rem] leading-none font-black text-text-strong min-[390px]:text-[1.85rem] sm:text-2xl">
            Ask Siargao
          </h1>
          <p className="m-0 min-w-0 truncate text-sm leading-tight font-extrabold text-text-muted min-[390px]:text-base sm:inline-flex sm:items-center sm:gap-2 sm:text-sm">
            <span className="hidden size-2 shrink-0 rounded-full bg-brand-lagoon-500 sm:inline-block" />
            Local travel assistant
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          aria-label="Reset chat"
          className="size-10 rounded-lg border-border-default bg-white text-brand-violet-650 shadow-sm hover:bg-brand-lavender-100 min-[390px]:size-12 sm:size-10 sm:rounded-md"
          onClick={onStartNewChat}
          size="icon"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" size={17} />
        </Button>
        <Button
          aria-label="Share saved plan"
          className="hidden size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100 disabled:opacity-45 sm:inline-flex"
          disabled={!canSharePlan}
          onClick={onSharePlan}
          size="icon"
          type="button"
          variant="outline"
        >
          <Share2 aria-hidden="true" size={17} />
        </Button>
        <Button
          asChild
          className="size-10 rounded-lg border-border-default bg-white text-brand-violet-650 shadow-sm hover:bg-brand-lavender-100 min-[390px]:size-12 sm:hidden"
          size="icon"
          variant="outline"
        >
          <Link aria-label="Open settings" href="/settings">
            <EllipsisVertical aria-hidden="true" size={19} />
          </Link>
        </Button>
        <ChatSettingsLink />
        <ChatAuthActions />
      </div>
    </header>
  );
}

function ChatSettingsLink() {
  return (
    <>
      <Button
        asChild
        className="hidden h-10 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50 sm:inline-flex"
        variant="outline"
      >
        <Link href="/settings">
          <SettingsIcon aria-hidden="true" size={15} />
          Settings
        </Link>
      </Button>
      <Button
        asChild
        className="hidden size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
        size="icon"
        variant="outline"
      >
        <Link aria-label="Open settings" href="/settings">
          <SettingsIcon aria-hidden="true" size={17} />
        </Link>
      </Button>
    </>
  );
}

function ChatContextRail({
  locationState,
  onRequestLocation,
  onUpdateTripContext,
  tripContext,
}: {
  locationState: LocationCaptureState;
  onRequestLocation: () => void;
  onUpdateTripContext: (context: TripContextDraft) => void;
  tripContext: TripContextDraft;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TripContextDraft>(defaultTripContext);
  const activeForecastLocation =
    locationState.status === "ready"
      ? nearestForecastLocationLabel(locationState.geolocation)
      : tripContext.nearbyArea;
  const weatherUrl = `/api/public/weather/siargao?location=${encodeURIComponent(
    activeForecastLocation,
  )}`;
  const surfUrl = `/api/public/surf/siargao?location=${encodeURIComponent(activeForecastLocation)}`;
  const {
    data: weatherData,
    error: weatherError,
    isLoading: weatherLoading,
    mutate: refreshWeather,
  } = useSWR<WeatherPanelResponse>(weatherUrl, fetchWeatherPanel, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: surfData,
    error: surfError,
    isLoading: surfLoading,
    mutate: refreshSurf,
  } = useSWR<SurfPanelResponse>(surfUrl, fetchSurfPanel, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const weatherSnapshot = weatherData?.weather;
  const surfSnapshot = surfData?.surf;
  const weatherMetrics = weatherMetricsForPanel(weatherSnapshot);
  const surfMetrics = surfMetricsForPanel(surfSnapshot);
  const tripContextItems = tripContextFacts({
    activeForecastLocation,
    locationState,
    tripContext,
  });

  const saveDraft = useCallback(() => {
    onUpdateTripContext(normalizeTripContextDraft(draft));
    setIsEditing(false);
  }, [draft, onUpdateTripContext]);

  return (
    <aside
      aria-label="Trip context and live conditions"
      className="hidden min-h-0 content-start gap-3 overflow-hidden border-border-default border-l bg-surface-default p-3 min-[1180px]:grid"
      data-testid="context-rail"
    >
      <ContextCard
        action={
          isEditing ? (
            <div className="flex items-center gap-2">
              <Button
                className="h-8 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-muted hover:bg-brand-lavender-50"
                onClick={() => {
                  setDraft(tripContext);
                  setIsEditing(false);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="h-8 rounded-md bg-brand-violet-650 px-3 text-xs font-extrabold text-white hover:bg-brand-violet-600"
                onClick={saveDraft}
                size="sm"
                type="button"
              >
                Save
              </Button>
            </div>
          ) : (
            <Button
              className="h-8 rounded-md border-brand-violet-400/25 bg-brand-lavender-50 px-3 text-xs font-extrabold text-brand-violet-650 hover:bg-brand-lavender-100"
              onClick={() => {
                setDraft(tripContext);
                setIsEditing(true);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          )
        }
        title="Trip context"
      >
        {isEditing ? (
          <TripContextEditor draft={draft} onDraftChange={setDraft} />
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {tripContextItems.map((item) => (
                <ContextFact
                  icon={item.icon}
                  key={item.label}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </div>
            {locationState.status !== "ready" ? (
              <Button
                className="h-8 rounded-md border-brand-lagoon-500/25 bg-brand-lagoon-50 px-3 text-xs font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100"
                onClick={onRequestLocation}
                type="button"
                variant="outline"
              >
                Use browser location
              </Button>
            ) : null}
          </div>
        )}
      </ContextCard>

      <ContextCard
        action={
          <Button
            aria-label="Refresh weather"
            className="size-8 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            onClick={() => {
              void refreshWeather();
            }}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={15} />
          </Button>
        }
        title={`${activeForecastLocation} Weather`}
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <CloudSun aria-hidden="true" className="text-brand-violet-650" size={30} />
            <div className="min-w-0">
              <p className="m-0 text-xl font-black leading-tight text-text-strong">
                {weatherPanelTitle({
                  error: weatherError,
                  isLoading: weatherLoading,
                  weatherSnapshot,
                })}
              </p>
              <p className="m-0 text-xs font-bold text-text-muted">
                {weatherPanelSubtitle({
                  activeForecastLocation,
                  error: weatherError,
                  isLoading: weatherLoading,
                  weatherSnapshot,
                })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {weatherMetrics.map((item) => (
              <MetricTile key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
          <p
            className={cn(
              "m-0 inline-flex items-center gap-2 text-xs font-extrabold",
              weatherSnapshot?.status === "live" ? "text-confidence-high" : "text-text-muted",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                weatherSnapshot?.status === "live" ? "bg-confidence-high" : "bg-text-muted",
              )}
            />
            {weatherSnapshot?.status === "live"
              ? "Checked with Open-Meteo"
              : "Open-Meteo forecast unavailable"}
          </p>
        </div>
      </ContextCard>

      <ContextCard
        action={
          <Button
            aria-label="Refresh surf conditions"
            className="size-8 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            onClick={() => {
              void refreshSurf();
            }}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={15} />
          </Button>
        }
        title="Live surf conditions"
      >
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 inline-flex min-w-0 items-center gap-2 text-base font-black text-text-strong">
              <WavesHorizontal aria-hidden="true" className="text-brand-violet-650" size={18} />
              {activeForecastLocation}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[0.68rem] font-black leading-none",
                surfSnapshot?.status === "live"
                  ? "bg-confidence-high-soft text-confidence-high"
                  : "bg-brand-lavender-50 text-text-muted",
              )}
            >
              {surfBadgeLabel({ error: surfError, isLoading: surfLoading, surfSnapshot })}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {surfMetrics.map((item) => (
              <MetricTile key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
          <p
            className={cn(
              "m-0 inline-flex items-start gap-2 text-xs font-extrabold",
              surfSnapshot?.level === "high" ? "text-text-alert" : "text-confidence-high",
            )}
          >
            <span
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full",
                surfSnapshot?.level === "high" ? "bg-text-alert" : "bg-confidence-high",
              )}
            />
            <span className="min-w-0">
              {surfPanelSummary({ error: surfError, isLoading: surfLoading, surfSnapshot })}
            </span>
          </p>
        </div>
      </ContextCard>
    </aside>
  );
}

function ContextCard({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-border-default bg-white p-3 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 min-w-0 text-base font-black leading-tight text-text-strong">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ContextFact({
  icon: Icon,
  label,
  value,
}: {
  icon: ChatContextIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-2">
      <Icon aria-hidden="true" className="mt-0.5 text-brand-violet-650" size={16} />
      <div className="min-w-0">
        <p className="m-0 text-[0.68rem] font-bold leading-tight text-text-muted">{label}</p>
        <p className="m-0 min-w-0 break-words text-xs font-black leading-tight text-text-strong">
          {value}
        </p>
      </div>
    </div>
  );
}

function TripContextEditor({
  draft,
  onDraftChange,
}: {
  draft: TripContextDraft;
  onDraftChange: (draft: TripContextDraft) => void;
}) {
  return (
    <div className="grid gap-3">
      <TripContextField
        label="Accommodation"
        onChange={(value) => {
          onDraftChange({ ...draft, accommodation: value });
        }}
        value={draft.accommodation}
      />
      <TripContextField
        label="Dates"
        onChange={(value) => {
          onDraftChange({ ...draft, dateRange: value });
        }}
        value={draft.dateRange}
      />
      <TripContextField
        label="Traveler type"
        onChange={(value) => {
          onDraftChange({ ...draft, travelerType: value });
        }}
        value={draft.travelerType}
      />
      <label className="grid gap-1 text-xs font-extrabold text-text-muted">
        Nearby area
        <select
          className="h-10 rounded-md border border-border-default bg-white px-3 text-sm font-black text-text-strong outline-none focus:border-brand-violet-650"
          onChange={(event) => {
            onDraftChange({
              ...draft,
              nearbyArea: event.currentTarget.value as ForecastLocationLabel,
            });
          }}
          value={draft.nearbyArea}
        >
          {forecastLocationLabels.map((location) => (
            <option key={location} value={location}>
              {location}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function TripContextField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-extrabold text-text-muted">
      {label}
      <input
        className="h-10 rounded-md border border-border-default bg-white px-3 text-sm font-black text-text-strong outline-none focus:border-brand-violet-650"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        value={value}
      />
    </label>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-12 content-center gap-0.5 rounded-md bg-brand-lavender-50 px-2 py-1.5">
      <p className="m-0 text-[0.68rem] font-bold leading-tight text-text-muted">{label}</p>
      <p className="m-0 text-xs font-black leading-tight text-text-strong">{value}</p>
    </div>
  );
}

function tripContextFacts({
  activeForecastLocation,
  locationState,
  tripContext,
}: {
  activeForecastLocation: ForecastLocationLabel;
  locationState: LocationCaptureState;
  tripContext: TripContextDraft;
}): Array<{ icon: ChatContextIcon; label: string; value: string }> {
  return [
    { icon: BedDouble, label: "Accommodation", value: tripContext.accommodation },
    { icon: CalendarDays, label: "Dates", value: tripContext.dateRange },
    { icon: Users, label: "Traveler type", value: tripContext.travelerType },
    { icon: MapPin, label: "Nearby area", value: tripContext.nearbyArea },
    { icon: CloudSun, label: "Forecast area", value: activeForecastLocation },
    { icon: Clock, label: "Location source", value: locationSourceLabel(locationState) },
  ];
}

function weatherMetricsForPanel(weather: WeatherPanelSnapshot | undefined) {
  return [
    {
      label: "Rain chance",
      value:
        weather?.today.precipitationProbability === null ||
        weather?.today.precipitationProbability === undefined
          ? "-"
          : `${weather.today.precipitationProbability}%`,
    },
    {
      label: "Rain",
      value:
        weather?.today.rainSum === null || weather?.today.rainSum === undefined
          ? "-"
          : `${formatPanelNumber(weather.today.rainSum)} mm`,
    },
    {
      label: "Wind gust",
      value:
        weather?.today.windGust === null || weather?.today.windGust === undefined
          ? "-"
          : `${formatPanelNumber(weather.today.windGust)} km/h`,
    },
  ];
}

function surfMetricsForPanel(surf: SurfPanelSnapshot | undefined) {
  return [
    { label: "Waves", value: surf?.metrics.waves ?? "-" },
    { label: "Tide", value: surf?.metrics.tide ?? "-" },
    { label: "Wind", value: surf?.metrics.wind ?? "-" },
  ];
}

function weatherPanelTitle({
  error,
  isLoading,
  weatherSnapshot,
}: {
  error: unknown;
  isLoading: boolean;
  weatherSnapshot: WeatherPanelSnapshot | undefined;
}) {
  if (isLoading) {
    return "Loading forecast";
  }
  if (error) {
    return "Forecast unavailable";
  }
  return weatherSnapshot?.status === "live" ? weatherSnapshot.today.condition : "Forecast fallback";
}

function weatherPanelSubtitle({
  activeForecastLocation,
  error,
  isLoading,
  weatherSnapshot,
}: {
  activeForecastLocation: ForecastLocationLabel;
  error: unknown;
  isLoading: boolean;
  weatherSnapshot: WeatherPanelSnapshot | undefined;
}) {
  if (isLoading) {
    return "Checking Open-Meteo";
  }
  if (error || !weatherSnapshot) {
    return `Could not check ${activeForecastLocation}`;
  }
  if (weatherSnapshot.status !== "live") {
    return "Open-Meteo returned fallback data";
  }
  return `Updated ${formatPanelDateTime(weatherSnapshot.fetchedAt)}`;
}

function surfBadgeLabel({
  error,
  isLoading,
  surfSnapshot,
}: {
  error: unknown;
  isLoading: boolean;
  surfSnapshot: SurfPanelSnapshot | undefined;
}) {
  if (isLoading) {
    return "Checking";
  }
  if (error || !surfSnapshot || surfSnapshot.status === "unavailable") {
    return "Unavailable";
  }
  return surfSnapshot.status === "live" ? "Inferred live" : "Partial";
}

function surfPanelSummary({
  error,
  isLoading,
  surfSnapshot,
}: {
  error: unknown;
  isLoading: boolean;
  surfSnapshot: SurfPanelSnapshot | undefined;
}) {
  if (isLoading) {
    return "Checking weather and Dapa tide data.";
  }
  if (error || !surfSnapshot) {
    return "Surf conditions could not be inferred.";
  }
  return surfSnapshot.recommendation;
}

async function fetchWeatherPanel(url: string): Promise<WeatherPanelResponse> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("weather_unavailable");
  }
  return (await response.json()) as WeatherPanelResponse;
}

async function fetchSurfPanel(url: string): Promise<SurfPanelResponse> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("surf_unavailable");
  }
  return (await response.json()) as SurfPanelResponse;
}

function getTripContextServerSnapshot() {
  return defaultTripContext;
}

function getTripContextSnapshot() {
  if (typeof window === "undefined") {
    return defaultTripContext;
  }

  const rawValue = window.localStorage.getItem(tripContextStorageKey);
  if (tripContextSnapshotCache?.rawValue === rawValue) {
    return tripContextSnapshotCache.state;
  }

  const state = readStoredTripContext();
  tripContextSnapshotCache = { rawValue, state };
  return state;
}

function subscribeTripContextState(callback: () => void) {
  tripContextListeners.add(callback);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === tripContextStorageKey) {
      tripContextSnapshotCache = null;
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    tripContextListeners.delete(callback);
    window.removeEventListener("storage", handleStorage);
  };
}

function readStoredTripContext(): TripContextDraft {
  if (typeof window === "undefined") {
    return defaultTripContext;
  }

  try {
    const rawValue = window.localStorage.getItem(tripContextStorageKey);
    if (!rawValue) {
      return defaultTripContext;
    }
    return normalizeTripContextDraft(JSON.parse(rawValue) as Partial<TripContextDraft>);
  } catch {
    return defaultTripContext;
  }
}

function writeStoredTripContext(context: TripContextDraft) {
  if (typeof window === "undefined") {
    return;
  }

  const rawValue = JSON.stringify(context);
  window.localStorage.setItem(tripContextStorageKey, rawValue);
  tripContextSnapshotCache = { rawValue, state: context };
  for (const listener of tripContextListeners) {
    listener();
  }
}

function normalizeTripContextDraft(context: Partial<TripContextDraft>): TripContextDraft {
  return {
    accommodation: normalizedContextText(context.accommodation, defaultTripContext.accommodation),
    dateRange: normalizedContextText(context.dateRange, defaultTripContext.dateRange),
    travelerType: normalizedContextText(context.travelerType, defaultTripContext.travelerType),
    nearbyArea: isForecastLocationLabel(context.nearbyArea)
      ? context.nearbyArea
      : defaultTripContext.nearbyArea,
  };
}

function normalizedContextText(value: string | undefined, fallback: string) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue.slice(0, 80) : fallback;
}

function isForecastLocationLabel(value: unknown): value is ForecastLocationLabel {
  return (
    typeof value === "string" &&
    forecastLocationLabels.includes(value as (typeof forecastLocationLabels)[number])
  );
}

function nearestForecastLocationLabel(geolocation: ChatClientGeolocation): ForecastLocationLabel {
  const distances = [
    {
      label: "Cloud 9" as const,
      distance: distanceKm(geolocation, { latitude: 9.814, longitude: 126.165 }),
    },
    {
      label: "General Luna" as const,
      distance: distanceKm(geolocation, { latitude: 9.784, longitude: 126.158 }),
    },
    {
      label: "Del Carmen" as const,
      distance: distanceKm(geolocation, { latitude: 9.869, longitude: 125.969 }),
    },
  ].sort((left, right) => left.distance - right.distance);

  return distances[0]?.label ?? "Siargao Island";
}

function distanceKm(
  left: Pick<ChatClientGeolocation, "latitude" | "longitude">,
  right: Pick<ChatClientGeolocation, "latitude" | "longitude">,
) {
  const earthRadiusKm = 6_371;
  const deltaLatitude = degreesToRadians(right.latitude - left.latitude);
  const deltaLongitude = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function locationSourceLabel(locationState: LocationCaptureState) {
  if (locationState.status === "ready") {
    return "Browser location active";
  }
  if (locationState.status === "requesting") {
    return "Requesting browser location";
  }
  if (locationState.status === "denied") {
    return "Browser location denied";
  }
  return "Trip area";
}

function formatPanelNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPanelDateTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "recently";
  }
  return chatTimeFormatter.format(timestamp);
}

function formatThreadRecency(thread: ChatThreadSummary) {
  if (thread.archivedAt) {
    return "Archived";
  }

  const rawDate = thread.lastMessageAt ?? thread.updatedAt;
  if (!rawDate) {
    return "Recent";
  }

  const timestamp = new Date(rawDate);
  if (Number.isNaN(timestamp.getTime())) {
    return "Recent";
  }

  const today = new Date();
  const elapsedMs = today.getTime() - timestamp.getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  if (elapsedDays <= 0) {
    return chatTimeFormatter.format(timestamp);
  }
  if (elapsedDays === 1) {
    return "Yesterday";
  }
  return `${elapsedDays} days ago`;
}

function ChatAuthActions() {
  if (!isClerkConfigured) {
    return (
      <div className="hidden items-center gap-2 sm:flex">
        <Button
          asChild
          className="h-10 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50"
          variant="outline"
        >
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button
          asChild
          className="h-10 rounded-md border-brand-violet-650 bg-brand-violet-650 px-3 text-xs font-extrabold text-white hover:bg-brand-violet-600"
        >
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </div>
    );
  }

  return (
    <span className="hidden sm:inline-flex">
      <Show fallback={chatSignedOutActions} when="signed-in">
        <UserButton
          appearance={clerkAppearance}
          fallback={
            <span className="inline-flex size-10 animate-pulse rounded-full border border-border-default bg-brand-lavender-100" />
          }
        />
      </Show>
    </span>
  );
}

function ChatMessage({
  disabled,
  message,
  onRetryPrompt,
  onRateAssistantMessage,
  onRemoveSavedItem,
  onSaveItineraryPlan,
  onSaveRecommendationCard,
  onSubmitPrompt,
  savedItemIds,
}: {
  disabled: boolean;
  message: InteractiveChatMessage;
  onRateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => void;
  onRetryPrompt: (prompt: string) => void;
  onRemoveSavedItem: (itemId: string) => void;
  onSaveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  onSaveRecommendationCard: (card: RecommendationCardArtifact) => void;
  onSubmitPrompt: (prompt: string) => void;
  savedItemIds: ReadonlySet<string>;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";

  if (isUser) {
    return (
      <article
        className="min-w-0 max-w-[min(78%,42rem)] justify-self-end overflow-hidden rounded-lg border border-brand-violet-400/25 bg-brand-violet-650 px-5 py-4 text-white shadow-violet-glow sm:max-w-[min(88%,42rem)]"
        data-testid="user-message-bubble"
      >
        <p className="m-0 whitespace-pre-wrap break-words text-base leading-[1.55] font-black [overflow-wrap:anywhere] sm:text-base sm:font-extrabold">
          {message.text}
        </p>
        <time className="mt-2 block text-right text-sm font-black text-white/75 sm:text-xs">
          {message.timestamp}
        </time>
      </article>
    );
  }

  return (
    <article className="grid max-w-full grid-cols-[48px_minmax(0,1fr)] items-start gap-2 sm:max-w-[min(96%,56rem)] sm:grid-cols-[44px_minmax(0,1fr)] sm:gap-4">
      <span className="relative mt-1 inline-flex size-12 items-center justify-center rounded-full border border-border-default bg-white shadow-card sm:size-10">
        <PalmMark className="size-10 sm:size-10" />
        <span className="-right-1 -top-1 absolute inline-flex size-6 items-center justify-center rounded-full bg-brand-violet-400 text-white shadow-sm sm:hidden">
          <Sparkles aria-hidden="true" size={13} />
        </span>
      </span>
      <div
        data-testid="assistant-message-bubble"
        className={
          isError
            ? "min-w-0 overflow-hidden rounded-lg border border-border-alert bg-surface-alert px-5 py-4 shadow-night-card"
            : "min-w-0 overflow-hidden rounded-lg border border-border-default bg-white px-4 py-5 text-text-strong shadow-card sm:px-5 sm:py-4"
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
            {!isError && !isPending ? <AssistantGlance message={message} /> : null}
            {!isError && !isPending && message.decisionSummaries?.length ? (
              <DecisionSummaryPanels summaries={message.decisionSummaries} />
            ) : null}
            {!isError && !isPending && message.itineraries?.length ? (
              <ItineraryPlans
                onRemoveSavedItem={onRemoveSavedItem}
                onSaveItineraryPlan={onSaveItineraryPlan}
                plans={message.itineraries}
                savedItemIds={savedItemIds}
              />
            ) : null}
            {!isError && !isPending && message.cards?.length ? (
              <RecommendationCards
                cards={message.cards}
                onRemoveSavedItem={onRemoveSavedItem}
                onSaveRecommendationCard={onSaveRecommendationCard}
                savedItemIds={savedItemIds}
              />
            ) : null}
            {!isError && !isPending && message.actions?.length ? (
              <ChatActionButtons
                actions={message.actions}
                disabled={disabled}
                onSubmitPrompt={onSubmitPrompt}
              />
            ) : null}
            {!isError && !isPending && message.sources?.length ? (
              <AssistantSourcesPanel sources={message.sources} />
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-extrabold">
          <time className={isError ? "text-text-alert" : "text-text-muted"}>
            {message.timestamp}
          </time>
          {!isError && !isPending && message.messageId ? (
            <AssistantRatingControls
              disabled={disabled || message.ratingStatus === "saving"}
              messageId={message.messageId}
              onRateAssistantMessage={onRateAssistantMessage}
              rating={message.rating ?? null}
              saving={message.ratingStatus === "saving"}
            />
          ) : null}
        </div>
        {isError && message.retryPrompt ? (
          <Button
            className="mt-4 h-9 rounded-md border-border-alert bg-surface-alert px-3 text-xs font-extrabold text-text-alert hover:bg-surface-alert"
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

function AssistantRatingControls({
  disabled,
  messageId,
  onRateAssistantMessage,
  rating,
  saving,
}: {
  disabled: boolean;
  messageId: string;
  onRateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => void;
  rating: ChatResponseRatingValue | null;
  saving: boolean;
}) {
  return (
    <fieldset
      aria-busy={saving}
      className="ml-auto inline-flex items-center gap-1"
      disabled={disabled}
    >
      <legend className="sr-only">Rate assistant response</legend>
      <Button
        aria-label="Rate assistant response helpful"
        aria-pressed={rating === "up"}
        className={`size-8 rounded-md border-border-default hover:bg-brand-lavender-50 ${
          rating === "up" ? "bg-brand-lagoon-100 text-brand-lagoon-700" : "bg-white text-text-muted"
        }`}
        disabled={disabled}
        onClick={() => onRateAssistantMessage(messageId, "up")}
        size="icon"
        type="button"
        variant="outline"
      >
        <ThumbsUp aria-hidden="true" size={14} />
      </Button>
      <Button
        aria-label="Rate assistant response not helpful"
        aria-pressed={rating === "down"}
        className={`size-8 rounded-md border-border-default hover:bg-brand-lavender-50 ${
          rating === "down" ? "bg-surface-caveat text-text-caveat" : "bg-white text-text-muted"
        }`}
        disabled={disabled}
        onClick={() => onRateAssistantMessage(messageId, "down")}
        size="icon"
        type="button"
        variant="outline"
      >
        <ThumbsDown aria-hidden="true" size={14} />
      </Button>
    </fieldset>
  );
}

function SavedPlanTray({
  copyStatus,
  excludedShareItemIds,
  items,
  onCopyShareLink,
  onCreateShareLink,
  onRemoveItem,
  onToggleShareItem,
  selectedItemCount,
  shareStatus,
  shareUrl,
}: {
  copyStatus: SavedPlanCopyStatus;
  excludedShareItemIds: ReadonlySet<string>;
  items: readonly SavedTripItem[];
  onCopyShareLink: () => void;
  onCreateShareLink: () => void;
  onRemoveItem: (itemId: string) => void;
  onToggleShareItem: (itemId: string, shouldInclude: boolean) => void;
  selectedItemCount: number;
  shareStatus: SavedPlanShareStatus;
  shareUrl: string | null;
}) {
  if (items.length === 0) {
    return null;
  }

  const isSharing = shareStatus === "syncing" || shareStatus === "creating";
  const hasSelectedItems = selectedItemCount > 0;

  return (
    <section
      aria-label="Saved plan"
      className="grid min-w-0 gap-3 rounded-lg border border-border-default bg-white p-3 text-text-strong shadow-card"
      data-testid="saved-plan-tray"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
            <BookmarkCheck aria-hidden="true" size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-black text-text-strong">Saved plan</h2>
            <p className="m-0 text-xs font-bold text-text-muted">
              {items.length} {items.length === 1 ? "item" : "items"} saved locally,{" "}
              {selectedItemCount} selected to share
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 rounded-md border-brand-violet-650 bg-brand-violet-650 px-3 text-xs font-extrabold text-white hover:bg-brand-violet-600 disabled:opacity-55"
          disabled={!hasSelectedItems || isSharing}
          onClick={onCreateShareLink}
          size="sm"
          type="button"
          variant="outline"
        >
          {isSharing ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
          ) : (
            <ExternalLink aria-hidden="true" size={14} />
          )}
          {shareStatus === "syncing" ? "Saving" : shareStatus === "creating" ? "Sharing" : "Share"}
        </Button>
      </div>

      <div
        className="flex min-w-0 flex-nowrap gap-2 overflow-hidden pb-1"
        data-testid="saved-plan-items"
      >
        {items.map((item) => {
          const isIncluded = !excludedShareItemIds.has(item.id);

          return (
            <div
              className="grid min-w-[14rem] max-w-[19rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border-default bg-brand-lavender-50 px-3 py-2"
              data-testid="saved-plan-item"
              key={item.id}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-lavender-100 text-brand-violet-650">
                {item.kind === "itinerary" ? (
                  <Navigation aria-hidden="true" size={14} />
                ) : (
                  <MapPin aria-hidden="true" size={14} />
                )}
              </span>
              <label className="flex min-w-0 items-center gap-2">
                <input
                  aria-label={`Include ${item.title} in shared plan`}
                  checked={isIncluded}
                  className="size-4 shrink-0 accent-brand-violet-650"
                  onChange={(event) => onToggleShareItem(item.id, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-text-strong">
                  {item.title}
                </span>
              </label>
              <Button
                aria-label={`Remove ${item.title} from saved plan`}
                className="size-8 shrink-0 rounded-md border-border-default bg-white text-text-muted hover:bg-brand-lavender-50"
                onClick={() => onRemoveItem(item.id)}
                size="icon"
                type="button"
                variant="outline"
              >
                <Trash2 aria-hidden="true" size={14} />
              </Button>
            </div>
          );
        })}
      </div>

      {!hasSelectedItems ? (
        <p className="m-0 text-xs font-bold text-text-caveat" data-testid="saved-plan-share-empty">
          Select at least one saved item to create a share link.
        </p>
      ) : null}

      {shareStatus === "error" ? (
        <p className="m-0 text-xs font-bold text-text-alert" data-testid="saved-plan-share-error">
          {shareErrorMessage}
        </p>
      ) : null}

      {shareUrl ? (
        <div
          className="grid min-w-0 gap-2 rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-100 p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          data-testid="saved-plan-share-link"
        >
          <input
            aria-label="Share link"
            className="min-h-9 min-w-0 rounded-md border border-border-default bg-white px-3 text-xs font-bold text-text-strong outline-none"
            readOnly
            value={shareUrl}
          />
          <Button
            className="rounded-md border-border-default bg-white text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50"
            onClick={onCopyShareLink}
            size="sm"
            type="button"
            variant="outline"
          >
            {copyStatus === "copied" ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Copy aria-hidden="true" size={14} />
            )}
            {copyStatus === "copied" ? "Copied" : "Copy"}
          </Button>
          <Button
            asChild
            className="rounded-md border-border-default bg-white text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50"
            size="sm"
            variant="outline"
          >
            <a href={shareUrl} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={14} />
              Open
            </a>
          </Button>
          {copyStatus === "error" ? (
            <p className="m-0 text-xs font-bold text-text-alert sm:col-span-3">
              Copy failed. The link is still available above.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AssistantGlance({ message }: { message: InteractiveChatMessage }) {
  const primaryPlan = message.itineraries?.[0];
  const primaryCard = message.cards?.[0];
  const primarySummary = message.decisionSummaries?.[0];
  const sources =
    message.sources ??
    primaryPlan?.sources ??
    primaryCard?.sources ??
    primarySummary?.sources ??
    [];
  const items = [
    {
      icon: primaryPlan ? Navigation : primarySummary ? ShieldCheck : Utensils,
      label: primaryPlan ? "Plan" : primarySummary ? "Move" : "Type",
      value: primaryPlan
        ? primaryPlan.title
        : primarySummary
          ? primarySummary.bestAction
          : primaryCard
            ? primaryCard.kind
            : undefined,
    },
    {
      icon: MapPin,
      label: "Area",
      value: primaryPlan
        ? itineraryPrimaryArea(primaryPlan)
        : (primarySummary?.area ?? cardAreaLabel(primaryCard)),
    },
    {
      icon: Clock,
      label: "Timing",
      value: primaryPlan?.durationLabel ?? primarySummary?.timing ?? primaryCard?.openStatusLabel,
    },
    {
      icon: ShieldCheck,
      label: "Confidence",
      value: sourceConfidenceLabel(sources),
    },
  ].filter((item): item is { icon: typeof Utensils; label: string; value: string } =>
    Boolean(item.value),
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="At a glance"
      className="hidden min-w-0 gap-3 rounded-md border border-border-default bg-brand-lavender-50 p-3 shadow-none sm:grid"
    >
      <h3 className="m-0 flex items-center gap-2 text-sm font-black text-text-strong">
        <Sparkles aria-hidden="true" className="text-brand-sunset-gold" size={17} />
        At a Glance
      </h3>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-md border border-border-default bg-white px-3 py-2"
              key={`${item.label}-${item.value}`}
            >
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
                <Icon aria-hidden="true" size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.68rem] leading-tight font-black text-text-muted">
                  {item.label}
                </span>
                <span className="block truncate text-xs font-black text-text-strong">
                  {item.value}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionSummaryPanels({ summaries }: { summaries: readonly DecisionSummaryArtifact[] }) {
  return (
    <section aria-label="Best move" className="grid min-w-0 gap-3">
      {summaries.map((summary) => (
        <article
          className="grid min-w-0 gap-3 rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-100 p-3 shadow-none"
          data-testid="decision-summary-panel"
          key={summary.id}
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="grid min-w-0 gap-1">
              <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-[0.68rem] leading-tight font-black text-brand-lagoon-700 uppercase">
                <Navigation aria-hidden="true" className="shrink-0" size={13} />
                Best move
              </span>
              <h3 className="m-0 text-base leading-tight font-black break-words text-text-strong">
                {summary.bestAction}
              </h3>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5 sm:justify-end">
              {summary.area ? <DecisionSummaryChip icon={MapPin} label={summary.area} /> : null}
              {summary.timing ? <DecisionSummaryChip icon={Clock} label={summary.timing} /> : null}
            </div>
          </div>
          <p className="m-0 text-sm leading-[1.45] font-bold break-words text-text-default">
            {summary.basis}
          </p>
          {summary.fallback || summary.avoid ? (
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {summary.fallback ? (
                <DecisionSummaryGuidance label="Fallback" value={summary.fallback} />
              ) : null}
              {summary.avoid ? (
                <DecisionSummaryGuidance label="Avoid" value={summary.avoid} />
              ) : null}
            </div>
          ) : null}
          {summary.sources.length ? (
            <div className="flex min-w-0 flex-wrap gap-2" data-testid="decision-summary-sources">
              {summary.sources.map((source) => (
                <SourceIconBadge key={chatSourceKey(source)} source={source} />
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function DecisionSummaryChip({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-brand-lagoon-700/15 bg-white px-2 py-1 text-xs font-extrabold text-text-muted">
      <Icon aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function DecisionSummaryGuidance({ label, value }: { label: string; value: string }) {
  return (
    <p className="m-0 rounded-md border border-border-default bg-white px-3 py-2 text-xs leading-[1.45] font-bold break-words text-text-muted">
      <span className="font-black text-text-strong">{label}: </span>
      {value}
    </p>
  );
}

function ArtifactDecision({ decision }: { decision?: ArtifactDecisionMetadata }) {
  if (!decision) {
    return null;
  }

  return (
    <div
      className="mt-1 grid min-w-0 gap-1 rounded-md border border-brand-lagoon-700/12 bg-brand-lagoon-100 px-2.5 py-2"
      data-testid="artifact-decision"
    >
      <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-[0.7rem] leading-tight font-black text-brand-lagoon-700 uppercase">
        <Sparkles aria-hidden="true" className="shrink-0" size={12} />
        <span className="min-w-0 break-words">{artifactDecisionLabel(decision.label)}</span>
      </span>
      <p className="m-0 text-xs leading-[1.4] font-bold break-words text-text-default">
        {decision.bestAction}
      </p>
    </div>
  );
}

function artifactDecisionLabel(label: ArtifactDecisionMetadata["label"]) {
  switch (label) {
    case "best_fit":
      return "Best fit";
    case "good_now":
      return "Good now";
    case "fallback":
      return "Fallback";
    case "avoid_today":
      return "Avoid today";
    case "needs_confirmation":
      return "Needs confirmation";
  }
}

function ItineraryPlans({
  onRemoveSavedItem,
  onSaveItineraryPlan,
  plans,
  savedItemIds,
}: {
  onRemoveSavedItem: (itemId: string) => void;
  onSaveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  plans: readonly ItineraryPlanArtifact[];
  savedItemIds: ReadonlySet<string>;
}) {
  return (
    <div className="grid min-w-0 gap-5" data-testid="itinerary-plans">
      {plans.map((plan) => {
        const savedItemId = savedItemIdForItinerary(plan);
        const isSaved = savedItemIds.has(savedItemId);

        return (
          <section
            aria-label={plan.title}
            className="grid min-w-0 gap-4 rounded-md border border-border-default bg-brand-lavender-50 p-3 shadow-none"
            data-testid="itinerary-plan"
            key={`${plan.title}-${plan.durationLabel}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-lavender-100 text-brand-violet-650">
                <Navigation aria-hidden="true" size={17} />
              </div>
              <div className="grid min-w-0 flex-1 gap-1">
                <h3 className="m-0 text-sm leading-[1.25] font-black break-words text-text-strong sm:text-base">
                  {plan.title}
                </h3>
                <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-border-default bg-white px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold text-text-muted">
                  <Clock aria-hidden="true" className="shrink-0" size={13} />
                  <span className="min-w-0 break-words">{plan.durationLabel}</span>
                </span>
                <ArtifactDecision decision={plan.decision} />
              </div>
              <SaveToggleButton
                isSaved={isSaved}
                itemId={savedItemId}
                onRemoveSavedItem={onRemoveSavedItem}
                onSave={() => onSaveItineraryPlan(plan)}
                title={plan.title}
              />
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
        );
      })}
    </div>
  );
}

function ItineraryStopRow({ stop }: { stop: ItineraryStopArtifact }) {
  return (
    <li className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-lagoon-700/15 bg-brand-lagoon-100 text-xs font-black text-brand-lagoon-700">
        {stop.sequence}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 min-w-0 text-sm leading-[1.3] font-black break-words text-text-strong">
            {stop.title}
          </h4>
          {stop.area ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-default bg-white px-2 py-1 text-[0.7rem] leading-tight font-extrabold text-text-muted">
              <MapPin aria-hidden="true" className="shrink-0" size={12} />
              <span className="min-w-0 break-words">{stop.area}</span>
            </span>
          ) : null}
        </div>

        {stop.travelTimeFromPreviousMinutes ? (
          <p className="m-0 inline-flex min-w-0 items-center gap-1.5 text-xs leading-[1.45] font-bold break-words text-text-muted">
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
          <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-brand-sunset-gold">
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
            className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-brand-lagoon-700/25 bg-white px-3 py-2 text-xs font-extrabold text-brand-lagoon-700 no-underline hover:bg-brand-lagoon-100"
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
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-1.5" data-testid={testId}>
      <h4 className="m-0 text-xs font-black text-text-strong">{title}</h4>
      <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-text-muted sm:text-sm">
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
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-2" data-testid="itinerary-sources">
      <h4 className="m-0 text-xs font-black text-text-strong">Sources</h4>
      <div className="flex min-w-0 flex-wrap gap-2">
        {sources.map((source) => (
          <SourceIconBadge key={chatSourceKey(source)} source={source} />
        ))}
      </div>
    </section>
  );
}

function sortItineraryStops(stops: readonly ItineraryStopArtifact[]) {
  return stops.toSorted((first, second) => first.sequence - second.sequence);
}

function formatItineraryStopSummary(stop: ItineraryStopArtifact) {
  return [stop.title, stop.area, stop.rationale].filter(Boolean).join(" - ");
}

function formatTrustLabel(value: string) {
  return value.replaceAll("_", " ");
}

function itineraryPrimaryArea(plan: ItineraryPlanArtifact) {
  const areas = [...new Set(plan.stops.flatMap((stop) => (stop.area ? [stop.area] : [])))].slice(
    0,
    2,
  );
  return areas.length ? areas.join(" + ") : "Siargao";
}

function cardAreaLabel(card: RecommendationCardArtifact | undefined) {
  if (!card) {
    return undefined;
  }
  const subtitleArea = card.subtitle?.split(" - ")[1]?.trim();
  return subtitleArea || "Siargao";
}

function sourceConfidenceLabel(sources: readonly ChatSourceArtifact[]) {
  if (sources.length === 0) {
    return "Caveated";
  }
  const highConfidence = sources.some((source) => source.confidence === "high");
  const liveChecked = sources.some((source) => source.label === "live_checked");
  if (liveChecked && highConfidence) {
    return "Live checked";
  }
  return sourceBadgeTitle(sources[0]);
}

function dedupeChatSources(sources: readonly ChatSourceArtifact[]) {
  const results: ChatSourceArtifact[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = chatSourceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(source);
  }
  return results;
}

function chatSourceKey(source: ChatSourceArtifact) {
  return JSON.stringify({
    label: source.label,
    sourceName: source.sourceName,
    sourceProfileId: source.sourceProfileId ?? "",
    fetchedAt: source.fetchedAt ?? "",
    confidence: source.confidence ?? "",
    checked: source.checked.toSorted(),
    notChecked: source.notChecked.toSorted(),
  });
}

function sourceSummaryText(sources: readonly ChatSourceArtifact[]) {
  return sources.length
    ? `Checked: ${formatCompactList(sources.map(sourceDisplayName))}`
    : "Checked source details unavailable";
}

function sourceDisplayName(source: ChatSourceArtifact) {
  return source.sourceName || formatTrustLabel(source.label);
}

function SourceIconBadge({ source }: { source: ChatSourceArtifact }) {
  const badge = sourceBadgeInfo(source);
  const Icon = badge.icon;

  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold ${badge.className}`}
      data-testid="source-icon-badge"
    >
      <Icon aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 break-words">{badge.label}</span>
    </span>
  );
}

function sourceBadgeInfo(source: ChatSourceArtifact) {
  if (source.label === "weather_checked") {
    return {
      icon: Clock,
      label: "Weather checked",
      className: "border-brand-lagoon-700/15 bg-brand-lagoon-100 text-brand-lagoon-700",
    };
  }
  if (source.label === "marine_checked" || source.label === "tide_forecast_checked") {
    return {
      icon: Navigation,
      label: source.label === "marine_checked" ? "Marine checked" : "Tide checked",
      className: "border-brand-lagoon-700/15 bg-brand-lagoon-100 text-brand-lagoon-700",
    };
  }
  if (source.label === "event_checked") {
    return {
      icon: ShieldCheck,
      label: "Event checked",
      className: "border-brand-sunset-gold/30 bg-surface-caveat text-text-caveat",
    };
  }
  if (source.label === "venue_checked") {
    return {
      icon: ShieldCheck,
      label: "Venue checked",
      className: "border-brand-violet-650/15 bg-brand-lavender-100 text-brand-violet-650",
    };
  }
  if (source.label === "community_signal") {
    return {
      icon: Star,
      label: "Community signal",
      className: "border-border-default bg-white text-text-muted",
    };
  }
  if (source.label === "curated_local_guide") {
    return {
      icon: Star,
      label: "Local guide",
      className: "border-brand-sunset-gold/30 bg-surface-caveat text-text-caveat",
    };
  }
  if (source.label === "fresh_cache") {
    return {
      icon: ShieldCheck,
      label: "Fresh source",
      className: "border-brand-violet-650/15 bg-brand-lavender-100 text-brand-violet-650",
    };
  }

  return {
    icon: ShieldCheck,
    label: source.label === "live_checked" ? "Live checked" : sourceBadgeTitle(source),
    className: "border-brand-lagoon-700/15 bg-brand-lagoon-100 text-brand-lagoon-700",
  };
}

function sourceBadgeTitle(source: ChatSourceArtifact | undefined) {
  if (!source) {
    return "Checked";
  }
  return titleCaseShortLabel(formatTrustLabel(source.label));
}

function formatCompactList(values: readonly string[]) {
  return values.slice(0, 3).join(", ");
}

function RecommendationSourceBadge({ cards }: { cards: readonly RecommendationCardArtifact[] }) {
  const sourceNames = compactRecommendationSourceNames(cards);
  if (sourceNames.length === 0) {
    return null;
  }

  const visibleSources = sourceNames.slice(0, 2);
  const hiddenCount = sourceNames.length - visibleSources.length;
  const label = `${sourceNames.length === 1 ? "Source" : "Sources"}: ${visibleSources.join(", ")}${
    hiddenCount > 0 ? ` +${hiddenCount}` : ""
  }`;

  return (
    <span
      className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-brand-sunset-gold/30 bg-surface-caveat px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold text-text-caveat"
      data-testid="recommendation-source-badge"
    >
      <ShieldCheck aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

function compactRecommendationSourceNames(cards: readonly RecommendationCardArtifact[]) {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const cardSourceNames = card.sources?.length
      ? card.sources.map((source) => compactSourceName(source.sourceName))
      : [compactSourceName(card.sourceLabel.split(" - ")[0] ?? card.sourceLabel)];

    for (const name of cardSourceNames) {
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) {
        continue;
      }
      seen.add(key);
      names.push(name);
    }
  }

  return names;
}

function compactSourceName(value: string) {
  return value
    .replace(/\s+API(?:\s+profile)?$/i, "")
    .replace(/\s+profile$/i, "")
    .trim();
}

function compactRecommendationSubtitle(subtitle: string | undefined) {
  if (!subtitle) {
    return {};
  }

  const parts = subtitle.split(" - ").flatMap((part) => {
    const trimmedPart = part.trim();
    return trimmedPart ? [trimmedPart] : [];
  });
  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    return { meta: parts[0] };
  }

  const ratingPartIndex = parts.findIndex((part) => /google rating/i.test(part));
  const ratingLabel =
    ratingPartIndex >= 0 ? compactGoogleRatingLabel(parts[ratingPartIndex]) : undefined;
  const categoryLabel = titleCaseShortLabel(parts[0]);
  const addressParts = parts.slice(1).filter((_, index) => index + 1 !== ratingPartIndex);
  const address = compactAddressLabel(addressParts.join(", "));

  return {
    meta: [categoryLabel, ratingLabel].filter(Boolean).join(" · "),
    address,
  };
}

function compactGoogleRatingLabel(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const match = value.match(/google rating\s+([\d.]+)\s+from\s+([\d,]+)\s+ratings?/i);
  if (!match) {
    return value.replace(/^google\s+/i, "").trim();
  }

  return `${match[1]} rating · ${match[2]} reviews`;
}

function titleCaseShortLabel(value: string) {
  return value
    .split(/\s+/)
    .map((word) => (word ? `${word[0]?.toLocaleUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

function compactAddressLabel(value: string) {
  const addressParts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^\d{4}\b/.test(part));
  return addressParts.slice(0, 2).join(", ");
}

function compactDistanceLabel(label: string) {
  const distanceMatch = label.match(/about\s+(.+?)\s+from\s+search\s+center/i);
  if (distanceMatch?.[1]) {
    return `${distanceMatch[1].trim()} away`;
  }
  return trimTrailingPeriod(label);
}

function compactOpenStatusLabel(label: string) {
  if (/^open now/i.test(label)) {
    return "Open now";
  }
  if (/hours not returned/i.test(label)) {
    return "Hours not listed";
  }

  return trimTrailingPeriod(
    label.replace(/\s+according to Google Places/gi, "").replace(/\s+from Google Places/gi, ""),
  );
}

function usefulRecommendationReasons(reasons: readonly string[]) {
  return reasons.filter((reason) => !isRedundantRecommendationReason(reason)).slice(0, 1);
}

function isRedundantRecommendationReason(reason: string) {
  return [
    /google places/i,
    /matching what you asked/i,
    /returned\s+#?\d+/i,
    /\btop\b.*\bmatch\b/i,
    /\blisted as\b/i,
    /\beasy to reach\b/i,
    /\bopen\b/i,
    /\bwell rated\b/i,
  ].some((pattern) => pattern.test(reason));
}

function trimTrailingPeriod(value: string) {
  return value.trim().replace(/\.$/, "");
}

function RecommendationCards({
  cards,
  onRemoveSavedItem,
  onSaveRecommendationCard,
  savedItemIds,
}: {
  cards: readonly RecommendationCardArtifact[];
  onRemoveSavedItem: (itemId: string) => void;
  onSaveRecommendationCard: (card: RecommendationCardArtifact) => void;
  savedItemIds: ReadonlySet<string>;
}) {
  return (
    <section
      aria-label="Recommended places"
      className="grid min-w-0 gap-3 rounded-md border border-border-default bg-brand-lavender-50 p-3 shadow-none"
      data-testid="recommendation-cards"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 text-sm font-black text-text-strong">
          <Utensils aria-hidden="true" className="text-brand-sunset-gold" size={17} />
          Recommended Places
        </h3>
        <RecommendationSourceBadge cards={cards} />
      </div>
      {cards.map((card) => {
        const savedItemId = savedItemIdForCard(card);
        const isSaved = savedItemIds.has(savedItemId);
        const subtitle = compactRecommendationSubtitle(card.subtitle);
        const usefulReasons = usefulRecommendationReasons(card.fitReasons);

        return (
          <article
            className="grid min-w-0 gap-3 rounded-md border border-border-default bg-white p-3"
            data-testid="recommendation-card"
            key={card.id}
          >
            <div className="grid min-w-0 gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
                  {card.kind === "beach" ? (
                    <Navigation aria-hidden="true" size={17} />
                  ) : (
                    <Utensils aria-hidden="true" size={18} />
                  )}
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <h4 className="m-0 text-sm leading-[1.25] font-black break-words text-text-strong sm:text-base">
                    {card.title}
                  </h4>
                  {subtitle.meta ? (
                    <p className="m-0 text-xs leading-[1.45] break-words text-text-muted sm:text-sm">
                      {subtitle.meta}
                    </p>
                  ) : null}
                  {subtitle.address ? (
                    <p className="m-0 text-xs leading-[1.45] break-words text-text-muted">
                      {subtitle.address}
                    </p>
                  ) : null}
                  <ArtifactDecision decision={card.decision} />
                </div>
                <SaveToggleButton
                  isSaved={isSaved}
                  itemId={savedItemId}
                  onRemoveSavedItem={onRemoveSavedItem}
                  onSave={() => onSaveRecommendationCard(card)}
                  title={card.title}
                />
              </div>

              <div className="flex min-w-0 flex-wrap gap-2">
                {card.distanceLabel ? (
                  <CardSignal icon="distance" label={compactDistanceLabel(card.distanceLabel)} />
                ) : null}
                {card.openStatusLabel ? (
                  <CardSignal icon="time" label={compactOpenStatusLabel(card.openStatusLabel)} />
                ) : null}
              </div>

              {usefulReasons.length ? (
                <p className="m-0 text-xs leading-[1.45] break-words text-text-default sm:text-sm">
                  <span className="font-black text-text-strong">Why this:</span>{" "}
                  {usefulReasons.join(" ")}
                </p>
              ) : null}

              {card.mapsUrl ? (
                <a
                  aria-label={`Open ${card.title} in Google Maps`}
                  className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-100 px-3 py-2 text-xs font-extrabold text-brand-lagoon-700 no-underline hover:bg-brand-lagoon-100"
                  href={card.mapsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <MapPin aria-hidden="true" className="shrink-0" size={15} />
                  <span className="min-w-0 break-words">Open map</span>
                  <ExternalLink aria-hidden="true" className="shrink-0" size={14} />
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function SaveToggleButton({
  isSaved,
  itemId,
  onRemoveSavedItem,
  onSave,
  title,
}: {
  isSaved: boolean;
  itemId: string;
  onRemoveSavedItem: (itemId: string) => void;
  onSave: () => void;
  title: string;
}) {
  return (
    <Button
      aria-label={isSaved ? `Remove ${title} from saved plan` : `Save ${title}`}
      className={
        isSaved
          ? "size-9 shrink-0 rounded-md border-brand-lagoon-300/35 bg-brand-lagoon-500 text-brand-navy-980 hover:bg-brand-lagoon-300"
          : "size-9 shrink-0 rounded-md border-border-default bg-white text-text-muted hover:bg-brand-lavender-50"
      }
      onClick={() => {
        if (isSaved) {
          onRemoveSavedItem(itemId);
          return;
        }
        onSave();
      }}
      size="icon"
      type="button"
      variant="outline"
    >
      {isSaved ? (
        <BookmarkCheck aria-hidden="true" size={16} />
      ) : (
        <Bookmark aria-hidden="true" size={16} />
      )}
    </Button>
  );
}

function CardSignal({ icon, label }: { icon?: "distance" | "time"; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-default bg-brand-lavender-50 px-2.5 py-1.5 text-[0.72rem] leading-tight font-extrabold text-text-muted">
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
            className="h-auto min-h-9 rounded-md border-border-default bg-white px-3 py-2 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50"
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
            className="h-auto min-h-9 rounded-md border-brand-violet-650/20 bg-brand-lavender-100 px-3 py-2 text-xs font-extrabold text-brand-violet-650 hover:bg-brand-lavender-150"
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

function AssistantSourcesPanel({ sources }: { sources: readonly ChatSourceArtifact[] }) {
  const visibleSources = dedupeChatSources(sources);
  if (visibleSources.length === 0) {
    return null;
  }

  return (
    <details
      className="group rounded-md border border-border-default bg-white p-3 shadow-none sm:bg-brand-lavender-50"
      data-testid="assistant-sources-panel"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-sm font-black text-text-strong">
            <ShieldCheck aria-hidden="true" className="text-brand-lagoon-700" size={16} />
            Sources & Confidence
          </span>
          <span className="min-w-0 truncate text-xs font-bold text-text-muted">
            {sourceSummaryText(visibleSources)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-white px-2.5 py-1.5 text-xs font-black text-brand-violet-650 sm:text-text-muted">
          <span className="hidden sm:inline">View sources</span>
          <span className="sm:hidden">Sources</span>
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
            size={14}
          />
        </span>
      </summary>
      <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:max-h-none">
        {visibleSources.map((source) => (
          <div
            className="grid gap-1 rounded-md border border-border-default bg-white p-3"
            key={chatSourceKey(source)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceIconBadge source={source} />
              <span className="text-xs font-black text-text-strong">{source.sourceName}</span>
              {source.confidence ? (
                <span className="text-[0.7rem] font-bold text-text-muted">
                  {source.confidence} confidence
                </span>
              ) : null}
            </div>
            {source.checked.length ? (
              <p className="m-0 text-xs leading-[1.45] text-text-muted">
                Checked details: {formatCompactList(source.checked)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function AssistantMarkdownText({ text, tone }: { text: string; tone: "default" | "error" }) {
  const blocks = parseAssistantMarkdownBlocks(text);
  const textClass = tone === "error" ? "text-text-alert" : "text-text-default";
  const strongClass =
    tone === "error" ? "font-extrabold text-text-alert" : "font-extrabold text-text-strong";
  const linkClass =
    tone === "error"
      ? "font-extrabold text-text-alert underline decoration-text-alert/45 underline-offset-4 break-words"
      : "font-extrabold text-brand-violet-650 underline decoration-brand-violet-400/45 underline-offset-4 break-words";

  return (
    <div className="grid min-w-0 max-w-full flex-1 gap-3 overflow-hidden [overflow-wrap:anywhere]">
      {blocks.map((block) => {
        if (block.type === "heading") {
          const HeadingIcon = assistantHeadingIcon(block.text);
          return (
            <h3
              className={`m-0 flex max-w-full items-center gap-3 border-border-default border-t pt-5 text-lg leading-[1.25] font-black break-words sm:block sm:border-0 sm:pt-0 sm:text-base ${strongClass}`}
              key={block.key}
            >
              <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-lavender-100 text-brand-violet-650 sm:hidden">
                <HeadingIcon aria-hidden="true" size={23} />
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {assistantHeadingDisplayText(block.text)}
              </span>
            </h3>
          );
        }

        if (block.type === "list") {
          const listClass = `m-0 max-w-full space-y-1.5 pl-6 text-base leading-[1.6] break-words ${textClass}`;
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
              className={`m-0 max-w-full rounded-md border border-black/5 bg-black/[0.035] px-3 py-2 text-sm leading-[1.45] break-words ${
                tone === "error" ? "text-text-alert" : "text-text-muted"
              }`}
              data-testid="assistant-source-line"
              key={block.key}
            >
              <span className={strongClass}>{block.label}:</span>{" "}
              <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={block.text} />
            </p>
          );
        }

        if (block.type === "table") {
          return (
            <div className="grid max-w-full gap-2" key={block.key}>
              <MobileMarkdownTableCards
                block={block}
                linkClass={linkClass}
                strongClass={strongClass}
              />
              <div className="hidden max-w-full overflow-x-auto rounded-md border border-border-default sm:block">
                <table className="w-full min-w-[560px] border-collapse bg-white text-sm text-text-default">
                  <thead className="bg-brand-lavender-50 text-text-strong">
                    <tr>
                      {block.headers.map((header, index) => (
                        <th
                          className={`border-border-default border-b px-3 py-2 align-top font-black ${tableTextAlignmentClass(block.alignments[index])}`}
                          key={`${block.key}-head-${header}`}
                          scope="col"
                        >
                          <InlineMarkdown
                            linkClass={linkClass}
                            strongClass={strongClass}
                            value={header}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row) => (
                      <tr
                        className="border-border-default border-t"
                        key={`${block.key}-${row.join("|")}`}
                      >
                        {block.headers.map((header, cellIndex) => (
                          <td
                            className={`px-3 py-2 align-top leading-[1.45] ${tableTextAlignmentClass(block.alignments[cellIndex])}`}
                            key={`${block.key}-${row.join("|")}-${header}`}
                          >
                            <InlineMarkdown
                              linkClass={linkClass}
                              strongClass={strongClass}
                              value={row[cellIndex] ?? ""}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        return (
          <p
            className={`m-0 max-w-full text-base leading-[1.65] break-words ${textClass}`}
            key={block.key}
          >
            <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function MobileMarkdownTableCards({
  block,
  linkClass,
  strongClass,
}: {
  block: Extract<AssistantMarkdownBlock, { type: "table" }>;
  linkClass: string;
  strongClass: string;
}) {
  return (
    <div className="grid gap-2 sm:hidden">
      {block.rows.map((row, rowIndex) => {
        const title = row[0] ?? "";
        const primary = row[1] ?? "";
        const Icon = mobileTableRowIcon(block.headers[0] ?? title, title, rowIndex);
        const supportingCells = row.slice(2).map((cell, index) => ({
          label: block.headers[index + 2] ?? "",
          value: cell,
        }));

        return (
          <article
            className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)_24px] items-center gap-3 rounded-lg border border-border-default bg-white px-3 py-3 shadow-none"
            key={`${block.key}-mobile-${row.join("|")}`}
          >
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-lavender-100 text-brand-violet-650">
              <Icon aria-hidden="true" size={23} />
            </span>
            <div className="grid min-w-0 gap-0.5">
              <p className="m-0 min-w-0 text-base leading-tight font-black text-text-strong">
                <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={title} />
              </p>
              {primary ? (
                <p className="m-0 min-w-0 text-base leading-tight font-black text-brand-violet-650">
                  <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={primary} />
                </p>
              ) : null}
              {supportingCells.map((cell) =>
                cell.value ? (
                  <p
                    className="m-0 min-w-0 text-sm leading-snug text-text-muted"
                    key={`${cell.label}-${cell.value}`}
                  >
                    {cell.label && !isGenericTableSupportLabel(cell.label) ? (
                      <span className="font-extrabold text-text-strong">{cell.label}: </span>
                    ) : null}
                    <InlineMarkdown
                      linkClass={linkClass}
                      strongClass={strongClass}
                      value={cell.value}
                    />
                  </p>
                ) : null,
              )}
            </div>
            <ChevronRight aria-hidden="true" className="text-text-strong" size={21} />
          </article>
        );
      })}
    </div>
  );
}

function assistantHeadingDisplayText(value: string) {
  return value.replace(/^[^A-Za-z0-9]+/u, "").trim() || value;
}

function assistantHeadingIcon(value: string): typeof MapPin {
  const text = value.toLowerCase();
  if (/\b(airport|transfer|flight|sayak|iao)\b/u.test(text)) {
    return Plane;
  }
  if (/\b(sleep|stay|hotel|accommodation|room|quiet)\b/u.test(text)) {
    return BedDouble;
  }
  if (/\b(surf|wave|break|tide)\b/u.test(text)) {
    return WavesHorizontal;
  }
  if (/\b(food|restaurant|eat|dinner|lunch|breakfast|cafe)\b/u.test(text)) {
    return Utensils;
  }
  if (/\b(weather|rain|wind)\b/u.test(text)) {
    return CloudSun;
  }
  return Sparkles;
}

function mobileTableRowIcon(header: string, title: string, rowIndex: number): typeof MapPin {
  const text = `${header} ${title}`.toLowerCase();
  if (/\b(private|car)\b/u.test(text)) {
    return CarFront;
  }
  if (/\b(van|bus|shared|transport|option)\b/u.test(text)) {
    return Bus;
  }
  if (/\b(spot|surf|wave|break)\b/u.test(text)) {
    return WavesHorizontal;
  }
  if (/\b(food|restaurant|eat|dish|cafe)\b/u.test(text)) {
    return Utensils;
  }
  if (rowIndex === 0) {
    return Bus;
  }
  if (rowIndex === 1) {
    return CarFront;
  }
  return MapPin;
}

function isGenericTableSupportLabel(label: string) {
  return /^(notes?|details?|the gist|vibe)$/iu.test(label.trim());
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
  let tableLines: string[] = [];
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

  const flushTable = () => {
    if (tableLines.length === 0) {
      return;
    }

    const table = parseAssistantMarkdownTable(tableLines, blockKeyCount);
    if (table) {
      blocks.push(table);
      blockKeyCount += 1;
    } else {
      paragraphLines.push(...tableLines);
    }
    tableLines = [];
  };

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (isMarkdownTableLine(line)) {
      flushParagraph();
      flushList();
      tableLines.push(line);
      continue;
    }

    flushTable();

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
  flushTable();

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

function tableTextAlignmentClass(alignment: AssistantMarkdownTableAlignment | undefined) {
  if (alignment === "center") {
    return "text-center";
  }
  if (alignment === "right") {
    return "text-right";
  }
  return "text-left";
}

function parseAssistantMarkdownTable(
  lines: readonly string[],
  blockKeyCount: number,
): AssistantMarkdownBlock | undefined {
  if (lines.length < 2) {
    return undefined;
  }

  const headers = parseMarkdownTableCells(lines[0] ?? "");
  const separatorCells = parseMarkdownTableCells(lines[1] ?? "");
  if (
    headers.length === 0 ||
    separatorCells.length !== headers.length ||
    !separatorCells.every(isMarkdownTableSeparatorCell)
  ) {
    return undefined;
  }

  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const row = normalizeMarkdownTableRow(parseMarkdownTableCells(line), headers.length);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }
  if (rows.length === 0) {
    return undefined;
  }

  return {
    key: createAssistantMarkdownKey("table", headers.join("|"), blockKeyCount),
    type: "table",
    headers,
    rows,
    alignments: separatorCells.map(markdownTableAlignment),
  };
}

function isMarkdownTableLine(line: string) {
  return /^\|.+\|$/.test(line) && line.split("|").length >= 3;
}

function parseMarkdownTableCells(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeMarkdownTableRow(cells: readonly string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");
}

function isMarkdownTableSeparatorCell(cell: string) {
  return /^:?-{3,}:?$/.test(cell);
}

function markdownTableAlignment(cell: string): AssistantMarkdownTableAlignment {
  if (/^:-{3,}:$/.test(cell)) {
    return "center";
  }
  if (/^-{3,}:$/.test(cell)) {
    return "right";
  }
  return "left";
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeComposerTextarea(textareaRef.current);
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitPrompt(inputValue);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || isSending || inputValue.trim().length === 0) {
      return;
    }

    event.preventDefault();
    onSubmitPrompt(inputValue);
  }

  const locationStatus = locationStatusText(locationState);
  const locationIndicator = locationIndicatorState(locationState);
  const locationActivationLabel = locationActivationButtonLabel(locationState);
  const locationReady = locationState.status === "ready";
  const locationRequesting = locationState.status === "requesting";

  return (
    <footer className="bg-white px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:border-border-default sm:border-t sm:px-6 sm:py-3 lg:px-8">
      <form
        aria-label="Ask Siargao composer"
        className="mx-auto w-full max-w-5xl min-w-0"
        onSubmit={handleSubmit}
      >
        <InputGroup className="min-h-[68px] items-start rounded-lg border-border-default bg-white p-2 text-text-strong shadow-card ring-1 ring-border-default sm:min-h-[58px]">
          <InputGroupAddon align="inline-start" className="shrink-0 pt-1.5">
            <InputGroupButton
              aria-label={
                locationReady ? "Location ready for next question" : "Share location once"
              }
              aria-pressed={locationReady}
              className={
                locationReady
                  ? "size-12 rounded-full bg-brand-lagoon-100 text-brand-lagoon-700 hover:bg-brand-lagoon-100 sm:size-11 sm:rounded-md"
                  : "size-12 rounded-full bg-brand-lavender-50 text-brand-violet-650 hover:bg-brand-lavender-100 hover:text-brand-violet-650 sm:size-11 sm:rounded-md sm:bg-transparent sm:text-text-muted sm:hover:text-text-strong"
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
          <textarea
            data-slot="input-group-control"
            aria-label="Ask anything about Siargao"
            className="min-w-0 max-h-32 min-h-12 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-3 text-base leading-6 whitespace-pre-wrap text-text-strong caret-brand-violet-650 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:text-text-soft focus-visible:ring-0 disabled:bg-transparent disabled:text-text-muted sm:min-h-11 sm:py-2.5"
            disabled={isSending}
            onChange={(event) => {
              resizeComposerTextarea(event.currentTarget);
              onInputValueChange(event.currentTarget.value);
            }}
            onInput={(event) => {
              resizeComposerTextarea(event.currentTarget);
              onInputValueChange(event.currentTarget.value);
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask anything about Siargao..."
            ref={textareaRef}
            rows={1}
            value={inputValue}
          />
          <InputGroupAddon align="inline-end" className="shrink-0 pt-1.5">
            <InputGroupButton
              aria-label="Send question"
              className="size-12 rounded-full bg-brand-violet-650 text-white shadow-violet-glow hover:bg-brand-violet-600 disabled:opacity-50 sm:size-11 sm:rounded-md"
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
        <div className="mt-3 flex min-h-5 flex-wrap items-center gap-2 px-1 sm:mt-2">
          <Badge
            aria-label={`Location ${locationIndicator.label.toLowerCase()}`}
            className={locationIndicator.className}
            variant="outline"
          >
            <span className={locationIndicator.dotClassName} />
            {locationIndicator.label}
          </Badge>
          <p
            aria-live="polite"
            className="m-0 min-w-0 flex-1 truncate text-sm leading-tight font-bold text-text-muted sm:text-[0.72rem] sm:font-extrabold"
          >
            {locationStatus}
          </p>
          {locationActivationLabel ? (
            <Button
              className="h-7 rounded-md border-transparent bg-transparent px-2 text-sm font-black text-brand-violet-650 hover:bg-brand-lavender-50 sm:border-border-default sm:bg-white sm:px-2.5 sm:text-[0.68rem] sm:text-text-strong"
              disabled={isSending || locationRequesting}
              onClick={onRequestLocation}
              size="sm"
              type="button"
              variant="outline"
            >
              <MapPin aria-hidden="true" size={12} />
              <span className="sm:hidden">
                {locationActivationLabel === "Enable location" ? "Enable" : locationActivationLabel}
              </span>
              <span className="hidden sm:inline">{locationActivationLabel}</span>
            </Button>
          ) : null}
        </div>
      </form>
    </footer>
  );
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
}

function locationStatusText(locationState: LocationCaptureState) {
  switch (locationState.status) {
    case "requesting":
      return "Requesting location...";
    case "ready":
      return locationState.geolocation.consentScope === "trip_session"
        ? "Location active for this chat."
        : "Location ready for the next question.";
    case "denied":
      return "Location permission denied. Allow it in browser site settings, then try again.";
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

function locationActivationButtonLabel(locationState: LocationCaptureState) {
  switch (locationState.status) {
    case "idle":
    case "consumed":
      return "Enable location";
    case "denied":
    case "unavailable":
    case "unsupported":
      return "Try again";
    case "requesting":
    case "ready":
      return null;
  }
}

function locationIndicatorState(locationState: LocationCaptureState) {
  switch (locationState.status) {
    case "ready":
      return {
        label: "Location active",
        className:
          "gap-1.5 rounded-md border-brand-lagoon-700/15 bg-brand-lagoon-100 px-2 py-0.5 text-[0.68rem] font-black text-brand-lagoon-700",
        dotClassName: "size-1.5 rounded-full bg-brand-lagoon-500",
      };
    case "requesting":
      return {
        label: "Location pending",
        className:
          "gap-1.5 rounded-md border-brand-sunset-gold/35 bg-surface-caveat px-2 py-0.5 text-[0.68rem] font-black text-text-caveat",
        dotClassName: "size-1.5 rounded-full bg-brand-sunset-gold",
      };
    case "denied":
      return {
        label: "Location blocked",
        className:
          "gap-1.5 rounded-md border-border-alert bg-surface-alert px-2 py-0.5 text-[0.68rem] font-black text-text-alert",
        dotClassName: "size-1.5 rounded-full bg-brand-sunset-coral",
      };
    case "unavailable":
    case "unsupported":
      return {
        label: "Location unavailable",
        className:
          "gap-1.5 rounded-md border-brand-sunset-gold/35 bg-surface-caveat px-2 py-0.5 text-[0.68rem] font-black text-text-caveat",
        dotClassName: "size-1.5 rounded-full bg-brand-sunset-gold",
      };
    default:
      return {
        label: "Location off",
        className:
          "gap-1.5 rounded-md border-border-default bg-brand-lavender-50 px-2 py-0.5 text-[0.68rem] font-black text-text-muted",
        dotClassName: "size-1.5 rounded-full bg-text-soft",
      };
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
  const mobileShortcuts = mobileSuggestedPromptShortcuts(prompts);

  return (
    <fieldset aria-label="Suggested prompts" className="m-0 min-w-0 border-0 p-0">
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 sm:hidden">
        {mobileShortcuts.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <Button
              className="h-11 shrink-0 rounded-full border-border-default bg-white px-3 text-sm font-bold whitespace-nowrap text-text-strong shadow-none hover:bg-brand-lavender-50 min-[390px]:h-12 min-[390px]:px-4 min-[390px]:text-base"
              disabled={disabled}
              key={shortcut.label}
              onClick={() => onSubmitPrompt(shortcut.prompt)}
              type="button"
              variant="outline"
            >
              <Icon aria-hidden="true" className="text-brand-violet-650" size={20} />
              {shortcut.label}
            </Button>
          );
        })}
      </div>
      <div className="hidden min-w-0 flex-wrap gap-2 overflow-visible sm:flex">
        {prompts.map((prompt) => (
          <Button
            className="h-auto min-h-9 max-w-full min-w-0 overflow-hidden rounded-full border-border-default bg-white px-4 py-2 text-left text-xs font-extrabold text-ellipsis whitespace-nowrap text-brand-violet-650 hover:bg-brand-lavender-50"
            disabled={disabled}
            key={prompt}
            onClick={() => onSubmitPrompt(prompt)}
            type="button"
            variant="outline"
          >
            {prompt}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function mobileSuggestedPromptShortcuts(prompts: readonly string[]) {
  const [surfPrompt, foodPrompt, quietPrompt] = prompts;
  return [
    {
      label: "Where to stay",
      icon: BedDouble,
      prompt: quietPrompt ?? "Where should I stay near Cloud 9 for quiet sleep?",
    },
    {
      label: "Surf spots",
      icon: WavesHorizontal,
      prompt: surfPrompt ?? "Which surf spots should I use near Cloud 9?",
    },
    {
      label: "Restaurants",
      icon: Utensils,
      prompt: foodPrompt ?? "Where should I eat in General Luna tonight?",
    },
    {
      label: "More",
      icon: ChevronDown,
      prompt: "What else should I know for a smooth Cloud 9 stay?",
    },
  ];
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
    <div className="grid min-h-full min-w-0 content-center gap-8 py-10 sm:py-14">
      <div className="grid min-w-0 max-w-2xl gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-lg bg-brand-lavender-100 text-brand-violet-650">
          <Sparkles aria-hidden="true" size={24} />
        </div>
        <div className="grid gap-3">
          <h1 className="m-0 max-w-full text-3xl leading-[1.05] font-black break-words text-text-strong [overflow-wrap:anywhere] sm:text-5xl">
            Ask a real question about your Siargao trip.
          </h1>
          <p className="m-0 max-w-xl text-base leading-[1.7] break-words text-text-muted">
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

function interactiveMessageFromThreadMessage(
  message: ChatThreadDetailMessage,
): InteractiveChatMessage {
  return {
    id: message.id,
    messageId: message.role === "assistant" ? message.id : undefined,
    role: message.role,
    text: message.content,
    timestamp: chatTimeFormatter.format(new Date(message.createdAt)),
    status: message.status === "error" ? "error" : "complete",
    rating: message.rating?.rating ?? null,
    cards: message.cards,
    actions: message.actions,
    itineraries: message.itineraries,
    decisionSummaries: message.decisionSummaries,
    sources: message.sources,
  };
}

function withoutSetValue(values: ReadonlySet<string>, value: string) {
  if (!values.has(value)) {
    return values;
  }

  const nextValues = new Set(values);
  nextValues.delete(value);
  return nextValues;
}

function withSetValue(values: ReadonlySet<string>, value: string) {
  if (values.has(value)) {
    return values;
  }

  const nextValues = new Set(values);
  nextValues.add(value);
  return nextValues;
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

function shouldCaptureLocationForPrompt(prompt: string, locationState: LocationCaptureState) {
  if (locationState.status === "ready" || locationState.status === "requesting") {
    return false;
  }

  if (locationState.status === "consumed") {
    return hasDirectBrowserLocationPrompt(prompt);
  }

  if (
    locationState.status === "denied" ||
    locationState.status === "unavailable" ||
    locationState.status === "unsupported"
  ) {
    return false;
  }

  return isLocationSensitivePrompt(prompt);
}

function isLocationSensitivePrompt(prompt: string) {
  if (hasDirectBrowserLocationPrompt(prompt)) {
    return true;
  }

  if (hasExplicitSiargaoArea(prompt)) {
    return false;
  }

  return /\b(?:open\s+now|weather|rain|today|tonight|tomorrow|plan\b.{0,48}\bday|itinerary)\b/i.test(
    prompt,
  );
}

function hasDirectBrowserLocationPrompt(prompt: string) {
  return /\b(?:near\s+me|nearby|around\s+me|close\s+to\s+me|my\s+(?:location|area)|current\s+location|where\s+i\s+am)\b/i.test(
    prompt,
  );
}

function hasExplicitSiargaoArea(prompt: string) {
  return /\b(?:cloud\s*9|general\s+luna|del\s+carmen|dapa|pacifico|burgos|pilar|malinao|catangnan|union|maasin|santa\s+monica|san\s+isidro)\b/i.test(
    prompt,
  );
}

function buildChatRequestBody(
  messages: ReturnType<typeof buildChatRequestMessages>,
  locationState: LocationCaptureState,
  threadId: string | null,
): {
  messages: ReturnType<typeof buildChatRequestMessages>;
  clientContext?: ChatClientContext;
  threadId?: string;
} {
  return {
    messages,
    ...(threadId ? { threadId } : {}),
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
