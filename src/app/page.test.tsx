import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "@/app/page";

test("publishes homepage Website and Organization structured data", () => {
  const html = renderToStaticMarkup(<Home />);

  expect(html).toContain('"@type":"WebSite"');
  expect(html).toContain('"@type":"Organization"');
  expect(html).toContain('"@id":"https://www.asksiargao.com/#organization"');
});
