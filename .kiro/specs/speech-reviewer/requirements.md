# Requirements Document

## Introduction

AI Speech Reviewer is a browser-based practice tool. A speaker records a practice speech with their webcam and microphone. The app transcribes the audio with an open-source Whisper model on Hugging Face, computes delivery metrics (pacing, pauses, filler words) from the transcript timing and the audio itself, and asks an open-source LLM on Hugging Face for structured coaching feedback (clarity, structure, prioritized improvements). Results land in a readable, animated dashboard. Every session is stored in Neon Serverless Postgres so the speaker can track progress over time.

Before recording, the speaker picks who the speech is for (General, Young, Teen, or Senior audience). The pacing targets, pause tolerance, vocabulary expectations, and AI coaching all adapt to that audience, and the report adds an "Audience fit" score.

The product is built for a hackathon. Judges must be able to try it in under a minute with no sign-up, and it must visibly satisfy four judging tracks: Hugging Face (open-source AI), Neon (database), Figma (UI/UX and accessibility), and Adobe (visual aesthetics).

### Priority legend

- **[Must]**: required for the demo and judging.
- **[Should]**: planned for the MVP; drop only if time runs out.
- **[Stretch]**: only after all Must/Should work is complete.

### Assumptions

- A1. English-only speech for the MVP. The filler lexicon and coaching prompt are English.
- A2. Desktop and laptop browsers first (latest Chrome, Edge, Firefox, Safari). Mobile layouts must work and stay accessible, but mobile recording is best-effort.
- A3. Speech analysis is audio-based. The camera is used for self-view and local replay. Video is never uploaded in the MVP (see Open decision (b) in design.md).
- A4. Frictionless guest access is the default identity model. Full OAuth is deferred (see Open decision (a) in design.md).
- A5. Hosting is Vercel with the Node.js runtime. Neon is provisioned separately or through the Vercel Marketplace.
- A6. Maximum recording length is 5 minutes of captured audio (paused time excluded). Minimum analyzable length is 10 seconds. The database duration cap (R14.4, 330,000 ms) adds 30 s of tolerance above the 5:00 limit.
- A7. Calendar-day calculations (practice streak, R12.2) use the IANA time zone reported by the browser when each session is created.

## Glossary

- **Session**: one recorded practice attempt and everything derived from it.
- **Chunk**: a ≤28 s slice of 16 kHz mono audio, uploaded and transcribed independently.
- **WPM**: words per minute over total elapsed time. **Articulation rate**: words per minute over speaking time only (silences excluded).
- **Pause**: a silence ≥ 0.5 s. **Long pause**: a silence ≥ 2.0 s.
- **Filler**: a disfluency or discourse filler ("um", "uh", "like" used as filler, "you know", and similar).
- **Audience**: who the speech is for. One of **General** (adults, no special adjustment; the default), **Young** (children, about ages 6–12), **Teen** (ages 13–17), or **Senior** (older adults, about 65+).
- **Audience profile**: the grading parameters for one audience (target WPM band, target reading grade, long-pause tolerance, and coaching focus), defined in design.md §6.6.
- **Reading grade**: the Flesch-Kincaid grade level of the transcript, an approximate measure of vocabulary and sentence complexity.

---

## Judging criteria traceability

| Hackathon constraint | How it is satisfied | Requirement IDs |
|---|---|---|
| Hugging Face: open-source speech-to-text (Whisper) | `openai/whisper-large-v3-turbo` through HF Inference Providers, with `openai/whisper-large-v3` as fallback | 6.1–6.8 |
| Hugging Face: open-source LLM analysis | `meta-llama/Llama-3.3-70B-Instruct` through the HF router (OpenAI-compatible chat completions), with strict JSON schema output and Zod validation/repair | 8.1–8.9, 7.5, 7.6 |
| Neon Serverless Postgres | Profiles, settings, sessions, chunks, transcripts (segment and word timing), metrics, scores, feedback, and aggregated progress stats, accessed through `@neondatabase/serverless` and Drizzle | 14.1–14.8, 12.1–12.6 |
| Figma: seamless flow (permissions, clear states, readable dashboard) | Pre-permission explainer, denied/blocked recovery, device picker, explicit recording state machine, staged processing, readable dashboard, audience picker with audience-aware grading | 2.x, 3.x, 4.x, 9.x, 10.x, 20.x |
| Figma: strict accessibility | WCAG 2.2 AA contrast, ARIA labels, live announcements, full keyboard support, reduced motion, transcript and captions | 16.1–16.12, NFR-3 |
| Adobe: Next.js + React + Tailwind | Next.js App Router (TypeScript), React, Tailwind CSS v4 | 15.1 |
| Adobe: GSAP micro-interactions | Record-button morph, state transitions, live level meter, staged processing, chart draw-ins, count-ups | 15.3–15.7 |
| Adobe: cohesive visual system and data viz | Tokenized palette, typography, spacing, elevation, and motion. Custom SVG charts | 15.2, 15.8, 10.x |

