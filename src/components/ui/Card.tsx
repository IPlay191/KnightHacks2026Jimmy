import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  className = "",
  children,
  as: Tag = "section",
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "li" | "aside"; children: ReactNode }) {
  return (
    <Tag className={`rounded-lg border border-border-subtle bg-surface p-4 shadow-2 sm:p-6 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export type BadgeTone = "neutral" | "primary" | "record" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border-strong text-text-secondary",
  primary: "border-primary-soft text-primary-soft",
  record: "border-record text-record",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
};

/** Text badge; tone is decorative, the text always carries the meaning. */
export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-canvas/40 px-2.5 py-0.5 text-caption ${tones[tone]} ${className}`}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
