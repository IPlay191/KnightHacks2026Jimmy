"use client";

import { useId } from "react";

/** Native select for camera or microphone (R3.1, R3.2). */
export function DevicePicker({
  label,
  devices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small text-text">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled || devices.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-text disabled:opacity-60"
      >
        <option value="">Default {label.toLowerCase()}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}
