"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";

/** Friendly recovery page for unexpected errors (R17.2). No stack traces are shown. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <h1 ref={heading} tabIndex={-1} className="text-h1 outline-none">
        Something went wrong
      </h1>
      <p className="text-text-secondary">
        We couldn&apos;t load this page. This is usually temporary, so try again in a moment.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Go home
        </ButtonLink>
      </div>
    </div>
  );
}
