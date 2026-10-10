"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { PcmCapture } from "@/lib/audio/capture";
import { prepareRecording, type PreparedRecording } from "@/lib/audio/prepare";
import { ApiError, createSession } from "@/lib/pipeline/api-client";
import type { Audience } from "@/lib/types";
import {
  elapsedMs,
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
  WARNING_MS,
  transition,
  type StudioEvent,
  type StudioState,
} from "./machine";
import {
  acquireStream,
  checkSupport,
  listDevices,
  loadDevicePrefs,
  MediaAcquireError,
  pickVideoMime,
  queryPermission,
  saveDevicePrefs,
  stopStream,
  type DeviceLists,
  type DevicePrefs,
} from "./media";

export interface SpeechDetails {
  title: string;
  goal: string;
  audience: Audience;
}

export interface SubmittedRecording {
  sessionId: string;
  recording: PreparedRecording;
  videoUrl: string | null;
}

interface Options {
  getDetails: () => SpeechDetails;
  onSubmitted: (result: SubmittedRecording) => void;
  onNotice?: (message: string) => void;
}

/** Side-effect host for the pure studio machine (design §10.4–10.5). */
export function useStudioMachine({ getDetails, onSubmitted, onNotice }: Options) {
  const [state, dispatch] = useReducer(transition, { kind: "checking" } as StudioState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const send = useCallback((e: StudioEvent) => dispatch(e), []);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [devices, setDevices] = useState<DeviceLists>({ audio: [], video: [] });
  const [prefs, setPrefs] = useState<DevicePrefs>({});
  const [now, setNow] = useState(() => performance.now());

  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<PcmCapture | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const preparedRef = useRef<PreparedRecording | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const callbacks = useRef({ getDetails, onSubmitted, onNotice });
  useEffect(() => {
    callbacks.current = { getDetails, onSubmitted, onNotice };
  }, [getDetails, onSubmitted, onNotice]);

  const releaseMedia = useCallback(async () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setAnalyser(null);
    await captureRef.current?.close();
  }, []);

  // 1. Support + permission check on mount (R2.1, R2.2, R2.8).
  useEffect(() => {
    const unsupported = checkSupport(PcmCapture.isSupported());
    if (unsupported) {
      send({ type: "SUPPORT_FAIL", reason: unsupported });
      return;
    }
    void queryPermission().then((p) => {
      setPrefs(loadDevicePrefs());
      send({ type: p === "granted" ? "PERMISSION_GRANTED" : "PERMISSION_UNKNOWN" });
    });
    return () => {
      stopStream(streamRef.current);
      void captureRef.current?.close();
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    };
  }, [send]);

  // 2. Acquire media on entering `acquiring` (R2.3–2.7).
  useEffect(() => {
    if (state.kind !== "acquiring") return;
    let cancelled = false;
    const audioOnly = state.audioOnly;
    (async () => {
      stopStream(streamRef.current);
      streamRef.current = null;
      try {
        const s = await acquireStream({ audioOnly, prefs: loadDevicePrefs() });
        if (cancelled) {
          stopStream(s);
          return;
        }
        captureRef.current ??= new PcmCapture();
        const node = await captureRef.current.attach(s);
        if (cancelled) {
          stopStream(s);
          return;
        }
        streamRef.current = s;
        setStream(s);
        setAnalyser(node);
        setDevices(await listDevices());
        send({ type: "ACQUIRED", audioOnly: audioOnly || s.getVideoTracks().length === 0 });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof MediaAcquireError) {
          send({ type: "ACQUIRE_FAILED", reason: err.reason, canUseMicOnly: err.canUseMicOnly });
        } else {
          send({ type: "ACQUIRE_FAILED", reason: "not-readable", canUseMicOnly: !audioOnly });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, send]);

  // 3. Device list changes (R3.3).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return;
    const onChange = async () => {
      const lists = await listDevices();
      setDevices(lists);
      const s = stateRef.current;
      if (s.kind !== "ready") return;
      const current = loadDevicePrefs();
      const missingAudio = current.audioId && !lists.audio.some((d) => d.deviceId === current.audioId);
      const missingVideo = current.videoId && !lists.video.some((d) => d.deviceId === current.videoId);
      if (missingAudio || missingVideo) {
        const next = {
          audioId: missingAudio ? undefined : current.audioId,
          videoId: missingVideo ? undefined : current.videoId,
        };
        saveDevicePrefs(next);
        setPrefs(next);
        callbacks.current.onNotice?.("Your selected device was disconnected. Switched to the default device.");
        send({ type: "DEVICE_CHANGED" });
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [send]);

  // 4. Countdown ticks, then start capture (R4.2).
  useEffect(() => {
    if (state.kind !== "countdown") return;
    const timer = setTimeout(() => {
      if (state.remaining > 1) {
        send({ type: "TICK" });
        return;
      }
      const capture = captureRef.current;
      const s = streamRef.current;
      if (!capture || !s) return;
      capture.reset();
      capture.setCapturing(true);
      videoChunksRef.current = [];
      const mime = s.getVideoTracks().length ? pickVideoMime() : undefined;
      if (mime) {
        try {
          const rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) videoChunksRef.current.push(e.data);
          };
          rec.onerror = () => callbacks.current.onNotice?.("Video replay unavailable for this take.");
          rec.start(1000);
          recorderRef.current = rec;
        } catch {
          recorderRef.current = null;
        }
      }
      send({ type: "BEGIN_RECORDING", now: performance.now() });
    }, 1000);
    return () => clearTimeout(timer);
  }, [state, send]);

  // 5. Elapsed timer, 4:30 warning, 5:00 auto-stop (R4.3, R4.5, R4.6).
  useEffect(() => {
    if (state.kind !== "recording") return;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      const elapsed = elapsedMs(stateRef.current, t);
      if (elapsed >= MAX_RECORDING_MS) send({ type: "STOP" });
    }, 250);
    return () => clearInterval(id);
  }, [state.kind, send]);

  // 6. Microphone track ending mid-recording (R4.10).
  useEffect(() => {
    if (state.kind !== "recording" && state.kind !== "paused") return;
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const onEnded = () => send({ type: "TRACK_ENDED", capturedMs: captureRef.current?.capturedMs ?? 0 });
    track.addEventListener("ended", onEnded);
    return () => track.removeEventListener("ended", onEnded);
  }, [state.kind, send]);

  const stopRecorder = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return null;
    if (rec.state === "inactive") {
      return videoChunksRef.current.length ? new Blob(videoChunksRef.current, { type: rec.mimeType }) : null;
    }
    return new Promise((resolve) => {
      rec.onstop = () =>
        resolve(videoChunksRef.current.length ? new Blob(videoChunksRef.current, { type: rec.mimeType }) : null);
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }, []);

  const submit = useCallback(async () => {
    const prepared = preparedRef.current;
    if (!prepared) return;
    const d = callbacks.current.getDetails();
    try {
      const { sessionId } = await createSession({
        title: d.title.trim() || null,
        goal: d.goal.trim() || null,
        durationMs: Math.max(MIN_RECORDING_MS, prepared.durationMs),
        expectedChunks: prepared.chunks.length,
        videoCaptured: Boolean(videoUrlRef.current),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        audience: d.audience,
      });
      callbacks.current.onSubmitted({ sessionId, recording: prepared, videoUrl: videoUrlRef.current });
      send({ type: "SUBMIT_OK", sessionId });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("INTERNAL", "Something went wrong.", 0, true);
      send({ type: "SUBMIT_FAILED", code: e.code, message: e.message, retryable: e.retryable });
    }
  }, [send]);

  // 7. Finalize: drain PCM, stop video, release devices, prepare chunks (R4.7, R4.9, R5.2).
  useEffect(() => {
    if (state.kind !== "finalizing") return;
    let cancelled = false;
    (async () => {
      try {
        const capture = captureRef.current;
        const drained = capture ? await capture.drain() : { blocks: [], sampleRate: 48000 };
        const video = await stopRecorder();
        await releaseMedia();
        const totalFrames = drained.blocks.reduce((a, b) => a + b.length, 0);
        const capturedMs = Math.round((totalFrames / drained.sampleRate) * 1000);
        if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = video ? URL.createObjectURL(video) : null;
        if (capturedMs < MIN_RECORDING_MS) {
          preparedRef.current = null;
          if (!cancelled) send({ type: "FINALIZED", capturedMs });
          return;
        }
        preparedRef.current = await prepareRecording(drained.blocks, drained.sampleRate);
        if (!cancelled) send({ type: "FINALIZED", capturedMs });
      } catch {
        if (!cancelled) {
          send({
            type: "SUBMIT_FAILED",
            code: "PREPARE_FAILED",
            message: "We couldn't prepare your audio. Please record again.",
            retryable: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.kind, send, stopRecorder, releaseMedia]);

  // 8. Submit when entering `submitting`.
  useEffect(() => {
    if (state.kind === "submitting") void submit();
  }, [state.kind, submit]);

  const actions = {
    enable: () => send({ type: "ENABLE" }),
    retry: () => send({ type: "RETRY" }),
    micOnly: () => send({ type: "MIC_ONLY" }),
    start: () => send({ type: "START" }),
    cancel: () => send({ type: "CANCEL" }),
    pause: () => {
      captureRef.current?.setCapturing(false);
      if (recorderRef.current?.state === "recording") recorderRef.current.pause();
      send({ type: "PAUSE", now: performance.now() });
    },
    resume: () => {
      captureRef.current?.setCapturing(true);
      if (recorderRef.current?.state === "paused") recorderRef.current.resume();
      send({ type: "RESUME", now: performance.now() });
    },
    stop: () => send({ type: "STOP" }),
    discard: async () => {
      await captureRef.current?.drain();
      await stopRecorder();
      videoChunksRef.current = [];
      send({ type: "DISCARD" });
    },
    analyzePartial: () => send({ type: "ANALYZE_PARTIAL" }),
    recordAgain: () => {
      preparedRef.current = null;
      send({ type: "RECORD_AGAIN" });
    },
    retrySubmit: () => send({ type: "RETRY_SUBMIT" }),
    selectDevice: (kind: "audio" | "video", deviceId: string) => {
      const next = { ...loadDevicePrefs(), [kind === "audio" ? "audioId" : "videoId"]: deviceId || undefined };
      saveDevicePrefs(next);
      setPrefs(next);
      send({ type: "DEVICE_CHANGED" });
    },
  };

  const elapsed = elapsedMs(state, now);
  const warning = (state.kind === "recording" || state.kind === "paused") && elapsed >= WARNING_MS;

  return { state, actions, stream, analyser, devices, prefs, elapsed, warning };
}
