import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FieldMain } from "./FieldMain";

test("renders the unique focusable main-content landmark contract", () => {
  const html = renderToStaticMarkup(
    <FieldMain className="surface">
      <h1>Field Workspace</h1>
    </FieldMain>,
  );

  expect(html).toBe(
    '<main class="surface" id="main-content" tabindex="-1"><h1>Field Workspace</h1></main>',
  );
});

test("renders embedded field content without claiming the route landmark", () => {
  const html = renderToStaticMarkup(<FieldMain landmark={false}>Embedded Recorder</FieldMain>);

  expect(html).toBe("<div>Embedded Recorder</div>");
  expect(html).not.toContain("main-content");
});
