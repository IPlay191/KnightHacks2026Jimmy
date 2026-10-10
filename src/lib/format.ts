/** Formatting helpers for times, numbers, and units. Pure. */

/** 75_000 → "1:15" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 75_000 → "01:15" (used by the recording timer). */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Spoken form for screen readers: "1 minute 12 seconds". */
export function formatDurationWords(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s > 0 || m === 0) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** 128_400 → "2m 08s" */
export function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatDate(iso: string | Date, timeZone?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}
