"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BackgroundCompositor } from "./background-compositor";
import { loadBackgroundPref, saveBackgroundPref, type BackgroundId, type SceneId } from "./backgrounds";

export type BackgroundStatus = "off" | "loading" | "on" | "error";

interface Result {
  key: string;
  status: "on" | "error";
  track: MediaStreamTrack | null;
}

/**
 * Owns the virtual background for the studio camera. Returns the composited
 * track to record (null when no background is active) and a ref callback for
 * the on-screen preview canvas.
 */
export function useCameraBackground(stream: MediaStream | null, cameraOn: boolean) {
  // The picker only renders after client-side permission checks, so reading
  // localStorage during the first client render can't cause a hydration mismatch.
  const [background, setBackgroundState] = useState<BackgroundId>(() =>
    typeof window === "undefined" ? "none" : loadBackgroundPref(),
  );
  const [result, setResult] = useState<Result | null>(null);
  const compRef = useRef<BackgroundCompositor | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const keyRef = useRef<string | null>(null);

  const videoTrackId = cameraOn ? (stream?.getVideoTracks()[0]?.id ?? null) : null;
  const key = videoTrackId && background !== "none" ? `${background}:${videoTrackId}` : null;
  const status: BackgroundStatus = key === null ? "off" : result?.key === key ? result.status : "loading";
  const track = status === "on" ? (result?.track ?? null) : null;

  useEffect(() => {
    if (!key || !stream || background === "none") {
      keyRef.current = null;
      compRef.current?.stop();
      compRef.current = null;
      return;
    }
    let cancelled = false;
    keyRef.current = key;
    // The compositor outlives a single effect run (scene/camera switches reuse it),
    // so fatal errors are reported against whatever key is current at that time.
    const comp =
      compRef.current ??
      new BackgroundCompositor(() => {
        const current = keyRef.current;
        if (current) setResult({ key: current, status: "error", track: null });
      });
    compRef.current = comp;
    comp.setPreview(previewRef.current);
    comp
      .start(stream, background as SceneId)
      .then((t) => {
        if (!cancelled) setResult({ key, status: "on", track: t });
      })
      .catch(() => {
        if (cancelled) return;
        comp.stop();
        if (compRef.current === comp) compRef.current = null;
        setResult({ key, status: "error", track: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, stream, background]);

  useEffect(
    () => () => {
      compRef.current?.stop();
      compRef.current = null;
    },
    [],
  );

  const attachPreview = useCallback((el: HTMLCanvasElement | null) => {
    previewRef.current = el;
    compRef.current?.setPreview(el);
  }, []);

  const setBackground = useCallback((id: BackgroundId) => {
    saveBackgroundPref(id);
    setBackgroundState(id);
  }, []);

  return { background, setBackground, status, track, attachPreview };
}
