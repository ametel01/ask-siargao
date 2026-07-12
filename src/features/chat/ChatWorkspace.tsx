"use client";

/*
 * Hallmark - pre-emit critique: P4 H4 E4 S5 R4 V4
 * genre: modern-minimal; macrostructure: workbench; contrast/mobile: pass.
 */
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import {
  BedDouble,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  CloudSun,
  Copy,
  ExternalLink,
  Info,
  LoaderCircle,
  MapPin,
  Navigation,
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
import { Dialog } from "radix-ui";
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

import { Button } from "@/components/ui/button";
import { InputGroup } from "@/components/ui/input-group";
import { InputGroupAddon } from "@/components/ui/input-group-addon";
import { InputGroupButton } from "@/components/ui/input-group-button";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import {
  type AnswerArrivalMotionActivation,
  consumeAnswerArrivalMotionActivation,
  createAnswerArrivalMotionActivation,
} from "@/features/chat/answer-arrival-motion";
import {
  type AssistantInlineToken,
  type AssistantMarkdownBlock,
  type AssistantMarkdownTableAlignment,
  parseAssistantInlineTokens,
  parseAssistantMarkdownBlocks,
  projectAssistantTableToMobileCards,
} from "@/features/chat/assistant-message-presentation";
import {
  type DecisionStripSummary,
  projectDecisionStrip,
} from "@/features/chat/decision-strip-presentation";
import {
  formatEvidenceSourceTime,
  projectConditionEvidencePresentation,
  projectSourceEvidencePresentation,
  sourceEvidenceDetailLines,
  sourceEvidenceDisplayName,
  sourceEvidenceSummaryText,
} from "@/features/chat/evidence-presentation-state";
import {
  type LiveConditionDecision,
  projectSurfConditionDecision,
  projectWeatherConditionDecision,
  type SurfConditionSnapshot,
  type WeatherConditionSnapshot,
} from "@/features/chat/live-condition-decision";
import {
  type LocationSharingScope,
  type LocationSharingState,
  locationGeolocationForRequest,
  locationSharingReducer,
  locationStateLabel,
  shouldCaptureLocationForPrompt,
} from "@/features/chat/location-sharing-state";
import {
  authenticatedTripContextPatch,
  projectMobileTripContextSummary,
} from "@/features/chat/mobile-trip-context-presentation";
import {
  createResponseWaitRequest,
  invalidateResponseWaitRequest,
  isCurrentResponseWaitRequest,
  isResponseWaitAbort,
  PendingAssistantWaitState,
  type ResponseWaitRequest,
  responseStoppedStatusText,
  responseWaitStatusText,
  settleResponseWaitRequest,
  stopResponseWaitRequest,
} from "@/features/chat/response-wait-state";
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
import { buildSuggestedPrompts } from "@/features/chat/suggested-prompts";
import {
  defaultTripContextDraft as defaultTripContext,
  type ForecastLocationLabel,
  forecastLocationLabels,
  getTripContextServerSnapshot,
  getTripContextSnapshot,
  normalizeTripContextDraft,
  readStoredTripContextForRequest,
  subscribeTripContextState,
  type TripContextDraft,
  writeStoredTripContext,
} from "@/features/chat/trip-context-draft";
import {
  hasTripContext,
  projectTripState,
  type TripDataSource,
  type TripProfileResponse,
  tripContextFacts as tripContextDisplayFacts,
} from "@/features/chat/trip-state";
import { cn } from "@/lib/utils";
import { BrandLockup, PalmMark } from "@/ui/components/ask-siargao";

type ChatContextIcon = typeof MapPin;
type WeatherPanelSnapshot = WeatherConditionSnapshot;
type WeatherPanelResponse = {
  requestedLocation: ForecastLocationLabel;
  weather: WeatherPanelSnapshot;
};
type SurfPanelSnapshot = SurfConditionSnapshot;
type SurfPanelResponse = {
  requestedLocation: ForecastLocationLabel;
  surf: SurfPanelSnapshot;
};
type TripProfileFetchResult =
  | { source: "anonymous" }
  | { source: "authenticated"; profile: TripProfileResponse };
type SavedTripPresentationStatus = "loading" | "ready" | "error";

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
const conditionSourceTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
  timeZoneName: "short",
});

type InteractiveChatMessage = {
  id: string;
  messageId?: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status?: "pending" | "complete" | "error" | "stopped";
  rating?: ChatResponseRatingValue | null;
  ratingStatus?: "saving";
  retryPrompt?: string;
  cards?: readonly RecommendationCardArtifact[];
  actions?: readonly ChatActionArtifact[];
  itineraries?: readonly ItineraryPlanArtifact[];
  decisionSummaries?: readonly DecisionSummaryArtifact[];
  sources?: readonly ChatSourceArtifact[];
  answerArrivalMotion?: AnswerArrivalMotionActivation;
};

type ChatActionArtifact = {
  id: string;
  label: string;
  type?: "link" | "prompt" | "navigation";
  href?: string;
  prompt?: string;
};

type DecisionSummaryArtifact = DecisionStripSummary;
type SavedPlanShareStatus = "idle" | "syncing" | "creating" | "ready" | "error";
type SavedPlanCopyStatus = "idle" | "copied" | "error";
type SavedPlanShareState = {
  excludedShareItemIds: ReadonlySet<string>;
  shareStatus: SavedPlanShareStatus;
  shareUrl: string | null;
  copyStatus: SavedPlanCopyStatus;
};
type PendingChatSubmission = {
  controller: AbortController;
  generation: number;
};
type ActiveThreadLoad = {
  controller: AbortController;
  generation: number;
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
  locationState: LocationSharingState;
  onInputValueChange: (value: string) => void;
  onRequestLocation: (scope: LocationSharingScope) => void;
  onTurnOffLocation: () => void;
  onSubmitPrompt: (prompt: string) => void;
};

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
  locationState: LocationSharingState;
  messages: InteractiveChatMessage[];
  openChatThread: (threadId: string) => Promise<void>;
  archiveSelectedThread: () => Promise<void>;
  deleteSelectedThread: () => Promise<void>;
  rateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => Promise<void>;
  removeSavedItem: (itemId: string) => void;
  renameSelectedThread: () => Promise<void>;
  requestLocation: (scope: LocationSharingScope) => void;
  saveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  saveRecommendationCard: (card: RecommendationCardArtifact) => void;
  savedItemIds: ReadonlySet<string>;
  savedPlanSharing: ReturnType<typeof useSavedPlanSharing>;
  savedTripState: SavedTripState;
  savedTripStatus: SavedTripPresentationStatus;
  selectedThreadId: string | null;
  setInputValue: (value: string) => void;
  startNewChat: () => void;
  stopWaitingForAssistant: (assistantMessageId: string) => void;
  turnOffLocation: () => void;
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
  updateTripContext: (context: TripContextDraft) => Promise<void>;
};

