# Implementation Plan: AI Speech Reviewer

Work through the tasks in order. Each sub-task is sized for one focused coding session and ends with a passing `pnpm lint && pnpm typecheck && pnpm test` (once those exist). Requirement IDs refer to `requirements.md`, and section references (§) refer to `design.md`. Tasks marked **[Stretch]** start only after task 15 is done.

- [ ] 1. Project scaffold and tooling
  - [ ] 1.1 Scaffold the app with `create-next-app` (Next.js 16, App Router, TypeScript, Tailwind v4, ESLint, `src/` dir, pnpm). Pin every dependency to the exact installed version (remove `^`/`~`), set `strict: true`, and add Prettier.
    - _Requirements: 15.1, NFR-5.1, NFR-5.3_
  - [ ] 1.2 Install the locked stack from design §1 at exact versions: `gsap`, `@gsap/react`, `radix-ui`, `lucide-react`, `zod`, `drizzle-orm`, `@neondatabase/serverless`, `d3-scale`, `d3-shape`, `server-only`. Dev dependencies: `drizzle-kit`, `vitest`, `fast-check`, `@testing-library/react`, `jsdom`, `msw`, `@playwright/test`, `@axe-core/playwright`, `tsx`.
    - _Requirements: 14.1, 15.1, 15.3_
  - [ ] 1.3 Create the `src/` folder skeleton from design §10.2. Add the ESLint `no-restricted-imports` rules (no `src/server/**` from client code, and no `db` import outside `src/server/db/queries`), and add the package scripts from §18.
    - _Requirements: NFR-2.1, NFR-2.3_
  - [ ] 1.4 Implement `src/server/env.ts` (Zod-validated env, `server-only`, `HF_MOCK` rejected in production), `src/server/log.ts` (JSON logger), and `src/server/errors.ts` (the `AppError` catalog from §9.9). Add `.env.example` with key names only.
    - _Requirements: NFR-2.1, 17.1, 17.4_
  - [ ] 1.5 Configure Vitest (node and jsdom projects) and Playwright (Chromium with fake-media flags from §17). Add the `tests/fixtures/speech.wav` fixture (about 20 s, 16 kHz mono, with deliberate "um" and pauses). Add a CI-style `pnpm verify` script that runs lint, typecheck, and unit tests.
    - _Requirements: NFR-5.1, NFR-5.2_
  - [ ] 1.6 Add static security headers in `next.config.ts` (Permissions-Policy, Referrer-Policy, nosniff) and the nonce-based CSP in `src/proxy.ts`, per §15. Confirm the app still hydrates with the CSP active.
    - _Requirements: NFR-2.8_

- [ ] 2. Design system and tokens
  - [ ] 2.1 Define all color, radius, shadow, and motion tokens in `globals.css` with Tailwind v4 `@theme` (§12.1–12.4). Add the global `:focus-visible` ring with a canvas offset, `scroll-padding-top`, base typography, and the `.sr-only` utility.
    - _Requirements: 15.2, 16.1, 16.2_
  - [ ] 2.2 Load Bricolage Grotesque, Inter, and JetBrains Mono with `next/font/google`, exposed as CSS variables. Implement the type scale utilities and tabular numerals for metrics.
    - _Requirements: 15.2_
  - [ ] 2.3 Write `tests/unit/tokens.contrast.test.ts`, which parses `globals.css` and asserts every contrast pair in §12.1.
    - _Requirements: 16.1, NFR-3.1_
  - [ ] 2.4 Build UI primitives on Radix + Tailwind: Button (primary, secondary, ghost, destructive; sizes ≥ 24 px), IconButton (required `aria-label`), Card, Badge, TextField (label, description, error wiring), Select, Switch, Dialog, Tooltip, Toast, VisuallyHidden, and SkipLink.
    - _Requirements: 16.2, 16.4, 16.8, 16.9, 16.10_
  - [ ] 2.5 Implement `LiveAnnouncerProvider` (polite and assertive regions, `announce()` hook) and `MotionProvider` (resolves the setting and media query, sets `<html data-motion>`). Implement `src/components/motion/gsap.ts` (plugin registration) and the motion tokens module. Wire everything into the root layout with landmarks and the skip link.
    - _Requirements: 15.7, 16.3, 16.5, 16.12_

