/** Microphone level helpers for the meter and mic check (R3.4, design §10.5). */
export const QUIET_DBFS = -50;
export const LOUD_DBFS = -6;
const QUIET_SUSTAIN_MS = 1500;
const LOUD_PEAKS = 3;
const LOUD_WINDOW_MS = 2000;
const STATUS_HOLD_MS = 1500;

export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export function peakDbfs(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  return peak > 0 ? Math.max(-100, 20 * Math.log10(peak)) : -100;
}

/** Maps dBFS (−60…0) to a 0…1 meter value. */
export function meterValue(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export type MicStatus = "good" | "quiet" | "loud";

export const MIC_STATUS_TEXT: Record<MicStatus, string> = {
  good: "We can hear you",
  quiet: "Too quiet: move closer",
  loud: "Too loud: move back",
};

/**
 * Stateful mic-check classifier: "too quiet" when below −50 dBFS for 1.5 s,
 * "too loud" when peaks exceed −6 dBFS three times within 2 s. The reported
 * status changes at most once every 1.5 s.
 */
export class MicCheck {
  private quietSince: number | null = null;
  private loudPeaks: number[] = [];
  private status: MicStatus = "good";
  private lastChange = -Infinity;

  update(rmsDb: number, peakDb: number, now: number): MicStatus {
    if (rmsDb < QUIET_DBFS) this.quietSince ??= now;
    else this.quietSince = null;
    if (peakDb > LOUD_DBFS) this.loudPeaks.push(now);
    this.loudPeaks = this.loudPeaks.filter((t) => now - t <= LOUD_WINDOW_MS);
    let next: MicStatus = "good";
    if (this.loudPeaks.length >= LOUD_PEAKS) next = "loud";
    else if (this.quietSince !== null && now - this.quietSince >= QUIET_SUSTAIN_MS) next = "quiet";
    if (next !== this.status && now - this.lastChange >= STATUS_HOLD_MS) {
      this.status = next;
      this.lastChange = now;
    }
    return this.status;
  }
}
