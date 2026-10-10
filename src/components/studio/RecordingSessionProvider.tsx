"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PreparedChunk } from "@/lib/audio/prepare";

/**
 * In-memory store for the latest recording (design §10.1): audio chunks for
 * upload and the local video for same-tab replay (R5.5, R11.2). Nothing here
 * is persisted; a reload clears it.
 */
export interface StoredRecording {
  sessionId: string;
  chunks: PreparedChunk[];
  videoUrl: string | null;
}

interface RecordingStore {
  recording: StoredRecording | null;
  save: (rec: StoredRecording) => void;
  get: (sessionId: string) => StoredRecording | null;
  /** Frees the audio once it has been uploaded (video stays for replay). */
  releaseAudio: (sessionId: string) => void;
  clear: () => void;
}

const Ctx = createContext<RecordingStore | null>(null);

export function RecordingSessionProvider({ children }: { children: ReactNode }) {
  const [recording, setRecording] = useState<StoredRecording | null>(null);
  const ref = useRef<StoredRecording | null>(null);

  const revoke = (rec: StoredRecording | null) => {
    if (rec?.videoUrl) URL.revokeObjectURL(rec.videoUrl);
  };

  const save = useCallback((rec: StoredRecording) => {
    if (ref.current && ref.current.videoUrl !== rec.videoUrl) revoke(ref.current);
    ref.current = rec;
    setRecording(rec);
  }, []);

  const get = useCallback((sessionId: string) => (ref.current?.sessionId === sessionId ? ref.current : null), []);

  const releaseAudio = useCallback((sessionId: string) => {
    if (ref.current?.sessionId !== sessionId) return;
    ref.current = { ...ref.current, chunks: [] };
    setRecording(ref.current);
  }, []);

  const clear = useCallback(() => {
    revoke(ref.current);
    ref.current = null;
    setRecording(null);
  }, []);

  useEffect(() => () => revoke(ref.current), []);

  const value = useMemo(() => ({ recording, save, get, releaseAudio, clear }), [recording, save, get, releaseAudio, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordingStore(): RecordingStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRecordingStore must be used inside RecordingSessionProvider");
  return ctx;
}

/** Optional variant for components that may render outside the provider. */
export function useOptionalRecordingStore(): RecordingStore | null {
  return useContext(Ctx);
}
