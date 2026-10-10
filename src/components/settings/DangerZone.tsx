"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteAllMyData, removeSampleSessions } from "@/app/actions/data";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";

/** Sample removal and delete-all-data controls (R13.3–13.5). */
export function DangerZone({ hasSamples }: { hasSamples: boolean }) {
  const router = useRouter();
  const announce = useAnnounce();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  return (
    <Card aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="text-h3">
        Your data
      </h2>
      <p className="mt-1 text-small text-text-secondary">
        Transcripts, scores, and coaching are stored in your private guest profile. Audio and video are never stored.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {hasSamples ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-text">Remove the sample sessions from your history.</p>
            <ConfirmDialog
              trigger={<Button variant="secondary">Remove sample sessions</Button>}
              title="Remove sample sessions?"
              description="The sample history will be removed from your profile. Your own sessions stay."
              confirmLabel="Remove samples"
              confirmVariant="primary"
              onConfirm={async () => {
                const res = await removeSampleSessions();
                if (res.ok) {
                  announce(`Removed ${res.removed ?? 0} sample sessions.`);
                  router.refresh();
                } else {
                  announce(res.error, { assertive: true });
                }
              }}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-text">Delete your profile and every session. This can&apos;t be undone.</p>
          <ConfirmDialog
            trigger={
              <Button variant="destructive" icon={<Trash2 size={18} />}>
                Delete all my data
              </Button>
            }
            title="Delete all your data?"
            description="Your guest profile, sessions, transcripts, scores, and settings will be permanently deleted."
            confirmLabel="Delete everything"
            confirmDisabled={confirm !== "DELETE"}
            onConfirm={async () => {
              setError(null);
              const res = await deleteAllMyData(confirm);
              if (res && !res.ok) setError(res.error);
            }}
          >
            <label htmlFor={inputId} className="text-small text-text">
              Type DELETE to confirm
            </label>
            <input
              id={inputId}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              aria-describedby={error ? `${inputId}-err` : undefined}
              className="mt-1.5 w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-text"
            />
            {error ? (
              <p id={`${inputId}-err`} role="alert" className="mt-2 text-small text-danger">
                {error}
              </p>
            ) : null}
          </ConfirmDialog>
        </div>
      </div>
    </Card>
  );
}
