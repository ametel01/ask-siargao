import { expect, type Page, test } from "@playwright/test";

type ChatRequestBody = {
  messages?: Array<{
    role?: string;
    content?: string;
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
  await expect(page.getByText("GPT-backed response")).toBeVisible();
  await expect(page.getByText("Weather questions can use")).toBeVisible();
  await expect(page.getByText("Open-Meteo snapshot")).toBeVisible();
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

test("auto-submits a prompt deep link once", async ({ page }) => {
  const prompt = "What should I do near Cloud 9?";
  const mockChat = await mockChatApi(page, {
    message: "Mocked deep-link answer: start near the boardwalk, then pick a quiet cafe.",
  });

  await page.goto(`/chat?prompt=${encodeURIComponent(prompt)}`);

  await expect(page.getByText(prompt)).toBeVisible();
  await expect(
    page.getByText("Mocked deep-link answer: start near the boardwalk, then pick a quiet cafe."),
  ).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe(prompt);
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
    message,
    waitForRelease = false,
  }: {
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
