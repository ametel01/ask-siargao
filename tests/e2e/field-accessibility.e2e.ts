import { expect, test } from "@playwright/test";

const harnessHeaders = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

const fieldRoutes = [
  "/operator/field",
  "/operator/field/plan",
  "/operator/field/capture",
  "/operator/field/review",
  "/operator/field/exports",
  "/operator/field/security-workspace",
  "/operator/field/offline-shell",
  "/operator/field/diagnostics-recovery/legacy-import",
] as const;

for (const route of fieldRoutes) {
  test(`keeps the Field Workspace skip link usable on ${route}`, async ({ page }) => {
    await page.setExtraHTTPHeaders(harnessHeaders);
    await page.goto(route);

    const main = page.locator("#main-content");
    await expect(main).toHaveCount(1);
    await expect(main).toHaveAttribute("tabindex", "-1");

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toHaveAttribute("href", "#main-content");
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(main).toBeFocused();
  });
}
