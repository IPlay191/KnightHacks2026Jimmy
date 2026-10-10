/** Builds WebVTT captions from transcript segments (R11.2). Pure. */
function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msPart = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(msPart, 3)}`;
}

function escapeCue(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/-->/g, "→");
}

export function buildVtt(segments: { startMs: number; endMs: number; text: string }[]): string {
  const cues = segments
    .filter((s) => s.text.trim().length > 0)
    .map((s, i) => {
      const end = Math.max(s.endMs, s.startMs + 500);
      return `${i + 1}\n${stamp(s.startMs)} --> ${stamp(end)}\n${escapeCue(s.text.trim())}`;
    });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
