/**
 * Seeds the sample history template (R18.1, R20.11): a `template` user with
 * 7 completed sessions over 21 days, an improving trend, and several
 * audiences. New guests get a copy when DEMO_SEED_ON_GUEST=true.
 *
 * Usage: pnpm db:seed [--reset]
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { BatchItem } from "drizzle-orm/batch";
import type { CoachingFeedback } from "@/lib/coaching";
import type { Audience, Interval, TimedText } from "@/lib/types";
import { normalizeCoaching } from "@/server/hf/parse";
import { finalizeAnalysis, prepareAnalysis } from "@/server/analysis/analyze";
import type { ChunkTranscript } from "@/server/analysis/transcript";
import { completionBatch } from "@/server/db/queries/completion";
import { recomputeStatsQuery } from "@/server/db/queries/stats";
import * as schema from "@/server/db/schema";

config({ path: ".env.local", quiet: true });
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (expected in .env.local)");
const db = drizzle(neon(url), { schema });
const reset = process.argv.includes("--reset");

interface SampleDef {
  daysAgo: number;
  title: string;
  goal: string;
  audience: Audience;
  wpm: number;
  longPauseEvery: number;
  sentences: string[];
  feedback: Omit<CoachingFeedback, "fillerReview" | "schemaVersion">;
}

const PITCH = [
  "So um today I want to tell you about a tool that helps you practice speaking out loud.",
  "Like most people I used to rush through every presentation and hope nobody noticed.",
  "You know that feeling when your heart races and the words just pour out too fast?",
  "Uh that was me at my first hackathon demo and honestly it did not go well.",
  "So we built a speech reviewer that listens to a practice run and gives you feedback.",
  "It measures your pace your pauses and the filler words you use without noticing.",
  "Then an open source language model reads your transcript and coaches you like a mentor would.",
  "Every session is saved so you can actually see yourself getting better over time.",
  "Basically it turns practice into a habit instead of a guessing game.",
  "Try it once this week and see what you learn about your own voice.",
];
const TEEN = [
  "Okay so picture this you are about to give a class presentation and your hands are shaking.",
  "Um I have been there and it is honestly the worst feeling.",
  "Here is the thing nobody tells you the people watching want you to do well.",
  "So I started practicing in front of my phone camera every night before a big talk.",
  "Like at first I hated watching myself but it got easier really fast.",
  "I noticed I said you know about twenty times in two minutes.",
  "Once I saw that I could fix it by just pausing for a second instead.",
  "Your voice is worth hearing and practice is how you make people listen.",
  "So this week pick one talk and record yourself just once.",
];
const YOUNG = [
  "Hi everyone today we are going to learn why the sky is blue.",
  "Have you ever looked up and wondered where the color comes from?",
  "Sunlight looks white but it is really made of every color mixed together.",
  "When sunlight hits the air the blue light bounces around the most.",
  "Um so that bouncing blue light is what we see all over the sky.",
  "At sunset the light travels farther and the blue gets lost on the way.",
  "That is why sunsets look orange and red and pink.",
  "Next time you go outside look up and say hello to all that bouncing blue light.",
];
const SENIOR = [
  "Good morning everyone and thank you for joining us today.",
  "First I want to explain how our new community garden will work.",
  "Each family can reserve one raised bed for the whole growing season.",
  "Next we will share tools in the shed by the front gate.",
  "The shed is open every morning from eight until noon.",
  "Finally we will meet on the first Saturday of each month to plan together.",
  "So to repeat the three key points reserve a bed share the tools and join our monthly meeting.",
  "Thank you and I look forward to seeing you in the garden.",
];

const fb = (o: Partial<SampleDef["feedback"]> & Pick<SampleDef["feedback"], "summary">): SampleDef["feedback"] => ({
  clarity: { score: 70, rationale: "Ideas are mostly concrete and easy to follow." },
  structure: { score: 70, hasClearOpening: true, hasClearClosing: true, rationale: "Clear opening and a direct close." },
  audienceFit: { score: 70, rationale: "The examples suit this audience well.", tips: ["Add one question that invites the audience in."] },
  pacingInsight: "Your pace was steady for most of the talk.",
  strengths: [{ title: "Personal story", detail: "Opening with your own experience makes the message believable." }],
  improvements: [
    { title: "Pause after key points", detail: "Give listeners a full breath of silence after each main idea.", category: "pauses", priority: "high", evidenceQuote: null, suggestedRewrite: null },
  ],
  practiceDrill: { title: "Pause on purpose", instructions: "Re-record the first minute and pause for a full breath after every key claim.", durationMinutes: 5 },
  ...o,
});

const SAMPLES: SampleDef[] = [
  {
    daysAgo: 20, title: "First hackathon pitch", goal: "2-minute demo for judges", audience: "general", wpm: 182, longPauseEvery: 3, sentences: PITCH,
    feedback: fb({
      summary: "A promising pitch with a relatable story. You rushed through most of it and leaned on fillers, so slow down and let your ideas land.",
      clarity: { score: 58, rationale: "The idea comes through, but fast delivery blurs the key points." },
      structure: { score: 62, hasClearOpening: true, hasClearClosing: false, rationale: "Strong hook, but the ending trails off without a clear ask." },
      pacingInsight: "Your pace ran well above your target, especially in the middle.",
      improvements: [
        { title: "Slow down", detail: "Aim for your target pace by pausing at the end of each sentence.", category: "pacing", priority: "high", evidenceQuote: null, suggestedRewrite: null },
        { title: "Cut the hedges", detail: "Replace 'like' and 'you know' with a short pause.", category: "fillers", priority: "high", evidenceQuote: null, suggestedRewrite: null },
        { title: "End with an ask", detail: "Finish with one sentence that tells judges what to do next.", category: "structure", priority: "medium", evidenceQuote: null, suggestedRewrite: "Try it today and tell us what you'd fix next." },
      ],
    }),
  },
  {
    daysAgo: 17, title: "Class presentation practice", goal: "Talk to my class about stage fright", audience: "teen", wpm: 171, longPauseEvery: 4, sentences: TEEN,
    feedback: fb({
      summary: "Relatable and honest, which teens respond to. Tighten the pace and drop a few verbal tics to sound more confident.",
      clarity: { score: 64, rationale: "Clear, everyday language with a couple of run-on sentences." },
      structure: { score: 66, hasClearOpening: true, hasClearClosing: true, rationale: "Good hook and a simple call to action." },
      audienceFit: { score: 72, rationale: "The school setting and honest tone fit a teen audience.", tips: ["Open with a question they've asked themselves.", "Keep examples about school and friends."] },
    }),
  },
  {
    daysAgo: 14, title: "Pitch, second try", goal: "2-minute demo for judges", audience: "general", wpm: 163, longPauseEvery: 5, sentences: PITCH,
    feedback: fb({
      summary: "Noticeably calmer than your first take. The story flows better; keep trimming fillers and add a stronger close.",
      clarity: { score: 68, rationale: "Key points are easier to follow at this pace." },
      structure: { score: 70, hasClearOpening: true, hasClearClosing: true, rationale: "The ending now includes an invitation to try it." },
    }),
  },
  {
    daysAgo: 11, title: "Science club: why the sky is blue", goal: "Explain a science idea to kids", audience: "young", wpm: 132, longPauseEvery: 6, sentences: YOUNG,
    feedback: fb({
      summary: "A fun, clear explanation with a great question up front. Kids will follow it easily; add one more hands-on moment.",
      clarity: { score: 80, rationale: "Short sentences and simple words make the idea easy to picture." },
      structure: { score: 78, hasClearOpening: true, hasClearClosing: true, rationale: "Question, explanation, and a memorable closing line." },
      audienceFit: { score: 84, rationale: "Simple vocabulary and a playful tone suit young listeners.", tips: ["Ask them to look up and point at the bluest part of the sky.", "Repeat the phrase 'bouncing blue light' once more."] },
    }),
  },
  {
    daysAgo: 7, title: "Stage fright talk, round two", goal: "Talk to my class about stage fright", audience: "teen", wpm: 152, longPauseEvery: 7, sentences: TEEN,
    feedback: fb({
      summary: "Confident and authentic. Your pace is right in range now, and the advice feels practical rather than preachy.",
      clarity: { score: 76, rationale: "Concrete advice with a clear takeaway." },
      structure: { score: 74, hasClearOpening: true, hasClearClosing: true, rationale: "A strong hook and a specific challenge to close." },
      audienceFit: { score: 80, rationale: "Honest, peer-to-peer tone that doesn't talk down.", tips: ["Share one more quick story from a real class presentation."] },
    }),
  },
  {
    daysAgo: 4, title: "Community garden announcement", goal: "Explain the garden plan to residents", audience: "senior", wpm: 128, longPauseEvery: 8, sentences: SENIOR,
    feedback: fb({
      summary: "Warm, well organized, and easy to follow. Clear signposting and a recap of the key points suit this audience well.",
      clarity: { score: 82, rationale: "Every point is concrete, with specific times and places." },
      structure: { score: 86, hasClearOpening: true, hasClearClosing: true, rationale: "First, next, finally, plus a recap. Excellent." },
      audienceFit: { score: 86, rationale: "Steady pace, respectful tone, and no jargon.", tips: ["Hand out a printed copy of the three key points.", "Pause briefly after each time and place you mention."] },
    }),
  },
  {
    daysAgo: 1, title: "Final pitch rehearsal", goal: "2-minute demo for judges", audience: "general", wpm: 146, longPauseEvery: 9, sentences: PITCH.map((s) => s.replace(/^(So um|Like|Uh|Basically) /i, "")),
    feedback: fb({
      summary: "Your strongest take yet: steady pace, purposeful pauses, and a clear ask. You sound like you believe in what you built.",
      clarity: { score: 84, rationale: "Crisp sentences and concrete benefits." },
      structure: { score: 82, hasClearOpening: true, hasClearClosing: true, rationale: "Story, problem, solution, and a direct call to action." },
      strengths: [
        { title: "Steady pace", detail: "You stayed within your target range from start to finish." },
        { title: "Clear call to action", detail: "Ending with a specific ask makes the pitch memorable." },
      ],
    }),
  },
];

/** Builds a chunk transcript with realistic timing and pauses. */
function buildChunks(def: SampleDef): { chunks: ChunkTranscript[]; durationMs: number } {
  const segments: TimedText[] = [];
  const silences: Interval[] = [{ startMs: 0, endMs: 600 }];
  let t = 600;
  def.sentences.forEach((sentence, i) => {
    const words = sentence.split(/\s+/).length;
    const dur = Math.round((words / def.wpm) * 60_000);
    segments.push({ text: sentence, startMs: t, endMs: t + dur });
    t += dur;
    const gap = (i + 1) % def.longPauseEvery === 0 ? 2400 : 450;
    silences.push({ startMs: t, endMs: t + gap });
    t += gap;
  });
  const durationMs = t;
  // One chunk per 28 s span keeps the shape of real uploads.
  const chunks: ChunkTranscript[] = [];
  let start = 0;
  let index = 0;
  while (start < durationMs) {
    const end = Math.min(durationMs, start + 28_000);
    const segs = segments.filter((s) => s.startMs >= start && s.startMs < end);
    chunks.push({
      index,
      startMs: start,
      endMs: end,
      text: segs.map((s) => s.text).join(" "),
      segments: segs.map((s) => ({ ...s, endMs: Math.min(s.endMs, end) })),
      wordLevel: false,
      silences: silences.filter((s) => s.startMs >= start && s.startMs < end).map((s) => ({ startMs: s.startMs, endMs: Math.min(s.endMs, end) })),
    });
    start = end;
    index++;
  }
  return { chunks, durationMs };
}

