/**
 * Practice streak and trend (R12.2, A7, design §7.3 notes). Pure (P11).
 * Each session's calendar day is its completion time in its own stored zone.
 * "Today" uses the zone of the newest session.
 */
export interface ProgressPoint {
  completedAt: string;
  timeZone: string;
  overall: number;
}

export type Trend =
  | { kind: "improving" | "steady" | "declining"; delta: number }
  | { kind: "insufficient"; delta: null };

export interface ProgressStats {
  streakDays: number;
  trend: Trend;
}

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" for an instant in a time zone (falls back to UTC). */
export function dayKey(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Days since the Unix epoch for a "YYYY-MM-DD" key. */
function dayNumber(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

export function computeStreak(points: ProgressPoint[], now: Date): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  const newest = sorted[sorted.length - 1];
  const zone = newest?.timeZone ?? "UTC";
  const days = new Set(sorted.map((p) => dayNumber(dayKey(new Date(p.completedAt), p.timeZone))));
  const today = dayNumber(dayKey(now, zone));
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (cursor === null) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}

export function computeTrend(points: ProgressPoint[]): Trend {
  if (points.length < 6) return { kind: "insufficient", delta: null };
  const sorted = [...points].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  const last3 = sorted.slice(-3);
  const prev3 = sorted.slice(-6, -3);
  const mean = (xs: ProgressPoint[]) => xs.reduce((a, p) => a + p.overall, 0) / xs.length;
  const delta = Math.round((mean(last3) - mean(prev3)) * 10) / 10;
  const kind = delta >= 3 ? "improving" : delta <= -3 ? "declining" : "steady";
  return { kind, delta };
}

export function computeProgressStats(points: ProgressPoint[], now: Date = new Date()): ProgressStats {
  return { streakDays: computeStreak(points, now), trend: computeTrend(points) };
}
