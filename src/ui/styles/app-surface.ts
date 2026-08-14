/*
 * Shared product surface roles:
 * - panel: the primary bounded workspace or section.
 * - inset: quiet supporting groups inside a workspace.
 * - overlay: dialogs, sheets, and transient floating UI.
 * - line item: repeated rows that should not become nested cards.
 *
 * Keep these style-only exports separate from component modules so Server
 * Components can use them without pulling client component dependencies.
 */
export const appSurfacePanelClass =
  "rounded-md border border-border-default bg-surface-default text-text-default shadow-surface-panel";

export const appSurfaceInsetClass =
  "rounded-md border border-border-default/80 bg-surface-soft text-text-default shadow-none";

export const appSurfaceOverlayClass =
  "rounded-md border border-border-default bg-surface-default text-text-default shadow-surface-overlay";

export const appSurfaceLineItemClass =
  "border-border-default border-t bg-transparent shadow-none first:border-t-0";
