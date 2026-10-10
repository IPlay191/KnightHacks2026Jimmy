/**
 * Strict WAV validation for uploaded chunks (design §9.8). Accepts only
 * 16 kHz, mono, 16-bit PCM. Pure, so it can be property-tested (P2).
 */
export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavError";
  }
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Int16Array;
  durationMs: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i] ?? 0);
  return s;
}

export function parseWav(bytes: Uint8Array, expected = { sampleRate: 16000, channels: 1, bits: 16 }): ParsedWav {
  if (bytes.length < 44) throw new WavError("too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF") throw new WavError("missing RIFF");
  if (ascii(bytes, 8, 4) !== "WAVE") throw new WavError("missing WAVE");
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 !== bytes.length) throw new WavError("RIFF size mismatch");

  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bits: number } | null =
    null;
  let data: { start: number; size: number } | null = null;

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.length) throw new WavError(`chunk ${id} overruns file`);
    if (id === "fmt ") {
      if (size < 16) throw new WavError("fmt chunk too small");
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      data = { start: body, size };
    }
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new WavError("missing fmt chunk");
  if (!data) throw new WavError("missing data chunk");
  if (fmt.format !== 1) throw new WavError("not PCM");
  if (fmt.channels !== expected.channels) throw new WavError("wrong channel count");
  if (fmt.sampleRate !== expected.sampleRate) throw new WavError("wrong sample rate");
  if (fmt.bits !== expected.bits) throw new WavError("wrong bit depth");
  const blockAlign = (fmt.channels * fmt.bits) / 8;
  if (fmt.blockAlign !== blockAlign || fmt.byteRate !== fmt.sampleRate * blockAlign) {
    throw new WavError("inconsistent fmt fields");
  }
  if (data.size % blockAlign !== 0) throw new WavError("partial sample in data");

  const count = data.size / 2;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(data.start + i * 2, true);
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bits,
    samples,
    durationMs: Math.round((count / fmt.sampleRate) * 1000),
  };
}