---

## Requirements

### Requirement 1: Landing and frictionless onboarding [Must]

**User Story:** As a first-time visitor (or hackathon judge), I want to start practicing or explore a sample report immediately, so that I can evaluate the product without creating an account.

#### Acceptance Criteria

1. WHEN a visitor opens `/` THEN the system SHALL show a hero section with the product value proposition, a primary "Start practicing" action, and a secondary "See a sample report" action.
2. WHEN a visitor without an identity cookie activates "Start practicing" THEN the system SHALL create a guest profile, set a signed, httpOnly identity cookie, and navigate to `/studio` within 2 s on a fast 4G network profile.
3. WHEN a guest profile is created and sample data is enabled (`DEMO_SEED_ON_GUEST=true`) THEN the system SHALL copy a seeded sample history (at least 6 completed sessions spread over at least 14 days) into the new profile, flagged as sample data.
4. WHEN a visitor activates "See a sample report" THEN the system SHALL create (or reuse) the guest profile and open the most recent sample session report. WHEN sample data is disabled, or the visitor's existing profile has no sample sessions (for example, after 13.5), THEN the system SHALL NOT show the "See a sample report" action.
5. WHEN a visitor already has a valid identity cookie THEN the system SHALL reuse that profile and SHALL NOT create a duplicate.
6. The landing page SHALL explain in plain language what data is captured and where it goes: video stays on the device, audio is sent for transcription and not stored, and transcripts and scores are stored.

### Requirement 2: Camera and microphone permissions [Must]

**User Story:** As a speaker, I want a clear explanation before the browser asks for my camera and microphone, and a clear way to recover if I deny access, so that I am never stuck.

#### Acceptance Criteria

1. WHEN the studio loads and permission state is unknown or "prompt" THEN the system SHALL show a pre-permission explainer that says why each device is needed and what is stored, with an "Enable camera & mic" button. The system SHALL NOT trigger the browser prompt before the user activates that button.
2. WHEN the Permissions API reports both devices as already granted THEN the system SHALL skip the explainer and go directly to the ready state.
3. WHEN the user activates "Enable camera & mic" THEN the system SHALL request audio and video together, and SHALL show a "Waiting for your browser…" state while the prompt is open.
4. IF the user denies or the browser blocks access (`NotAllowedError`) THEN the system SHALL show a recovery panel with browser-specific steps to re-enable access, a "Try again" button, and a "Continue with microphone only" option that requests audio only. IF the audio-only request is also refused THEN the system SHALL show the same recovery panel without that option.
5. IF no camera or microphone is found (`NotFoundError`) THEN the system SHALL say which device is missing. A missing camera SHALL allow audio-only mode. A missing microphone SHALL block recording with a clear message.
6. IF the device is in use by another application (`NotReadableError`) THEN the system SHALL tell the user to close other apps using it and offer "Try again".
7. IF the requested constraints cannot be satisfied (`OverconstrainedError`) THEN the system SHALL retry once with relaxed constraints (no resolution constraint) before showing an error.
8. IF the page is not in a secure context THEN the system SHALL explain that HTTPS is required and SHALL NOT call `getUserMedia`.

### Requirement 3: Device selection and pre-flight check [Must]

**User Story:** As a speaker, I want to choose my camera and microphone and confirm that they work before recording, so that I don't waste a take.

#### Acceptance Criteria

1. WHEN permission is granted THEN the system SHALL show a mirrored live camera preview, a live microphone level meter, and device pickers for camera and microphone.
2. WHEN the user selects a different device THEN the system SHALL switch the live stream to that device within 1 s, without reloading, and SHALL remember the choice on this browser.
3. WHEN devices are connected or disconnected (`devicechange`) THEN the system SHALL refresh the device lists. IF the active device is removed THEN the system SHALL fall back to the default device and announce the change.
4. WHILE in the ready state THEN the system SHALL show a text mic-check status ("We can hear you", "Too quiet: move closer", "Too loud: move back") based on the smoothed input level, using level thresholds defined in design.md. It SHALL NOT rely on the meter's color alone.
5. The ready state SHALL include an optional speech title field (max 80 characters), an optional "What is this speech for?" goal field (max 200 characters), and the audience picker (20.2).

### Requirement 4: Recording session control [Must]

**User Story:** As a speaker, I want obvious, consistent recording controls and states, so that I always know whether I am being recorded.

#### Acceptance Criteria

