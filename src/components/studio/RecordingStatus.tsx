"use client";

import { Circle, Pause } from "lucide-react";
import { formatDurationWords, formatTimer } from "@/lib/format";
import { MAX_RECORDING_MS } from "@/lib/studio/machine";

/** Persistent "Recording"/"Paused" badge with icon and text (R4.3, R4.4). */
export function RecordingBadge({ paused }: { paused: boolean }) {
  return (
    <span
      data-testid="recording-badge"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-small font-semibold ${
        paused ? "border-warning bg-canvas/80 text-warning" : "border-record bg-canvas/80 text-record"
      }`}
    >
      {paused ? (
        <Pause aria-hidden="true" size={14} />
      ) : (
        <Circle aria-hidden="true" size={12} className="fill-record motion-safe:animate-pulse" />
      )}
      {paused ? "Paused" : "Recording"}
    </span>
  );
}

/**
 * Elapsed and remaining time. role="timer" with aria-live off: screen readers
 * read it on focus; milestones are announced separately (R16.6).
 */
export function RecordingTimer({ elapsedMs, warning }: { elapsedMs: number; warning: boolean }) {
  const remaining = Math.max(0, MAX_RECORDING_MS - elapsedMs);
  return (
    <div
      role="timer"
      aria-live="off"
      tabIndex={0}
      aria-label={`Elapsed ${formatDurationWords(elapsedMs)} of 5 minutes`}
      className="inline-flex items-baseline gap-3 rounded-md bg-canvas/80 px-3 py-1"
    >
      <span className="font-mono text-xl font-medium text-text tabular">{formatTimer(elapsedMs)}</span>
      <span className={`text-small tabular ${warning ? "font-semibold text-warning" : "text-text-muted"}`}>
        {formatTimer(remaining)} left
      </span>
    </div>
  );
}
