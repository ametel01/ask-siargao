"use client";

/*
 * Hallmark - pre-emit critique: P4 H4 E4 S5 R4 V4
 * genre: modern-minimal; macrostructure: account console; contrast/mobile: pass.
 */
import { SignInButton, SignUpButton, useClerk, useReverification, useUser } from "@clerk/nextjs";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  LoaderCircle,
  MapPinned,
  MessageCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import { clearSavedTripState } from "@/features/chat/saved-trip-client";
import { clearStoredTripLocationContext } from "@/features/chat/trip-context-draft";
import {
  type AccountClosureClientStatus,
  accountClosureConfirmation,
  accountClosureFailureStatus,
  accountClosureStatusMessages,
  accountClosureWarnings,
} from "@/features/settings/account-closure-copy";
import { accountIdentityFromProfile } from "@/features/settings/account-identity";
import { createAccountManagementAdapter } from "@/features/settings/account-management";
import type { WeatherPreference } from "@/features/settings/profile-options";
import {
  addMultiValue,
  budgetLevelOptions,
  currentAreaOptions,
  foodNeedOptions,
  groupNeedOptions,
  isOptionValue,
  legacyOptionLabel,
  optionValueOrLegacy,
  profileLegacyAliases,
  surfAbilityOptions,
  transportModeOptions,
  travelerTypeOptions,
  weatherPreferenceOptions,
} from "@/features/settings/profile-options";
import {
  projectTripPassAccountView,
  type TripPassAccountFetchState,
} from "@/features/trip-pass/account-presentation";
import { motionAwareScrollBehavior } from "@/lib/motion";
import type { ChatHistoryThread } from "@/server/chat/chat-history-store";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";
import type { TripPassAccountPresentation } from "@/server/trip-pass/presentation";
import type { SavedTripItem } from "@/server/trips/shared-trip-types";
import {
  appBodyClass,
  appSurfaceOverlayClass,
  appSurfacePanelClass,
  BrandHeader,
  PageHeader,
} from "@/ui/components/ask-siargao";

type ProfileFormState = {
  displayName: string;
  homeCountry: string;
  travelStyle: string;
  budgetLevel: string;
  dietaryNotes: string;
  accessibilityNotes: string;
  interests: string[];
  preferredAreas: string[];
  foodNeeds: string[];
  surfAbility: string;
  quietSleepPreference: boolean | null;
  weatherPreference: "" | WeatherPreference;
  accommodation: string;
  dateRange: string;
  currentArea: string;
  travelerType: string;
  transportMode: string;
  rideTimeLimitMinutes: string;
  durableConstraints: string[];
  tripNotes: string;
  marketingConsent: boolean;
};

type PrivateSummaryStatus = "idle" | "loading" | "ready" | "error";
type TripBriefSection = "current-trip" | "traveler-preferences" | "account" | "privacy" | "pass";
type ProfileFieldErrors = Record<string, string>;
type ProfileSaveState = "idle" | "saving" | "saved" | "error";

type ProfileEditorState = {
  fieldErrors: ProfileFieldErrors;
  form: ProfileFormState;
  isDirty: boolean;
  profile: UserProfileResponse | null;
  saveError: string | null;
  saveState: ProfileSaveState;
};

type ProfileEditorAction =
  | { type: "profileUnavailable" }
  | { type: "profileLoaded"; profile: UserProfileResponse }
  | { type: "formChanged"; update: (current: ProfileFormState) => ProfileFormState }
  | { type: "saveStarted" }
  | { type: "saveAbandoned" }
  | { type: "saveFailed"; error: string; fieldErrors?: ProfileFieldErrors }
  | { type: "saveCompleted"; profile: UserProfileResponse; editsChanged: boolean }
  | { type: "profileReplaced"; profile: UserProfileResponse };

type ChatThreadsResponse = {
  threads: ChatHistoryThread[];
};

type SavedTripsResponse = {
  tripId?: string;
  items: SavedTripItem[];
};

type ProfileErrorResponse = {
  issues?: { path?: string; message?: string }[];
};

type PrivacyActionResponse = {
  action: "delete_chat_history" | "delete_saved_planning_data" | "clear_location_context";
  status: "success" | "already_empty";
  counts: {
    chatRatingsDeleted?: number;
    chatMessagesDeleted?: number;
    chatThreadsDeleted?: number;
    savedTripsDeleted?: number;
    savedItemsDeleted?: number;
    sharedPlansInvalidated?: number;
    profileFieldsCleared?: number;
  };
  profile?: UserProfileResponse;
  requestId: string;
};

type ProfileCacheKey = string | readonly ["/api/me/profile", string] | null;
type AuthProfileStatus = "unknown" | "loading" | "authenticated" | "unauthenticated";

const emptyForm: ProfileFormState = {
  displayName: "",
  homeCountry: "",
  travelStyle: "",
  budgetLevel: "",
  dietaryNotes: "",
  accessibilityNotes: "",
  interests: [],
  preferredAreas: [],
  foodNeeds: [],
  surfAbility: "",
  quietSleepPreference: null,
  weatherPreference: "",
  accommodation: "",
  dateRange: "",
  currentArea: "",
  travelerType: "",
  transportMode: "",
  rideTimeLimitMinutes: "",
  durableConstraints: [],
  tripNotes: "",
  marketingConsent: false,
};

const initialProfileEditorState: ProfileEditorState = {
  fieldErrors: {},
  form: emptyForm,
  isDirty: false,
  profile: null,
  saveError: null,
  saveState: "idle",
};

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function profileEditorReducer(
  state: ProfileEditorState,
  action: ProfileEditorAction,
): ProfileEditorState {
  switch (action.type) {
    case "profileUnavailable":
      return { ...state, profile: null };
    case "profileLoaded":
      return {
        ...state,
        profile: action.profile,
        form: state.isDirty ? state.form : formFromProfile(action.profile),
      };
    case "formChanged":
      return {
        ...state,
        fieldErrors: {},
        form: action.update(state.form),
        isDirty: true,
        saveError: null,
        saveState: state.saveState === "saving" ? "saving" : "idle",
      };
    case "saveStarted":
      return { ...state, fieldErrors: {}, saveError: null, saveState: "saving" };
    case "saveAbandoned":
      return { ...state, saveState: "idle" };
    case "saveFailed":
      return {
        ...state,
        fieldErrors: action.fieldErrors ?? state.fieldErrors,
        saveError: action.error,
        saveState: "error",
      };
    case "saveCompleted":
      return action.editsChanged
        ? { ...state, profile: action.profile, saveState: "idle" }
        : {
            ...state,
            form: formFromProfile(action.profile),
            isDirty: false,
            profile: action.profile,
            saveState: "saved",
          };
    case "profileReplaced":
      return {
        ...state,
        fieldErrors: {},
        form: formFromProfile(action.profile),
        isDirty: false,
        profile: action.profile,
        saveError: null,
        saveState: "idle",
      };
  }
}

const settingsWorkspaceClass =
  "grid w-full max-w-none gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7 2xl:px-10";

const settingsPanelClass = `${appSurfacePanelClass} p-5 md:p-6`;

const summaryDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Manila",
});

class ProfileFetchError extends Error {
  constructor(readonly status: number) {
    super("Profile could not be loaded.");
  }
}

async function fetchProfile(key: Exclude<ProfileCacheKey, null>) {
  const url = Array.isArray(key) ? key[0] : key;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new ProfileFetchError(response.status);
  }

  return (await response.json()) as UserProfileResponse;
}

async function fetchTripPassAccount(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("trip_pass_status_unavailable");
  }

  return (await response.json()) as TripPassAccountPresentation;
}

function profileCacheFingerprint(key: ProfileCacheKey): string {
  if (!key) {
    return "none";
  }
  if (typeof key === "string") {
    return key;
  }

  return `${key[0]}:${key[1]}`;
}

async function fetchChatThreads(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Chat history could not be loaded.");
  }

  return (await response.json()) as ChatThreadsResponse;
}

async function fetchSavedTrips(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Saved plan could not be loaded.");
  }

  return (await response.json()) as SavedTripsResponse;
}

export function SettingsDashboardPage() {
  if (isClerkConfigured) {
    return <ConfiguredSettingsDashboardPage />;
  }

  return <SettingsDashboardContent authStatus="unknown" profileCacheKey="/api/me/profile" />;
}

function ConfiguredSettingsDashboardPage() {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const manageAccountButtonRef = useRef<HTMLButtonElement>(null);
  const accountManagement = useMemo(
    () =>
      createAccountManagementAdapter({
        focusTrigger: () => {
          manageAccountButtonRef.current?.focus();
        },
        openAccountManagement: (props) => {
          clerk.openUserProfile(props);
        },
      }),
    [clerk],
  );
  const profileCacheKey = useMemo<ProfileCacheKey>(
    () => (isLoaded && isSignedIn && user?.id ? ["/api/me/profile", user.id] : null),
    [isLoaded, isSignedIn, user?.id],
  );
  const authStatus: AuthProfileStatus = !isLoaded
    ? "loading"
    : isSignedIn
      ? "authenticated"
      : "unauthenticated";

  useEffect(() => {
    return () => {
      accountManagement.stopWatching();
    };
  }, [accountManagement]);

  return (
    <SettingsDashboardContent
      authStatus={authStatus}
      key={profileCacheFingerprint(profileCacheKey)}
      manageAccountButtonRef={manageAccountButtonRef}
      profileCacheKey={profileCacheKey}
      onManageAccount={accountManagement.open}
    />
  );
}

