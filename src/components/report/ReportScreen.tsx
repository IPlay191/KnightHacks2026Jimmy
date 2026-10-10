"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Info, Lightbulb, Minus, Quote, RefreshCw, Sparkles, Target, Trash2, Trophy } from "lucide-react";
import { FillerBars } from "@/components/charts/FillerBars";
import { PaceTimeline } from "@/components/charts/PaceTimeline";
import { ScoreRing } from "@/components/charts/ScoreRing";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { CountUp } from "@/components/motion/useCountUp";
import { dur, ease, stagger } from "@/components/motion/tokens";
import { AudienceBadge } from "@/components/shared/AudienceBadge";
import { useOptionalRecordingStore } from "@/components/studio/RecordingSessionProvider";
import { Badge, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";
import { AUDIENCE_PROFILES, audienceLabel } from "@/lib/audience";
import type { Improvement } from "@/lib/coaching";
import { formatDate, formatDurationShort } from "@/lib/format";
import { scoreLabel } from "@/lib/scoring";
import { ApiError, deleteSession, retryCoaching } from "@/lib/pipeline/api-client";
import type { Audience } from "@/lib/types";
import { LocalReplay } from "./LocalReplay";
import { TranscriptPanel, type TranscriptWord } from "./TranscriptPanel";

/** Serializable report data (mirrors server ReportData). */
export interface ReportView {
  session: {
    id: string;
    title: string | null;
    goal: string | null;
    audience: Audience;
    durationMs: number;
    completedAt: string;
    timeZone: string;
    isSample: boolean;
    videoCaptured: boolean;
    asrModel: string | null;
  };
  metrics: {
    wpm: number;
    fillersPerMin: number;
    fillerCount: number;
    longPauseCount: number;
    pauseCount: number;
    longestPauseMs: number;
    readingGrade: number;
    targetWpmMin: number;
    targetWpmMax: number;
    targetGrade: number;
    durationMs: number;
    wpmTimeline: { startMs: number; endMs: number; wpm: number; words: number }[];
    pauses: { startMs: number; endMs: number }[];
    fillerBreakdown: Record<string, { count: number; confirmed: boolean }>;
  };
  scores: {
    overall: number;
    pacing: number;
    fillers: number;
    pauses: number;
    clarity: number | null;
    structure: number | null;
    audienceFit: number;
    audienceFitSource: "combined" | "readability_only";
  };
  feedback: {
    source: "llm" | "rules";
    modelId: string | null;
    payload: {
      summary: string;
      clarity: { score: number; rationale: string } | null;
      audienceFit: { score: number | null; rationale: string | null; tips: string[] };
      pacingInsight: string;
      strengths: { title: string; detail: string }[];
      improvements: Improvement[];
      practiceDrill: { title: string; instructions: string; durationMinutes: number };
    };
  };
  segments: { seq: number; startMs: number; endMs: number; text: string }[];
  words: TranscriptWord[];
  previous: { overall: number; pacing: number; fillers: number; pauses: number; clarity: number | null; audienceFit: number } | null;
}

function DeltaChip({ delta, audience }: { delta: number | null; audience: Audience }) {
  if (delta === null) {
    return <span className="text-caption text-text-muted">First {audienceLabel(audience)} session</span>;
  }
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const tone = delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-text-muted";
  const text = delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} points`;
  return (
    <span data-delta className={`inline-flex items-center gap-1 text-caption font-semibold ${tone}`}>
      <Icon aria-hidden="true" size={14} />
      {text}
      <span className="font-normal text-text-muted"> vs last {audienceLabel(audience)} session</span>
    </span>
  );
}

function SubScoreTile({
  title,
  score,
  primary,
  target,
  delta,
  audience,
  note,
  testId,
}: {
  title: string;
  score: number | null;
  primary: string;
  target: string;
  delta: number | null | undefined;
  audience: Audience;
  note?: string;
  testId: string;
}) {
  return (
    <li data-reveal data-testid={testId} className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 shadow-2">
      <h3 className="text-small text-text-secondary">{title}</h3>
      {score === null ? (
        <>
          <p className="text-h3 text-text-muted">Not available</p>
          {note ? <p className="text-caption text-text-secondary">{note}</p> : null}
        </>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="text-metric text-text">
              <CountUp value={score} />
            </span>
            <span className="text-small text-text-muted">/ 100</span>
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-border-subtle" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
          </div>
          <p className="text-small font-semibold text-text">{primary}</p>
          <p className="text-caption text-text-muted">Target: {target}</p>
          {note ? <p className="text-caption text-text-secondary">{note}</p> : null}
          {delta !== undefined ? <DeltaChip delta={delta} audience={audience} /> : null}
        </>
      )}
    </li>
  );
}

const PRIORITY_TEXT = { high: "High priority", medium: "Medium priority", low: "Low priority" } as const;

function ImprovementCard({ imp, rank }: { imp: Improvement; rank: number }) {
  return (
    <li data-reveal className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5 shadow-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary font-semibold text-on-primary">
          {rank}
        </span>
        <h3 className="text-h3">{imp.title}</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone={imp.priority === "high" ? "record" : imp.priority === "medium" ? "warning" : "neutral"}>
          {PRIORITY_TEXT[imp.priority]}
        </Badge>
        <Badge>{imp.category === "audience" ? "Audience fit" : imp.category[0]!.toUpperCase() + imp.category.slice(1)}</Badge>
      </div>
      <p className="text-text-secondary">{imp.detail}</p>
      {imp.evidenceQuote ? (
        <blockquote className="flex gap-2 rounded-md border-l-4 border-border-strong bg-surface-raised px-3 py-2 text-small text-text-secondary">
          <Quote aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="sr-only">You said: </span>“{imp.evidenceQuote}”
          </span>
        </blockquote>
      ) : null}
      {imp.suggestedRewrite ? (
        <p className="rounded-md border-l-4 border-success bg-surface-raised px-3 py-2 text-small text-text">
          <span className="font-semibold text-success">Try: </span>
          {imp.suggestedRewrite}
        </p>
      ) : null}
    </li>
  );
}

/** Session report dashboard (R10, R11, R20.7–20.8). */
export function ReportScreen({ report }: { report: ReportView }) {
  const router = useRouter();
  const announce = useAnnounce();
  const store = useOptionalRecordingStore();
  const { reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { session: s, metrics: m, scores: sc, feedback: f, previous: prev } = report;
  const local = store?.recording?.sessionId === s.id ? store.recording : null;
  const videoUrl = local?.videoUrl ?? null;
  const profile = AUDIENCE_PROFILES[s.audience];
  const longPauses = m.pauses.filter((p) => p.endMs - p.startMs >= 2000);
  const fillerTimes = report.words
    .filter((w) => w.fillerStatus === "unambiguous" || w.fillerStatus === "confirmed")
    .map((w) => w.startMs);
  const minutes = Math.max(1 / 60, m.durationMs / 60000);
  const d = (cur: number | null, p: number | null | undefined) =>
    prev ? (cur === null || p === null || p === undefined ? undefined : cur - p) : null;

  useGSAP(
    () => {
      registerGsap();
      const items = gsap.utils.toArray<HTMLElement>("[data-reveal]", rootRef.current);
      if (!items.length) return;
      if (reduced) {
        gsap.set(items, { opacity: 1, y: 0 });
        return;
      }
      gsap.set(items, { opacity: 0, y: 16 });
      const triggers = ScrollTrigger.batch(items, {
        start: "top 92%",
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: dur.base, ease: ease.enter, stagger: stagger.list }),
      });
      return () => triggers.forEach((t) => t.kill());
    },
    { scope: rootRef, dependencies: [reduced] },
  );

  const seek = videoUrl
    ? (ms: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = ms / 1000;
        void v.play().catch(() => undefined);
        v.focus();
      }
    : undefined;

  const fitNote =
    sc.audienceFitSource === "readability_only"
      ? "Based on reading level only, because AI coaching wasn't available."
      : "Approximate reading level, combined with AI judgment.";

  return (
    <div ref={rootRef} className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <AudienceBadge audience={s.audience} />
            {s.isSample ? <Badge tone="warning">Sample</Badge> : null}
          </div>
          <h1 className="text-h1">{s.title ?? "Practice session"}</h1>
          <p className="mt-1 text-text-secondary">
            {formatDate(s.completedAt, s.timeZone)} · {formatDurationShort(s.durationMs)}
            {s.goal ? ` · ${s.goal}` : ""}
          </p>
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="ghost" icon={<Trash2 size={18} />}>
              Delete session
            </Button>
          }
          title="Delete this session?"
          description="Its transcript, scores, and coaching will be permanently removed and your progress stats updated."
          confirmLabel="Delete session"
          onConfirm={async () => {
            try {
              await deleteSession(s.id);
              announce("Session deleted.");
              router.push("/history");
              router.refresh();
            } catch {
              announce("Couldn't delete the session. Try again.", { assertive: true });
            }
          }}
        />
      </div>

      <section aria-labelledby="score-heading" className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <h2 id="score-heading" className="sr-only">
          Overall score
        </h2>
        <ScoreRing score={sc.overall} />
        <div className="flex max-w-[68ch] flex-col gap-3">
          <p className="text-body-l text-text">{f.payload.summary}</p>
          <p className="text-text-secondary">{f.payload.pacingInsight}</p>
          <p className="flex flex-wrap items-center gap-2 text-small text-text-muted">
            <Bot aria-hidden="true" size={16} />
            {f.source === "llm" && f.modelId
              ? `Coached by ${f.modelId}${s.asrModel ? ` · Transcribed with ${s.asrModel}` : ""}`
              : `Rule-based tips${s.asrModel ? ` · Transcribed with ${s.asrModel}` : ""}`}
          </p>
          {prev ? (
            <p>
              <DeltaChip delta={sc.overall - prev.overall} audience={s.audience} />
            </p>
          ) : null}
          {f.source === "rules" ? (
            <div className="rounded-md border border-warning px-4 py-3" data-testid="rules-notice">
              <p className="text-small text-warning">
                AI coaching was unavailable for this session, so these tips come from your delivery numbers.
              </p>
              {!s.isSample ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw size={16} />}
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    setRetryError(null);
                    try {
                      const r = await retryCoaching(s.id);
                      if (r.feedbackSource === "llm") {
                        announce("AI coaching added.");
                        router.refresh();
                      } else {
                        setRetryError("AI coaching is still unavailable. Try again in a minute.");
                      }
                    } catch (err) {
                      setRetryError(err instanceof ApiError ? err.message : "Something went wrong.");
                    } finally {
                      setRetrying(false);
                    }
                  }}
                >
                  {retrying ? "Retrying…" : "Retry AI coaching"}
                </Button>
              ) : null}
              {retryError ? (
                <p role="alert" className="mt-2 text-small text-danger">
                  {retryError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="tiles-heading">
        <h2 id="tiles-heading" className="sr-only">
          Score breakdown
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SubScoreTile
            testId="tile-pacing"
            title="Pacing"
            score={sc.pacing}
            primary={`${Math.round(m.wpm)} WPM`}
            target={`${m.targetWpmMin}–${m.targetWpmMax} WPM`}
            delta={d(sc.pacing, prev?.pacing)}
            audience={s.audience}
          />
          <SubScoreTile
            testId="tile-fillers"
            title="Filler words"
            score={sc.fillers}
            primary={`${m.fillersPerMin.toFixed(1)} fillers/min`}
            target="Under 2 per minute"
            delta={d(sc.fillers, prev?.fillers)}
            audience={s.audience}
          />
          <SubScoreTile
            testId="tile-pauses"
            title="Pauses"
            score={sc.pauses}
            primary={`${m.longPauseCount} long pause${m.longPauseCount === 1 ? "" : "s"} (${(m.longPauseCount / minutes).toFixed(1)}/min)`}
            target={`${profile.longPauseTolerancePerMin} or fewer per minute`}
            delta={d(sc.pauses, prev?.pauses)}
            audience={s.audience}
          />
          <SubScoreTile
            testId="tile-clarity"
            title="Clarity"
            score={sc.clarity}
            primary={sc.clarity !== null ? scoreLabel(sc.clarity) : ""}
            target="70 or higher"
            delta={d(sc.clarity, prev?.clarity)}
            audience={s.audience}
            note={
              sc.clarity === null
                ? "Clarity needs AI coaching, which wasn't available for this session."
                : f.payload.clarity?.rationale
            }
          />
          <SubScoreTile
            testId="tile-audience"
            title="Audience fit"
            score={sc.audienceFit}
            primary={`Grade ${m.readingGrade.toFixed(1)} · target ≤ ${m.targetGrade}`}
            target={`${profile.label} audience (${profile.ageRange})`}
            delta={d(sc.audienceFit, prev?.audienceFit)}
            audience={s.audience}
            note={fitNote}
          />
        </ul>
      </section>

      <section aria-labelledby="top-heading" className="flex flex-col gap-4">
        <h2 id="top-heading" className="flex items-center gap-2 text-h2">
          <Target aria-hidden="true" className="text-primary-soft" /> Top 3 things to work on
        </h2>
        <ol className="grid gap-4 lg:grid-cols-3">
          {f.payload.improvements.slice(0, 3).map((imp, i) => (
            <ImprovementCard key={`${imp.title}-${i}`} imp={imp} rank={i + 1} />
          ))}
        </ol>
        {f.payload.audienceFit.tips.length ? (
          <Card data-reveal className="mt-2" aria-labelledby="aud-tips-heading">
            <h3 id="aud-tips-heading" className="flex items-center gap-2 text-h3">
              <Lightbulb aria-hidden="true" className="text-warning" /> Tips for a {profile.label.toLowerCase()} audience
            </h3>
            {f.payload.audienceFit.rationale ? (
              <p className="mt-2 text-text-secondary">{f.payload.audienceFit.rationale}</p>
            ) : null}
            <ul className="mt-3 list-disc space-y-1 pl-5 text-text-secondary">
              {f.payload.audienceFit.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7" data-reveal>
          <PaceTimeline
            windows={m.wpmTimeline}
            durationMs={m.durationMs}
            targetMin={m.targetWpmMin}
            targetMax={m.targetWpmMax}
            longPauses={longPauses}
            fillerTimesMs={fillerTimes}
          />
        </Card>
        <Card className="lg:col-span-5" data-reveal>
          <FillerBars breakdown={m.fillerBreakdown} perMin={m.fillersPerMin} />
          <p className="mt-4 flex items-start gap-2 text-caption text-text-muted" data-testid="filler-notice">
            <Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
            Filler counts may be lower than actual. Speech recognition can skip “um” and “uh”. Pauses are measured directly
            from your audio.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-reveal aria-labelledby="strengths-heading">
          <h2 id="strengths-heading" className="flex items-center gap-2 text-h2">
            <Trophy aria-hidden="true" className="text-success" /> Strengths
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {f.payload.strengths.map((st) => (
              <li key={st.title}>
                <h3 className="font-semibold text-text">{st.title}</h3>
                <p className="text-text-secondary">{st.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card data-reveal aria-labelledby="drill-heading">
          <h2 id="drill-heading" className="flex items-center gap-2 text-h2">
            <Sparkles aria-hidden="true" className="text-primary-soft" /> Practice drill
          </h2>
          <h3 className="mt-4 font-semibold text-text">
            {f.payload.practiceDrill.title}{" "}
            <span className="font-normal text-text-muted">· {f.payload.practiceDrill.durationMinutes} min</span>
          </h3>
          <p className="mt-1 text-text-secondary">{f.payload.practiceDrill.instructions}</p>
        </Card>
      </div>

      <Card aria-label="Replay and transcript">
        <div className="flex flex-col gap-6">
          <LocalReplay ref={videoRef} videoUrl={videoUrl} segments={report.segments} />
          <TranscriptPanel segments={report.segments} words={report.words} longPauses={longPauses} onSeek={seek} />
        </div>
      </Card>
    </div>
  );
}
