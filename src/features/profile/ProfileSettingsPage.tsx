"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Save, UserRound } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clerkAppearance } from "@/features/auth/clerk-appearance";
import { isClerkConfigured } from "@/features/auth/clerk-config";
import type { UserProfileResponse } from "@/server/profile/user-profile-store";

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

export function ProfileSettingsPage() {
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthenticated" | "error">(
    "loading",
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const response = await fetch("/api/me/profile", { cache: "no-store" });
        if (!active) {
          return;
        }
        if (response.status === 401) {
          setStatus("unauthenticated");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          return;
        }

        const nextProfile = (await response.json()) as UserProfileResponse;
        setProfile(nextProfile);
        setForm(formFromProfile(nextProfile));
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

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
    <main className="min-h-dvh bg-[#f6f7f2] text-[#18211d]">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <ProfileHeader />

        {status === "loading" ? (
          <StatusPanel title="Loading profile" />
        ) : status === "unauthenticated" ? (
          <SignedOutPanel />
        ) : status === "error" || !profile ? (
          <StatusPanel title="Profile unavailable" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <IdentityPanel profile={profile} />
            <form className="grid gap-5" onSubmit={saveProfile}>
              <section className="grid gap-5 rounded-lg border border-[#d9ded3] bg-white p-5 shadow-sm">
                <div>
                  <h2 className="m-0 text-lg font-black">Travel profile</h2>
                  <p className="m-0 mt-1 text-sm leading-6 text-[#58645d]">
                    App profile details for Ask Siargao planning.
                  </p>
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
                  <label className="grid gap-2 text-sm font-extrabold text-[#27332d]">
                    Budget level
                    <select
                      className="h-10 rounded-md border border-[#cfd7cf] bg-white px-3 text-sm font-bold"
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
                    onChange={(preferredAreas) =>
                      setForm((current) => ({ ...current, preferredAreas }))
                    }
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <TextAreaField
                    label="Dietary notes"
                    value={form.dietaryNotes}
                    onChange={(dietaryNotes) =>
                      setForm((current) => ({ ...current, dietaryNotes }))
                    }
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

                <label className="flex items-center gap-3 rounded-md border border-[#d9ded3] bg-[#f8faf5] p-3 text-sm font-bold text-[#27332d]">
                  <input
                    checked={form.marketingConsent}
                    className="size-4 accent-[#148a66]"
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
                  <span className="text-sm font-bold text-[#58645d]" role="status">
                    {saveState === "saved"
                      ? "Profile saved"
                      : saveState === "error"
                        ? "Profile could not be saved"
                        : ""}
                  </span>
                </div>
              </section>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

function ProfileHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-[#dce2d8] border-b pb-5">
      <div>
        <p className="m-0 text-xs font-black tracking-[0.16em] text-[#148a66] uppercase">
          Ask Siargao
        </p>
        <h1 className="m-0 mt-2 text-3xl font-black text-[#17211c] sm:text-4xl">Profile</h1>
      </div>
      <Button asChild className="rounded-md" variant="outline">
        <Link href="/chat">Back to chat</Link>
      </Button>
    </header>
  );
}

function IdentityPanel({ profile }: { profile: UserProfileResponse }) {
  const fullName = [profile.identity.firstName, profile.identity.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className="grid h-fit gap-4 rounded-lg border border-[#d9ded3] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-[#e8f3ed] text-[#148a66]">
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-base font-black">Account identity</h2>
          <p className="m-0 truncate text-sm font-bold text-[#58645d]">
            {fullName || profile.identity.email}
          </p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="font-black text-[#58645d]">Email</dt>
          <dd className="m-0 break-words font-bold">{profile.identity.email}</dd>
        </div>
        <div>
          <dt className="font-black text-[#58645d]">Clerk user ID</dt>
          <dd className="m-0 break-all font-mono text-xs">{profile.identity.userId}</dd>
        </div>
      </dl>

      {isClerkConfigured ? (
        <Show fallback={null} when="signed-in">
          <div className="flex items-center gap-3 border-[#d9ded3] border-t pt-4">
            <UserButton appearance={clerkAppearance} />
            <span className="text-sm font-bold text-[#58645d]">Manage account</span>
          </div>
        </Show>
      ) : null}
    </aside>
  );
}

function SignedOutPanel() {
  return (
    <section className="grid max-w-xl gap-4 rounded-lg border border-[#d9ded3] bg-white p-6 shadow-sm">
      <h2 className="m-0 text-xl font-black">Sign in to manage your profile</h2>
      <p className="m-0 text-sm leading-6 text-[#58645d]">
        Ask Siargao keeps profile details with your signed-in account.
      </p>
      <div className="flex flex-wrap gap-3">
        {isClerkConfigured ? (
          <>
            <SignInButton mode="modal">
              <Button className="rounded-md" type="button">
                Sign in
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="rounded-md" type="button" variant="outline">
                Sign up
              </Button>
            </SignUpButton>
          </>
        ) : (
          <>
            <Button asChild className="rounded-md">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild className="rounded-md" variant="outline">
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
    <section className="rounded-lg border border-[#d9ded3] bg-white p-6 shadow-sm">
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
    <label className="grid gap-2 text-sm font-extrabold text-[#27332d]" htmlFor={inputId}>
      {label}
      <Input
        id={inputId}
        className="h-10 rounded-md border-[#cfd7cf] bg-white"
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
    <label className="grid gap-2 text-sm font-extrabold text-[#27332d]" htmlFor={inputId}>
      {label}
      <textarea
        id={inputId}
        className="min-h-28 rounded-md border border-[#cfd7cf] bg-white px-3 py-2 text-sm font-semibold outline-none focus-visible:border-[#148a66] focus-visible:ring-3 focus-visible:ring-[#148a66]/20"
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
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fieldId(label: string) {
  return `profile-${label.toLowerCase().replaceAll(" ", "-")}`;
}
