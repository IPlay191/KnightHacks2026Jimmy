"use client";

import { RadioGroup } from "radix-ui";
import { Check } from "lucide-react";
import { useId } from "react";
import { AUDIENCE_PROFILES } from "@/lib/audience";
import { AUDIENCES, type Audience } from "@/lib/types";
import { AUDIENCE_ICONS } from "./AudienceBadge";

/**
 * Labelled radio group of audience cards (R20.1, R20.2, R20.10). Arrow keys
 * move the selection; selection shows a check icon and a thicker outline,
 * not just a color change.
 */
export function AudienceRadioGroup({
  value,
  onChange,
  legend,
  name,
  disabled,
}: {
  value: Audience;
  onChange: (a: Audience) => void;
  legend: string;
  name?: string;
  disabled?: boolean;
}) {
  const base = useId();
  const legendId = `${base}-legend`;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend id={legendId} className="mb-2 text-small text-text">
        {legend}
      </legend>
      <RadioGroup.Root
        aria-labelledby={legendId}
        value={value}
        name={name}
        onValueChange={(v) => onChange(v as Audience)}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        disabled={disabled}
      >
        {AUDIENCES.map((a) => {
          const p = AUDIENCE_PROFILES[a];
          const Icon = AUDIENCE_ICONS[a];
          const descId = `${base}-${a}-desc`;
          const selected = value === a;
          return (
            <RadioGroup.Item
              key={a}
              value={a}
              aria-describedby={descId}
              data-testid={`audience-${a}`}
              className={`group relative flex min-h-16 items-start gap-3 rounded-md border bg-surface-raised p-3 text-left transition-colors hover:border-primary-soft disabled:cursor-not-allowed ${
                selected ? "border-2 border-primary-soft" : "border-border-strong"
              }`}
            >
              <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary-soft" />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-text">
                  {p.label} <span className="font-normal text-text-muted">· {p.ageRange}</span>
                </span>
                <span id={descId} className="text-caption text-text-secondary">
                  {p.description}
                </span>
              </span>
              <RadioGroup.Indicator className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-on-primary">
                <Check aria-hidden="true" size={14} strokeWidth={3} />
              </RadioGroup.Indicator>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
    </fieldset>
  );
}
