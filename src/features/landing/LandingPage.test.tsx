import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingPage } from "@/features/landing/LandingPage";

test("uses a homepage H1 aligned with the page title", () => {
  const html = renderToStaticMarkup(<LandingPage />);

  expect(html).toContain("<h1");
  expect(html).toContain("Live, local Siargao <span");
  expect(html).toContain(">travel advice</span>");
});
