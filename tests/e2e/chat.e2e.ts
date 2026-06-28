import { expect, type Page, test } from "@playwright/test";

type ChatRequestBody = {
  messages?: Array<{
    role?: string;
    content?: string;
  }>;
  clientContext?: {
    geolocation?: {
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number;
      capturedAt?: string;
      consentScope?: "single_request" | "trip_session";
    };
  };
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
  stops: MockItineraryStop[];
  fallbackStops: MockItineraryStop[];
  skip: string[];
  sources: MockSourceSummary[];
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

const savedTripStorageKey = "ask-siargao:saved-trip:v1";

test("sends a desktop composer message to the chat API and renders the assistant response", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2048, height: 1153 });
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
  await expect(page.getByRole("heading", { name: "Trip context" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cloud 9 Weather" })).toHaveCount(0);
  await expect(page.getByText("Fresh")).toHaveCount(0);
  await expect(page.getByText("High confidence")).toHaveCount(0);

  const composerInput = page.getByLabel("Ask anything about Siargao");
  const sendButton = page.getByRole("button", { name: "Send question" });
  await expect(composerInput).toBeVisible();
  await composerInput.fill("Where should we eat near Cloud 9 tonight?");
  await sendButton.click();

  await expect(page.getByText("Where should we eat near Cloud 9 tonight?")).toBeVisible();
  await expect(page.getByText("Thinking through that with Ask Siargao...")).toBeVisible();
  await expect(composerInput).toBeDisabled();
  await expect(sendButton).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "What should I do near Cloud 9 today?" }),
  ).toBeDisabled();
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
  await expect(
    page.getByTestId("recommendation-card").filter({ hasText: "Shaka Siargao" }),
  ).toBeVisible();
  await expect(page.getByText("About 50 m from search center.")).toBeVisible();
  await expect(page.getByText("Open now according to Google Places.")).toBeVisible();
  await expect(page.getByText("Google Places - live checked")).toBeVisible();
  await expect(page.getByText("Review text and bookings were not checked.")).toBeVisible();

  const mapLink = page.getByRole("link", { name: "Open Shaka Siargao in Google Maps" });
  await expect(mapLink).toHaveAttribute("href", "https://maps.google.com/?cid=shaka");
  await expect(mapLink).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "Make this into a short plan" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(2);
  expect(lastSubmittedContent(mockChat.requests[1])).toBe(actionPrompt);
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
  await expect(page.getByTestId("itinerary-sources")).toContainText(
    "curated local guide - Ask Siargao local guide, high confidence",
  );
  await expect(page.getByTestId("itinerary-sources")).toContainText(
    "Not checked by Ask Siargao local guide: live weather",
  );
});

test("saves local cards and itineraries with dedupe, removal, and reload persistence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
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

test("creates and copies or opens a share link from saved cards and itineraries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
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
  let savedSyncRequests = 0;
  await page.route("**/api/trips/saved", async (route) => {
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
  await expect(foodPlan.getByTestId("itinerary-sources")).toContainText(
    "Not checked by Itinerary planner unchecked live signals: live open-now status",
  );
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

test("renders numbered assistant plans and source caveats as separate blocks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockChatApi(page, {
    message: [
      "It looks stormy near Cloud 9 today: thunderstorm, 75% precipitation chance. Keep it close.",
      "",
      "1. Start with a covered cafe near Catangnan.",
      "2. Use the heaviest rain window for massage or errands.",
      "3. Walk the Cloud 9 boardwalk only during a clear break.",
      "",
      "Checked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - forecast for Cloud 9. Weather signal: Thunderstorm; rain 0.7mm. Not checked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo; fetched 2026-06-26T00:00:00.000Z) - Google Places open-now results and road flooding.",
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
  ).toHaveCount(1);
  await expect(page.getByTestId("itinerary-plans")).toHaveCount(0);

  const orderedListCount = await page
    .getByTestId("assistant-message-bubble")
    .last()
    .locator("ol")
    .count();
  expect(orderedListCount).toBe(1);
  await expect(sourceLines).toHaveCount(3);
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
        model: "gpt-5.5-test",
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
        model: "gpt-5.5-test",
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

async function mockChatApi(
  page: Page,
  {
    actions,
    cards,
    itineraries,
    message,
    sources,
    waitForRelease = false,
  }: {
    actions?: MockChatAction[];
    cards?: MockRecommendationCard[];
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
        model: "gpt-5.5-test",
        requestId: "req_playwright_chat",
        ...(sources?.length ? { sources } : {}),
        ...(cards?.length ? { cards } : {}),
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

function lastSubmittedContent(request?: ChatRequestBody) {
  return request?.messages?.at(-1)?.content;
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
      .join("")}${renderSources(item.sources)}</article>`;
  }

  if (item.payload.type === "itinerary_plan") {
    const plan = item.payload.plan;
    return `<article><h2>${escapeHtml(plan.title)}</h2>${renderSources(plan.sources)}</article>`;
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
  items: Array<{
    id: string;
    kind: "place" | "beach" | "itinerary" | "note";
    title: string;
    sources?: MockSourceSummary[];
    updatedAt: string;
  }>;
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
