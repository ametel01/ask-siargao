import { expect, type Locator, type Page, test } from "@playwright/test";

type ChatRequestBody = {
  threadId?: string;
  messages?: Array<{
    role?: string;
    content?: string;
  }>;
  clientContext?: {
    tripContext?: unknown;
    geolocation?: {
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number;
      capturedAt?: string;
      consentScope?: "single_request" | "trip_session";
    };
  };
};

type E2EThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete";
  sources: MockSourceSummary[];
  cards: MockRecommendationCard[];
  actions: MockChatAction[];
  itineraries: MockItineraryPlan[];
  decisionSummaries: unknown[];
  rating?: {
    rating: "up" | "down";
    reasonCodes: string[];
    comment: string | null;
  } | null;
  createdAt: string;
};

type MockSourceSummary = {
  label: string;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: string[];
  notChecked: string[];
};

type MockRecommendationCard = {
  id: string;
  kind: "place" | "beach";
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: string[];
  caveats: string[];
  sourceLabel: string;
  decision?: MockDecisionMetadata;
  sources?: MockSourceSummary[];
};

type MockChatAction = {
  id: string;
  label: string;
  prompt?: string;
};

type MockItineraryStop = {
  title: string;
  kind: "place" | "beach" | "activity" | "meal" | "transfer";
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: string[];
};

type MockItineraryPlan = {
  title: string;
  durationLabel: string;
  decision?: MockDecisionMetadata;
  stops: MockItineraryStop[];
  fallbackStops: MockItineraryStop[];
  skip: string[];
  sources: MockSourceSummary[];
};
type MockDecisionSummary = {
  id: string;
  bestAction: string;
  basis: string;
  fallback?: string;
  avoid?: string;
  timing?: string;
  area?: string;
  sources: MockSourceSummary[];
};
type MockDecisionMetadata = {
  label: "best_fit" | "good_now" | "fallback" | "avoid_today" | "needs_confirmation";
  bestAction: string;
};
type DecisionMotionMetrics = {
  starts: number;
  ends: number;
  layoutShift: number;
  longTasks: number[];
  rafFrames: number[];
};
type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
};
type E2ERecommendationPayload = {
  type: "recommendation_card";
  card: MockRecommendationCard;
};
type E2EItineraryPayload = {
  type: "itinerary_plan";
  plan: MockItineraryPlan;
};
type E2ENotePayload = {
  type: "note";
  text: string;
};
type E2ESavedTripItem = {
  id: string;
  tripId?: string;
  kind: "place" | "beach" | "itinerary" | "note";
  title: string;
  createdAt: string;
  updatedAt: string;
  payload: E2ERecommendationPayload | E2EItineraryPayload | E2ENotePayload;
  sources: MockSourceSummary[];
  mapsUrl?: string;
  caveats: string[];
};
type E2ESharedTripPlan = {
  id: string;
  title: string;
  createdAt: string;
  items: E2ESavedTripItem[];
};
type SavedTripItemsRequestBody = {
  tripId?: string;
  items?: E2ESavedTripItem[];
  messages?: unknown;
  clientContext?: unknown;
};
type SharedTripCreateRequestBody = {
  tripId?: string;
  itemIds?: string[];
  title?: string;
  messages?: unknown;
  clientContext?: unknown;
};

declare global {
  interface Window {
    __decisionMotionMetrics?: DecisionMotionMetrics;
  }
}

const savedTripStorageKey = "ask-siargao:saved-trip:v1";
const tripContextStorageKey = "ask-siargao:trip-context:v1";

test("sends a desktop composer message to the chat API and renders the assistant response", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 2048, height: 1153 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  const mockChat = await mockChatApi(page, {
    message:
      "Mocked dinner answer:\n\n- **Kermit:** casual dinner near Cloud 9\n- **Bravo:** pizza nearby",
    waitForRelease: true,
  });

  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Ask a real question/i })).toBeVisible();
  await expect(page.getByText("Ask about food, weather, transfers")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new chat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trip context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Siargao Island Weather" })).toBeVisible();
  await expect(page.getByText("No trip details yet")).toBeVisible();
  await expect(page.getByText("Nothing is assumed about your trip.")).toBeVisible();
  for (const formerDemoValue of [
    "Near Cloud 9 / Catangnan",
    "Jun 12 - 22",
    "June surf trip",
    "Cloud 9 shortlist",
    "4 places",
    "7 places",
    "3 places",
    "Is this hotel quiet?",
    "Best dinner near Catangnan",
    "Will it rain this afternoon?",
    "Surf conditions tomorrow?",
  ]) {
    await expect(page.getByText(formerDemoValue, { exact: true })).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("anonymous-empty-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("anonymous-empty-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 2048, height: 1153 });

  const composerInput = page.getByLabel("Ask anything about Siargao");
  const sendButton = page.getByRole("button", { name: "Send question" });
  await expect(composerInput).toBeVisible();
  await expect.poll(() => chatWorkspaceScrollSurfaces(page)).toEqual(["chat-message-scroll-area"]);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    )
    .toBe(true);
  await expect(composerInput).toHaveCSS("color", "rgb(13, 16, 74)");
  await expect
    .poll(() =>
      composerInput.evaluate((element) =>
        getComputedStyle(element, "::placeholder").color.toLowerCase(),
      ),
    )
    .toBe("rgb(132, 131, 168)");
  await expect
    .poll(() =>
      composerInput.evaluate((element) => {
        const composerSurface = element.closest("[data-slot='input-group']");
        return composerSurface ? getComputedStyle(composerSurface).backgroundColor : "";
      }),
    )
    .not.toBe("rgba(0, 0, 0, 0)");
  await composerInput.fill("Where should we eat near Cloud 9 tonight?");
  await sendButton.click();

  const userMessageBubble = page.getByTestId("user-message-bubble").last();
  await expect(userMessageBubble).toBeVisible();
  await expect(userMessageBubble).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByText("Where should we eat near Cloud 9 tonight?")).toBeVisible();
  await expect(page.getByText("Ask Siargao is preparing your answer.")).toBeVisible();
  await expect(page.getByTestId("decision-strip")).toHaveCount(0);
  await expect(page.getByText("At a Glance")).toHaveCount(0);
  await expect(composerInput).toBeDisabled();
  await expect(sendButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Help me plan a Siargao day" })).toBeDisabled();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe(
    "Where should we eat near Cloud 9 tonight?",
  );
  expect(mockChat.requests[0]?.clientContext).toBeUndefined();

  mockChat.release();

  await expect(page.getByText("Mocked dinner answer:")).toBeVisible();
  await expect(page.locator("strong", { hasText: "Kermit:" })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Kermit: casual dinner near Cloud 9" }),
  ).toBeVisible();
  await expect(composerInput).toBeEnabled();

  const composerBox = await composerInput.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox?.y ?? 0).toBeGreaterThanOrEqual(0);
  expect((composerBox?.y ?? 0) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(1153);
  await expect.poll(() => composerFitsViewport(page)).toBe(true);
});

test("shows checking condition decisions before routes resolve", async ({ page }) => {
  let releaseRoutes: (() => void) | undefined;
  const routeGate = new Promise<void>((resolve) => {
    releaseRoutes = resolve;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  await page.route("**/api/public/weather/siargao**", async (route) => {
    await routeGate;
    await route.fulfill({ status: 503, body: "weather unavailable" });
  });
  await page.route("**/api/public/surf/siargao**", async (route) => {
    await routeGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestedLocation: "Siargao Island",
        surf: {
          status: "unavailable",
          locationName: "Siargao Island",
          fetchedAt: "2026-07-10T01:00:00.000Z",
          level: "medium",
          metrics: { waves: "Unavailable", tide: "Unavailable", wind: "Unavailable" },
          weather: {
            status: "unavailable",
            freshness: "unknown",
            condition: "Unavailable",
            precipitationProbability: null,
            rainSum: null,
            windGust: null,
          },
          tide: { status: "unavailable", stationName: "Dapa tide station", bestWindow: null },
          caveats: [],
        },
      }),
    });
  });

  await page.goto("/chat");

  const rail = page.getByTestId("context-rail");
  await expect(rail.getByTestId("weather-condition-state")).toHaveText("Checking current signals");
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Checking current signals");
  releaseRoutes?.();
  await expect(rail.getByTestId("weather-condition-state")).toHaveText(
    "Current signals unavailable",
  );
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Current signals unavailable");
});

test("renders bounded condition decisions before their raw metrics", async ({ page }) => {
  let weatherMode: "fresh" | "stale" | "unknown" | "error" | "unavailable" = "fresh";
  let surfMode: "live" | "partial" | "unknown" | "no-window" | "error" | "unavailable" = "live";
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  await page.route("**/api/public/weather/siargao**", async (route) => {
    if (weatherMode === "unavailable" || weatherMode === "error") {
      await route.fulfill({ status: 503, body: "weather unavailable" });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestedLocation: "Siargao Island",
        weather: {
          status: "live",
          locationName: "Siargao Island",
          fetchedAt: "2026-07-10T01:00:00.000Z",
          freshness: weatherMode,
          today: {
            condition: "Rain",
            precipitationProbability: 50,
            rainSum: 7,
            precipitationSum: 7,
            windGust: 38,
          },
        },
      }),
    });
  });
  await page.route("**/api/public/surf/siargao**", async (route) => {
    if (surfMode === "error") {
      await route.fulfill({ status: 503, body: "surf unavailable" });
      return;
    }
    const isPartial = surfMode === "partial";
    const isUnavailable = surfMode === "unavailable";
    const hasWindow = !isPartial && surfMode !== "no-window";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestedLocation: "Siargao Island",
        surf: {
          status: isUnavailable ? "unavailable" : isPartial ? "partial" : "live",
          locationName: "Siargao Island",
          fetchedAt: "2026-07-10T01:00:00.000Z",
          level: "medium",
          metrics: {
            waves: isPartial || isUnavailable ? "Unavailable" : "0.7m swell / 10s",
            tide: isPartial || isUnavailable ? "Unavailable" : "High 4:55 AM 1.7m",
            wind: isUnavailable ? "Unavailable" : "gust 38km/h",
          },
          weather: {
            status: "live",
            freshness: surfMode === "unknown" ? "unknown" : "fresh",
            condition: isUnavailable ? "Unavailable" : "Rain",
            precipitationProbability: isUnavailable ? null : 50,
            rainSum: isUnavailable ? null : 7,
            windGust: isUnavailable ? null : 38,
          },
          tide: {
            status: isPartial || isUnavailable ? "unavailable" : "live",
            stationName: "Dapa tide station",
            bestWindow: hasWindow ? "5:00 AM-8:00 AM: near high tide" : null,
          },
          caveats: [],
        },
      }),
    });
  });

  await page.goto("/chat");

  const rail = page.getByTestId("context-rail");
  await expect(rail.getByTestId("weather-condition-action")).toHaveText(
    "Choose cover and keep the plan flexible.",
  );
  await expect(rail.getByTestId("weather-condition-fallback")).toContainText("covered stop");
  await expect(rail.getByTestId("weather-condition-evidence")).toContainText(
    "Forecast freshness: fresh",
  );
  await expect(rail.getByTestId("surf-condition-action")).toHaveText(
    "Use the Dapa tide window as a planning cue, then confirm locally.",
  );
  await expect(rail.getByTestId("surf-condition-timing")).toContainText("5:00 AM-8:00 AM");
  await expect(rail.getByTestId("surf-condition-evidence")).toContainText(
    "Dapa tide freshness was not supplied",
  );
  await expect(rail).toContainText("Exact-break conditions");
  await expect(rail).toContainText("Road access, official marine warnings, and safety status");
  await expect
    .poll(() =>
      rail.evaluate((element) => {
        const action = element.querySelector("[data-testid='weather-condition-action']");
        const metric = Array.from(element.querySelectorAll("p")).find(
          (candidate) => candidate.textContent === "Rain chance",
        );
        return Boolean(
          action &&
            metric &&
            action.getBoundingClientRect().top < metric.getBoundingClientRect().top,
        );
      }),
    )
    .toBe(true);

  weatherMode = "stale";
  surfMode = "partial";
  await rail.getByRole("button", { name: "Refresh weather" }).click();
  await rail.getByRole("button", { name: "Refresh surf conditions" }).click();
  await expect(rail.getByTestId("weather-condition-state")).toHaveText("Prior signals; rechecking");
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Partial checked signals");
  await expect(rail.getByTestId("surf-condition-basis")).toContainText("Missing: tide, swell");

  weatherMode = "unknown";
  surfMode = "unknown";
  await rail.getByRole("button", { name: "Refresh weather" }).click();
  await rail.getByRole("button", { name: "Refresh surf conditions" }).click();
  await expect(rail.getByTestId("weather-condition-state")).toHaveText("Freshness not verified");
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Freshness not verified");
  await expect(rail.getByTestId("surf-condition-action")).toHaveText(
    "Keep surf plans flexible and confirm locally.",
  );

  weatherMode = "fresh";
  surfMode = "no-window";
  await rail.getByRole("button", { name: "Refresh weather" }).click();
  await rail.getByRole("button", { name: "Refresh surf conditions" }).click();
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Checked signals available");
  await expect(rail.getByTestId("surf-condition-action")).toHaveText(
    "Keep surf plans flexible and confirm locally.",
  );
  await expect(rail.getByTestId("surf-condition-timing")).toHaveCount(0);

  weatherMode = "error";
  surfMode = "error";
  await rail.getByRole("button", { name: "Refresh weather" }).click();
  await rail.getByRole("button", { name: "Refresh surf conditions" }).click();
  await expect(rail.getByTestId("weather-condition-state")).toHaveText("Prior signals; rechecking");
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Prior signals; rechecking");

  weatherMode = "unavailable";
  surfMode = "unavailable";
  await page.reload();
  await expect(rail.getByTestId("weather-condition-state")).toHaveText(
    "Current signals unavailable",
  );
  await expect(rail.getByTestId("surf-condition-state")).toHaveText("Current signals unavailable");
});

test("shows the trip context rail at normal desktop browser width", async ({ page }) => {
  await page.setViewportSize({ width: 1224, height: 768 });
  await mockChatApi(page, {
    message: "Mocked desktop answer.",
  });

  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trip context" })).toBeVisible();
  await expect(page.getByTestId("context-rail")).toBeVisible();
  await expect(page.getByTestId("mobile-trip-context-trigger")).toHaveCount(0);
  await expect.poll(() => chatWorkspaceScrollSurfaces(page)).toEqual(["chat-message-scroll-area"]);
  await expect.poll(() => rightRailFitsViewport(page)).toBe(true);
});

