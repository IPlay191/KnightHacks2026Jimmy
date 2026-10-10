"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { formatClock, formatSeconds } from "@/lib/format";
import type { Interval } from "@/lib/types";

export interface TranscriptWord {
  seq: number;
  segmentSeq: number;
  word: string;
  startMs: number;
  fillerPhrase: string | null;
  fillerStatus: string | null;
}

/**
 * Transcript with timestamps, filler highlights (underline + sr-only label,
 * not color alone), and inline long-pause markers (R11.1, R11.3, R11.5).
 */
export function TranscriptPanel({
  segments,
  words,
  longPauses,
  onSeek,
}: {
  segments: { seq: number; startMs: number; endMs: number; text: string }[];
  words: TranscriptWord[];
  longPauses: Interval[];
  onSeek?: (ms: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const bySegment = useMemo(() => {
    const map = new Map<number, TranscriptWord[]>();
    for (const w of words) {
      const list = map.get(w.segmentSeq) ?? [];
      list.push(w);
      map.set(w.segmentSeq, list);
    }
    return map;
  }, [words]);

  // Spans of counted fillers: the first word carries the phrase; phrases span N words.
  const fillerSeqs = useMemo(() => {
    const set = new Map<number, string>();
    for (const w of words) {
      if (!w.fillerPhrase || (w.fillerStatus !== "unambiguous" && w.fillerStatus !== "confirmed")) continue;
      const span = w.fillerPhrase.split(" ").length;
      for (let i = 0; i < span; i++) set.set(w.seq + i, w.fillerPhrase);
    }
    return set;
  }, [words]);

  const pauseBefore = useMemo(() => {
    // Attach each long pause to the first word that starts at or after its end.
    const map = new Map<number, number>();
    const sorted = [...words].sort((a, b) => a.seq - b.seq);
    for (const p of longPauses) {
      const w = sorted.find((x) => x.startMs >= p.endMs - 50);
      if (w && !map.has(w.seq)) map.set(w.seq, p.endMs - p.startMs);
    }
    return map;
  }, [words, longPauses]);

  const plain = segments.map((s) => `[${formatClock(s.startMs)}] ${s.text}`).join("\n");

  return (
    <section aria-labelledby="transcript-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="transcript-heading" className="text-h2">
          Transcript
        </h2>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(plain);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-small text-text-secondary hover:text-text"
        >
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copied ? "Copied" : "Copy transcript"}
        </button>
      </div>
      <p className="text-small text-text-muted">
        <span className="underline decoration-warning decoration-2 underline-offset-4">Underlined words</span> are filler
        words. Markers like “2.4 s pause” show long pauses.
      </p>
      <ol className="flex max-w-[68ch] flex-col gap-4">
        {segments.map((seg) => {
          const segWords = bySegment.get(seg.seq) ?? [];
          return (
            <li key={seg.seq} className="flex gap-3">
              {onSeek ? (
                <button
                  type="button"
                  onClick={() => onSeek(seg.startMs)}
                  className="h-fit min-h-7 shrink-0 rounded-sm px-1 font-mono text-small text-primary-soft underline-offset-4 hover:underline"
                  aria-label={`Play from ${formatClock(seg.startMs)}`}
                >
                  {formatClock(seg.startMs)}
                </button>
              ) : (
                <span className="shrink-0 px-1 font-mono text-small text-text-muted">{formatClock(seg.startMs)}</span>
              )}
              <p className="text-text-secondary">
                {segWords.length
                  ? segWords.map((w) => {
                      const pause = pauseBefore.get(w.seq);
                      const filler = fillerSeqs.get(w.seq);
                      return (
                        <span key={w.seq}>
                          {pause ? (
                            <span className="mx-1 inline-flex items-center rounded-sm border border-border-strong px-1.5 text-caption text-text-muted">
                              {formatSeconds(pause)} pause
                            </span>
                          ) : null}
                          {filler ? (
                            <mark className="bg-transparent text-text underline decoration-warning decoration-2 underline-offset-4">
                              {w.word}
                              <span className="sr-only"> (filler)</span>
                            </mark>
                          ) : (
                            w.word
                          )}{" "}
                        </span>
                      );
                    })
                  : seg.text}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
