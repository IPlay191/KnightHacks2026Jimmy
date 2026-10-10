import type { ReactNode } from "react";

/** Page title block. Each page has exactly one h1 (R16.3). */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  titleId,
}: {
  title: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
        <h1 id={titleId} tabIndex={-1} className="text-h1 text-text outline-none">
          {title}
        </h1>
        {description ? <div className="mt-2 max-w-[68ch] text-text-secondary">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