const mobileTripContextStateCases = [
  {
    state: "empty",
    profileStatus: "anonymous",
    triggerAction: "Add trip details",
    triggerDetail: "No details yet",
    dialogText: "Nothing is assumed",
  },
  {
    state: "partial",
    profileStatus: "anonymous",
    storedContext: { dateRange: "Aug 1 - 6" },
    triggerAction: "View trip details",
    triggerDetail: "Aug 1 - 6",
    dialogText: "Aug 1 - 6",
  },
  {
    state: "populated",
    profileStatus: "authenticated",
    triggerAction: "View trip details",
    triggerDetail: "Dapa · Aug 1 - 6",
    dialogText: "A very long Pilar homestay name that must wrap without widening the sheet",
  },
  {
    state: "loading",
    profileStatus: "loading",
    triggerAction: "View trip details",
    triggerDetail: "Loading details",
    dialogText: "Loading your trip details",
  },
  {
    state: "unavailable",
    profileStatus: "unavailable",
    triggerAction: "View trip details",
    triggerDetail: "Details unavailable",
    dialogText: "Trip details could not be loaded",
  },
] as const;

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const) {
  for (const stateCase of mobileTripContextStateCases) {
    test(`renders ${stateCase.state} mobile trip context at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      if ("storedContext" in stateCase) {
        await page.addInitScript(
          ({ key, value }) => {
            localStorage.setItem(key, JSON.stringify(value));
          },
          { key: tripContextStorageKey, value: stateCase.storedContext },
        );
      }

      const profileGate = await mockMobileTripContextProfile(page, stateCase.profileStatus);
      await mockUnavailableMobileConditions(page);
      await page.goto("/chat");

      const trigger = page.getByTestId("mobile-trip-context-trigger");
      await expect(trigger).toBeVisible();
      await expect(trigger).toContainText(stateCase.triggerAction);
      await expect(trigger).toContainText(stateCase.triggerDetail);
      await expect(page.getByTestId("context-rail")).toBeHidden();
      await expect(page.getByTestId("mobile-trip-context-dialog")).toHaveCount(0);

      await trigger.click();
      const dialog = page.getByTestId("mobile-trip-context-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(stateCase.dialogText);
      await expect(dialog.getByTestId("mobile-pass-state")).toContainText(
        "Trip Pass details are not connected",
      );
      await expect(dialog).not.toContainText("Jun 12 - 22");
      await expect(dialog).not.toContainText("Couple");
      await expect
        .poll(() => mobileTripContextGeometry(page))
        .toMatchObject({
          documentFitsViewport: true,
          dialogFitsViewport: true,
          hasInternalScroll: true,
          triggerTouchTarget: true,
          controlsFitDialog: true,
          safeAreaPaddingApplied: true,
        });

      await page.screenshot({
        path: testInfo.outputPath(`mobile-trip-${stateCase.state}-${viewport.width}.png`),
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "Close trip details" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      profileGate.release();
    });
  }
}

test("keeps mobile modal interaction, anonymous edits, and location scope in the conversation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const scope = window as typeof window & { __mobileLocationRequests?: number };
    scope.__mobileLocationRequests = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          scope.__mobileLocationRequests = (scope.__mobileLocationRequests ?? 0) + 1;
          success({
            coords: {
              latitude: 9.8116,
              longitude: 126.1651,
              accuracy: 25,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  await mockMobileTripContextProfile(page, "anonymous");
  await mockUnavailableMobileConditions(page);
  await page.goto("/chat");

  const composer = page.getByLabel("Ask anything about Siargao");
  await composer.fill("Keep this draft while I check my trip details");
  const trigger = page.getByTestId("mobile-trip-context-trigger");
  await trigger.click();
  const dialog = page.getByTestId("mobile-trip-context-dialog");
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog.getByRole("button", { name: "Close trip details" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Ask anything about Siargao" })).toHaveCount(0);
  let outsideClickBlocked = false;
  try {
    await composer.click({ timeout: 500, trial: true });
  } catch {
    outsideClickBlocked = true;
  }
  expect(outsideClickBlocked).toBe(true);
  await composer.evaluate((element) => element.focus());
  await expect.poll(() => focusIsInsideMobileTripDialog(page)).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __mobileLocationRequests?: number })
          .__mobileLocationRequests ?? 0,
    ),
  ).toBe(0);
  await expect(dialog.getByTestId("mobile-location-state")).toContainText(
    "Browser location is off",
  );

  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => focusIsInsideMobileTripDialog(page)).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(() => focusIsInsideMobileTripDialog(page)).toBe(true);

  const accommodation = dialog.getByLabel("Accommodation");
  await accommodation.fill("Draft stay to cancel");
  await dialog.getByRole("button", { name: "Cancel edits" }).click();
  await expect(accommodation).toHaveValue("");
  await accommodation.fill("Pilar homestay");
  await dialog.getByLabel("Dates").fill("Aug 1 - 6");
  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await expect(dialog).toContainText("Trip details saved.");
  await expect
    .poll(() => readTripContextStorage(page))
    .toMatchObject({ accommodation: "Pilar homestay", dateRange: "Aug 1 - 6" });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(composer).toHaveValue("Keep this draft while I check my trip details");
  await trigger.click();
  await expect(dialog.getByLabel("Accommodation")).toHaveValue("Pilar homestay");
  await dialog.getByRole("button", { name: "Close trip details" }).click();

  await page.getByRole("button", { name: "Enable location" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __mobileLocationRequests?: number })
            .__mobileLocationRequests ?? 0,
      ),
    )
    .toBe(1);
  await trigger.click();
  await expect(dialog.getByTestId("mobile-location-state")).toContainText(
    "Browser location is active for this chat",
  );
  await expect(dialog.getByTestId("mobile-location-state")).not.toContainText("9.8116");
  await expect(dialog.getByTestId("mobile-location-state")).not.toContainText("126.1651");
});

test("suppresses duplicate authenticated saves and preserves newer edits across late responses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  let profile = mobileAuthenticatedProfile();
  let patchCount = 0;
  let releaseFirstPatch: (() => void) | undefined;
  let firstPatchStarted: (() => void) | undefined;
  const firstPatchRequest = new Promise<void>((resolve) => {
    firstPatchStarted = resolve;
  });
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(profile),
      });
      return;
    }

    patchCount += 1;
    const body = route.request().postDataJSON() as { tripContext: Record<string, unknown> };
    if (patchCount === 1) {
      firstPatchStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirstPatch = resolve;
      });
    }
    profile = { ...profile, tripContext: body.tripContext };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await mockUnavailableMobileConditions(page);
  await page.goto("/chat");

  await page.getByTestId("mobile-trip-context-trigger").click();
  const dialog = page.getByTestId("mobile-trip-context-dialog");
  await dialog.getByLabel("Accommodation").fill("First save");
  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await firstPatchRequest;
  const pendingSave = dialog.getByRole("button", { name: "Saving…" });
  await expect(pendingSave).toBeDisabled();
  await pendingSave.dispatchEvent("click");
  await dialog.getByLabel("Dates").fill("Newer unsaved date");
  expect(patchCount).toBe(1);
  releaseFirstPatch?.();
  await expect(dialog.getByLabel("Dates")).toHaveValue("Newer unsaved date");
  await expect(dialog).toContainText("Unsaved edits");
  await expect(dialog).not.toContainText("Trip details saved.");

  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await expect(dialog).toContainText("Trip details saved.");
  expect(patchCount).toBe(2);
  expect(profile.tripContext).toMatchObject({
    accommodation: "First save",
    dateRange: "Newer unsaved date",
    notes: "Late arrival",
  });
});

test("keeps authenticated edits through validation and network save failures", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let saveMode: "validation" | "network" | "success" = "validation";
  let profile = mobileAuthenticatedProfile();
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
      return;
    }
    if (saveMode === "validation") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_profile_request" }),
      });
      return;
    }
    if (saveMode === "network") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "profile_save_failed" }),
      });
      return;
    }
    const body = route.request().postDataJSON() as { tripContext: Record<string, unknown> };
    profile = { ...profile, tripContext: body.tripContext };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await mockUnavailableMobileConditions(page);
  await page.goto("/chat");

  await page.getByTestId("mobile-trip-context-trigger").click();
  const dialog = page.getByTestId("mobile-trip-context-dialog");
  const accommodation = dialog.getByLabel("Accommodation");
  await accommodation.fill("Retry-safe stay");
  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await expect(dialog).toContainText("Review the trip details and try again.");
  await expect(accommodation).toHaveValue("Retry-safe stay");

  saveMode = "network";
  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await expect(dialog).toContainText("Your edits are still here.");
  await expect(accommodation).toHaveValue("Retry-safe stay");

  saveMode = "success";
  await dialog.getByRole("button", { name: "Save trip details" }).click();
  await expect(dialog).toContainText("Trip details saved.");
  expect(profile.tripContext).toMatchObject({ accommodation: "Retry-safe stay" });
});

test("keeps the desktop authenticated editor open when save fails", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let releasePatch: (() => void) | undefined;
  let patchStarted: (() => void) | undefined;
  const patchRequest = new Promise<void>((resolve) => {
    patchStarted = resolve;
  });
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(mobileAuthenticatedProfile()),
      });
      return;
    }

    patchStarted?.();
    await new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "profile_save_failed" }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await mockUnavailableMobileConditions(page);
  await page.goto("/chat");

  const rail = page.getByTestId("context-rail");
  await rail.getByRole("button", { name: "Edit" }).click();
  const accommodation = rail.getByLabel("Accommodation");
  await accommodation.fill("Retry-safe desktop stay");
  await rail.getByRole("button", { name: "Save" }).click();
  await patchRequest;
  await expect(rail.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(rail).toContainText("Saving your trip details.");

  releasePatch?.();
  await expect(rail).toContainText(
    "Your changes are still here. Check your connection and try again.",
  );
  await expect(accommodation).toHaveValue("Retry-safe desktop stay");
  await expect(rail.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("shares one typed live-condition projection between mobile and desktop without duplicate fetches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMobileTripContextProfile(page, "anonymous");
  const requestCounts = await mockMobileConditionDecisions(page);
  await page.goto("/chat");

  await page.getByTestId("mobile-trip-context-trigger").click();
  const dialog = page.getByTestId("mobile-trip-context-dialog");
  const mobileWeather = dialog.getByTestId("mobile-weather-condition");
  const mobileSurf = dialog.getByTestId("mobile-surf-condition");
  await expect(mobileWeather.getByTestId("mobile-weather-condition-action")).toHaveText(
    "Choose cover and keep the plan flexible.",
  );
  await expect(mobileWeather.getByTestId("mobile-weather-condition-basis")).toContainText(
    "checked daily forecast",
  );
  await expect(mobileWeather.getByTestId("weather-condition-state")).toHaveText(
    "Checked signals available",
  );
  await expect(mobileSurf.getByTestId("surf-condition-state")).toHaveText(
    "Partial checked signals",
  );
  await expect(mobileSurf.getByTestId("mobile-surf-condition-basis")).toContainText(
    "Missing: tide, swell",
  );
  await expect(dialog).toContainText("Road access, official marine warnings, and safety status");
  await expect(dialog).not.toContainText("Roads are safe");
  expect(requestCounts()).toEqual({ surf: 1, weather: 1 });

  const mobileSemantics = await conditionDecisionText(dialog, "mobile-");
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopRail = page.getByTestId("context-rail");
  await expect(desktopRail).toBeVisible();
  await expect(page.getByTestId("mobile-trip-context-trigger")).toHaveCount(0);
  await expect.poll(() => conditionDecisionText(desktopRail)).toEqual(mobileSemantics);
  expect(requestCounts()).toEqual({ surf: 1, weather: 1 });
});

test("renders only stored anonymous trip facts across desktop and mobile screenshots", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: tripContextStorageKey,
      value: {
        accommodation: "Pilar homestay",
        travelerType: "Two friends",
      },
    },
  );
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");

  const contextRail = page.getByTestId("context-rail");
  await expect(contextRail).toContainText("Pilar homestay");
  await expect(contextRail).toContainText("Two friends");
  await expect(contextRail).not.toContainText("Jun 12 - 22");
  await expect(contextRail).not.toContainText("Near Cloud 9 / Catangnan");
  await expect(contextRail).not.toContainText("Couple");
  await page.screenshot({
    path: testInfo.outputPath("anonymous-populated-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByTestId("context-rail")).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("anonymous-populated-mobile.png"),
    fullPage: true,
  });
});

test("does not expose browser trip context when the authenticated profile request fails", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: tripContextStorageKey,
      value: { accommodation: "Stale browser stay", nearbyArea: "Cloud 9" },
    },
  );
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "profile_unavailable" }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");

  const contextRail = page.getByTestId("context-rail");
  await expect(contextRail).toContainText("Trip details could not be loaded.");
  await expect(contextRail).not.toContainText("Stale browser stay");
  await expect(contextRail).not.toContainText("Near Cloud 9 / Catangnan");
});

test("does not submit stale browser trip context after the authenticated profile resolves", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: tripContextStorageKey,
      value: {
        accommodation: "Stale browser villa",
        dateRange: "Jan 1 - 31",
        travelerType: "Another traveler",
        nearbyArea: "Del Carmen",
      },
    },
  );
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          tripContext: {
            accommodation: "Owner-scoped stay",
            dateRange: "Aug 1 - 6",
            currentArea: "Dapa",
          },
        },
      }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  const mockChat = await mockChatApi(page, { message: "Owner-scoped response." });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");

  await expect(page.getByTestId("context-rail")).toContainText("Owner-scoped stay");
  await expect(page.getByTestId("context-rail")).toContainText("Dapa");
  await expect(page.getByTestId("context-rail")).not.toContainText("Stale browser villa");
  await page.getByLabel("Ask anything about Siargao").fill("What should I plan?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(mockChat.requests[0]?.clientContext?.tripContext).toBeUndefined();
});

test("hides stale local saved planning while authenticated hydration is pending or fails", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: savedTripStorageKey,
      value: {
        tripId: "local_trip_stale_saved_item",
        updatedAt: "2026-07-10T00:00:00.000Z",
        items: [
          {
            id: "place:stale-browser-item",
            title: "Stale browser saved place",
            kind: "place",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
            payload: {},
            sources: [],
            caveats: [],
          },
        ],
      },
    },
  );
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripContext: {} }),
    });
  });
  let releaseSavedTripRequest: (() => void) | undefined;
  let markSavedTripRequested: (() => void) | undefined;
  const savedTripRequested = new Promise<void>((resolve) => {
    markSavedTripRequested = resolve;
  });
  await page.route("**/api/trips/saved", async (route) => {
    markSavedTripRequested?.();
    await new Promise<void>((resolve) => {
      releaseSavedTripRequest = resolve;
    });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "saved_trip_unavailable" }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");

  await savedTripRequested;
  await expect(page.getByTestId("saved-trip-status")).toContainText("Loading your saved planning.");
  await expect(page.getByText("Stale browser saved place")).toHaveCount(0);
  releaseSavedTripRequest?.();
  await expect(page.getByTestId("saved-trip-status")).toContainText(
    "Saved planning is unavailable",
  );
  await expect(page.getByText("Stale browser saved place")).toHaveCount(0);
});

test("renders assistant markdown tables as real tables", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1153 });
  await mockChatApi(page, {
    message: [
      "Best options in **General Luna / Catangnan**:",
      "",
      "| Rental shop | Area | Price signal | Contact / notes |",
      "| --- | --- | ---: | --- |",
      "| **Golden Bell Siargao** | Tourism Road, General Luna | From **₱350/day** | Message first for availability, helmet, deposit, and delivery. |",
      "| **Siargao Motorbike Rentals** | Purok 5, General Luna | Honda Beat **₱350/day** | Ask about pickup, surf rack, and current deposit rules. |",
      "| **Lola's Rentals** | Tourism Road, Catangnan | About **₱465/day** | Good backup if you are near Cloud 9. |",
      "",
      "My pick: message **Golden Bell Siargao** first, then use Siargao Motorbike Rentals as backup.",
    ].join("\n"),
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("where can i rent a motorbike in gl?");
  const sendButton = page.getByRole("button", { name: "Send question" });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const assistantBubble = page.getByTestId("assistant-message-bubble").last();
  await expect(assistantBubble.getByRole("table")).toBeVisible();
  await expect(assistantBubble.getByRole("columnheader", { name: "Rental shop" })).toBeVisible();
  await expect(assistantBubble.getByRole("cell", { name: /Golden Bell Siargao/ })).toBeVisible();
  await expect(assistantBubble.getByRole("cell", { name: "From ₱350/day" })).toBeVisible();
  await expect(assistantBubble.getByText("| Rental shop |")).toHaveCount(0);
  await expect(assistantBubble.getByText("My pick:")).toBeVisible();
});

test("renders assistant presentation smoke on desktop and mobile", async ({ page }) => {
  const smokeMessage = [
    "Here is the short list with an inline guide link: https://example.com/siargao-guide.",
    "",
    "## Quick picks",
    "",
    "| Place | Area | Why |",
    "| --- | :---: | --- |",
    "| **Shaka Siargao** | Cloud 9 | Easy breakfast before surf. |",
    "| **Bravo** | General Luna | Better dinner backup. |",
    "",
    "Checked: Google Places API - selected recommendations. Not checked: table availability.",
  ].join("\n");
  const mockChat = await mockChatApi(page, {
    message: smokeMessage,
    cards: [
      {
        id: "place_shaka_smoke",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka-smoke",
        distanceLabel: "About 50 m from search center.",
        openStatusLabel: "Open now according to Google Places.",
        fitReasons: ["Selected by the smoke fixture."],
        caveats: ["Table availability was not checked."],
        sourceLabel: "Google Places - live checked",
        sources: [mockPlacesSource],
      },
    ],
  });

  for (const viewport of [
    { label: "desktop", width: 1280, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/chat");
    await page
      .getByLabel("Ask anything about Siargao")
      .fill(`Render assistant smoke on ${viewport.label}`);
    await page.getByRole("button", { name: "Send question" }).click();

    const assistantBubble = page.getByTestId("assistant-message-bubble").last();
    await expect(assistantBubble).toContainText("Here is the short list");
    await expect(
      assistantBubble.getByRole("link", { name: "Open example.com link" }),
    ).toHaveAttribute("href", "https://example.com/siargao-guide");
    await expect(assistantBubble.getByTestId("assistant-source-line")).toHaveCount(2);
    await expect(assistantBubble.getByTestId("recommendation-card")).toContainText("Shaka Siargao");

    if (viewport.label === "mobile") {
      await expect(assistantBubble.getByTestId("assistant-mobile-table-card")).toHaveCount(2);
      await expect(
        assistantBubble.getByTestId("assistant-mobile-table-card").first(),
      ).toContainText("Easy breakfast before surf.");
    } else {
      await expect(assistantBubble.getByRole("table")).toBeVisible();
      await expect(assistantBubble.getByRole("columnheader", { name: "Place" })).toBeVisible();
    }

    await expect
      .poll(async () =>
        assistantBubble.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
  }

  expect(mockChat.requests).toHaveLength(2);
});

test("keeps a crowded chat history from clipping the active assistant reply", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1153 });
  const threads = Array.from({ length: 12 }, (_, index) => ({
    id: `thread_party_${index}`,
    title:
      index === 0
        ? "where should i go party tonight in general luna?"
        : `where can i go party tonight in general luna? ${index}`,
    status: "active",
    createdAt: "2026-07-01T01:00:00.000Z",
    updatedAt: "2026-07-01T01:00:00.000Z",
    lastMessageAt: "2026-07-01T01:00:00.000Z",
  }));
  await page.route("**/api/chat/threads**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/chat/threads") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ threads }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    });
  });
  await mockChatApi(page, {
    message: [
      "For Wednesday night in General Luna, use this as the baseline route:",
      "",
      "1. Goodies, around 8 PM-midnight, as the strongest Wednesday dance anchor.",
      "2. Mama Coco, around 9 PM+, if you want reggaeton, Afro, or dancehall instead.",
      "3. El Lobo as the late fallback if the first stop slows down.",
      "4. Keep the route walkable if the road is wet.",
      "5. Put the late stop last so you can leave early without losing the main plan.",
      "6. Check whether the first venue is busy before committing to a table.",
      "7. Keep cash ready for short tricycle hops.",
      "8. Choose the driest route back toward your accommodation.",
      "9. Avoid adding a far northern stop unless you already have transport.",
      "10. Keep one quiet fallback if the group wants to stop dancing.",
      "11. Save the last move for the closest reliable ride pickup.",
      "12. Use the same route order if the rain returns.",
      ...Array.from(
        { length: 24 },
        (_, index) =>
          `${index + 13}. Keep this extra planning checkpoint visible in the scrollable answer region.`,
      ),
      "",
      "I could not verify current public web evidence right now, so treat this as stable baseline guidance.",
      "",
      "Final visible dinner checkpoint: if you want, I can narrow this to cheap, romantic, or closest-to-your-room options.",
    ].join("\n"),
  });

  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Recent questions" })).toBeVisible();
  await expect.poll(() => chatWorkspaceScrollSurfaces(page)).toEqual(["chat-message-scroll-area"]);

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("where should i go party tonight in general luna?");
  await composerInput.press("Enter");

  const assistantBubble = page.getByTestId("assistant-message-bubble").last();
  const composerForm = page.getByRole("form", { name: "Ask Siargao composer" });
  const finalCheckpoint = page.getByText("Final visible dinner checkpoint");
  await expect(assistantBubble).toBeVisible();
  await expect(page.getByText("El Lobo as the late fallback")).toBeVisible();
  await expect(finalCheckpoint).toBeVisible();
  await expect
    .poll(() =>
      page.getByTestId("chat-message-scroll-area").evaluate((element) => element.scrollTop > 0),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => composerFitsViewport(page)).toBe(true);
  await expect
    .poll(async () => {
      const finalLineBox = await finalCheckpoint.boundingBox();
      const composerBox = await composerForm.boundingBox();
      if (!finalLineBox || !composerBox) {
        return false;
      }
      return finalLineBox.y + finalLineBox.height <= composerBox.y;
    })
    .toBe(true);
});

test("loads signed-in chat history and preserves the thread after reload", async ({ page }) => {
  await installDecisionMotionProbe(page);
  const chatRequests: ChatRequestBody[] = [];
  const thread = {
    id: "thread_existing",
    title: "Cloud 9 plan",
    status: "active",
    createdAt: "2026-06-29T01:00:00.000Z",
    updatedAt: "2026-06-29T01:00:00.000Z",
    lastMessageAt: "2026-06-29T01:01:00.000Z",
  };
  const messages: E2EThreadMessage[] = [
    {
      id: "message_user_existing",
      role: "user",
      content: "Where should I eat near Cloud 9?",
      status: "complete",
      sources: [],
      cards: [],
      actions: [],
      itineraries: [],
      decisionSummaries: [],
      createdAt: "2026-06-29T01:00:00.000Z",
    },
    {
      id: "message_assistant_existing",
      role: "assistant",
      content: "Try Shaka for breakfast and Bravo for dinner.",
      status: "complete",
      sources: [mockWeatherSource],
      cards: [
        {
          id: "place_shaka_hydrated",
          kind: "place",
          title: "Shaka Siargao",
          subtitle: "Cafe - Cloud 9, General Luna",
          mapsUrl: "https://maps.google.com/?cid=shaka",
          distanceLabel: "About 50 m from search center.",
          openStatusLabel: "Open now according to Google Places.",
          fitReasons: ["Selected card remains visible beside the decision strip."],
          caveats: ["Table availability was not checked."],
          sourceLabel: "Google Places - live checked",
          sources: [mockPlacesSource],
        },
      ],
      actions: [],
      itineraries: [],
      decisionSummaries: [
        {
          id: "condition_decision:breakfast:cloud_9:today",
          bestAction: "Start with breakfast near Cloud 9.",
          basis: "The existing thread selected a compact next move.",
          sources: [],
        },
      ],
      rating: null,
      createdAt: "2026-06-29T01:01:00.000Z",
    },
  ];

  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tripContext: {
          accommodation: "Owner's Dapa stay",
          dateRange: "Aug 1 - 6",
          travelerType: "Family",
        },
      }),
    });
  });

  await page.route("**/api/chat/threads**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET" && url.pathname === "/api/chat/threads") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ threads: [thread] }),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/api/chat/threads/thread_existing") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ thread, messages }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripId: "trip_existing", items: [] }),
    });
  });

  await page.route("**/api/chat", async (route) => {
    chatRequests.push(route.request().postDataJSON() as ChatRequestBody);
    messages.push(
      {
        id: "message_user_follow_up",
        role: "user",
        content: "What should I add after Shaka?",
        status: "complete",
        sources: [],
        cards: [],
        actions: [],
        itineraries: [],
        decisionSummaries: [],
        createdAt: "2026-06-29T01:02:00.000Z",
      },
      {
        id: "message_assistant_follow_up",
        role: "assistant",
        content: "Add Bravo after Shaka for an easy General Luna dinner.",
        status: "complete",
        sources: [],
        cards: [],
        actions: [],
        itineraries: [],
        decisionSummaries: [],
        rating: null,
        createdAt: "2026-06-29T01:03:00.000Z",
      },
    );

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Add Bravo after Shaka for an easy General Luna dinner.",
        model: "gpt-5.4-mini-test",
        requestId: "req_playwright_chat_history",
        threadId: thread.id,
        userMessageId: "message_user_follow_up",
        assistantMessageId: "message_assistant_follow_up",
      }),
    });
  });

  await page.route("**/api/chat/ratings", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      messageId?: string;
      rating?: "up" | "down";
    };
    expect(requestBody).toMatchObject({
      messageId: "message_assistant_existing",
      rating: "up",
    });

    const savedRating = {
      id: "rating_existing",
      messageId: "message_assistant_existing",
      threadId: thread.id,
      userId: "user_history",
      rating: "up" as const,
      reasonCodes: [],
      comment: null,
      createdAt: "2026-06-29T01:02:00.000Z",
      updatedAt: "2026-06-29T01:02:00.000Z",
    };
    messages[1] = {
      ...messages[1],
      rating: {
        rating: savedRating.rating,
        reasonCodes: savedRating.reasonCodes,
        comment: savedRating.comment,
      },
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rating: savedRating }),
    });
  });

  await page.goto("/chat");

  await expect(page.getByRole("link", { exact: true, name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  await expect(page.getByTestId("context-rail")).toContainText("Owner's Dapa stay");
  await expect(page.getByTestId("context-rail")).toContainText("Aug 1 - 6");
  await expect(page.getByTestId("context-rail")).not.toContainText("Near Cloud 9 / Catangnan");
  await expect(page.getByRole("heading", { name: "Recent questions" })).toBeVisible();
  await page.getByRole("button", { name: /Cloud 9 plan/ }).click();
  await expect(page.getByText("Where should I eat near Cloud 9?")).toBeVisible();
  await expect(page.getByText("Try Shaka for breakfast and Bravo for dinner.")).toBeVisible();
  const hydratedAnswer = page.getByTestId("assistant-message-bubble").filter({
    hasText: "Try Shaka for breakfast and Bravo for dinner.",
  });
  const hydratedStrip = hydratedAnswer.getByTestId("decision-strip");
  await expect(hydratedStrip).toContainText("Start with breakfast near Cloud 9.");
  await expect.poll(async () => (await decisionMotionMetrics(page))?.starts ?? -1).toBe(0);
  await expect(hydratedStrip.getByTestId("decision-strip-source-status")).toHaveCount(0);
  await expect(hydratedStrip.getByText("Where", { exact: true })).toHaveCount(0);
  await expect(hydratedStrip.getByText("When", { exact: true })).toHaveCount(0);
  await expect(hydratedStrip.getByText("Backup:", { exact: true })).toHaveCount(0);
  await expect(hydratedStrip.getByText("Avoid:", { exact: true })).toHaveCount(0);
  await expect(page.getByText("At a Glance")).toHaveCount(0);
  await expect(
    hydratedAnswer.getByTestId("recommendation-card").filter({ hasText: "Shaka Siargao" }),
  ).toBeVisible();
  const sourceControl = hydratedAnswer.getByTestId("assistant-sources-panel").locator("summary");
  const helpfulButton = hydratedAnswer.getByRole("button", {
    name: "Rate assistant response helpful",
  });
  await sourceControl.focus();
  await expect(sourceControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(helpfulButton).toBeFocused();
  expect(await helpfulButton.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  expect(await helpfulButton.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
    "none",
  );
  await expect(helpfulButton).toHaveAttribute("aria-pressed", "false");
  await helpfulButton.click();
  await expect(helpfulButton).toHaveAttribute("aria-pressed", "true");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What should I add after Shaka?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(
    page.getByText("Add Bravo after Shaka for an easy General Luna dinner."),
  ).toBeVisible();
  await expect.poll(() => chatRequests.length).toBe(1);
  expect(chatRequests[0]?.threadId).toBe("thread_existing");

  await page.reload();
  await page.getByRole("button", { name: /Cloud 9 plan/ }).click();
  await expect(
    page.getByText("Add Bravo after Shaka for an easy General Luna dinner."),
  ).toBeVisible();
  await expect(page.getByTestId("decision-strip")).toContainText(
    "Start with breakfast near Cloud 9.",
  );
  await expect.poll(async () => (await decisionMotionMetrics(page))?.starts ?? -1).toBe(0);
  await expect(
    page.getByRole("button", { name: "Rate assistant response helpful" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});

test("wraps long user text inside the composer and user message bubble", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockChatApi(page, {
    message: "Mocked answer after a long wrapped user prompt.",
  });

  await page.goto("/chat");

  const longPrompt =
    "I'm staying near Cloud 9 for 10 days and need quiet sleep, surfing, good restaurants, airport transfer timing, and a fallback plan for rainy afternoons. Also test a long token: quiet-sleep-surf-food-transfer-cloud9-general-luna-rainy-day-backup-plan.";
  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill(longPrompt);

  const composerBox = await composerInput.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox?.height ?? 0).toBeGreaterThan(44);
  await expect
    .poll(async () =>
      composerInput.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);

  await composerInput.press("Enter");

  const userBubble = page.getByTestId("user-message-bubble").last();
  await expect(userBubble).toBeVisible();
  await expect(page.getByText("Mocked answer after a long wrapped user prompt.")).toBeVisible();
  await expect
    .poll(async () =>
      userBubble.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

test("sends granted browser geolocation for a trip session", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 9.8116,
              longitude: 126.1651,
              accuracy: 25,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked near-me answer: I used the shared location for this request.",
  });

  await page.goto("/chat");

  await expect(page.getByText("Location off")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable location" })).toBeVisible();
  await page.getByRole("button", { name: "Enable location" }).click();
  await expect(page.getByText("Location active for this chat.")).toBeVisible();
  await expect(page.getByText("Location active", { exact: true })).toBeVisible();

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open near me?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked near-me answer:")).toBeVisible();
  await expect(page.getByText("Location active for this chat.")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(mockChat.requests[0]?.clientContext?.geolocation).toMatchObject({
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    consentScope: "trip_session",
  });
  expect(mockChat.requests[0]?.clientContext?.geolocation?.capturedAt).toEqual(expect.any(String));

  await composerInput.fill("What about tomorrow?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(2);
  expect(lastSubmittedContent(mockChat.requests[1])).toBe("What about tomorrow?");
  expect(mockChat.requests[1]?.clientContext?.geolocation).toMatchObject({
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    consentScope: "trip_session",
  });
  await expect(page.getByText("Location active for this chat.")).toBeVisible();
});

test("requests browser geolocation for a near-me prompt without the manual button", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 9.8116,
              longitude: 126.1651,
              accuracy: 25,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked automatic near-me answer: I used the shared location.",
  });

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open near me?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked automatic near-me answer:")).toBeVisible();
  await expect(page.getByText("Location used for the last question.")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(mockChat.requests[0]?.clientContext?.geolocation).toMatchObject({
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    consentScope: "single_request",
  });
});

test("cancels deferred automatic location before new chat and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const scope = window as typeof window & {
      __locationRequests?: number;
      __resolveLocation?: () => void;
    };
    scope.__locationRequests = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          scope.__locationRequests = (scope.__locationRequests ?? 0) + 1;
          scope.__resolveLocation = () => {
            success({
              coords: {
                latitude: 9.8116,
                longitude: 126.1651,
                accuracy: 25,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          };
        },
      },
    });
  });
  const chat = await mockDeferredChatApi(page);

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open near me?");
  await composerInput.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __locationRequests?: number }).__locationRequests ?? 0,
      ),
    )
    .toBe(1);
  await expect(page.getByText("Requesting location...")).toBeVisible();
  await expect.poll(() => chat.requests.length).toBe(0);

  await page.getByLabel("Start a new chat").first().click();
  await expect(composerInput).toBeEnabled();
  await expect(page.getByText("What is open near me?")).toHaveCount(0);

  await page.evaluate(() =>
    (window as typeof window & { __resolveLocation?: () => void }).__resolveLocation?.(),
  );
  await page.waitForTimeout(250);
  await expect.poll(() => chat.requests.length).toBe(0);

  await composerInput.fill("What is open near me after navigation?");
  await composerInput.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __locationRequests?: number }).__locationRequests ?? 0,
      ),
    )
    .toBe(2);
  await page.goto("/");
  await page.waitForTimeout(250);
  await expect.poll(() => chat.requests.length).toBe(0);
});

test("continues without geolocation after permission is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success: PositionCallback, error?: PositionErrorCallback) {
          error?.({
            code: 1,
            message: "User denied geolocation.",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked typed-area answer: General Luna options still work without location.",
  });

  await page.goto("/chat");

  await page.getByRole("button", { name: "Enable location" }).click();
  await expect(page.getByText("Location permission denied.")).toBeVisible();
  await expect(page.getByText("Location blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open in General Luna?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked typed-area answer:")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe("What is open in General Luna?");
  expect(mockChat.requests[0]?.clientContext).toBeUndefined();
});

test("continues without geolocation when automatic location permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success: PositionCallback, error?: PositionErrorCallback) {
          error?.({
            code: 1,
            message: "User denied geolocation.",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked no-location near-me answer: I continued without browser location.",
  });

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open near me?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Location permission denied.")).toBeVisible();
  await expect(page.getByText("Location blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("Mocked no-location near-me answer:")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe("What is open near me?");
  expect(mockChat.requests[0]?.clientContext).toBeUndefined();
});

test("sends a mobile suggested prompt through the same chat API path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 9.8116,
              longitude: 126.1651,
              accuracy: 25,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked mobile answer: keep the day slow around Cloud 9 and Catangnan.",
  });

  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Ask a real question/i })).toBeVisible();
  await expect(page.getByText("Cloud 9 area")).toHaveCount(0);
  await expect(page.getByText("24 live refreshes left")).toHaveCount(0);
  await expect(page.getByText(/Will my place be quiet/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Help me plan a quiet Siargao day" }).click();

  await expect(
    page.getByLabel("Conversation messages").getByText("Help me plan a quiet Siargao day"),
  ).toBeVisible();
  await expect(
    page.getByText("Mocked mobile answer: keep the day slow around Cloud 9 and Catangnan."),
  ).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe("Help me plan a quiet Siargao day");
  expect(mockChat.requests[0]?.clientContext?.geolocation).toMatchObject({
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    consentScope: "single_request",
  });
  await expect(page.getByLabel("Ask anything about Siargao")).toBeVisible();
});

test("renders structured recommendation cards and submits action prompts", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const actionPrompt = "Make Shaka Siargao into a short Siargao plan.";
  const mockChat = await mockChatApi(page, {
    message: "Mocked card answer: Shaka is a practical first stop.",
    cards: [
      {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka",
        distanceLabel: "About 50 m from search center.",
        openStatusLabel: "Open now according to Google Places.",
        fitReasons: ["Returned #1 by Google Places for this request."],
        caveats: ["Review text and bookings were not checked."],
        sourceLabel: "Google Places - live checked",
        decision: {
          label: "good_now",
          bestAction: "Go now if you want the closest checked cafe option.",
        },
        sources: [mockPlacesSource],
      },
    ],
    actions: [
      {
        id: "places_plan_place_shaka",
        label: "Make this into a short plan",
        prompt: actionPrompt,
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Find a cafe near Cloud 9");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked card answer:")).toBeVisible();
  const card = page.getByTestId("recommendation-card").filter({ hasText: "Shaka Siargao" });
  await expect(card).toBeVisible();
  await expect(page.getByTestId("recommendation-source-badge")).toHaveText("Source: Google Places");
  await expect(card.getByTestId("artifact-decision")).toContainText("Good now");
  await expect(card.getByTestId("artifact-decision")).toContainText(
    "Go now if you want the closest checked cafe option.",
  );
  await expect(card.getByText("50 m away")).toBeVisible();
  await expect(card.getByText("Open now")).toBeVisible();
  await expect(card.getByText("Returned #1 by Google Places for this request.")).toHaveCount(0);
  await expect(card.getByText("Review text and bookings were not checked.")).toHaveCount(0);

  const mapLink = page.getByRole("link", { name: "Open Shaka Siargao in Google Maps" });
  await expect(mapLink).toHaveAttribute("href", "https://maps.google.com/?cid=shaka");
  await expect(mapLink).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "Make this into a short plan" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(2);
  expect(lastSubmittedContent(mockChat.requests[1])).toBe(actionPrompt);
});

test("leads live grounded answers with one responsive decision strip", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDecisionMotionProbe(page);
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  const mockChat = await mockChatApi(page, {
    message: "Mocked condition answer: keep the swim flexible today.",
    sources: [mockWeatherSource],
    decisionSummaries: [
      {
        id: "condition_decision:swimming:cloud_9:today",
        bestAction:
          "Keep swimming flexible until the long Cloud 9 weather-and-surf decision can be confirmed locally.",
        basis: "Weather is usable, but surf reports are not checked.",
        fallback:
          "Use a nearby covered stop if conditions worsen during the afternoon rain window.",
        avoid: "Avoid treating this as beach safety clearance.",
        timing: "today",
        area: "Cloud 9",
        sources: [mockWeatherSource],
      },
      {
        id: "condition_decision:secondary",
        bestAction: "This secondary selected summary must stay out of a second top-level strip.",
        basis: "It is not the primary answer-level decision.",
        sources: [mockWeatherSource],
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Should I swim at Cloud 9 today?");
  await page.getByRole("button", { name: "Send question" }).click();

  const answer = page.getByTestId("assistant-message-bubble").filter({
    hasText: "Mocked condition answer: keep the swim flexible today.",
  });
  await expect(answer).toBeVisible();
  const strip = answer.getByTestId("decision-strip");
  const markdown = answer.getByTestId("assistant-markdown");
  await expect(strip).toHaveCount(1);
  await expect.poll(async () => (await decisionMotionMetrics(page))?.starts ?? -1).toBe(0);
  await expect(strip).not.toHaveAttribute("data-answer-arrival-motion", /decision-strip/);
  await expect(strip.locator("[data-decision-sequence-cue='true']")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(strip).toContainText("Best move");
  await expect(strip).toContainText("Keep swimming flexible until the long Cloud 9");
  await expect(strip).toContainText("Where");
  await expect(strip).toContainText("When");
  await expect(strip).toContainText("Backup:");
  await expect(strip).toContainText("Avoid:");
  await expect(strip.getByTestId("decision-strip-source-status")).toContainText(
    "Checked: Open-Meteo weather API: forecast for Cloud 9",
  );
  await expect(strip).not.toContainText("This secondary selected summary must stay out");
  await expect(page.getByText("At a Glance")).toHaveCount(0);
  expect(
    await strip.evaluate((element) => element.nextElementSibling?.getAttribute("data-testid")),
  ).toBe("assistant-markdown");
  expect(await answer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(strip.locator("a, button, input, select, textarea")).toHaveCount(0);
  await expect(markdown).toContainText("Mocked condition answer: keep the swim flexible today.");
  await page.setViewportSize({ width: 1180, height: 900 });
  expect(await answer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("Avoid a long scooter ride for now.")).toHaveCount(0);
  await expect.poll(() => mockChat.requests.length).toBe(1);
});

test("runs the decision strip arrival sequence once without shifting layout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installDecisionMotionProbe(page);
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  await page.route("**/api/chat/ratings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rating: {
          id: "rating_motion",
          messageId: "message_motion_assistant",
          threadId: "thread_motion",
          userId: "user_motion",
          rating: "up",
          reasonCodes: [],
          comment: null,
          createdAt: "2026-06-29T01:04:00.000Z",
          updatedAt: "2026-06-29T01:04:00.000Z",
        },
      }),
    });
  });
  const mockChat = await mockChatApi(page, {
    assistantMessageId: "message_motion_assistant",
    message: "Mocked condition answer: take the checked breakfast route first.",
    sources: [mockWeatherSource],
    waitForRelease: true,
    decisionSummaries: [
      {
        id: "condition_decision:motion:cloud_9:today",
        bestAction: "Start with the checked Cloud 9 breakfast stop.",
        basis: "The selected answer has a real sequence from move to context to checked source.",
        fallback: "Switch to a covered cafe if the shower window arrives early.",
        timing: "this morning",
        area: "Cloud 9",
        sources: [mockWeatherSource],
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("What should I do first?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  await resetDecisionMotionMetrics(page);

  await withCpuThrottle(page, 4, async () => {
    mockChat.release();

    const answer = page.getByTestId("assistant-message-bubble").filter({
      hasText: "Mocked condition answer: take the checked breakfast route first.",
    });
    await expect(answer).toBeVisible();
    const strip = answer.getByTestId("decision-strip");
    const sourceSummary = answer.getByTestId("assistant-sources-panel").locator("summary");
    const helpfulButton = answer.getByRole("button", {
      name: "Rate assistant response helpful",
    });
    await expect(strip).toHaveAttribute("data-answer-arrival-motion", "decision-strip-sequence");
    await expect(strip).toContainText("Best move");
    await expect(strip).toContainText("Where");
    await expect(strip).toContainText("When");
    await expect(strip.getByTestId("decision-strip-source-status")).toContainText(
      "Checked: Open-Meteo weather API: forecast for Cloud 9",
    );
    await expect(sourceSummary).toBeVisible();
    await expect(helpfulButton).toBeVisible();
    await sourceSummary.click();
    await expect(answer.getByText("Checked details: forecast for Cloud 9")).toBeVisible();

    const animatedProperties = await strip.evaluate((element) => {
      const cue = element.querySelector("[data-decision-sequence-cue='true']");
      return cue
        ?.getAnimations()
        .flatMap((animation) =>
          ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).flatMap((keyframe) =>
            Object.keys(keyframe),
          ),
        );
    });
    expect(animatedProperties).toEqual(expect.arrayContaining(["opacity", "transform"]));
    expect(animatedProperties ?? []).not.toEqual(
      expect.arrayContaining([
        "height",
        "width",
        "margin",
        "padding",
        "top",
        "left",
        "filter",
        "boxShadow",
      ]),
    );

    const startBoxes = {
      strip: await boundingBoxSnapshot(strip),
      source: await boundingBoxSnapshot(sourceSummary),
      rating: await boundingBoxSnapshot(helpfulButton),
    };
    await page.waitForTimeout(260);
    expectBoxStable(await boundingBoxSnapshot(strip), startBoxes.strip);
    expectBoxStable(await boundingBoxSnapshot(sourceSummary), startBoxes.source);
    expectBoxStable(await boundingBoxSnapshot(helpfulButton), startBoxes.rating);
    await page.waitForTimeout(420);
    expectBoxStable(await boundingBoxSnapshot(strip), startBoxes.strip);
    expectBoxStable(await boundingBoxSnapshot(sourceSummary), startBoxes.source);
    expectBoxStable(await boundingBoxSnapshot(helpfulButton), startBoxes.rating);
    await expect(strip).not.toHaveAttribute("data-answer-arrival-motion", /decision-strip/);

    const scrollArea = page.getByTestId("chat-message-scroll-area");
    await scrollArea.evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollTop - 40);
    });
    await sourceSummary.focus();
    await expect(sourceSummary).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await helpfulButton.click();
    await expect(helpfulButton).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(120);
  });

  const metrics = (await decisionMotionMetrics(page)) ?? {
    starts: -1,
    ends: -1,
    layoutShift: -1,
    longTasks: [-1],
    rafFrames: [],
  };
  const frameIntervals = metrics.rafFrames
    .slice(1)
    .map((timestamp, index) => timestamp - metrics.rafFrames[index]);
  const summary = {
    viewport: "390x844",
    cpuThrottle: "4x",
    animationDurationMs: 520,
    starts: metrics.starts,
    ends: metrics.ends,
    layoutShift: Number(metrics.layoutShift.toFixed(4)),
    longTaskCountOver50ms: metrics.longTasks.filter((duration) => duration > 50).length,
    maxLongTaskMs: Math.max(0, ...metrics.longTasks),
    sampledFrames: metrics.rafFrames.length,
    maxFrameIntervalMs: Math.max(0, ...frameIntervals),
  };
  console.log("ISSUE_124_MOTION_METRICS", JSON.stringify(summary));
  await testInfo.attach("issue-124-decision-motion-metrics.json", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
  expect(metrics.starts).toBe(1);
  expect(metrics.ends).toBe(1);
  expect(metrics.layoutShift).toBe(0);
  expect(metrics.longTasks.filter((duration) => duration > 50)).toHaveLength(0);
  expect(metrics.rafFrames.length).toBeGreaterThan(8);
});

test("keeps plain conversational answers free of overview containers", async ({ page }) => {
  await mockChatApi(page, { message: "A plain answer without structured decision metadata." });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Say hello");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(
    page.getByText("A plain answer without structured decision metadata."),
  ).toBeVisible();
  await expect(page.getByTestId("decision-strip")).toHaveCount(0);
  await expect(page.getByText("At a Glance")).toHaveCount(0);
});

test("renders itinerary plans with stops, fallbacks, skip guidance, sources, and map links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await mockChatApi(page, {
    message:
      "Here is a compact rainy Cloud 9 plan. Use the structured plan below for the sequence.",
    itineraries: [mockRainyCloud9Itinerary()],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Plan rainy Cloud 9 afternoon");
  await page.getByRole("button", { name: "Send question" }).click();

  const plan = page.getByTestId("itinerary-plan").filter({ hasText: "Rainy Cloud 9 Afternoon" });
  await expect(page.getByText("Here is a compact rainy Cloud 9 plan.")).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(plan.getByTestId("artifact-decision")).toContainText("Fallback");
  await expect(plan.getByTestId("artifact-decision")).toContainText(
    "Move indoors if rain gets heavier.",
  );
  await expect(plan.getByText("3-4 hours")).toBeVisible();
  const stops = plan.getByTestId("itinerary-stops");
  await expect(stops.getByRole("listitem").filter({ hasText: "Cloud 9 boardwalk" })).toBeVisible();
  await expect(
    stops.getByRole("listitem").filter({ hasText: "Covered cafe near Cloud 9" }),
  ).toBeVisible();
  await expect(plan.getByText("About 5 minutes from the previous stop.")).toBeVisible();
  await expect(plan.getByText("Keep the exposed stop short.")).toBeVisible();
  await expect(plan.getByText("Weather needs checking.")).toBeVisible();

  const mapLink = plan.getByRole("link", { name: "Open Covered cafe near Cloud 9 in Google Maps" });
  await expect(mapLink).toHaveAttribute("href", "https://maps.example/cloud9-cafe");
  await expect(mapLink).toHaveAttribute("target", "_blank");

  await expect(page.getByTestId("itinerary-fallbacks").getByText("Fallbacks")).toBeVisible();
  await expect(page.getByTestId("itinerary-fallbacks")).toContainText("Use during active rain");
  await expect(page.getByTestId("itinerary-skip")).toContainText("Exposed beach hopping");
  await expect(page.getByTestId("itinerary-sources")).toContainText("Local guide");
  await expect(page.getByTestId("itinerary-sources")).not.toContainText("Not checked");
});

test("saves local cards and itineraries with dedupe, removal, and reload persistence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  const prompt = "Save a Shaka stop and rainy Cloud 9 plan";
  const deletedItems: string[] = [];
  await page.route("**/api/trips/saved/*", async (route) => {
    deletedItems.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ removed: true }),
    });
  });
  await mockChatApi(page, {
    message: "Mocked saved-plan answer: save the useful pieces below.",
    sources: [mockPlacesSource],
    cards: [
      {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka",
        distanceLabel: "About 50 m from search center.",
        openStatusLabel: "Open now according to Google Places.",
        fitReasons: ["Returned #1 by Google Places for this request."],
        caveats: ["Review text and bookings were not checked."],
        sourceLabel: "Google Places - live checked",
        decision: {
          label: "good_now",
          bestAction: "Go now if you want the closest checked cafe option.",
        },
        sources: [mockPlacesSource],
      },
    ],
    itineraries: [mockRainyCloud9Itinerary()],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill(prompt);
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked saved-plan answer:")).toBeVisible();
  await page.getByRole("button", { name: "Save Shaka Siargao" }).click();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("1 item saved locally");
  await expect(
    page.getByTestId("saved-plan-item").filter({ hasText: "Shaka Siargao" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Save Rainy Cloud 9 Afternoon" }).click();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("2 items saved locally");
  await expect(
    page.getByTestId("saved-plan-item").filter({ hasText: "Rainy Cloud 9 Afternoon" }),
  ).toHaveCount(1);

  const savedState = await readSavedTripStorage(page);
  expect(savedState.items.map((item) => item.kind).sort()).toEqual(["itinerary", "place"]);
  const savedCard = savedState.items.find((item) => item.kind === "place");
  expect(savedCard?.sources?.[0]).toMatchObject({
    sourceName: "Google Places API",
    checked: ["place identity", "current opening status"],
    notChecked: ["review text", "table availability"],
  });
  expect(
    savedCard?.payload.type === "recommendation_card" ? savedCard.payload.card.decision : undefined,
  ).toEqual({
    label: "good_now",
    bestAction: "Go now if you want the closest checked cafe option.",
  });
  const savedItinerary = savedState.items.find((item) => item.kind === "itinerary");
  expect(
    savedItinerary?.payload.type === "itinerary_plan"
      ? savedItinerary.payload.plan.decision
      : undefined,
  ).toEqual({
    label: "fallback",
    bestAction: "Move indoors if rain gets heavier.",
  });
  const savedJson = JSON.stringify(savedState);
  expect(savedJson).not.toContain(prompt);
  expect(savedJson).not.toContain("messages");
  expect(savedJson).not.toContain("clientContext");
  expect(savedJson).not.toContain("latitude");
  expect(savedJson).not.toContain("longitude");

  await page.evaluate((storageKey) => {
    const storedValue = localStorage.getItem(storageKey);
    if (!storedValue) {
      throw new Error("Saved trip storage missing.");
    }
    const state = JSON.parse(storedValue) as SavedTripStorageState;
    state.items.push({ ...state.items[0], updatedAt: new Date().toISOString() });
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, savedTripStorageKey);

  await page.reload();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("2 items saved locally");
  await expect(page.getByTestId("saved-plan-item")).toHaveCount(2);

  await page
    .getByTestId("saved-plan-tray")
    .getByRole("button", { name: "Remove Shaka Siargao from saved plan" })
    .click();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("1 item saved locally");
  await expect(
    page.getByTestId("saved-plan-item").filter({ hasText: "Shaka Siargao" }),
  ).toHaveCount(0);
  expect((await readSavedTripStorage(page)).items).toHaveLength(1);
  expect(deletedItems.some((url) => url.endsWith("/api/trips/saved/place%3Aplace_shaka"))).toBe(
    true,
  );
});

test("hydrates signed-in saved trips from the owned server list", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const serverTripId = "saved_trip_authenticated";
  const serverItem: E2ESavedTripItem = {
    id: "place_shaka",
    tripId: serverTripId,
    kind: "place",
    title: "Shaka Siargao",
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z",
    payload: {
      type: "recommendation_card",
      card: {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka",
        fitReasons: ["Saved from a signed-in session."],
        caveats: ["Opening hours can change."],
        sourceLabel: "Google Places - live checked",
      },
    },
    sources: [mockPlacesSource],
    mapsUrl: "https://maps.google.com/?cid=shaka",
    caveats: ["Opening hours can change."],
  };

  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripContext: {} }),
    });
  });

  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tripId: serverTripId,
        items: [serverItem],
      }),
    });
  });

  await page.goto("/chat");

  await expect(page.getByTestId("saved-plan-tray")).toContainText("1 item saved locally");
  await expect(page.getByTestId("saved-plan-item")).toContainText("Shaka Siargao");
  const savedState = await readSavedTripStorage(page);
  expect(savedState.tripId).toBe(serverTripId);
  expect(savedState.items.map((item) => item.id)).toEqual(["place_shaka"]);
});

test("creates and copies or opens a share link from saved cards and itineraries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          (window as Window & { __copiedShareText?: string }).__copiedShareText = value;
        },
      },
    });
  });

  const prompt = "Save and share Shaka with a rainy Cloud 9 plan";
  const savedRequests: SavedTripItemsRequestBody[] = [];
  const shareRequests: SharedTripCreateRequestBody[] = [];
  const shareUrl = new URL("/trips/shared/token_playwright", "http://127.0.0.1:3100").toString();

  await page.route("**/api/trips/saved", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_saved_trip_request" }),
      });
      return;
    }

    const body = route.request().postDataJSON() as SavedTripItemsRequestBody;
    savedRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tripId: body.tripId,
        items: body.items ?? [],
      }),
    });
  });
  await page.route("**/api/trips/share", async (route) => {
    shareRequests.push(route.request().postDataJSON() as SharedTripCreateRequestBody);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "token_playwright",
        shareUrl,
        plan: {
          id: "shared_trip_playwright",
          title: "Siargao saved plan - 2 items",
          createdAt: "2026-06-28T01:00:00.000Z",
          items: savedRequests.at(-1)?.items ?? [],
        },
      }),
    });
  });
  await page.context().route("**/trips/shared/token_playwright", async (route) => {
    const publicPlan = publicSharedTripPlanForE2E({
      id: "shared_trip_playwright",
      title: "Siargao saved plan - 2 items",
      createdAt: "2026-06-28T01:00:00.000Z",
      items: savedRequests.at(-1)?.items ?? [],
    });

    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: renderSharedTripPlanDocument(publicPlan),
    });
  });
  await mockChatApi(page, {
    message: "Mocked saved-plan answer: save the useful pieces below.",
    sources: [mockPlacesSource],
    cards: [
      {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka",
        distanceLabel: "About 50 m from search center.",
        openStatusLabel: "Open now according to Google Places.",
        fitReasons: ["Returned #1 by Google Places for this request."],
        caveats: ["Review text and bookings were not checked."],
        sourceLabel: "Google Places - live checked",
        decision: {
          label: "good_now",
          bestAction: "Go now if you want the closest checked cafe option.",
        },
        sources: [mockPlacesSource],
      },
    ],
    itineraries: [mockRainyCloud9Itinerary()],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill(prompt);
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked saved-plan answer:")).toBeVisible();
  await page.getByRole("button", { name: "Save Shaka Siargao" }).click();
  await page.getByRole("button", { name: "Save Rainy Cloud 9 Afternoon" }).click();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("2 selected to share");

  await page.getByRole("button", { name: /^Share$/ }).click();

  await expect(page.getByTestId("saved-plan-share-link")).toBeVisible();
  await expect(page.getByLabel("Share link")).toHaveValue(shareUrl);
  await expect.poll(() => savedRequests.length).toBe(1);
  await expect.poll(() => shareRequests.length).toBe(1);

  expect(savedRequests[0]?.items?.map((item) => item.kind).sort()).toEqual(["itinerary", "place"]);
  const savedPlaceRequest = savedRequests[0]?.items?.find((item) => item.kind === "place");
  expect(savedPlaceRequest?.sources?.[0]).toMatchObject({
    sourceName: "Google Places API",
    checked: ["place identity", "current opening status"],
    notChecked: ["review text", "table availability"],
  });
  expect(
    savedPlaceRequest?.payload.type === "recommendation_card"
      ? savedPlaceRequest.payload.card.decision
      : undefined,
  ).toEqual({
    label: "good_now",
    bestAction: "Go now if you want the closest checked cafe option.",
  });
  const savedItineraryRequest = savedRequests[0]?.items?.find((item) => item.kind === "itinerary");
  expect(
    savedItineraryRequest?.payload.type === "itinerary_plan"
      ? savedItineraryRequest.payload.plan.decision
      : undefined,
  ).toEqual({
    label: "fallback",
    bestAction: "Move indoors if rain gets heavier.",
  });
  expect(savedRequests[0]?.messages).toBeUndefined();
  expect(savedRequests[0]?.clientContext).toBeUndefined();
  expect(JSON.stringify(savedRequests[0])).not.toContain(prompt);
  expect(JSON.stringify(savedRequests[0])).not.toContain("latitude");
  expect(JSON.stringify(savedRequests[0])).not.toContain("longitude");

  expect(shareRequests[0]?.itemIds).toHaveLength(2);
  expect(shareRequests[0]?.messages).toBeUndefined();
  expect(shareRequests[0]?.clientContext).toBeUndefined();

  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __copiedShareText?: string }).__copiedShareText,
    ),
  ).toBe(shareUrl);

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("saved-plan-share-link").getByRole("link", { name: "Open" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(shareUrl);
  await expect(popup.getByRole("heading", { name: "Siargao saved plan - 2 items" })).toBeVisible();
  await expect(popup.getByText("Open now according to Google Places.")).toBeVisible();
  await expect(popup.getByText("Good now")).toBeVisible();
  await expect(
    popup.getByText("Go now if you want the closest checked cafe option."),
  ).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Fallback" })).toBeVisible();
  await expect(popup.getByText("Move indoors if rain gets heavier.")).toBeVisible();
  await expect(popup.getByText("Google Places - live checked")).toBeVisible();
  await expect(
    popup.getByText("Google Places API - live checked - fetched 2026-06-28T00:45:00.000Z"),
  ).toBeVisible();
  await expect(
    popup.getByText("Checked by Google Places API: current opening status"),
  ).toBeVisible();
  await expect(
    popup.getByText("Not checked by Google Places API: table availability"),
  ).toBeVisible();
  await expect(popup.getByText("Ask Siargao local guide - curated local guide")).toBeVisible();
  await expect(
    popup.getByText("Checked by Ask Siargao local guide: rainy-day Cloud 9 fallback pattern"),
  ).toBeVisible();
  await expect(
    popup.getByText(
      "Not checked by Browser saved trip: Saved from browser and not reverified by Ask Siargao before sharing.",
    ),
  ).toHaveCount(2);
  await expect(popup.getByText(prompt)).toHaveCount(0);
  await popup.close();
});

test("renders generic public shared-plan unavailable state in the browser", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.route("**/trips/shared/expired_playwright", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: renderSharedTripPlanDocument(null),
    });
  });

  await page.goto("/trips/shared/expired_playwright");

  await expect(page.getByRole("heading", { name: "Shared plan unavailable" })).toBeVisible();
  await expect(page.getByText("Ask the traveler for a fresh link.")).toBeVisible();
  await expect(page.getByText("expired")).toHaveCount(0);
  await expect(page.getByText("deleted")).toHaveCount(0);
  await expect(page.getByText("not found")).toHaveCount(0);
});

test("prevents empty share selections and keeps local saves after share API failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    });
  });
  let savedSyncRequests = 0;
  await page.route("**/api/trips/saved", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_saved_trip_request" }),
      });
      return;
    }

    savedSyncRequests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "share_sync_unavailable" }),
    });
  });
  await mockChatApi(page, {
    message: "Mocked saved-plan answer: save one useful piece below.",
    cards: [
      {
        id: "place_shaka",
        kind: "place",
        title: "Shaka Siargao",
        subtitle: "Cafe - Cloud 9, General Luna",
        mapsUrl: "https://maps.google.com/?cid=shaka",
        distanceLabel: "About 50 m from search center.",
        openStatusLabel: "Open now according to Google Places.",
        fitReasons: ["Returned #1 by Google Places for this request."],
        caveats: ["Review text and bookings were not checked."],
        sourceLabel: "Google Places - live checked",
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Save Shaka for later");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked saved-plan answer:")).toBeVisible();
  await page.getByRole("button", { name: "Save Shaka Siargao" }).click();
  await expect(page.getByTestId("saved-plan-tray")).toContainText("1 selected to share");

  await page.getByLabel("Include Shaka Siargao in shared plan").uncheck();
  await expect(page.getByTestId("saved-plan-share-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Share$/ })).toBeDisabled();
  expect(savedSyncRequests).toBe(0);

  await page.getByLabel("Include Shaka Siargao in shared plan").check();
  await page.getByRole("button", { name: /^Share$/ }).click();

  await expect(page.getByTestId("saved-plan-share-error")).toContainText(
    "Share link could not be created",
  );
  await expect(
    page.getByTestId("saved-plan-item").filter({ hasText: "Shaka Siargao" }),
  ).toHaveCount(1);
  expect((await readSavedTripStorage(page)).items).toHaveLength(1);
  expect(savedSyncRequests).toBe(1);
});

test("renders initial itinerary theme fixtures without generic brainstorm fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockChatApi(page, {
    message: "Mocked itinerary theme coverage: sunset, sandy beach, and food crawl plans.",
    itineraries: [mockSunsetDinnerItinerary(), mockSandyBeachItinerary(), mockFoodCrawlItinerary()],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Show itinerary theme coverage");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked itinerary theme coverage:")).toBeVisible();
  await expect(page.getByTestId("itinerary-plan")).toHaveCount(3);

  const sunsetPlan = page.getByTestId("itinerary-plan").filter({ hasText: "Sunset plus Dinner" });
  await expect(sunsetPlan).toContainText("Cloud 9 sunset stop");
  await expect(sunsetPlan).toContainText("Dinner in General Luna");
  await expect(sunsetPlan).toContainText("About 10 minutes from the previous stop.");
  await expect(
    sunsetPlan.getByRole("link", { name: "Open Dinner in General Luna in Google Maps" }),
  ).toHaveAttribute("href", "https://maps.example/general-luna-dinner");
  await expect(sunsetPlan.getByTestId("itinerary-skip")).toContainText(
    "Far north dinner detours after sunset",
  );

  const sandyPlan = page.getByTestId("itinerary-plan").filter({ hasText: "Sandy Beach Half-Day" });
  await expect(sandyPlan).toContainText("Doot Beach");
  await expect(sandyPlan).toContainText("Malinao Beach");
  await expect(sandyPlan.getByTestId("itinerary-skip")).toContainText("Surf-only Cloud 9 sessions");
  await expect(sandyPlan).not.toContainText("Surf lesson");

  const foodPlan = page
    .getByTestId("itinerary-plan")
    .filter({ hasText: "General Luna Food Crawl" });
  await expect(foodPlan).toContainText("First food stop");
  await expect(foodPlan).toContainText("Second food stop");
  await expect(sunsetPlan.getByTestId("itinerary-sources")).toContainText("Local guide");
});

test("keeps recommendation cards inside the mobile chat column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockChatApi(page, {
    message: "Mocked mobile card answer: this card should stay inside the assistant bubble.",
    cards: [
      {
        id: "place_long_mobile",
        kind: "place",
        title: "A very long Siargao recommendation title near Cloud 9 and General Luna",
        subtitle:
          "Cafe - Tourism Road, General Luna - Google rating 4.8 from 1234 ratings - returned by live lookup",
        mapsUrl:
          "https://maps.google.com/?cid=1842727875883507531&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMuTW9iaWxlLWNhcmQtbG9uZy11cmwtdGVzdA",
        distanceLabel: "About 1.7 km from search center.",
        openStatusLabel: "Hours not returned by Google Places.",
        fitReasons: [
          "Returned #1 by Google Places for a deliberately long mobile layout request.",
          "Google Places primary type: cafe.",
        ],
        caveats: [
          "Review text, bookings, table availability, room availability, and independent local quality checks were not checked.",
        ],
        sourceLabel: "Google Places - live checked",
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Send a mobile card");
  await page.getByRole("button", { name: "Send question" }).click();

  const assistantBubble = page.getByTestId("assistant-message-bubble").last();
  const card = page.getByTestId("recommendation-card").last();
  await expect(card).toBeVisible();
  await expect(page.getByRole("link", { name: /Open .* in Google Maps/ })).toBeVisible();

  await expect
    .poll(async () =>
      assistantBubble.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
  await expect
    .poll(async () => card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

test("keeps itinerary plans inside the mobile chat column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockChatApi(page, {
    message: "Mocked mobile itinerary answer: this plan should stay inside the assistant bubble.",
    itineraries: [
      {
        ...mockRainyCloud9Itinerary(),
        title:
          "Very long rainy Cloud 9 afternoon itinerary title with cafe fallback and boardwalk timing",
        stops: [
          {
            ...mockRainyCloud9Itinerary().stops[0],
            title:
              "Cloud 9 boardwalk during a very specific short low-rain visibility window near Catangnan",
            rationale:
              "Use this only as a short scenic stop before moving under cover if the rain comes back.",
          },
          {
            ...mockRainyCloud9Itinerary().stops[1],
            mapsUrl:
              "https://maps.google.com/?cid=1842727875883507531&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMuTW9iaWxlLWl0aW5lcmFyeS1sb25nLXVybC10ZXN0LXdpdGgtbG90cy1vZi1jaGFyYWN0ZXJz",
          },
        ],
        skip: [
          "A very long exposed beach hopping segment across multiple stops when rain, road spray, and uncertain tricycle availability would make the route uncomfortable.",
        ],
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Send a mobile itinerary");
  await page.getByRole("button", { name: "Send question" }).click();

  const assistantBubble = page.getByTestId("assistant-message-bubble").last();
  const plan = page.getByTestId("itinerary-plan").last();
  await expect(plan).toBeVisible();
  await expect(page.getByRole("link", { name: /Open Covered cafe near Cloud 9/ })).toBeVisible();

  await expect
    .poll(async () =>
      assistantBubble.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
  await expect
    .poll(async () => plan.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

test("renders numbered assistant plans from display-ready source footers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockChatApi(page, {
    message: [
      "It looks stormy near Cloud 9 today: thunderstorm, 75% precipitation chance. Keep it close.",
      "",
      "1. Start with a covered cafe near Catangnan.",
      "2. Use the heaviest rain window for massage or errands.",
      "3. Walk the Cloud 9 boardwalk only during a clear break.",
      "",
      "Checked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - forecast for Cloud 9. Weather signal: Thunderstorm; rain 0.7mm.",
    ].join("\n"),
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("What should I do near Cloud 9 today?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("It looks stormy near Cloud 9 today")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Start with a covered cafe near Catangnan." }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Use the heaviest rain window" }),
  ).toBeVisible();
  const sourceLines = page.getByTestId("assistant-source-line");
  await expect(
    sourceLines.filter({
      hasText:
        "Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - forecast for Cloud 9.",
    }),
  ).toHaveCount(1);
  await expect(sourceLines.filter({ hasText: "Thunderstorm; rain 0.7mm." })).toHaveCount(1);
  await expect(
    sourceLines.filter({
      hasText:
        "Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - Google Places open-now results and road flooding.",
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("itinerary-plans")).toHaveCount(0);

  const orderedListCount = await page
    .getByTestId("assistant-message-bubble")
    .last()
    .locator("ol")
    .count();
  expect(orderedListCount).toBe(1);
  await expect(sourceLines).toHaveCount(2);
});

test("wraps long assistant links without rendering preview cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const kermitMapsLink =
    "https://maps.google.com/?cid=1842727875883507531&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMuMjEuUGxhY2VzLk1hcHMtbG9uZy1wcmV2aWV3LXRlc3QtdXJsLXdpdGgtbG90cy1vZi1jaGFyYWN0ZXJz";
  const shakaMapsLink =
    "https://maps.google.com/?cid=9519252965585253672&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMuMjEuU2Vjb25kLWxvbmctcHJldmlldy10ZXN0LXVybC13aXRoLWxvdHMtb2YtY2hhcmFjdGVycw";
  await mockChatApi(page, {
    message: `Here are two map links: ${kermitMapsLink} and ${shakaMapsLink}`,
  });

  await page.goto("/chat");
  await page.getByLabel("Ask anything about Siargao").fill("Send a map link");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByRole("link", { name: "Open Google Maps link" })).toHaveCount(2);
  await expect(page.getByTestId("assistant-link-preview")).toHaveCount(0);

  await expect
    .poll(async () =>
      page
        .getByTestId("assistant-message-bubble")
        .last()
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
});

test("prefills a prompt deep link without auto-submitting", async ({ page }) => {
  const prompt = "What should I do near Cloud 9?";
  const mockChat = await mockChatApi(page, {
    message: "Mocked deep-link answer: start near the boardwalk, then pick a quiet cafe.",
  });
  let promptDocumentRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.resourceType() === "document" &&
      url.pathname === "/chat" &&
      url.searchParams.has("prompt")
    ) {
      promptDocumentRequests += 1;
    }
  });

  await page.goto(`/chat?prompt=${encodeURIComponent(prompt)}`);

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await expect(composerInput).toHaveValue(prompt);
  await expect.poll(() => mockChat.requests.length).toBe(0);
  await expect(page).toHaveURL(`/chat?prompt=${encodeURIComponent(prompt)}`);
  expect(promptDocumentRequests).toBe(1);

  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText(prompt)).toBeVisible();
  await expect(
    page.getByText("Mocked deep-link answer: start near the boardwalk, then pick a quiet cafe."),
  ).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe(prompt);

  await page.goto(`/chat?prompt=${encodeURIComponent(prompt)}`);

  await expect(composerInput).toHaveValue(prompt);
  await expect
    .poll(async () => {
      await page.waitForTimeout(100);
      return mockChat.requests.length;
    })
    .toBe(1);
  expect(promptDocumentRequests).toBe(2);
});

test("truncates long prior assistant messages before follow-up requests", async ({ page }) => {
  const requests: ChatRequestBody[] = [];
  let requestCount = 0;

  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON() as ChatRequestBody);
    requestCount += 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          requestCount === 1
            ? `Long first answer: ${"quiet sleep, surf access, restaurants, transfer. ".repeat(70)}`
            : "Mocked follow-up answer: choose General Luna for the widest dinner options.",
        model: "gpt-5.4-mini-test",
        requestId: "req_playwright_chat_long_history",
      }),
    });
  });

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill(
    "I'm staying near Cloud 9 for 10 days. We want quiet sleep, surfing, good restaurants, and easy airport transfer.",
  );
  await composerInput.press("Enter");

  await expect(page.getByText("Long first answer:")).toBeVisible();

  await composerInput.fill("Where should I eat in General Luna tonight?");
  await composerInput.press("Enter");

  await expect(
    page.getByText("Mocked follow-up answer: choose General Luna for the widest dinner options."),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);

  const followUpMessages = requests[1]?.messages ?? [];
  expect(lastSubmittedContent(requests[1])).toBe("Where should I eat in General Luna tonight?");
  expect(followUpMessages.every((message) => (message.content?.length ?? 0) <= 2_000)).toBe(true);
});

test("shows safe error copy and lets the user keep asking after a failed request", async ({
  page,
}) => {
  const requests: ChatRequestBody[] = [];
  let requestCount = 0;

  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON() as ChatRequestBody);
    requestCount += 1;

    if (requestCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "chat_not_configured",
          message: "OPENAI_API_KEY is required for Ask Siargao chat.",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Mocked follow-up answer: yes, keep the backup plan simple.",
        model: "gpt-5.4-mini-test",
        requestId: "req_playwright_chat_retry",
      }),
    });
  });

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("Will the power be reliable?");
  await composerInput.press("Enter");

  await expect(page.getByText("Will the power be reliable?")).toBeVisible();
  await expect(
    page.getByText("Ask Siargao could not answer right now. Please try again."),
  ).toBeVisible();
  await expect(page.getByTestId("decision-strip")).toHaveCount(0);
  await expect(page.getByText("At a Glance")).toHaveCount(0);
  await expect(page.getByText("OPENAI_API_KEY")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry last question" })).toBeVisible();
  await expect(composerInput).toBeEnabled();

  await composerInput.fill("Can I ask a follow-up?");
  await composerInput.press("Enter");

  await expect(page.getByText("Can I ask a follow-up?")).toBeVisible();
  await expect(
    page.getByText("Mocked follow-up answer: yes, keep the backup plan simple."),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(lastSubmittedContent(requests[0])).toBe("Will the power be reliable?");
  expect(lastSubmittedContent(requests[1])).toBe("Can I ask a follow-up?");
});

test("keeps the delayed assistant wait state stable, accessible, and indeterminate", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const chat = await mockDeferredChatApi(page);

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is a good rainy afternoon plan?");
  await composerInput.press("Enter");

  await expect.poll(() => chat.requests.length).toBe(1);
  const waitState = page.getByTestId("assistant-wait-state");
  const waitStatus = page.getByTestId("assistant-wait-status");
  await expect(waitState).toBeVisible();
  await expect(waitState).toHaveAttribute("aria-busy", "true");
  await expect(waitStatus).toHaveText("Ask Siargao is preparing your answer.");
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(waitState).not.toContainText(/\b\d{1,3}%\b|countdown|elapsed|stage|tool|provider/i);
  await expect(page.getByText("Thinking through that with Ask Siargao...")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeEnabled();

  await waitStatus.evaluate((element) => {
    const trackedWindow = window as typeof window & { __waitStatusMutationCount?: number };
    trackedWindow.__waitStatusMutationCount = 0;
    new MutationObserver(() => {
      trackedWindow.__waitStatusMutationCount = (trackedWindow.__waitStatusMutationCount ?? 0) + 1;
    }).observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
  const waitGeometry = await waitState.boundingBox();

  await page.waitForTimeout(1_450);

  await expect(waitStatus).toHaveText("Ask Siargao is preparing your answer.");
  await expect(page.getByRole("status")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __waitStatusMutationCount?: number })
          .__waitStatusMutationCount ?? 0,
    ),
  ).toBe(0);
  expect(
    await waitState.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  expect(await waitState.boundingBox()).toMatchObject({
    height: waitGeometry?.height,
    width: waitGeometry?.width,
  });

  chat.release(0, {
    message: "Rainy afternoon answer: pick a covered cafe and keep travel short.",
  });

  await expect(
    page.getByText("Rainy afternoon answer: pick a covered cafe and keep travel short."),
  ).toBeVisible();
  await expect(waitState).toHaveCount(0);
});

test("stops local waiting, ignores the late response, and retries the original question", async ({
  page,
}) => {
  const chat = await mockDeferredChatApi(page);

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("Can we surf if the wind picks up?");
  await composerInput.press("Enter");

  await expect.poll(() => chat.requests.length).toBe(1);
  await page.getByRole("button", { name: "Stop waiting" }).click();

  await expect(page.getByTestId("assistant-wait-state")).toHaveCount(0);
  await expect(page.getByText("Stopped waiting here. You can retry that question.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry question" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry last question" })).toHaveCount(0);
  await expect(composerInput).toBeEnabled();

  await page.getByRole("button", { name: "Retry question" }).click();
  await expect.poll(() => chat.requests.length).toBe(2);
  expect(lastSubmittedContent(chat.requests[0])).toBe("Can we surf if the wind picks up?");
  expect(lastSubmittedContent(chat.requests[1])).toBe("Can we surf if the wind picks up?");

  chat.release(0, { message: "Late stopped answer should not render." });
  await page.waitForTimeout(250);
  await expect(page.getByText("Late stopped answer should not render.")).toHaveCount(0);
  await expect(page.getByTestId("assistant-wait-state")).toBeVisible();

  chat.release(1, { message: "Fresh retry answer: check the wind window before paddling out." });

  await expect(
    page.getByText("Fresh retry answer: check the wind window before paddling out."),
  ).toBeVisible();
  await expect(page.getByTestId("assistant-wait-state")).toHaveCount(0);
});

test("cleans up pending wait state when previous-thread loading fails", async ({ page }) => {
  const chat = await mockDeferredChatApi(page);
  const thread = {
    id: "thread_detail_failure",
    title: "Cloud 9 detail failure",
    status: "active",
    createdAt: "2026-06-29T01:00:00.000Z",
    updatedAt: "2026-06-29T01:00:00.000Z",
    lastMessageAt: "2026-06-29T01:01:00.000Z",
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripContext: { accommodation: "Cloud 9 stay" } }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripId: "trip_thread_failure", items: [] }),
    });
  });
  await page.route("**/api/chat/threads**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET" && url.pathname === "/api/chat/threads") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ threads: [thread] }),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/api/chat/threads/thread_detail_failure") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "thread_unavailable" }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  await page.goto("/chat");

  const previousThread = page.getByRole("button", { name: /Cloud 9 detail failure/ });
  await expect(previousThread).toBeVisible();

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("Should we keep a rainy-day backup?");
  await composerInput.press("Enter");
  await expect.poll(() => chat.requests.length).toBe(1);
  await expect(page.getByTestId("assistant-wait-state")).toBeVisible();

  await previousThread.click();

  await expect(page.getByText("Chat history unavailable")).toBeVisible();
  await expect(page.getByTestId("assistant-wait-state")).toHaveCount(0);
  await expect(page.getByText("Stopped waiting here. You can retry that question.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry question" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toHaveCount(0);
  await expect(composerInput).toBeEnabled();

  chat.release(0, { message: "Late thread-switch answer should not render." });
  await page.waitForTimeout(250);
  await expect(page.getByText("Late thread-switch answer should not render.")).toHaveCount(0);

  await page.getByRole("button", { name: "Retry question" }).click();
  await expect.poll(() => chat.requests.length).toBe(2);
  expect(lastSubmittedContent(chat.requests[1])).toBe("Should we keep a rainy-day backup?");

  chat.release(1, { message: "Fresh thread-failure retry answer." });
  await expect(page.getByText("Fresh thread-failure retry answer.")).toBeVisible();
});

test("ignores late thread detail success and failure after a newer selection", async ({ page }) => {
  const threadA = {
    id: "thread_race_a",
    title: "Cloud 9 older plan",
    status: "active",
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z",
    lastMessageAt: "2026-06-28T01:01:00.000Z",
  };
  const threadB = {
    id: "thread_race_b",
    title: "Dapa newer plan",
    status: "active",
    createdAt: "2026-06-29T01:00:00.000Z",
    updatedAt: "2026-06-29T01:00:00.000Z",
    lastMessageAt: "2026-06-29T01:01:00.000Z",
  };
  const threadC = {
    id: "thread_race_c",
    title: "Pacifico fallback plan",
    status: "active",
    createdAt: "2026-06-30T01:00:00.000Z",
    updatedAt: "2026-06-30T01:00:00.000Z",
    lastMessageAt: "2026-06-30T01:01:00.000Z",
  };
  const pendingDetails = new Map<
    string,
    (reply: { body: Record<string, unknown>; status: number }) => void
  >();
  const detailRequests: string[] = [];

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripContext: { accommodation: "Cloud 9 stay" } }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tripId: "trip_thread_race", items: [] }),
    });
  });
  await page.route("**/api/chat/threads**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/chat/threads") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ threads: [threadA, threadB, threadC] }),
      });
      return;
    }

    const threadId = url.pathname.split("/").at(-1);
    if (!threadId) {
      await route.fulfill({ status: 404, body: "not found" });
      return;
    }
    detailRequests.push(threadId);
    const reply = await new Promise<{ body: Record<string, unknown>; status: number }>(
      (resolve) => {
        pendingDetails.set(threadId, resolve);
      },
    );
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await page.goto("/chat");
  const threadAButton = page.getByRole("button", { name: /Cloud 9 older plan/ });
  const threadBButton = page.getByRole("button", { name: /Dapa newer plan/ });
  await expect(threadAButton).toBeVisible();
  await threadAButton.click();
  await expect.poll(() => detailRequests).toContain("thread_race_a");

  await threadBButton.click();
  await expect.poll(() => detailRequests).toContain("thread_race_b");
  pendingDetails.get("thread_race_b")?.({
    status: 200,
    body: {
      thread: threadB,
      messages: [
        {
          id: "message_race_b",
          role: "assistant",
          content: "Dapa loaded before the older thread settled.",
          status: "complete",
          createdAt: "2026-06-29T01:01:00.000Z",
        },
      ],
    },
  });
  await expect(page.getByText("Dapa loaded before the older thread settled.")).toBeVisible();

  pendingDetails.get("thread_race_a")?.({
    status: 200,
    body: {
      thread: threadA,
      messages: [
        {
          id: "message_race_a_late",
          role: "assistant",
          content: "Cloud 9 arrived from a late stale response.",
          status: "complete",
          createdAt: "2026-06-28T01:01:00.000Z",
        },
      ],
    },
  });
  await page.waitForTimeout(250);
  await expect(page.getByText("Chat history unavailable")).toHaveCount(0);
  await expect(page.getByText("Dapa loaded before the older thread settled.")).toBeVisible();
  await expect(page.getByText("Cloud 9 arrived from a late stale response.")).toHaveCount(0);

  const threadCButton = page.getByRole("button", { name: /Pacifico fallback plan/ });
  await threadCButton.click();
  await expect.poll(() => detailRequests).toContain("thread_race_c");
  await threadBButton.click();
  await expect
    .poll(() => detailRequests.filter((threadId) => threadId === "thread_race_b").length)
    .toBe(2);
  pendingDetails.get("thread_race_b")?.({
    status: 200,
    body: {
      thread: threadB,
      messages: [
        {
          id: "message_race_b_latest",
          role: "assistant",
          content: "Dapa remained selected after the fallback race.",
          status: "complete",
          createdAt: "2026-06-29T01:02:00.000Z",
        },
      ],
    },
  });
  await expect(page.getByText("Dapa remained selected after the fallback race.")).toBeVisible();
  pendingDetails.get("thread_race_c")?.({
    status: 503,
    body: { error: "fallback_thread_unavailable" },
  });
  await page.waitForTimeout(250);
  await expect(page.getByText("Chat history unavailable")).toHaveCount(0);
  await expect(page.getByText("Dapa remained selected after the fallback race.")).toBeVisible();
});

test("renders one failure retry path without stop controls or leaked server details", async ({
  page,
}) => {
  const chat = await mockDeferredChatApi(page);

  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("Will the ferry run tomorrow?");
  await composerInput.press("Enter");
  await expect.poll(() => chat.requests.length).toBe(1);

  chat.release(0, {
    body: { error: "upstream_timeout", message: "Internal provider timeout" },
    status: 503,
  });

  await expect(
    page.getByText("Ask Siargao could not answer right now. Please try again."),
  ).toBeVisible();
  await expect(page.getByText("Internal provider timeout")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry last question" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop waiting" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry question" })).toHaveCount(0);
  await expect(composerInput).toBeEnabled();

  await page.getByRole("button", { name: "Retry last question" }).click();
  await expect.poll(() => chat.requests.length).toBe(2);
  expect(lastSubmittedContent(chat.requests[1])).toBe("Will the ferry run tomorrow?");

  chat.release(1, { message: "Ferry retry answer: check the port notice before leaving." });

  await expect(
    page.getByText("Ferry retry answer: check the port notice before leaving."),
  ).toBeVisible();
  await expect(
    page.getByText("Ask Siargao could not answer right now. Please try again."),
  ).toHaveCount(1);
});

test("invalidates pending wait state on new chat and page navigation", async ({ page }) => {
  const chat = await mockDeferredChatApi(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("Build a first day plan around Cloud 9.");
  await composerInput.press("Enter");
  await expect.poll(() => chat.requests.length).toBe(1);
  await expect(page.getByTestId("assistant-wait-state")).toBeVisible();

  await page.getByLabel("Start a new chat").first().click();
  await expect(page.getByTestId("assistant-wait-state")).toHaveCount(0);
  await expect(page.getByText("Build a first day plan around Cloud 9.")).toHaveCount(0);
  await expect(composerInput).toBeEnabled();

  chat.release(0, { message: "Late new-chat answer should not render." });
  await page.waitForTimeout(250);
  await expect(page.getByText("Late new-chat answer should not render.")).toHaveCount(0);

  await composerInput.fill("What if we stay in Dapa?");
  await composerInput.press("Enter");
  await expect.poll(() => chat.requests.length).toBe(2);
  await expect(page.getByTestId("assistant-wait-state")).toBeVisible();

  await page.goto("/");
  chat.release(1, { message: "Late navigation answer should not render." });
  await page.goto("/chat");
  await expect(page.getByText("Late navigation answer should not render.")).toHaveCount(0);
  await expect(page.getByTestId("assistant-wait-state")).toHaveCount(0);
  await expect.poll(() => chat.requests.length).toBe(2);
});

async function mockChatApi(
  page: Page,
  {
    actions,
    assistantMessageId,
    cards,
    decisionSummaries,
    itineraries,
    message,
    sources,
    waitForRelease = false,
  }: {
    actions?: MockChatAction[];
    assistantMessageId?: string;
    cards?: MockRecommendationCard[];
    decisionSummaries?: MockDecisionSummary[];
    itineraries?: MockItineraryPlan[];
    message: string;
    sources?: MockSourceSummary[];
    waitForRelease?: boolean;
  },
) {
  const requests: ChatRequestBody[] = [];
  let releaseResponse: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON() as ChatRequestBody);
    if (waitForRelease) {
      await releasePromise;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message,
        model: "gpt-5.4-mini-test",
        requestId: "req_playwright_chat",
        ...(assistantMessageId ? { assistantMessageId } : {}),
        ...(sources?.length ? { sources } : {}),
        ...(cards?.length ? { cards } : {}),
        ...(decisionSummaries?.length ? { decisionSummaries } : {}),
        ...(actions?.length ? { actions } : {}),
        ...(itineraries?.length ? { itineraries } : {}),
      }),
    });
  });

  return {
    requests,
    release: releaseResponse,
  };
}

type DeferredChatReply = {
  body?: Record<string, unknown>;
  message?: string;
  requestId?: string;
  status?: number;
};

async function mockDeferredChatApi(page: Page) {
  const requests: ChatRequestBody[] = [];
  const pendingReplies: Array<(reply: DeferredChatReply) => void> = [];

  await page.route("**/api/chat", async (route) => {
    const requestIndex = pendingReplies.length;
    requests.push(route.request().postDataJSON() as ChatRequestBody);
    const reply = await new Promise<DeferredChatReply>((resolve) => {
      pendingReplies[requestIndex] = resolve;
    });
    const status = reply.status ?? 200;
    const body =
      reply.body ??
      ({
        message: reply.message ?? `Deferred answer ${requestIndex + 1}`,
        model: "gpt-5.4-mini-test",
        requestId: reply.requestId ?? `req_playwright_chat_deferred_${requestIndex + 1}`,
      } satisfies Record<string, unknown>);

    try {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } catch {
      // The browser may have already aborted the local wait; late route release is intentional.
    }
  });

  return {
    requests,
    release(index: number, reply: DeferredChatReply) {
      const releaseReply = pendingReplies[index];
      if (!releaseReply) {
        throw new Error(`No deferred chat request at index ${index}.`);
      }
      releaseReply(reply);
    },
  };
}

function lastSubmittedContent(request?: ChatRequestBody) {
  return request?.messages?.at(-1)?.content;
}

async function installDecisionMotionProbe(page: Page) {
  await page.addInitScript(() => {
    const metrics: DecisionMotionMetrics = {
      starts: 0,
      ends: 0,
      layoutShift: 0,
      longTasks: [],
      rafFrames: [],
    };
    let sampleFrames = false;

    window.__decisionMotionMetrics = metrics;

    document.addEventListener(
      "animationstart",
      (event) => {
        const target = event.target;
        if (
          event.animationName !== "decision-strip-sequence-cue" ||
          !(target instanceof HTMLElement) ||
          target.dataset.decisionSequenceCue !== "true"
        ) {
          return;
        }
        metrics.starts += 1;
        sampleFrames = true;
        const sample = (timestamp: number) => {
          metrics.rafFrames.push(timestamp);
          if (sampleFrames) {
            window.requestAnimationFrame(sample);
          }
        };
        window.requestAnimationFrame(sample);
      },
      true,
    );
    document.addEventListener(
      "animationend",
      (event) => {
        const target = event.target;
        if (
          event.animationName !== "decision-strip-sequence-cue" ||
          !(target instanceof HTMLElement) ||
          target.dataset.decisionSequenceCue !== "true"
        ) {
          return;
        }
        metrics.ends += 1;
        sampleFrames = false;
      },
      true,
    );

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) {
          metrics.layoutShift += entry.value ?? 0;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });
}

async function resetDecisionMotionMetrics(page: Page) {
  await page.evaluate(() => {
    const metrics = window.__decisionMotionMetrics;
    if (!metrics) {
      return;
    }
    metrics.starts = 0;
    metrics.ends = 0;
    metrics.layoutShift = 0;
    metrics.longTasks = [];
    metrics.rafFrames = [];
  });
}

async function decisionMotionMetrics(page: Page) {
  return page.evaluate(() => window.__decisionMotionMetrics);
}

async function boundingBoxSnapshot(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected element bounding box.");
  }
  return box;
}

function expectBoxStable(
  actual: Awaited<ReturnType<typeof boundingBoxSnapshot>>,
  expected: Awaited<ReturnType<typeof boundingBoxSnapshot>>,
) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(1);
  }
}

async function withCpuThrottle<T>(page: Page, rate: number, task: () => Promise<T>) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
  try {
    return await task();
  } finally {
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await session.detach();
  }
}

async function mockMobileTripContextProfile(
  page: Page,
  status: "anonymous" | "authenticated" | "loading" | "unavailable",
) {
  let releaseProfile: (() => void) | undefined;
  await page.route("**/api/me/profile", async (route) => {
    if (status === "loading") {
      await new Promise<void>((resolve) => {
        releaseProfile = resolve;
      });
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthenticated" }),
      });
      return;
    }
    if (status === "anonymous") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthenticated" }),
      });
      return;
    }
    if (status === "unavailable") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "profile_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(mobileAuthenticatedProfile()),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  return {
    release() {
      releaseProfile?.();
    },
  };
}

function mobileAuthenticatedProfile(): Record<string, unknown> & {
  tripContext: Record<string, unknown>;
} {
  return {
    userId: "user_mobile_trip_context",
    tripContext: {
      notes: "Late arrival",
      accommodation: "A very long Pilar homestay name that must wrap without widening the sheet",
      dateRange: "Aug 1 - 6",
      travelerType: "Two friends",
      currentArea: "Dapa",
    },
  };
}

async function mockUnavailableMobileConditions(page: Page) {
  await page.route("**/api/public/weather/siargao**", async (route) => {
    await route.fulfill({ status: 503, body: "weather unavailable" });
  });
  await page.route("**/api/public/surf/siargao**", async (route) => {
    await route.fulfill({ status: 503, body: "surf unavailable" });
  });
}

async function mockMobileConditionDecisions(page: Page) {
  let weather = 0;
  let surf = 0;
  await page.route("**/api/public/weather/siargao**", async (route) => {
    weather += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestedLocation: "Siargao Island",
        weather: {
          status: "live",
          locationName: "Siargao Island",
          fetchedAt: "2026-07-10T01:00:00.000Z",
          freshness: "fresh",
          today: {
            condition: "Rain",
            precipitationProbability: 50,
            rainSum: 7,
            precipitationSum: 7,
            windGust: 38,
          },
        },
      }),
    });
  });
  await page.route("**/api/public/surf/siargao**", async (route) => {
    surf += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        requestedLocation: "Siargao Island",
        surf: {
          status: "partial",
          locationName: "Siargao Island",
          fetchedAt: "2026-07-10T01:00:00.000Z",
          level: "medium",
          metrics: { waves: "Unavailable", tide: "Unavailable", wind: "gust 38km/h" },
          weather: {
            status: "live",
            freshness: "fresh",
            condition: "Rain",
            precipitationProbability: 50,
            rainSum: 7,
            windGust: 38,
          },
          tide: { status: "unavailable", stationName: "Dapa tide station", bestWindow: null },
          caveats: [],
        },
      }),
    });
  });
  return () => ({ surf, weather });
}

async function mobileTripContextGeometry(page: Page) {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      "[data-testid='mobile-trip-context-trigger']",
    );
    const dialog = document.querySelector<HTMLElement>(
      "[data-testid='mobile-trip-context-dialog']",
    );
    const scrollArea = document.querySelector<HTMLElement>(
      "[data-testid='mobile-trip-context-scroll-area']",
    );
    if (!trigger || !dialog || !scrollArea) {
      return { missing: true };
    }
    const triggerRect = trigger.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const dialogStyle = getComputedStyle(dialog.firstElementChild ?? dialog);
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>("button, input, select, textarea"),
    );
    return {
      documentFitsViewport:
        document.documentElement.scrollWidth <= window.innerWidth + 1 &&
        document.documentElement.scrollHeight <= window.innerHeight + 1,
      dialogFitsViewport:
        dialogRect.left >= -1 &&
        dialogRect.right <= window.innerWidth + 1 &&
        dialogRect.top >= -1 &&
        dialogRect.bottom <= window.innerHeight + 1,
      hasInternalScroll: scrollArea.scrollHeight > scrollArea.clientHeight,
      triggerTouchTarget: triggerRect.height >= 44,
      controlsFitDialog: controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left >= dialogRect.left - 1 && rect.right <= dialogRect.right + 1;
      }),
      safeAreaPaddingApplied:
        Number.parseFloat(dialogStyle.paddingTop) >= 12 &&
        Number.parseFloat(dialogStyle.paddingBottom) >= 12,
    };
  });
}

async function focusIsInsideMobileTripDialog(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("[data-testid='mobile-trip-context-dialog']");
    return Boolean(dialog?.contains(document.activeElement));
  });
}

async function readTripContextStorage(page: Page) {
  return page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as Record<string, unknown>) : {};
  }, tripContextStorageKey);
}

async function conditionDecisionText(container: Locator, idPrefix = "") {
  return {
    weather: {
      action: await container.getByTestId(`${idPrefix}weather-condition-action`).textContent(),
      basis: await container.getByTestId(`${idPrefix}weather-condition-basis`).textContent(),
      fallback: await container.getByTestId("weather-condition-fallback").textContent(),
      state: await container.getByTestId("weather-condition-state").textContent(),
    },
    surf: {
      action: await container.getByTestId(`${idPrefix}surf-condition-action`).textContent(),
      basis: await container.getByTestId(`${idPrefix}surf-condition-basis`).textContent(),
      fallback: await container.getByTestId("surf-condition-fallback").textContent(),
      state: await container.getByTestId("surf-condition-state").textContent(),
    },
  };
}

async function chatWorkspaceScrollSurfaces(page: Page) {
  return page.evaluate(() => {
    const workspace = document.querySelector("[aria-label='Ask Siargao chat workspace']");
    if (!workspace) {
      return ["missing chat workspace"];
    }

    return Array.from(workspace.querySelectorAll<HTMLElement>("*")).flatMap((element) => {
      const style = getComputedStyle(element);
      const hasScrollOverflow =
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll";
      return hasScrollOverflow
        ? [
            element.getAttribute("data-testid") ??
              element.getAttribute("aria-label") ??
              element.tagName,
          ]
        : [];
    });
  });
}

async function composerFitsViewport(page: Page) {
  return page.evaluate(() => {
    const composer = document.querySelector<HTMLElement>("form[aria-label='Ask Siargao composer']");
    const sendButton = document.querySelector<HTMLElement>("button[aria-label='Send question']");
    if (!composer || !sendButton) {
      return false;
    }

    const viewportWidth = window.innerWidth;
    const composerRect = composer.getBoundingClientRect();
    const buttonRect = sendButton.getBoundingClientRect();
    return (
      composerRect.left >= 0 &&
      composerRect.right <= viewportWidth &&
      buttonRect.left >= composerRect.left &&
      buttonRect.right <= composerRect.right &&
      buttonRect.right <= viewportWidth
    );
  });
}

async function rightRailFitsViewport(page: Page) {
  return page.getByTestId("context-rail").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 && rect.bottom <= window.innerHeight && element.scrollHeight <= rect.height
    );
  });
}

function publicSharedTripPlanForE2E(plan: E2ESharedTripPlan): E2ESharedTripPlan {
  return {
    ...plan,
    items: plan.items.map((item) => {
      const { tripId: _tripId, ...publicItem } = item;
      const payload =
        item.payload.type === "itinerary_plan"
          ? {
              type: "itinerary_plan" as const,
              plan: {
                ...item.payload.plan,
                sources: withBrowserSavedNotReverifiedSource(item.payload.plan.sources),
              },
            }
          : item.payload;

      return {
        ...publicItem,
        payload,
        sources: withBrowserSavedNotReverifiedSource(item.sources),
      };
    }),
  };
}

function withBrowserSavedNotReverifiedSource(sources: MockSourceSummary[]) {
  if (
    sources.some(
      (source) =>
        source.label === browserSavedNotReverifiedSource.label &&
        source.sourceName === browserSavedNotReverifiedSource.sourceName,
    ) ||
    sources.length >= 12
  ) {
    return sources;
  }

  return [...sources, browserSavedNotReverifiedSource];
}

function renderSharedTripPlanDocument(plan: E2ESharedTripPlan | null) {
  const body = plan
    ? `<main aria-label="Shared Siargao trip plan"><h1>${escapeHtml(plan.title)}</h1>${plan.items
        .map(renderSharedTripItem)
        .join("")}</main>`
    : `<main aria-label="Shared Siargao trip plan unavailable"><h1>Shared plan unavailable</h1><p>This shared Siargao plan cannot be opened. Ask the traveler for a fresh link.</p></main>`;

  return `<!doctype html><html lang="en"><head><title>Shared Siargao plan</title></head><body>${body}</body></html>`;
}

function renderSharedTripItem(item: E2ESavedTripItem) {
  if (item.payload.type === "recommendation_card") {
    const card = item.payload.card;
    return `<article><h2>${escapeHtml(card.title)}</h2>${[
      card.subtitle,
      card.distanceLabel,
      card.openStatusLabel,
      card.sourceLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => `<p>${escapeHtml(value)}</p>`)
      .join("")}${renderDecision(card.decision)}${renderSources(item.sources)}</article>`;
  }

  if (item.payload.type === "itinerary_plan") {
    const plan = item.payload.plan;
    return `<article><h2>${escapeHtml(plan.title)}</h2>${renderDecision(plan.decision)}${renderSources(plan.sources)}</article>`;
  }

  return `<article><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.payload.text)}</p></article>`;
}

function renderSources(sources: MockSourceSummary[]) {
  return `<section>${sources
    .map(
      (source) =>
        `<p>${escapeHtml(source.sourceName)} - ${escapeHtml(source.label.replaceAll("_", " "))}${
          source.fetchedAt ? ` - fetched ${escapeHtml(source.fetchedAt)}` : ""
        }</p>${[
          ...source.checked.map((item) => `Checked by ${source.sourceName}: ${item}`),
          ...source.notChecked.map((item) => `Not checked by ${source.sourceName}: ${item}`),
        ]
          .map((item) => `<p>${escapeHtml(item)}</p>`)
          .join("")}`,
    )
    .join("")}</section>`;
}

function renderDecision(decision?: MockDecisionMetadata) {
  if (!decision) {
    return "";
  }

  return `<section><h3>${escapeHtml(decisionLabelText(decision.label))}</h3><p>${escapeHtml(
    decision.bestAction,
  )}</p></section>`;
}

function decisionLabelText(label: MockDecisionMetadata["label"]) {
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type SavedTripStorageState = {
  tripId: string;
  items: E2ESavedTripItem[];
  updatedAt: string;
};

async function readSavedTripStorage(page: Page) {
  return page.evaluate((storageKey) => {
    const storedValue = localStorage.getItem(storageKey);
    if (!storedValue) {
      throw new Error("Saved trip storage missing.");
    }
    return JSON.parse(storedValue) as SavedTripStorageState;
  }, savedTripStorageKey);
}

const mockPlacesSource: MockSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places API",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-28T00:45:00.000Z",
  confidence: "high",
  checked: ["place identity", "current opening status"],
  notChecked: ["review text", "table availability"],
};

const mockWeatherSource: MockSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-28T00:45:00.000Z",
  confidence: "medium",
  checked: ["forecast for Cloud 9"],
  notChecked: ["surf reports", "lifeguard status"],
};

const browserSavedNotReverifiedSource: MockSourceSummary = {
  label: "not_verified",
  sourceName: "Browser saved trip",
  confidence: "low",
  checked: [],
  notChecked: ["Saved from browser and not reverified by Ask Siargao before sharing."],
};

function mockRainyCloud9Itinerary(): MockItineraryPlan {
  return {
    title: "Rainy Cloud 9 Afternoon",
    durationLabel: "3-4 hours",
    decision: {
      label: "fallback",
      bestAction: "Move indoors if rain gets heavier.",
    },
    stops: [
      {
        title: "Cloud 9 boardwalk",
        kind: "activity",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Keep the exposed stop short.",
        caveats: ["Weather needs checking."],
      },
      {
        title: "Covered cafe near Cloud 9",
        kind: "meal",
        sequence: 2,
        area: "Cloud 9",
        travelTimeFromPreviousMinutes: 5,
        mapsUrl: "https://maps.example/cloud9-cafe",
        rationale: "Fallback if rain builds.",
        caveats: ["Open status needs Places."],
      },
    ],
    fallbackStops: [
      {
        title: "Covered cafe near Cloud 9",
        kind: "meal",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Use during active rain.",
        caveats: ["Open status needs Places."],
      },
    ],
    skip: ["Exposed beach hopping"],
    sources: [
      {
        label: "curated_local_guide",
        sourceName: "Ask Siargao local guide",
        sourceProfileId: "source_local_guide",
        confidence: "high",
        checked: ["rainy-day Cloud 9 fallback pattern"],
        notChecked: ["live weather", "open cafe status"],
      },
    ],
  };
}

function mockSunsetDinnerItinerary(): MockItineraryPlan {
  return {
    title: "Sunset plus Dinner",
    durationLabel: "3-4 hours",
    stops: [
      {
        title: "Cloud 9 sunset stop",
        kind: "activity",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Keep sunset close to General Luna.",
        caveats: ["Weather still needs a forecast check."],
      },
      {
        title: "Dinner in General Luna",
        kind: "meal",
        sequence: 2,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 10,
        mapsUrl: "https://maps.example/general-luna-dinner",
        rationale: "Avoid a long ride after sunset.",
        caveats: ["Open status needs Places."],
      },
    ],
    fallbackStops: [],
    skip: ["Far north dinner detours after sunset"],
    sources: [
      {
        label: "curated_local_guide",
        sourceName: "Ask Siargao local guide",
        confidence: "medium",
        checked: ["route sequence"],
        notChecked: ["live weather", "dinner open status"],
      },
    ],
  };
}

function mockSandyBeachItinerary(): MockItineraryPlan {
  return {
    title: "Sandy Beach Half-Day",
    durationLabel: "3-4 hours",
    stops: [
      {
        title: "Doot Beach",
        kind: "beach",
        sequence: 1,
        area: "General Luna side",
        rationale: "Use the sandy beach option instead of surf-only Cloud 9.",
        caveats: ["Tide and lifeguard status were not checked."],
      },
      {
        title: "General Luna snack stop",
        kind: "meal",
        sequence: 2,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 15,
        rationale: "Keep the route compact for a half-day.",
        caveats: ["Open status needs Places if a specific venue is selected."],
      },
    ],
    fallbackStops: [
      {
        title: "Malinao Beach",
        kind: "beach",
        sequence: 1,
        area: "General Luna side",
        rationale: "Use as a quieter sandy fallback.",
        caveats: ["Tide and swim conditions were not checked."],
      },
    ],
    skip: ["Surf-only Cloud 9 sessions", "Far north beach detours"],
    sources: [
      {
        label: "curated_local_guide",
        sourceName: "Ask Siargao local guide",
        confidence: "medium",
        checked: ["sandy beach notes", "ride-time notes"],
        notChecked: ["live tide", "lifeguard status"],
      },
    ],
  };
}

function mockFoodCrawlItinerary(): MockItineraryPlan {
  return {
    title: "General Luna Food Crawl",
    durationLabel: "3-4 hours",
    stops: [
      {
        title: "First food stop",
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Start central.",
        caveats: ["Open status needs Places."],
      },
      {
        title: "Second food stop",
        kind: "meal",
        sequence: 2,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 8,
        mapsUrl: "https://maps.example/general-luna-food-stop",
        rationale: "Keep the crawl compact.",
        caveats: ["Menu and wait times were not checked."],
      },
    ],
    fallbackStops: [],
    skip: ["Venue names without Places evidence"],
    sources: [
      {
        label: "not_verified",
        sourceName: "Itinerary planner unchecked live signals",
        confidence: "medium",
        checked: [],
        notChecked: ["live open-now status", "current menus"],
      },
    ],
  };
}