async function main() {
  let template = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.kind, "template")).limit(1))[0];
  if (template && !reset) {
    const existing = await db
      .select({ id: schema.practiceSessions.id })
      .from(schema.practiceSessions)
      .where(eq(schema.practiceSessions.userId, template.id))
      .limit(1);
    if (existing.length) {
      console.log("Sample template already seeded. Use --reset to rebuild it.");
      return;
    }
  }
  if (template && reset) {
    await db.delete(schema.practiceSessions).where(eq(schema.practiceSessions.userId, template.id));
  }
  if (!template) {
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(schema.users).values({ id, kind: "template", displayName: "Sample Speaker" }),
      db.insert(schema.userSettings).values({ userId: id }),
      db.insert(schema.userStats).values({ userId: id }),
    ]);
    template = { id };
  }
  const userId = template.id;
  const settings = { targetWpmMin: 130, targetWpmMax: 160, customFillers: [] as string[] };

  for (const def of SAMPLES) {
    const { chunks, durationMs } = buildChunks(def);
    const prep = prepareAnalysis(chunks, settings, def.audience);
    const confirmed = prep.detection.candidates.filter((c) => c.phrase === "like" || c.phrase === "you know").map((c) => c.id);
    const quoteSource = def.sentences.find((s) => s.split(" ").length > 8) ?? def.sentences[0]!;
    const quote = quoteSource.split(" ").slice(0, 7).join(" ");
    const raw: CoachingFeedback = {
      schemaVersion: 1,
      ...def.feedback,
      improvements: def.feedback.improvements.map((imp, i) => (i === 0 ? { ...imp, evidenceQuote: quote } : imp)),
      fillerReview: { confirmedCandidateIds: confirmed, note: confirmed.length ? "A few hedges like 'like' and 'you know' slipped in." : "" },
    };
    const feedback = normalizeCoaching(raw, {
      candidateIds: new Set(prep.detection.candidates.map((c) => c.id)),
      transcript: prep.transcript.fullText,
    });
    const analysis = finalizeAnalysis(prep, { source: "llm", feedback });
    const sessionId = crypto.randomUUID();
    const completedAt = new Date(Date.now() - def.daysAgo * 86_400_000 + 3_600_000 * 2);
    const createdAt = new Date(completedAt.getTime() - 90_000);
    const items: BatchItem<"pg">[] = [
      db.insert(schema.practiceSessions).values({
        id: sessionId,
        userId,
        title: def.title,
        goal: def.goal,
        status: "analyzing",
        durationMs: Math.max(10_000, durationMs),
        expectedChunks: chunks.length,
        timeZone: "America/New_York",
        audience: def.audience,
        videoCaptured: false,
        isSample: true,
        analysisAttempts: 1,
        asrModel: "openai/whisper-large-v3-turbo",
        createdAt,
        updatedAt: createdAt,
      }),
      ...completionBatch(db, analysis, {
        sessionId,
        userId,
        modelId: "meta-llama/Llama-3.3-70B-Instruct",
        attempts: 1,
        latencyMs: 6200,
        asrModel: "openai/whisper-large-v3-turbo",
        markComplete: true,
        completedAt,
        rewriteTranscript: true,
      }),
    ];
    await db.batch(items as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    console.log(`Seeded "${def.title}" (${def.audience}) overall ${analysis.scores.overall}`);
  }
  await db.batch([recomputeStatsQuery(db, userId)]);
  const count = await db
    .select({ id: schema.practiceSessions.id })
    .from(schema.practiceSessions)
    .where(and(eq(schema.practiceSessions.userId, userId), eq(schema.practiceSessions.status, "complete")));
  console.log(`Template user has ${count.length} completed sample sessions.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