1. The studio SHALL expose exactly one primary control whose label and visual form reflect the current state: "Start recording" (ready), "Cancel" (countdown), "Stop recording" (recording/paused).
2. WHEN the user activates "Start recording" THEN the system SHALL run a 3-second visible countdown that can be cancelled with the Cancel button or the Escape key, and then begin recording.
3. WHILE recording THEN the system SHALL show a persistent "Recording" text badge with an icon, an elapsed timer (mm:ss), and the remaining time. It SHALL NOT use color alone to indicate state.
4. [Should] WHILE recording THEN the system SHALL offer Pause and Resume. Paused time SHALL be excluded from the captured audio and from metrics, and the badge SHALL read "Paused".
5. WHEN elapsed recording time (paused time excluded) reaches 4:30 THEN the system SHALL warn that 30 seconds remain (visually and through a polite live announcement).
6. WHEN elapsed recording time (paused time excluded) reaches 5:00 THEN the system SHALL stop automatically and continue to processing.
7. WHEN the user stops a recording shorter than 10 seconds THEN the system SHALL keep the user in the studio, explain that at least 10 seconds are needed, and offer "Record again". The system SHALL NOT upload anything.
8. WHEN the user activates "Discard" during recording or paused state THEN the system SHALL ask for confirmation in an accessible dialog and, if confirmed, discard all captured media and return to ready.
9. WHEN recording stops normally THEN the system SHALL release the camera and microphone (stop all tracks) once audio capture is finalized, so the browser's recording indicator turns off.
10. IF the microphone track ends unexpectedly during recording THEN the system SHALL stop recording, keep audio captured so far, and offer "Analyze what I have" if ≥ 10 s was captured, or "Record again" otherwise.

### Requirement 5: Client-side audio preparation and upload [Must]

**User Story:** As a speaker, I want my recording uploaded quickly and reliably, so that I get feedback fast even on modest connections.

#### Acceptance Criteria

1. WHILE recording THEN the system SHALL capture raw microphone PCM through the Web Audio API in parallel with the MediaRecorder video, independent of browser codec support.
2. WHEN recording stops THEN the system SHALL resample the captured audio to 16 kHz mono and split it into chunks of at most 28 s (only the final chunk may be shorter than 18 s), cutting at the quietest 100 ms window between 18 s and 28 s from the chunk start (or at 28 s if no window is found).
3. Each chunk SHALL be encoded as 16-bit PCM WAV (≤ 900 KB) and uploaded in its own request with its start and end offsets in milliseconds.
4. The system SHALL upload at most 3 chunks concurrently and SHALL retry a failed chunk up to 2 times with backoff when the server reports a retryable error.
5. The full video recording (camera on) SHALL remain in browser memory for local replay only and SHALL NOT be uploaded.
6. WHEN all chunks are accepted THEN the system SHALL request analysis for the session.

### Requirement 6: Speech-to-text transcription with Hugging Face Whisper [Must]

**User Story:** As a speaker, I want an accurate transcript of my speech with timing, so that my coaching is grounded in what I actually said.

#### Acceptance Criteria

1. WHEN the server receives a valid chunk THEN it SHALL transcribe it with the configured open-source Whisper model (`HF_ASR_MODEL`, default `openai/whisper-large-v3-turbo`) through Hugging Face Inference Providers, requesting timestamps.
2. WHEN the ASR response includes timestamped chunks THEN the system SHALL store segment-level timings offset to the session timeline.
3. IF the ASR response has no timestamps THEN the system SHALL derive segment timing by spreading words across the chunk's voiced regions, and SHALL mark the timing as interpolated.
4. WHEN a chunk's voiced ratio is below 5% THEN the system SHALL skip the ASR call for that chunk and record it as silent.
5. IF the ASR model is loading, rate-limited, or temporarily unavailable (HTTP 429/502/503/504) THEN the system SHALL retry with exponential backoff (max 3 attempts, honoring `Retry-After` and capped at 8 s per wait) and then try the fallback model (`HF_ASR_FALLBACK_MODEL`, default `openai/whisper-large-v3`) once.
6. IF transcription still fails THEN the chunk SHALL be marked failed and the client SHALL receive a retryable error so the user can retry without re-recording.
7. WHEN all chunks are transcribed THEN the system SHALL assemble the full transcript in chunk order, with word-level entries whose timing source is recorded (`asr_word`, `asr_segment`, or `interpolated`).
8. The system SHALL record which ASR model and provider produced each chunk.

### Requirement 7: Deterministic delivery metrics [Must]

**User Story:** As a speaker, I want objective, reproducible numbers for my pace, pauses, and filler words, so that I can trust the scores and compare sessions fairly.

#### Acceptance Criteria

