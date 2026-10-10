/** 16-bit PCM mono WAV encoding (R5.3). Pure; used in the browser and tests. */
export const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function floatToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

export function encodeWavPcm16(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, floatToInt16(samples[i] ?? 0), true);
  }
  return new Uint8Array(buffer);
}
