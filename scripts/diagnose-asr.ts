/**
 * Diagnoses transcription end to end using the app's own ASR module and a
 * real WAV file: format checks, silence detection, and the Hugging Face call.
 *
 * Usage: pnpm diagnose:asr path/to/recording.wav
 * (Any 16 kHz mono 16-bit WAV; other WAVs are resampled to that format first.)
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { encodeWavPcm16 } from "@/lib/audio/wav";
import { planChunks } from "@/lib/audio/chunker";
import { resampleLinear } from "@/lib/audio/resample";
import { detectSilences } from "@/server/analysis/silence";
import { parseWav } from "@/server/audio/wav-parse";
import { transcribeChunk } from "@/server/hf/asr";

config({ path: ".env.local", quiet: true });

function readAnyWav(path: string): Float32Array {
  const buf = new Uint8Array(readFileSync(path));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  if (bits !== 16) throw new Error(`Only 16-bit WAV is supported here (got ${bits}-bit).`);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(...buf.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const frames = Math.floor(size / 2 / channels);
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += view.getInt16(offset + 8 + (i * channels + c) * 2, true);
        mono[i] = s / channels / 32768;
      }
      return resampleLinear(mono, rate, 16000);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found.");
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass a WAV file: pnpm diagnose:asr recording.wav");
  if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is not set in .env.local.");
  const pcm = readAnyWav(file);
  const plan = planChunks(pcm);
  console.log(`Audio: ${(pcm.length / 16000).toFixed(1)} s → ${plan.length} chunk(s)`);
  for (const c of plan) {
    const wav = encodeWavPcm16(pcm.subarray(c.startSample, c.endSample));
    const parsed = parseWav(wav);
    const { voicedRatio, silences, thresholdDb } = detectSilences(parsed.samples, 16000, c.startMs);
    console.log(
      `Chunk ${c.index}: ${c.startMs}–${c.endMs} ms, ${(wav.length / 1024).toFixed(0)} KB, voiced ${(voicedRatio * 100).toFixed(0)}%, threshold ${thresholdDb.toFixed(1)} dBFS, ${silences.length} silences`,
    );
    const started = Date.now();
    try {
      const r = await transcribeChunk(
        { wav, startMs: c.startMs, endMs: c.endMs, voicedRatio },
        { deadline: Date.now() + 50_000 },
      );
      console.log(
        `  ✔ ${r.model} in ${Date.now() - started} ms, ${r.segments ? `${r.segments.length} timed segments` : "no timestamps"}, ${r.text.split(/\s+/).filter(Boolean).length} words${r.skipped ? " (skipped as silent)" : ""}`,
      );
      console.log(`  "${r.text.slice(0, 160)}${r.text.length > 160 ? "…" : ""}"`);
    } catch (err) {
      const e = err as { name?: string; kind?: string; status?: number; message?: string };
      console.log(`  ✘ ${e.name ?? "Error"} kind=${e.kind ?? "?"} status=${e.status ?? "?"} ${e.message ?? ""}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