1. The system SHALL compute these metrics on the server with deterministic code (not the LLM): duration, speaking time, word count, overall WPM, articulation rate, WPM per 15-second window, WPM standard deviation, pause count (≥ 0.5 s), long-pause count (≥ 2.0 s), longest pause, and pause ratio.
2. Silence intervals SHALL be detected from the uploaded PCM with an adaptive energy threshold (20 ms frames, noise floor + 10 dB, minimum silence 300 ms) and offset to the session timeline.
3. The system SHALL count unambiguous fillers (um, umm, uhm, uh, uhh, er, erm, ah, hmm, mm, mhm) from the transcript, case- and punctuation-insensitive.
4. The system SHALL identify candidate contextual fillers (like, so, basically, actually, literally, right, okay, well, you know, I mean, kind of, sort of, and any user-defined filler words) with their positions and surrounding context.
5. The final filler count SHALL equal unambiguous fillers plus LLM-confirmed contextual fillers. Confirmed counts per phrase SHALL be capped at that phrase's candidate count. WHEN feedback comes from rules (8.6) THEN contextual candidates SHALL be excluded from the count.
6. The system SHALL compute sub-scores (0–100) for pacing, fillers, and pauses from documented formulas using the session's audience profile (20.4), and an overall score as a weighted average of available sub-scores (clarity and structure come from the LLM; audience fit is defined in 20.6). Weights SHALL renormalize when a component is unavailable.
7. Recomputing metrics for the same inputs and `metrics_version` SHALL produce identical results.
8. The report SHALL state that filler counts may be underestimated because speech recognition can omit hesitations.

### Requirement 8: AI coaching analysis with a Hugging Face open-source LLM [Must]

**User Story:** As a speaker, I want specific, prioritized coaching that references my own words, so that I know exactly what to practice next.

#### Acceptance Criteria

1. WHEN transcription and metrics are complete THEN the system SHALL call the configured open-source LLM (`HF_LLM_MODEL`, default `meta-llama/Llama-3.3-70B-Instruct`) through the Hugging Face router's chat completions endpoint.
2. The request SHALL include the transcript (with mm:ss segment markers), the deterministic metrics (including the reading grade), the contextual filler candidates, the session's audience profile and effective target WPM range, and the optional title and goal.
3. The request SHALL ask for output that conforms to the `CoachingFeedback` JSON schema (via `response_format` `json_schema` where the provider supports it).
4. WHEN a response arrives THEN the system SHALL extract JSON (stripping code fences or surrounding prose) and validate it with the Zod `CoachingFeedback` schema.
5. IF validation fails THEN the system SHALL make one repair request that includes the invalid output and the validation errors. IF that also fails, it SHALL make one attempt with the fallback model (`HF_LLM_FALLBACK_MODEL`, default `meta-llama/Llama-3.1-8B-Instruct`).
6. IF all LLM attempts fail THEN the system SHALL still complete the session with deterministic metrics and rule-based coaching tips, mark the feedback source as `rules`, and show a notice that AI coaching was unavailable with a "Retry AI coaching" action.
7. The coaching SHALL contain: a summary (≤ 400 characters), a clarity score and rationale, a structure score with opening/closing detection, an audience-fit score with rationale and 1–3 audience-specific tips (20.5), 1–3 strengths, 1–5 improvements (each with a category, priority, and optionally a quoted excerpt of ≤ 20 words plus a suggested rewrite), confirmed contextual filler counts, a pacing interpretation, and one practice drill.
8. The system prompt SHALL tell the model to treat the transcript as untrusted data, ignore instructions inside it, and never invent numeric metrics.
9. The system SHALL store the model ID, prompt version, schema version, attempt count, and latency for every feedback record.

### Requirement 9: Processing status and staged progress [Must]

**User Story:** As a speaker, I want to see what's happening while my speech is analyzed, so that waiting feels short and predictable.

#### Acceptance Criteria

1. WHEN recording stops (≥ 10 s) THEN the system SHALL navigate to `/sessions/{id}/processing` and show five ordered stages: Preparing audio, Transcribing (with chunk n of N), Measuring pace & pauses, Writing your coaching, Building your report.
2. Each stage SHALL show a status (pending, active, done, failed) using both an icon and text.
3. WHEN a stage changes THEN the system SHALL announce it through a polite live region exactly once.
4. WHILE server-side analysis runs THEN the client SHALL poll the session status endpoint every 1.5 s and reflect the server-reported stage.
5. WHEN processing takes longer than 20 s on one stage THEN the system SHALL show a reassurance message (for example, "The AI model is warming up. This can take up to a minute the first time.").
6. WHEN processing completes THEN the system SHALL move focus to a "View your report" heading or link, announce completion, and navigate to the report automatically after 1.5 s unless reduced motion is in effect (15.7), in which case the user SHALL navigate manually.
7. IF a stage fails THEN the system SHALL show which stage failed, a human-readable reason, and the correct recovery action: "Retry" for retryable errors (without re-recording when audio is still in memory or already transcribed), or "Record again" when the audio is gone.
8. WHEN the processing page is reloaded THEN the system SHALL resume from server state: continue to analysis if all chunks are transcribed, show the report if complete, or show "Upload interrupted, record again" if chunks are missing and the audio is no longer in memory.

