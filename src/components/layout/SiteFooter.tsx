export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border-subtle">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 text-caption text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-semibold text-text-secondary">Knightly Speeches</span> · Transcription by Whisper and
          coaching by Llama, open-source models on Hugging Face. Data stored in Neon Postgres.
        </p>
        <p>Video stays on your device. Audio is never stored.</p>
      </div>
    </footer>
  );
}
