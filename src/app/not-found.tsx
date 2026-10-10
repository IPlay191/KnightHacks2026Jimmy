import { TopNav } from "@/components/layout/TopNav";
import { ButtonLink } from "@/components/ui/Button";

/** Same response for missing and unowned sessions, so existence isn't revealed (R10.7). */
export default function NotFound() {
  return (
    <>
      <TopNav />
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 outline-none sm:px-6">
        <h1 className="text-h1">We couldn&apos;t find that page</h1>
        <p className="text-text-secondary">
          The session may have been deleted, or the link may be wrong. Your history has everything you&apos;ve recorded.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/history">Go to history</ButtonLink>
          <ButtonLink href="/studio" variant="secondary">
            Record a speech
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