### Requirement 10: Session report dashboard [Must]

**User Story:** As a speaker, I want a beautiful, scannable report, so that I understand my performance in seconds and can dig deeper when I want to.

#### Acceptance Criteria

1. The report at `/sessions/{id}` SHALL show, in this visual order: an overall score ring with a qualitative label, five sub-score tiles (Pacing, Filler words, Pauses, Clarity, Audience fit) with primary values, a "Top 3 things to work on" list, a pace timeline chart, a filler breakdown chart, strengths, the practice drill, and the transcript.
2. Each sub-score tile SHALL show the raw metric with units (for example, "148 WPM", "3.2 fillers/min", "Grade 6.2"), the target range for the session's audience, and a delta versus the previous completed session for the same audience when one exists (20.8).
3. The pace timeline SHALL plot WPM per 15-second window, shade the target WPM band, mark long pauses, and mark filler positions.
4. The filler breakdown SHALL list each filler term with its count, sorted by count, and indicate which counts were AI-confirmed.
5. Every chart SHALL have a text summary (accessible name/description) and a "Show data as table" toggle that reveals an equivalent HTML table.
6. The report SHALL show the feedback source (AI model name, or "Rule-based tips") and the filler underestimation notice from 7.8.
7. WHEN the session belongs to another user or does not exist THEN the system SHALL return a not-found page. It SHALL NOT reveal whether the session exists.
8. The report SHALL remain readable and usable at 320 px width and at 200% zoom without horizontal scrolling, except inside chart containers.
9. WHEN clarity is unavailable (rule-based feedback) THEN the Clarity tile SHALL show "Not available" with the reason in text, and the overall score SHALL use the renormalized weights from 7.6.

### Requirement 11: Transcript and replay [Must]

**User Story:** As a speaker, I want to read my transcript with problem spots highlighted and, right after recording, replay my video with captions, so that I can see and hear what to fix.

#### Acceptance Criteria

1. The transcript panel SHALL show segments with mm:ss timestamps, highlight fillers (underline plus a text label for screen readers, not color alone), and insert inline markers for long pauses ("2.4 s pause").
2. WHEN the session was just recorded in the current tab with camera on THEN the report SHALL show a local video player with captions generated from the transcript segments (WebVTT).
3. WHEN the user activates a transcript timestamp and local video is available THEN the player SHALL seek to that time.
4. WHEN local video is unavailable (reload, other device, sample data, audio-only) THEN the system SHALL hide the player and show "Video is kept only on your device during the session" instead of an error.
5. [Should] The user SHALL be able to copy the transcript as plain text.

### Requirement 12: History and progress tracking [Must]

**User Story:** As a returning speaker, I want to see how my scores and habits change over time, so that I stay motivated and know whether practice is working.

#### Acceptance Criteria

1. The history page at `/history` SHALL show a progress chart of overall score across completed sessions (oldest to newest), with toggles for Pacing, Filler words, Pauses, and Clarity series.
2. The history page SHALL show summary stats: total sessions, total speaking time, best overall score, current practice streak (consecutive calendar days with a completed session, ending today or yesterday, per A7), and the trend of the mean overall score of the last 3 completed sessions versus the 3 before, with the numeric delta. The trend SHALL be "improving" when the delta is ≥ +3, "declining" when ≤ −3, and "steady" otherwise. WHEN fewer than 6 completed sessions exist THEN the trend SHALL read "Not enough sessions yet".
3. The history page SHALL list sessions newest first with title, date, duration, overall score as a score chip with its qualitative label, and a link to the report. It SHALL paginate 20 per page.
4. Sample sessions SHALL show a "Sample" badge.
5. WHEN the user has no completed sessions THEN the system SHALL show an empty state with a "Record your first speech" action.
6. The user's aggregate stats SHALL update in the same database batch that marks a session complete.

### Requirement 13: Settings, preferences, and data control [Must]

**User Story:** As a speaker, I want to tune targets and control my data, so that the coaching fits me and I stay in control of my privacy.

#### Acceptance Criteria

