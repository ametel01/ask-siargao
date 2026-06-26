import { expect, type Page, test } from "@playwright/test";

type ChatRequestBody = {
  messages?: Array<{
    role?: string;
    content?: string;
  }>;
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
  await expect(page.getByText("Google Places - live checked")).toBeVisible();
  await expect(page.getByText("Review text and bookings were not checked.")).toBeVisible();

  const mapLink = page.getByRole("link", { name: "Open Shaka Siargao in Google Maps" });
  await expect(mapLink).toHaveAttribute("href", "https://maps.google.com/?cid=shaka");
  await expect(mapLink).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "Make this into a short plan" }).click();

  await expect.poll(() => mockChat.requests.length).toBe(2);
  expect(lastSubmittedContent(mockChat.requests[1])).toBe(actionPrompt);
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
    message,
    waitForRelease = false,
  }: {
    actions?: MockChatAction[];
    cards?: MockRecommendationCard[];
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