function SettingsDashboardContent({
  authStatus,
  manageAccountButtonRef,
  onManageAccount,
  profileCacheKey,
}: {
  authStatus: AuthProfileStatus;
  manageAccountButtonRef?: RefObject<HTMLButtonElement | null>;
  onManageAccount?: () => void;
  profileCacheKey: ProfileCacheKey;
}) {
  const {
    data: loadedProfile,
    error: profileError,
    isLoading: isProfileLoading,
  } = useSWR(profileCacheKey, fetchProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [editor, dispatchEditor] = useReducer(profileEditorReducer, initialProfileEditorState);
  const { fieldErrors, form, isDirty, profile, saveError, saveState } = editor;
  const [activeSection, setActiveSection] = useState<TripBriefSection>("current-trip");
  const editVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const currentProfile = profile;
  const shouldLoadPrivateSummaries = Boolean(currentProfile);
  const {
    data: chatThreads,
    error: chatThreadsError,
    isLoading: isChatThreadsLoading,
    mutate: refreshChatThreads,
  } = useSWR(shouldLoadPrivateSummaries ? "/api/chat/threads" : null, fetchChatThreads, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: savedTrips,
    error: savedTripsError,
    isLoading: isSavedTripsLoading,
    mutate: refreshSavedTrips,
  } = useSWR(shouldLoadPrivateSummaries ? "/api/trips/saved" : null, fetchSavedTrips, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    const syncActiveSection = () => {
      const section = sectionFromHash(window.location.hash);
      if (section) {
        setActiveSection(section);
      }
    };
    syncActiveSection();
    window.addEventListener("hashchange", syncActiveSection);
    window.addEventListener("popstate", syncActiveSection);
    return () => {
      window.removeEventListener("hashchange", syncActiveSection);
      window.removeEventListener("popstate", syncActiveSection);
    };
  }, []);

  useEffect(() => {
    if (authStatus === "loading") {
      return;
    }
    if (!profileCacheKey || profileError || authStatus === "unauthenticated") {
      dispatchEditor({ type: "profileUnavailable" });
      return;
    }
    if (!loadedProfile) {
      return;
    }

    dispatchEditor({ type: "profileLoaded", profile: loadedProfile });
  }, [authStatus, loadedProfile, profileCacheKey, profileError]);

  function updateForm(update: (current: ProfileFormState) => ProfileFormState) {
    editVersionRef.current += 1;
    dispatchEditor({ type: "formChanged", update });
  }

  function activateSection(section: TripBriefSection) {
    setActiveSection(() => section);
    window.history.pushState(null, "", `#${section}`);
    const target = document.getElementById(section);
    target?.scrollIntoView({ behavior: motionAwareScrollBehavior(), block: "start" });
    target?.focus({ preventScroll: true });
  }

  const status = profileLoadStatus({
    authStatus,
    error: profileError,
    isLoading: isProfileLoading,
    profile: currentProfile,
  });

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlightRef.current) {
      return;
    }
    saveInFlightRef.current = true;
    dispatchEditor({ type: "saveStarted" });
    const savedEditVersion = editVersionRef.current;

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profilePatchFromForm(form, currentProfile)),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as ProfileErrorResponse | null;
        if (editVersionRef.current !== savedEditVersion) {
          dispatchEditor({ type: "saveAbandoned" });
          return;
        }
        const issues = profileFieldErrors(errorBody?.issues);
        dispatchEditor({
          type: "saveFailed",
          error: Object.keys(issues).length
            ? "Review the highlighted fields and try again."
            : "Check your entries and try again.",
          fieldErrors: issues,
        });
        return;
      }

      const nextProfile = (await response.json()) as UserProfileResponse;
      dispatchEditor({
        type: "saveCompleted",
        profile: nextProfile,
        editsChanged: editVersionRef.current !== savedEditVersion,
      });
    } catch {
      if (editVersionRef.current !== savedEditVersion) {
        dispatchEditor({ type: "saveAbandoned" });
        return;
      }
      dispatchEditor({
        type: "saveFailed",
        error: "Your changes are still here. Check your connection and try again.",
      });
    } finally {
      saveInFlightRef.current = false;
    }
  }

  return (
    <main
      className="min-h-screen overflow-x-clip bg-brand-lavender-50 text-text-default"
      id="main-content"
      tabIndex={-1}
    >
      <section className="bg-brand-navy-980 text-text-on-dark">
        <div className={settingsWorkspaceClass}>
          <SettingsHeader />
        </div>
      </section>

      <section className={settingsWorkspaceClass}>
        {status === "loading" ? (
          <StatusPanel title="Loading settings" />
        ) : status === "unauthenticated" ? (
          <SignedOutPanel />
        ) : status === "error" || !currentProfile ? (
          <StatusPanel title="Settings unavailable" />
        ) : (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
            <SettingsSidebar
              activeSection={activeSection}
              manageAccountButtonRef={manageAccountButtonRef}
              onActivate={activateSection}
              onManageAccount={onManageAccount}
              onProfileUpdated={(nextProfile) => {
                dispatchEditor({ type: "profileReplaced", profile: nextProfile });
              }}
              onRefreshPrivateSummaries={() => {
                void refreshChatThreads();
                void refreshSavedTrips();
              }}
              profile={currentProfile}
            />
            <div className="grid min-w-0 gap-6">
              <PrivatePlanningDataSection
                chatStatus={privateSummaryStatus({
                  data: chatThreads,
                  error: chatThreadsError,
                  isLoading: isChatThreadsLoading,
                })}
                savedStatus={privateSummaryStatus({
                  data: savedTrips,
                  error: savedTripsError,
                  isLoading: isSavedTripsLoading,
                })}
                savedItems={savedTrips?.items ?? []}
                threads={chatThreads?.threads ?? []}
              />
              <form className="grid min-w-0 gap-6" onSubmit={saveProfile}>
                <TravelProfileSection
                  form={form}
                  fieldErrors={fieldErrors}
                  isDirty={isDirty}
                  saveError={saveError}
                  saveState={saveState}
                  setForm={updateForm}
                />
              </form>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function PrivatePlanningDataSection({
  chatStatus,
  savedItems,
  savedStatus,
  threads,
}: {
  chatStatus: PrivateSummaryStatus;
  savedItems: SavedTripItem[];
  savedStatus: PrivateSummaryStatus;
  threads: ChatHistoryThread[];
}) {
  return (
    <section className="grid min-w-0 gap-4 min-[1500px]:grid-cols-2">
      <ChatHistorySummaryPanel status={chatStatus} threads={threads} />
      <SavedPlanSummaryPanel items={savedItems} status={savedStatus} />
    </section>
  );
}

function ChatHistorySummaryPanel({
  status,
  threads,
}: {
  status: PrivateSummaryStatus;
  threads: ChatHistoryThread[];
}) {
  const activeThreads = threads.filter((thread) => !thread.archivedAt);
  const recentThreads = activeThreads.slice(0, 3);

  return (
    <section className={`${settingsPanelClass} grid min-h-64 content-start gap-4`}>
      <SummaryPanelHeader
        description={summaryCountLabel(activeThreads.length, "private thread")}
        icon={<MessageCircle className="size-5" />}
        title="Recent chat history"
      />
      <SummaryPanelBody
        emptyText="No saved chat threads yet."
        errorText="Chat history unavailable"
        hasContent={recentThreads.length > 0}
        loadingText="Loading chat history"
        status={status}
      >
        <div className="grid gap-3">
          {recentThreads.map((thread) => (
            <Link
              className="grid gap-1 rounded-md border border-transparent p-2 text-text-default no-underline outline-none hover:border-border-default hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
              href={`/chat?threadId=${encodeURIComponent(thread.id)}`}
              key={thread.id}
            >
              <h3 className="m-0 min-w-0 truncate text-sm font-semibold">
                Open chat: {thread.title}
              </h3>
              <p className="m-0 text-xs font-bold text-text-muted">
                {formatSummaryTimestamp(thread.lastMessageAt ?? thread.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      </SummaryPanelBody>
      <Button
        asChild
        className="h-auto min-h-11 w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
        variant="outline"
      >
        <Link href="/chat">Open chat</Link>
      </Button>
    </section>
  );
}

function SavedPlanSummaryPanel({
  items,
  status,
}: {
  items: SavedTripItem[];
  status: PrivateSummaryStatus;
}) {
  const recentItems = items
    .toSorted(
      (left, right) => timestampSortValue(right.updatedAt) - timestampSortValue(left.updatedAt),
    )
    .slice(0, 3);

  return (
    <section className={`${settingsPanelClass} grid min-h-64 content-start gap-4`}>
      <SummaryPanelHeader
        description={summaryCountLabel(items.length, "saved item")}
        icon={<MapPinned className="size-5" />}
        title="Saved planning items"
      />
      <SummaryPanelBody
        emptyText="No saved places or plans yet."
        errorText="Saved plan unavailable"
        hasContent={recentItems.length > 0}
        loadingText="Loading saved plan"
        status={status}
      >
        <div className="grid gap-3">
          {recentItems.map((item) => (
            <Link
              className="grid gap-1 rounded-md border border-transparent p-2 text-text-default no-underline outline-none hover:border-border-default hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
              href={`/chat?savedItemId=${encodeURIComponent(item.id)}`}
              key={item.id}
            >
              <h3 className="m-0 min-w-0 truncate text-sm font-semibold">
                Open saved item: {item.title}
              </h3>
              <p className="m-0 text-xs font-bold text-text-muted">
                {savedItemKindLabel(item.kind)} saved {formatSummaryTimestamp(item.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      </SummaryPanelBody>
      <Button
        asChild
        className="h-auto min-h-11 w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
        variant="outline"
      >
        <Link href="/chat">Open saved plan</Link>
      </Button>
    </section>
  );
}

function SummaryPanelHeader({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 text-sm font-bold text-text-muted">{description}</p>
      </div>
    </div>
  );
}

function SummaryPanelBody({
  children,
  emptyText,
  errorText,
  hasContent,
  loadingText,
  status,
}: {
  children: ReactNode;
  emptyText: string;
  errorText: string;
  hasContent: boolean;
  loadingText: string;
  status: PrivateSummaryStatus;
}) {
  if (status === "loading" || status === "idle") {
    return <p className="m-0 text-sm font-bold text-text-muted">{loadingText}</p>;
  }
  if (status === "error") {
    return <p className="m-0 text-sm font-bold text-risk-high-foreground">{errorText}</p>;
  }
  if (!hasContent) {
    return <p className="m-0 text-sm font-bold text-text-muted">{emptyText}</p>;
  }

  return children;
}

function SettingsHeader() {
  return (
    <>
      <BrandHeader
        action={
          <Button
            asChild
            className="min-h-11 rounded-md border-white/20 bg-white/10 text-text-on-dark whitespace-nowrap hover:bg-white/15"
            variant="outline"
          >
            <Link href="/chat">Back to chat</Link>
          </Button>
        }
      />
      <PageHeader
        description="Tell Ask Siargao where you are staying, what your group needs, and how far you want to go."
        eyebrow="Your trip brief"
        title="How should Ask Siargao plan for me?"
      />
    </>
  );
}

function SettingsSidebar({
  activeSection,
  manageAccountButtonRef,
  onActivate,
  onManageAccount,
  onProfileUpdated,
  onRefreshPrivateSummaries,
  profile,
}: {
  activeSection: TripBriefSection;
  manageAccountButtonRef?: RefObject<HTMLButtonElement | null>;
  onActivate: (section: TripBriefSection) => void;
  onManageAccount?: () => void;
  onProfileUpdated: (profile: UserProfileResponse) => void;
  onRefreshPrivateSummaries: () => void;
  profile: UserProfileResponse;
}) {
  return (
    <aside className="grid min-w-0 gap-4 xl:sticky xl:top-6 xl:h-fit">
      <nav aria-label="Trip brief sections" className={`${settingsPanelClass} grid gap-1 p-3`}>
        <SectionLink
          activeSection={activeSection}
          onActivate={onActivate}
          section="current-trip"
          label="Current trip"
        />
        <SectionLink
          activeSection={activeSection}
          onActivate={onActivate}
          section="traveler-preferences"
          label="Traveler preferences"
        />
        <SectionLink
          activeSection={activeSection}
          onActivate={onActivate}
          section="account"
          label="Account"
        />
        <SectionLink
          activeSection={activeSection}
          onActivate={onActivate}
          section="privacy"
          label="Privacy"
        />
        <SectionLink
          activeSection={activeSection}
          onActivate={onActivate}
          section="pass"
          label="Pass"
        />
      </nav>
      <AccountPanel
        manageAccountButtonRef={manageAccountButtonRef}
        onManageAccount={onManageAccount}
        profile={profile}
      />
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
        <ShortcutPanel />
        <PrivacyControlsPanel
          onProfileUpdated={onProfileUpdated}
          onRefreshPrivateSummaries={onRefreshPrivateSummaries}
          profile={profile}
        />
        <PassPanel />
      </div>
    </aside>
  );
}

function SectionLink({
  activeSection,
  label,
  onActivate,
  section,
}: {
  activeSection: TripBriefSection;
  label: string;
  onActivate: (section: TripBriefSection) => void;
  section: TripBriefSection;
}) {
  const isActive = activeSection === section;
  return (
    <a
      aria-current={isActive ? "location" : undefined}
      className={`rounded-md px-3 py-2 text-sm font-extrabold no-underline outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20 ${
        isActive
          ? "bg-brand-lagoon-100 text-brand-lagoon-800"
          : "text-text-default hover:bg-brand-lagoon-100"
      }`}
      href={`#${section}`}
      onClick={(event) => {
        event.preventDefault();
        onActivate(section);
      }}
    >
      {label}
    </a>
  );
}

function AccountPanel({
  manageAccountButtonRef,
  onManageAccount,
  profile,
}: {
  manageAccountButtonRef?: RefObject<HTMLButtonElement | null>;
  onManageAccount?: () => void;
  profile: UserProfileResponse;
}) {
  const account = accountIdentityFromProfile(profile);

  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-4`} id="account" tabIndex={-1}>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full bg-brand-lagoon-100 text-brand-lagoon-700"
        >
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold">Account</h2>
          <p className="m-0 min-w-0 [overflow-wrap:anywhere] text-sm font-bold text-text-muted break-words">
            {account.name}
          </p>
        </div>
      </div>

      <dl className="grid min-w-0 gap-3 text-sm">
        <div>
          <dt className="font-semibold text-text-muted">{account.emailLabel}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere] font-bold break-words">
            {account.email ?? "No email is available for this signed-in account."}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-text-muted">Status</dt>
          <dd className="m-0 font-bold">{account.status}</dd>
        </div>
      </dl>

      <Button
        className="h-auto min-h-11 w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-nowrap hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
        ref={manageAccountButtonRef}
        type="button"
        variant="outline"
        onClick={onManageAccount ?? (() => {})}
      >
        Manage account
      </Button>
    </section>
  );
}

function ShortcutPanel() {
  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-3`}>
      <h2 className="m-0 text-base font-semibold">Shortcuts</h2>
      <Button
        asChild
        className="h-auto min-h-11 justify-between rounded-md border-border-default bg-surface-default px-3 py-3 text-left text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
        variant="outline"
      >
        <Link href="/chat">
          <span className="inline-flex items-center gap-2">
            <MessageCircle className="size-4" />
            Open chat
          </span>
          <ArrowRight className="size-4" />
        </Link>
      </Button>
    </section>
  );
}

function PassPanel() {
  const [checkoutState, setCheckoutState] = useState<"idle" | "starting" | "redirecting" | "error">(
    "idle",
  );
  const [checkoutReturn, setCheckoutReturn] = useState<"none" | "return" | "cancelled">("none");
  const returnConvergenceStarted = useRef(false);
  const {
    data: tripPass,
    error: tripPassError,
    isLoading,
    mutate: refreshTripPass,
  } = useSWR("/api/me/trip-pass", fetchTripPassAccount, {
    refreshInterval: (latest) =>
      checkoutReturn === "return" && latest?.status === "pending" ? 4_000 : 0,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const fetchState: TripPassAccountFetchState = isLoading
    ? "loading"
    : tripPassError
      ? "unavailable"
      : "ready";
  const view = projectTripPassAccountView(tripPass ?? null, fetchState);
  const canStartCheckout =
    view.actionLabel !== null && checkoutState !== "starting" && checkoutState !== "redirecting";
  const checkoutStatusMessage =
    checkoutState === "error"
      ? "Checkout could not start. Refresh the pass status and try again."
      : checkoutState === "starting"
        ? "Starting secure checkout."
        : checkoutState === "redirecting"
          ? "Redirecting to secure checkout."
          : checkoutReturn === "return" && tripPass?.status === "pending"
            ? "Payment is being confirmed. This panel will refresh automatically."
            : checkoutReturn === "cancelled"
              ? "Checkout was cancelled. No pass was activated."
              : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("trip_pass_checkout");
    if (result === "return" || result === "cancelled") {
      setCheckoutReturn(result);
      void refreshTripPass();
      if (result === "return" && !returnConvergenceStarted.current) {
        const orderId = params.get("order");
        const providerOrderId = params.get("provider_order");
        const providerOrderIdentifier = params.get("provider_identifier");
        if (orderId) {
          returnConvergenceStarted.current = true;
          window.setTimeout(() => {
            void fetch("/api/me/trip-pass/checkout/return", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ orderId, providerOrderId, providerOrderIdentifier }),
            }).finally(() => {
              void refreshTripPass();
            });
          }, 10_000);
        }
      }
    }
  }, [refreshTripPass]);

  async function startCheckout() {
    if (!canStartCheckout) {
      return;
    }
    setCheckoutState("starting");
    try {
      const response = await fetch("/api/me/trip-pass/checkout", {
        method: "POST",
      });
      if (!response.ok) {
        setCheckoutState("error");
        void refreshTripPass();
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        checkoutUrl?: string;
      } | null;
      if (!body?.checkoutUrl) {
        setCheckoutState("error");
        void refreshTripPass();
        return;
      }
      setCheckoutState("redirecting");
      window.location.assign(body.checkoutUrl);
    } catch {
      setCheckoutState("error");
      void refreshTripPass();
    }
  }

  return (
    <section
      aria-busy={fetchState === "loading" || checkoutState === "starting"}
      className={`${settingsPanelClass} grid min-w-0 gap-4`}
      id="pass"
      tabIndex={-1}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 text-base font-semibold">Pass</h2>
          <p className="m-0 text-sm font-extrabold text-text-strong">{view.headline}</p>
        </div>
        <span className="rounded-md border border-brand-lagoon-200 bg-brand-lagoon-50 px-2 py-1 text-xs font-extrabold text-brand-lagoon-800">
          {view.badge}
        </span>
      </div>

      <p className={appBodyClass}>{view.detail}</p>

      <p className="sr-only" role="status" aria-live="polite">
        {view.announcement}
      </p>

      {view.validityLabel ? (
        <p className="m-0 text-sm font-bold text-text-muted">{view.validityLabel}</p>
      ) : null}

      {checkoutStatusMessage ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border border-brand-sunset-gold/50 bg-brand-sunset-gold/10 p-3 text-sm font-bold text-text-strong">
          {checkoutState === "starting" || checkoutState === "redirecting" ? (
            <LoaderCircle
              aria-hidden="true"
              className="mt-0.5 size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4" />
          )}
          <p className="m-0">{checkoutStatusMessage}</p>
        </div>
      ) : null}

      {view.warnings.length ? (
        <ul aria-label="Trip Pass warnings" className="m-0 grid list-none gap-2 p-0">
          {view.warnings.map((warning) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border border-brand-sunset-coral/35 bg-brand-sunset-coral/10 p-2 text-xs font-extrabold text-text-strong"
              key={warning}
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 text-brand-sunset-coral" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {view.allowances.length ? (
        <dl className="grid min-w-0 gap-2 text-sm" data-testid="trip-pass-allowances">
          {view.allowances.map((allowance) => (
            <div
              className="grid min-w-0 gap-1 rounded-md border border-border-default bg-white p-3"
              key={allowance.meterType}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <dt className="font-extrabold text-text-strong">{allowance.label}</dt>
                <dd className="m-0 text-xs font-extrabold text-text-muted">{allowance.summary}</dd>
              </div>
              <div
                aria-label={`${allowance.label}: ${allowance.used} of ${allowance.limit} used`}
                aria-valuemax={allowance.limit}
                aria-valuemin={0}
                aria-valuenow={allowance.used}
                className="h-2 overflow-hidden rounded-full bg-brand-lagoon-100"
                role="progressbar"
              >
                <span
                  className={`block h-full ${
                    allowance.remaining === 0
                      ? "bg-brand-sunset-coral"
                      : allowance.warning
                        ? "bg-brand-sunset-gold"
                        : "bg-brand-lagoon-500"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, (allowance.used / allowance.limit) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="m-0 text-xs font-bold text-text-muted">{view.resetLabel}</p>

      <div className="flex flex-wrap items-center gap-2">
        {view.actionLabel ? (
          <Button
            className="h-auto min-h-11 w-full rounded-md bg-brand-lagoon-600 px-3 py-2 text-sm font-extrabold text-trip-pass-cta-foreground hover:bg-brand-lagoon-700 hover:text-trip-pass-cta-hover-foreground focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20 disabled:opacity-60 sm:w-auto"
            disabled={!canStartCheckout}
            onClick={() => {
              void startCheckout();
            }}
            type="button"
          >
            <CreditCard aria-hidden="true" className="size-4" />
            {checkoutState === "starting" ? "Starting" : view.actionLabel}
          </Button>
        ) : null}
        <Button
          className="h-auto min-h-11 rounded-md border-border-default bg-surface-default px-3 py-2 text-sm font-extrabold text-text-default hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
          onClick={() => {
            void refreshTripPass();
          }}
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Refresh
        </Button>
      </div>

      {view.checkoutDisabledReason ? (
        <p className="m-0 text-xs font-bold text-text-muted">{view.checkoutDisabledReason}</p>
      ) : null}
      {view.supportGuidance ? (
        <p className="m-0 text-xs font-bold text-text-muted">{view.supportGuidance}</p>
      ) : null}
    </section>
  );
}

type PrivacyDialogAction = {
  action: PrivacyActionResponse["action"];
  buttonLabel: string;
  confirmation: string;
  description: string;
  title: string;
};

const privacyDialogActions: Record<PrivacyActionResponse["action"], PrivacyDialogAction> = {
  delete_chat_history: {
    action: "delete_chat_history",
    buttonLabel: "Delete all chat history",
    confirmation: "DELETE CHAT HISTORY",
    description:
      "This deletes your owned chat threads, messages, ratings, public artifacts, source summaries, and redacted tool summaries from active product records. It does not delete your Clerk account, profile, saved planning data, backups, or audit metadata.",
    title: "Delete all chat history?",
  },
  delete_saved_planning_data: {
    action: "delete_saved_planning_data",
    buttonLabel: "Delete all saved planning data",
    confirmation: "DELETE SAVED PLANNING DATA",
    description:
      "This deletes your owned saved planning records and removes affected public share snapshots so existing share URLs return the same unavailable response. It does not delete anonymous trips or another browser's local storage.",
    title: "Delete all saved planning data?",
  },
  clear_location_context: {
    action: "clear_location_context",
    buttonLabel: "Clear stored location context",
    confirmation: "CLEAR LOCATION CONTEXT",
    description:
      "This clears stored accommodation and current-area context from your profile and this browser's local trip context. Other profile preferences remain in place.",
    title: "Clear stored location context?",
  },
};

function PrivacyControlsPanel({
  onProfileUpdated,
  onRefreshPrivateSummaries,
  profile,
}: {
  onProfileUpdated: (profile: UserProfileResponse) => void;
  onRefreshPrivateSummaries: () => void;
  profile: UserProfileResponse;
}) {
  const [dialogAction, setDialogAction] = useState<PrivacyDialogAction | null>(null);
  const [confirmationValue, setConfirmationValue] = useState("");
  const [actionStatus, setActionStatus] = useState<{
    action: PrivacyActionResponse["action"];
    kind: "success" | "already_empty" | "auth" | "validation" | "error";
    message: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PrivacyActionResponse["action"] | null>(null);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  const savedTriggerRef = useRef<HTMLButtonElement>(null);
  const locationTriggerRef = useRef<HTMLButtonElement>(null);
  const previousDialogActionRef = useRef<PrivacyDialogAction["action"] | null>(null);

  useEffect(() => {
    const closingAction = previousDialogActionRef.current;
    if (!dialogAction && closingAction) {
      window.setTimeout(() => {
        if (closingAction === "delete_chat_history") {
          chatTriggerRef.current?.focus();
        } else if (closingAction === "delete_saved_planning_data") {
          savedTriggerRef.current?.focus();
        } else {
          locationTriggerRef.current?.focus();
        }
      }, 0);
    }
    previousDialogActionRef.current = dialogAction?.action ?? null;
  }, [dialogAction]);

  function openDialog(action: PrivacyDialogAction) {
    setDialogAction(() => action);
    setConfirmationValue("");
    setActionStatus(null);
  }

  function closeDialog() {
    setDialogAction(null);
    setConfirmationValue("");
  }

  async function submitPrivacyAction(action: PrivacyDialogAction) {
    if (pendingAction || confirmationValue !== action.confirmation) {
      return;
    }

    setPendingAction(action.action);
    setActionStatus(null);
    try {
      const response = await fetch("/api/me/privacy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: action.action,
          ...(action.action === "clear_location_context"
            ? { clearFields: ["currentArea", "accommodation"] }
            : {}),
          confirmation: action.confirmation,
        }),
      });
      if (response.status === 401) {
        setActionStatus({
          action: action.action,
          kind: "auth",
          message: "Your session expired. Sign in again before changing privacy settings.",
        });
        return;
      }
      if (response.status === 400) {
        setActionStatus({
          action: action.action,
          kind: "validation",
          message: "The confirmation did not match this privacy action. Try again.",
        });
        return;
      }
      if (!response.ok) {
        setActionStatus({
          action: action.action,
          kind: response.status === 400 ? "validation" : "error",
          message:
            response.status === 400
              ? "The confirmation did not match this privacy action. Try again."
              : "The privacy action did not finish. No local data was cleared.",
        });
        return;
      }
      const body = (await response.json().catch(() => null)) as PrivacyActionResponse | null;
      if (!body) {
        setActionStatus({
          action: action.action,
          kind: "error",
          message: "The privacy action did not finish. No local data was cleared.",
        });
        return;
      }

      if (action.action === "delete_saved_planning_data") {
        clearSavedTripState();
        onRefreshPrivateSummaries();
      }
      if (action.action === "delete_chat_history") {
        onRefreshPrivateSummaries();
      }
      if (action.action === "clear_location_context" && body.profile) {
        clearStoredTripLocationContext();
        onProfileUpdated(body.profile);
      }
      setActionStatus({
        action: action.action,
        kind: body.status,
        message: privacySuccessMessage(body),
      });
      closeDialog();
    } catch {
      setActionStatus({
        action: action.action,
        kind: "error",
        message: "Network error. Server data and local browser data were left unchanged.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-4`} id="privacy" tabIndex={-1}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="m-0 text-base font-semibold">Privacy</h2>
      </div>
      <p className={appBodyClass}>
        Ask Siargao keeps active product records for your Clerk-derived account identity cache,
        profile and preferences, marketing-consent choice, signed-in chat history, owned saved
        planning records, public share snapshots, and device-local anonymous trip state on this
        browser.
      </p>
      <p className={appBodyClass}>
        It does not store exact browser coordinates in chat history, raw provider payloads or tool
        arguments, private provider observations, non-public Google review text or author data,
        owner IDs or profile data in public shares, or secret share tokens.
      </p>
      <p className={appBodyClass}>
        These controls remove active product records only. Backup and audit retention are separate
        operational records and this app does not define a global purge duration.
      </p>

      <div className="grid min-w-0 gap-3 rounded-md border border-border-default p-3">
        <h3 className="m-0 text-sm font-semibold">Location memory</h3>
        <p className={appBodyClass}>
          Use once sends browser coordinates for one request. Use for this trip keeps coordinates
          only in the in-memory chat session. Stored context is limited to coarse area and
          accommodation text in your profile or this browser's trip context.
        </p>
        <Button
          className="h-auto min-h-11 w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-normal text-left hover:bg-brand-lagoon-100"
          ref={locationTriggerRef}
          type="button"
          variant="outline"
          onClick={() => openDialog(privacyDialogActions.clear_location_context)}
        >
          Clear stored location context
        </Button>
      </div>

      <MarketingConsentControl onProfileUpdated={onProfileUpdated} profile={profile} />

      <div className="grid min-w-0 gap-3 rounded-md border border-risk-high/25 bg-risk-high-soft p-3">
        <h3 className="m-0 text-sm font-semibold text-risk-high-foreground">
          Delete active product data
        </h3>
        <p className="m-0 text-sm font-bold leading-6 text-risk-high-foreground">
          Each action is separate and must be confirmed exactly.
        </p>
        <div className="grid min-w-0 gap-2">
          <Button
            className="h-auto min-h-11 w-fit rounded-md border-risk-high/35 bg-white px-3 py-2 text-left text-risk-high-foreground whitespace-normal hover:bg-risk-high-soft focus-visible:ring-3 focus-visible:ring-risk-high/20"
            ref={chatTriggerRef}
            type="button"
            variant="outline"
            onClick={() => openDialog(privacyDialogActions.delete_chat_history)}
          >
            <Trash2 className="size-4" />
            Delete all chat history
          </Button>
          <Button
            className="h-auto min-h-11 w-fit rounded-md border-risk-high/35 bg-white px-3 py-2 text-left text-risk-high-foreground whitespace-normal hover:bg-risk-high-soft focus-visible:ring-3 focus-visible:ring-risk-high/20"
            ref={savedTriggerRef}
            type="button"
            variant="outline"
            onClick={() => openDialog(privacyDialogActions.delete_saved_planning_data)}
          >
            <Trash2 className="size-4" />
            Delete all saved planning data
          </Button>
        </div>
      </div>

      {isClerkConfigured ? <AccountClosureControl /> : null}

      {actionStatus ? (
        <p
          className={`m-0 flex items-start gap-2 text-sm font-bold ${
            actionStatus.kind === "success" || actionStatus.kind === "already_empty"
              ? "text-confidence-high-foreground"
              : "text-risk-high-foreground"
          }`}
          role="status"
        >
          {actionStatus.kind === "success" || actionStatus.kind === "already_empty" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : null}
          <span>{actionStatus.message}</span>
        </p>
      ) : null}

      {dialogAction ? (
        <PrivacyConfirmationDialog
          action={dialogAction}
          confirmationValue={confirmationValue}
          isPending={pendingAction === dialogAction.action}
          onCancel={closeDialog}
          onChangeConfirmation={setConfirmationValue}
          onConfirm={() => void submitPrivacyAction(dialogAction)}
        />
      ) : null}
    </section>
  );
}

function AccountClosureControl() {
  const { signOut } = useClerk();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<AccountClosureClientStatus>("idle");
  const closeAccount = useReverification(async () =>
    fetch("/api/me/account-closure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: accountClosureConfirmation }),
    }),
  );

  async function submitClosure() {
    if (status === "submitting" || confirmation !== accountClosureConfirmation) return;
    setStatus("submitting");
    let serverCommitted = false;
    try {
      const response = await closeAccount();
      if (!response?.ok) {
        setStatus("request_failed");
        return;
      }
      serverCommitted = true;
      setStatus("committed");
      let localFailure = false;
      for (const clearLocalState of [clearSavedTripState, clearStoredTripLocationContext]) {
        try {
          clearLocalState();
        } catch {
          localFailure = true;
        }
      }
      try {
        await signOut({ redirectUrl: "/" });
      } catch {
        localFailure = true;
      }
      if (localFailure) setStatus("committed_cleanup_failed");
    } catch {
      setStatus(accountClosureFailureStatus(serverCommitted));
    }
  }

  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-risk-high/35 bg-risk-high-soft p-3">
      <h3 className="m-0 text-sm font-semibold text-risk-high-foreground">
        Close Account permanently
      </h3>
      <ul className="m-0 grid gap-1 pl-5 text-sm font-bold leading-6 text-risk-high-foreground">
        {accountClosureWarnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <Button
        className="h-auto min-h-11 w-fit rounded-md border-risk-high/45 bg-white px-3 py-2 text-risk-high-foreground hover:bg-risk-high-soft"
        type="button"
        variant="outline"
        onClick={() => {
          setConfirmation("");
          setStatus("idle");
          setIsOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        Close Account
      </Button>
      {isOpen ? (
        <section
          aria-labelledby="account-closure-confirmation-title"
          className="grid gap-3 rounded-md border border-risk-high/35 bg-white p-4"
        >
          <h4
            className="m-0 text-base font-semibold text-risk-high-foreground"
            id="account-closure-confirmation-title"
          >
            Confirm terminal Account Closure
          </h4>
          <p className="m-0 text-sm leading-6 text-risk-high-foreground">
            Type <strong>{accountClosureConfirmation}</strong>. Clerk will ask you to verify your
            credentials if your last verification is more than five minutes old.
          </p>
          <Input
            aria-label="Account Closure confirmation"
            autoComplete="off"
            className="h-11 rounded-md"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {status === "request_failed" ? (
            <p className="m-0 text-sm font-bold text-risk-high-foreground" role="alert">
              {accountClosureStatusMessages.request_failed}
            </p>
          ) : null}
          {status === "committed" || status === "committed_cleanup_failed" ? (
            <p className="m-0 text-sm font-bold text-risk-high-foreground" role="status">
              {accountClosureStatusMessages[status]}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 bg-risk-high-foreground text-text-on-dark hover:bg-risk-high-strong"
              disabled={
                confirmation !== accountClosureConfirmation ||
                status === "submitting" ||
                status === "committed" ||
                status === "committed_cleanup_failed"
              }
              type="button"
              onClick={() => void submitClosure()}
            >
              {status === "submitting"
                ? "Closing Account"
                : status === "committed" || status === "committed_cleanup_failed"
                  ? "Account closed"
                  : "Close Account permanently"}
            </Button>
            <Button
              className="min-h-11 rounded-md"
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MarketingConsentControl({
  onProfileUpdated,
  profile,
}: {
  onProfileUpdated: (profile: UserProfileResponse) => void;
  profile: UserProfileResponse;
}) {
  const [marketingValueOverride, setMarketingValueOverride] = useState<boolean | undefined>();
  const marketingValue = marketingValueOverride ?? profile.profile.marketingConsent;
  const [marketingStatus, setMarketingStatus] = useState<
    "idle" | "saving" | "saved" | "auth" | "error"
  >("idle");
  const [marketingError, setMarketingError] = useState<string | null>(null);

  async function saveMarketingConsent() {
    setMarketingStatus("saving");
    setMarketingError(null);
    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketingConsent: marketingValue }),
      });
      if (response.status === 401) {
        setMarketingStatus("auth");
        setMarketingError("Your session expired. Sign in again before saving consent.");
        return;
      }
      if (!response.ok) {
        setMarketingStatus("error");
        setMarketingError("Marketing consent was not saved. Your choice is still selected.");
        return;
      }
      const nextProfile = (await response.json()) as UserProfileResponse;
      onProfileUpdated(nextProfile);
      setMarketingStatus("saved");
    } catch {
      setMarketingStatus("error");
      setMarketingError("Network error. Your choice is still selected and can be retried.");
    }
  }

  return (
    <div className="grid min-w-0 gap-3 rounded-md border border-border-default p-3">
      <h3 className="m-0 text-sm font-semibold">Marketing consent</h3>
      <label className="flex min-h-11 min-w-0 items-center gap-3 text-sm font-bold text-text-default">
        <input
          checked={marketingValue}
          className="size-4 accent-brand-lagoon-600"
          type="checkbox"
          onChange={(event) => {
            setMarketingValueOverride(event.target.checked);
            setMarketingStatus("idle");
            setMarketingError(null);
          }}
        />
        Send occasional Ask Siargao product updates
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="h-auto min-h-11 rounded-md px-3 py-2 whitespace-nowrap"
          disabled={
            marketingStatus === "saving" || marketingValue === profile.profile.marketingConsent
          }
          type="button"
          onClick={saveMarketingConsent}
        >
          <Save className="size-4" />
          {marketingStatus === "saving" ? "Saving consent" : "Save consent"}
        </Button>
        <output className="min-h-5 text-sm font-bold text-text-muted">
          {marketingStatus === "saved"
            ? "Marketing consent saved"
            : marketingStatus === "auth" || marketingStatus === "error"
              ? marketingError
              : marketingValue !== profile.profile.marketingConsent
                ? "Consent change not saved yet"
                : ""}
        </output>
      </div>
    </div>
  );
}

function PrivacyConfirmationDialog({
  action,
  confirmationValue,
  isPending,
  onCancel,
  onChangeConfirmation,
  onConfirm,
}: {
  action: PrivacyDialogAction;
  confirmationValue: string;
  isPending: boolean;
  onCancel: () => void;
  onChangeConfirmation: (value: string) => void;
  onConfirm: () => void;
}) {
  const isMounted = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isMounted) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const backgroundState = Array.from(document.body.children)
      .filter(
        (element): element is HTMLElement => element instanceof HTMLElement && element !== dialog,
      )
      .map((element) => ({
        ariaHidden: element.getAttribute("aria-hidden"),
        element,
        inert: element.inert,
      }));
    for (const { element } of backgroundState) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    inputRef.current?.focus();

    return () => {
      for (const { ariaHidden, element, inert } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isMounted]);

  if (!isMounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <dialog
      aria-labelledby="privacy-confirmation-title"
      aria-modal="true"
      className="fixed inset-0 z-50 m-0 grid h-full max-h-none w-full max-w-none place-items-center border-0 bg-transparent p-4 backdrop:bg-black/50"
      ref={dialogRef}
      onCancel={(event) => {
        if (isPending) {
          event.preventDefault();
          return;
        }
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        className={`${appSurfaceOverlayClass} grid max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-lg min-w-0 gap-4 overflow-y-auto p-5`}
      >
        <div>
          <h3 className="m-0 text-lg font-semibold" id="privacy-confirmation-title">
            {action.title}
          </h3>
          <p className={appBodyClass}>{action.description}</p>
        </div>
        <label
          className="grid min-w-0 gap-2 text-sm font-extrabold"
          htmlFor="privacy-confirmation-input"
        >
          Type {action.confirmation} to continue
          <Input
            className="h-11 rounded-md"
            id="privacy-confirmation-input"
            ref={inputRef}
            value={confirmationValue}
            onChange={(event) => onChangeConfirmation(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            className="min-h-11 rounded-md"
            disabled={isPending}
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="min-h-11 rounded-md bg-risk-high-foreground text-text-on-dark hover:bg-risk-high-strong"
            disabled={isPending || confirmationValue !== action.confirmation}
            type="button"
            onClick={onConfirm}
          >
            <Trash2 className="size-4" />
            {isPending ? "Deleting" : action.buttonLabel}
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

function privacySuccessMessage(body: PrivacyActionResponse) {
  if (body.action === "delete_chat_history") {
    const count = body.counts.chatThreadsDeleted ?? 0;
    return body.status === "already_empty"
      ? "Chat history was already empty."
      : `Deleted ${count} chat thread${count === 1 ? "" : "s"} from active records.`;
  }
  if (body.action === "delete_saved_planning_data") {
    const itemCount = body.counts.savedItemsDeleted ?? 0;
    const shareCount = body.counts.sharedPlansInvalidated ?? 0;
    return body.status === "already_empty"
      ? "Saved planning data was already empty."
      : `Deleted ${itemCount} saved item${itemCount === 1 ? "" : "s"} and invalidated ${shareCount} share link${shareCount === 1 ? "" : "s"}.`;
  }

  return body.status === "already_empty"
    ? "Stored location context was already empty."
    : "Stored area and accommodation context were cleared.";
}

function privateSummaryStatus({
  data,
  error,
  isLoading,
}: {
  data: unknown;
  error: unknown;
  isLoading: boolean;
}): PrivateSummaryStatus {
  if (error) {
    return "error";
  }
  if (data) {
    return "ready";
  }

  return isLoading ? "loading" : "idle";
}

function summaryCountLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatSummaryTimestamp(value?: string | null) {
  if (!value) {
    return "No recent activity";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No recent activity";
  }

  return summaryDateFormatter.format(date);
}

function timestampSortValue(value?: string | null) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function savedItemKindLabel(kind: SavedTripItem["kind"]) {
  switch (kind) {
    case "beach":
      return "Beach";
    case "itinerary":
      return "Itinerary";
    case "note":
      return "Note";
    case "place":
      return "Place";
  }
}

function TravelProfileSection({
  fieldErrors,
  form,
  isDirty,
  saveError,
  saveState,
  setForm,
}: {
  fieldErrors: ProfileFieldErrors;
  form: ProfileFormState;
  isDirty: boolean;
  saveError: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
  setForm: (update: (current: ProfileFormState) => ProfileFormState) => void;
}) {
  const selectedDurableConstraints = new Set(form.durableConstraints);

  return (
    <section className="grid min-w-0 gap-6">
      <section
        className={`${settingsPanelClass} grid min-w-0 gap-6`}
        id="current-trip"
        tabIndex={-1}
      >
        <div>
          <h2 className="m-0 text-lg font-semibold">Current trip</h2>
          <p className={appBodyClass}>
            Share the stay, timing, group, and travel limits for this visit.
          </p>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextField
            label="Accommodation"
            value={form.accommodation}
            error={fieldErrors["tripContext.accommodation"]}
            onChange={(accommodation) => setForm((current) => ({ ...current, accommodation }))}
          />
          <TextField
            label="Dates or date range"
            value={form.dateRange}
            error={fieldErrors["tripContext.dateRange"]}
            onChange={(dateRange) => setForm((current) => ({ ...current, dateRange }))}
          />
          <OptionSelect
            label="Current area"
            options={currentAreaOptions}
            value={form.currentArea}
            error={fieldErrors["tripContext.currentArea"]}
            onChange={(currentArea) => setForm((current) => ({ ...current, currentArea }))}
          />
          <OptionSelect
            label="Traveler or group type"
            value={form.travelerType}
            error={fieldErrors["tripContext.travelerType"]}
            onChange={(travelerType) => setForm((current) => ({ ...current, travelerType }))}
            options={travelerTypeOptions}
            aliases={profileLegacyAliases.travelerType}
          />
          <OptionSelect
            label="Transport mode"
            options={transportModeOptions}
            value={form.transportMode}
            error={fieldErrors["tripContext.transportMode"]}
            onChange={(transportMode) =>
              setForm((current) => ({
                ...current,
                transportMode: transportMode as ProfileFormState["transportMode"],
              }))
            }
          />
          <NumberField
            label="Maximum ride time in minutes"
            value={form.rideTimeLimitMinutes}
            error={fieldErrors["tripContext.rideTimeLimitMinutes"]}
            min={1}
            max={360}
            onChange={(rideTimeLimitMinutes) =>
              setForm((current) => ({ ...current, rideTimeLimitMinutes }))
            }
          />
        </div>
        <TextAreaField
          label="Trip notes"
          value={form.tripNotes}
          error={fieldErrors["tripContext.notes"]}
          onChange={(tripNotes) => setForm((current) => ({ ...current, tripNotes }))}
        />
      </section>

      <section
        className={`${settingsPanelClass} grid min-w-0 gap-6`}
        id="traveler-preferences"
        tabIndex={-1}
      >
        <div>
          <h2 className="m-0 text-lg font-semibold">Traveler preferences</h2>
          <p className={appBodyClass}>
            These choices help Ask Siargao shape plans beyond this stay.
          </p>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextField
            label="Display name"
            value={form.displayName}
            error={fieldErrors.displayName}
            onChange={(displayName) => setForm((current) => ({ ...current, displayName }))}
          />
          <TextField
            label="Home country"
            value={form.homeCountry}
            error={fieldErrors.homeCountry}
            onChange={(homeCountry) => setForm((current) => ({ ...current, homeCountry }))}
          />
          <TextField
            label="Travel style"
            value={form.travelStyle}
            error={fieldErrors.travelStyle}
            onChange={(travelStyle) => setForm((current) => ({ ...current, travelStyle }))}
          />
          <OptionSelect
            label="Surf ability"
            value={form.surfAbility}
            error={fieldErrors.surfAbility}
            onChange={(surfAbility) => setForm((current) => ({ ...current, surfAbility }))}
            options={surfAbilityOptions}
            aliases={profileLegacyAliases.surfAbility}
          />
          <OptionSelect
            label="Budget level"
            options={budgetLevelOptions}
            value={form.budgetLevel}
            error={fieldErrors.budgetLevel}
            onChange={(budgetLevel) => setForm((current) => ({ ...current, budgetLevel }))}
            aliases={profileLegacyAliases.budgetLevel}
          />
          <MultiValueField
            label="Interests"
            value={form.interests}
            error={fieldErrors.interests}
            itemErrors={indexedFieldErrors(fieldErrors, "interests")}
            onChange={(interests) => setForm((current) => ({ ...current, interests }))}
            suggestions={["Surfing", "Food", "Island hopping", "Nature", "Wellness"]}
            maxLength={60}
            maxItems={20}
          />
          <MultiValueField
            label="Preferred areas"
            value={form.preferredAreas}
            error={fieldErrors.preferredAreas}
            itemErrors={indexedFieldErrors(fieldErrors, "preferredAreas")}
            onChange={(preferredAreas) => setForm((current) => ({ ...current, preferredAreas }))}
            suggestions={["Cloud 9", "General Luna", "Del Carmen", "Dapa", "Pacifico"]}
            maxLength={80}
            maxItems={20}
          />
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextAreaField
            label="Dietary details"
            value={form.dietaryNotes}
            error={fieldErrors.dietaryNotes}
            onChange={(dietaryNotes) => setForm((current) => ({ ...current, dietaryNotes }))}
          />
          <TextAreaField
            label="Accessibility notes"
            value={form.accessibilityNotes}
            error={fieldErrors.accessibilityNotes}
            onChange={(accessibilityNotes) =>
              setForm((current) => ({ ...current, accessibilityNotes }))
            }
          />
        </div>

        <MultiOptionField
          label="Food needs"
          value={form.foodNeeds}
          error={fieldErrors.foodNeeds}
          itemErrors={indexedFieldErrors(fieldErrors, "foodNeeds")}
          options={foodNeedOptions}
          onChange={(foodNeeds) => setForm((current) => ({ ...current, foodNeeds }))}
        />

        <div className="grid min-w-0 gap-3 rounded-md border border-border-default p-4 sm:grid-cols-2">
          <PreferenceCheckbox
            checked={Boolean(form.quietSleepPreference)}
            label="Quiet sleep matters"
            onChange={(quietSleepPreference) =>
              setForm((current) => ({ ...current, quietSleepPreference }))
            }
          />
          <OptionSelect
            label="Weather preference"
            options={weatherPreferenceOptions}
            value={form.weatherPreference}
            error={fieldErrors.weatherPreference}
            onChange={(weatherPreference) =>
              setForm((current) => ({
                ...current,
                weatherPreference: weatherPreference as ProfileFormState["weatherPreference"],
              }))
            }
          />
        </div>

        <fieldset
          aria-describedby={
            fieldErrors["tripContext.durableConstraints"]
              ? "profile-durable-constraints-error"
              : undefined
          }
          aria-invalid={Boolean(fieldErrors["tripContext.durableConstraints"])}
          className="grid min-w-0 gap-3 rounded-md border border-border-default p-4 sm:grid-cols-2"
        >
          <legend className="px-1 text-sm font-extrabold text-text-default">Group needs</legend>
          {groupNeedOptions.map((option) => (
            <PreferenceCheckbox
              checked={selectedDurableConstraints.has(option.value)}
              error={fieldErrors["tripContext.durableConstraints"]}
              errorId="profile-durable-constraints-error"
              key={option.value}
              label={option.label}
              onChange={(checked) =>
                setForm((current) => toggleConstraint(current, option.value, checked))
              }
            />
          ))}
          <FieldError
            id="profile-durable-constraints-error"
            message={fieldErrors["tripContext.durableConstraints"]}
          />
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="min-h-11 rounded-md whitespace-nowrap"
            disabled={saveState === "saving"}
            type="submit"
          >
            <Save className="size-4" />
            {saveState === "saving" ? "Saving trip brief" : "Save trip brief"}
          </Button>
          <output className="min-h-5 text-sm font-bold text-text-muted">
            {saveState === "saved"
              ? "Trip brief saved"
              : saveState === "error"
                ? (saveError ?? "Your trip brief could not be saved.")
                : isDirty
                  ? "You have unsaved changes"
                  : ""}
          </output>
        </div>
      </section>
    </section>
  );
}

function PreferenceCheckbox({
  checked,
  error,
  errorId,
  label,
  onChange,
}: {
  checked: boolean;
  error?: string;
  errorId?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        checked={checked}
        className="size-4 accent-brand-lagoon-600"
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function SignedOutPanel() {
  return (
    <section className={`${settingsPanelClass} grid max-w-xl gap-4`}>
      <h2 className="m-0 text-xl font-semibold">Sign in to manage your settings</h2>
      <p className={appBodyClass}>Ask Siargao keeps settings with your signed-in account.</p>
      <div className="flex flex-wrap gap-3">
        {isClerkConfigured ? (
          <>
            <SignInButton mode="modal">
              <Button className="min-h-11 rounded-md whitespace-nowrap" type="button">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                className="min-h-11 rounded-md border-border-default bg-surface-default text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
                type="button"
                variant="outline"
              >
                Sign up
              </Button>
            </SignUpButton>
          </>
        ) : (
          <>
            <Button asChild className="min-h-11 rounded-md whitespace-nowrap">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button
              asChild
              className="min-h-11 rounded-md border-border-default bg-surface-default text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
              variant="outline"
            >
              <Link href="/sign-up">Sign up</Link>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function StatusPanel({ title }: { title: string }) {
  return (
    <section className={settingsPanelClass}>
      <h2 className="m-0 text-xl font-semibold">{title}</h2>
    </section>
  );
}

function OptionSelect({
  aliases,
  error,
  label,
  onChange,
  options,
  value,
}: {
  aliases?: Readonly<Record<string, string>>;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  value: string;
}) {
  const inputId = fieldId(label);
  const errorId = fieldErrorId(label);
  const selectedValue = optionValueOrLegacy(value, options, aliases);
  const isLegacy = selectedValue && !isOptionValue(selectedValue, options);

  return (
    <label
      className="grid min-w-0 gap-2 text-sm font-extrabold text-text-default"
      htmlFor={inputId}
    >
      {label}
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className="h-11 rounded-md border border-border-default bg-white px-3 text-sm font-bold outline-none focus-visible:border-brand-lagoon-600 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
        id={inputId}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not set</option>
        {isLegacy ? (
          <option value={selectedValue}>{legacyOptionLabel(selectedValue)}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isLegacy ? (
        <span className="text-xs font-semibold text-text-muted">
          This saved value is no longer a current choice. Keep it, clear it, or choose a supported
          value.
        </span>
      ) : null}
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function NumberField({
  error,
  label,
  max,
  min,
  onChange,
  value,
}: {
  error?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = fieldId(label);
  const errorId = fieldErrorId(label);

  return (
    <label
      className="grid min-w-0 gap-2 text-sm font-extrabold text-text-default"
      htmlFor={inputId}
    >
      {label}
      <Input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className="h-11 rounded-md border-border-default bg-white focus-visible:border-brand-lagoon-600 focus-visible:ring-brand-lagoon-500/20"
        id={inputId}
        max={max}
        min={min}
        step={1}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function MultiOptionField({
  error,
  itemErrors = {},
  label,
  onChange,
  options,
  value,
}: {
  error?: string;
  itemErrors?: Readonly<Record<number, string>>;
  label: string;
  onChange: (value: string[]) => void;
  options: readonly { value: string; label: string }[];
  value: string[];
}) {
  const errorId = fieldErrorId(label);
  const selectedLegacyValues = value.filter(
    (selected, index) => value.indexOf(selected) === index && !isOptionValue(selected, options),
  );
  const availableOptions = [
    ...options,
    ...selectedLegacyValues.map((selected) => ({
      value: selected,
      label: legacyOptionLabel(selected),
    })),
  ];
  const itemErrorIds = Object.keys(itemErrors).map((index) => `${errorId}-item-${index}`);
  const describedBy = [error ? errorId : null, ...itemErrorIds].filter(Boolean).join(" ");
  return (
    <fieldset
      aria-describedby={describedBy || undefined}
      aria-invalid={Boolean(error || itemErrorIds.length)}
      className="grid min-w-0 gap-3 rounded-md border border-border-default p-4"
    >
      <legend className="px-1 text-sm font-extrabold text-text-default">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {availableOptions.map((option) => {
          const selectedIndex = value.indexOf(option.value);
          const itemError = selectedIndex >= 0 ? itemErrors[selectedIndex] : undefined;
          const itemErrorId = `${errorId}-item-${selectedIndex}`;
          return (
            <label
              className="grid min-h-11 min-w-0 grid-cols-[auto_1fr] items-center gap-x-3 text-sm font-bold"
              key={option.value}
            >
              <input
                aria-describedby={itemError ? itemErrorId : undefined}
                aria-invalid={Boolean(itemError)}
                checked={selectedIndex >= 0}
                className="size-4 accent-brand-lagoon-600"
                type="checkbox"
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, option.value]
                      : value.filter((selected) => selected !== option.value),
                  )
                }
              />
              {option.label}
              {itemError ? (
                <span
                  className="col-start-2 text-xs font-bold text-risk-high-foreground"
                  id={itemErrorId}
                  role="alert"
                >
                  {itemError}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function MultiValueField({
  error,
  itemErrors = {},
  label,
  maxItems,
  maxLength,
  onChange,
  suggestions,
  value,
}: {
  error?: string;
  itemErrors?: Readonly<Record<number, string>>;
  label: string;
  maxItems: number;
  maxLength: number;
  onChange: (value: string[]) => void;
  suggestions: readonly string[];
  value: string[];
}) {
  const inputId = `${fieldId(label)}-entry`;
  const errorId = fieldErrorId(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const combinedError = localError ?? error;
  const itemErrorIds = Object.keys(itemErrors).map((index) => `${errorId}-item-${index}`);
  const describedBy = [combinedError ? errorId : null, ...itemErrorIds].filter(Boolean).join(" ");
  const tokens = value.map((item, index) => {
    const normalized = item.normalize("NFKC").toLocaleLowerCase();
    return {
      item,
      index,
      key: `${normalized}-${
        value
          .slice(0, index)
          .filter((candidate) => candidate.normalize("NFKC").toLocaleLowerCase() === normalized)
          .length
      }`,
    };
  });

  function add(valueToAdd = entry) {
    const result = addMultiValue(value, valueToAdd, maxLength, maxItems);
    if (result.error) {
      setLocalError(result.error);
      return;
    }
    setLocalError(null);
    setEntry("");
    onChange(result.values);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  }

  return (
    <fieldset
      aria-describedby={describedBy || undefined}
      aria-invalid={Boolean(combinedError || itemErrorIds.length)}
      className="grid min-w-0 gap-3 rounded-md border border-border-default p-4"
    >
      <legend className="px-1 text-sm font-extrabold text-text-default">{label}</legend>
      <p className="m-0 text-xs font-semibold text-text-muted">
        Add up to {maxItems} values. A comma stays part of the value you enter.
      </p>
      {value.length ? (
        <ul aria-label={`Selected ${label.toLowerCase()}`} className="m-0 flex flex-wrap gap-2 p-0">
          {tokens.map((token) => {
            const itemError = itemErrors[token.index];
            const itemErrorId = `${errorId}-item-${token.index}`;
            return (
              <li
                aria-describedby={itemError ? itemErrorId : undefined}
                className="grid min-h-11 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-md bg-brand-lagoon-100 px-3 text-sm font-bold text-text-default"
                key={token.key}
              >
                <span className="min-w-0 break-all">{token.item}</span>
                <button
                  aria-label={`Remove ${token.item}`}
                  aria-describedby={itemError ? itemErrorId : undefined}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-sm px-1 text-brand-lagoon-800 underline outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
                  type="button"
                  onClick={() => {
                    onChange(value.filter((_, itemIndex) => itemIndex !== token.index));
                    setLocalError(null);
                    inputRef.current?.focus();
                  }}
                >
                  Remove
                </button>
                {itemError ? (
                  <span
                    className="col-span-2 pb-2 text-xs font-bold text-risk-high-foreground"
                    id={itemErrorId}
                    role="alert"
                  >
                    {itemError}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
          aria-label={`Add ${label.toLowerCase().slice(0, -1)}`}
          aria-describedby={combinedError ? errorId : undefined}
          aria-invalid={Boolean(combinedError)}
          className="h-11 min-w-0 flex-1 rounded-md border-border-default bg-white focus-visible:border-brand-lagoon-600 focus-visible:ring-brand-lagoon-500/20"
          id={inputId}
          maxLength={maxLength}
          placeholder={`Add ${label.toLowerCase().slice(0, -1)}`}
          ref={inputRef}
          value={entry}
          onChange={(event) => {
            setEntry(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <Button className="min-h-11 shrink-0 rounded-md" type="button" onClick={() => add()}>
          Add
        </Button>
      </div>
      <div className="grid gap-2">
        <p className="m-0 text-xs font-semibold text-text-muted">Suggestions</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="min-h-11 rounded-md border border-border-default px-3 text-sm font-bold outline-none hover:bg-brand-lagoon-100 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
            >
              Add {suggestion}
            </button>
          ))}
        </div>
      </div>
      <FieldError id={errorId} message={combinedError} />
    </fieldset>
  );
}

function TextField({
  error,
  label,
  onChange,
  value,
}: {
  error?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = fieldId(label);
  const errorId = fieldErrorId(label);

  return (
    <label
      className="grid min-w-0 gap-2 text-sm font-extrabold text-text-default"
      htmlFor={inputId}
    >
      {label}
      <Input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        id={inputId}
        className="h-11 rounded-md border-border-default bg-white focus-visible:border-brand-lagoon-600 focus-visible:ring-brand-lagoon-500/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function TextAreaField({
  error,
  label,
  onChange,
  value,
}: {
  error?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = fieldId(label);
  const errorId = fieldErrorId(label);

  return (
    <label
      className="grid min-w-0 gap-2 text-sm font-extrabold text-text-default"
      htmlFor={inputId}
    >
      {label}
      <textarea
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        id={inputId}
        className="min-h-32 rounded-md border border-border-default bg-white px-3 py-2 text-sm font-semibold outline-none focus-visible:border-brand-lagoon-600 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="text-sm font-bold text-risk-high-foreground" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

function formFromProfile(profile: UserProfileResponse): ProfileFormState {
  const tripContext = profile.profile.tripContext;
  return {
    displayName: profile.profile.displayName ?? "",
    homeCountry: profile.profile.homeCountry ?? "",
    travelStyle: profile.profile.travelStyle ?? "",
    budgetLevel: profile.profile.budgetLevel ?? "",
    dietaryNotes: profile.profile.dietaryNotes ?? "",
    foodNeeds: profile.profile.foodNeeds,
    accessibilityNotes: profile.profile.accessibilityNotes ?? "",
    interests: profile.profile.interests,
    preferredAreas: profile.profile.preferredAreas,
    surfAbility: profile.profile.surfAbility ?? "",
    quietSleepPreference: profile.profile.quietSleepPreference,
    weatherPreference: profile.profile.weatherPreference ?? "",
    accommodation: tripContext.accommodation ?? "",
    dateRange: tripContext.dateRange ?? "",
    currentArea: tripContext.currentArea ?? "",
    travelerType: tripContext.travelerType ?? "",
    transportMode: tripContext.transportMode ?? "",
    rideTimeLimitMinutes: tripContext.rideTimeLimitMinutes?.toString() ?? "",
    durableConstraints: tripContext.durableConstraints ?? [],
    tripNotes: tripContext.notes ?? "",
    marketingConsent: profile.profile.marketingConsent,
  };
}

function profileLoadStatus({
  authStatus,
  error,
  isLoading,
  profile,
}: {
  authStatus: AuthProfileStatus;
  error: unknown;
  isLoading: boolean;
  profile: UserProfileResponse | null;
}): "loading" | "ready" | "unauthenticated" | "error" {
  if (authStatus === "loading") {
    return "loading";
  }
  if (authStatus === "unauthenticated") {
    return "unauthenticated";
  }
  if (error instanceof ProfileFetchError && error.status === 401) {
    return "unauthenticated";
  }
  if (error) {
    return "error";
  }
  if (profile) {
    return "ready";
  }

  return isLoading ? "loading" : "error";
}

function profilePatchFromForm(form: ProfileFormState, profile: UserProfileResponse | null) {
  const stored = profile ? formFromProfile(profile) : emptyForm;
  const tripContext = {
    ...textPatch("notes", form.tripNotes, stored.tripNotes),
    ...textPatch("accommodation", form.accommodation, stored.accommodation),
    ...textPatch("dateRange", form.dateRange, stored.dateRange),
    ...changedOptionPatch("currentArea", form.currentArea, stored.currentArea, currentAreaOptions),
    ...changedOptionPatch(
      "travelerType",
      form.travelerType,
      stored.travelerType,
      travelerTypeOptions,
    ),
    ...changedOptionPatch(
      "transportMode",
      form.transportMode,
      stored.transportMode,
      transportModeOptions,
    ),
    ...(form.rideTimeLimitMinutes === stored.rideTimeLimitMinutes
      ? {}
      : { rideTimeLimitMinutes: nullableInteger(form.rideTimeLimitMinutes) }),
    ...arrayPatch("durableConstraints", form.durableConstraints, stored.durableConstraints),
  };

  return {
    ...textPatch("displayName", form.displayName, stored.displayName),
    ...textPatch("homeCountry", form.homeCountry, stored.homeCountry),
    ...textPatch("travelStyle", form.travelStyle, stored.travelStyle),
    ...changedOptionPatch("budgetLevel", form.budgetLevel, stored.budgetLevel, budgetLevelOptions),
    ...textPatch("dietaryNotes", form.dietaryNotes, stored.dietaryNotes),
    ...arrayPatch("foodNeeds", form.foodNeeds, stored.foodNeeds),
    ...textPatch("accessibilityNotes", form.accessibilityNotes, stored.accessibilityNotes),
    ...changedOptionPatch("surfAbility", form.surfAbility, stored.surfAbility, surfAbilityOptions),
    ...(form.quietSleepPreference === stored.quietSleepPreference
      ? {}
      : { quietSleepPreference: form.quietSleepPreference }),
    ...(form.weatherPreference === stored.weatherPreference
      ? {}
      : { weatherPreference: form.weatherPreference || null }),
    ...arrayPatch("interests", form.interests, stored.interests),
    ...arrayPatch("preferredAreas", form.preferredAreas, stored.preferredAreas),
    ...(Object.keys(tripContext).length ? { tripContext } : {}),
    ...(form.marketingConsent === stored.marketingConsent
      ? {}
      : { marketingConsent: form.marketingConsent }),
  };
}

function nullableInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 360 ? parsed : null;
}

function toggleConstraint(
  form: ProfileFormState,
  constraint: string,
  checked: boolean,
): ProfileFormState {
  const durableConstraints = checked
    ? [...new Set([...form.durableConstraints, constraint])]
    : form.durableConstraints.filter((value) => value !== constraint);
  return { ...form, durableConstraints };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function textPatch(key: string, value: string, storedValue: string) {
  return value === storedValue ? {} : { [key]: nullableText(value) };
}

function changedOptionPatch<Value extends string>(
  key: string,
  value: string,
  storedValue: string,
  options: readonly { value: Value }[],
) {
  return value === storedValue ? {} : optionPatch(key, value, options);
}

function optionPatch<Value extends string>(
  key: string,
  value: string,
  options: readonly { value: Value }[],
) {
  if (!value) {
    return { [key]: null };
  }
  return isOptionValue(value, options) ? { [key]: value } : {};
}

function arrayPatch(key: string, value: string[], storedValue: readonly string[] | undefined) {
  return arraysMatchExactly(value, storedValue) ? {} : { [key]: value };
}

function arraysMatchExactly(value: readonly string[], storedValue: readonly string[] | undefined) {
  return (
    storedValue !== undefined &&
    value.length === storedValue.length &&
    value.every((item, index) => item === storedValue[index])
  );
}

function fieldId(label: string) {
  return `profile-${label.toLowerCase().replaceAll(" ", "-")}`;
}

function fieldErrorId(label: string) {
  return `${fieldId(label)}-error`;
}

function profileFieldErrors(issues: ProfileErrorResponse["issues"]): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  for (const issue of issues ?? []) {
    const path = profileFieldErrorPath(issue.path);
    if (path && issue.message) {
      errors[path] = errors[path] ? `${errors[path]} ${issue.message}` : issue.message;
    }
  }
  return errors;
}

function profileFieldErrorPath(path: string | undefined) {
  return path;
}

function indexedFieldErrors(errors: ProfileFieldErrors, field: string) {
  const indexedErrors: Record<number, string> = {};
  const prefix = `${field}.`;
  for (const [path, message] of Object.entries(errors)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const index = Number(path.slice(prefix.length));
    if (Number.isSafeInteger(index) && index >= 0) {
      indexedErrors[index] = message;
    }
  }
  return indexedErrors;
}

function sectionFromHash(hash: string): TripBriefSection | null {
  switch (hash.replace(/^#/, "")) {
    case "current-trip":
    case "traveler-preferences":
    case "account":
    case "privacy":
    case "pass":
      return hash.replace(/^#/, "") as TripBriefSection;
    default:
      return null;
  }
}