1. The settings page SHALL let the user set a display name (1–40 characters), a default audience (20.1), a target WPM range for the General audience (min 80–200, max 100–220, min < max, defaults 130–160), and up to 20 custom filler words (each 1–24 characters: letters, spaces, apostrophes).
2. The settings page SHALL offer a motion preference: "Match system" (default), "Reduce motion", or "Full motion".
3. The report and history pages SHALL let the user delete an individual session, and the settings page SHALL let the user delete all their data, each with an accessible confirmation dialog.
4. WHEN the user deletes all data THEN the system SHALL delete the user row and all dependent rows (cascade), clear the identity cookie, and return to the landing page.
5. The settings page SHALL let the user remove sample sessions.
6. IF a settings value fails validation THEN the system SHALL keep the user's input, show an inline error tied to the field (`aria-describedby`), and move focus to the first invalid field.
7. WHEN a session or the sample sessions are deleted THEN the system SHALL recompute the user's aggregate stats (12.2) in the same database batch as the delete.

### Requirement 14: Data persistence with Neon Serverless Postgres [Must]

**User Story:** As the product team, we want a well-structured relational schema on Neon, so that sessions, transcripts, scores, and progress are durable, queryable, and consistent.

#### Acceptance Criteria

1. The system SHALL use Neon Serverless Postgres as its only database, accessed through `@neondatabase/serverless` with Drizzle ORM, and with schema changes managed by drizzle-kit migrations committed to the repo.
2. The schema SHALL store user profiles, user settings, user aggregate stats, practice sessions (recording metadata and pipeline status), audio chunk processing records, transcripts, transcript segments, transcript words with timing, delivery metrics, scores, and coaching feedback.
3. All foreign keys from session-owned data SHALL cascade on delete.
4. Scores SHALL be constrained to 0–100 at the database level, and session duration SHALL be constrained to ≤ 330,000 ms (5:00 maximum plus 30 s tolerance, per A6).
5. The schema SHALL index sessions by `(user_id, created_at DESC)` to serve history queries.
6. Session completion (transcript, segments, words, metrics, scores, feedback, status = complete, user stats) SHALL be written atomically in a single Drizzle batch, so a session is never complete with partial data.
7. Pipeline status transitions SHALL be enforced with conditional updates so concurrent or duplicate requests cannot move a session backwards or run analysis twice.
8. Database credentials SHALL exist only in server-side environment variables. The app SHALL use the pooled connection string at runtime and the unpooled one for migrations.

### Requirement 15: Visual design system and motion [Must]

**User Story:** As a speaker, I want a polished, calm, premium interface with fluid motion, so that practicing feels rewarding instead of clinical.

#### Acceptance Criteria

1. The frontend SHALL be built with Next.js (App Router, TypeScript), React, and Tailwind CSS.
2. The UI SHALL use a single token source (CSS variables exposed through Tailwind `@theme`) for color, typography, spacing, radii, elevation, and motion. Components SHALL NOT hard-code hex values.
3. GSAP SHALL animate the transitions between recording states, including the record button morphing between circle (ready) and rounded square (recording) and the countdown.
4. GSAP SHALL drive the live microphone level meter with smoothing at ≥ 30 fps while the studio is visible.
5. GSAP SHALL animate the staged processing view (stage activation, progress fill, completion check).
6. GSAP SHALL animate dashboard reveals: score ring sweep, number count-ups, chart line/area draw-in, and staggered card entrances, triggered when each element first scrolls into view.
7. WHEN reduced motion is in effect (system preference or user setting) THEN all GSAP animations SHALL either be skipped (final state rendered immediately) or replaced with ≤ 150 ms opacity fades, and no element SHALL move, scale, or loop. The level meter SHALL update without easing or pulsing.
8. Charts SHALL use the categorical data palette from the design system, with every series distinguishable by more than color (direct labels, markers, or dash patterns).

### Requirement 16: Accessibility [Must]

**User Story:** As a speaker who uses a keyboard, screen reader, or magnification, or who is sensitive to motion, I want to complete every task independently, so that the product works for me.

#### Acceptance Criteria

