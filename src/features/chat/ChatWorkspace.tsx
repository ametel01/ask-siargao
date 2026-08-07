"use client";

/*
 * Hallmark - pre-emit critique: P4 H4 E4 S5 R4 V4
 * genre: modern-minimal; macrostructure: workbench; contrast/mobile: pass.
 */
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import {
  Archive,
  BedDouble,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  CloudSun,
  Copy,
  Ellipsis,
  ExternalLink,
  Info,
  LoaderCircle,
  MapPin,
  Navigation,
  Pencil,
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
import { isChatStreamResponse, readChatStreamResponse } from "@/features/chat/chat-stream";
import {
  type DecisionStripPresentation,
  type DecisionStripSummary,
  projectDecisionStrip,
} from "@/features/chat/decision-strip-presentation";
import {
  formatEvidenceReceiptTime,
  projectConditionEvidencePresentation,
  projectSourceEvidencePresentation,
  sourceEvidenceDisplayName,
  sourceEvidenceReceiptItems,
  sourceEvidenceReceiptSummaryText,
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
} from "@/features/chat/location-sharing-state";
import {
  authenticatedTripContextPatch,
  projectMobileTripContextSummary,
} from "@/features/chat/mobile-trip-context-presentation";
import { PendingAssistantWaitState } from "@/features/chat/PendingAssistantWaitState";
import {
  projectRecommendationSet,
  type RecommendationCardPresentation,
} from "@/features/chat/recommendation-presentation";
import {
  createResponseWaitRequest,
  invalidateResponseWaitRequest,
  isCurrentResponseWaitRequest,
  isResponseWaitAbort,
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
  resolveSavedTripSelection,
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
import {
  projectMobileTripPass,
  type TripPassAccountFetchState,
} from "@/features/trip-pass/account-presentation";
import { cn } from "@/lib/utils";
import type { TripPassAccountPresentation } from "@/server/trip-pass/presentation";
import {
  appSurfaceInsetClass,
  appSurfaceOverlayClass,
  appSurfacePanelClass,
  BrandLockup,
  PalmMark,
} from "@/ui/components/ask-siargao";

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
type ChatResponseErrorBody = {
  error?: string;
  reason?: string;
  message?: string;
};

const chatErrorMessage =
  "Ask Siargao could not finish this Reality Check. Your question is still here.";
const shareErrorMessage = "Share link could not be created. Your saved items are still here.";
const maxChatRequestMessageLength = 2_000;
const maxPriorChatRequestMessages = 6;
const chatTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
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
type ThreadActionDialog = "rename" | "archive" | "delete" | null;
type ThreadActionState = {
  dialog: ThreadActionDialog;
  error: string | null;
  pendingAction: "rename" | "archive" | "delete" | null;
  status: "idle" | "pending" | "error";
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

export function ChatWorkspace({
  initialPrompt = "",
  initialSavedItemId,
  initialThreadId,
}: {
  initialPrompt?: string;
  initialSavedItemId?: string;
  initialThreadId?: string;
}) {
  const controller = useChatWorkspaceController({
    initialPrompt,
    initialSavedItemId,
    initialThreadId,
  });

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
  openChatThread: (threadId: string) => void;
  archiveSelectedThread: () => Promise<void>;
  closeThreadActionDialog: () => void;
  deleteSelectedThread: () => Promise<void>;
  openThreadActionDialog: (dialog: Exclude<ThreadActionDialog, null>) => void;
  rateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => Promise<void>;
  removeSavedItem: (itemId: string) => void;
  renameSelectedThread: (title: string) => Promise<void>;
  requestLocation: (scope: LocationSharingScope) => void;
  saveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  saveRecommendationCard: (card: RecommendationCardArtifact) => void;
  savedItemIds: ReadonlySet<string>;
  savedPlanSharing: ReturnType<typeof useSavedPlanSharing>;
  savedTripState: SavedTripState;
  savedTripStatus: SavedTripPresentationStatus;
  selectedSavedItem: SavedTripItem | null;
  selectedSavedItemId: string | null;
  selectedSavedItemStatus: "idle" | "loading" | "ready" | "not_found" | "error";
  selectedThreadId: string | null;
  selectedThreadTitle: string | null;
  selectedThreadUnavailable: boolean;
  setInputValue: (value: string) => void;
  startNewChat: () => void;
  stopWaitingForAssistant: (assistantMessageId: string) => void;
  threadActionState: ThreadActionState;
  turnOffLocation: () => void;
  tripPassAccount: TripPassAccountPresentation | null;
  tripPassStatus: TripPassAccountFetchState;
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
  updateTripContext: (context: TripContextDraft) => Promise<void>;
};

function useChatWorkspaceController({
  initialPrompt,
  initialSavedItemId,
  initialThreadId,
}: {
  initialPrompt: string;
  initialSavedItemId?: string;
  initialThreadId?: string;
}): ChatWorkspaceController {
  const [inputValue, setInputValue] = useState(() => initialPrompt.trim());
  const [isSending, setIsSending] = useState(false);
  const [locationState, setLocationState] = useState<LocationSharingState>({ status: "off" });
  const [messages, setMessages] = useState<InteractiveChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThreadTitle, setSelectedThreadTitle] = useState<string | null>(null);
  const [selectedThreadUnavailable, setSelectedThreadUnavailable] = useState(false);
  const [selectedSavedItemId, setSelectedSavedItemId] = useState<string | null>(
    () => sanitizeResourceId(initialSavedItemId) ?? null,
  );
  const [selectedSavedItemStatus, setSelectedSavedItemStatus] = useState<
    "idle" | "loading" | "ready" | "not_found" | "error"
  >(() => (sanitizeResourceId(initialSavedItemId) ? "loading" : "idle"));
  const [threadActionState, setThreadActionState] = useState<ThreadActionState>({
    dialog: null,
    error: null,
    pendingAction: null,
    status: "idle",
  });
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
  const tripDataSource = useMemo<TripDataSource>(
    () =>
      profileLoading ? "loading" : profileError ? "error" : (profileResult?.source ?? "loading"),
    [profileError, profileLoading, profileResult],
  );
  const {
    data: tripPassAccount,
    error: tripPassError,
    isLoading: tripPassLoading,
  } = useSWR(
    tripDataSource === "authenticated" ? "/api/me/trip-pass" : null,
    fetchTripPassAccount,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const tripPassStatus: TripPassAccountFetchState =
    tripDataSource !== "authenticated"
      ? "ready"
      : tripPassLoading
        ? "loading"
        : tripPassError
          ? "unavailable"
          : "ready";
  const canLoadPrivateThread =
    !profileLoading && !profileError && profileResult?.source === "authenticated";
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
  const selectedSavedItem = useMemo(
    () => savedTripState.items.find((item) => item.id === selectedSavedItemId) ?? null,
    [savedTripState.items, selectedSavedItemId],
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
  const threadMutationGenerationRef = useRef(0);
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
    mountedRef.current = true;

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
      if ((initialAuthenticatedSavedTrip.items ?? []).length === 0) {
        return;
      }

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

  const loadChatThread = useCallback(
    async (threadId: string, historyMode: "push" | "replace" | "none" = "push") => {
      stopActiveResponseForThreadSwitch();
      threadMutationGenerationRef.current += 1;
      activeThreadLoadRef.current?.controller.abort();
      setThreadActionState({
        dialog: null,
        error: null,
        pendingAction: null,
        status: "idle",
      });
      const generation = threadLoadGenerationRef.current + 1;
      threadLoadGenerationRef.current = generation;
      const controller = new AbortController();
      activeThreadLoadRef.current = { controller, generation };
      setHistoryStatus("loading");
      setSelectedThreadUnavailable(false);
      setSelectedSavedItemId(null);
      setSelectedSavedItemStatus("idle");
      if (historyMode !== "none") {
        writeChatResourceQuery({ threadId }, historyMode);
      }

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
          if (response.status === 401 || response.status === 404) {
            setSelectedThreadId(null);
            setSelectedThreadTitle(null);
            setMessages([]);
            writeChatResourceQuery({}, "replace");
          }
          setSelectedThreadUnavailable(true);
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
        setSelectedThreadId(() => threadId);
        setSelectedThreadTitle(body.thread?.title ?? "Siargao chat");
        const loadedThread = body.thread;
        if (loadedThread) {
          setChatThreads((currentThreads) => upsertThreadSummary(currentThreads, loadedThread));
        }
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

  const openChatThread = loadChatThread;

  const startNewChatWithoutHistoryPush = useCallback(() => {
    invalidatePendingChatSubmission();
    invalidateActiveResponseRequest();
    invalidateActiveThreadLoad();
    threadMutationGenerationRef.current += 1;
    setThreadActionState({
      dialog: null,
      error: null,
      pendingAction: null,
      status: "idle",
    });
    setSelectedThreadId(null);
    setSelectedThreadTitle(null);
    setSelectedThreadUnavailable(false);
    setSelectedSavedItemId(null);
    setSelectedSavedItemStatus("idle");
    setMessages([]);
    setInputValue("");
    setHistoryStatus("idle");
  }, [
    invalidateActiveResponseRequest,
    invalidateActiveThreadLoad,
    invalidatePendingChatSubmission,
  ]);

  const startNewChat = useCallback(() => {
    startNewChatWithoutHistoryPush();
    setThreadActionState({
      dialog: null,
      error: null,
      pendingAction: null,
      status: "idle",
    });
    writeChatResourceQuery({}, "push");
  }, [startNewChatWithoutHistoryPush]);

  useEffect(() => {
    const requestedThreadId = sanitizeResourceId(initialThreadId);
    if (!requestedThreadId || !canLoadPrivateThread) {
      return;
    }

    void loadChatThread(requestedThreadId, "replace");
  }, [canLoadPrivateThread, initialThreadId, loadChatThread]);

  useEffect(() => {
    const applyResourceQuery = () => {
      const resourceQuery = readChatResourceQuery();
      if (resourceQuery.threadId) {
        if (canLoadPrivateThread) {
          void loadChatThread(resourceQuery.threadId, "none");
        }
        return;
      }
      if (resourceQuery.savedItemId) {
        startNewChatWithoutHistoryPush();
        setSelectedSavedItemId(resourceQuery.savedItemId);
        setSelectedSavedItemStatus("loading");
        return;
      }
      startNewChatWithoutHistoryPush();
    };

    window.addEventListener("popstate", applyResourceQuery);
    return () => {
      window.removeEventListener("popstate", applyResourceQuery);
    };
  }, [canLoadPrivateThread, loadChatThread, startNewChatWithoutHistoryPush]);

  useEffect(() => {
    setSelectedSavedItemStatus(
      resolveSavedTripSelection({
        selectedItemId: selectedSavedItemId,
        state: savedTripState,
        status: savedTripStatus,
      }).status,
    );
  }, [savedTripState, savedTripStatus, selectedSavedItemId]);

  const closeThreadActionDialog = useCallback(() => {
    setThreadActionState((currentState) => ({
      ...currentState,
      dialog: null,
      error: null,
      status: currentState.pendingAction ? currentState.status : "idle",
    }));
  }, []);

  const openThreadActionDialog = useCallback((dialog: Exclude<ThreadActionDialog, null>) => {
    setThreadActionState({
      dialog,
      error: null,
      pendingAction: null,
      status: "idle",
    });
  }, []);

  const renameSelectedThread = useCallback(
    async (title: string) => {
      if (!selectedThreadId) {
        return;
      }

      const trimmedTitle = title.trim();
      if (trimmedTitle.length < 1 || trimmedTitle.length > 120) {
        setThreadActionState((currentState) => ({
          ...currentState,
          error: "Use 1 to 120 characters.",
          status: "error",
        }));
        return;
      }

      const mutationGeneration = threadMutationGenerationRef.current + 1;
      threadMutationGenerationRef.current = mutationGeneration;
      setThreadActionState({
        dialog: "rename",
        error: null,
        pendingAction: "rename",
        status: "pending",
      });

      try {
        const response = await fetch(`/api/chat/threads/${selectedThreadId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: trimmedTitle }),
        });
        if (!response.ok) {
          if (threadMutationGenerationRef.current !== mutationGeneration) {
            return;
          }
          setThreadActionState({
            dialog: "rename",
            error: threadMutationErrorMessage(response.status),
            pendingAction: null,
            status: "error",
          });
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          thread?: ChatThreadSummary;
        } | null;
        if (threadMutationGenerationRef.current !== mutationGeneration) {
          return;
        }
        if (!response.ok || !body?.thread) {
          setThreadActionState({
            dialog: "rename",
            error: threadMutationErrorMessage(response.status),
            pendingAction: null,
            status: "error",
          });
          return;
        }

        const renamedThread = body.thread;
        setSelectedThreadTitle(renamedThread.title);
        setChatThreads((currentThreads) => upsertThreadSummary(currentThreads, renamedThread));
        setThreadActionState({
          dialog: null,
          error: null,
          pendingAction: null,
          status: "idle",
        });
        await refreshChatThreads();
      } catch {
        if (threadMutationGenerationRef.current !== mutationGeneration) {
          return;
        }
        setThreadActionState({
          dialog: "rename",
          error: "Network error. The title was not changed.",
          pendingAction: null,
          status: "error",
        });
      }
    },
    [refreshChatThreads, selectedThreadId],
  );

  const archiveSelectedThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    const archivedThreadId = selectedThreadId;
    const mutationGeneration = threadMutationGenerationRef.current + 1;
    threadMutationGenerationRef.current = mutationGeneration;
    setThreadActionState({
      dialog: "archive",
      error: null,
      pendingAction: "archive",
      status: "pending",
    });

    try {
      const response = await fetch(`/api/chat/threads/${archivedThreadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (threadMutationGenerationRef.current !== mutationGeneration) {
        return;
      }
      if (!response.ok) {
        setThreadActionState({
          dialog: "archive",
          error: threadMutationErrorMessage(response.status),
          pendingAction: null,
          status: "error",
        });
        return;
      }

      setChatThreads((currentThreads) =>
        currentThreads.filter((thread) => thread.id !== archivedThreadId),
      );
      startNewChatWithoutHistoryPush();
      writeChatResourceQuery({}, "replace");
      setThreadActionState({
        dialog: null,
        error: null,
        pendingAction: null,
        status: "idle",
      });
      await refreshChatThreads();
    } catch {
      if (threadMutationGenerationRef.current !== mutationGeneration) {
        return;
      }
      setThreadActionState({
        dialog: "archive",
        error: "Network error. The thread was not archived.",
        pendingAction: null,
        status: "error",
      });
    }
  }, [refreshChatThreads, selectedThreadId, startNewChatWithoutHistoryPush]);

  const deleteSelectedThread = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    const deletedThreadId = selectedThreadId;
    const mutationGeneration = threadMutationGenerationRef.current + 1;
    threadMutationGenerationRef.current = mutationGeneration;
    setThreadActionState({
      dialog: "delete",
      error: null,
      pendingAction: "delete",
      status: "pending",
    });

    try {
      const response = await fetch(`/api/chat/threads/${deletedThreadId}`, { method: "DELETE" });
      if (threadMutationGenerationRef.current !== mutationGeneration) {
        return;
      }
      if (!response.ok) {
        setThreadActionState({
          dialog: "delete",
          error: threadMutationErrorMessage(response.status),
          pendingAction: null,
          status: "error",
        });
        return;
      }

      setChatThreads((currentThreads) =>
        currentThreads.filter((thread) => thread.id !== deletedThreadId),
      );
      startNewChatWithoutHistoryPush();
      writeChatResourceQuery({}, "replace");
      setThreadActionState({
        dialog: null,
        error: null,
        pendingAction: null,
        status: "idle",
      });
      await refreshChatThreads();
    } catch {
      if (threadMutationGenerationRef.current !== mutationGeneration) {
        return;
      }
      setThreadActionState({
        dialog: "delete",
        error: "Network error. The thread was not deleted.",
        pendingAction: null,
        status: "error",
      });
    }
  }, [refreshChatThreads, selectedThreadId, startNewChatWithoutHistoryPush]);

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
        if (!response.ok) {
          throw new Error("rating_failed");
        }
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

  const requestLocation = captureLocation;

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
      try {
        let requestLocationState = locationState;

        if (shouldRequestAutomaticLocationForPrompt(trimmedPrompt, locationState)) {
          const capturedLocationState = await captureLocation(
            "single_request",
            submission.controller.signal,
          );
          if (
            !mountedRef.current ||
            submission.controller.signal.aborted ||
            pendingChatSubmissionRef.current?.generation !== submission.generation
          ) {
            return;
          }
          if (capturedLocationState) {
            requestLocationState = capturedLocationState;
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
          type ChatResponseBody = {
            message?: string;
            cards?: RecommendationCardArtifact[];
            actions?: ChatActionArtifact[];
            itineraries?: ItineraryPlanArtifact[];
            decisionSummaries?: DecisionSummaryArtifact[];
            sources?: ChatSourceArtifact[];
            threadId?: string;
            assistantMessageId?: string;
            error?: string;
            reason?: string;
          };
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
              accept: "application/x-ndjson",
              "content-type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: responseRequest.controller.signal,
          });
          if (!response.ok) {
            const errorBody = (await response.json().catch(() => ({}))) as ChatResponseBody;
            throw new Error(chatResponseErrorMessage(response.status, errorBody));
          }
          let responseStatus = response.status;
          let body: ChatResponseBody;
          const streamedResponse = isChatStreamResponse(response);
          if (streamedResponse) {
            const result = await readChatStreamResponse<ChatResponseBody>(response, (event) => {
              if (!mountedRef.current) {
                return;
              }
              setMessages((currentMessages) =>
                currentMessages.map((message) =>
                  message.id === pendingAssistantId && message.status === "pending"
                    ? { ...message, text: event.message }
                    : message,
                ),
              );
            });
            responseStatus = result.status;
            body = result.body;
          } else {
            body = (await response.json().catch(() => ({}))) as ChatResponseBody;
          }
          if (responseStatus < 200 || responseStatus >= 300) {
            throw new Error(chatResponseErrorMessage(responseStatus, body));
          }

          const responseMessage = body.message;

          if (
            !mountedRef.current ||
            !isCurrentResponseWaitRequest(
              activeResponseRequestRef.current,
              responseRequest.requestId,
            )
          ) {
            return;
          }

          if (!responseMessage) {
            throw new Error(chatResponseErrorMessage(responseStatus, body));
          }

          if (body.threadId) {
            setSelectedThreadId(body.threadId);
            setSelectedThreadTitle(chatThreadTitleFromPrompt(trimmedPrompt));
            setSelectedSavedItemId(null);
            setSelectedSavedItemStatus("idle");
            writeChatResourceQuery({ threadId: body.threadId }, "replace");
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
                    text: error instanceof Error ? error.message : chatErrorMessage,
                    timestamp: formatTimestamp(),
                    status: "error",
                    retryPrompt: trimmedPrompt,
                  }
                : message,
            ),
          );
        } finally {
          if (
            isCurrentResponseWaitRequest(
              activeResponseRequestRef.current,
              responseRequest.requestId,
            )
          ) {
            activeResponseRequestRef.current = settleResponseWaitRequest(
              activeResponseRequestRef.current,
              responseRequest.requestId,
            );
          }
        }
      } finally {
        if (pendingChatSubmissionRef.current?.generation === submission.generation) {
          pendingChatSubmissionRef.current = null;
        }
        setIsSending(false);
      }
    },
    [
      dispatchLocationState,
      captureLocation,
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

  const handlePromptSubmit = submitPrompt;

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
    closeThreadActionDialog,
    deleteSelectedThread,
    openThreadActionDialog,
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
    selectedSavedItem,
    selectedSavedItemId,
    selectedSavedItemStatus,
    selectedThreadId,
    selectedThreadTitle,
    selectedThreadUnavailable,
    setInputValue,
    startNewChat,
    stopWaitingForAssistant,
    threadActionState,
    turnOffLocation,
    tripPassAccount: tripPassAccount ?? null,
    tripPassStatus,
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
  archiveSelectedThread,
  closeThreadActionDialog,
  deleteSelectedThread,
  openThreadActionDialog,
  rateAssistantMessage,
  removeSavedItem,
  requestLocation,
  renameSelectedThread,
  saveItineraryPlan,
  saveRecommendationCard,
  savedItemIds,
  savedPlanSharing,
  savedTripState,
  savedTripStatus,
  selectedSavedItem,
  selectedSavedItemId,
  selectedSavedItemStatus,
  selectedThreadId,
  selectedThreadTitle,
  selectedThreadUnavailable,
  setInputValue,
  startNewChat,
  stopWaitingForAssistant,
  threadActionState,
  turnOffLocation,
  tripPassAccount,
  tripPassStatus,
  tripContext,
  tripDataSource,
  updateTripContext,
}: ChatWorkspaceController) {
  const hasMessages = messages.length > 0;
  const useCompactHeader = useCompactChatHeaderViewport();
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

  const editQuestion = useCallback(
    (prompt: string) => {
      setInputValue(prompt);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>("[data-testid='chat-composer-input']")?.focus();
      });
    },
    [setInputValue],
  );

  return (
    <main
      aria-label="Ask Siargao chat workspace"
      className="fixed inset-0 isolate h-dvh overflow-hidden bg-brand-paper-100 text-text-strong before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:-z-10 before:w-[42vw] before:bg-[radial-gradient(circle_at_18%_16%,rgba(20,184,166,0.18),transparent_34%),linear-gradient(150deg,rgba(6,47,53,0.18),transparent_58%)] after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:-z-10 after:h-44 after:w-[48vw] after:bg-[radial-gradient(circle_at_bottom_right,rgba(255,155,131,0.16),transparent_58%)]"
    >
      <section className="grid h-full min-h-0 w-full grid-cols-1 min-[1180px]:grid-cols-[12.25rem_minmax(0,1fr)_23rem] xl:grid-cols-[14rem_minmax(0,1fr)_24rem] 2xl:grid-cols-[16rem_minmax(0,1fr)_25rem]">
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

        <section
          className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-border-strong border-x bg-brand-paper-50 shadow-surface-panel"
          data-testid="conversation-region"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--brand-lagoon-500),var(--brand-sunset-gold),var(--brand-sunset-coral))]"
          />
          <ChatTopBar
            archiveSelectedThread={archiveSelectedThread}
            canSharePlan={savedPlanSharing.selectedShareItems.length > 0}
            closeThreadActionDialog={closeThreadActionDialog}
            deleteSelectedThread={deleteSelectedThread}
            mobileTripContext={
              showMobileTripContext ? (
                <MobileTripContextDisclosure
                  liveConditions={liveConditions}
                  locationState={locationState}
                  onUpdateTripContext={updateTripContext}
                  tripPassAccount={tripPassAccount}
                  tripPassStatus={tripPassStatus}
                  tripContext={tripContext}
                  tripDataSource={tripDataSource}
                />
              ) : null
            }
            onSharePlan={() => {
              void savedPlanSharing.createShareLink();
            }}
            onStartNewChat={startNewChat}
            openThreadActionDialog={openThreadActionDialog}
            renameSelectedThread={renameSelectedThread}
            selectedThreadId={selectedThreadId}
            selectedThreadTitle={selectedThreadTitle}
            threadActionState={threadActionState}
            useCompactHeader={useCompactHeader}
          />

          <section
            aria-label="Chat message scroll area"
            className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,rgba(255,253,247,0.96),rgba(251,246,232,0.9))] px-4 py-4 sm:px-6 lg:px-8"
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
                  selectedSavedItemId={selectedSavedItemId}
                  shareStatus={savedPlanSharing.shareStatus}
                  shareUrl={savedPlanSharing.shareUrl}
                />
              ) : null}
              <SelectedSavedItemStatus
                item={selectedSavedItem}
                selectedItemId={selectedSavedItemId}
                status={selectedSavedItemStatus}
              />
              {selectedThreadUnavailable ? (
                <section
                  aria-label="Selected chat unavailable"
                  className="rounded-lg border border-border-default bg-white p-4"
                  data-testid="selected-thread-status"
                >
                  <h2 className="m-0 text-base font-semibold text-text-strong">Chat unavailable</h2>
                  <p className="m-0 mt-1 text-sm font-bold text-text-muted">
                    This chat was not found for the current signed-in account.
                  </p>
                </section>
              ) : null}
              {hasMessages ? (
                <>
                  <div className="grid gap-4" role="log" aria-label="Conversation messages">
                    {messages.map((message) => (
                      <ChatMessage
                        disabled={isSending}
                        key={message.id}
                        message={message}
                        onEditPrompt={editQuestion}
                        onRateAssistantMessage={(messageId, rating) => {
                          void rateAssistantMessage(messageId, rating);
                        }}
                        onRetryPrompt={handlePromptSubmit}
                        onSaveItineraryPlan={saveItineraryPlan}
                        onSaveRecommendationCard={saveRecommendationCard}
                        onRemoveSavedItem={removeSavedItem}
                        onStopWaiting={stopWaitingForAssistant}
                        onSubmitPrompt={handlePromptSubmit}
                        recoveryConditions={liveConditions}
                        savedItemIds={savedItemIds}
                      />
                    ))}
                  </div>
                  {!isSending && lastMessage?.status === "complete" ? (
                    <FollowUpPromptDisclosure
                      onSubmitPrompt={handlePromptSubmit}
                      prompts={suggestedPrompts}
                    />
                  ) : null}
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
    <aside className="hidden min-h-0 bg-[linear-gradient(180deg,var(--brand-reef-900),var(--brand-navy-980)_72%)] px-4 py-5 text-text-on-dark min-[1180px]:grid min-[1180px]:grid-rows-[auto_auto_minmax(0,1fr)_auto] min-[1180px]:gap-5 xl:px-5">
      <Link aria-label="Ask Siargao home" className="min-w-0 no-underline" href="/">
        <BrandLockup className="[&_span:last-child]:text-2xl" />
      </Link>

      <Button
        asChild
        className="h-[3.25rem] w-full justify-between rounded-md bg-[image:var(--gradient-lagoon-cta)] px-4 text-sm font-semibold text-white shadow-none hover:bg-brand-lagoon-600 xl:text-base"
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
        <section className="grid gap-3 border-white/10 border-t pt-4">
          <p className="m-0 text-xs font-semibold tracking-[0.08em] text-text-on-dark-muted uppercase">
            Current trip
          </p>
          <div className="grid gap-1 border-brand-lagoon-300/45 border-l-2 py-1 pl-3">
            <h2 className="m-0 min-w-0 text-sm font-semibold text-white">
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

        <section className="grid gap-3 border-white/10 border-t pt-4">
          <p className="m-0 text-xs font-semibold tracking-[0.08em] text-text-on-dark-muted uppercase">
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

        <section className="grid gap-3 border-white/10 border-t pt-4">
          <h2 className="m-0 text-xs font-semibold tracking-[0.08em] text-text-on-dark-muted uppercase">
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
                      "grid min-w-0 gap-1 rounded-md border border-transparent py-1 text-left",
                      "text-sm transition-[background-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                      thread.id === selectedThreadId
                        ? "bg-white/8 px-2 text-brand-lagoon-300"
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
        className="grid min-h-24 content-between overflow-hidden rounded-md border border-white/12 bg-white/8 p-4 text-white no-underline transition-colors hover:border-brand-lagoon-300/45 hover:bg-white/12"
        href="/settings"
      >
        <span className="grid gap-1">
          <span className="text-base font-semibold">Field desk settings</span>
          <span className="text-xs font-bold text-white/85">
            Saved plans, privacy, and account controls.
          </span>
        </span>
        <ExternalLink aria-hidden="true" size={18} />
      </Link>
    </aside>
  );
}

