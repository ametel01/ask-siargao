"use client";

import type { MouseEvent } from "react";

export function SkipToMainContent() {
  function focusMainContent(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById("main-content");
    if (!target) {
      return;
    }

    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }

  return (
    // biome-ignore lint/a11y/useValidAnchor: A skip link needs native fragment navigation before hydration.
    <a
      className="fixed top-3 left-3 z-[100] -translate-y-24 rounded-md bg-brand-lagoon-700 px-4 py-3 text-sm font-extrabold text-text-on-dark no-underline shadow-surface-overlay transition-transform focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-brand-lagoon-300 motion-reduce:transition-none"
      href="#main-content"
      onClick={focusMainContent}
    >
      Skip to main content
    </a>
  );
}
