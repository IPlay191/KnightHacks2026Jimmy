/**
 * Drizzle schema for Neon Postgres. Must generate the DDL in design §7.3.
 * Pure definitions (no secrets), so scripts and tests can import it.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { StoredFeedback } from "@/lib/coaching";
import type { FillerBreakdown, Interval, TimedText, TimelineWindow, VisualMetrics } from "@/lib/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const userKind = pgEnum("user_kind", ["guest", "member", "template"]);
export const motionPref = pgEnum("motion_pref", ["system", "reduce", "full"]);
export const sessionStatus = pgEnum("session_status", [
  "created",
  "uploading",
  "transcribed",
  "analyzing",
  "complete",
  "failed",
]);
export const pipelineStage = pgEnum("pipeline_stage", ["transcribing", "metrics", "coaching", "saving"]);
export const chunkStatus = pgEnum("chunk_status", ["pending", "transcribing", "done", "failed"]);
export const mediaStorage = pgEnum("media_storage", ["none", "blob"]);
export const timingSource = pgEnum("timing_source", ["asr_word", "asr_segment", "interpolated"]);
export const fillerStatus = pgEnum("filler_status", ["unambiguous", "confirmed", "rejected", "unreviewed"]);
export const feedbackSource = pgEnum("feedback_source", ["llm", "rules"]);
export const audienceType = pgEnum("audience_type", ["general", "young", "teen", "senior"]);
export const audienceFitSource = pgEnum("audience_fit_source", ["combined", "readability_only"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: userKind("kind").notNull().default("guest"),
    displayName: text("display_name").notNull().default("Speaker"),
    email: text("email"),
    authProvider: text("auth_provider"),
    authSubject: text("auth_subject"),
    createdIpHash: text("created_ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    unique("users_auth_uq").on(t.authProvider, t.authSubject),
    uniqueIndex("users_email_lower_uq")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL`),
    index("users_ip_created_idx")
      .on(t.createdIpHash, t.createdAt)
      .where(sql`${t.createdIpHash} IS NOT NULL`),
    check("users_display_name_len", sql`char_length(${t.displayName}) BETWEEN 1 AND 40`),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    targetWpmMin: smallint("target_wpm_min").notNull().default(130),
    targetWpmMax: smallint("target_wpm_max").notNull().default(160),
    customFillers: text("custom_fillers").array().notNull().default(sql`'{}'::text[]`),
    defaultAudience: audienceType("default_audience").notNull().default("general"),
    motionPreference: motionPref("motion_preference").notNull().default("system"),
    autoAdvanceReport: boolean("auto_advance_report").notNull().default(true),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("settings_wpm_min_range", sql`${t.targetWpmMin} BETWEEN 80 AND 200`),
    check("settings_wpm_max_range", sql`${t.targetWpmMax} BETWEEN 100 AND 220`),
    check("settings_wpm_order", sql`${t.targetWpmMin} < ${t.targetWpmMax}`),
    check("settings_fillers_count", sql`cardinality(${t.customFillers}) <= 20`),
  ],
);

export const userStats = pgTable(
  "user_stats",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    completedSessions: integer("completed_sessions").notNull().default(0),
    totalSpeakingMs: bigint("total_speaking_ms", { mode: "number" }).notNull().default(0),
    bestOverallScore: smallint("best_overall_score"),
    lastSessionAt: ts("last_session_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("stats_best_range", sql`${t.bestOverallScore} BETWEEN 0 AND 100`)],
);

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    goal: text("goal"),
    status: sessionStatus("status").notNull().default("created"),
    stage: pipelineStage("stage"),
    failedStage: pipelineStage("failed_stage"),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms").notNull(),
    expectedChunks: smallint("expected_chunks").notNull(),
    timeZone: text("time_zone").notNull().default("UTC"),
    audience: audienceType("audience").notNull().default("general"),
    audienceProfileVersion: smallint("audience_profile_version").notNull().default(1),
    sampleRate: integer("sample_rate").notNull().default(16000),
    videoCaptured: boolean("video_captured").notNull().default(false),
    mediaStorage: mediaStorage("media_storage").notNull().default("none"),
    mediaUrl: text("media_url"),
    isSample: boolean("is_sample").notNull().default(false),
    analysisAttempts: smallint("analysis_attempts").notNull().default(0),
    asrModel: text("asr_model"),
    llmModel: text("llm_model"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("sessions_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("sessions_user_completed_idx")
      .on(t.userId, t.completedAt.desc())
      .where(sql`${t.status} = 'complete'`),
    index("sessions_user_audience_completed_idx")
      .on(t.userId, t.audience, t.completedAt.desc())
      .where(sql`${t.status} = 'complete'`),
    index("sessions_inflight_idx")
      .on(t.status, t.updatedAt)
      .where(sql`${t.status} IN ('uploading', 'analyzing')`),
    check("sessions_title_len", sql`char_length(${t.title}) <= 80`),
    check("sessions_goal_len", sql`char_length(${t.goal}) <= 200`),
    check("sessions_duration_range", sql`${t.durationMs} BETWEEN 10000 AND 330000`),
    check("sessions_expected_chunks", sql`${t.expectedChunks} BETWEEN 1 AND 17`),
    check("sessions_time_zone_len", sql`char_length(${t.timeZone}) <= 64`),
    check("sessions_sample_rate", sql`${t.sampleRate} = 16000`),
    check("sessions_attempts_range", sql`${t.analysisAttempts} BETWEEN 0 AND 3`),
    check("sessions_complete_has_time", sql`(${t.status} = 'complete') = (${t.completedAt} IS NOT NULL)`),
  ],
);

export const audioChunks = pgTable(
  "audio_chunks",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    chunkIndex: smallint("chunk_index").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    status: chunkStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    voicedRatio: real("voiced_ratio"),
    silences: jsonb("silences").$type<Interval[]>().notNull().default(sql`'[]'::jsonb`),
    asrText: text("asr_text"),
    asrSegments: jsonb("asr_segments").$type<TimedText[]>(),
    asrWordLevel: boolean("asr_word_level").notNull().default(false),
    asrModel: text("asr_model"),
    asrLatencyMs: integer("asr_latency_ms"),
    errorCode: text("error_code"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.chunkIndex] }),
    check("chunks_index_range", sql`${t.chunkIndex} BETWEEN 0 AND 16`),
    check("chunks_start_nonneg", sql`${t.startMs} >= 0`),
    check("chunks_span", sql`${t.endMs} > ${t.startMs} AND ${t.endMs} - ${t.startMs} <= 30000`),
    check("chunks_voiced_range", sql`${t.voicedRatio} BETWEEN 0 AND 1`),
  ],
);

export const transcripts = pgTable(
  "transcripts",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    language: text("language").notNull().default("en"),
    wordCount: integer("word_count").notNull(),
    timingGranularity: timingSource("timing_granularity").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("transcripts_word_count", sql`${t.wordCount} >= 0`)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    wordCount: smallint("word_count").notNull(),
    timingSource: timingSource("timing_source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.seq] }),
    check("segments_span", sql`${t.endMs} >= ${t.startMs}`),
  ],
);

export const transcriptWords = pgTable(
  "transcript_words",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    segmentSeq: integer("segment_seq").notNull(),
    word: text("word").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    timingSource: timingSource("timing_source").notNull(),
    fillerPhrase: text("filler_phrase"),
    fillerStatus: fillerStatus("filler_status"),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.seq] }),
    check("words_len", sql`char_length(${t.word}) <= 64`),
    check("words_span", sql`${t.endMs} >= ${t.startMs}`),
  ],
);

export const sessionMetrics = pgTable(
  "session_metrics",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    metricsVersion: smallint("metrics_version").notNull(),
    durationMs: integer("duration_ms").notNull(),
    speakingMs: integer("speaking_ms").notNull(),
    wordCount: integer("word_count").notNull(),
    wpm: numeric("wpm", { precision: 5, scale: 1, mode: "number" }).notNull(),
    articulationWpm: numeric("articulation_wpm", { precision: 5, scale: 1, mode: "number" }).notNull(),
    wpmStddev: numeric("wpm_stddev", { precision: 5, scale: 1, mode: "number" }).notNull(),
    pauseCount: integer("pause_count").notNull(),
    longPauseCount: integer("long_pause_count").notNull(),
    longestPauseMs: integer("longest_pause_ms").notNull(),
    pauseRatio: numeric("pause_ratio", { precision: 4, scale: 3, mode: "number" }).notNull(),
    fillerCount: integer("filler_count").notNull(),
    fillersPerMin: numeric("fillers_per_min", { precision: 5, scale: 2, mode: "number" }).notNull(),
    fillerBreakdown: jsonb("filler_breakdown").$type<FillerBreakdown>().notNull(),
    wpmTimeline: jsonb("wpm_timeline").$type<TimelineWindow[]>().notNull(),
    pauses: jsonb("pauses").$type<Interval[]>().notNull(),
    readingGrade: numeric("reading_grade", { precision: 3, scale: 1, mode: "number" }).notNull(),
    targetWpmMin: smallint("target_wpm_min").notNull(),
    targetWpmMax: smallint("target_wpm_max").notNull(),
    targetGrade: numeric("target_grade", { precision: 3, scale: 1, mode: "number" }).notNull(),
    visualMetrics: jsonb("visual_metrics").$type<VisualMetrics>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("metrics_grade_range", sql`${t.readingGrade} BETWEEN 0 AND 18`)],
);

const score = (name: string) => smallint(name);

export const sessionScores = pgTable(
  "session_scores",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    scoringVersion: smallint("scoring_version").notNull(),
    overall: score("overall").notNull(),
    pacing: score("pacing").notNull(),
    fillers: score("fillers").notNull(),
    pauses: score("pauses").notNull(),
    clarity: score("clarity"),
    structure: score("structure"),
    audienceFit: score("audience_fit").notNull(),
    audienceFitSource: audienceFitSource("audience_fit_source").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("scores_overall_range", sql`${t.overall} BETWEEN 0 AND 100`),
    check("scores_pacing_range", sql`${t.pacing} BETWEEN 0 AND 100`),
    check("scores_fillers_range", sql`${t.fillers} BETWEEN 0 AND 100`),
    check("scores_pauses_range", sql`${t.pauses} BETWEEN 0 AND 100`),
    check("scores_clarity_range", sql`${t.clarity} BETWEEN 0 AND 100`),
    check("scores_structure_range", sql`${t.structure} BETWEEN 0 AND 100`),
    check("scores_audience_fit_range", sql`${t.audienceFit} BETWEEN 0 AND 100`),
  ],
);

export const coachingFeedback = pgTable(
  "coaching_feedback",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    source: feedbackSource("source").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: smallint("schema_version").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<StoredFeedback>().notNull(),
    attempts: smallint("attempts").notNull().default(1),
    latencyMs: integer("latency_ms"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("feedback_summary_len", sql`char_length(${t.summary}) <= 400`)],
);

export type UserRow = typeof users.$inferSelect;
export type SettingsRow = typeof userSettings.$inferSelect;
export type StatsRow = typeof userStats.$inferSelect;
export type SessionRow = typeof practiceSessions.$inferSelect;
export type ChunkRow = typeof audioChunks.$inferSelect;
export type MetricsRow = typeof sessionMetrics.$inferSelect;
export type ScoresRow = typeof sessionScores.$inferSelect;
export type FeedbackRow = typeof coachingFeedback.$inferSelect;