function ChatTopBar({
  archiveSelectedThread,
  canSharePlan,
  closeThreadActionDialog,
  deleteSelectedThread,
  mobileTripContext,
  onSharePlan,
  onStartNewChat,
  openThreadActionDialog,
  renameSelectedThread,
  selectedThreadId,
  selectedThreadTitle,
  threadActionState,
  useCompactHeader,
}: {
  archiveSelectedThread: () => Promise<void>;
  canSharePlan: boolean;
  closeThreadActionDialog: () => void;
  deleteSelectedThread: () => Promise<void>;
  mobileTripContext: ReactNode;
  onSharePlan: () => void;
  onStartNewChat: () => void;
  openThreadActionDialog: (dialog: Exclude<ThreadActionDialog, null>) => void;
  renameSelectedThread: (title: string) => Promise<void>;
  selectedThreadId: string | null;
  selectedThreadTitle: string | null;
  threadActionState: ThreadActionState;
  useCompactHeader: boolean;
}) {
  const hasSelectedThread = Boolean(selectedThreadId);
  const hasMobileIdentity = Boolean(mobileTripContext);
  const isMutatingThread = threadActionState.pendingAction !== null;
  const closeArchiveDialog = () => {
    closeThreadActionDialog();
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Archive selected chat"]')
        ?.focus();
    }, 0);
  };

  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-border-default/80 border-b bg-brand-paper-50/95 px-3 py-2 backdrop-blur-md sm:px-6 lg:min-h-[76px] lg:px-8 lg:py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {hasMobileIdentity ? <PalmMark className="size-8" /> : null}
        <div className="grid min-w-0 gap-1">
          <h1
            className={cn(
              "m-0 min-w-0 truncate font-semibold text-text-strong",
              hasMobileIdentity ? "font-heading text-2xl leading-none" : "text-xl sm:text-2xl",
            )}
          >
            Ask Siargao
          </h1>
          <p className="m-0 hidden min-w-0 items-center gap-2 text-sm font-extrabold text-text-muted sm:inline-flex">
            <WavesHorizontal
              aria-hidden="true"
              className="shrink-0 text-brand-lagoon-700"
              size={16}
            />
            Reality-check your Siargao plan
          </p>
        </div>
      </div>
      {useCompactHeader ? (
        <div className="flex shrink-0 items-center gap-2">
          <ChatAuthActions compact />
          <CompactChatActionsMenu
            canSharePlan={canSharePlan}
            disabled={isMutatingThread}
            hasSelectedThread={hasSelectedThread}
            onArchive={() => openThreadActionDialog("archive")}
            onDelete={() => openThreadActionDialog("delete")}
            onRename={() => openThreadActionDialog("rename")}
            onSharePlan={onSharePlan}
            onStartNewChat={onStartNewChat}
          />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {hasSelectedThread ? (
            <ThreadActionControls
              disabled={isMutatingThread}
              onArchive={() => openThreadActionDialog("archive")}
              onDelete={() => openThreadActionDialog("delete")}
              onRename={() => openThreadActionDialog("rename")}
            />
          ) : null}
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
      )}
      {threadActionState.error ? (
        <p className="basis-full m-0 text-sm font-bold text-text-alert" role="status">
          {threadActionState.error}
        </p>
      ) : null}
      {mobileTripContext ? <div className="basis-full min-w-0">{mobileTripContext}</div> : null}
      {threadActionState.dialog === "rename" ? (
        <ThreadRenameDialog
          error={threadActionState.error}
          isPending={threadActionState.pendingAction === "rename"}
          title={selectedThreadTitle ?? "Siargao chat"}
          onCancel={closeThreadActionDialog}
          onSave={renameSelectedThread}
        />
      ) : null}
      {threadActionState.dialog === "delete" ? (
        <ThreadDeleteDialog
          error={threadActionState.error}
          isPending={threadActionState.pendingAction === "delete"}
          title={selectedThreadTitle ?? "Siargao chat"}
          onCancel={closeThreadActionDialog}
          onDelete={deleteSelectedThread}
        />
      ) : null}
      {threadActionState.dialog === "archive" ? (
        <ThreadArchiveDialog
          error={threadActionState.error}
          isPending={threadActionState.pendingAction === "archive"}
          title={selectedThreadTitle ?? "Siargao chat"}
          onArchive={archiveSelectedThread}
          onCancel={closeArchiveDialog}
        />
      ) : null}
    </header>
  );
}

