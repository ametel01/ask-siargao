import { expect, test } from "@playwright/test";

test("completes a real chat POST through the Next.js runtime", async ({ request }) => {
  const response = await request.post("/api/chat", {
    data: {
      messages: [{ role: "user", content: "Runtime smoke check" }],
    },
  });
  const body = await response.json();

  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({
    message: "Runtime smoke answer from the deterministic model fixture.",
    model: "deepseek-v4-flash-runtime-smoke",
  });
});