function useChatWorkspaceController(initialPrompt: string): ChatWorkspaceController {
  const [inputValue, setInputValue] = useState(() => initialPrompt.trim());
  const [isSending, setIsSending] = useState(false);
  const [locationState, setLocationState] = useState<LocationSharingState>({ status: "off" });
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "error">("idle");
  const localTripContext = useSyncExternalStore(
    subscribeTripContextState,
    getTripContextSnapshot,
    getTripContextServerSnapshot,
  );
  const {
    data: profileResult,
    error: profileError,
    isLoading: profileLoading,
    mutate: mutateProfile,
  } = useSWR<TripProfileFetchResult>("/api/me/profile", fetchTripProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const tripDataSource: TripDataSource = profileLoading
    ? "loading"
    : profileError
      ? "error"
      : (profileResult?.source ?? "loading");
  const tripContext = projectTripState({
    localContext: localTripContext,
    profile: profileResult?.source === "authenticated" ? profileResult.profile : undefined,
    profileStatus: tripDataSource,
  }).context;
  const localSavedTripState = useSyncExternalStore(
    subscribeSavedTripState,
    getSavedTripSnapshot,
    getSavedTripServerSnapshot,
  );
  const {
    data: authenticatedSavedTrip,
    error: authenticatedSavedTripError,
    mutate: refreshAuthenticatedSavedTrip,
  } = useSWR(
    tripDataSource === "authenticated" ? "/api/trips/saved" : null,
    fetchAuthenticatedSavedTrip,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const { savedTripState, savedTripStatus } = useMemo(() => {
    const emptyState = { ...localSavedTripState, items: [] };
    if (tripDataSource === "anonymous") {
      return { savedTripState: localSavedTripState, savedTripStatus: "ready" as const };
    }
    if (tripDataSource === "authenticated") {
      if (authenticatedSavedTripError) {
        return { savedTripState: emptyState, savedTripStatus: "error" as const };
      }
      if (!authenticatedSavedTrip) {
        return { savedTripState: emptyState, savedTripStatus: "loading" as const };
      }
      return {
        savedTripState: {
          tripId: authenticatedSavedTrip.tripId ?? localSavedTripState.tripId,
          items: authenticatedSavedTrip.items ?? [],
          updatedAt: localSavedTripState.updatedAt,
        },
        savedTripStatus: "ready" as const,
      };
    }
    return {
      savedTripState: emptyState,
      savedTripStatus: tripDataSource === "error" ? ("error" as const) : ("loading" as const),
    };
  }, [authenticatedSavedTrip, authenticatedSavedTripError, localSavedTripState, tripDataSource]);
  const savedItemIds = useMemo(
    () => new Set(savedTripState.items.map((item) => item.id)),
    [savedTripState],
  );
  const savedPlanSharing = useSavedPlanSharing(savedTripState);
  const { trigger: syncAuthenticatedSavedTripItems } = useSWRMutation(
    "/api/trips/saved",
    syncSavedTripItemsMutation,
  );
  const hasSyncedAuthenticatedSavedTrip = useRef(false);
  const activeResponseRequestRef = useRef<ResponseWaitRequest | null>(null);
  const activeLocationCaptureRef = useRef<{
    controller: AbortController;
    requestId: number;
  } | null>(null);
  const locationCaptureRequestIdRef = useRef(0);
  const pendingChatSubmissionRef = useRef<PendingChatSubmission | null>(null);
  const chatSubmissionGenerationRef = useRef(0);
  const activeThreadLoadRef = useRef<ActiveThreadLoad | null>(null);
  const threadLoadGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const dispatchLocationState = useCallback(
    (action: Parameters<typeof locationSharingReducer>[1]) => {
      setLocationState((currentState) => locationSharingReducer(currentState, action));
    },
    [],
  );

  const invalidateActiveResponseRequest = useCallback(() => {
    activeResponseRequestRef.current = invalidateResponseWaitRequest(
      activeResponseRequestRef.current,
    );
    setIsSending(false);
  }, []);

  const invalidatePendingChatSubmission = useCallback(() => {
    chatSubmissionGenerationRef.current += 1;
    pendingChatSubmissionRef.current?.controller.abort();
    pendingChatSubmissionRef.current = null;
    activeLocationCaptureRef.current?.controller.abort();
    activeLocationCaptureRef.current = null;
    setLocationState((currentState) =>
      currentState.status === "requesting" ? { status: "off" } : currentState,
    );
    setIsSending(false);
  }, []);

  const invalidateActiveThreadLoad = useCallback(() => {
    threadLoadGenerationRef.current += 1;
    activeThreadLoadRef.current?.controller.abort();
    activeThreadLoadRef.current = null;
  }, []);

  const stopActiveResponseForThreadSwitch = useCallback(() => {
    invalidatePendingChatSubmission();
    const activeRequest = activeResponseRequestRef.current;
    if (!activeRequest) {
      return;
    }

    activeResponseRequestRef.current = stopResponseWaitRequest(
      activeRequest,
      activeRequest.requestId,
    );
    setIsSending(false);
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === activeRequest.assistantMessageId && message.status === "pending"
          ? {
              ...message,
              text: responseStoppedStatusText,
              timestamp: formatTimestamp(),
              status: "stopped",
              retryPrompt: activeRequest.prompt,
            }
          : message,
      ),
    );
  }, [invalidatePendingChatSubmission]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      chatSubmissionGenerationRef.current += 1;
      pendingChatSubmissionRef.current?.controller.abort();
      pendingChatSubmissionRef.current = null;
      activeLocationCaptureRef.current?.controller.abort();
      activeLocationCaptureRef.current = null;
      threadLoadGenerationRef.current += 1;
      activeThreadLoadRef.current?.controller.abort();
      activeThreadLoadRef.current = null;
      activeResponseRequestRef.current = invalidateResponseWaitRequest(
        activeResponseRequestRef.current,
      );
    };
  }, []);

  useEffect(() => {
    if (
      tripDataSource !== "authenticated" ||
      !authenticatedSavedTrip ||
      hasSyncedAuthenticatedSavedTrip.current
    ) {
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
  }, [
    authenticatedSavedTrip,
    refreshAuthenticatedSavedTrip,
    syncAuthenticatedSavedTripItems,
    tripDataSource,
  ]);

  const refreshChatThreads = useCallback(async () => {
    if (tripDataSource !== "authenticated") {
      setChatThreads([]);
      setHistoryStatus(tripDataSource === "error" ? "error" : "idle");
      return;
    }

    setHistoryStatus("loading");
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
  }, [tripDataSource]);

  useEffect(() => {
    void refreshChatThreads();
  }, [refreshChatThreads]);

  const openChatThread = useCallback(
    async (threadId: string) => {
      stopActiveResponseForThreadSwitch();
      activeThreadLoadRef.current?.controller.abort();
      const generation = threadLoadGenerationRef.current + 1;
      threadLoadGenerationRef.current = generation;
      const controller = new AbortController();
      activeThreadLoadRef.current = { controller, generation };
      setHistoryStatus("loading");

      const isCurrentThreadLoad = () =>
        mountedRef.current &&
        !controller.signal.aborted &&
        activeThreadLoadRef.current?.generation === generation;

      try {
        const response = await fetch(`/api/chat/threads/${threadId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!isCurrentThreadLoad()) {
          return;
        }
        if (!response.ok) {
          setHistoryStatus("error");
          return;
        }

        const body = (await response.json()) as {
          messages?: ChatThreadDetailMessage[];
          thread?: ChatThreadSummary;
        };
        if (!isCurrentThreadLoad()) {
          return;
        }
        setSelectedThreadId(threadId);
        setMessages((body.messages ?? []).map(interactiveMessageFromThreadMessage));
        setHistoryStatus("idle");
      } catch (error) {
        if (!isCurrentThreadLoad() || isResponseWaitAbort(error)) {
          return;
        }
        setHistoryStatus("error");
      } finally {
        if (activeThreadLoadRef.current?.generation === generation) {
          activeThreadLoadRef.current = null;
        }
      }
    },
    [stopActiveResponseForThreadSwitch],
  );

  const startNewChat = useCallback(() => {
    invalidatePendingChatSubmission();
    invalidateActiveResponseRequest();
    invalidateActiveThreadLoad();
    setSelectedThreadId(null);
    setMessages([]);
    setInputValue("");
    setHistoryStatus("idle");
  }, [
    invalidateActiveResponseRequest,
    invalidateActiveThreadLoad,
    invalidatePendingChatSubmission,
  ]);

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
      consentScope: LocationSharingScope = "single_request",
      ownerSignal?: AbortSignal,
    ): Promise<LocationSharingState | null> => {
      if (activeLocationCaptureRef.current) {
        return null;
      }
      const controller = new AbortController();
      const requestId = locationCaptureRequestIdRef.current + 1;
      locationCaptureRequestIdRef.current = requestId;
      activeLocationCaptureRef.current = { controller, requestId };

      return new Promise<LocationSharingState | null>((resolve) => {
        let settled = false;
        const finish = (nextState: LocationSharingState | null) => {
          if (settled) {
            return;
          }
          settled = true;
          controller.signal.removeEventListener("abort", handleAbort);
          ownerSignal?.removeEventListener("abort", handleOwnerAbort);
          if (activeLocationCaptureRef.current?.requestId === requestId) {
            activeLocationCaptureRef.current = null;
          }
          resolve(nextState);
        };
        const handleAbort = () => finish(null);
        const handleOwnerAbort = () => controller.abort();

        controller.signal.addEventListener("abort", handleAbort, { once: true });
        if (ownerSignal) {
          if (ownerSignal.aborted) {
            handleOwnerAbort();
            return;
          }
          ownerSignal.addEventListener("abort", handleOwnerAbort, { once: true });
        }

        if (!mountedRef.current) {
          finish(null);
          return;
        }

        dispatchLocationState({ type: "request", requestId, scope: consentScope });

        if (!("geolocation" in navigator)) {
          const nextState = {
            status: "unavailable",
            reason: "unsupported",
          } satisfies LocationSharingState;
          dispatchLocationState({ type: "fail", requestId, reason: "unsupported" });
          finish(nextState);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (
              controller.signal.aborted ||
              !mountedRef.current ||
              activeLocationCaptureRef.current?.requestId !== requestId
            ) {
              finish(null);
              return;
            }
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
              scope: consentScope,
            } satisfies LocationSharingState;
            dispatchLocationState({
              type: "resolve",
              requestId,
              geolocation: nextState.geolocation,
            });
            finish(nextState);
          },
          (error) => {
            if (
              controller.signal.aborted ||
              !mountedRef.current ||
              activeLocationCaptureRef.current?.requestId !== requestId
            ) {
              finish(null);
              return;
            }
            if (error.code === error.PERMISSION_DENIED) {
              const nextState = { status: "blocked" } satisfies LocationSharingState;
              dispatchLocationState({ type: "deny", requestId });
              finish(nextState);
              return;
            }
            const reason = error.code === error.TIMEOUT ? "timeout" : "position_unavailable";
            const nextState = {
              status: "unavailable",
              reason,
            } satisfies LocationSharingState;
            dispatchLocationState({ type: "fail", requestId, reason });
            finish(nextState);
          },
          {
            enableHighAccuracy: true,
            maximumAge: 60_000,
            timeout: 10_000,
          },
        );
      });
    },
    [dispatchLocationState],
  );

  const requestLocation = useCallback(
    (scope: LocationSharingScope) => {
      void captureLocation(scope);
    },
    [captureLocation],
  );

  const turnOffLocation = useCallback(() => {
    activeLocationCaptureRef.current?.controller.abort();
    activeLocationCaptureRef.current = null;
    dispatchLocationState({ type: "turn_off" });
  }, [dispatchLocationState]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || isSending) {
        return;
      }

      const submission = {
        controller: new AbortController(),
        generation: chatSubmissionGenerationRef.current + 1,
      } satisfies PendingChatSubmission;
      chatSubmissionGenerationRef.current = submission.generation;
      pendingChatSubmissionRef.current = submission;
      setIsSending(true);
      let requestLocationState = locationState;
      if (shouldCaptureLocationForPrompt(trimmedPrompt, locationState)) {
        requestLocationState =
          (await captureLocation("single_request", submission.controller.signal)) ?? locationState;
        if (
          !mountedRef.current ||
          submission.controller.signal.aborted ||
          pendingChatSubmissionRef.current?.generation !== submission.generation
        ) {
          return;
        }
      }

      if (
        !mountedRef.current ||
        submission.controller.signal.aborted ||
        pendingChatSubmissionRef.current?.generation !== submission.generation
      ) {
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
      const responseRequest = createResponseWaitRequest({
        assistantMessageId: pendingAssistantId,
        prompt: trimmedPrompt,
      });
      const pendingAssistant: InteractiveChatMessage = {
        id: pendingAssistantId,
        role: "assistant",
        text: responseWaitStatusText,
        timestamp,
        status: "pending",
      };
      const requestMessages = buildChatRequestMessages(messages, trimmedPrompt);
      const requestBody = buildChatRequestBody(
        requestMessages,
        requestLocationState,
        selectedThreadId,
        tripDataSource,
      );

      activeResponseRequestRef.current = responseRequest;
      setInputValue("");
      setMessages((currentMessages) => [...currentMessages, userMessage, pendingAssistant]);
      if (requestBody.clientContext?.geolocation?.consentScope === "single_request") {
        dispatchLocationState({ type: "consume_request" });
      }

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: responseRequest.controller.signal,
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

        if (
          !mountedRef.current ||
          !isCurrentResponseWaitRequest(activeResponseRequestRef.current, responseRequest.requestId)
        ) {
          return;
        }

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
                  answerArrivalMotion: createAnswerArrivalMotionActivation({
                    messageId: pendingAssistantId,
                    previousStatus: message.status,
                    nextStatus: "complete",
                    hasDecisionStrip: Boolean(projectDecisionStrip(body.decisionSummaries)),
                  }),
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
      } catch (error) {
        if (
          !mountedRef.current ||
          !isCurrentResponseWaitRequest(
            activeResponseRequestRef.current,
            responseRequest.requestId,
          ) ||
          isResponseWaitAbort(error)
        ) {
          return;
        }

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  answerArrivalMotion: undefined,
                  text: chatErrorMessage,
                  timestamp: formatTimestamp(),
                  status: "error",
                  retryPrompt: trimmedPrompt,
                }
              : message,
          ),
        );
      } finally {
        if (
          isCurrentResponseWaitRequest(activeResponseRequestRef.current, responseRequest.requestId)
        ) {
          activeResponseRequestRef.current = settleResponseWaitRequest(
            activeResponseRequestRef.current,
            responseRequest.requestId,
          );
          if (mountedRef.current) {
            setIsSending(false);
          }
        }
        if (pendingChatSubmissionRef.current?.generation === submission.generation) {
          pendingChatSubmissionRef.current = null;
        }
      }
    },
    [
      captureLocation,
      dispatchLocationState,
      isSending,
      locationState,
      messages,
      refreshChatThreads,
      selectedThreadId,
      tripDataSource,
    ],
  );

  const stopWaitingForAssistant = useCallback(
    (assistantMessageId: string) => {
      invalidatePendingChatSubmission();
      const activeRequest = activeResponseRequestRef.current;
      if (!activeRequest || activeRequest.assistantMessageId !== assistantMessageId) {
        return;
      }

      activeResponseRequestRef.current = stopResponseWaitRequest(
        activeRequest,
        activeRequest.requestId,
      );
      setIsSending(false);
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId && message.status === "pending"
            ? {
                ...message,
                answerArrivalMotion: undefined,
                text: responseStoppedStatusText,
                timestamp: formatTimestamp(),
                status: "stopped",
                retryPrompt: activeRequest.prompt,
              }
            : message,
        ),
      );
    },
    [invalidatePendingChatSubmission],
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

  async function updateTripContext(context: TripContextDraft) {
    const nextContext = normalizeTripContextDraft(context);
    if (tripDataSource === "anonymous") {
      writeStoredTripContext(nextContext);
      return;
    }

    if (tripDataSource !== "authenticated") {
      throw new Error("trip_context_source_unavailable");
    }

    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripContext: authenticatedTripContextPatch(
          profileResult?.source === "authenticated" ? profileResult.profile : undefined,
          nextContext,
        ),
      }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 400 ? "trip_context_validation_failed" : "trip_context_save_failed",
      );
    }

    const profile = (await response.json()) as TripProfileResponse;
    await mutateProfile({ source: "authenticated", profile }, { revalidate: false });
  }

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
    savedTripStatus,
    selectedThreadId,
    setInputValue,
    startNewChat,
    stopWaitingForAssistant,
    turnOffLocation,
    tripContext,
    tripDataSource,
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
  savedTripStatus,
  selectedThreadId,
  setInputValue,
  startNewChat,
  stopWaitingForAssistant,
  turnOffLocation,
  tripContext,
  tripDataSource,
  updateTripContext,
}: ChatWorkspaceController) {
  const hasMessages = messages.length > 0;
  const showMobileTripContext = useMobileTripContextViewport();
  const liveConditions = useLiveConditions(locationState, tripContext);
  const suggestedPrompts = useMemo(
    () =>
      buildSuggestedPrompts({
        context: tripContext,
        surfDecision: liveConditions.surfDecision,
        weatherDecision: liveConditions.weatherDecision,
      }),
    [liveConditions.surfDecision, liveConditions.weatherDecision, tripContext],
  );
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
      className="fixed inset-0 h-dvh overflow-hidden bg-brand-lavender-50 text-text-strong"
    >
      <section className="grid h-full min-h-0 w-full grid-cols-1 min-[1180px]:grid-cols-[15rem_minmax(0,1fr)_18rem] xl:grid-cols-[17rem_minmax(0,1fr)_20rem] 2xl:grid-cols-[19.5rem_minmax(0,1fr)_22.5rem]">
        <ChatTravelRail
          historyStatus={historyStatus}
          onOpenThread={(threadId) => {
            void openChatThread(threadId);
          }}
          onStartNewChat={startNewChat}
          savedItemCount={savedTripState.items.length}
          savedTripStatus={savedTripStatus}
          selectedThreadId={selectedThreadId}
          threads={chatThreads}
          tripContext={tripContext}
          tripDataSource={tripDataSource}
        />

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-border-default border-x bg-surface-default">
          <ChatTopBar
            canSharePlan={savedPlanSharing.selectedShareItems.length > 0}
            mobileTripContext={
              showMobileTripContext ? (
                <MobileTripContextDisclosure
                  liveConditions={liveConditions}
                  locationState={locationState}
                  onUpdateTripContext={updateTripContext}
                  tripContext={tripContext}
                  tripDataSource={tripDataSource}
                />
              ) : null
            }
            onSharePlan={() => {
              void savedPlanSharing.createShareLink();
            }}
            onStartNewChat={startNewChat}
          />

          <section
            aria-label="Chat message scroll area"
            className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 lg:px-8"
            data-testid="chat-message-scroll-area"
            ref={chatScrollAreaRef}
          >
            <div className="mx-auto grid min-h-full max-w-5xl content-start gap-4 pb-6">
              {savedTripStatus === "loading" ? (
                <p
                  className="m-0 text-sm font-bold text-text-muted"
                  data-testid="saved-trip-status"
                >
                  Loading your saved planning.
                </p>
              ) : null}
              {savedTripStatus === "error" ? (
                <p
                  className="m-0 text-sm font-bold text-text-alert"
                  data-testid="saved-trip-status"
                >
                  Saved planning is unavailable right now. Try refreshing.
                </p>
              ) : null}
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
                        onStopWaiting={stopWaitingForAssistant}
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
            onTurnOffLocation={turnOffLocation}
            onSubmitPrompt={handlePromptSubmit}
          />
        </section>

        <ChatContextRail
          liveConditions={liveConditions}
          locationState={locationState}
          tripContext={tripContext}
          tripDataSource={tripDataSource}
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
  savedTripStatus,
  selectedThreadId,
  threads,
  tripContext,
  tripDataSource,
}: {
  historyStatus: "idle" | "loading" | "error";
  onOpenThread: (threadId: string) => void;
  onStartNewChat: () => void;
  savedItemCount: number;
  savedTripStatus: SavedTripPresentationStatus;
  selectedThreadId: string | null;
  threads: ChatThreadSummary[];
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
}) {
  const hasThreads = threads.length > 0;
  const hasContext = hasTripContext(tripContext);

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
            <h2 className="m-0 min-w-0 text-sm font-black text-white">
              {tripDataSource === "loading"
                ? "Loading your trip"
                : tripDataSource === "error"
                  ? "Trip details unavailable"
                  : hasContext
                    ? "Your trip details"
                    : "No trip details yet"}
            </h2>
            <p className="m-0 text-sm font-bold text-text-on-dark-muted">
              {tripDataSource === "loading"
                ? "Checking your saved details."
                : tripDataSource === "error"
                  ? "Try refreshing before adding details."
                  : hasContext
                    ? tripContext.dateRange || tripContext.accommodation || tripContext.travelerType
                    : "Add details when they will help your question."}
            </p>
          </div>
        </section>

        <section className="grid gap-3">
          <p className="m-0 text-xs font-black tracking-[0.08em] text-text-on-dark-muted uppercase">
            Saved planning
          </p>
          <div className="grid gap-3">
            {savedTripStatus === "loading" ? (
              <p className="m-0 text-sm font-bold text-text-on-dark-muted">
                Loading saved planning.
              </p>
            ) : savedTripStatus === "error" ? (
              <p className="m-0 text-sm font-bold text-text-alert">Saved planning unavailable.</p>
            ) : savedItemCount > 0 ? (
              <p className="m-0 text-sm font-bold text-text-on-dark-muted">
                {savedItemCount} {savedItemCount === 1 ? "item" : "items"} saved for this trip.
              </p>
            ) : (
              <p className="m-0 text-sm font-bold text-text-on-dark-muted">
                No places or plans saved yet.
              </p>
            )}
          </div>
          <Link
            className="inline-flex w-fit items-center gap-2 text-sm font-extrabold text-white no-underline hover:text-brand-lagoon-300"
            href="/settings"
          >
            View saved planning
            <ChevronDown aria-hidden="true" className="-rotate-90" size={15} />
          </Link>
        </section>

        <section className="grid gap-3 border-white/12 border-t pt-5">
          <h2 className="m-0 text-xs font-black tracking-[0.08em] text-text-on-dark-muted uppercase">
            Recent questions
          </h2>
          {historyStatus === "error" ? (
            <p className="m-0 text-xs font-bold text-text-alert">Chat history unavailable</p>
          ) : null}
          {historyStatus === "loading" ? (
            <p className="m-0 text-xs font-bold text-text-on-dark-muted">Loading your chats</p>
          ) : null}
          <nav aria-label="Previous chats">
            <div className="grid gap-3">
              {hasThreads ? (
                threads.slice(0, 4).map((thread) => (
                  <button
                    className={cn(
                      "grid min-w-0 gap-1 rounded-md border border-transparent p-0 text-left",
                      "text-sm transition-[color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                      thread.id === selectedThreadId
                        ? "text-brand-lagoon-300"
                        : "text-white hover:text-brand-lagoon-300",
                    )}
                    key={thread.id}
                    onClick={() => onOpenThread(thread.id)}
                    type="button"
                  >
                    <span className="min-w-0 truncate font-extrabold">{thread.title}</span>
                    <span className="text-xs font-bold text-text-on-dark-muted">
                      {formatThreadRecency(thread)}
                    </span>
                  </button>
                ))
              ) : (
                <p className="m-0 text-sm font-bold text-text-on-dark-muted">
                  Start a question to build your chat history.
                </p>
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
  mobileTripContext,
  onSharePlan,
  onStartNewChat,
}: {
  canSharePlan: boolean;
  mobileTripContext: ReactNode;
  onSharePlan: () => void;
  onStartNewChat: () => void;
}) {
  return (
    <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-border-default border-b bg-surface-glass px-4 py-3 sm:px-6 lg:px-8">
      <div className="grid min-w-0 gap-1">
        <h1 className="m-0 min-w-0 truncate text-xl font-black text-text-strong sm:text-2xl">
          Ask Siargao
        </h1>
        <p className="m-0 inline-flex min-w-0 items-center gap-2 text-sm font-extrabold text-text-muted">
          <span className="size-2 shrink-0 rounded-full bg-brand-lagoon-500" />
          Local travel assistant
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          aria-label="Reset chat"
          className="size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
          onClick={onStartNewChat}
          size="icon"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" size={17} />
        </Button>
        <Button
          aria-label="Share saved plan"
          className="size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100 disabled:opacity-45"
          disabled={!canSharePlan}
          onClick={onSharePlan}
          size="icon"
          type="button"
          variant="outline"
        >
          <Share2 aria-hidden="true" size={17} />
        </Button>
        <ChatSettingsLink />
        <ChatAuthActions />
      </div>
      {mobileTripContext ? <div className="basis-full min-w-0">{mobileTripContext}</div> : null}
    </header>
  );
}

type LiveConditionsController = {
  activeForecastLocation: ForecastLocationLabel;
  refreshSurf: () => void;
  refreshWeather: () => void;
  surfDecision: LiveConditionDecision;
  weatherDecision: LiveConditionDecision;
};

function useLiveConditions(
  locationState: LocationSharingState,
  tripContext: TripContextDraft,
): LiveConditionsController {
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
    isValidating: weatherRefreshing,
    mutate: refreshWeather,
  } = useSWR<WeatherPanelResponse>(weatherUrl, fetchWeatherPanel, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: surfData,
    error: surfError,
    isLoading: surfLoading,
    isValidating: surfRefreshing,
    mutate: refreshSurf,
  } = useSWR<SurfPanelResponse>(surfUrl, fetchSurfPanel, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  return {
    activeForecastLocation,
    refreshSurf: () => {
      void refreshSurf();
    },
    refreshWeather: () => {
      void refreshWeather();
    },
    surfDecision: projectSurfConditionDecision({
      locationName: activeForecastLocation,
      snapshot: surfData?.surf,
      isLoading: surfLoading,
      isRefreshing: surfRefreshing,
      hasError: Boolean(surfError),
    }),
    weatherDecision: projectWeatherConditionDecision({
      locationName: activeForecastLocation,
      snapshot: weatherData?.weather,
      isLoading: weatherLoading,
      isRefreshing: weatherRefreshing,
      hasError: Boolean(weatherError),
    }),
  };
}

type MobileTripContextEditState = {
  draft: TripContextDraft;
  isDirty: boolean;
  saveError: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
};

type MobileTripContextEditAction =
  | { type: "reset"; draft: TripContextDraft }
  | { type: "update"; draft: TripContextDraft }
  | { type: "saving" }
  | { type: "saved" }
  | { type: "error"; message: string };

function mobileTripContextEditReducer(
  state: MobileTripContextEditState,
  action: MobileTripContextEditAction,
): MobileTripContextEditState {
  switch (action.type) {
    case "reset":
      return { draft: action.draft, isDirty: false, saveError: null, saveState: "idle" };
    case "update":
      return { draft: action.draft, isDirty: true, saveError: null, saveState: "idle" };
    case "saving":
      return { ...state, saveError: null, saveState: "saving" };
    case "saved":
      return { ...state, isDirty: false, saveError: null, saveState: "saved" };
    case "error":
      return { ...state, saveError: action.message, saveState: "error" };
  }
}

function MobileTripContextDisclosure({
  liveConditions,
  locationState,
  onUpdateTripContext,
  tripContext,
  tripDataSource,
}: {
  liveConditions: LiveConditionsController;
  locationState: LocationSharingState;
  onUpdateTripContext: (context: TripContextDraft) => Promise<void>;
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editState, dispatchEdit] = useReducer(mobileTripContextEditReducer, {
    draft: tripContext,
    isDirty: false,
    saveError: null,
    saveState: "idle",
  });
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const editVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const summary = projectMobileTripContextSummary({ context: tripContext, source: tripDataSource });
  const canEdit = tripDataSource === "anonymous" || tripDataSource === "authenticated";
  const draft = editState.isDirty ? editState.draft : tripContext;

  const openSheet = useCallback(() => {
    dispatchEdit({ type: "reset", draft: tripContext });
    editVersionRef.current += 1;
    setIsOpen(true);
  }, [tripContext]);

  const updateDraft = useCallback((nextDraft: TripContextDraft) => {
    editVersionRef.current += 1;
    dispatchEdit({ type: "update", draft: nextDraft });
  }, []);

  const cancelEdit = useCallback(() => {
    editVersionRef.current += 1;
    dispatchEdit({ type: "reset", draft: tripContext });
  }, [tripContext]);

  async function save() {
    if (!canEdit || saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    const savedEditVersion = editVersionRef.current;
    dispatchEdit({ type: "saving" });
    try {
      await onUpdateTripContext(normalizeTripContextDraft(draft));
      if (editVersionRef.current !== savedEditVersion) {
        return;
      }
      dispatchEdit({ type: "saved" });
    } catch (error) {
      if (editVersionRef.current !== savedEditVersion) {
        return;
      }
      const message = error instanceof Error ? error.message : "trip_context_save_failed";
      dispatchEdit({
        type: "error",
        message:
          message === "trip_context_validation_failed"
            ? "Review the trip details and try again."
            : "Your edits are still here. Check your connection and try again.",
      });
    } finally {
      saveInFlightRef.current = false;
    }
  }

  const triggerLabel = summary.facts.length
    ? `${summary.actionLabel}: ${summary.facts.map((fact) => fact.value).join(", ")}`
    : summary.actionLabel;

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openSheet();
          return;
        }
        setIsOpen(false);
      }}
      open={isOpen}
    >
      <Dialog.Trigger asChild>
        <Button
          aria-label={triggerLabel}
          className="min-h-11 w-full min-w-0 justify-start gap-2 rounded-lg border-brand-violet-400/30 bg-brand-lavender-50 px-3 text-left text-text-strong hover:bg-brand-lavender-100 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
          data-testid="mobile-trip-context-trigger"
          type="button"
          variant="outline"
        >
          <MapPin aria-hidden="true" className="shrink-0 text-brand-violet-650" size={17} />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-xs leading-tight font-extrabold">{summary.actionLabel}</span>
            <span className="break-words text-[0.7rem] leading-tight font-bold text-text-muted">
              {summary.facts.length
                ? summary.facts.map((fact) => fact.value).join(" · ")
                : summary.state === "loading"
                  ? "Loading details"
                  : summary.state === "unavailable"
                    ? "Details unavailable"
                    : "No details yet"}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="shrink-0" size={16} />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-brand-navy-980/60"
          data-testid="mobile-trip-context-overlay"
        />
        <MobileTripContextSheet
          canEdit={canEdit}
          closeButtonRef={closeButtonRef}
          draft={draft}
          isDirty={editState.isDirty}
          liveConditions={liveConditions}
          locationState={locationState}
          onCancelEdit={cancelEdit}
          onSave={save}
          onUpdateDraft={updateDraft}
          saveError={editState.saveError}
          saveState={editState.saveState}
          tripContext={tripContext}
          tripDataSource={tripDataSource}
        />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MobileTripContextSheet({
  canEdit,
  closeButtonRef,
  draft,
  isDirty,
  liveConditions,
  locationState,
  onCancelEdit,
  onSave,
  onUpdateDraft,
  saveError,
  saveState,
  tripContext,
  tripDataSource,
}: {
  canEdit: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  draft: TripContextDraft;
  isDirty: boolean;
  liveConditions: LiveConditionsController;
  locationState: LocationSharingState;
  onCancelEdit: () => void;
  onSave: () => Promise<void>;
  onUpdateDraft: (draft: TripContextDraft) => void;
  saveError: string | null;
  saveState: MobileTripContextEditState["saveState"];
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
}) {
  return (
    <Dialog.Content
      className="fixed inset-x-0 bottom-0 z-50 m-0 max-h-[min(92dvh,52rem)] w-full max-w-none overflow-hidden rounded-t-2xl border border-border-default bg-surface-default p-0 text-text-strong shadow-night-card focus:outline-none"
      data-testid="mobile-trip-context-dialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }}
    >
      <section
        className="grid max-h-[min(92dvh,52rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        }}
      >
        <header className="flex items-start justify-between gap-4 px-4 pb-3">
          <div className="grid min-w-0 gap-1">
            <Dialog.Title className="m-0 text-lg font-black text-text-strong">
              Trip details and live conditions
            </Dialog.Title>
            <Dialog.Description className="m-0 text-sm font-bold text-text-muted">
              Review what Ask Siargao is using without leaving this conversation.
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <Button
              aria-label="Close trip details"
              className="size-11 shrink-0 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
              ref={closeButtonRef}
              size="icon"
              type="button"
              variant="outline"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Button>
          </Dialog.Close>
        </header>

        <div
          className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-4"
          data-testid="mobile-trip-context-scroll-area"
        >
          <div className="grid gap-5">
            {tripDataSource === "loading" ? (
              <p className="m-0 text-sm font-bold text-text-muted" data-testid="mobile-trip-state">
                Loading your trip details. Nothing from this browser is being used yet.
              </p>
            ) : tripDataSource === "error" ? (
              <p className="m-0 text-sm font-bold text-text-alert" data-testid="mobile-trip-state">
                Trip details could not be loaded. Refresh the conversation to try again.
              </p>
            ) : (
              <section className="grid gap-3" aria-labelledby="mobile-trip-fields-title">
                <div className="flex items-center justify-between gap-3">
                  <h3
                    className="m-0 text-sm font-black text-text-strong"
                    id="mobile-trip-fields-title"
                  >
                    Trip context
                  </h3>
                  {isDirty ? (
                    <span className="text-xs font-bold text-text-muted">Unsaved edits</span>
                  ) : null}
                </div>
                {hasTripContext(tripContext) ? (
                  <div
                    className="grid gap-2 rounded-lg border border-border-default bg-white p-3"
                    data-testid="mobile-trip-facts"
                  >
                    {tripContextDisplayFacts(tripContext).map((fact) => (
                      <ContextFact
                        icon={iconForTripContextLabel(fact.label)}
                        key={fact.label}
                        label={fact.label}
                        value={fact.value}
                      />
                    ))}
                  </div>
                ) : (
                  <p
                    className="m-0 text-sm font-bold text-text-muted"
                    data-testid="mobile-trip-state"
                  >
                    Add only the details you want Ask Siargao to use. Nothing is assumed.
                  </p>
                )}
                <TripContextEditor draft={draft} onDraftChange={onUpdateDraft} />
              </section>
            )}

            <section
              className="grid gap-2 rounded-lg border border-border-default bg-white p-3"
              data-testid="mobile-location-state"
            >
              <h3 className="m-0 text-sm font-black text-text-strong">Location sharing</h3>
              <p className="m-0 text-sm font-bold text-text-muted">
                {mobileLocationScopeLabel(locationState)}
              </p>
              <p className="m-0 text-xs font-bold text-text-muted">
                Opening this sheet never requests location. Trip area and browser location are
                separate, and precise coordinates are not shown here.
              </p>
            </section>

            <section
              className="grid gap-2 rounded-lg border border-border-default bg-white p-3"
              data-testid="mobile-pass-state"
            >
              <h3 className="m-0 text-sm font-black text-text-strong">Trip Pass</h3>
              <p className="m-0 text-sm font-bold text-text-muted">
                Trip Pass details are not connected here yet. No activation, balance, or expiry is
                assumed.
              </p>
            </section>

            <MobileConditionCard
              decision={liveConditions.weatherDecision}
              icon={<CloudSun aria-hidden="true" className="text-brand-violet-650" size={22} />}
              onRefresh={liveConditions.refreshWeather}
              title={`${liveConditions.activeForecastLocation} weather`}
            />
            <MobileConditionCard
              decision={liveConditions.surfDecision}
              icon={
                <WavesHorizontal aria-hidden="true" className="text-brand-violet-650" size={22} />
              }
              onRefresh={liveConditions.refreshSurf}
              title={`${liveConditions.activeForecastLocation} surf`}
            />
          </div>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-border-default border-t bg-surface-default px-4 pt-3">
          {canEdit ? (
            <>
              <Button
                className="h-11 rounded-md border-border-default bg-white px-4 text-sm font-extrabold text-text-muted hover:bg-brand-lavender-50 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
                disabled={saveState === "saving" || !isDirty}
                onClick={onCancelEdit}
                type="button"
                variant="outline"
              >
                Cancel edits
              </Button>
              <Button
                className="h-11 rounded-md bg-brand-violet-650 px-4 text-sm font-extrabold text-white hover:bg-brand-violet-600 focus-visible:ring-2 focus-visible:ring-brand-violet-650 disabled:opacity-55"
                disabled={saveState === "saving" || !isDirty}
                onClick={() => {
                  void onSave();
                }}
                type="button"
              >
                {saveState === "saving" ? "Saving…" : "Save trip details"}
              </Button>
            </>
          ) : (
            <Dialog.Close asChild>
              <Button
                className="h-11 rounded-md bg-brand-violet-650 px-4 text-sm font-extrabold text-white"
                type="button"
              >
                Done
              </Button>
            </Dialog.Close>
          )}
          <p aria-live="polite" className="basis-full m-0 text-sm font-bold text-text-muted">
            {saveState === "saved" ? "Trip details saved." : saveError}
          </p>
        </footer>
      </section>
    </Dialog.Content>
  );
}

function MobileConditionCard({
  decision,
  icon,
  onRefresh,
  title,
}: {
  decision: LiveConditionDecision;
  icon: ReactNode;
  onRefresh: () => void;
  title: string;
}) {
  return (
    <section
      className="grid gap-3 rounded-lg border border-border-default bg-white p-3"
      data-testid={`mobile-${decision.kind}-condition`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {icon}
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-black text-text-strong">{title}</h3>
            <p
              className="m-0 break-words text-base leading-tight font-black text-text-strong"
              data-testid={`mobile-${decision.kind}-condition-action`}
            >
              {decision.action}
            </p>
          </div>
        </div>
        <Button
          aria-label={`Refresh ${decision.kind} conditions`}
          className="size-11 shrink-0 rounded-md border-border-default bg-white text-brand-violet-650 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
          onClick={onRefresh}
          size="icon"
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </Button>
      </div>
      <p
        className="m-0 text-xs font-bold text-text-muted"
        data-testid={`mobile-${decision.kind}-condition-basis`}
      >
        {decision.basis}
      </p>
      <ConditionDecisionDetails decision={decision} />
    </section>
  );
}

function mobileLocationScopeLabel(locationState: LocationSharingState) {
  if (locationState.status === "ready") {
    return locationState.geolocation.consentScope === "trip_session"
      ? "Browser location is on for this in-memory trip session."
      : "Browser location is ready for the next question.";
  }
  if (locationState.status === "requesting") {
    return "Browser location permission is being requested.";
  }
  if (locationState.status === "blocked") {
    return "Browser location is blocked. You can still name an area or continue without it.";
  }
  if (locationState.status === "unavailable") {
    return "Browser location is unavailable in this browser.";
  }
  if (locationState.status === "used") {
    return "Browser location was used for the last question and is no longer kept.";
  }
  return "Browser location is off.";
}

function useMobileTripContextViewport() {
  return useSyncExternalStore(
    (notify) => {
      const mediaQuery = window.matchMedia("(max-width: 1179px)");
      mediaQuery.addEventListener("change", notify);
      return () => {
        mediaQuery.removeEventListener("change", notify);
      };
    },
    () => window.matchMedia("(max-width: 1179px)").matches,
    () => false,
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
        className="size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100 sm:hidden"
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
  liveConditions,
  locationState,
  onUpdateTripContext,
  tripContext,
  tripDataSource,
}: {
  liveConditions: LiveConditionsController;
  locationState: LocationSharingState;
  onUpdateTripContext: (context: TripContextDraft) => Promise<void>;
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TripContextDraft>(defaultTripContext);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const { activeForecastLocation, refreshSurf, refreshWeather, surfDecision, weatherDecision } =
    liveConditions;
  const tripContextItems = tripContextFacts({
    activeForecastLocation,
    locationState,
    tripContext,
  });

  const saveDraft = useCallback(async () => {
    if (saveState === "saving") {
      return;
    }

    setSaveError(null);
    setSaveState("saving");
    try {
      await onUpdateTripContext(normalizeTripContextDraft(draft));
      setIsEditing(false);
      setSaveState("idle");
    } catch (error) {
      setSaveState("idle");
      setSaveError(
        error instanceof Error && error.message === "trip_context_validation_failed"
          ? "Review the trip details and try again."
          : "Your changes are still here. Check your connection and try again.",
      );
    }
  }, [draft, onUpdateTripContext, saveState]);

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
                  setSaveError(null);
                  setSaveState("idle");
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="h-8 rounded-md bg-brand-violet-650 px-3 text-xs font-extrabold text-white hover:bg-brand-violet-600"
                disabled={saveState === "saving"}
                onClick={() => {
                  void saveDraft();
                }}
                size="sm"
                type="button"
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <Button
              className="h-8 rounded-md border-brand-violet-400/25 bg-brand-lavender-50 px-3 text-xs font-extrabold text-brand-violet-650 hover:bg-brand-lavender-100"
              onClick={() => {
                setDraft(tripContext);
                setIsEditing(true);
                setSaveError(null);
                setSaveState("idle");
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
          <div className="grid gap-3">
            <TripContextEditor draft={draft} onDraftChange={setDraft} />
            {saveState === "saving" ? (
              <p className="m-0 text-xs font-bold text-text-muted" role="status">
                Saving your trip details.
              </p>
            ) : saveError ? (
              <p className="m-0 text-xs font-bold text-text-alert" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            {tripDataSource === "loading" ? (
              <p className="m-0 text-xs font-bold text-text-muted">Loading your trip details.</p>
            ) : tripDataSource === "error" ? (
              <p className="m-0 text-xs font-bold text-text-alert">
                Trip details could not be loaded. Refresh to try again.
              </p>
            ) : (
              <>
                {!hasTripContext(tripContext) ? (
                  <p className="m-0 text-xs font-bold text-text-muted">
                    Add the details you want Ask Siargao to use. Nothing is assumed about your trip.
                  </p>
                ) : null}
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
              </>
            )}
          </div>
        )}
      </ContextCard>

      <ContextCard
        action={
          <Button
            aria-label="Refresh weather"
            className="size-8 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            onClick={() => {
              refreshWeather();
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
              <p
                className="m-0 text-xl font-black leading-tight text-text-strong"
                data-testid="weather-condition-action"
              >
                {weatherDecision.action}
              </p>
              <p
                className="m-0 text-xs font-bold text-text-muted"
                data-testid="weather-condition-basis"
              >
                {weatherDecision.basis}
              </p>
            </div>
          </div>
          <ConditionDecisionDetails decision={weatherDecision} />
        </div>
      </ContextCard>

      <ContextCard
        action={
          <Button
            aria-label="Refresh surf conditions"
            className="size-8 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
            onClick={() => {
              refreshSurf();
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
          </div>
          <p
            className="m-0 text-base font-black leading-tight text-text-strong"
            data-testid="surf-condition-action"
          >
            {surfDecision.action}
          </p>
          <p className="m-0 text-xs font-bold text-text-muted" data-testid="surf-condition-basis">
            {surfDecision.basis}
          </p>
          <ConditionDecisionDetails decision={surfDecision} />
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
          className="h-11 rounded-md border border-border-default bg-white px-3 text-sm font-black text-text-strong outline-none focus:border-brand-violet-650"
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
        className="h-11 rounded-md border border-border-default bg-white px-3 text-sm font-black text-text-strong outline-none focus:border-brand-violet-650"
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
  locationState: LocationSharingState;
  tripContext: TripContextDraft;
}): Array<{ icon: ChatContextIcon; label: string; value: string }> {
  return [
    ...tripContextDisplayFacts(tripContext).map((fact) => ({
      icon: iconForTripContextLabel(fact.label),
      label: fact.label,
      value: fact.value,
    })),
    { icon: CloudSun, label: "Forecast coverage", value: activeForecastLocation },
    { icon: Clock, label: "Location source", value: locationSourceLabel(locationState) },
  ];
}

function iconForTripContextLabel(label: string): ChatContextIcon {
  switch (label) {
    case "Accommodation":
      return BedDouble;
    case "Dates":
      return CalendarDays;
    case "Traveler type":
      return Users;
    default:
      return MapPin;
  }
}

function ConditionDecisionDetails({ decision }: { decision: LiveConditionDecision }) {
  const presentation = projectConditionEvidencePresentation(decision);
  return (
    <div className="grid gap-2">
      {decision.timing ? (
        <p
          className="m-0 text-xs font-black text-brand-violet-650"
          data-testid={`${decision.kind}-condition-timing`}
        >
          Planning cue: {decision.timing}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-1.5">
        {decision.supportingMetrics.map((item) => (
          <MetricTile key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
      <p
        className="m-0 text-xs font-extrabold text-text-default"
        data-testid={`${decision.kind}-condition-fallback`}
      >
        <span className="font-black text-text-strong">Fallback: </span>
        {decision.fallback}
      </p>
      <p
        className={cn(
          "m-0 inline-flex items-center gap-2 text-xs font-extrabold",
          presentation.state === "checked" ? "text-confidence-high" : "text-text-muted",
        )}
        data-testid={`${decision.kind}-condition-state`}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            presentation.state === "checked" ? "bg-confidence-high" : "bg-text-muted",
          )}
        />
        {presentation.label}
      </p>
      {decision.evidenceStatus ? (
        <p
          className="m-0 text-xs font-bold text-text-muted"
          data-testid={`${decision.kind}-condition-evidence`}
        >
          {presentation.summary}
          {decision.sourceTime ? (
            <>
              {" · Forecast time: "}
              <time dateTime={decision.sourceTime}>
                {formatConditionSourceTime(decision.sourceTime)}
              </time>
            </>
          ) : null}
        </p>
      ) : null}
      {decision.notChecked.length > 0 ? (
        <ul className="m-0 grid list-disc gap-1 pl-4 text-xs leading-[1.4] font-bold text-text-muted">
          {decision.notChecked.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatConditionSourceTime(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "unavailable"
    : conditionSourceTimeFormatter.format(timestamp);
}

async function fetchTripProfile(url: string): Promise<TripProfileFetchResult> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 401) {
    return { source: "anonymous" };
  }
  if (response.status === 404) {
    return { source: "authenticated", profile: {} };
  }
  if (!response.ok) {
    throw new Error("trip_profile_unavailable");
  }

  return {
    source: "authenticated",
    profile: (await response.json()) as TripProfileResponse,
  };
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
    {
      label: "Dapa" as const,
      distance: distanceKm(geolocation, { latitude: 9.759, longitude: 126.052 }),
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

function locationSourceLabel(locationState: LocationSharingState) {
  if (locationState.status === "ready") {
    return locationState.scope === "trip_session"
      ? "Browser location on for this trip"
      : "Browser location ready once";
  }
  if (locationState.status === "requesting") {
    return "Requesting browser location";
  }
  if (locationState.status === "blocked") {
    return "Browser location blocked";
  }
  if (locationState.status === "unavailable") {
    return "Browser location unavailable";
  }
  if (locationState.status === "used") {
    return "Browser location used once";
  }
  return "No browser location";
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
      <>
        <Button
          asChild
          className="hidden h-10 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50 sm:inline-flex"
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
      </>
    );
  }

  return (
    <Show fallback={chatSignedOutActions} when="signed-in">
      <UserButton
        appearance={clerkAppearance}
        fallback={
          <span className="inline-flex size-10 animate-pulse rounded-full border border-border-default bg-brand-lavender-100" />
        }
      />
    </Show>
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
  onStopWaiting,
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
  onStopWaiting: (assistantMessageId: string) => void;
  onSubmitPrompt: (prompt: string) => void;
  savedItemIds: ReadonlySet<string>;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";
  const isStopped = message.status === "stopped";

  if (isUser) {
    return (
      <article
        className="min-w-0 max-w-[min(88%,42rem)] justify-self-end overflow-hidden rounded-lg border border-brand-violet-400/25 bg-brand-violet-650 px-5 py-4 text-white shadow-violet-glow"
        data-testid="user-message-bubble"
      >
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.55] font-extrabold [overflow-wrap:anywhere] sm:text-base">
          {message.text}
        </p>
        <time className="mt-2 block text-right text-xs font-black text-white/75">
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
            : isStopped
              ? "min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-muted px-5 py-4 text-text-strong shadow-card"
              : "min-w-0 overflow-hidden rounded-xl border border-border-default bg-white px-4 py-4 text-text-strong shadow-card sm:px-5"
        }
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-4">
            {!isError && !isPending && message.decisionSummaries?.length ? (
              <DecisionStrip
                arrivalMotion={message.answerArrivalMotion}
                summaries={message.decisionSummaries}
              />
            ) : !isError && !isPending && !isStopped ? (
              <AssistantGlance message={message} />
            ) : null}
            {isPending ? (
              <PendingAssistantWaitState
                disabled={false}
                onStopWaiting={() => onStopWaiting(message.id)}
              />
            ) : (
              <AssistantMarkdownText text={message.text} tone={isError ? "error" : "default"} />
            )}
            {!isError && !isPending && !isStopped && message.itineraries?.length ? (
              <ItineraryPlans
                onRemoveSavedItem={onRemoveSavedItem}
                onSaveItineraryPlan={onSaveItineraryPlan}
                plans={message.itineraries}
                savedItemIds={savedItemIds}
              />
            ) : null}
            {!isError && !isPending && !isStopped && message.cards?.length ? (
              <RecommendationCards
                cards={message.cards}
                onRemoveSavedItem={onRemoveSavedItem}
                onSaveRecommendationCard={onSaveRecommendationCard}
                savedItemIds={savedItemIds}
              />
            ) : null}
            {!isError && !isPending && !isStopped && message.actions?.length ? (
              <ChatActionButtons
                actions={message.actions}
                disabled={disabled}
                onSubmitPrompt={onSubmitPrompt}
              />
            ) : null}
            {!isError && !isPending && !isStopped && message.sources?.length ? (
              <AssistantSourcesPanel sources={message.sources} />
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-extrabold">
          <time className={isError ? "text-text-alert" : "text-text-muted"}>
            {message.timestamp}
          </time>
          {!isError && !isPending && !isStopped && message.messageId ? (
            <AssistantRatingControls
              disabled={disabled || message.ratingStatus === "saving"}
              messageId={message.messageId}
              onRateAssistantMessage={onRateAssistantMessage}
              rating={message.rating ?? null}
              saving={message.ratingStatus === "saving"}
            />
          ) : null}
        </div>
        {(isError || isStopped) && message.retryPrompt ? (
          <Button
            className={
              isError
                ? "mt-4 h-9 rounded-md border-border-alert bg-surface-alert px-3 text-xs font-extrabold text-text-alert hover:bg-surface-alert"
                : "mt-4 h-9 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50"
            }
            disabled={disabled}
            onClick={() => onRetryPrompt(message.retryPrompt ?? "")}
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={13} />
            {isError ? "Retry last question" : "Retry question"}
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
  if (!primaryPlan && !primaryCard) {
    return null;
  }

  const sources = message.sources ?? primaryPlan?.sources ?? primaryCard?.sources ?? [];
  const items = [
    {
      icon: primaryPlan ? Navigation : Utensils,
      label: primaryPlan ? "Plan" : "Type",
      value: primaryPlan ? primaryPlan.title : primaryCard?.kind,
    },
    {
      icon: MapPin,
      label: "Area",
      value: primaryPlan ? itineraryPrimaryArea(primaryPlan) : cardAreaLabel(primaryCard),
    },
    {
      icon: Clock,
      label: "Timing",
      value: primaryPlan?.durationLabel ?? primaryCard?.openStatusLabel,
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
      className="grid min-w-0 gap-3 rounded-md border border-border-default bg-brand-lavender-50 p-3 shadow-none"
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

function DecisionStrip({
  arrivalMotion,
  summaries,
}: {
  arrivalMotion?: AnswerArrivalMotionActivation;
  summaries: readonly DecisionSummaryArtifact[];
}) {
  const presentation = projectDecisionStrip(summaries);
  const [isSequenceMotionActive, setIsSequenceMotionActive] = useState(() =>
    consumeAnswerArrivalMotionActivation(arrivalMotion, {
      reducedMotion: prefersReducedMotion(),
    }),
  );
  if (!presentation) {
    return null;
  }

  return (
    <section
      aria-label="Decision"
      className="relative grid min-w-0 gap-3 overflow-hidden rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-100 p-3 shadow-none"
      data-answer-arrival-motion={isSequenceMotionActive ? "decision-strip-sequence" : undefined}
      data-testid="decision-strip"
      onAnimationEnd={(event) => {
        if (
          event.animationName === "decision-strip-sequence-cue" &&
          event.target instanceof HTMLElement &&
          event.target.dataset.decisionSequenceCue === "true"
        ) {
          setIsSequenceMotionActive(false);
        }
      }}
    >
      <span
        aria-hidden="true"
        className="decision-strip-sequence-cue"
        data-decision-sequence-cue="true"
      />
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid min-w-0 gap-1">
          <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-[0.68rem] leading-tight font-black text-brand-lagoon-700 uppercase">
            <Navigation aria-hidden="true" className="shrink-0" size={13} />
            Best move
          </span>
          <h3 className="m-0 text-base leading-tight font-black break-words text-text-strong">
            {presentation.summary.bestAction}
          </h3>
        </div>
        {presentation.context.length ? (
          <dl className="m-0 grid min-w-0 gap-1.5 sm:grid-cols-2">
            {presentation.context.map((item) => (
              <div
                className="grid min-w-0 gap-0.5 rounded-md border border-brand-lagoon-700/15 bg-white px-2.5 py-2"
                key={item.label}
              >
                <dt className="text-[0.68rem] leading-tight font-black text-text-muted uppercase">
                  {item.label}
                </dt>
                <dd className="m-0 text-xs leading-[1.35] font-extrabold break-words text-text-strong">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <p className="m-0 text-sm leading-[1.45] font-bold break-words text-text-default">
        {presentation.summary.basis}
      </p>
      {presentation.guidance.length ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {presentation.guidance.map((item) => (
            <p
              className="m-0 rounded-md border border-border-default bg-white px-3 py-2 text-xs leading-[1.45] font-bold break-words text-text-muted"
              key={item.label}
            >
              <span className="font-black text-text-strong">{item.label}: </span>
              {item.value}
            </p>
          ))}
        </div>
      ) : null}
      {presentation.sourceStatus ? (
        <p
          className="m-0 min-w-0 rounded-md border border-brand-lagoon-700/15 bg-white px-3 py-2 text-xs leading-[1.45] font-bold break-words text-text-muted"
          data-testid="decision-strip-source-status"
        >
          <span className="font-black text-text-strong">{presentation.sourceStatus.label}: </span>
          {presentation.sourceStatus.value}
        </p>
      ) : null}
    </section>
  );
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
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
          <ItinerarySourceBadge key={chatSourceKey(source)} source={source} />
        ))}
      </div>
    </section>
  );
}

function ItinerarySourceBadge({ source }: { source: ChatSourceArtifact }) {
  const badge = sourceBadgeInfo(source);
  const Icon = badge.icon;
  const sourceName = itinerarySourceDisplayName(source);
  const label = sourceName ? `${sourceName} · ${badge.label}` : badge.label;

  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.72rem] leading-tight font-extrabold ${badge.className}`}
      data-testid="source-icon-badge"
    >
      <Icon aria-hidden="true" className="shrink-0" size={13} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

function itinerarySourceDisplayName(source: ChatSourceArtifact) {
  if (source.label === "curated_local_guide") {
    return "Local guide";
  }
  return "";
}

function sortItineraryStops(stops: readonly ItineraryStopArtifact[]) {
  return stops.toSorted((first, second) => first.sequence - second.sequence);
}

function formatItineraryStopSummary(stop: ItineraryStopArtifact) {
  return [stop.title, stop.area, stop.rationale].filter(Boolean).join(" - ");
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
  const presentations = sources.map(projectSourceEvidencePresentation);
  const checkedPresentation = presentations.find(
    (presentation) => presentation.state === "checked",
  );
  return checkedPresentation?.label ?? presentations[0]?.label ?? "Caveated";
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
  return sourceEvidenceSummaryText(sources);
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
  const presentation = projectSourceEvidencePresentation(source);
  const stateClassName = sourceBadgeStateClassName(presentation.state);
  const unresolvedIcon =
    presentation.state === "unavailable" || presentation.state === "not-verified" ? Info : null;

  if (unresolvedIcon) {
    return {
      icon: unresolvedIcon,
      label: presentation.label,
      className: stateClassName,
    };
  }

  if (source.label === "weather_checked") {
    return {
      icon: Clock,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "marine_checked" || source.label === "tide_forecast_checked") {
    return {
      icon: Navigation,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "event_checked") {
    return {
      icon: ShieldCheck,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "venue_checked") {
    return {
      icon: ShieldCheck,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "community_signal") {
    return {
      icon: Star,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "curated_local_guide") {
    return {
      icon: Star,
      label: presentation.label,
      className: stateClassName,
    };
  }
  if (source.label === "fresh_cache") {
    return {
      icon: ShieldCheck,
      label: presentation.label,
      className: stateClassName,
    };
  }

  return {
    icon: ShieldCheck,
    label: presentation.label,
    className: stateClassName,
  };
}

function sourceBadgeStateClassName(
  state: ReturnType<typeof projectSourceEvidencePresentation>["state"],
) {
  if (state === "checked") {
    return "border-brand-lagoon-700/15 bg-brand-lagoon-100 text-brand-lagoon-700";
  }
  if (state === "unavailable") {
    return "border-border-alert bg-surface-alert text-text-alert";
  }
  return "border-border-default bg-white text-text-muted";
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
      className="group rounded-md border border-border-default bg-brand-lavender-50 p-3"
      data-testid="assistant-sources-panel"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-sm font-black text-text-strong">
            <ShieldCheck aria-hidden="true" className="text-brand-lagoon-700" size={16} />
            Sources & Confidence
          </span>
          <span className="min-w-0 text-xs font-bold text-text-muted">
            {sourceSummaryText(visibleSources)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-white px-2.5 py-1.5 text-xs font-black text-text-muted">
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
            className="grid gap-1 rounded-md border border-border-default bg-white p-3"
            key={chatSourceKey(source)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceIconBadge source={source} />
              <span className="text-xs font-black text-text-strong">
                {sourceEvidenceDisplayName(source)}
              </span>
              {source.confidence ? (
                <span className="text-[0.7rem] font-bold text-text-muted">
                  {source.confidence} confidence
                </span>
              ) : null}
            </div>
            {sourceEvidenceDetailLines(source).map((line) => (
              <p className="m-0 text-xs leading-[1.45] text-text-muted" key={line}>
                {line}
              </p>
            ))}
            {source.fetchedAt ? (
              <p className="m-0 text-[0.7rem] font-bold text-text-muted">
                {formatEvidenceSourceTime(source.fetchedAt)}
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
    <div
      className="grid min-w-0 max-w-full flex-1 gap-3 overflow-hidden [overflow-wrap:anywhere]"
      data-testid="assistant-markdown"
    >
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
            <AssistantMarkdownTable
              block={block}
              key={block.key}
              linkClass={linkClass}
              strongClass={strongClass}
            />
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
  return (
    <>
      {parseAssistantInlineTokens(value).map((token) =>
        renderAssistantInlineToken(token, strongClass, linkClass),
      )}
    </>
  );
}

function AssistantMarkdownTable({
  block,
  linkClass,
  strongClass,
}: {
  block: Extract<AssistantMarkdownBlock, { type: "table" }>;
  linkClass: string;
  strongClass: string;
}) {
  return (
    <>
      <div
        className="hidden max-w-full overflow-x-auto rounded-md border border-border-default sm:block"
        data-testid="assistant-markdown-table"
      >
        <table className="w-full min-w-[560px] border-collapse bg-white text-sm text-text-default">
          <thead className="bg-brand-lavender-50 text-text-strong">
            <tr>
              {block.headers.map((header, index) => (
                <th
                  className={`border-border-default border-b px-3 py-2 align-top font-black ${tableTextAlignmentClass(block.alignments[index])}`}
                  key={`${block.key}-head-${header}`}
                  scope="col"
                >
                  <InlineMarkdown linkClass={linkClass} strongClass={strongClass} value={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr className="border-border-default border-t" key={`${block.key}-${row.join("|")}`}>
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
      <div className="grid gap-2 sm:hidden" data-testid="assistant-mobile-table-cards">
        {projectAssistantTableToMobileCards(block).map((card) => (
          <dl
            className="grid min-w-0 gap-2 rounded-md border border-border-default bg-white px-3 py-2"
            data-testid="assistant-mobile-table-card"
            key={card.key}
          >
            {card.cells.map((cell) => (
              <div className="grid min-w-0 gap-0.5" key={cell.key}>
                <dt
                  className={`text-[0.68rem] leading-tight font-black text-text-muted uppercase ${tableTextAlignmentClass(cell.alignment)}`}
                >
                  <InlineMarkdown
                    linkClass={linkClass}
                    strongClass={strongClass}
                    value={cell.header}
                  />
                </dt>
                <dd
                  className={`m-0 min-w-0 text-sm leading-[1.45] break-words text-text-default ${tableTextAlignmentClass(cell.alignment)}`}
                >
                  <InlineMarkdown
                    linkClass={linkClass}
                    strongClass={strongClass}
                    value={cell.value}
                  />
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </>
  );
}

function renderAssistantInlineToken(
  token: AssistantInlineToken,
  strongClass: string,
  linkClass: string,
): ReactNode {
  if (token.type === "text") {
    return token.text;
  }

  if (token.type === "strong") {
    return (
      <strong className={strongClass} key={token.key}>
        {token.children.map((childToken) =>
          renderAssistantInlineToken(childToken, strongClass, linkClass),
        )}
      </strong>
    );
  }

  return (
    <a
      aria-label={`Open ${token.label} link`}
      className={linkClass}
      href={token.href}
      key={token.key}
      rel="noreferrer"
      target="_blank"
    >
      {token.label}
    </a>
  );
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

function ChatComposer({
  inputValue,
  isSending,
  locationState,
  onInputValueChange,
  onRequestLocation,
  onTurnOffLocation,
  onSubmitPrompt,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeComposerTextarea(textareaRef.current);
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locationState.status === "requesting") {
      return;
    }
    onSubmitPrompt(inputValue);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      isSending ||
      locationState.status === "requesting" ||
      inputValue.trim().length === 0
    ) {
      return;
    }

    event.preventDefault();
    onSubmitPrompt(inputValue);
  }

  return (
    <footer className="border-border-default border-t bg-white px-4 py-3 sm:px-6 lg:px-8">
      <form
        aria-label="Ask Siargao composer"
        className="mx-auto w-full max-w-5xl min-w-0"
        onSubmit={handleSubmit}
      >
        <InputGroup className="min-h-[58px] items-start rounded-lg border-border-default bg-white p-2 text-text-strong shadow-card ring-1 ring-border-default">
          <textarea
            data-slot="input-group-control"
            aria-label="Ask anything about Siargao"
            className="min-w-0 max-h-32 min-h-11 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2.5 text-base leading-6 whitespace-pre-wrap text-text-strong caret-brand-violet-650 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:text-text-soft focus-visible:ring-0 disabled:bg-transparent disabled:text-text-muted"
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
              className="size-11 rounded-md bg-brand-violet-650 text-white hover:bg-brand-violet-600 disabled:opacity-50"
              disabled={
                isSending || locationState.status === "requesting" || inputValue.trim().length === 0
              }
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
        <LocationSharingControl
          disabled={isSending}
          locationState={locationState}
          onRequestLocation={onRequestLocation}
          onTurnOffLocation={onTurnOffLocation}
        />
      </form>
    </footer>
  );
}

function LocationSharingControl({
  disabled,
  locationState,
  onRequestLocation,
  onTurnOffLocation,
}: {
  disabled: boolean;
  locationState: LocationSharingState;
  onRequestLocation: (scope: LocationSharingScope) => void;
  onTurnOffLocation: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = locationStateLabel(locationState);
  const summary = locationSummaryText(locationState);
  const isRequesting = locationState.status === "requesting";
  const canTurnOff = locationState.status === "ready" || locationState.status === "requesting";

  const requestScope = (scope: LocationSharingScope) => {
    onRequestLocation(scope);
    setIsOpen(false);
  };

  return (
    <Dialog.Root onOpenChange={setIsOpen} open={isOpen}>
      <div className="mt-2 min-w-0 px-1">
        <Dialog.Trigger asChild>
          <Button
            aria-label={`Location sharing: ${label}. ${summary}`}
            className="h-auto min-h-11 max-w-full justify-start gap-2 rounded-md border-border-default bg-brand-lavender-50 px-3 py-2 text-left text-xs font-extrabold text-text-strong hover:bg-brand-lavender-100 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
            data-testid="location-sharing-trigger"
            type="button"
            variant="outline"
          >
            {isRequesting ? (
              <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin" size={16} />
            ) : (
              <MapPin aria-hidden="true" className="shrink-0 text-brand-violet-650" size={16} />
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className="min-w-0 break-words">Location: {label}</span>
              <span className="min-w-0 break-words text-[0.7rem] leading-tight text-text-muted">
                {summary}
              </span>
            </span>
          </Button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className="fixed right-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 z-50 grid max-h-[min(78dvh,30rem)] gap-4 overflow-y-auto rounded-lg border border-border-default bg-white p-4 text-text-strong shadow-night-card focus:outline-none sm:right-auto sm:left-1/2 sm:w-[min(28rem,calc(100vw-2rem))] sm:-translate-x-1/2"
          data-testid="location-sharing-dialog"
        >
          <div className="grid gap-1">
            <Dialog.Title className="m-0 text-base font-black text-text-strong">
              Location sharing
            </Dialog.Title>
            <Dialog.Description className="m-0 text-sm leading-[1.5] font-bold text-text-muted">
              Share exact browser location only when it helps this question. Coordinates stay in
              memory until the allowed request is sent and are not saved to trip details or history.
            </Dialog.Description>
          </div>
          <p className="m-0 text-sm font-extrabold text-text-strong" aria-live="polite">
            Current state: {label}. {summary}
          </p>
          {locationState.status === "blocked" ? (
            <p className="m-0 text-xs leading-[1.45] font-bold text-text-muted">
              Allow location for this site in browser settings to retry, or name an area like
              General Luna and continue without browser location.
            </p>
          ) : null}
          {locationState.status === "unavailable" ? (
            <p className="m-0 text-xs leading-[1.45] font-bold text-text-muted">
              This browser could not provide a usable position. You can retry from here or ask with
              a named Siargao area.
            </p>
          ) : null}
          <div className="grid gap-2">
            <Button
              className="h-auto min-h-11 justify-start rounded-md bg-brand-violet-650 px-3 py-2 text-sm font-extrabold text-white hover:bg-brand-violet-600 disabled:opacity-55"
              disabled={disabled || isRequesting}
              onClick={() => requestScope("single_request")}
              type="button"
            >
              Use once
            </Button>
            <p className="m-0 text-xs leading-tight font-bold text-text-muted">
              Adds location to the next chat request only, then clears it even if the answer fails.
            </p>
            <Button
              className="h-auto min-h-11 justify-start rounded-md border-brand-lagoon-500/25 bg-brand-lagoon-50 px-3 py-2 text-sm font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100 disabled:opacity-55"
              disabled={disabled || isRequesting}
              onClick={() => requestScope("trip_session")}
              type="button"
              variant="outline"
            >
              Use for this trip
            </Button>
            <p className="m-0 text-xs leading-tight font-bold text-text-muted">
              Keeps location only in this open chat workspace until you turn it off or leave.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-border-default border-t pt-3">
            {canTurnOff ? (
              <Button
                className="h-10 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
                onClick={() => {
                  onTurnOffLocation();
                  setIsOpen(false);
                }}
                type="button"
                variant="outline"
              >
                Turn off
              </Button>
            ) : null}
            <Dialog.Close asChild>
              <Button
                className="h-10 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-muted hover:bg-brand-lavender-50"
                type="button"
                variant="outline"
              >
                Close
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
}

function locationSummaryText(locationState: LocationSharingState) {
  switch (locationState.status) {
    case "requesting":
      return "Requesting browser permission now.";
    case "ready":
      return locationState.geolocation.consentScope === "trip_session"
        ? "Will be included until you turn it off or leave this chat."
        : "Will be included with the next question only.";
    case "blocked":
      return "Permission is blocked; continue without location or retry from this control.";
    case "unavailable":
      return "Browser location is unavailable; you can retry or name an area.";
    case "used":
      return "Used for the last question and cleared.";
    case "off":
      return "Optional. Ask normally or choose a scope first.";
  }
}

function SuggestedPromptBar({
  disabled,
  onSubmitPrompt,
  prompts,
}: {
  disabled: boolean;
  onSubmitPrompt: (prompt: string) => void;
  prompts: readonly string[];
}) {
  return (
    <fieldset
      aria-label="Suggested prompts"
      className="m-0 flex min-w-0 flex-wrap gap-2 overflow-visible border-0 p-0"
    >
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
  prompts: readonly string[];
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

function buildChatRequestBody(
  messages: ReturnType<typeof buildChatRequestMessages>,
  locationState: LocationSharingState,
  threadId: string | null,
  tripDataSource: TripDataSource,
): {
  messages: ReturnType<typeof buildChatRequestMessages>;
  clientContext?: ChatClientContext;
  threadId?: string;
} {
  const tripContext =
    tripDataSource === "anonymous" ? readStoredTripContextForRequest() : undefined;
  const geolocation = locationGeolocationForRequest(locationState);
  const clientContext: ChatClientContext = {
    ...(geolocation ? { geolocation } : {}),
    ...(tripContext ? { tripContext } : {}),
  };

  return {
    messages,
    ...(threadId ? { threadId } : {}),
    ...(Object.keys(clientContext).length > 0 ? { clientContext } : {}),
  };
}

function truncateChatRequestMessage(value: string) {
  return value.length <= maxChatRequestMessageLength
    ? value
    : `${value.slice(0, maxChatRequestMessageLength - 3)}...`;
}