1. All text SHALL meet WCAG 2.2 AA contrast (≥ 4.5:1 normal text, ≥ 3:1 large text), and UI component boundaries, focus indicators, and meaningful chart marks SHALL meet ≥ 3:1 against adjacent colors.
2. Every interactive element SHALL be reachable and operable by keyboard in a logical order, with a visible focus indicator (≥ 2 px, ≥ 3:1) that is never fully hidden by sticky content (WCAG 2.4.11).
3. Every page SHALL have a "Skip to main content" link, landmark regions (`header`, `nav`, `main`), one `h1`, and a logical heading hierarchy.
4. Icon-only buttons SHALL have accessible names (`aria-label`), and the primary record control's accessible name SHALL match its visible state label.
5. Recording state changes (ready, countdown start, recording started, paused, resumed, stopped, auto-stop warning) SHALL be announced through a polite live region. Errors SHALL be announced through an assertive live region.
6. The elapsed timer SHALL NOT be announced every second. It SHALL be exposed as `role="timer"` with `aria-live="off"`, with milestone announcements at each full minute and at 30 s remaining.
7. WHEN the view state changes (permission granted, recording complete, processing complete, error) THEN focus SHALL move to the new state's heading or primary action.
8. Dialogs SHALL trap focus, close on Escape, restore focus to the trigger, and be labelled.
9. Interactive targets SHALL be at least 24 × 24 CSS px (WCAG 2.5.8). The primary record control SHALL be at least 64 × 64 px.
10. All form fields SHALL have visible labels. Errors SHALL be programmatically associated and described in text.
11. The transcript SHALL serve as the text alternative for recorded audio and video, and local replay SHALL provide captions.
12. The app SHALL respect `prefers-reduced-motion` and the in-app motion setting (see 15.7). No content SHALL flash more than 3 times per second.

### Requirement 17: Error handling and resilience [Must]

**User Story:** As a speaker, I want failures explained plainly with a way forward, so that a flaky network or busy AI service doesn't cost me my recording.

#### Acceptance Criteria

1. Every API error response SHALL use one envelope `{ "error": { "code", "message", "retryable" } }` with a stable `code` from the documented catalog and the matching HTTP status.
2. User-facing error messages SHALL be human-readable, SHALL NOT expose stack traces, provider names in raw form, or tokens, and SHALL offer a next step.
3. WHILE captured audio is still in browser memory THEN no single upload or analysis failure SHALL require re-recording.
4. Server logs SHALL be structured JSON with session ID, stage, latency, upstream HTTP status, and attempt number. They SHALL NOT contain transcript text, audio, tokens, or raw IP addresses.
5. IF the database is unreachable THEN the API SHALL return `SERVICE_UNAVAILABLE` (503, retryable) and the UI SHALL show "We couldn't save your session. Retry." while audio remains in memory.

### Requirement 18: Demo readiness [Must]

**User Story:** As a team presenting to judges, we want a reliable, pre-warmed demo with realistic history, so that the live demo works on the first try.

#### Acceptance Criteria

1. A seed script SHALL create the sample history template (≥ 6 sessions over ≥ 14 days with an improving trend, realistic transcripts, metrics, and feedback).
2. A warm-up script SHALL send one short ASR request and one LLM request to Hugging Face to reduce cold-start latency before a demo.
3. The production deployment SHALL be reachable over HTTPS on a public Vercel URL with all environment variables configured.

### Requirement 19: Visual delivery analysis [Stretch]

**User Story:** As a speaker, I want feedback on eye contact and head movement, so that I can improve my on-camera presence.

#### Acceptance Criteria

1. WHERE the visual analysis feature flag is enabled and the camera is on THEN the system SHALL run an open-source face landmark model entirely in the browser during recording at ≤ 10 fps.
2. The system SHALL upload only aggregate metrics (eye-contact percentage and a head-stability score), never frames or landmarks.
3. WHEN visual metrics exist THEN the report SHALL show a "Presence" tile. When they don't exist, the tile SHALL be omitted, not shown empty.

### Requirement 20: Audience-aware grading [Must]

**User Story:** As a speaker, I want to choose who my speech is for (young children, teens, or seniors) and be graded against that audience, so that my coaching reflects what actually works for the people I'll be speaking to.

#### Acceptance Criteria

