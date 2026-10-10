"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Switch } from "radix-ui";
import { Plus, X } from "lucide-react";
import { updateSettings } from "@/app/actions/settings";
import { AudienceRadioGroup } from "@/components/shared/AudienceRadioGroup";
import { useMotion } from "@/components/motion/MotionProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";
import { TextField } from "@/components/ui/TextField";
import { CUSTOM_FILLER_RE } from "@/lib/validation";
import type { Audience, MotionPreference } from "@/lib/types";

export interface SettingsValues {
  displayName: string;
  defaultAudience: Audience;
  targetWpmMin: number;
  targetWpmMax: number;
  customFillers: string[];
  motionPreference: MotionPreference;
  autoAdvanceReport: boolean;
}

const FIELD_ORDER = ["displayName", "defaultAudience", "targetWpmMin", "targetWpmMax", "customFillers", "motionPreference"];
const MOTION_OPTIONS: { value: MotionPreference; label: string; hint: string }[] = [
  { value: "system", label: "Match system", hint: "Follow your device's reduced-motion setting" },
  { value: "reduce", label: "Reduce motion", hint: "Skip animations and use brief fades" },
  { value: "full", label: "Full motion", hint: "Always show animations" },
];

/** Settings form (R13.1, R13.2, R13.6, R20.1). */
export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [values, setValues] = useState<SettingsValues>(initial);
  const [minText, setMinText] = useState(String(initial.targetWpmMin));
  const [maxText, setMaxText] = useState(String(initial.targetWpmMax));
  const [newFiller, setNewFiller] = useState("");
  const [fillerError, setFillerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();
  const { setPreference } = useMotion();
  const formRef = useRef<HTMLFormElement>(null);

  const addFiller = () => {
    const f = newFiller.trim().toLowerCase().replace(/\s+/g, " ");
    if (!f) return;
    if (!CUSTOM_FILLER_RE.test(f)) {
      setFillerError("Use only letters, spaces, and apostrophes (1–24 characters).");
      return;
    }
    if (values.customFillers.includes(f)) {
      setFillerError("That filler word is already in your list.");
      return;
    }
    if (values.customFillers.length >= 20) {
      setFillerError("You can add up to 20 filler words.");
      return;
    }
    setValues((v) => ({ ...v, customFillers: [...v.customFillers, f] }));
    setNewFiller("");
    setFillerError(null);
    announce(`Added "${f}".`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const payload = { ...values, targetWpmMin: minText, targetWpmMax: maxText };
    startTransition(async () => {
      const res = await updateSettings(payload);
      if (res.ok) {
        setErrors({});
        setSaved(true);
        setValues((v) => ({ ...v, targetWpmMin: Number(minText), targetWpmMax: Number(maxText) }));
        setPreference(values.motionPreference);
        announce("Settings saved.");
        return;
      }
      setErrors(res.fieldErrors);
      announce(`Please fix ${Object.keys(res.fieldErrors).length} field${Object.keys(res.fieldErrors).length === 1 ? "" : "s"}.`, {
        assertive: true,
      });
      const first = FIELD_ORDER.find((k) => res.fieldErrors[k]);
      if (first) {
        const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
        el?.focus();
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {errors.form ? (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-danger">
          {errors.form}
        </p>
      ) : null}
      <Card>
        <h2 className="text-h3">Profile</h2>
        <TextField
          className="mt-4"
          label="Display name"
          data-field="displayName"
          maxLength={40}
          value={values.displayName}
          error={errors.displayName}
          onChange={(e) => setValues((v) => ({ ...v, displayName: e.target.value }))}
        />
      </Card>

      <Card>
        <h2 className="text-h3">Audience</h2>
        <p className="mt-1 text-small text-text-secondary">
          The studio starts with this audience. You can still change it before each recording.
        </p>
        <div className="mt-4" data-field="defaultAudience" tabIndex={-1}>
          <AudienceRadioGroup
            legend="Default audience"
            value={values.defaultAudience}
            onChange={(a) => setValues((v) => ({ ...v, defaultAudience: a }))}
          />
          {errors.defaultAudience ? <p className="mt-2 text-small text-danger">{errors.defaultAudience}</p> : null}
        </div>
      </Card>

      <Card>
        <h2 className="text-h3">Pace target (General audience)</h2>
        <p className="mt-1 text-small text-text-secondary">
          Used when you choose the General audience. Young, Teen, and Senior audiences use their own pace targets.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="Minimum words per minute"
            description="80–200"
            inputMode="numeric"
            data-field="targetWpmMin"
            value={minText}
            error={errors.targetWpmMin}
            onChange={(e) => setMinText(e.target.value)}
          />
          <TextField
            label="Maximum words per minute"
            description="100–220, greater than the minimum"
            inputMode="numeric"
            data-field="targetWpmMax"
            value={maxText}
            error={errors.targetWpmMax}
            onChange={(e) => setMaxText(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-h3">Custom filler words</h2>
        <p className="mt-1 text-small text-text-secondary">
          Words or phrases you tend to overuse. The AI checks each use in context before counting it. Up to 20.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField
            className="flex-1"
            label="Add a filler word"
            data-field="customFillers"
            maxLength={24}
            value={newFiller}
            error={fillerError ?? errors.customFillers}
            onChange={(e) => setNewFiller(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFiller();
              }
            }}
          />
          <Button variant="secondary" onClick={addFiller} icon={<Plus size={18} />}>
            Add
          </Button>
        </div>
        {values.customFillers.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your custom filler words">
            {values.customFillers.map((f) => (
              <li key={f} className="inline-flex items-center gap-1 rounded-full border border-border-strong pl-3 text-small">
                {f}
                <IconButton
                  aria-label={`Remove ${f}`}
                  className="size-8 min-h-8"
                  onClick={() => {
                    setValues((v) => ({ ...v, customFillers: v.customFillers.filter((x) => x !== f) }));
                    announce(`Removed "${f}".`);
                  }}
                >
                  <X size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-small text-text-muted">No custom filler words yet.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-h3">Motion and navigation</h2>
        <fieldset className="mt-4" data-field="motionPreference" tabIndex={-1}>
          <legend className="text-small text-text">Animations</legend>
          <div className="mt-2 flex flex-col gap-2">
            {MOTION_OPTIONS.map((o) => (
              <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3">
                <input
                  type="radio"
                  name="motionPreference"
                  value={o.value}
                  checked={values.motionPreference === o.value}
                  onChange={() => setValues((v) => ({ ...v, motionPreference: o.value }))}
                  className="mt-1 size-4 accent-primary"
                />
                <span>
                  <span className="block font-semibold text-text">{o.label}</span>
                  <span className="block text-caption text-text-secondary">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-6 flex items-center justify-between gap-4">
          <label htmlFor="auto-advance" className="flex flex-col">
            <span className="font-semibold text-text">Open the report automatically</span>
            <span className="text-caption text-text-secondary">After analysis finishes (never with reduced motion).</span>
          </label>
          <Switch.Root
            id="auto-advance"
            checked={values.autoAdvanceReport}
            onCheckedChange={(c) => setValues((v) => ({ ...v, autoAdvanceReport: c }))}
            className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-border-strong bg-surface-raised data-[state=checked]:border-primary data-[state=checked]:bg-primary"
          >
            <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-text transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-primary" />
          </Switch.Root>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {saved ? (
          <p role="status" className="text-small text-success">
            Settings saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}
