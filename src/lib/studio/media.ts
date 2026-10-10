"use client";

import type { DeniedReason, UnsupportedReason } from "./machine";

/** getUserMedia, device enumeration, and error mapping (R2, R3, design §10.5). */
export const DEVICE_STORAGE_KEY = "sr.devices";

export interface DevicePrefs {
  audioId?: string;
  videoId?: string;
}

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DevicePrefs) : {};
  } catch {
    return {};
  }
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable (private mode); preferences are optional
  }
}

export function checkSupport(hasWorklet: boolean): UnsupportedReason | null {
  if (typeof window === "undefined") return "no-media";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "no-media";
  if (!hasWorklet) return "no-worklet";
  return null;
}

/** "granted" only when both camera and microphone are already granted (R2.2). */
export async function queryPermission(): Promise<"granted" | "unknown"> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: "camera" as PermissionName }),
      navigator.permissions.query({ name: "microphone" as PermissionName }),
    ]);
    return cam.state === "granted" && mic.state === "granted" ? "granted" : "unknown";
  } catch {
    return "unknown";
  }
}

export class MediaAcquireError extends Error {
  constructor(
    readonly reason: DeniedReason,
    readonly canUseMicOnly: boolean,
  ) {
    super(reason);
    this.name = "MediaAcquireError";
  }
}

function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function videoConstraints(deviceId?: string, relaxed = false): MediaTrackConstraints {
  if (relaxed) return { facingMode: "user" };
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user",
  };
}

function errorName(err: unknown): string {
  return err instanceof DOMException || err instanceof Error ? err.name : "";
}

/**
 * Requests audio (+ video unless audioOnly). Retries once with relaxed
 * constraints on OverconstrainedError (R2.7) and maps errors to recovery
 * reasons (R2.4–2.6).
 */
export async function acquireStream(opts: { audioOnly: boolean; prefs: DevicePrefs }): Promise<MediaStream> {
  const attempt = (relaxed: boolean) =>
    navigator.mediaDevices.getUserMedia({
      audio: relaxed ? audioConstraints() : audioConstraints(opts.prefs.audioId),
      video: opts.audioOnly ? false : videoConstraints(opts.prefs.videoId, relaxed),
    });
  try {
    try {
      return await attempt(false);
    } catch (err) {
      if (errorName(err) === "OverconstrainedError" || errorName(err) === "NotFoundError") {
        // Saved devices may be gone; retry with defaults and relaxed constraints.
        return await attempt(true);
      }
      throw err;
    }
  } catch (err) {
    const name = errorName(err);
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MediaAcquireError("not-allowed", !opts.audioOnly);
    }
    if (name === "NotFoundError") {
      if (!opts.audioOnly) {
        // Distinguish a missing camera from a missing microphone.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const hasMic = devices.some((d) => d.kind === "audioinput");
        if (hasMic) throw new MediaAcquireError("not-found-camera", true);
      }
      throw new MediaAcquireError("not-found-mic", false);
    }
    if (name === "NotReadableError" || name === "AbortError") throw new MediaAcquireError("not-readable", !opts.audioOnly);
    if (name === "OverconstrainedError") throw new MediaAcquireError("overconstrained", !opts.audioOnly);
    throw new MediaAcquireError("not-readable", !opts.audioOnly);
  }
}

export interface DeviceLists {
  audio: MediaDeviceInfo[];
  video: MediaDeviceInfo[];
}

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  return {
    audio: all.filter((d) => d.kind === "audioinput" && d.deviceId),
    video: all.filter((d) => d.kind === "videoinput" && d.deviceId),
  };
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export function pickVideoMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export type Browser = "chrome" | "edge" | "firefox" | "safari" | "other";

export function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

export const RECOVERY_STEPS: Record<Browser, string[]> = {
  chrome: [
    "Click the camera icon or the site settings icon at the left of the address bar.",
    "Set Camera and Microphone to Allow.",
    "Choose Try again below.",
  ],
  edge: [
    "Click the lock icon at the left of the address bar, then Permissions for this site.",
    "Set Camera and Microphone to Allow.",
    "Choose Try again below.",
  ],
  firefox: [
    "Click the camera or microphone icon with a slash in the address bar.",
    "Remove the Blocked permission for Camera and Microphone.",
    "Choose Try again below and allow access when asked.",
  ],
  safari: [
    "Open Safari > Settings for This Website (or Safari > Settings > Websites).",
    "Set Camera and Microphone to Allow.",
    "Reload the page, then choose Try again.",
  ],
  other: [
    "Open your browser's site settings for this page.",
    "Allow access to your camera and microphone.",
    "Choose Try again below.",
  ],
};
