export function SkipToMainContent() {
  return (
    <a
      className="fixed top-3 left-3 z-[100] -translate-y-24 rounded-md bg-brand-lagoon-700 px-4 py-3 text-sm font-extrabold text-text-on-dark no-underline shadow-surface-overlay transition-transform focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-brand-lagoon-300 motion-reduce:transition-none"
      href="#main-content"
    >
      Skip to main content
    </a>
  );
}
