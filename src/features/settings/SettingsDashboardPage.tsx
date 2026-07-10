"use client";

/*
 * Hallmark - pre-emit critique: P4 H4 E4 S5 R4 V4
 * genre: modern-minimal; macrostructure: account console; contrast/mobile: pass.
 */
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { ArrowRight, MapPinned, MessageCircle, Save, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
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
import type { ChatHistoryThread } from "@/server/chat/chat-history-store";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";
import type { SavedTripItem } from "@/server/trips/shared-trip-types";
import { appBodyClass, BrandHeader, PageHeader } from "@/ui/components/ask-siargao";

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
  transportMode: "" | "walk" | "scooter" | "tricycle" | "van" | "unknown";
  rideTimeLimitMinutes: string;
  durableConstraints: string[];
  tripNotes: string;
  marketingConsent: boolean;
};

type PrivateSummaryStatus = "idle" | "loading" | "ready" | "error";
type TripBriefSection = "current-trip" | "traveler-preferences" | "account" | "privacy" | "pass";
type ProfileFieldErrors = Record<string, string>;

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

const settingsWorkspaceClass =
  "grid w-full max-w-none gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7 2xl:px-10";

const settingsPanelClass =
  "rounded-md border border-border-default bg-surface-default p-5 text-text-default shadow-panel md:p-6";

const summaryDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
});

class ProfileFetchError extends Error {
  constructor(readonly status: number) {
    super("Profile could not be loaded.");
  }
}

