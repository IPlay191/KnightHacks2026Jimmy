"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";
import { TextArea, TextField } from "@/components/ui/TextField";
import { AudienceRadioGroup } from "@/components/shared/AudienceRadioGroup";
import { gsap, registerGsap, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { dur, ease } from "@/components/motion/tokens";
import { formatDurationWords } from "@/lib/format";
import { MAX_RECORDING_MS, MIN_RECORDING_MS, WARNING_MS, type StudioState } from "@/lib/studio/machine";
import { useStudioMachine, type SpeechDetails } from "@/lib/studio/useStudioMachine";
import { BACKGROUNDS } from "@/lib/studio/backgrounds";
import { useCameraBackground } from "@/lib/studio/useCameraBackground";
import { BackgroundPicker } from "./BackgroundPicker";
import type { Audience } from "@/lib/types";
import { CameraPreview } from "./CameraPreview";
import { Countdown } from "./Countdown";
import { DevicePicker } from "./DevicePicker";
import { LevelMeter } from "./LevelMeter";
import { PermissionExplainer, PermissionRecovery, UnsupportedPanel } from "./PermissionPanels";
import { RecordControl, type RecordMode } from "./RecordControl";
import { useRecordingStore } from "./RecordingSessionProvider";
import { RecordingBadge, RecordingTimer } from "./RecordingStatus";

const ANNOUNCE: Partial<Record<StudioState["kind"], string>> = {
  explainer: "Camera and microphone setup. Choose Enable camera and mic to continue.",
  countdown: "Recording starts in 3 seconds. Press Escape to cancel.",
  recording: "Recording started.",
  paused: "Paused.",
  finalizing: "Recording stopped. Preparing audio.",
  submitting: "Uploading your speech.",
};

/** Recording studio (R2–R5, R16.5–16.7, R20.2). */
export function StudioScreen({ defaultAudience }: { defaultAudience: Audience }) {
  const router = useRouter();
  const store = useRecordingStore();
  const announce = useAnnounce();
  const { reduced } = useMotion();
  const [details, setDetails] = useState<SpeechDetails>({ title: "", goal: "", audience: defaultAudience });
  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const bgTrackRef = useRef<MediaStreamTrack | null>(null);
  const { state, actions, stream, analyser, devices, prefs, elapsed, warning } = useStudioMachine({
    getDetails: () => detailsRef.current,
    onSubmitted: ({ sessionId, recording, videoUrl }) => {
      store.save({ sessionId, chunks: recording.chunks, videoUrl });
      router.push(`/sessions/${sessionId}/processing`);
    },
    onNotice: (m) => announce(m),
    getVideoTrack: () => bgTrackRef.current,
  });
  const stateAudioOnly = "audioOnly" in state ? state.audioOnly : false;
  const bg = useCameraBackground(stream, !stateAudioOnly);
  useEffect(() => {
    bgTrackRef.current = bg.track;
  }, [bg.track]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const controlRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const prevKind = useRef<StudioState["kind"]>(state.kind);
  const minuteRef = useRef(0);

  // Announcements and focus on state entry (R16.5, R16.7).
  useEffect(() => {
    const from = prevKind.current;
    const kind = state.kind;
    if (from === kind) return;
    prevKind.current = kind;
    if (kind === "ready") {
      announce(from === "countdown" ? "Countdown cancelled." : state.audioOnly ? "Microphone ready." : "Camera and microphone ready.");
      requestAnimationFrame(() => controlRef.current?.focus());
    } else if (kind === "recording" && from === "paused") {
      announce("Resumed.");
    } else if (kind === "denied" || kind === "unsupported" || kind === "submitError") {
      announce(
        kind === "submitError" ? "We couldn't start your upload." : "Camera or microphone isn't available. See the recovery options.",
        { assertive: true },
      );
      requestAnimationFrame(() => headingRef.current?.focus());
    } else if (kind === "tooShort") {
      announce("Recording too short. At least 10 seconds are needed.");
      requestAnimationFrame(() => againRef.current?.focus());
    } else if (kind === "interrupted") {
      announce("Your microphone disconnected and recording stopped.", { assertive: true });
      requestAnimationFrame(() => headingRef.current?.focus());
    } else {
      const msg = ANNOUNCE[kind];
      if (msg) announce(msg);
      if (kind === "explainer") requestAnimationFrame(() => headingRef.current?.focus());
      if (kind === "countdown") requestAnimationFrame(() => controlRef.current?.focus());
    }
    if (kind === "recording" && from === "countdown") minuteRef.current = 0;
  }, [state, announce]);

  // Minute milestones and the 30-second warning (R4.5, R16.6).
  useEffect(() => {
    if (state.kind !== "recording") return;
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes > minuteRef.current && elapsed < WARNING_MS) {
      minuteRef.current = minutes;
      announce(`${formatDurationWords(minutes * 60_000)} recorded.`);
    }
  }, [elapsed, state.kind, announce]);

  const warned = useRef(false);
  useEffect(() => {
    if (warning && !warned.current) {
      warned.current = true;
      announce("30 seconds remaining.");
    }
    if (!warning) warned.current = false;
  }, [warning, announce]);

  // Escape cancels the countdown (R4.2).
  useEffect(() => {
    if (state.kind !== "countdown") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") actions.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind, actions]);

  // Panel transition (R15.3, R15.7).
  useGSAP(
    () => {
      registerGsap();
      if (!stageRef.current) return;
      if (reduced) gsap.fromTo(stageRef.current, { opacity: 0.6 }, { opacity: 1, duration: dur.reducedFade });
      else gsap.fromTo(stageRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: dur.base, ease: ease.enter });
    },
    { dependencies: [state.kind === "explainer" || state.kind === "denied" ? "setup" : "stage", reduced], scope: stageRef },
  );

  const onPrimary = useCallback(() => {
    if (state.kind === "ready") actions.start();
    else if (state.kind === "countdown") actions.cancel();
    else if (state.kind === "recording" || state.kind === "paused") actions.stop();
  }, [state.kind, actions]);

  const setupKinds: StudioState["kind"][] = ["checking", "explainer", "denied", "unsupported"];
  if (setupKinds.includes(state.kind) || (state.kind === "acquiring" && !stream)) {
    return (
      <div ref={stageRef}>
        <StudioHeader />
        <div className="mt-8">
          {state.kind === "unsupported" ? (
            <UnsupportedPanel ref={headingRef} reason={state.reason} />
          ) : state.kind === "denied" ? (
            <PermissionRecovery
              ref={headingRef}
              reason={state.reason}
              canUseMicOnly={state.canUseMicOnly}
              onRetry={actions.retry}
              onMicOnly={actions.micOnly}
            />
          ) : state.kind === "checking" ? (
            <p className="flex items-center gap-2 text-text-secondary" role="status">
              <Loader2 aria-hidden="true" className="motion-safe:animate-spin" size={18} /> Checking your browser…
            </p>
          ) : (
            <PermissionExplainer ref={headingRef} onEnable={actions.enable} waiting={state.kind === "acquiring"} />
          )}
        </div>
      </div>
    );
  }

  const live = state.kind === "recording" || state.kind === "paused";
  const mode: RecordMode = state.kind === "countdown" ? "countdown" : live ? "recording" : "ready";
  const audioOnly = "audioOnly" in state ? state.audioOnly : false;
  const busy = state.kind === "finalizing" || state.kind === "submitting" || state.kind === "submitted";
  const lockedDetails = live || state.kind === "countdown" || busy;

  return (
    <div ref={stageRef}>
      <StudioHeader />
      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section aria-labelledby="stage-heading" className="lg:col-span-8">
          <h2 id="stage-heading" className="sr-only">
            Recording stage
          </h2>
          <Card className="relative overflow-hidden p-3 sm:p-4">
            <div className="relative">
              <CameraPreview
                stream={stream}
                audioOnly={audioOnly}
                backgroundStatus={bg.status}
                backgroundLabel={BACKGROUNDS[bg.background].label}
                attachBackground={bg.attachPreview}
              />
              {state.kind === "countdown" ? <Countdown remaining={state.remaining} /> : null}
              {live ? (
                <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
                  <RecordingBadge paused={state.kind === "paused"} />
                  <RecordingTimer elapsedMs={elapsed} warning={warning} />
                </div>
              ) : null}
              {warning && live ? (
                <p className="absolute bottom-3 left-3 right-3 rounded-md border border-warning bg-canvas/90 px-3 py-2 text-small text-warning">
                  <AlertTriangle aria-hidden="true" size={16} className="mr-1 inline" /> 30 seconds left. Recording stops
                  automatically at 5:00.
                </p>
              ) : null}
            </div>
            <div className="mt-4">
              <LevelMeter analyser={analyser} active={Boolean(analyser) && !busy} showStatus={state.kind === "ready"} />
            </div>
            <div className="mt-6 flex flex-wrap items-end justify-center gap-6">
              {live ? (
                state.kind === "paused" ? (
                  <Button variant="secondary" onClick={actions.resume} icon={<Play size={18} />} aria-pressed={true}>
                    Resume
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={actions.pause} icon={<Pause size={18} />} aria-pressed={false}>
                    Pause
                  </Button>
                )
              ) : null}
              <RecordControl
                ref={controlRef}
                mode={mode}
                onPress={onPrimary}
                disabled={busy || state.kind === "acquiring" || state.kind === "tooShort" || state.kind === "interrupted" || state.kind === "submitError"}
              />
              {live ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" icon={<Trash2 size={18} />}>
                      Discard
                    </Button>
                  }
                  title="Discard this recording?"
                  description="Everything recorded in this take will be deleted. This can't be undone."
                  confirmLabel="Discard recording"
                  onConfirm={async () => {
                    await actions.discard();
                    announce("Recording discarded.");
                  }}
                />
              ) : null}
            </div>
            <p className="mt-4 text-center text-caption text-text-muted">
              Record between {MIN_RECORDING_MS / 1000} seconds and {MAX_RECORDING_MS / 60_000} minutes.
            </p>
          </Card>
          <StudioStatusPanel state={state} actions={actions} headingRef={headingRef} againRef={againRef} />
        </section>

        <aside aria-label="Recording setup" className="flex flex-col gap-6 lg:col-span-4">
          <Card>
            <h2 className="text-h3">Your speech</h2>
            <div className="mt-4 flex flex-col gap-4">
              <TextField
                label="Speech title (optional)"
                maxLength={80}
                value={details.title}
                disabled={lockedDetails}
                onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))}
                placeholder="Demo day pitch"
              />
              <TextArea
                label="What is this speech for? (optional)"
                maxLength={200}
                value={details.goal}
                disabled={lockedDetails}
                onChange={(e) => setDetails((d) => ({ ...d, goal: e.target.value }))}
                placeholder="A 2-minute pitch for hackathon judges"
              />
              <AudienceRadioGroup
                legend="Who is this speech for?"
                value={details.audience}
                disabled={lockedDetails}
                onChange={(audience) => setDetails((d) => ({ ...d, audience }))}
              />
            </div>
          </Card>
          <Card>
            <h2 className="text-h3">Devices</h2>
            <div className="mt-4 flex flex-col gap-4">
              {!audioOnly ? (
                <DevicePicker
                  label="Camera"
                  devices={devices.video}
                  value={prefs.videoId}
                  disabled={state.kind !== "ready"}
                  onChange={(id) => actions.selectDevice("video", id)}
                />
              ) : null}
              <DevicePicker
                label="Microphone"
                devices={devices.audio}
                value={prefs.audioId}
                disabled={state.kind !== "ready"}
                onChange={(id) => actions.selectDevice("audio", id)}
              />
            </div>
          </Card>
          {!audioOnly ? (
            <Card>
              <h2 className="text-h3">Background</h2>
              <div className="mt-3">
                <BackgroundPicker
                  value={bg.background}
                  onChange={(id) => {
                    bg.setBackground(id);
                    announce(id === "none" ? "Background removed." : `${BACKGROUNDS[id].label} background selected.`);
                  }}
                  disabled={state.kind !== "ready"}
                  status={bg.status}
                />
              </div>
            </Card>
          ) : null}
          <Card>
            <h2 className="text-h3">Tips</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-small text-text-secondary">
              <li>Sit about an arm&apos;s length from your microphone.</li>
              <li>Speak as if your audience is in the room.</li>
              <li>Pause on purpose instead of saying “um”.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StudioHeader() {
  return (
    <div>
      <h1 className="text-h1">Studio</h1>
      <p className="mt-2 max-w-[68ch] text-text-secondary">
        Check your devices, choose your audience, and record a practice speech. You&apos;ll get coaching in under a minute.
      </p>
    </div>
  );
}

