"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Home,
  LoaderCircle,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
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
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

const suggestedPrompts = [
  "What should I do near Cloud 9 today?",
  "Where should I eat in General Luna tonight?",
  "Help me plan a quiet Siargao day",
];

const chatSignedOutActions = (
  <>
    <SignInButton mode="modal">
      <Button
        className="hidden h-10 rounded-md border-white/20 bg-white/10 px-3 text-xs font-extrabold text-text-on-dark hover:bg-white/15 sm:inline-flex"
        type="button"
        variant="outline"
      >
        Sign in
      </Button>
    </SignInButton>
    <SignUpButton mode="modal">
      <Button
        className="h-10 rounded-md border-brand-lagoon-300/35 bg-brand-lagoon-500 px-3 text-xs font-extrabold text-brand-navy-980 hover:bg-brand-lagoon-300"
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
      type: "list";
      ordered: boolean;
      items: Array<{
        key: string;
        text: string;
      }>;
    };
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
  messageEndRef: RefObject<HTMLDivElement | null>;
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
};

function useChatWorkspaceController(initialPrompt: string): ChatWorkspaceController {
  const [inputValue, setInputValue] = useState(() => initialPrompt.trim());
  const [isSending, setIsSending] = useState(false);
  const [locationState, setLocationState] = useState<LocationCaptureState>({ status: "idle" });
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "error">("idle");
  const savedTripState = useSyncExternalStore(
    subscribeSavedTripState,
    getSavedTripSnapshot,
    getSavedTripServerSnapshot,
  );
  const messageEndRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  });

  const handlePromptSubmit = useCallback(
    (prompt: string) => {
      void submitPrompt(prompt);
    },
    [submitPrompt],
  );

  return {
    chatThreads,
    handlePromptSubmit,
    historyStatus,
    inputValue,
    isSending,
    locationState,
    messageEndRef,
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
  };
}