async function fetchProfile(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new ProfileFetchError(response.status);
  }

  return (await response.json()) as UserProfileResponse;
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
  const {
    data: loadedProfile,
    error: profileError,
    isLoading: isProfileLoading,
  } = useSWR("/api/me/profile", fetchProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const shouldLoadPrivateSummaries = Boolean(loadedProfile);
  const {
    data: chatThreads,
    error: chatThreadsError,
    isLoading: isChatThreadsLoading,
  } = useSWR(shouldLoadPrivateSummaries ? "/api/chat/threads" : null, fetchChatThreads, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: savedTrips,
    error: savedTripsError,
    isLoading: isSavedTripsLoading,
  } = useSWR(shouldLoadPrivateSummaries ? "/api/trips/saved" : null, fetchSavedTrips, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [activeSection, setActiveSection] = useState<TripBriefSection>("current-trip");
  const editVersionRef = useRef(0);

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
    if (!loadedProfile) {
      return;
    }

    setProfile(loadedProfile);
    if (!isDirty) {
      setForm(formFromProfile(loadedProfile));
    }
  }, [isDirty, loadedProfile]);

  function updateForm(update: (current: ProfileFormState) => ProfileFormState) {
    editVersionRef.current += 1;
    setForm(update);
    setIsDirty(true);
    setSaveState("idle");
    setSaveError(null);
    setFieldErrors({});
  }

  function activateSection(section: TripBriefSection) {
    setActiveSection(section);
    window.history.pushState(null, "", `#${section}`);
    const target = document.getElementById(section);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }

  const status = profileLoadStatus({
    error: profileError,
    isLoading: isProfileLoading,
    profile,
  });

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("saving");
    setSaveError(null);
    setFieldErrors({});
    const savedEditVersion = editVersionRef.current;

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profilePatchFromForm(form, profile)),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as ProfileErrorResponse | null;
        if (editVersionRef.current !== savedEditVersion) {
          return;
        }
        const issues = profileFieldErrors(errorBody?.issues);
        setFieldErrors(issues);
        setSaveError(
          Object.keys(issues).length
            ? "Review the highlighted fields and try again."
            : "Check your entries and try again.",
        );
        setSaveState("error");
        return;
      }

      const nextProfile = (await response.json()) as UserProfileResponse;
      if (editVersionRef.current !== savedEditVersion) {
        return;
      }
      setProfile(nextProfile);
      setForm(formFromProfile(nextProfile));
      setIsDirty(false);
      setSaveState("saved");
    } catch {
      if (editVersionRef.current !== savedEditVersion) {
        return;
      }
      setSaveError("Your changes are still here. Check your connection and try again.");
      setSaveState("error");
    }
  }

  return (
    <main className="min-h-screen overflow-x-clip bg-brand-lavender-50 text-text-default">
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
        ) : status === "error" || !profile ? (
          <StatusPanel title="Settings unavailable" />
        ) : (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
            <SettingsSidebar
              activeSection={activeSection}
              onActivate={activateSection}
              profile={profile}
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
            <div className="grid gap-1" key={thread.id}>
              <h3 className="m-0 min-w-0 truncate text-sm font-black">{thread.title}</h3>
              <p className="m-0 text-xs font-bold text-text-muted">
                {formatSummaryTimestamp(thread.lastMessageAt ?? thread.updatedAt)}
              </p>
            </div>
          ))}
        </div>
      </SummaryPanelBody>
      <Button
        asChild
        className="h-auto w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
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
            <div className="grid gap-1" key={item.id}>
              <h3 className="m-0 min-w-0 truncate text-sm font-black">{item.title}</h3>
              <p className="m-0 text-xs font-bold text-text-muted">
                {savedItemKindLabel(item.kind)} saved {formatSummaryTimestamp(item.updatedAt)}
              </p>
            </div>
          ))}
        </div>
      </SummaryPanelBody>
      <Button
        asChild
        className="h-auto w-fit rounded-md border-border-default bg-surface-default px-3 py-2 text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
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
        <h2 className="m-0 text-base font-black">{title}</h2>
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
    return <p className="m-0 text-sm font-bold text-text-alert">{errorText}</p>;
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
            className="rounded-md border-white/20 bg-white/10 text-text-on-dark whitespace-nowrap hover:bg-white/15"
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
  onActivate,
  profile,
}: {
  activeSection: TripBriefSection;
  onActivate: (section: TripBriefSection) => void;
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
      <AccountPanel profile={profile} />
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
        <ShortcutPanel />
        <PrivacyPanel />
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

function AccountPanel({ profile }: { profile: UserProfileResponse }) {
  const fullName = [profile.identity.firstName, profile.identity.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-4`} id="account" tabIndex={-1}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-brand-lagoon-100 text-brand-lagoon-700">
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-base font-black">Account</h2>
          <p className="m-0 truncate text-sm font-bold text-text-muted">
            {fullName || "Signed-in account"}
          </p>
        </div>
      </div>

      <dl className="grid min-w-0 gap-3 text-sm">
        <div>
          <dt className="font-black text-text-muted">Email</dt>
          <dd className="m-0 break-all font-bold">{profile.identity.email}</dd>
        </div>
        <div>
          <dt className="font-black text-text-muted">Clerk user ID</dt>
          <dd className="m-0 break-all font-mono text-xs">{profile.identity.userId}</dd>
        </div>
      </dl>

      {isClerkConfigured ? (
        <Show fallback={null} when="signed-in">
          <div className="flex items-center gap-3 border-border-default border-t pt-4">
            <UserButton appearance={clerkAppearance} />
            <span className="text-sm font-bold text-text-muted">Manage account</span>
          </div>
        </Show>
      ) : null}
    </section>
  );
}

function ShortcutPanel() {
  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-3`}>
      <h2 className="m-0 text-base font-black">Shortcuts</h2>
      <Button
        asChild
        className="h-auto justify-between rounded-md border-border-default bg-surface-default px-3 py-3 text-left text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
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
  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-3`} id="pass" tabIndex={-1}>
      <h2 className="m-0 text-base font-black">Pass</h2>
      <p className={appBodyClass}>
        Pass details and choices will appear here when they are available for your account.
      </p>
    </section>
  );
}

function PrivacyPanel() {
  return (
    <section className={`${settingsPanelClass} grid min-w-0 gap-3`} id="privacy" tabIndex={-1}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-md bg-brand-lagoon-100 text-brand-lagoon-700">
          <ShieldCheck className="size-5" />
        </span>
        <h2 className="m-0 text-base font-black">Privacy</h2>
      </div>
      <p className={appBodyClass}>
        Private settings stay tied to your signed-in account. Shared trip links only include
        selected saved items.
      </p>
    </section>
  );
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
  return (
    <section className="grid min-w-0 gap-6">
      <section
        className={`${settingsPanelClass} grid min-w-0 gap-6`}
        id="current-trip"
        tabIndex={-1}
      >
        <div>
          <h2 className="m-0 text-lg font-black">Current trip</h2>
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
          <h2 className="m-0 text-lg font-black">Traveler preferences</h2>
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
            onChange={(interests) => setForm((current) => ({ ...current, interests }))}
            suggestions={["Surfing", "Food", "Island hopping", "Nature", "Wellness"]}
            maxLength={60}
            maxItems={20}
          />
          <MultiValueField
            label="Preferred areas"
            value={form.preferredAreas}
            error={fieldErrors.preferredAreas}
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
              checked={form.durableConstraints.includes(option.value)}
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

        <label className="flex min-w-0 items-start gap-3 rounded-md border border-brand-lagoon-700/10 bg-brand-lagoon-100 p-3 text-sm font-bold text-text-default sm:items-center">
          <input
            checked={form.marketingConsent}
            className="size-4 accent-brand-lagoon-600"
            type="checkbox"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                marketingConsent: event.target.checked,
              }))
            }
          />
          Send occasional Ask Siargao product updates
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="rounded-md whitespace-nowrap"
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
    <label className="flex items-center gap-3 text-sm font-bold">
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
      <h2 className="m-0 text-xl font-black">Sign in to manage your settings</h2>
      <p className={appBodyClass}>Ask Siargao keeps settings with your signed-in account.</p>
      <div className="flex flex-wrap gap-3">
        {isClerkConfigured ? (
          <>
            <SignInButton mode="modal">
              <Button className="rounded-md whitespace-nowrap" type="button">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                className="rounded-md border-border-default bg-surface-default text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
                type="button"
                variant="outline"
              >
                Sign up
              </Button>
            </SignUpButton>
          </>
        ) : (
          <>
            <Button asChild className="rounded-md whitespace-nowrap">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button
              asChild
              className="rounded-md border-border-default bg-surface-default text-text-default whitespace-nowrap hover:bg-brand-lagoon-100"
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
      <h2 className="m-0 text-xl font-black">{title}</h2>
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
  label,
  onChange,
  options,
  value,
}: {
  error?: string;
  label: string;
  onChange: (value: string[]) => void;
  options: readonly { value: string; label: string }[];
  value: string[];
}) {
  const errorId = fieldErrorId(label);
  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      aria-invalid={Boolean(error)}
      className="grid min-w-0 gap-3 rounded-md border border-border-default p-4"
    >
      <legend className="px-1 text-sm font-extrabold text-text-default">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold" key={option.value}>
            <input
              aria-invalid={Boolean(error)}
              checked={value.includes(option.value)}
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
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function MultiValueField({
  error,
  label,
  maxItems,
  maxLength,
  onChange,
  suggestions,
  value,
}: {
  error?: string;
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
      aria-describedby={combinedError ? errorId : undefined}
      aria-invalid={Boolean(combinedError)}
      className="grid min-w-0 gap-3 rounded-md border border-border-default p-4"
    >
      <legend className="px-1 text-sm font-extrabold text-text-default">{label}</legend>
      <p className="m-0 text-xs font-semibold text-text-muted">
        Add up to {maxItems} values. A comma stays part of the value you enter.
      </p>
      {value.length ? (
        <ul aria-label={`Selected ${label.toLowerCase()}`} className="m-0 flex flex-wrap gap-2 p-0">
          {tokens.map((token) => (
            <li
              className="flex min-h-11 max-w-full items-center gap-2 rounded-md bg-brand-lagoon-100 px-3 text-sm font-bold text-text-default"
              key={token.key}
            >
              <span className="min-w-0 break-all">{token.item}</span>
              <button
                aria-label={`Remove ${token.item}`}
                className="shrink-0 rounded-sm px-1 text-brand-lagoon-800 underline outline-none focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
                type="button"
                onClick={() => {
                  onChange(value.filter((_, itemIndex) => itemIndex !== token.index));
                  setLocalError(null);
                  inputRef.current?.focus();
                }}
              >
                Remove
              </button>
            </li>
          ))}
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
    <span className="text-sm font-bold text-red-700" id={id} role="alert">
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
    budgetLevel: optionValueOrLegacy(
      profile.profile.budgetLevel,
      budgetLevelOptions,
      profileLegacyAliases.budgetLevel,
    ),
    dietaryNotes: profile.profile.dietaryNotes ?? "",
    foodNeeds: profile.profile.foodNeeds,
    accessibilityNotes: profile.profile.accessibilityNotes ?? "",
    interests: profile.profile.interests,
    preferredAreas: profile.profile.preferredAreas,
    surfAbility: optionValueOrLegacy(
      profile.profile.surfAbility,
      surfAbilityOptions,
      profileLegacyAliases.surfAbility,
    ),
    quietSleepPreference: profile.profile.quietSleepPreference,
    weatherPreference: profile.profile.weatherPreference ?? "",
    accommodation: tripContext.accommodation ?? "",
    dateRange: tripContext.dateRange ?? "",
    currentArea: tripContext.currentArea ?? "",
    travelerType: optionValueOrLegacy(
      tripContext.travelerType,
      travelerTypeOptions,
      profileLegacyAliases.travelerType,
    ),
    transportMode: tripContext.transportMode ?? "",
    rideTimeLimitMinutes: tripContext.rideTimeLimitMinutes?.toString() ?? "",
    durableConstraints: tripContext.durableConstraints ?? [],
    tripNotes: tripContext.notes ?? "",
    marketingConsent: profile.profile.marketingConsent,
  };
}

function profileLoadStatus({
  error,
  isLoading,
  profile,
}: {
  error: unknown;
  isLoading: boolean;
  profile: UserProfileResponse | null;
}): "loading" | "ready" | "unauthenticated" | "error" {
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
  return {
    displayName: nullableText(form.displayName),
    homeCountry: nullableText(form.homeCountry),
    travelStyle: nullableText(form.travelStyle),
    ...optionPatch("budgetLevel", form.budgetLevel, budgetLevelOptions),
    dietaryNotes: nullableText(form.dietaryNotes),
    ...arrayPatch("foodNeeds", form.foodNeeds, profile?.profile.foodNeeds),
    accessibilityNotes: nullableText(form.accessibilityNotes),
    ...optionPatch("surfAbility", form.surfAbility, surfAbilityOptions),
    ...(form.quietSleepPreference === null
      ? {}
      : { quietSleepPreference: form.quietSleepPreference }),
    weatherPreference: form.weatherPreference || null,
    ...arrayPatch("interests", form.interests, profile?.profile.interests),
    ...arrayPatch("preferredAreas", form.preferredAreas, profile?.profile.preferredAreas),
    tripContext: {
      notes: nullableText(form.tripNotes),
      accommodation: nullableText(form.accommodation),
      dateRange: nullableText(form.dateRange),
      currentArea: form.currentArea || null,
      ...optionPatch("travelerType", form.travelerType, travelerTypeOptions),
      transportMode: form.transportMode || null,
      rideTimeLimitMinutes: nullableInteger(form.rideTimeLimitMinutes),
      durableConstraints: form.durableConstraints,
    },
    marketingConsent: form.marketingConsent,
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
  const multiValueField = /^(interests|preferredAreas|foodNeeds)(?:\.\d+)?$/.exec(path ?? "");
  return multiValueField?.[1] ?? path;
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
