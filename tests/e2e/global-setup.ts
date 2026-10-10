import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Writes a ~25 s 48 kHz mono WAV with speech-like bursts and pauses for the fake mic. */
export default function globalSetup() {
  const file = path.resolve("tests/fixtures/speech.wav");
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const rate = 48000;
  const seconds = 25;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // 1.6 s "phrases" separated by 0.6 s gaps, plus one 2.5 s pause at 12 s.
    const inLongPause = t > 12 && t < 14.5;
    const phrase = (t % 2.2) < 1.6;
    const env = !inLongPause && phrase ? 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t) : 0;
    const v = env * 0.3 * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 320 * t) + 0.25 * Math.sin(2 * Math.PI * 640 * t));
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}