function StudioStatusPanel({
  state,
  actions,
  headingRef,
  againRef,
}: {
  state: StudioState;
  actions: ReturnType<typeof useStudioMachine>["actions"];
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  againRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (state.kind === "finalizing" || state.kind === "submitting" || state.kind === "submitted") {
    return (
      <Card className="mt-6" aria-live="polite">
        <p className="flex items-center gap-3 text-text">
          <Loader2 aria-hidden="true" className="text-primary-soft motion-safe:animate-spin" />
          {state.kind === "finalizing" ? "Preparing audio…" : "Starting your analysis…"}
        </p>
      </Card>
    );
  }
  if (state.kind === "tooShort") {
    return (
      <Card className="mt-6" data-testid="too-short">
        <h2 className="text-h3">That take was too short</h2>
        <p className="mt-2 text-text-secondary">
          You recorded {formatDurationWords(state.capturedMs)}. At least 10 seconds are needed for useful feedback. Nothing
          was uploaded.
        </p>
        <Button ref={againRef} className="mt-4" onClick={actions.recordAgain} icon={<RotateCcw size={18} />}>
          Record again
        </Button>
      </Card>
    );
  }
  if (state.kind === "interrupted") {
    const enough = state.capturedMs >= MIN_RECORDING_MS;
    return (
      <Card className="mt-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-h3 outline-none">
          Your microphone disconnected
        </h2>
        <p className="mt-2 text-text-secondary">
          We kept the {formatDurationWords(state.capturedMs)} recorded so far.
          {enough ? " You can analyze it now or start over." : " That's not enough to analyze, so please record again."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {enough ? <Button onClick={actions.analyzePartial}>Analyze what I have</Button> : null}
          <Button variant={enough ? "secondary" : "primary"} onClick={actions.recordAgain} icon={<RotateCcw size={18} />}>
            Record again
          </Button>
        </div>
      </Card>
    );
  }
  if (state.kind === "submitError") {
    return (
      <Card className="mt-6">
        <div role="alert">
          <h2 ref={headingRef} tabIndex={-1} className="text-h3 outline-none">
            We couldn&apos;t start your analysis
          </h2>
          <p className="mt-2 text-text-secondary">{state.message}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {state.retryable ? <Button onClick={actions.retrySubmit}>Retry</Button> : null}
          <Button variant="secondary" onClick={actions.recordAgain} icon={<RotateCcw size={18} />}>
            Record again
          </Button>
        </div>
      </Card>
    );
  }
  return null;
}
