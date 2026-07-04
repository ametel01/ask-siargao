"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { ArrowRight, MessageCircle, Save, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";
import {
  AppBackdrop,
  appBodyClass,
  appPanelClass,
  appShellClass,
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
  interests: string;
  preferredAreas: string;
  tripNotes: string;
  marketingConsent: boolean;
};

const emptyForm: ProfileFormState = {
  displayName: "",
  homeCountry: "",
  travelStyle: "",
  budgetLevel: "",
  dietaryNotes: "",
  accessibilityNotes: "",
  interests: "",
  preferredAreas: "",
  tripNotes: "",
  marketingConsent: false,
};

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

export function SettingsDashboardPage() {
  const {
    data: loadedProfile,
    error: profileError,
    isLoading: isProfileLoading,
  } = useSWR("/api/me/profile", fetchProfile, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!loadedProfile) {
      return;
    }

    setProfile(loadedProfile);
    setForm(formFromProfile(loadedProfile));
  }, [loadedProfile]);

  const status = profileLoadStatus({
    error: profileError,
    isLoading: isProfileLoading,
    profile,
  });

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("saving");

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profilePatchFromForm(form)),
      });

      if (!response.ok) {
        setSaveState("error");
        return;
      }

      const nextProfile = (await response.json()) as UserProfileResponse;
      setProfile(nextProfile);
      setForm(formFromProfile(nextProfile));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <AppBackdrop>
      <div className={`${appShellClass} max-w-6xl gap-8`}>
        <SettingsHeader />

        {status === "loading" ? (
          <StatusPanel title="Loading settings" />
        ) : status === "unauthenticated" ? (
          <SignedOutPanel />
        ) : status === "error" || !profile ? (
          <StatusPanel title="Settings unavailable" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <SettingsSidebar profile={profile} />
            <form className="grid gap-5" onSubmit={saveProfile}>
              <TravelProfileSection form={form} saveState={saveState} setForm={setForm} />
            </form>
          </div>
        )}
      </div>
    </AppBackdrop>
  );
}

function SettingsHeader() {
  return (
    <>
      <BrandHeader
        action={
          <Button
            asChild
            className="rounded-md border-white/20 bg-white/10 text-text-on-dark hover:bg-white/15"
            variant="outline"
          >
            <Link href="/chat">Back to chat</Link>
          </Button>
        }
      />
      <PageHeader
        description="Manage your Ask Siargao account surface, trip preferences, saved planning context, and private travel data."
        eyebrow="User settings"
        title="Settings"
      />
    </>
  );
}

function SettingsSidebar({ profile }: { profile: UserProfileResponse }) {
  return (
    <aside className="grid h-fit gap-5">
      <AccountPanel profile={profile} />
      <ShortcutPanel />
      <PrivacyPanel />
    </aside>
  );
}

