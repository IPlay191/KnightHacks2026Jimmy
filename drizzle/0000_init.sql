CREATE TYPE "public"."audience_fit_source" AS ENUM('combined', 'readability_only');--> statement-breakpoint
CREATE TYPE "public"."audience_type" AS ENUM('general', 'young', 'teen', 'senior');--> statement-breakpoint
CREATE TYPE "public"."chunk_status" AS ENUM('pending', 'transcribing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('llm', 'rules');--> statement-breakpoint
CREATE TYPE "public"."filler_status" AS ENUM('unambiguous', 'confirmed', 'rejected', 'unreviewed');--> statement-breakpoint
CREATE TYPE "public"."media_storage" AS ENUM('none', 'blob');--> statement-breakpoint
CREATE TYPE "public"."motion_pref" AS ENUM('system', 'reduce', 'full');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('transcribing', 'metrics', 'coaching', 'saving');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('created', 'uploading', 'transcribed', 'analyzing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."timing_source" AS ENUM('asr_word', 'asr_segment', 'interpolated');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('guest', 'member', 'template');--> statement-breakpoint
CREATE TABLE "audio_chunks" (
	"session_id" uuid NOT NULL,
	"chunk_index" smallint NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"status" "chunk_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"voiced_ratio" real,
	"silences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asr_text" text,
	"asr_segments" jsonb,
	"asr_word_level" boolean DEFAULT false NOT NULL,
	"asr_model" text,
	"asr_latency_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_chunks_session_id_chunk_index_pk" PRIMARY KEY("session_id","chunk_index"),
	CONSTRAINT "chunks_index_range" CHECK ("audio_chunks"."chunk_index" BETWEEN 0 AND 16),
	CONSTRAINT "chunks_start_nonneg" CHECK ("audio_chunks"."start_ms" >= 0),
	CONSTRAINT "chunks_span" CHECK ("audio_chunks"."end_ms" > "audio_chunks"."start_ms" AND "audio_chunks"."end_ms" - "audio_chunks"."start_ms" <= 30000),
	CONSTRAINT "chunks_voiced_range" CHECK ("audio_chunks"."voiced_ratio" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "coaching_feedback" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"source" "feedback_source" NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_summary_len" CHECK (char_length("coaching_feedback"."summary") <= 400)
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"goal" text,
	"status" "session_status" DEFAULT 'created' NOT NULL,
	"stage" "pipeline_stage",
	"failed_stage" "pipeline_stage",
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"expected_chunks" smallint NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"audience" "audience_type" DEFAULT 'general' NOT NULL,
	"audience_profile_version" smallint DEFAULT 1 NOT NULL,
	"sample_rate" integer DEFAULT 16000 NOT NULL,
	"video_captured" boolean DEFAULT false NOT NULL,
	"media_storage" "media_storage" DEFAULT 'none' NOT NULL,
	"media_url" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"analysis_attempts" smallint DEFAULT 0 NOT NULL,
	"asr_model" text,
	"llm_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "sessions_title_len" CHECK (char_length("practice_sessions"."title") <= 80),
	CONSTRAINT "sessions_goal_len" CHECK (char_length("practice_sessions"."goal") <= 200),
	CONSTRAINT "sessions_duration_range" CHECK ("practice_sessions"."duration_ms" BETWEEN 10000 AND 330000),
	CONSTRAINT "sessions_expected_chunks" CHECK ("practice_sessions"."expected_chunks" BETWEEN 1 AND 17),
	CONSTRAINT "sessions_time_zone_len" CHECK (char_length("practice_sessions"."time_zone") <= 64),
	CONSTRAINT "sessions_sample_rate" CHECK ("practice_sessions"."sample_rate" = 16000),
	CONSTRAINT "sessions_attempts_range" CHECK ("practice_sessions"."analysis_attempts" BETWEEN 0 AND 3),
	CONSTRAINT "sessions_complete_has_time" CHECK (("practice_sessions"."status" = 'complete') = ("practice_sessions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "session_metrics" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"metrics_version" smallint NOT NULL,
	"duration_ms" integer NOT NULL,
	"speaking_ms" integer NOT NULL,
	"word_count" integer NOT NULL,
	"wpm" numeric(5, 1) NOT NULL,
	"articulation_wpm" numeric(5, 1) NOT NULL,
	"wpm_stddev" numeric(5, 1) NOT NULL,
	"pause_count" integer NOT NULL,
	"long_pause_count" integer NOT NULL,
	"longest_pause_ms" integer NOT NULL,
	"pause_ratio" numeric(4, 3) NOT NULL,
	"filler_count" integer NOT NULL,
	"fillers_per_min" numeric(5, 2) NOT NULL,
	"filler_breakdown" jsonb NOT NULL,
	"wpm_timeline" jsonb NOT NULL,
	"pauses" jsonb NOT NULL,
	"reading_grade" numeric(3, 1) NOT NULL,
	"target_wpm_min" smallint NOT NULL,
	"target_wpm_max" smallint NOT NULL,
	"target_grade" numeric(3, 1) NOT NULL,
	"visual_metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_grade_range" CHECK ("session_metrics"."reading_grade" BETWEEN 0 AND 18)
);
--> statement-breakpoint
CREATE TABLE "session_scores" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"scoring_version" smallint NOT NULL,
	"overall" smallint NOT NULL,
	"pacing" smallint NOT NULL,
	"fillers" smallint NOT NULL,
	"pauses" smallint NOT NULL,
	"clarity" smallint,
	"structure" smallint,
	"audience_fit" smallint NOT NULL,
	"audience_fit_source" "audience_fit_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_overall_range" CHECK ("session_scores"."overall" BETWEEN 0 AND 100),
	CONSTRAINT "scores_pacing_range" CHECK ("session_scores"."pacing" BETWEEN 0 AND 100),
	CONSTRAINT "scores_fillers_range" CHECK ("session_scores"."fillers" BETWEEN 0 AND 100),
	CONSTRAINT "scores_pauses_range" CHECK ("session_scores"."pauses" BETWEEN 0 AND 100),
	CONSTRAINT "scores_clarity_range" CHECK ("session_scores"."clarity" BETWEEN 0 AND 100),
	CONSTRAINT "scores_structure_range" CHECK ("session_scores"."structure" BETWEEN 0 AND 100),
	CONSTRAINT "scores_audience_fit_range" CHECK ("session_scores"."audience_fit" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"word_count" smallint NOT NULL,
	"timing_source" "timing_source" NOT NULL,
	CONSTRAINT "transcript_segments_session_id_seq_pk" PRIMARY KEY("session_id","seq"),
	CONSTRAINT "segments_span" CHECK ("transcript_segments"."end_ms" >= "transcript_segments"."start_ms")
);
--> statement-breakpoint
CREATE TABLE "transcript_words" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"segment_seq" integer NOT NULL,
	"word" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"timing_source" "timing_source" NOT NULL,
	"filler_phrase" text,
	"filler_status" "filler_status",
	CONSTRAINT "transcript_words_session_id_seq_pk" PRIMARY KEY("session_id","seq"),
	CONSTRAINT "words_len" CHECK (char_length("transcript_words"."word") <= 64),
	CONSTRAINT "words_span" CHECK ("transcript_words"."end_ms" >= "transcript_words"."start_ms")
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"full_text" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"word_count" integer NOT NULL,
	"timing_granularity" "timing_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcripts_word_count" CHECK ("transcripts"."word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"target_wpm_min" smallint DEFAULT 130 NOT NULL,
	"target_wpm_max" smallint DEFAULT 160 NOT NULL,
	"custom_fillers" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_audience" "audience_type" DEFAULT 'general' NOT NULL,
	"motion_preference" "motion_pref" DEFAULT 'system' NOT NULL,
	"auto_advance_report" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_wpm_min_range" CHECK ("user_settings"."target_wpm_min" BETWEEN 80 AND 200),
	CONSTRAINT "settings_wpm_max_range" CHECK ("user_settings"."target_wpm_max" BETWEEN 100 AND 220),
	CONSTRAINT "settings_wpm_order" CHECK ("user_settings"."target_wpm_min" < "user_settings"."target_wpm_max"),
	CONSTRAINT "settings_fillers_count" CHECK (cardinality("user_settings"."custom_fillers") <= 20)
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"completed_sessions" integer DEFAULT 0 NOT NULL,
	"total_speaking_ms" bigint DEFAULT 0 NOT NULL,
	"best_overall_score" smallint,
	"last_session_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_best_range" CHECK ("user_stats"."best_overall_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "user_kind" DEFAULT 'guest' NOT NULL,
	"display_name" text DEFAULT 'Speaker' NOT NULL,
	"email" text,
	"auth_provider" text,
	"auth_subject" text,
	"created_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_uq" UNIQUE("auth_provider","auth_subject"),
	CONSTRAINT "users_display_name_len" CHECK (char_length("users"."display_name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "audio_chunks" ADD CONSTRAINT "audio_chunks_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_feedback" ADD CONSTRAINT "coaching_feedback_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_metrics" ADD CONSTRAINT "session_metrics_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_scores" ADD CONSTRAINT "session_scores_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_words" ADD CONSTRAINT "transcript_words_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_created_idx" ON "practice_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_completed_idx" ON "practice_sessions" USING btree ("user_id","completed_at" DESC NULLS LAST) WHERE "practice_sessions"."status" = 'complete';--> statement-breakpoint
CREATE INDEX "sessions_user_audience_completed_idx" ON "practice_sessions" USING btree ("user_id","audience","completed_at" DESC NULLS LAST) WHERE "practice_sessions"."status" = 'complete';--> statement-breakpoint
CREATE INDEX "sessions_inflight_idx" ON "practice_sessions" USING btree ("status","updated_at") WHERE "practice_sessions"."status" IN ('uploading', 'analyzing');--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email")) WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_ip_created_idx" ON "users" USING btree ("created_ip_hash","created_at") WHERE "users"."created_ip_hash" IS NOT NULL;