import path from "node:path";
import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });
// E2E writes guest users and sessions, so it must run against the Neon test branch.
const testDb = process.env.DATABASE_URL_TEST;
if (!testDb) throw new Error("Set DATABASE_URL_TEST (a Neon test branch) before running E2E tests.");

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const fakeAudio = path.resolve("tests/fixtures/speech.wav");

/**
 * E2E with fake camera/mic and mocked Hugging Face (design §17). Run
 * `pnpm build` first; the web server uses the production build.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeAudio}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDb,
      HF_MOCK: "1",
      APP_ORIGIN: baseURL,
      DEMO_SEED_ON_GUEST: "true",
    },
  },
});
