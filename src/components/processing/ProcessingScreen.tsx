"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, RotateCcw, WifiOff, XCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";
import { gsap, registerGsap, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { dur, ease, stagger } from "@/components/motion/tokens";
import { useRecordingStore } from "@/components/studio/RecordingSessionProvider";
import { STAGE_KEYS, usePipeline, type StageKey, type StageStatus } from "@/lib/pipeline/usePipeline";

const STAGE_LABELS: Record<StageKey, string> = {
  prepare: "Preparing audio",
  transcribe: "Transcribing",
  metrics: "Measuring pace & pauses",
  coaching: "Writing your coaching",
  saving: "Building your report",
};

const STATUS_TEXT: Record<StageStatus, string> = {
  pending: "Waiting",
  active: "In progress",
  done: "Done",
  failed: "Failed",
};

const REASSURANCE: Partial<Record<StageKey, string>> = {
  transcribe: "Whisper is warming up. The first transcription can take up to a minute.",
  coaching: "The AI model is warming up. This can take up to a minute the first time.",
};

/** Staged progress for one session (R9). */
export function ProcessingScreen({ sessionId, autoAdvance }: { sessionId: string; autoAdvance: boolean }) {
  const router = useRouter();
  const store = useRecordingStore();
  const announce = useAnnounce();
  const { reduced } = useMotion();
  const recording = store.get(sessionId);
  const { view, retry } = usePipeline(sessionId, recording?.chunks.length ? recording.chunks : null, () =>
    store.releaseAudio(sessionId),
  );
  const listRef = useRef<HTMLOListElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const announced = useRef<string>("");
  // Holds the stageSince value of the stage that has been active for 20 s.
  const [slowStage, setSlowStage] = useState<number | null>(null);
  const slow = view.phase === "running" && view.stageSince > 0 && slowStage === view.stageSince;

  // Announce each stage once (R9.3).
  useEffect(() => {
    const key = view.phase === "running" && view.activeStage ? `stage:${view.activeStage}` : `phase:${view.phase}`;
    if (key === announced.current) return;
    announced.current = key;
    if (view.phase === "running" && view.activeStage) announce(`${STAGE_LABELS[view.activeStage]}.`);
    if (view.phase === "complete") {
      announce("Your report is ready.");
      requestAnimationFrame(() => doneRef.current?.focus());
    }
    if (view.phase === "failed" && view.error) {
      announce(`${STAGE_LABELS[view.error.stage]} failed. ${view.error.message}`, { assertive: true });
      requestAnimationFrame(() => errorRef.current?.focus());
    }
    if (view.phase === "interrupted") {
      announce("Upload interrupted. Please record again.", { assertive: true });
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }, [view.phase, view.activeStage, view.error, announce]);

  // Reassurance after 20 s on one stage (R9.5).
  useEffect(() => {
    if (view.phase !== "running" || view.stageSince <= 0) return;
    const since = view.stageSince;
    const wait = Math.max(0, 20_000 - (Date.now() - since));
    const t = setTimeout(() => setSlowStage(since), wait);
    return () => clearTimeout(t);
  }, [view.stageSince, view.phase]);

  // Auto-advance unless reduced motion or the user turned it off (R9.6).
  useEffect(() => {
    if (view.phase !== "complete" || reduced || !autoAdvance) return;
    const t = setTimeout(() => router.push(`/sessions/${sessionId}`), 1500);
    return () => clearTimeout(t);
  }, [view.phase, reduced, autoAdvance, router, sessionId]);

  useGSAP(
    () => {
      registerGsap();
      const rows = listRef.current?.querySelectorAll("[data-row]");
      if (!rows?.length) return;
      if (reduced) gsap.set(rows, { opacity: 1 });
      else gsap.from(rows, { opacity: 0, y: 10, duration: dur.base, stagger: stagger.list, ease: ease.enter });
    },
    { scope: listRef, dependencies: [reduced] },
  );

  const progress =
    view.chunksExpected > 0 ? Math.min(1, view.chunksDone / view.chunksExpected) : view.phase === "complete" ? 1 : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-h1">Analyzing your speech</h1>
      <p className="mt-2 text-text-secondary">
        Keep this tab open. Your audio is being transcribed by Whisper and reviewed by an open-source coach model.
      </p>

      {view.connectionLost ? (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-md border border-warning px-3 py-2 text-small text-warning">
          <WifiOff aria-hidden="true" size={16} /> Connection lost, still trying…
        </p>
      ) : null}

      <Card className="mt-6">
        <ol ref={listRef} className="flex flex-col gap-1" aria-label="Processing stages">
          {STAGE_KEYS.map((key) => (
            <StageRow
              key={key}
              label={STAGE_LABELS[key]}
              status={key === "prepare" ? "done" : view.stages[key]}
              detail={
                key === "transcribe" && view.chunksExpected > 0
                  ? `Part ${Math.min(view.chunksDone + (view.stages.transcribe === "active" ? 1 : 0), view.chunksExpected)} of ${view.chunksExpected}`
                  : undefined
              }
              progress={key === "transcribe" ? progress : undefined}
            />
          ))}
        </ol>
        {slow && view.phase === "running" && view.activeStage ? (
          <p className="mt-4 rounded-md bg-surface-raised px-3 py-2 text-small text-text-secondary" data-testid="reassurance">
            {REASSURANCE[view.activeStage] ?? "Still working. Thanks for your patience."}
          </p>
        ) : null}
      </Card>

      {view.phase === "complete" ? (
        <Card className="mt-6" data-testid="processing-complete">
          <h2 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 text-h2 outline-none">
            <CheckCircle2 aria-hidden="true" className="text-success" /> Your report is ready
          </h2>
          <p className="mt-2 text-text-secondary">
            {autoAdvance && !reduced ? "Opening your report…" : "Open your report to see your scores and coaching."}
          </p>
          <ButtonLink href={`/sessions/${sessionId}`} className="mt-4">
            View your report
          </ButtonLink>
        </Card>
      ) : null}

      {view.phase === "failed" && view.error ? (
        <Card className="mt-6" data-testid="processing-error">
          <div role="alert">
            <h2 ref={errorRef} tabIndex={-1} className="flex items-center gap-2 text-h2 outline-none">
              <AlertCircle aria-hidden="true" className="text-danger" /> {STAGE_LABELS[view.error.stage]} failed
            </h2>
            <p className="mt-2 text-text-secondary">{view.error.message}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {view.error.action === "retry" && (view.error.stage !== "transcribe" || recording?.chunks.length) ? (
              <Button onClick={() => void retry()} icon={<RotateCcw size={18} />}>
                Retry
              </Button>
            ) : null}
            <ButtonLink href="/studio" variant={view.error.action === "retry" ? "secondary" : "primary"}>
              Record again
            </ButtonLink>
          </div>
        </Card>
      ) : null}

      {view.phase === "interrupted" ? (
        <Card className="mt-6" data-testid="processing-interrupted">
          <h2 ref={errorRef} tabIndex={-1} className="text-h2 outline-none">
            Upload interrupted, record again
          </h2>
          <p className="mt-2 text-text-secondary">
            Part of your recording didn&apos;t finish uploading, and the audio is no longer in this tab. Please record again.
          </p>
          <ButtonLink href="/studio" className="mt-4">
            Record again
          </ButtonLink>
        </Card>
      ) : null}

      <p className="mt-6 text-small text-text-muted">
        Want to look around while you wait? <Link className="text-primary-soft underline" href="/history">View your history</Link>
      </p>
    </div>
  );
}

function StageRow({
  label,
  status,
  detail,
  progress,
}: {
  label: string;
  status: StageStatus;
  detail?: string;
  progress?: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const { reduced } = useMotion();
  useGSAP(
    () => {
      registerGsap();
      if (barRef.current && progress !== undefined) {
        if (reduced) gsap.set(barRef.current, { scaleX: progress });
        else gsap.to(barRef.current, { scaleX: progress, duration: 0.6, ease: ease.standard });
      }
      const icon = rowRef.current?.querySelector("[data-icon]");
      if (icon && !reduced && (status === "done" || status === "active")) {
        gsap.fromTo(icon, { scale: 0.6 }, { scale: 1, duration: 0.3, ease: ease.springy });
      }
    },
    { scope: rowRef, dependencies: [progress, status, reduced] },
  );
  const Icon = status === "done" ? CheckCircle2 : status === "failed" ? XCircle : status === "active" ? Loader2 : Circle;
  const color =
    status === "done" ? "text-success" : status === "failed" ? "text-danger" : status === "active" ? "text-primary-soft" : "text-text-muted";
  return (
    <li ref={rowRef} data-row className="flex flex-col gap-2 rounded-md px-2 py-3" aria-current={status === "active" ? "step" : undefined}>
      <div className="flex items-center gap-3">
        <span data-icon className={`inline-flex ${color}`}>
          <Icon aria-hidden="true" size={22} className={status === "active" ? "motion-safe:animate-spin" : ""} />
        </span>
        <span className={`flex-1 font-semibold ${status === "pending" ? "text-text-muted" : "text-text"}`}>{label}</span>
        <span className={`text-small ${color}`}>
          {STATUS_TEXT[status]}
          {detail && status === "active" ? <span className="text-text-muted"> · {detail}</span> : null}
        </span>
      </div>
      {progress !== undefined && (status === "active" || status === "done") ? (
        <div className="ml-9 h-1.5 overflow-hidden rounded-full bg-border-subtle" aria-hidden="true">
          <div ref={barRef} className="h-full origin-left rounded-full bg-primary" style={{ transform: "scaleX(0)" }} />
        </div>
      ) : null}
    </li>
  );
}