- [ ] 3. Neon schema, migrations, data-access layer, identity
  - [ ] 3.1 Create the Neon project with branches `main`, `dev`, and `test`. Write `src/server/db/schema.ts` in Drizzle, matching the DDL in §7.3 exactly (enums, checks, indexes, cascades). Run `drizzle-kit generate`, review the SQL against §7.3, commit `drizzle/`, and migrate `dev`.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ] 3.2 Implement `src/server/db/client.ts` (`drizzle-orm/neon-http` with the pooled URL) and the query modules `users`, `sessions`, `chunks`, `reports`, `history`, and `stats`. Every function takes `userId` and filters by it. Add the stats recompute statement (§7.4).
    - _Requirements: 14.1, 14.8, 12.6, NFR-2.3_
  - [ ] 3.3 Implement the analysis claim (conditional `UPDATE … RETURNING`, §3.2), the chunk upsert, the "advance to transcribed" update, and the completion `db.batch` builder (§7.4 steps 1–9).
    - _Requirements: 14.6, 14.7, NFR-4.2, NFR-4.3_
  - [ ] 3.4 Implement `src/server/auth/identity.ts` (HMAC cookie sign and verify with `timingSafeEqual`, `getCurrentUser`, `requireUser`, sliding refresh). Implement `src/server/api.ts` (`withApi` wrapper with the error envelope and `Origin` check). Add unit tests for sign/verify and tamper rejection, plus property test P12 (§17.1).
    - _Requirements: 1.5, NFR-2.4, 17.1_
  - [ ] 3.5 Implement the `continueAsGuest` Server Action (IP-hash rate limit, inserts for user, settings, and stats, cookie, redirect), but without sample cloning yet. Add a `GuestGate` component and the `(app)` layout gate.
    - _Requirements: 1.2, 1.5, NFR-2.6_
  - [ ] 3.6 Add a minimal dev seed (`scripts/seed.ts --dev`) that creates one complete session with fixture transcript, metrics, scores, and feedback, for building the dashboard before the pipeline exists.
    - _Requirements: 18.1_
  - [ ] 3.7 Write integration tests against the `test` branch: cascade delete, CHECK constraint rejections, claim conflict and stale re-claim, batch atomicity (a forced failure leaves no partial rows), and stats recompute.
    - _Requirements: 14.3, 14.4, 14.6, 14.7_

- [ ] 4. Hugging Face integration modules
  - [ ] 4.1 Write `scripts/warmup.ts` as the first step. It calls both router endpoints (§4.2, §4.3) with the real `HF_TOKEN` and a 3 s fixture, and prints status, latency, and response shape. Confirm the URL shapes, timestamp granularity, and `json_schema` support, then record the findings in a comment at the top of `src/server/hf/http.ts`. Accept the Llama license on the HF account.
    - _Requirements: 6.1, 8.1, 18.2_
  - [ ] 4.2 Implement `src/server/hf/http.ts`: injectable `fetch` and clock, `AbortSignal` timeouts, the deadline-aware retry with backoff, jitter, and `Retry-After`, and the error classification table from §4.7. Unit test with fake timers.
    - _Requirements: 6.5, NFR-4.1_
  - [ ] 4.3 Implement `src/server/hf/asr.ts` (`transcribeChunk`): base64 JSON request, Zod `AsrResponse`, timestamp offsetting, clamping, and null-end handling, word-level detection, model fallback, and the hallucination guard. Add MSW-based tests for 200, 503-loading, 429, timeout, and 401, plus property test P4 for timestamp mapping.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.8_
  - [ ] 4.4 Implement `src/server/hf/schema.ts` (`CoachingFeedback` Zod v4 schema plus `z.toJSONSchema`), `src/server/hf/parse.ts` (`extractJson` and post-validation normalization), and `src/server/hf/prompts.ts` (`coach-v1` system and user prompt builders with untrusted-transcript delimiting and truncation). Add unit tests, including snapshot tests of the prompts, plus property test P9 for `extractJson` and normalization.
    - _Requirements: 8.2, 8.3, 8.4, 8.7, 8.8_
  - [ ] 4.5 Implement `src/server/hf/coach.ts` (`generateCoaching`): the attempt chain (json_schema, then no-response_format, then repair, then fallback model) per §4.6, returning `{ feedback, source, model, attempts, latencyMs }` or a signal to use rules. Test each branch with MSW fixtures (valid, fenced JSON, malformed, schema-invalid, 400 on response_format, total failure).
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.9_
  - [ ] 4.6 Implement `src/server/hf/mock.ts` (deterministic fixture responses when `HF_MOCK=1`) and wire it behind the adapter interface.
    - _Requirements: NFR-5.2_

