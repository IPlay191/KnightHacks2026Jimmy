"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines } from "lucide-react";

const LINKS = [
  { href: "/studio", label: "Studio" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

/** Site header with brand and primary navigation (R16.3). */
export function TopNav({ showLinks = true }: { showLinks?: boolean }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md font-display text-lg font-bold text-text">
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-primary to-success text-on-primary"
          >
            <AudioLines size={18} strokeWidth={2.5} />
          </span>
          <span>Speech Reviewer</span>
        </Link>
        {showLinks ? (
          <nav aria-label="Primary">
            <ul className="flex items-center gap-1">
              {LINKS.map((l) => {
                const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center rounded-md px-3 text-small transition-colors ${
                        active
                          ? "bg-surface-raised text-text underline decoration-primary decoration-2 underline-offset-8"
                          : "text-text-secondary hover:bg-surface hover:text-text"
                      }`}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
