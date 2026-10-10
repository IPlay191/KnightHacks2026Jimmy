"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Announce = (message: string, opts?: { assertive?: boolean }) => void;

const AnnouncerContext = createContext<Announce>(() => undefined);

/**
 * Two visually hidden live regions (R16.5): polite for state changes,
 * assertive for errors. Clearing first and setting on the next frame makes
 * repeated messages read again.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const frame = useRef<number | null>(null);

  const announce = useCallback<Announce>((message, opts) => {
    const set = opts?.assertive ? setAssertive : setPolite;
    set("");
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => set(message));
    });
  }, []);

  const value = useMemo(() => announce, [announce]);
  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}
