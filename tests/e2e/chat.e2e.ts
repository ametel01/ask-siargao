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
    message: "Mocked dinner answer: try Kermit or Bravo near Cloud 9 tonight.",
    waitForRelease: true,
  });

  await page.goto("/chat");

  await expect(page.getByLabel("Ask Siargao chat workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Ask a real question/i })).toBeVisible();
  await expect(page.getByText("GPT-backed response")).toBeVisible();
  await expect(page.getByText("does not check live weather")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new chat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trip context" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cloud 9 Weather" })).toHaveCount(0);
  await expect(page.getByText("Fresh")).toHaveCount(0);
  await expect(page.getByText("High confidence")).toHaveCount(0);

  const composerInput = page.getByLabel("Ask anything about Siargao");
  await expect(composerInput).toBeVisible();
  await composerInput.fill("Where should we eat near Cloud 9 tonight?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByText("Where should we eat near Cloud 9 tonight?")).toBeVisible();
  await expect(page.getByText("Thinking through that with Ask Siargao...")).toBeVisible();
  await expect.poll(() => mockChat.requests.length).toBe(1);
  expect(lastSubmittedContent(mockChat.requests[0])).toBe(
    "Where should we eat near Cloud 9 tonight?",
  );

  mockChat.release();

  await expect(
    page.getByText("Mocked dinner answer: try Kermit or Bravo near Cloud 9 tonight."),
  ).toBeVisible();

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
