import { planChunks, SAMPLE_RATE, samplesToMs } from "./chunker";
import { concatBlocks, resampleTo16k } from "./resample";
import { encodeWavPcm16 } from "./wav";

export interface PreparedChunk {
  index: number;
  startMs: number;
  endMs: number;
  wav: Blob;
}

export interface PreparedRecording {
  durationMs: number;
  chunks: PreparedChunk[];
}

/** Resample → split at silences → encode WAV (R5.2, R5.3, NFR-1.2). */
export async function prepareRecording(blocks: Float32Array[], sampleRate: number): Promise<PreparedRecording> {
  const raw = concatBlocks(blocks);
  const pcm = await resampleTo16k(raw, sampleRate);
  const plan = planChunks(pcm, SAMPLE_RATE);
  const chunks = plan.map((c) => ({
    index: c.index,
    startMs: c.startMs,
    endMs: c.endMs,
    wav: new Blob([encodeWavPcm16(pcm.subarray(c.startSample, c.endSample), SAMPLE_RATE) as Uint8Array<ArrayBuffer>], {
      type: "audio/wav",
    }),
  }));
  return { durationMs: samplesToMs(pcm.length, SAMPLE_RATE), chunks };
}
