// Copies the MediaPipe vision WASM runtime from node_modules into public/ so the
// camera background effect is served same-origin (no CDN, CSP stays 'self').
// Runs before `next dev` and `next build`. The copied files are gitignored.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/@mediapipe/tasks-vision/wasm");
const dest = path.resolve("public/mediapipe/wasm");
// FilesetResolver.forVisionTasks() picks the SIMD build when supported, otherwise the no-SIMD build.
const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

if (!existsSync(src)) {
  console.error("copy-mediapipe: @mediapipe/tasks-vision is not installed. Run pnpm install.");
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) {
  const from = path.join(src, f);
  const to = path.join(dest, f);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
}
console.log(`copy-mediapipe: ${files.length} files ready in public/mediapipe/wasm`);