1. The settings page SHALL offer a default audience with four options: General (default), Young (ages 6–12), Teen (ages 13–17), and Senior (ages 65+). Each option SHALL show a one-line description of what changes.
2. WHEN the studio is in the ready state THEN the system SHALL show an audience picker preset to the user's default audience. The selected audience SHALL be sent when the session is created and SHALL NOT change after the session is created.
3. Each audience SHALL have a versioned audience profile (design.md §6.6) that defines its target WPM band, target maximum reading grade, long-pause tolerance, and coaching focus.
4. WHEN the audience is Young, Teen, or Senior THEN the pacing score SHALL use that profile's WPM band and the pauses score SHALL use that profile's long-pause tolerance. WHEN the audience is General THEN the pacing score SHALL use the user's target WPM range from settings (13.1).
5. The system SHALL compute the transcript's reading grade deterministically, and the LLM request SHALL include the audience profile and ask for an audience-fit score (0–100), a rationale, and 1–3 tips specific to that audience.
6. The audience-fit sub-score SHALL combine a deterministic readability score (reading grade versus the profile's target) with the LLM's audience-fit score, using the weights in design.md §6.5. WHEN feedback comes from rules (8.6) THEN audience fit SHALL use the readability score only and the report SHALL say so.
7. The report SHALL show the session's audience as a text badge in the header, an "Audience fit" tile with the reading grade and target ("Grade 6.2 · target ≤ 5"), and the audience-specific tips.
8. Deltas (10.2) SHALL compare only with the previous completed session for the same audience. WHEN none exists THEN the tile SHALL show "First Teen session" (or the matching audience name) instead of a delta.
9. The history page SHALL offer an audience filter (All, General, Young, Teen, Senior; default All) that applies to the progress chart, the trend (12.2), and the session list. Each session row SHALL show its audience badge.
10. The audience picker SHALL be a labelled radio group operable with arrow keys, with each option's description associated through `aria-describedby`, and selection SHALL NOT rely on color alone.
11. The sample history (18.1) SHALL include sessions for at least two different audiences.

---

## Non-Functional Requirements

### NFR-1: Performance

1. For a 2-minute speech, the time from Stop to report SHALL be ≤ 45 s at p50 with warm models, and ≤ 90 s at p95 including model cold starts.
2. Client-side audio preparation (resample, split, encode) for a 5-minute recording SHALL take ≤ 3 s on a 2020-era laptop.
3. The report page SHALL reach Largest Contentful Paint ≤ 2.5 s on a fast 4G profile. The landing page SHALL reach LCP ≤ 2.0 s.
4. Animations SHALL animate only `transform`, `opacity`, and SVG stroke properties, and SHALL sustain 60 fps on a mid-range laptop.
5. Each chunk upload request body SHALL be ≤ 1 MB, well under the Vercel 4.5 MB request body limit.

### NFR-2: Privacy and security

1. `HF_TOKEN`, `DATABASE_URL`, and `SESSION_SECRET` SHALL be read only in server-only modules and SHALL never be sent to the browser or logged.
2. Raw audio SHALL be held only in memory during a request and SHALL NOT be persisted by the app. Video SHALL never leave the device (MVP).
3. Every data access SHALL be scoped to the authenticated user ID in the data-access layer. Cross-user access SHALL return not-found.
4. The identity cookie SHALL be HMAC-signed, `HttpOnly`, `Secure` (in production), `SameSite=Lax`, and expire after 30 days. Mutating API routes SHALL reject requests whose `Origin` doesn't match the app origin.
5. All external inputs (request bodies, query params, headers used, WAV headers, LLM output) SHALL be validated with explicit limits (see design.md "Validation rules").
6. The app SHALL rate-limit per user: ≤ 25 sessions per rolling 24 h (sample sessions excluded), ≤ 17 distinct chunk indexes per session (the maximum a 5:00 recording can produce under 5.2; retries of the same index don't count), ≤ 3 analysis attempts per session. Guest creation SHALL be limited to ≤ 10 per hashed IP per hour.
7. LLM output SHALL be rendered as plain text through React. It SHALL never be injected as HTML.
8. Responses SHALL include a `Permissions-Policy` that allows camera and microphone only for the app origin, and a Content-Security-Policy that restricts scripts to self.

### NFR-3: Accessibility conformance

1. The app SHALL target WCAG 2.2 Level AA. Automated axe-core scans SHALL report zero serious or critical violations on every page and every studio state.
2. A manual keyboard-only walkthrough and a screen reader smoke test (NVDA + Chrome or VoiceOver + Safari) SHALL be completed before the demo. Automated checks alone can't establish full WCAG conformance. Full validation needs manual testing with assistive technologies and expert review.

### NFR-4: Reliability

1. HF calls SHALL use per-attempt timeouts (ASR 45 s, LLM 40 s), bounded retries, and model fallbacks as specified in requirements 6 and 8.
2. Chunk upload and analysis endpoints SHALL be idempotent: repeating a request SHALL NOT duplicate rows or double-count stats.
3. A session stuck in `analyzing` for more than 2 minutes SHALL be claimable for a new analysis attempt.

### NFR-5: Maintainability and quality

1. TypeScript `strict` mode, ESLint, and Prettier SHALL pass in CI before deploy.
2. Pure logic (metrics, silence detection, chunking, WAV encoding/parsing, scoring, LLM output parsing, the studio state machine) SHALL have unit tests.
3. Dependencies SHALL be pinned to exact versions.

---

## Out of Scope (MVP)

- Account sign-in with OAuth/email and cross-device sync (guest identity only. See Open decision (a)).
- Server-side storage of video or audio (see Open decision (b)).
- Languages other than English.
- Real-time (during-speech) transcription or live coaching.
- Team, coach, or sharing features. Public report links.
- Native mobile apps.
- Light theme (tokens are structured so it can be added later).
- Visual delivery analysis (requirement 19 is Stretch only).
- Audience types beyond General, Young, Teen, and Senior (for example, professional or technical audiences), and per-audience custom WPM targets.
