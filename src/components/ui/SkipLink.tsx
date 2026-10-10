/** "Skip to main content" link, first focusable element on every page (R16.3). */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-3 focus:text-text focus:shadow-3"
    >
      Skip to main content
    </a>
  );
}