function ChatWorkspaceView({
  chatThreads,
  handlePromptSubmit,
  historyStatus,
  inputValue,
  isSending,
  locationState,
  messageEndRef,
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
}: ChatWorkspaceController) {
  const hasMessages = messages.length > 0;

  return (
    <main
      aria-label="Ask Siargao chat workspace"
      className="h-dvh min-h-screen overflow-hidden bg-[image:var(--gradient-app-backdrop)] text-text-on-dark"
    >
      <section className="mx-auto grid h-full min-h-0 w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex min-h-[72px] items-center justify-between gap-4 border-white/12 border-b px-4 py-3 sm:px-6 lg:min-h-[88px] lg:px-8">
          <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
            <BrandLockup className="[&_span:last-child]:text-xl sm:[&_span:last-child]:text-[1.7rem]" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-text-on-dark-muted sm:inline-flex">
              <span className="size-2 rounded-full bg-brand-lagoon-500" />
              Siargao trip assistant
            </span>
            <ChatAuthActions />
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
            {(chatThreads.length > 0 || historyStatus !== "idle") && (
              <ChatHistoryPanel
                historyStatus={historyStatus}
                onArchiveSelectedThread={() => {
                  void archiveSelectedThread();
                }}
                onDeleteSelectedThread={() => {
                  void deleteSelectedThread();
                }}
                onOpenThread={(threadId) => {
                  void openChatThread(threadId);
                }}
                onRenameSelectedThread={() => {
                  void renameSelectedThread();
                }}
                onStartNewChat={startNewChat}
                selectedThreadId={selectedThreadId}
                threads={chatThreads}
              />
            )}
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

function ChatAuthActions() {
  if (!isClerkConfigured) {
    return (
      <>
        <Button
          asChild
          className="hidden h-10 rounded-md border-white/20 bg-white/10 px-3 text-xs font-extrabold text-text-on-dark hover:bg-white/15 sm:inline-flex"
          variant="outline"
        >
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button
          asChild
          className="h-10 rounded-md border-brand-lagoon-300/35 bg-brand-lagoon-500 px-3 text-xs font-extrabold text-brand-navy-980 hover:bg-brand-lagoon-300"
        >
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </>
    );
  }

  return (
    <Show fallback={chatSignedOutActions} when="signed-in">
      <UserButton
        appearance={clerkAppearance}
        fallback={
          <span className="inline-flex size-10 animate-pulse rounded-md border border-white/20 bg-white/10" />
        }
      />
    </Show>
  );
}

function ChatHistoryPanel({
  historyStatus,
  onArchiveSelectedThread,
  onDeleteSelectedThread,
  onOpenThread,
  onRenameSelectedThread,
  onStartNewChat,
  selectedThreadId,
  threads,
}: {
  historyStatus: "idle" | "loading" | "error";
  onArchiveSelectedThread: () => void;
  onDeleteSelectedThread: () => void;
  onOpenThread: (threadId: string) => void;
  onRenameSelectedThread: () => void;
  onStartNewChat: () => void;
  selectedThreadId: string | null;
  threads: ChatThreadSummary[];
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-border-on-dark bg-surface-night-card p-3 shadow-night-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-black text-text-on-dark">Chat history</h2>
        <div className="flex items-center gap-2">
          {selectedThreadId ? (
            <>
              <Button
                className="h-8 rounded-md border-white/20 bg-white/10 px-2 text-xs text-text-on-dark hover:bg-white/15"
                onClick={onRenameSelectedThread}
                type="button"
                variant="outline"
              >
                Rename
              </Button>
              <Button
                aria-label="Archive selected chat"
                className="size-8 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
                onClick={onArchiveSelectedThread}
                size="icon"
                type="button"
                variant="outline"
              >
                <Clock aria-hidden="true" size={15} />
              </Button>
              <Button
                aria-label="Delete selected chat"
                className="size-8 rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
                onClick={onDeleteSelectedThread}
                size="icon"
                type="button"
                variant="outline"
              >
                <Trash2 aria-hidden="true" size={15} />
              </Button>
            </>
          ) : null}
          <Button
            className="h-8 rounded-md border-brand-lagoon-300/35 bg-brand-lagoon-500 px-2 text-xs font-extrabold text-brand-navy-980 hover:bg-brand-lagoon-300"
            onClick={onStartNewChat}
            type="button"
          >
            New
          </Button>
        </div>
      </div>
      {historyStatus === "error" ? (
        <p className="m-0 text-xs font-bold text-text-alert">Chat history unavailable</p>
      ) : null}
      {historyStatus === "loading" ? (
        <p className="m-0 text-xs font-bold text-text-on-dark-muted">Loading thread</p>
      ) : null}
      <nav aria-label="Previous chats">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {threads.map((thread) => (
            <button
              className={`max-w-56 shrink-0 rounded-md border px-3 py-2 text-left text-xs font-extrabold transition ${
                thread.id === selectedThreadId
                  ? "border-brand-lagoon-500 bg-brand-lagoon-500 text-brand-navy-980"
                  : "border-white/15 bg-white/10 text-text-on-dark hover:bg-white/15"
              }`}
              key={thread.id}
              onClick={() => onOpenThread(thread.id)}
              type="button"
            >
              <span className="block truncate">{thread.title}</span>
              {thread.archivedAt ? <span className="block opacity-70">Archived</span> : null}
            </button>
          ))}
        </div>
      </nav>
    </section>
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
        className="min-w-0 max-w-[min(88%,42rem)] justify-self-end overflow-hidden rounded-lg bg-[image:var(--gradient-cta)] px-5 py-4 text-text-on-dark shadow-cta"
        data-testid="user-message-bubble"
      >
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.55] font-extrabold [overflow-wrap:anywhere] sm:text-base">
          {message.text}
        </p>
        <time className="mt-2 block text-right text-xs font-bold text-brand-lavender-200">
          {message.timestamp}
        </time>
      </article>
    );
  }

  return (
    <article className="grid max-w-[min(96%,56rem)] grid-cols-[36px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[44px_minmax(0,1fr)] sm:gap-4">
      <PalmMark className="mt-1 size-8 sm:size-10" />
      <div
        data-testid="assistant-message-bubble"
        className={
          isError
            ? "min-w-0 overflow-hidden rounded-lg border border-border-alert bg-surface-alert px-5 py-4 shadow-night-card"
            : "min-w-0 overflow-hidden rounded-lg border border-border-on-dark bg-surface-night-panel px-4 py-4 text-text-on-dark shadow-strong ring-1 ring-border-on-dark sm:px-5"
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
          <time className={isError ? "text-text-alert" : "text-text-on-dark-muted"}>
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
            className="mt-4 h-9 rounded-md border-border-alert bg-surface-night-card px-3 text-xs font-extrabold text-text-on-dark hover:bg-surface-night-card-strong"
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
        className={`size-8 rounded-md border-white/16 text-text-on-dark hover:bg-white/15 ${
          rating === "up" ? "bg-brand-lagoon-500 text-brand-navy-980" : "bg-white/8"
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
        className={`size-8 rounded-md border-white/16 text-text-on-dark hover:bg-white/15 ${
          rating === "down" ? "bg-surface-caveat text-text-caveat" : "bg-white/8"
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
      className="grid min-w-0 gap-3 rounded-lg border border-border-on-dark bg-surface-night-card p-3 text-text-on-dark shadow-night-card backdrop-blur-md"
      data-testid="saved-plan-tray"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-500/18 text-brand-lagoon-300">
            <BookmarkCheck aria-hidden="true" size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-black text-text-on-dark">Saved plan</h2>
            <p className="m-0 text-xs font-bold text-text-on-dark-muted">
              {items.length} {items.length === 1 ? "item" : "items"} saved locally,{" "}
              {selectedItemCount} selected to share
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 rounded-md border-brand-lagoon-300/30 bg-brand-lagoon-500 px-3 text-xs font-extrabold text-brand-navy-980 hover:bg-brand-lagoon-300 disabled:opacity-55"
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

      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1" data-testid="saved-plan-items">
        {items.map((item) => {
          const isIncluded = !excludedShareItemIds.has(item.id);

          return (
            <div
              className="grid min-w-[14rem] max-w-[19rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border-on-dark bg-surface-night-card-strong px-3 py-2"
              data-testid="saved-plan-item"
              key={item.id}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-night-card text-brand-lagoon-300">
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
                  className="size-4 shrink-0 accent-brand-lagoon-500"
                  onChange={(event) => onToggleShareItem(item.id, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-text-on-dark">
                  {item.title}
                </span>
              </label>
              <Button
                aria-label={`Remove ${item.title} from saved plan`}
                className="size-8 shrink-0 rounded-md border-border-on-dark bg-surface-night-card text-text-on-dark hover:bg-surface-night-card-strong"
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
          className="grid min-w-0 gap-2 rounded-md border border-brand-lagoon-300/20 bg-brand-lagoon-700/18 p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          data-testid="saved-plan-share-link"
        >
          <input
            aria-label="Share link"
            className="min-h-9 min-w-0 rounded-md border border-border-on-dark bg-surface-night-card px-3 text-xs font-bold text-text-on-dark outline-none"
            readOnly
            value={shareUrl}
          />
          <Button
            className="rounded-md border-border-on-dark bg-surface-night-card text-xs font-extrabold text-text-on-dark hover:bg-surface-night-card-strong"
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
            className="rounded-md border-border-on-dark bg-surface-night-card text-xs font-extrabold text-text-on-dark hover:bg-surface-night-card-strong"
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
      className="grid min-w-0 gap-3 rounded-md border border-white/10 bg-white/[0.045] p-3 shadow-none"
    >
      <h3 className="m-0 flex items-center gap-2 text-sm font-black text-white">
        <Sparkles aria-hidden="true" className="text-brand-sunset-gold" size={17} />
        At a Glance
      </h3>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-md border border-white/8 bg-white/[0.055] px-3 py-2"
              key={`${item.label}-${item.value}`}
            >
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-brand-lagoon-500/18 text-brand-lagoon-300">
                <Icon aria-hidden="true" size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.68rem] leading-tight font-black text-text-on-dark-muted">
                  {item.label}
                </span>
                <span className="block truncate text-xs font-black text-white">{item.value}</span>
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
          className="grid min-w-0 gap-3 rounded-md border border-brand-lagoon-300/22 bg-brand-lagoon-300/10 p-3 shadow-none"
          data-testid="decision-summary-panel"
          key={summary.id}
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="grid min-w-0 gap-1">
              <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-[0.68rem] leading-tight font-black text-brand-lagoon-200 uppercase">
                <Navigation aria-hidden="true" className="shrink-0" size={13} />
                Best move
              </span>
              <h3 className="m-0 text-base leading-tight font-black break-words text-white">
                {summary.bestAction}
              </h3>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5 sm:justify-end">
              {summary.area ? <DecisionSummaryChip icon={MapPin} label={summary.area} /> : null}
              {summary.timing ? <DecisionSummaryChip icon={Clock} label={summary.timing} /> : null}
            </div>
          </div>
          <p className="m-0 text-sm leading-[1.45] font-bold break-words text-text-on-dark-muted">
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
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-xs font-extrabold text-text-on-dark-muted">
      <Icon aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function DecisionSummaryGuidance({ label, value }: { label: string; value: string }) {
  return (
    <p className="m-0 rounded-md border border-white/8 bg-white/[0.045] px-3 py-2 text-xs leading-[1.45] font-bold break-words text-text-on-dark-muted">
      <span className="font-black text-white">{label}: </span>
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
      className="mt-1 grid min-w-0 gap-1 rounded-md border border-brand-lagoon-300/18 bg-brand-lagoon-300/10 px-2.5 py-2"
      data-testid="artifact-decision"
    >
      <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-[0.7rem] leading-tight font-black text-brand-lagoon-200 uppercase">
        <Sparkles aria-hidden="true" className="shrink-0" size={12} />
        <span className="min-w-0 break-words">{artifactDecisionLabel(decision.label)}</span>
      </span>
      <p className="m-0 text-xs leading-[1.4] font-bold break-words text-text-on-dark-muted">
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
            className="grid min-w-0 gap-4 rounded-md border border-white/10 bg-white/[0.045] p-3 shadow-none"
            data-testid="itinerary-plan"
            key={`${plan.title}-${plan.durationLabel}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-violet-650/22 text-brand-lavender-200">
                <Navigation aria-hidden="true" size={17} />
              </div>
              <div className="grid min-w-0 flex-1 gap-1">
                <h3 className="m-0 text-sm leading-[1.25] font-black break-words text-white sm:text-base">
                  {plan.title}
                </h3>
                <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.07] px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold text-text-on-dark-muted">
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
  const visibleCaveats = publicDisplayCaveats(stop.caveats);

  return (
    <li className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-lagoon-300/35 bg-brand-lagoon-500 text-xs font-black text-brand-navy-980 shadow-lagoon-glow">
        {stop.sequence}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 min-w-0 text-sm leading-[1.3] font-black break-words text-white">
            {stop.title}
          </h4>
          {stop.area ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-white/8 bg-white/[0.07] px-2 py-1 text-[0.7rem] leading-tight font-extrabold text-text-on-dark-muted">
              <MapPin aria-hidden="true" className="shrink-0" size={12} />
              <span className="min-w-0 break-words">{stop.area}</span>
            </span>
          ) : null}
        </div>

        {stop.travelTimeFromPreviousMinutes ? (
          <p className="m-0 inline-flex min-w-0 items-center gap-1.5 text-xs leading-[1.45] font-bold break-words text-text-on-dark-muted">
            <Clock aria-hidden="true" className="shrink-0" size={13} />
            <span className="min-w-0 break-words">
              About {stop.travelTimeFromPreviousMinutes} minutes from the previous stop.
            </span>
          </p>
        ) : null}

        <p className="m-0 text-xs leading-[1.5] break-words text-text-on-dark-muted sm:text-sm">
          {stop.rationale}
        </p>

        {visibleCaveats.length ? (
          <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-brand-sunset-gold">
            {visibleCaveats.map((caveat) => (
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
  const visibleItems = publicDisplayCaveats(items);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-1.5" data-testid={testId}>
      <h4 className="m-0 text-xs font-black text-white">{title}</h4>
      <ul className="m-0 grid min-w-0 gap-1 pl-4 text-xs leading-[1.45] text-text-on-dark-muted sm:text-sm">
        {visibleItems.map((item) => (
          <li className="break-words" key={item}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItinerarySources({ sources }: { sources: ItineraryPlanArtifact["sources"] }) {
  const visibleSources = publicDisplaySources(sources);
  if (visibleSources.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-2" data-testid="itinerary-sources">
      <h4 className="m-0 text-xs font-black text-white">Sources</h4>
      <div className="flex min-w-0 flex-wrap gap-2">
        {visibleSources.map((source) => (
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
  const visibleSources = publicDisplaySources(sources);
  if (visibleSources.length === 0) {
    return "Caveated";
  }
  const highConfidence = visibleSources.some((source) => source.confidence === "high");
  const liveChecked = visibleSources.some((source) => source.label === "live_checked");
  if (liveChecked && highConfidence) {
    return "Live checked";
  }
  return sourceBadgeTitle(visibleSources[0] ?? sources[0]);
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
  const visibleSources = publicDisplaySources(sources);
  return visibleSources.length
    ? `Checked: ${formatCompactList(visibleSources.map(sourceDisplayName))}`
    : "Checked source details unavailable";
}

function isActuallyCheckedSource(source: ChatSourceArtifact) {
  return source.label !== "not_verified" && source.label !== "provider_unavailable";
}

function sourceDisplayName(source: ChatSourceArtifact) {
  return source.sourceName || formatTrustLabel(source.label);
}

function publicDisplaySources(sources: readonly ChatSourceArtifact[]) {
  return sources.filter(isActuallyCheckedSource);
}

function publicDisplayCaveats(caveats: readonly string[]) {
  return caveats.filter((caveat) => !isInternalVerificationGap(caveat));
}

function isInternalVerificationGap(value: string) {
  return [
    /\bnot\s+checked\b/i,
    /\bwasn['’]?t\s+(?:separately\s+)?checked\b/i,
    /\bwere\s+not\s+checked\b/i,
    /\bno\s+live\b.{0,90}\bcheck\b/i,
    /\bunchecked\b/i,
    /\bnot\s+verified\b/i,
    /\bI\s+(?:didn['’]?t|did\s+not)\s+(?:live[-\s]?)?check\b/i,
    /\b(?:live[-\s]?)?check(?:ed|ing)?\s+(?:was|were|is|are)?\s*(?:not|needed|needs)\b/i,
    /\bcurated\s+local\s+guide\s+estimate\b/i,
    /\bexact\s+ride\s+time\s+depends\b/i,
    /\buser\s+constraints\s+preserved\b/i,
    /\borigin-specific\s+route\s+timing\b/i,
    /\bthis\s+artifact\b/i,
    /\bsource\s+caveats?\b/i,
    /\bavoid\s+overclaiming\b/i,
    /\buse\s+(?:search_places|places)\b/i,
    /\bplaces\s+evidence\b/i,
    /\b(?:open|opening|cafe|menu|booking|availability|crowd|quietness).{0,80}\bshould\s+be\s+checked\b/i,
    /\bclaim(?:ing)?\b.{0,80}\b(?:open|status|hours|safety|reliability)\b/i,
    /\bwithout\b.{0,80}\b(?:condition|safety|tide|surf|road).{0,40}\bcheck/i,
  ].some((pattern) => pattern.test(value));
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
      className: "border-sky-300/20 bg-sky-300/10 text-sky-100",
    };
  }
  if (source.label === "marine_checked" || source.label === "tide_forecast_checked") {
    return {
      icon: Navigation,
      label: source.label === "marine_checked" ? "Marine checked" : "Tide checked",
      className: "border-brand-lagoon-300/20 bg-brand-lagoon-300/10 text-brand-lagoon-100",
    };
  }
  if (source.label === "event_checked") {
    return {
      icon: ShieldCheck,
      label: "Event checked",
      className: "border-brand-sunset-gold/20 bg-brand-sunset-gold/10 text-brand-sunset-peach",
    };
  }
  if (source.label === "venue_checked") {
    return {
      icon: ShieldCheck,
      label: "Venue checked",
      className: "border-brand-lavender-200/20 bg-brand-violet-650/20 text-brand-lavender-200",
    };
  }
  if (source.label === "community_signal") {
    return {
      icon: Star,
      label: "Community signal",
      className: "border-white/15 bg-white/8 text-white/75",
    };
  }
  if (source.label === "curated_local_guide") {
    return {
      icon: Star,
      label: "Local guide",
      className: "border-brand-sunset-gold/20 bg-brand-sunset-gold/10 text-brand-sunset-peach",
    };
  }
  if (source.label === "fresh_cache") {
    return {
      icon: ShieldCheck,
      label: "Fresh source",
      className: "border-brand-lavender-200/20 bg-brand-violet-650/20 text-brand-lavender-200",
    };
  }

  return {
    icon: ShieldCheck,
    label: source.label === "live_checked" ? "Live checked" : sourceBadgeTitle(source),
    className: "border-brand-lagoon-300/20 bg-brand-lagoon-300/10 text-brand-lagoon-100",
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
      className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-brand-sunset-gold/20 bg-brand-sunset-gold/10 px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold text-brand-sunset-peach"
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
      className="grid min-w-0 gap-3 rounded-md border border-white/10 bg-white/[0.045] p-3 shadow-none"
      data-testid="recommendation-cards"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 text-sm font-black text-white">
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
            className="grid min-w-0 gap-3 rounded-md border border-white/8 bg-white/[0.055] p-3"
            data-testid="recommendation-card"
            key={card.id}
          >
            <div className="grid min-w-0 gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-500/18 text-brand-lagoon-300 shadow-lagoon-glow">
                  {card.kind === "beach" ? (
                    <Navigation aria-hidden="true" size={17} />
                  ) : (
                    <Utensils aria-hidden="true" size={18} />
                  )}
                </div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <h4 className="m-0 text-sm leading-[1.25] font-black break-words text-white sm:text-base">
                    {card.title}
                  </h4>
                  {subtitle.meta ? (
                    <p className="m-0 text-xs leading-[1.45] break-words text-text-on-dark-muted sm:text-sm">
                      {subtitle.meta}
                    </p>
                  ) : null}
                  {subtitle.address ? (
                    <p className="m-0 text-xs leading-[1.45] break-words text-text-on-dark-muted">
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
                <p className="m-0 text-xs leading-[1.45] break-words text-text-on-dark-muted sm:text-sm">
                  <span className="font-black text-text-on-dark">Why this:</span>{" "}
                  {usefulReasons.join(" ")}
                </p>
              ) : null}

              {card.mapsUrl ? (
                <a
                  aria-label={`Open ${card.title} in Google Maps`}
                  className="inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-md border border-white/12 bg-white/[0.08] px-3 py-2 text-xs font-extrabold text-text-on-dark no-underline hover:bg-white/[0.12]"
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
          : "size-9 shrink-0 rounded-md border-white/12 bg-white/[0.08] text-text-on-dark hover:bg-white/[0.13]"
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
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.07] px-2.5 py-1.5 text-[0.72rem] leading-tight font-extrabold text-text-on-dark-muted">
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
            className="h-auto min-h-9 rounded-md border-white/12 bg-white/[0.08] px-3 py-2 text-xs font-extrabold text-text-on-dark hover:bg-white/[0.13]"
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
            className="h-auto min-h-9 rounded-md border-brand-lavender-200/25 bg-brand-violet-650/20 px-3 py-2 text-xs font-extrabold text-brand-lavender-200 hover:bg-brand-violet-650/28"
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
  const visibleSources = publicDisplaySources(dedupeChatSources(sources));
  if (visibleSources.length === 0) {
    return null;
  }

  return (
    <details
      className="group rounded-md border border-white/10 bg-white/[0.045] p-3"
      data-testid="assistant-sources-panel"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-sm font-black text-white">
            <ShieldCheck aria-hidden="true" className="text-brand-lagoon-300" size={16} />
            Sources & Confidence
          </span>
          <span className="min-w-0 text-xs font-bold text-text-on-dark-muted">
            {sourceSummaryText(visibleSources)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-black text-text-on-dark-muted">
          View sources
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
            size={14}
          />
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        {visibleSources.map((source) => (
          <div
            className="grid gap-1 rounded-md border border-white/8 bg-black/10 p-3"
            key={chatSourceKey(source)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceIconBadge source={source} />
              <span className="text-xs font-black text-white">{source.sourceName}</span>
              {source.confidence ? (
                <span className="text-[0.7rem] font-bold text-text-on-dark-muted">
                  {source.confidence} confidence
                </span>
              ) : null}
            </div>
            {source.checked.length ? (
              <p className="m-0 text-xs leading-[1.45] text-text-on-dark-muted">
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
  const blocks = parseAssistantMarkdownBlocks(stripInternalDisclosureText(text));
  const textClass = tone === "error" ? "text-text-on-dark" : "text-text-on-dark-muted";
  const strongClass = "font-extrabold text-white";
  const linkClass =
    tone === "error"
      ? "font-extrabold text-white underline decoration-white/45 underline-offset-4 break-words"
      : "font-extrabold text-brand-lavender-200 underline decoration-brand-lavender-200/45 underline-offset-4 break-words";

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
                tone === "error" ? "text-text-alert" : "text-text-on-dark-muted"
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

function stripInternalDisclosureText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => stripInternalDisclosureSentences(line))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripInternalDisclosureSentences(line: string) {
  const trimmedLine = line.trim();
  if (/^not checked:/i.test(trimmedLine)) {
    return "";
  }

  return line
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !isInternalVerificationGap(sentence))
    .join(" ")
    .trim();
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
      if (sourceMatch[1]?.toLocaleLowerCase() === "not checked") {
        continue;
      }
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
    <footer className="border-white/12 border-t bg-brand-navy-980/92 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
      <form aria-label="Ask Siargao composer" className="mx-auto max-w-3xl" onSubmit={handleSubmit}>
        <InputGroup className="min-h-[58px] items-start rounded-lg border-white/18 bg-white/96 p-2 shadow-strong">
          <InputGroupAddon align="inline-start" className="pt-1.5">
            <InputGroupButton
              aria-label={
                locationReady ? "Location ready for next question" : "Share location once"
              }
              aria-pressed={locationReady}
              className={
                locationReady
                  ? "size-11 rounded-md bg-brand-lagoon-700 text-white hover:bg-brand-lagoon-600"
                  : "size-11 rounded-md text-text-soft hover:bg-brand-lagoon-100 hover:text-brand-lagoon-700"
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
            className="max-h-32 min-h-11 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2.5 text-base leading-6 whitespace-pre-wrap text-text-default shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:text-text-soft focus-visible:ring-0 disabled:bg-transparent"
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
          <InputGroupAddon align="inline-end" className="pt-1.5">
            <InputGroupButton
              aria-label="Send question"
              className="size-11 rounded-md bg-[image:var(--gradient-cta)] text-white hover:shadow-violet-glow"
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
        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-2 px-1">
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
            className="m-0 text-[0.72rem] leading-tight font-extrabold text-text-on-dark-muted"
          >
            {locationStatus}
          </p>
          {locationActivationLabel ? (
            <Button
              className="h-7 rounded-md border-white/18 bg-white/10 px-2.5 text-[0.68rem] font-black text-text-on-dark hover:bg-white/15"
              disabled={isSending || locationRequesting}
              onClick={onRequestLocation}
              size="sm"
              type="button"
              variant="outline"
            >
              <MapPin aria-hidden="true" size={12} />
              {locationActivationLabel}
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
          "gap-1.5 rounded-md border-brand-lagoon-300/45 bg-brand-lagoon-500/16 px-2 py-0.5 text-[0.68rem] font-black text-brand-lagoon-300",
        dotClassName: "size-1.5 rounded-full bg-brand-lagoon-500",
      };
    case "requesting":
      return {
        label: "Location pending",
        className:
          "gap-1.5 rounded-md border-brand-sunset-gold/45 bg-brand-sunset-gold/14 px-2 py-0.5 text-[0.68rem] font-black text-brand-sunset-peach",
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
          "gap-1.5 rounded-md border-brand-sunset-gold/35 bg-brand-sunset-gold/10 px-2 py-0.5 text-[0.68rem] font-black text-brand-sunset-peach",
        dotClassName: "size-1.5 rounded-full bg-brand-sunset-gold",
      };
    default:
      return {
        label: "Location off",
        className:
          "gap-1.5 rounded-md border-white/18 bg-white/10 px-2 py-0.5 text-[0.68rem] font-black text-text-on-dark-muted",
        dotClassName: "size-1.5 rounded-full bg-text-on-dark-muted",
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
        <div className="inline-flex size-12 items-center justify-center rounded-lg bg-surface-night-card text-brand-lagoon-300">
          <Sparkles aria-hidden="true" size={24} />
        </div>
        <div className="grid gap-3">
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