function CompactChatActionsMenu({
  canSharePlan,
  disabled,
  hasSelectedThread,
  onArchive,
  onDelete,
  onRename,
  onSharePlan,
  onStartNewChat,
}: {
  canSharePlan: boolean;
  disabled: boolean;
  hasSelectedThread: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onRename: () => void;
  onSharePlan: () => void;
  onStartNewChat: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const runAction = (action: () => void) => {
    setIsOpen(false);
    window.setTimeout(action, 0);
  };

  return (
    <Dialog.Root onOpenChange={setIsOpen} open={isOpen}>
      <Dialog.Trigger asChild>
        <Button
          aria-label="Open chat actions"
          className="size-11 rounded-md border-border-default bg-white text-text-strong hover:bg-brand-lavender-50"
          size="icon"
          type="button"
          variant="outline"
        >
          <Ellipsis aria-hidden="true" size={19} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className={cn(
            appSurfaceOverlayClass,
            "fixed right-3 bottom-3 left-3 z-50 grid gap-3 p-4 text-text-strong focus:outline-none sm:right-4 sm:bottom-auto sm:left-auto sm:top-20 sm:w-80",
          )}
          data-testid="compact-chat-actions"
        >
          <div className="grid gap-1">
            <Dialog.Title className="m-0 text-base font-semibold">Chat actions</Dialog.Title>
            <Dialog.Description className="m-0 text-sm font-bold text-text-muted">
              Manage this question or open account settings.
            </Dialog.Description>
          </div>
          <div className="grid gap-2">
            <Button
              className="min-h-11 justify-start rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
              onClick={() => runAction(onStartNewChat)}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" size={16} />
              New question
            </Button>
            <Button
              className="min-h-11 justify-start rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50 disabled:opacity-45"
              disabled={!canSharePlan}
              onClick={() => runAction(onSharePlan)}
              type="button"
              variant="outline"
            >
              <Share2 aria-hidden="true" size={16} />
              Share saved plan
            </Button>
            <Button asChild className="min-h-11 justify-start" variant="outline">
              <Link href="/settings">
                <SettingsIcon aria-hidden="true" size={16} />
                Settings
              </Link>
            </Button>
            {hasSelectedThread ? (
              <>
                <Button
                  className="min-h-11 justify-start"
                  disabled={disabled}
                  onClick={() => runAction(onRename)}
                  type="button"
                  variant="outline"
                >
                  <Pencil aria-hidden="true" size={16} />
                  Rename chat
                </Button>
                <Button
                  className="min-h-11 justify-start"
                  disabled={disabled}
                  onClick={() => runAction(onArchive)}
                  type="button"
                  variant="outline"
                >
                  <Archive aria-hidden="true" size={16} />
                  Archive chat
                </Button>
                <Button
                  className="min-h-11 justify-start border-red-200 text-red-700 hover:bg-red-50"
                  disabled={disabled}
                  onClick={() => runAction(onDelete)}
                  type="button"
                  variant="outline"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  Delete chat
                </Button>
              </>
            ) : null}
          </div>
          <Dialog.Close asChild>
            <Button className="min-h-11" type="button" variant="ghost">
              Close
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ThreadActionControls({
  disabled,
  onArchive,
  onDelete,
  onRename,
}: {
  disabled: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">Selected thread actions</legend>
      <Button
        aria-label="Rename selected chat"
        className="size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
        disabled={disabled}
        onClick={onRename}
        size="icon"
        type="button"
        variant="outline"
      >
        <Pencil aria-hidden="true" size={16} />
      </Button>
      <Button
        aria-label="Archive selected chat"
        className="size-10 rounded-md border-border-default bg-white text-brand-violet-650 hover:bg-brand-lavender-100"
        disabled={disabled}
        onClick={onArchive}
        size="icon"
        type="button"
        variant="outline"
      >
        <Archive aria-hidden="true" size={16} />
      </Button>
      <Button
        aria-label="Delete selected chat"
        className="size-10 rounded-md border-red-200 bg-white text-red-700 hover:bg-red-50"
        disabled={disabled}
        onClick={onDelete}
        size="icon"
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" size={16} />
      </Button>
    </fieldset>
  );
}

function ThreadRenameDialog({
  error,
  isPending,
  onCancel,
  onSave,
  title,
}: {
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSave: (title: string) => Promise<void>;
  title: string;
}) {
  const [value, setValue] = useState(title);
  const trimmedLength = value.trim().length;
  const validationError =
    trimmedLength === 0
      ? "Enter a title."
      : trimmedLength > 120
        ? "Use 120 characters or fewer."
        : null;

  return (
    <Dialog.Root open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className={cn(
            appSurfaceOverlayClass,
            "fixed top-1/2 left-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 p-5 text-text-strong focus:outline-none",
          )}
          data-testid="thread-rename-dialog"
        >
          <div className="grid gap-1">
            <Dialog.Title className="m-0 text-lg font-semibold">Rename chat</Dialog.Title>
            <Dialog.Description className="m-0 text-sm font-bold text-text-muted">
              Use a private title you can recognize later.
            </Dialog.Description>
          </div>
          <label className="grid gap-2 text-sm font-extrabold" htmlFor="thread-title-input">
            Thread title
            <input
              className="min-h-11 rounded-md border border-border-default bg-white px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650"
              disabled={isPending}
              id="thread-title-input"
              maxLength={121}
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          {validationError || error ? (
            <p className="m-0 text-sm font-bold text-text-alert" role="alert">
              {validationError ?? error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button disabled={isPending} type="button" variant="outline">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              disabled={isPending || Boolean(validationError)}
              type="button"
              onClick={() => {
                void onSave(value);
              }}
            >
              {isPending ? "Saving" : "Save"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ThreadDeleteDialog({
  error,
  isPending,
  onCancel,
  onDelete,
  title,
}: {
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  title: string;
}) {
  const confirmation = "DELETE";
  const [value, setValue] = useState("");

  return (
    <Dialog.Root open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className={cn(
            appSurfaceOverlayClass,
            "fixed top-1/2 left-1/2 z-50 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 border-red-200 p-5 text-text-strong focus:outline-none",
          )}
          data-testid="thread-delete-dialog"
        >
          <div className="grid gap-1">
            <Dialog.Title className="m-0 text-lg font-semibold">Delete chat?</Dialog.Title>
            <Dialog.Description className="m-0 text-sm font-bold text-text-muted">
              This removes "{title}" from active chat history. Saved planning items remain separate.
            </Dialog.Description>
          </div>
          <label className="grid gap-2 text-sm font-extrabold" htmlFor="thread-delete-confirmation">
            Type {confirmation} to delete this chat
            <input
              className="min-h-11 rounded-md border border-border-default bg-white px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              disabled={isPending}
              id="thread-delete-confirmation"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          {error ? (
            <p className="m-0 text-sm font-bold text-text-alert" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button disabled={isPending} type="button" variant="outline">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              className="bg-red-700 text-white hover:bg-red-800"
              disabled={isPending || value !== confirmation}
              type="button"
              onClick={() => {
                void onDelete();
              }}
            >
              <Trash2 aria-hidden="true" size={16} />
              {isPending ? "Deleting" : "Delete chat"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ThreadArchiveDialog({
  error,
  isPending,
  onArchive,
  onCancel,
  title,
}: {
  error: string | null;
  isPending: boolean;
  onArchive: () => Promise<void>;
  onCancel: () => void;
  title: string;
}) {
  const confirmation = "ARCHIVE";
  const [value, setValue] = useState("");

  return (
    <Dialog.Root open onOpenChange={(open) => (!open && !isPending ? onCancel() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className={cn(
            appSurfaceOverlayClass,
            "fixed top-1/2 left-1/2 z-50 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 p-5 text-text-strong focus:outline-none",
          )}
          data-testid="thread-archive-dialog"
        >
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isPending && value === confirmation) {
                void onArchive();
              }
            }}
          >
            <div className="grid gap-1">
              <Dialog.Title className="m-0 text-lg font-semibold">Archive chat?</Dialog.Title>
              <Dialog.Description className="m-0 text-sm font-bold text-text-muted">
                This removes "{title}" from active chat history. Saved planning items remain
                separate.
              </Dialog.Description>
            </div>
            <label
              className="grid gap-2 text-sm font-extrabold"
              htmlFor="thread-archive-confirmation"
            >
              Type {confirmation} to archive this chat
              <input
                className="min-h-11 rounded-md border border-border-default bg-white px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650"
                disabled={isPending}
                id="thread-archive-confirmation"
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            </label>
            {error ? (
              <p className="m-0 text-sm font-bold text-text-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild>
                <Button disabled={isPending} type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button disabled={isPending || value !== confirmation} type="submit">
                <Archive aria-hidden="true" size={16} />
                {isPending ? "Archiving" : "Archive chat"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  tripPassAccount,
  tripPassStatus,
  tripContext,
  tripDataSource,
}: {
  liveConditions: LiveConditionsController;
  locationState: LocationSharingState;
  onUpdateTripContext: (context: TripContextDraft) => Promise<void>;
  tripPassAccount: TripPassAccountPresentation | null;
  tripPassStatus: TripPassAccountFetchState;
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
  const mobileTripPass = projectMobileTripPass(tripPassAccount);
  const summary = projectMobileTripContextSummary({
    context: tripContext,
    pass:
      mobileTripPass.status === "visible"
        ? { status: "available", summary: mobileTripPass.text }
        : undefined,
    source: tripDataSource,
  });
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
            <span className="break-words text-xs leading-tight font-bold text-text-muted">
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
          tripPassAccount={tripPassAccount}
          tripPassStatus={tripPassStatus}
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
  tripPassAccount,
  tripPassStatus,
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
  tripPassAccount: TripPassAccountPresentation | null;
  tripPassStatus: TripPassAccountFetchState;
  tripContext: TripContextDraft;
  tripDataSource: TripDataSource;
}) {
  return (
    <Dialog.Content
      className={cn(
        appSurfaceOverlayClass,
        "fixed inset-x-0 bottom-0 z-50 m-0 max-h-[min(92dvh,52rem)] w-full max-w-none overflow-hidden rounded-t-2xl p-0 text-text-strong focus:outline-none",
      )}
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
            <Dialog.Title className="m-0 text-lg font-semibold text-text-strong">
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
                    className="m-0 text-sm font-semibold text-text-strong"
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
              <h3 className="m-0 text-sm font-semibold text-text-strong">Location sharing</h3>
              <p className="m-0 text-sm font-bold text-text-muted">
                {mobileLocationScopeLabel(locationState)}
              </p>
              <p className="m-0 text-xs font-bold text-text-muted">
                Opening this sheet never requests location. Trip area and browser location are
                separate, and precise coordinates are not shown here.
              </p>
            </section>

            <MobileTripPassStateCard
              tripPassAccount={tripPassAccount}
              tripPassStatus={tripPassStatus}
              tripDataSource={tripDataSource}
            />

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
                className="h-11 rounded-md bg-brand-lagoon-700 px-4 text-sm font-extrabold text-white hover:bg-brand-lagoon-600 focus-visible:ring-2 focus-visible:ring-brand-lagoon-700 disabled:opacity-55"
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
                className="h-11 rounded-md bg-brand-lagoon-700 px-4 text-sm font-extrabold text-white"
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

function MobileTripPassStateCard({
  tripDataSource,
  tripPassAccount,
  tripPassStatus,
}: {
  tripDataSource: TripDataSource;
  tripPassAccount: TripPassAccountPresentation | null;
  tripPassStatus: TripPassAccountFetchState;
}) {
  const projection = projectMobileTripPass(tripPassAccount);
  const statusText =
    tripDataSource === "loading" || tripPassStatus === "loading"
      ? "Trip Pass status is loading."
      : tripDataSource !== "authenticated"
        ? "Sign in to view account Trip Pass status."
        : tripPassStatus === "unavailable"
          ? "Trip Pass status is temporarily unavailable. Your pass was not changed."
          : projection.status === "visible"
            ? projection.text
            : "Trip Pass status is available in settings.";
  const tone =
    tripPassStatus === "unavailable"
      ? "warning"
      : projection.status === "visible"
        ? projection.tone
        : "neutral";

  return (
    <section
      className={`grid gap-2 rounded-lg border p-3 ${mobileTripPassToneClass(tone)}`}
      data-testid="mobile-pass-state"
    >
      <h3 className="m-0 text-sm font-semibold text-text-strong">Trip Pass</h3>
      <p className="m-0 text-sm font-bold text-text-muted">{statusText}</p>
      {tripDataSource === "authenticated" ? (
        <p className="m-0 text-xs font-bold text-text-muted">
          Status comes from your account. Manage checkout and billing in settings.
        </p>
      ) : null}
    </section>
  );
}

function mobileTripPassToneClass(tone: "neutral" | "warning" | "critical") {
  if (tone === "critical") {
    return "border-brand-sunset-coral/45 bg-brand-sunset-coral/10";
  }
  if (tone === "warning") {
    return "border-brand-sunset-gold/55 bg-brand-sunset-gold/10";
  }
  return "border-border-default bg-white";
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
            <h3 className="m-0 text-sm font-semibold text-text-strong">{title}</h3>
            <p
              className="m-0 break-words text-base leading-tight font-semibold text-text-strong"
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

function useCompactChatHeaderViewport() {
  return useSyncExternalStore(
    (notify) => {
      const mediaQuery = window.matchMedia("(max-width: 1279px)");
      mediaQuery.addEventListener("change", notify);
      return () => {
        mediaQuery.removeEventListener("change", notify);
      };
    },
    () => window.matchMedia("(max-width: 1279px)").matches,
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
  onUpdateTripContext,
  tripContext,
  tripDataSource,
}: {
  liveConditions: LiveConditionsController;
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
      className="hidden min-h-0 content-start gap-1.5 overflow-hidden border-border-default/80 border-l bg-brand-paper-100/88 p-1.5 min-[1180px]:grid"
      data-testid="context-rail"
    >
      <ContextCard
        action={
          isEditing ? (
            <div className="flex items-center gap-2">
              <Button
                className="min-h-9 rounded-md border-border-default bg-white px-3 text-xs font-extrabold text-text-muted hover:bg-brand-lavender-50"
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
                className="min-h-9 rounded-md bg-brand-lagoon-700 px-3 text-xs font-extrabold text-white hover:bg-brand-lagoon-600"
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
              className="min-h-9 rounded-md border-brand-lagoon-700/20 bg-brand-lagoon-100 px-3 text-xs font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100"
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
            className="size-9 rounded-md border-border-default bg-white text-brand-lagoon-700 hover:bg-brand-lagoon-50"
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
        <div className="grid gap-1">
          <div className="flex items-center gap-3">
            <CloudSun aria-hidden="true" className="text-brand-lagoon-700" size={30} />
            <div className="min-w-0">
              <p
                className="m-0 text-base font-semibold leading-tight text-text-strong"
                data-testid="weather-condition-action"
              >
                {weatherDecision.action}
              </p>
            </div>
          </div>
          <ConditionDecisionDetails decision={weatherDecision} includeBasis />
        </div>
      </ContextCard>

      <ContextCard
        action={
          <Button
            aria-label="Refresh surf conditions"
            className="size-9 rounded-md border-border-default bg-white text-brand-lagoon-700 hover:bg-brand-lagoon-50"
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
        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 inline-flex min-w-0 items-center gap-2 text-base font-semibold text-text-strong">
              <WavesHorizontal aria-hidden="true" className="text-brand-lagoon-700" size={18} />
              {activeForecastLocation}
            </p>
          </div>
          <p
            className="m-0 text-sm font-semibold leading-tight text-text-strong"
            data-testid="surf-condition-action"
          >
            {surfDecision.action}
          </p>
          <ConditionDecisionDetails decision={surfDecision} includeBasis />
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
    <section className="grid gap-1.5 rounded-md border border-border-default/80 bg-white/78 p-2 shadow-none">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 min-w-0 text-sm font-semibold leading-tight text-text-strong">
          {title}
        </h2>
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
    <div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-1.5">
      <Icon aria-hidden="true" className="mt-0.5 text-brand-lagoon-700" size={16} />
      <div className="min-w-0">
        <p className="m-0 text-xs font-bold leading-tight text-text-muted">{label}</p>
        <p className="m-0 min-w-0 break-words text-xs font-semibold leading-tight text-text-strong">
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
    <div className="grid gap-2">
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
          className="h-11 rounded-md border border-border-default bg-white px-3 text-sm font-semibold text-text-strong outline-none focus:border-brand-violet-650"
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
        className="h-11 rounded-md border border-border-default bg-white px-3 text-sm font-semibold text-text-strong outline-none focus:border-brand-violet-650"
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
    <div className="grid min-h-10 content-center gap-0.5 rounded-md bg-brand-paper-150 px-2 py-1.5">
      <p className="m-0 text-xs font-bold leading-tight text-text-muted">{label}</p>
      <p className="m-0 text-xs font-semibold leading-tight text-text-strong">{value}</p>
    </div>
  );
}

function tripContextFacts({
  activeForecastLocation,
  tripContext,
}: {
  activeForecastLocation: ForecastLocationLabel;
  tripContext: TripContextDraft;
}): Array<{ icon: ChatContextIcon; label: string; value: string }> {
  return [
    ...tripContextDisplayFacts(tripContext).map((fact) => ({
      icon: iconForTripContextLabel(fact.label),
      label: fact.label,
      value: fact.value,
    })),
    { icon: CloudSun, label: "Forecast coverage", value: activeForecastLocation },
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

function ConditionDecisionDetails({
  decision,
  includeBasis = false,
}: {
  decision: LiveConditionDecision;
  includeBasis?: boolean;
}) {
  const presentation = projectConditionEvidencePresentation(decision);
  const [primaryBoundary, ...additionalBoundaries] = decision.notChecked;
  return (
    <div className="grid gap-2">
      {decision.timing ? (
        <p
          className="m-0 text-xs font-semibold text-brand-lagoon-700"
          data-testid={`${decision.kind}-condition-timing`}
        >
          Planning cue: {decision.timing}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {decision.supportingMetrics.map((item) => (
          <MetricTile key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
      <p
        className="m-0 text-sm leading-snug font-bold text-text-default"
        data-testid={`${decision.kind}-condition-fallback`}
      >
        <span className="font-semibold text-text-strong">Fallback: </span>
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
      {primaryBoundary ? (
        <p className="m-0 text-sm leading-snug font-bold text-text-caveat">
          <span className="font-extrabold">Limit: </span>
          {primaryBoundary}
        </p>
      ) : null}
      {includeBasis || decision.evidenceStatus || additionalBoundaries.length > 0 ? (
        <details className="group rounded-md border border-border-default bg-brand-paper-100 px-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-extrabold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650 min-[1180px]:min-h-10">
            Evidence and limits
            <ChevronDown
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
              size={15}
            />
          </summary>
          <div className="grid gap-2 border-border-default border-t py-3">
            {includeBasis ? (
              <p
                className="m-0 text-sm leading-snug font-bold text-text-muted"
                data-testid={`${decision.kind}-condition-basis`}
              >
                {decision.basis}
              </p>
            ) : null}
            {decision.evidenceStatus ? (
              <p
                className="m-0 text-xs leading-snug font-bold text-text-muted"
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
            {additionalBoundaries.length > 0 ? (
              <ul className="m-0 grid list-disc gap-1 pl-4 text-xs leading-snug font-bold text-text-muted">
                {additionalBoundaries.map((boundary) => (
                  <li key={boundary}>{boundary}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
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

async function fetchTripPassAccount(url: string): Promise<TripPassAccountPresentation> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("trip_pass_status_unavailable");
  }

  return (await response.json()) as TripPassAccountPresentation;
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

function chatResponseErrorMessage(status: number, body: ChatResponseErrorBody) {
  if (body.error === "usage_limit_reached") {
    if (body.reason?.includes("chat_meter_exhausted")) {
      return "Your Trip Pass travel answers are used. You can still use saved trip details.";
    }
    if (body.reason?.includes("concurrency")) {
      return "Another answer is still running. Wait for it to finish before starting another request.";
    }
    if (body.reason?.includes("start_limit") || body.reason?.includes("daily_limit")) {
      return "Chat is temporarily rate-limited. Try again after the current window resets.";
    }
    return "Your travel answer limit is reached for now.";
  }

  if (body.error === "sign_in_required") {
    if (body.reason?.includes("concurrency")) {
      return "Another free answer is still running. Wait for it to finish before trying again.";
    }
    if (body.reason?.includes("free_allowance_exhausted")) {
      return "Your free travel answers are used. Sign in to manage Trip Pass options.";
    }
    return "Sign in to continue after the free allowance window.";
  }

  if (body.error === "challenge_required") {
    return "Ask Siargao needs a quick browser verification before continuing. Refresh and try again.";
  }

  if (body.error === "rate_limited" || status === 429) {
    return "Requests are coming in too quickly. Wait a moment and try again.";
  }

  if (body.error === "model_budget_exhausted") {
    return "Ask Siargao hit a temporary provider cost limit before finishing. Try a narrower question later.";
  }

  return chatErrorMessage;
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

function savedItemKindLabel(kind: SavedTripItem["kind"]) {
  if (kind === "itinerary") {
    return "Itinerary";
  }
  return "Place";
}

function ChatAuthActions({ compact = false }: { compact?: boolean }) {
  const signedOutActions = (
    <>
      <SignInButton mode="modal">
        <Button
          className={cn(
            "rounded-md border-border-default bg-white text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50",
            compact ? "h-11 min-w-[4.5rem] px-3 text-sm" : "h-10 px-3",
          )}
          type="button"
          variant="outline"
        >
          Sign in
        </Button>
      </SignInButton>
      {!compact ? (
        <SignUpButton mode="modal">
          <Button
            className="h-10 rounded-md border-brand-lagoon-700/25 bg-brand-lagoon-50 px-3 text-xs font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100"
            type="button"
            variant="outline"
          >
            Sign up
          </Button>
        </SignUpButton>
      ) : null}
    </>
  );

  if (!isClerkConfigured) {
    return (
      <>
        <Button
          asChild
          className={cn(
            "rounded-md border-border-default bg-white text-xs font-extrabold text-text-strong hover:bg-brand-lavender-50",
            compact ? "h-11 min-w-[4.5rem] px-3 text-sm" : "h-10 px-3",
          )}
          variant="outline"
        >
          <Link href="/sign-in">Sign in</Link>
        </Button>
        {!compact ? (
          <Button
            asChild
            className="h-10 rounded-md border-brand-lagoon-700/25 bg-brand-lagoon-50 px-3 text-xs font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100"
            variant="outline"
          >
            <Link href="/sign-up">Sign up</Link>
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Show fallback={signedOutActions} when="signed-in">
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
  onEditPrompt,
  onRetryPrompt,
  onRateAssistantMessage,
  onRemoveSavedItem,
  onSaveItineraryPlan,
  onSaveRecommendationCard,
  onStopWaiting,
  onSubmitPrompt,
  recoveryConditions,
  savedItemIds,
}: {
  disabled: boolean;
  message: InteractiveChatMessage;
  onEditPrompt: (prompt: string) => void;
  onRateAssistantMessage: (messageId: string, rating: ChatResponseRatingValue) => void;
  onRetryPrompt: (prompt: string) => void;
  onRemoveSavedItem: (itemId: string) => void;
  onSaveItineraryPlan: (plan: ItineraryPlanArtifact) => void;
  onSaveRecommendationCard: (card: RecommendationCardArtifact) => void;
  onStopWaiting: (assistantMessageId: string) => void;
  onSubmitPrompt: (prompt: string) => void;
  recoveryConditions: LiveConditionsController;
  savedItemIds: ReadonlySet<string>;
}) {
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const isError = message.status === "error";
  const isStopped = message.status === "stopped";

  if (isUser) {
    return (
      <article
        className="min-w-0 max-w-[min(88%,42rem)] justify-self-end overflow-hidden rounded-lg border border-brand-lagoon-300/25 bg-brand-lagoon-700 px-5 py-4 text-white shadow-none"
        data-testid="user-message-bubble"
      >
        <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.55] font-extrabold [overflow-wrap:anywhere] sm:text-base">
          {message.text}
        </p>
        <time className="mt-2 block text-right text-xs font-semibold text-white/75">
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
            ? cn(
                appSurfacePanelClass,
                "min-w-0 overflow-hidden rounded-lg border-brand-sunset-coral/55 bg-brand-paper-50 px-5 py-4 text-text-strong",
              )
            : isStopped
              ? cn(
                  appSurfaceInsetClass,
                  "min-w-0 overflow-hidden rounded-lg bg-brand-lavender-50 px-5 py-4 text-text-strong",
                )
              : cn(
                  appSurfacePanelClass,
                  "min-w-0 overflow-hidden rounded-xl px-4 py-4 text-text-strong sm:px-5",
                )
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
                statusText={message.text}
              />
            ) : (
              <AssistantMarkdownText text={message.text} tone="default" />
            )}
            {isError ? <FailureEvidenceFallback liveConditions={recoveryConditions} /> : null}
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
                itineraries={message.itineraries ?? []}
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
          <time className="text-text-muted">{message.timestamp}</time>
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
        {isError && message.retryPrompt ? (
          <FailureRecoveryActions
            disabled={disabled}
            onEditPrompt={onEditPrompt}
            onRetryPrompt={onRetryPrompt}
            onSubmitPrompt={onSubmitPrompt}
            prompt={message.retryPrompt}
          />
        ) : null}
        {isStopped && message.retryPrompt ? (
          <Button
            className="mt-4 min-h-11 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
            disabled={disabled}
            onClick={() => onRetryPrompt(message.retryPrompt ?? "")}
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={13} />
            Retry question
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function FailureEvidenceFallback({ liveConditions }: { liveConditions: LiveConditionsController }) {
  const availableDecisions = [liveConditions.weatherDecision, liveConditions.surfDecision].filter(
    (decision) => decision.state !== "loading" && decision.state !== "unavailable",
  );

  if (availableDecisions.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Available planning cues"
      className="grid gap-2 rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-50 p-3"
    >
      <div className="grid gap-0.5">
        <h3 className="m-0 text-sm font-semibold text-text-strong">Available planning cues</h3>
        <p className="m-0 text-xs font-bold text-text-muted">
          These do not complete the Reality Check, but they can support a safer fallback.
        </p>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {availableDecisions.map((decision) => (
          <li className="grid gap-0.5" key={decision.kind}>
            <span className="text-xs font-extrabold text-brand-lagoon-700">
              {decision.kind === "weather" ? "Weather" : "Surf"}
            </span>
            <span className="text-sm font-semibold text-text-strong">{decision.action}</span>
            <span className="text-xs font-bold text-text-muted">Fallback: {decision.fallback}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FailureRecoveryActions({
  disabled,
  onEditPrompt,
  onRetryPrompt,
  onSubmitPrompt,
  prompt,
}: {
  disabled: boolean;
  onEditPrompt: (prompt: string) => void;
  onRetryPrompt: (prompt: string) => void;
  onSubmitPrompt: (prompt: string) => void;
  prompt: string;
}) {
  const boundedFallbackPrompt = `${prompt}\n\nIf current evidence is unavailable, give me a bounded needs-confirmation answer and the safest practical fallback using only evidence you can verify now.`;

  return (
    <div className="mt-4 flex flex-wrap gap-2" data-testid="failure-recovery-actions">
      <Button
        className="min-h-11 rounded-md bg-brand-lagoon-700 px-3 text-sm font-extrabold text-white hover:bg-brand-lagoon-600"
        disabled={disabled}
        onClick={() => onRetryPrompt(prompt)}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={15} />
        Retry last question
      </Button>
      <Button
        className="min-h-11 rounded-md border-brand-lagoon-700/25 bg-brand-lagoon-50 px-3 text-sm font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100"
        disabled={disabled}
        onClick={() => onSubmitPrompt(boundedFallbackPrompt)}
        type="button"
        variant="outline"
      >
        Use available evidence
      </Button>
      <Button
        className="min-h-11 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
        disabled={disabled}
        onClick={() => onEditPrompt(prompt)}
        type="button"
        variant="outline"
      >
        <Pencil aria-hidden="true" size={15} />
        Edit question
      </Button>
    </div>
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
        className={`size-11 rounded-md border-border-default hover:bg-brand-lavender-50 sm:size-9 ${
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
        className={`size-11 rounded-md border-border-default hover:bg-brand-lavender-50 sm:size-9 ${
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

function SelectedSavedItemStatus({
  item,
  selectedItemId,
  status,
}: {
  item: SavedTripItem | null;
  selectedItemId: string | null;
  status: "idle" | "loading" | "ready" | "not_found" | "error";
}) {
  if (!selectedItemId || status === "idle") {
    return null;
  }

  if (status === "loading") {
    return (
      <p className="m-0 text-sm font-bold text-text-muted" data-testid="selected-saved-item-status">
        Opening saved planning item.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="m-0 text-sm font-bold text-text-alert" data-testid="selected-saved-item-status">
        Saved planning is unavailable right now. The selected item was not opened.
      </p>
    );
  }

  if (status === "not_found" || !item) {
    return (
      <section
        aria-label="Saved planning item unavailable"
        className="rounded-lg border border-border-default bg-white p-4"
        data-testid="selected-saved-item-status"
      >
        <h2 className="m-0 text-base font-semibold text-text-strong">Saved item unavailable</h2>
        <p className="m-0 mt-1 text-sm font-bold text-text-muted">
          This saved planning item was not found for the current browser or signed-in account.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Selected saved planning item"
      className="rounded-lg border border-brand-violet-650 bg-brand-lagoon-100 p-4"
      data-testid="selected-saved-item-status"
    >
      <p className="m-0 text-xs font-semibold tracking-[0.08em] text-brand-violet-650 uppercase">
        Opened saved item
      </p>
      <h2 className="m-0 mt-1 text-base font-semibold text-text-strong">{item.title}</h2>
      <p className="m-0 mt-1 text-sm font-bold text-text-muted">
        {savedItemKindLabel(item.kind)} saved planning item.
      </p>
    </section>
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
  selectedSavedItemId,
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
  selectedSavedItemId: string | null;
  shareStatus: SavedPlanShareStatus;
  shareUrl: string | null;
}) {
  const selectedItemRef = useRef<HTMLFieldSetElement | null>(null);

  useEffect(() => {
    if (!selectedSavedItemId || !selectedItemRef.current) {
      return;
    }
    selectedItemRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    selectedItemRef.current.focus({ preventScroll: true });
  }, [selectedSavedItemId]);

  if (items.length === 0) {
    return null;
  }

  const isSharing = shareStatus === "syncing" || shareStatus === "creating";
  const hasSelectedItems = selectedItemCount > 0;

  return (
    <section
      aria-label="Saved plan"
      className={cn(appSurfaceInsetClass, "grid min-w-0 gap-3 rounded-lg p-3 text-text-strong")}
      data-testid="saved-plan-tray"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
            <BookmarkCheck aria-hidden="true" size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-semibold text-text-strong">Saved plan</h2>
            <p className="m-0 text-xs font-bold text-text-muted">
              {items.length} {items.length === 1 ? "item" : "items"} saved locally,{" "}
              {selectedItemCount} selected to share
            </p>
          </div>
        </div>
        <Button
          className="min-h-10 shrink-0 rounded-md border-brand-lagoon-700 bg-brand-lagoon-700 px-3 text-xs font-extrabold text-white hover:bg-brand-lagoon-600 disabled:opacity-55"
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
          const isSelected = selectedSavedItemId === item.id;

          return (
            <fieldset
              aria-current={isSelected ? "true" : undefined}
              className={cn(
                "grid min-w-[14rem] max-w-[19rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650",
                isSelected
                  ? "border-brand-violet-650 bg-brand-lagoon-100"
                  : "border-border-default bg-brand-lavender-50",
              )}
              data-testid="saved-plan-item"
              data-saved-item-selected={isSelected ? "true" : undefined}
              key={item.id}
              ref={isSelected ? selectedItemRef : null}
              tabIndex={isSelected ? 0 : -1}
            >
              <legend className="sr-only">
                {item.title}, {savedItemKindLabel(item.kind)} saved item
              </legend>
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
                className="size-11 shrink-0 rounded-md border-border-default bg-white text-text-muted hover:bg-brand-lavender-50 sm:size-9"
                onClick={() => onRemoveItem(item.id)}
                size="icon"
                type="button"
                variant="outline"
              >
                <Trash2 aria-hidden="true" size={14} />
              </Button>
            </fieldset>
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
            className="min-h-11 min-w-0 rounded-md border border-border-default bg-white px-3 text-sm font-bold text-text-strong outline-none sm:min-h-9 sm:text-xs"
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
      className={cn(appSurfaceInsetClass, "grid min-w-0 gap-3 rounded-md p-3")}
    >
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-text-strong">
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
                <span className="block text-xs leading-tight font-semibold text-text-muted">
                  {item.label}
                </span>
                <span className="block truncate text-xs font-semibold text-text-strong">
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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-xs leading-tight font-semibold text-brand-lagoon-700 uppercase">
              <Navigation aria-hidden="true" className="shrink-0" size={13} />
              {presentation.verdict ? "Reality check" : "Best move"}
            </span>
            {presentation.verdict ? (
              <span
                className={cn(
                  "inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-xs leading-none font-extrabold tracking-[0.04em] uppercase",
                  decisionVerdictToneClass(presentation.verdict.tone),
                )}
                data-testid="decision-strip-verdict"
              >
                <span className="sr-only">Verdict: </span>
                {presentation.verdict.label}
              </span>
            ) : null}
          </div>
          {presentation.summary.subject ? (
            <h3
              className="m-0 text-base leading-tight font-semibold break-words text-text-strong"
              data-testid="decision-strip-subject"
            >
              {presentation.summary.subject}
            </h3>
          ) : null}
          <p
            className={cn(
              "m-0 leading-[1.4] font-semibold break-words text-text-strong",
              presentation.summary.subject ? "text-sm" : "text-base leading-tight",
            )}
          >
            {presentation.summary.subject ? (
              <span className="text-text-muted">Best move: </span>
            ) : null}
            {presentation.summary.bestAction}
          </p>
        </div>
        {presentation.context.length ? (
          <dl className="m-0 grid min-w-0 gap-1.5 sm:grid-cols-2">
            {presentation.context.map((item) => (
              <div
                className="grid min-w-0 gap-0.5 rounded-md border border-brand-lagoon-700/15 bg-white px-2.5 py-2"
                key={item.label}
              >
                <dt className="text-xs leading-tight font-semibold text-text-muted uppercase">
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
              <span className="font-semibold text-text-strong">{item.label}: </span>
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
          <span className="font-semibold text-text-strong">
            {presentation.sourceStatus.label}:{" "}
          </span>
          {presentation.sourceStatus.value}
        </p>
      ) : null}
    </section>
  );
}

function decisionVerdictToneClass(tone: NonNullable<DecisionStripPresentation["verdict"]>["tone"]) {
  switch (tone) {
    case "positive":
      return "border-confidence-high/35 bg-confidence-high-soft text-confidence-high";
    case "caution":
      return "border-confidence-medium/35 bg-confidence-medium-soft text-confidence-medium";
    case "negative":
      return "border-brand-sunset-coral/40 bg-brand-sunset-coral/10 text-brand-sunset-coral";
    case "uncertain":
      return "border-text-muted/25 bg-surface-default text-text-muted";
  }
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
      <span className="inline-flex w-fit max-w-full items-center gap-1.5 text-xs leading-tight font-semibold text-brand-lagoon-700 uppercase">
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
                <h3 className="m-0 text-sm leading-[1.25] font-semibold break-words text-text-strong sm:text-base">
                  {plan.title}
                </h3>
                <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-border-default bg-white px-2.5 py-1 text-xs leading-tight font-extrabold text-text-muted">
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
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-brand-lagoon-700/15 bg-brand-lagoon-100 text-xs font-semibold text-brand-lagoon-700">
        {stop.sequence}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 min-w-0 text-sm leading-[1.3] font-semibold break-words text-text-strong">
            {stop.title}
          </h4>
          {stop.area ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-default bg-white px-2 py-1 text-xs leading-tight font-extrabold text-text-muted">
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
            className="inline-flex min-h-11 w-fit max-w-full items-center gap-2 rounded-md border border-brand-lagoon-700/25 bg-white px-3 py-2 text-sm font-extrabold text-brand-lagoon-700 no-underline hover:bg-brand-lagoon-100 sm:min-h-9 sm:text-xs"
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
      <h4 className="m-0 text-xs font-semibold text-text-strong">{title}</h4>
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
      <h4 className="m-0 text-xs font-semibold text-text-strong">Sources</h4>
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
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs leading-tight font-extrabold ${badge.className}`}
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
  return sourceEvidenceReceiptSummaryText(sources);
}

function SourceIconBadge({ source }: { source: ChatSourceArtifact }) {
  const badge = sourceBadgeInfo(source);
  const Icon = badge.icon;

  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs leading-tight font-extrabold ${badge.className}`}
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
      className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-brand-sunset-gold/30 bg-surface-caveat px-2.5 py-1 text-xs leading-tight font-extrabold text-text-caveat"
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

function trimTrailingPeriod(value: string) {
  return value.trim().replace(/\.$/, "");
}

function RecommendationCards({
  cards,
  itineraries,
  onRemoveSavedItem,
  onSaveRecommendationCard,
  savedItemIds,
}: {
  cards: readonly RecommendationCardArtifact[];
  itineraries: readonly ItineraryPlanArtifact[];
  onRemoveSavedItem: (itemId: string) => void;
  onSaveRecommendationCard: (card: RecommendationCardArtifact) => void;
  savedItemIds: ReadonlySet<string>;
}) {
  const presentation = projectRecommendationSet({ cards, itineraries });

  if (presentation.cards.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Recommended places"
      className="grid min-w-0 gap-3 p-0 shadow-none"
      data-testid="recommendation-cards"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-text-strong">
          <Utensils aria-hidden="true" className="text-brand-sunset-gold" size={17} />
          Recommended Places
        </h3>
        <RecommendationSourceBadge cards={presentation.cards.map(({ card }) => card)} />
      </div>
      {presentation.cards.map((cardPresentation) => {
        const { card } = cardPresentation;
        const savedItemId = savedItemIdForCard(card);
        const isSaved = savedItemIds.has(savedItemId);
        const subtitle = compactRecommendationSubtitle(card.subtitle);

        return (
          <article
            className={cn(
              appSurfaceInsetClass,
              "grid min-w-0 gap-3 rounded-md p-3",
              cardPresentation.isPrimary
                ? "border-brand-lagoon-700/25 bg-brand-lagoon-100"
                : "bg-white",
            )}
            data-testid="recommendation-card"
            data-recommendation-role={cardPresentation.role}
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
                  <h4 className="m-0 text-sm leading-[1.25] font-semibold break-words text-text-strong sm:text-base">
                    {card.title}
                  </h4>
                  {presentation.hasComparison || cardPresentation.isPrimary ? (
                    <RecommendationRoleBadge presentation={cardPresentation} />
                  ) : null}
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

              <p className="m-0 text-xs leading-[1.45] break-words text-text-default sm:text-sm">
                <span className="font-semibold text-text-strong">Why this fits:</span>{" "}
                {cardPresentation.fitRationale}
              </p>

              {card.mapsUrl ? (
                <a
                  aria-label={`Open ${card.title} in Google Maps`}
                  className="inline-flex min-h-11 w-fit max-w-full items-center gap-2 rounded-md border border-brand-lagoon-700/15 bg-brand-lagoon-100 px-3 py-2 text-sm font-extrabold text-brand-lagoon-700 no-underline hover:bg-brand-lagoon-100 sm:min-h-9 sm:text-xs"
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

function RecommendationRoleBadge({
  presentation,
}: {
  presentation: RecommendationCardPresentation;
}) {
  return (
    <span
      className={
        presentation.isPrimary
          ? "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md bg-brand-lagoon-100 px-2.5 py-1 text-xs leading-tight font-semibold text-brand-lagoon-700"
          : "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-border-default bg-brand-lavender-50 px-2.5 py-1 text-xs leading-tight font-extrabold text-text-muted"
      }
      data-testid="recommendation-role"
    >
      <span className="min-w-0 break-words">{presentation.roleLabel}</span>
    </span>
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
          ? "size-11 shrink-0 rounded-md border-brand-lagoon-300/35 bg-brand-lagoon-500 text-brand-navy-980 hover:bg-brand-lagoon-300 sm:size-9"
          : "size-11 shrink-0 rounded-md border-border-default bg-white text-text-muted hover:bg-brand-lavender-50 sm:size-9"
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
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-default bg-brand-lavender-50 px-2.5 py-1.5 text-xs leading-tight font-extrabold text-text-muted">
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
            className="h-auto min-h-11 rounded-md border-border-default bg-white px-3 py-2 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50 sm:min-h-9 sm:text-xs"
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
            className="h-auto min-h-11 rounded-md border-brand-lagoon-700/20 bg-brand-lagoon-50 px-3 py-2 text-sm font-extrabold text-brand-lagoon-700 hover:bg-brand-lagoon-100 sm:min-h-9 sm:text-xs"
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
  const receiptItems = sourceEvidenceReceiptItems(sources);
  if (receiptItems.length === 0) {
    return null;
  }

  return (
    <details
      className="group rounded-md border border-border-default bg-brand-lavender-50 p-3"
      data-testid="assistant-sources-panel"
    >
      <summary
        aria-label="Evidence receipt"
        className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650"
      >
        <span className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-text-strong">
            <ShieldCheck aria-hidden="true" className="text-brand-lagoon-700" size={16} />
            Evidence receipt
          </span>
          <span className="min-w-0 text-xs font-bold text-text-muted">
            {sourceSummaryText(sources)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-white px-2.5 py-1.5 text-xs font-semibold text-text-muted">
          View receipt
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
            size={14}
          />
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        {receiptItems.map(({ fetchedAtValues, presentation, source }) => (
          <div
            className="grid gap-1 rounded-md border border-border-default bg-white p-3"
            key={chatSourceKey(source)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceIconBadge source={source} />
              <span className="text-xs font-semibold text-text-strong">
                {sourceEvidenceDisplayName(source)}
              </span>
              {source.confidence ? (
                <span className="text-xs font-bold text-text-muted">
                  {source.confidence} confidence
                </span>
              ) : null}
            </div>
            {presentation.checkedScope.length > 0 && presentation.state === "checked" ? (
              <p className="m-0 text-xs leading-[1.45] text-text-muted">
                <span className="font-semibold text-text-strong">Checked fields:</span>{" "}
                {formatReceiptList(presentation.checkedScope)}
              </p>
            ) : null}
            {presentation.notCheckedScope.length > 0 ? (
              <p className="m-0 text-xs leading-[1.45] text-text-muted">
                <span className="font-semibold text-text-strong">Not checked:</span>{" "}
                {formatReceiptList(presentation.notCheckedScope)}
              </p>
            ) : null}
            {fetchedAtValues.length ? (
              <p className="m-0 text-xs font-bold text-text-muted">
                Checked{" "}
                {fetchedAtValues
                  .flatMap((value) => {
                    const formatted = formatEvidenceReceiptTime(value);
                    return formatted ? [formatted] : [];
                  })
                  .join(", ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function formatReceiptList(values: readonly string[]) {
  return values.join(", ");
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
              className={`m-0 max-w-full text-sm leading-[1.35] font-semibold break-words sm:text-base ${strongClass}`}
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
              className={`${listClass} list-outside list-decimal marker:font-semibold marker:text-brand-violet-650`}
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
                  className={`border-border-default border-b px-3 py-2 align-top font-semibold ${tableTextAlignmentClass(block.alignments[index])}`}
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
                  className={`text-xs leading-tight font-semibold text-text-muted uppercase ${tableTextAlignmentClass(cell.alignment)}`}
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
    <footer className="border-border-default border-t bg-white px-4 py-2 sm:px-6 lg:px-8">
      <form
        aria-label="Ask Siargao composer"
        className="mx-auto w-full max-w-5xl min-w-0"
        onSubmit={handleSubmit}
      >
        <InputGroup className="min-h-14 items-start rounded-lg border-border-default bg-white p-1.5 text-text-strong shadow-none ring-1 ring-border-default">
          <textarea
            data-slot="input-group-control"
            aria-label="Ask anything about Siargao"
            className="min-w-0 max-h-32 min-h-11 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent px-3 py-2.5 text-base leading-6 whitespace-pre-wrap text-text-strong caret-brand-lagoon-700 shadow-none outline-none [field-sizing:content] [overflow-wrap:anywhere] placeholder:text-text-soft focus-visible:ring-0 disabled:bg-transparent disabled:text-text-muted"
            data-testid="chat-composer-input"
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
            placeholder="Reality-check a Siargao plan…"
            ref={textareaRef}
            rows={1}
            value={inputValue}
          />
          <InputGroupAddon align="inline-end" className="shrink-0 gap-1 pt-0">
            <LocationSharingControl
              disabled={isSending}
              locationState={locationState}
              onRequestLocation={onRequestLocation}
              onTurnOffLocation={onTurnOffLocation}
            />
            <InputGroupButton
              aria-label="Send question"
              className="size-11 rounded-md bg-brand-lagoon-700 text-white hover:bg-brand-lagoon-600 disabled:opacity-50"
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
      <div className="min-w-0">
        <Dialog.Trigger asChild>
          <Button
            aria-label={`Location sharing: ${label}. ${summary}`}
            className="relative size-11 rounded-md border-border-default bg-brand-lavender-50 p-0 text-text-strong hover:bg-brand-lavender-100 focus-visible:ring-2 focus-visible:ring-brand-violet-650"
            data-testid="location-sharing-trigger"
            size="icon"
            type="button"
            variant="outline"
          >
            {isRequesting ? (
              <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin" size={16} />
            ) : (
              <MapPin aria-hidden="true" className="shrink-0 text-brand-violet-650" size={16} />
            )}
            <span className="sr-only">
              Location: {label}. {summary}
            </span>
            {locationState.status === "ready" || locationState.status === "requesting" ? (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 size-2 rounded-full bg-brand-lagoon-500 ring-2 ring-white"
              />
            ) : null}
          </Button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-navy-980/45" />
        <Dialog.Content
          className={cn(
            appSurfaceOverlayClass,
            "fixed right-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 z-50 grid max-h-[min(78dvh,30rem)] gap-4 overflow-y-auto p-4 text-text-strong focus:outline-none sm:right-auto sm:left-1/2 sm:w-[min(28rem,calc(100vw-2rem))] sm:-translate-x-1/2",
          )}
          data-testid="location-sharing-dialog"
        >
          <div className="grid gap-1">
            <Dialog.Title className="m-0 text-base font-semibold text-text-strong">
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
              className="h-auto min-h-11 justify-start rounded-md bg-brand-lagoon-700 px-3 py-2 text-sm font-extrabold text-white hover:bg-brand-lagoon-600 disabled:opacity-55"
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
                className="min-h-11 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
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
                className="min-h-11 rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-muted hover:bg-brand-lavender-50"
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
      className="m-0 grid w-full min-w-0 gap-2 overflow-hidden border-0 p-0 sm:flex sm:flex-wrap sm:overflow-visible"
    >
      {prompts.map((prompt) => (
        <Button
          className="h-auto min-h-11 w-full min-w-0 max-w-full shrink items-start justify-start overflow-hidden rounded-lg border-border-default bg-white px-4 py-2.5 text-left text-sm leading-snug font-extrabold whitespace-normal text-brand-lagoon-700 hover:bg-brand-lagoon-50 sm:w-auto sm:items-center sm:rounded-full sm:py-2 sm:whitespace-nowrap"
          disabled={disabled}
          key={prompt}
          onClick={() => onSubmitPrompt(prompt)}
          type="button"
          variant="outline"
        >
          <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] sm:truncate">
            {prompt}
          </span>
        </Button>
      ))}
    </fieldset>
  );
}

function FollowUpPromptDisclosure({
  onSubmitPrompt,
  prompts,
}: {
  onSubmitPrompt: (prompt: string) => void;
  prompts: readonly string[];
}) {
  return (
    <details className="group grid gap-3 rounded-lg border border-border-default bg-brand-paper-100 px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-extrabold text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-violet-650">
        Try another Reality Check
        <ChevronDown
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
          size={16}
        />
      </summary>
      <div className="border-border-default border-t py-3">
        <SuggestedPromptBar disabled={false} onSubmitPrompt={onSubmitPrompt} prompts={prompts} />
      </div>
    </details>
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
          <h2 className="m-0 max-w-full text-3xl leading-[1.05] font-semibold break-words text-text-strong [overflow-wrap:anywhere] sm:text-5xl">
            Reality-check your Siargao plan.
          </h2>
          <p className="m-0 max-w-xl text-base leading-[1.7] break-words text-text-muted">
            Tell us what you are considering. Ask Siargao will separate checked facts, practical
            judgment, and what still needs local confirmation.
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

function sanitizeResourceId(value: string | undefined | null) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue.slice(0, 160) : null;
}

function readChatResourceQuery() {
  if (typeof window === "undefined") {
    return { savedItemId: null, threadId: null };
  }
  const searchParams = new URLSearchParams(window.location.search);
  return {
    savedItemId: sanitizeResourceId(searchParams.get("savedItemId")),
    threadId: sanitizeResourceId(searchParams.get("threadId")),
  };
}

function writeChatResourceQuery(
  resource: { savedItemId?: string | null; threadId?: string | null },
  mode: "push" | "replace",
) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("prompt");
  url.searchParams.delete("savedItemId");
  url.searchParams.delete("threadId");
  if (resource.threadId) {
    url.searchParams.set("threadId", resource.threadId);
  } else if (resource.savedItemId) {
    url.searchParams.set("savedItemId", resource.savedItemId);
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") {
    window.history.replaceState(null, "", nextUrl);
    return;
  }
  window.history.pushState(null, "", nextUrl);
}

function upsertThreadSummary(threads: readonly ChatThreadSummary[], nextThread: ChatThreadSummary) {
  const nextThreads = threads.filter((thread) => thread.id !== nextThread.id);
  if (!nextThread.archivedAt) {
    nextThreads.unshift(nextThread);
  }
  return nextThreads;
}

function threadMutationErrorMessage(status: number) {
  if (status === 401) {
    return "Your session expired. Sign in again before changing this chat.";
  }
  if (status === 404) {
    return "This chat is unavailable for the current account.";
  }
  if (status === 400) {
    return "Review the title and try again.";
  }
  return "The chat was not changed. Try again.";
}

function chatThreadTitleFromPrompt(prompt: string) {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
  return normalizedPrompt.length <= 80 ? normalizedPrompt : `${normalizedPrompt.slice(0, 77)}...`;
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

function shouldRequestAutomaticLocationForPrompt(
  prompt: string,
  locationState: LocationSharingState,
) {
  if (locationState.status !== "off" && locationState.status !== "used") {
    return false;
  }

  return /\bnear\s+me\b|\baround\s+me\b|\bclose\s+to\s+me\b|\bnearby\b/i.test(prompt);
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
