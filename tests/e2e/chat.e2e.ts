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
  sources: Array<{
    label: string;
    sourceName: string;
    sourceProfileId?: string;
    fetchedAt?: string;
    confidence?: "high" | "medium" | "low";
    checked: string[];
    notChecked: string[];
  }>;
};

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

test("sends granted browser geolocation once and consumes it after the request", async ({
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
    message: "Mocked near-me answer: I used the shared location for this request.",
  });

  await page.goto("/chat");

  await page.getByRole("button", { name: "Share location once" }).click();
  await expect(page.getByText("Location ready for the next question.")).toBeVisible();

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await composerInput.fill("What is open near me?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Mocked near-me answer:")).toBeVisible();
  await expect(page.getByText("Location used for the last question.")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(mockChat.requests[0]?.clientContext?.geolocation).toMatchObject({
    latitude: 9.8116,
    longitude: 126.1651,
    accuracyMeters: 25,
    consentScope: "single_request",
  });
  expect(mockChat.requests[0]?.clientContext?.geolocation?.capturedAt).toEqual(expect.any(String));

  await composerInput.fill("What about tomorrow?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(2);
  expect(lastSubmittedContent(mockChat.requests[1])).toBe("What about tomorrow?");
  expect(mockChat.requests[1]?.clientContext).toBeUndefined();
});

test("sends a mobile suggested prompt through the same chat API path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
    waitForRelease = false,
  }: {
    actions?: MockChatAction[];
    cards?: MockRecommendationCard[];
    itineraries?: MockItineraryPlan[];
    message: string;
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
