"use client";

import { AlertDialog } from "radix-ui";
import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";

/**
 * Accessible confirmation dialog (R4.8, R13.3, R16.8): labelled, focus is
 * trapped, Escape closes, and focus returns to the trigger.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "destructive",
  onConfirm,
  children,
  confirmDisabled,
  open,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
  confirmDisabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-surface-raised p-6 shadow-3">
          <AlertDialog.Title className="text-h3 text-text">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-text-secondary">{description}</AlertDialog.Description>
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant={confirmVariant}
              disabled={busy || confirmDisabled}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange?.(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