- [ ] 5. Analysis engine and pipeline API
  - [ ] 5.1 Implement `src/server/audio/wav-parse.ts` (strict header validation per §9.8) and `src/server/analysis/silence.ts` (adaptive threshold, voiced ratio). Unit test with synthetic PCM (tones, silence, noise floor), plus property test P3.
    - _Requirements: 7.2, 6.4_
  - [ ] 5.2 Implement `transcript.ts` (assembly, tokenization, word timing interpolation, `NO_SPEECH_DETECTED`) and `fillers.ts` (unambiguous set, contextual candidates with IDs and context, custom fillers, phrase matching). Unit test with fixture transcripts, plus property tests P5 and P7.
    - _Requirements: 6.7, 7.3, 7.4_
  - [ ] 5.3 Implement `metrics.ts` (all metrics in §6.3), `scoring.ts` (§6.5 formulas, renormalization, labels; use the General targets from settings until task 11.2 adds audience profiles), and `rules-feedback.ts`. Unit tests should check determinism (same input gives same output) and boundary cases (in band, far outside band, zero fillers, no pauses, a single 15 s window), plus property tests P6 and P8.
    - _Requirements: 7.1, 7.5, 7.6, 7.7, 8.6_
  - [ ] 5.4 Implement `POST /api/sessions` with `create-session.ts`: validation per §9.8 (including `expectedChunks` 1–17, the normalized `timeZone`, and the `audience` enum, which the UI starts sending in task 11.3), the 25-per-24 h rate limit (sample sessions excluded), and insert.
    - _Requirements: 5.6, NFR-2.5, NFR-2.6_
  - [ ] 5.5 Implement `PUT /api/sessions/{id}/chunks/{index}` with `process-chunk.ts`. Order: size check before reading, index/offset validation (index < `expected_chunks` ≤ 17), WAV validation, idempotent re-upload, silence detection, skipping silent chunks, ASR, upsert, then status advance. Set `maxDuration = 60`.
    - Audio bytes stay in request memory only (never written to disk, blob storage, or logs).
    - _Requirements: 5.3, 6.1–6.8, NFR-1.5, NFR-2.2, NFR-4.2_
  - [ ] 5.6 Implement `POST /api/sessions/{id}/analyze` with `analyze-session.ts`. Order: claim, load chunks and settings, assemble, metrics, set stage `coaching`, coaching (or rules), confirm fillers, scores, set stage `saving`, then the completion batch. Use the deadline budget from §3.3, inject dependencies, and set `maxDuration = 120`. Add the model-based property test P13 for status transitions.
    - _Requirements: 7.1–7.7, 8.1–8.9, 14.6, 14.7_
  - [ ] 5.7 Implement `GET /api/sessions/{id}/status`, `DELETE /api/sessions/{id}`, and `POST /api/sessions/{id}/coaching` (the retry-AI-coaching path from §9.5).
    - _Requirements: 9.4, 9.8, 13.3, 13.7, 8.6_
  - [ ] 5.8 Write integration tests for the full API flow with MSW and the Neon `test` branch. Cover the scenarios listed in §17 (happy path, idempotency, conflicts, repair, rules fallback, ASR fallback, cross-user 404, rate limits).
    - _Requirements: 10.7, 17.1, 17.3, NFR-2.3, NFR-4.2_