function AccountPanel({ profile }: { profile: UserProfileResponse }) {
  const fullName = [profile.identity.firstName, profile.identity.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={`${appPanelClass} grid gap-4`}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-brand-lagoon-100 text-brand-lagoon-700">
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-base font-black">Account</h2>
          <p className="m-0 truncate text-sm font-bold text-text-muted">
            {fullName || profile.identity.email}
          </p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="font-black text-text-muted">Email</dt>
          <dd className="m-0 break-words font-bold">{profile.identity.email}</dd>
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
    <section className={`${appPanelClass} grid gap-3`}>
      <h2 className="m-0 text-base font-black">Shortcuts</h2>
      <Button
        asChild
        className="h-auto justify-between rounded-md border-border-default bg-white px-3 py-3 text-left text-text-default hover:bg-brand-lagoon-100"
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

function PrivacyPanel() {
  return (
    <section className={`${appPanelClass} grid gap-3`}>
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

function TravelProfileSection({
  form,
  saveState,
  setForm,
}: {
  form: ProfileFormState;
  saveState: "idle" | "saving" | "saved" | "error";
  setForm: (update: (current: ProfileFormState) => ProfileFormState) => void;
}) {
  return (
    <section className={`${appPanelClass} grid gap-5`}>
      <div>
        <h2 className="m-0 text-lg font-black">Travel profile</h2>
        <p className={appBodyClass}>App profile details for Ask Siargao planning.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Display name"
          value={form.displayName}
          onChange={(displayName) => setForm((current) => ({ ...current, displayName }))}
        />
        <TextField
          label="Home country"
          value={form.homeCountry}
          onChange={(homeCountry) => setForm((current) => ({ ...current, homeCountry }))}
        />
        <TextField
          label="Travel style"
          value={form.travelStyle}
          onChange={(travelStyle) => setForm((current) => ({ ...current, travelStyle }))}
        />
        <label className="grid gap-2 text-sm font-extrabold text-text-default">
          Budget level
          <select
            className="h-10 rounded-md border border-border-default bg-white px-3 text-sm font-bold outline-none focus-visible:border-brand-lagoon-600 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
            value={form.budgetLevel}
            onChange={(event) =>
              setForm((current) => ({ ...current, budgetLevel: event.target.value }))
            }
          >
            <option value="">Not set</option>
            <option value="budget">Budget</option>
            <option value="mid_range">Mid-range</option>
            <option value="premium">Premium</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <TextField
          label="Interests"
          value={form.interests}
          onChange={(interests) => setForm((current) => ({ ...current, interests }))}
        />
        <TextField
          label="Preferred areas"
          value={form.preferredAreas}
          onChange={(preferredAreas) => setForm((current) => ({ ...current, preferredAreas }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField
          label="Dietary notes"
          value={form.dietaryNotes}
          onChange={(dietaryNotes) => setForm((current) => ({ ...current, dietaryNotes }))}
        />
        <TextAreaField
          label="Accessibility notes"
          value={form.accessibilityNotes}
          onChange={(accessibilityNotes) =>
            setForm((current) => ({ ...current, accessibilityNotes }))
          }
        />
      </div>

      <TextAreaField
        label="Trip notes"
        value={form.tripNotes}
        onChange={(tripNotes) => setForm((current) => ({ ...current, tripNotes }))}
      />

      <label className="flex items-center gap-3 rounded-md border border-brand-lagoon-700/10 bg-brand-lagoon-100 p-3 text-sm font-bold text-text-default">
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
        <Button className="rounded-md" disabled={saveState === "saving"} type="submit">
          <Save className="size-4" />
          {saveState === "saving" ? "Saving" : "Save profile"}
        </Button>
        <output className="text-sm font-bold text-text-muted">
          {saveState === "saved"
            ? "Profile saved"
            : saveState === "error"
              ? "Profile could not be saved"
              : ""}
        </output>
      </div>
    </section>
  );
}

function SignedOutPanel() {
  return (
    <section className={`${appPanelClass} grid max-w-xl gap-4`}>
      <h2 className="m-0 text-xl font-black">Sign in to manage your settings</h2>
      <p className={appBodyClass}>Ask Siargao keeps settings with your signed-in account.</p>
      <div className="flex flex-wrap gap-3">
        {isClerkConfigured ? (
          <>
            <SignInButton mode="modal">
              <Button className="rounded-md" type="button">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button
                className="rounded-md border-border-default bg-white text-text-default hover:bg-brand-lagoon-100"
                type="button"
                variant="outline"
              >
                Sign up
              </Button>
            </SignUpButton>
          </>
        ) : (
          <>
            <Button asChild className="rounded-md">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button
              asChild
              className="rounded-md border-border-default bg-white text-text-default hover:bg-brand-lagoon-100"
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
    <section className={appPanelClass}>
      <h2 className="m-0 text-xl font-black">{title}</h2>
    </section>
  );
}

function TextField({
  label,
  onChange,
  value,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = fieldId(label);

  return (
    <label className="grid gap-2 text-sm font-extrabold text-text-default" htmlFor={inputId}>
      {label}
      <Input
        id={inputId}
        className="h-10 rounded-md border-border-default bg-white focus-visible:border-brand-lagoon-600 focus-visible:ring-brand-lagoon-500/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  value,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = fieldId(label);

  return (
    <label className="grid gap-2 text-sm font-extrabold text-text-default" htmlFor={inputId}>
      {label}
      <textarea
        id={inputId}
        className="min-h-28 rounded-md border border-border-default bg-white px-3 py-2 text-sm font-semibold outline-none focus-visible:border-brand-lagoon-600 focus-visible:ring-3 focus-visible:ring-brand-lagoon-500/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function formFromProfile(profile: UserProfileResponse): ProfileFormState {
  return {
    displayName: profile.profile.displayName ?? "",
    homeCountry: profile.profile.homeCountry ?? "",
    travelStyle: profile.profile.travelStyle ?? "",
    budgetLevel: profile.profile.budgetLevel ?? "",
    dietaryNotes: profile.profile.dietaryNotes ?? "",
    accessibilityNotes: profile.profile.accessibilityNotes ?? "",
    interests: profile.profile.interests.join(", "),
    preferredAreas: profile.profile.preferredAreas.join(", "),
    tripNotes:
      typeof profile.profile.tripContext.notes === "string"
        ? profile.profile.tripContext.notes
        : "",
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

function profilePatchFromForm(form: ProfileFormState) {
  return {
    displayName: nullableText(form.displayName),
    homeCountry: nullableText(form.homeCountry),
    travelStyle: nullableText(form.travelStyle),
    budgetLevel: nullableText(form.budgetLevel),
    dietaryNotes: nullableText(form.dietaryNotes),
    accessibilityNotes: nullableText(form.accessibilityNotes),
    interests: commaList(form.interests),
    preferredAreas: commaList(form.preferredAreas),
    tripContext: nullableText(form.tripNotes) ? { notes: form.tripNotes.trim() } : {},
    marketingConsent: form.marketingConsent,
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function commaList(value: string) {
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

function fieldId(label: string) {
  return `profile-${label.toLowerCase().replaceAll(" ", "-")}`;
}