- [ ] 6. Landing, recording studio UI, and state machine
  - [ ] 6.1 Build the landing page: Hero, AuroraBackground (static for now), HowItWorks, PrivacyCard, and the "Start practicing" and "See a sample report" CTAs wired to `continueAsGuest`.
    - _Requirements: 1.1, 1.2, 1.4, 1.6_
  - [ ] 6.2 Implement `src/lib/studio/machine.ts` (state union, events, pure `transition`) with an exhaustive unit test table covering every state × event pair, including no-op cases, plus property test P10 over random event sequences.
    - _Requirements: 4.1–4.8, NFR-5.2_
  - [ ] 6.3 Implement `src/lib/studio/media.ts`: secure-context and API checks, Permissions API pre-check, `getUserMedia` with error mapping, overconstrained retry, mic-only mode, device enumeration and persistence, and the `devicechange` handler.
    - _Requirements: 2.1–2.8, 3.2, 3.3_
  - [ ] 6.4 Build the permission UI: `PermissionExplainer` (why and what is stored), `PermissionRecovery` (per-reason copy, browser-specific steps for Chrome, Edge, Firefox, and Safari, Try again, Continue with microphone only), and the `unsupported` screen.
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.8_
  - [ ] 6.5 Build the ready state: `CameraPreview` (mirrored, audio-only placeholder), `DevicePicker` ×2, `SpeechDetailsForm` (title ≤ 80, goal ≤ 200), the `LevelMeter` shell, and `MicCheckStatus` (dBFS categories with the 1.5 s debounce, §10.5).
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - [ ] 6.6 Implement `src/lib/audio/capture.ts` and `public/worklets/pcm-capture.js` (PCM capture with pause gating), plus the MediaRecorder video capture and its MIME selection. Store the results in `RecordingSessionProvider` (in the `(app)` layout).
    - _Requirements: 5.1, 5.5, 4.4_
  - [ ] 6.7 Build the recording controls: `RecordControl` (single primary control with state labels, 72 px), `Countdown` (3 s, Escape to cancel), `RecordingBadge`, `RecordingTimer` (`role="timer"`, minute and 30 s-left announcements), Pause/Resume (`aria-pressed`), `DiscardDialog`, the 4:30 warning, the 5:00 auto-stop, and the track-ended handling.
    - _Requirements: 4.1–4.10, 16.4, 16.5, 16.6_
  - [ ] 6.8 Implement `src/lib/audio/{resample,chunker,wav}.ts` (OfflineAudioContext resample, quietest-window splitting, WAV encode) with unit tests for header bytes plus property tests P1 (chunk coverage, 18–28 s bounds, ≤ 17 chunks) and P2 (WAV round trip against `server/audio/wav-parse`). Wire up `finalizing` (inline stage 1 UI), `tooShort`, and `submitting` (`POST /api/sessions` with the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`, then navigate), plus `submitError` with retry.
    - _Requirements: 4.7, 5.2, 5.3, 9.1, NFR-1.2_
  - [ ] 6.9 Wire up studio focus management and announcements on every state entry (§14).
    - _Requirements: 16.5, 16.7_

- [ ] 7. Processing UI
  - [ ] 7.1 Implement `src/lib/pipeline/api-client.ts` (typed fetch, envelope parsing into typed errors) and `usePipeline`: an upload queue with concurrency 3, auto-retry ×2, analyze, status polling every 1.5 s with backoff, `CHUNKS_INCOMPLETE` re-queue, and the reload/resume branches from R9.8.
    - _Requirements: 5.4, 5.6, 9.4, 9.8, 17.3_
  - [ ] 7.2 Build `ProcessingScreen`, `ProcessingStages`, and `StageRow` (5 stages, icon and text status, "n of N" progress). Add the `ReassuranceMessage` after 20 s, and `ProcessingError` with stage-specific Retry or Record again.
    - Map `SERVICE_UNAVAILABLE` to "We couldn't save your session. Retry." while audio is still in memory.
    - _Requirements: 9.1, 9.2, 9.5, 9.7, 17.2, 17.5_
  - [ ] 7.3 Add stage announcements (once each), completion focus and announcement, and auto-advance that honors `auto_advance_report` and reduced motion.
    - _Requirements: 9.3, 9.6, 16.5, 16.7_

- [ ] 8. Report dashboard and charts
  - [ ] 8.1 Implement `reports.getSessionReport(userId, id)` (session, scores, metrics, feedback, segments, words, and the previous session's scores for deltas). Build `/sessions/[id]/page.tsx` with `notFound()` for missing or unowned sessions, and `error.tsx`.
    - _Requirements: 10.1, 10.2, 10.7_
  - [ ] 8.2 Build `ChartFigure` and `DataTableToggle` (figure, caption, sr summary, accessible table), plus the `useElementWidth` ResizeObserver hook.
    - _Requirements: 10.5, 16.1_
  - [ ] 8.3 Build `ScoreRing`, `SubScoreTile`, and `DeltaChip` (with non-color cues). Assemble `ScoreHero` with the qualitative label, summary, and `FeedbackSourceNote`. When clarity is null (rules feedback), the Clarity tile shows "Not available" with the reason in text.
    - _Requirements: 10.1, 10.2, 10.6, 10.9_
  - [ ] 8.4 Build `PaceTimeline` (area and line, target band with direct label, long-pause markers, filler rug, mm:ss axis) and `FillerBars` (sorted, direct labels, AI-confirmed marking), plus `FillerNotice`.
    - _Requirements: 10.3, 10.4, 7.8, 15.8_
  - [ ] 8.5 Build `TopActions` and `ImprovementCard` (priority, category, evidence quote, rewrite), `StrengthsList`, `PracticeDrill`, and `RetryCoachingButton` (rules only).
    - Render all LLM text as plain React text (no `dangerouslySetInnerHTML`, no markdown rendering).
    - _Requirements: 8.7, 10.1, 8.6, NFR-2.7_
  - [ ] 8.6 Build `TranscriptPanel` (segments with timestamps, filler underline and sr label, inline long-pause markers, copy as text) and `LocalReplay` (object URL from the provider, WebVTT captions from segments via `src/lib/vtt.ts`, timestamp seek, and the fallback message when there's no video).
    - _Requirements: 11.1–11.5, 16.11_
  - [ ] 8.7 Verify the responsive layout at 320, 768, 1024, and 1440 px and at 200% zoom. Add the delete-session action with a confirmation dialog.
    - _Requirements: 10.8, 13.3_

- [ ] 9. History and progress
  - [ ] 9.1 Implement the history queries (paginated list, last 50 for the series, `user_stats`) and the `/history` page with `?page` validation.
    - _Requirements: 12.1, 12.3, 12.6_
  - [ ] 9.2 Implement `src/lib/progress.ts` (`computeProgressStats`: streak from each session's `completed_at` in its stored `time_zone`, trend of the newest 3 vs the previous 3 with ±3 thresholds and "Not enough sessions yet" under 6) with unit tests and property test P11. Build `StatsHeader` (totals, best score, streak) and `TrendBadge` (numeric delta plus words, not color alone).
    - _Requirements: 12.2_
  - [ ] 9.3 Build `ProgressLineChart` (series toggles with ToggleGroup, distinct markers and dashes, direct end labels, keyboard-navigable points with tooltips, table alternative) and `ProgressChartPanel`.
    - _Requirements: 12.1, 10.5, 15.8, 16.2_
  - [ ] 9.4 Build `SessionList` and `SessionRow` (Sparkline, score chip, Sample badge, pagination) and `EmptyHistory`.
    - _Requirements: 12.3, 12.4, 12.5_

- [ ] 10. Settings and data controls
  - [ ] 10.1 Build `SettingsForm` with the `updateSettings` action: display name, WPM range, `FillerWordsEditor` (add and remove chips, max 20, validation), `MotionPreferenceField`, and the auto-advance switch. Field errors use `aria-describedby`, and focus moves to the first invalid field.
    - _Requirements: 13.1, 13.2, 13.6, 16.10_
  - [ ] 10.2 Build `DangerZone`: remove sample sessions (stats recomputed in the same batch), and delete all my data (type-to-confirm dialog, cascade, cookie cleared, redirect).
    - _Requirements: 13.3, 13.4, 13.5, 13.7_
  - [ ] 10.3 Make custom fillers and WPM targets flow into analysis and scoring. Add an integration test that a custom filler is detected.
    - _Requirements: 7.4, 7.6, 13.1_

- [ ] 11. Audience-aware grading (Young, Teen, Senior, plus General)
  - [ ] 11.1 Implement `src/server/analysis/audience.ts` (the four profiles from §6.6, `AUDIENCE_PROFILE_VERSION`, pure `resolveAudienceProfile(audience, settings)`) and mirror the labels and descriptions in `src/lib/audience.ts` for the UI. Implement `src/server/analysis/readability.ts` (Flesch-Kincaid grade with the syllable heuristic, fillers excluded). Add unit tests with known-grade fixture sentences, plus property tests P14 and P15.
    - _Requirements: 20.3, 20.4, 20.5_
  - [ ] 11.2 Wire audiences into analysis. Replace the General-only targets used in task 5.3 with `resolveAudienceProfile`. Store `reading_grade` and the effective targets in `session_metrics`. Compute `audience_fit` and `audience_fit_source` in `scoring.ts` with the new weights. Add the `AUDIENCE` block and audience-fit rubric to the prompt (update the snapshot), and `audienceFit` to the `CoachingFeedback` schema. Add the audience-specific rules tips to `rules-feedback.ts`. Make `retry-coaching.ts` use the session's stored audience. Add an integration test where the same fixture scored as `young` and as `general` gives the expected pacing, pauses, and audience-fit differences.
    - _Requirements: 7.6, 8.2, 8.7, 20.4, 20.5, 20.6_
  - [ ] 11.3 Build `AudiencePicker` in the studio ready state (radio cards with icons and descriptions, preset from `default_audience`) and send `audience` with `POST /api/sessions`. Add `DefaultAudienceField` to `SettingsForm` and `defaultAudience` to `updateSettings`. Add component tests for arrow-key selection, labels, and `aria-describedby`.
    - _Requirements: 3.5, 13.1, 20.1, 20.2, 20.10_
  - [ ] 11.4 Report: add `AudienceBadge` to the header, `AudienceFitTile` (score, "Grade 6.2 · target ≤ 5", "approximate reading level" note, and a "Based on reading level only" note when the source is `readability_only`), and `AudienceTips`. Switch deltas to the previous session with the same audience, with the "First Teen session" fallback text.
    - _Requirements: 10.1, 10.2, 20.6, 20.7, 20.8_
  - [ ] 11.5 History: add `AudienceFilter` (ToggleGroup synced to `?audience=`), apply the filter to the progress series, the trend (`computeProgressStats`), and the session list queries, and show `AudienceBadge` on each row. Totals and best score stay unfiltered and are labelled "All audiences".
    - _Requirements: 12.1, 12.2, 12.3, 20.9_

- [ ] 12. GSAP polish
  - [ ] 12.1 Studio motion: RecordControl MorphSVG circle↔rounded square and fill tween, recording halo, Countdown numerals and DrawSVG ring, RecordingBadge pulse, and the panel crossfades.
    - _Requirements: 15.3_
  - [ ] 12.2 LevelMeter: 24 bars driven by `gsap.quickTo` on `gsap.ticker` with peak hold. Pause the ticker when hidden or off-state. Profile for ≥ 30 fps.
    - _Requirements: 15.4, NFR-1.4_
  - [ ] 12.3 Processing motion: row stagger, active spinner, progress `scaleX`, and the DrawSVG checkmark.
    - _Requirements: 15.5_
  - [ ] 12.4 Dashboard motion: ScoreRing sweep, `useCountUp` (with the sr-only final value), tile stagger (including `AudienceFitTile`), AudiencePicker selection transition, PaceTimeline draw and clip reveal, marker pops, FillerBars, and ProgressLineChart draw. Use ScrollTrigger with `once`.
    - _Requirements: 15.6_
  - [ ] 12.5 Landing motion: SplitText hero, AuroraBackground drift (paused off-screen and when the tab is hidden), and route content transitions.
    - _Requirements: 15.6_
  - [ ] 12.6 Reduced-motion audit. Every animation above uses `gsap.matchMedia` plus `data-motion` with the fallbacks from the §13 table. Add a component test that the final states render immediately under reduced motion.
    - _Requirements: 15.7, 16.12_

- [ ] 13. Accessibility pass
  - [ ] 13.1 Add `@axe-core/playwright` scans for every route and the studio states (explainer, ready, countdown, recording, denied), plus the report with tables expanded. Fix every serious and critical violation.
    - _Requirements: NFR-3.1_
  - [ ] 13.2 Do a manual keyboard-only walkthrough of the full flow. Check focus order, visible focus, that focus is never obscured, Escape behaviors, dialog focus return, and chart point navigation. Fix what you find.
    - _Requirements: 16.2, 16.7, 16.8_
  - [ ] 13.3 Do a screen reader smoke test (NVDA + Chrome and VoiceOver + Safari). Check announcements, the timer, the record control names, chart summaries and tables, and transcript filler labels. Check zoom at 200% and 400% and reflow at 320 px. Record the results and known gaps in a short QA note in the PR description.
    - _Requirements: 16.3–16.6, 16.11, NFR-3.2_
  - [ ] 13.4 Measure the contrast of hero text over the aurora at its brightest point and the chart marks against surfaces. Adjust gradient opacity if any pair falls below its threshold.
    - _Requirements: 16.1_

- [ ] 14. Testing completion
  - [ ] 14.1 Write the E2E happy path with fake media and `HF_MOCK=1`: landing, guest, studio, record 15 s, processing, then report with scores, transcript, and charts.
    - _Requirements: 1.2, 4.2, 9.1, 10.1_
  - [ ] 14.2 Write E2E edge paths: permission denied (stubbed `NotAllowedError`), recording too short (< 10 s), chunk upload failure then retry (MSW or route stub), LLM failure leading to rules feedback and Retry AI coaching, reload during processing, and delete all data.
    - _Requirements: 2.4, 4.7, 9.7, 9.8, 8.6, 13.4_
  - [ ] 14.3 Write E2E for history after 2 sessions (chart, trend, list), settings validation errors, and the reduced-motion emulation (`page.emulateMedia({ reducedMotion: "reduce" })`).
    - _Requirements: 12.1–12.3, 13.6, 15.7_
  - [ ] 14.4 Write E2E for audiences: set the default to Senior in settings, confirm the studio preselects it, record with Young selected, then check the report shows the Young badge, Audience fit tile, and tips, and that the history filter shows only matching sessions.
    - _Requirements: 20.1, 20.2, 20.7, 20.9_
  - [ ] 14.5 Check performance: time Stop-to-report for 2-minute and 5-minute recordings against real HF (warm and cold), run Lighthouse on landing and report, and record the results.
    - _Requirements: NFR-1.1, NFR-1.2, NFR-1.3_

- [ ] 15. Demo seed data and deployment
  - [ ] 15.1 Write the full `scripts/seed.ts`: a template user with 7 sample sessions over 21 days, an improving trend, realistic transcripts, segments, words, metrics, scores, and LLM-style feedback. Spread the sessions across at least General, Teen, and Young audiences, with audience-fit scores and tips. Make it idempotent with `--reset`.
    - _Requirements: 18.1, 20.11_
  - [ ] 15.2 Add `clone-samples.ts` to `continueAsGuest` (behind `DEMO_SEED_ON_GUEST`, new UUIDs, date shift, `is_sample`, stats recompute in one batch). Wire "See a sample report" to the newest sample, and hide that action when sample data is disabled or the profile has no sample sessions.
    - _Requirements: 1.3, 1.4, 12.4_
  - [ ] 15.3 Provision production: migrate the Neon `main` branch and seed it, create the Vercel project, set env vars (Production and Preview), confirm `maxDuration` for the plan, deploy, and verify HTTPS, headers, and the camera permission on the public URL.
    - _Requirements: 18.3, 14.8, NFR-2.8_
  - [ ] 15.4 Run `pnpm warmup` against production and do a full live run-through on Chrome, Safari, and Firefox. Fix any blockers.
    - _Requirements: 18.2, NFR-1.1_

- [ ] 16. **[Stretch]** Optional enhancements (only after task 15)
  - [ ] 16.1 **[Stretch]** Visual delivery analysis: lazy-load the MediaPipe Face Landmarker, add the eye-contact and head-stability aggregates, the optional `visual` field on `/analyze`, `visual_metrics` storage, and the Presence tile (§18.1).
    - _Requirements: 19.1, 19.2, 19.3_
  - [ ] 16.2 **[Stretch]** Verbatim ASR: deploy CrisperWhisper on a dedicated HF Inference Endpoint, add the `HF_VERBATIM_ASR_URL` engine to `AsrEngine`, and show a "Verbatim transcription" label (§5).
    - _Requirements: 6.1, 7.3, 7.8_
  - [ ] 16.3 **[Stretch]** Opt-in video persistence to Vercel Blob (Open decision (b)), with deletion on session delete.
    - _Requirements: 11.2_
  - [ ] 16.4 **[Stretch]** Light theme, using the same token names with an alternate value set and a re-run of the contrast test.
    - _Requirements: 15.2, 16.1_

---

## Demo-readiness checklist (judging)

- [ ] The public Vercel URL loads over HTTPS. Landing to studio takes under 2 clicks with no sign-up.
- [ ] `pnpm warmup` ran successfully against production in the last 10 minutes (Whisper and Llama both responded).
- [ ] The HF account has enough Inference Provider credits, and the Llama license is accepted.
- [ ] Neon `main` is migrated and seeded. A fresh guest sees the sample history (`DEMO_SEED_ON_GUEST=true`).
- [ ] Rehearsed live take (60–90 s) completes Stop-to-report in under 45 s on venue Wi-Fi. A backup recording plan exists (hotspot).
- [ ] Hugging Face track: be ready to show model IDs in the report footer ("Transcribed with openai/whisper-large-v3-turbo · Coached by meta-llama/Llama-3.3-70B-Instruct") and the structured JSON schema in code.
- [ ] Neon track: be ready to show the ER diagram and the history/progress page powered by `user_stats` and the session queries. Optionally show a Neon branch.
- [ ] Figma track: demo the permission explainer, the denied-recovery path, clear recording states, a keyboard-only run, the screen reader announcements, and the chart table alternatives.
- [ ] Adobe track: demo the record-button morph, live level meter, staged processing, and the dashboard reveal. Toggle reduced motion to show the accessible fallback.
- [ ] Privacy talking point: video never leaves the device, audio isn't stored, and the user can delete all their data.
- [ ] Browser camera and mic permissions are pre-granted on the demo laptop. Its OS-level privacy settings allow the browser. A spare USB mic is tested.
- [ ] Audience demo: record the same short pitch once for Young and once for Senior, then show how pacing targets, the Audience fit score, and the tips change.
- [ ] Known limitations slide: filler undercount mitigation (§5), English only, guest identity.
