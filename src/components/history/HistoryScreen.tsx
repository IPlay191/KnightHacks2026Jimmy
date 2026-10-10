"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ToggleGroup } from "radix-ui";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Flame, Medal, Mic, Minus, Timer, Trash2, TrendingUp } from "lucide-react";
import { ProgressLineChart } from "@/components/charts/ProgressLineChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { AudienceBadge } from "@/components/shared/AudienceBadge";
import { Badge, Card } from "@/components/ui/Card";
import { ButtonLink, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAnnounce } from "@/components/ui/LiveAnnouncer";
import { CountUp } from "@/components/motion/useCountUp";
import { audienceLabel } from "@/lib/audience";
import { formatDate, formatDurationShort } from "@/lib/format";
import { deleteSession } from "@/lib/pipeline/api-client";
import { computeProgressStats } from "@/lib/progress";
import { scoreLabel } from "@/lib/scoring";
import { AUDIENCES, type Audience } from "@/lib/types";

export interface HistoryItem {
  id: string;
  title: string | null;
  audience: Audience;
  completedAt: string;
  timeZone: string;
  durationMs: number;
  speakingMs: number;
  isSample: boolean;
  overall: number;
  pacing: number;
  fillers: number;
  pauses: number;
  clarity: number | null;
  audienceFit: number;
}

/** History and progress (R12, R20.9). */
export function HistoryScreen({
  audience,
  page,
  totalPages,
  items,
  series,
  stats,
}: {
  audience: Audience | null;
  page: number;
  totalPages: number;
  items: HistoryItem[];
  series: HistoryItem[];
  stats: { completedSessions: number; totalSpeakingMs: number; bestOverallScore: number | null };
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const progress = useMemo(() => computeProgressStats(series), [series]);
  const sparkById = useMemo(() => {
    const map = new Map<string, number[]>();
    series.forEach((p, i) => map.set(p.id, series.slice(Math.max(0, i - 9), i + 1).map((x) => x.overall)));
    return map;
  }, [series]);
  const qs = (next: { page?: number; audience?: Audience | null }) => {
    const p = new URLSearchParams();
    const a = next.audience === undefined ? audience : next.audience;
    if (a) p.set("audience", a);
    const pg = next.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const s = p.toString();
    return s ? `/history?${s}` : "/history";
  };

  const trend = progress.trend;
  const TrendIcon = trend.kind === "improving" ? ArrowUpRight : trend.kind === "declining" ? ArrowDownRight : Minus;
  const trendText =
    trend.kind === "insufficient"
      ? "Not enough sessions yet"
      : `${trend.kind[0]!.toUpperCase()}${trend.kind.slice(1)} (${trend.delta > 0 ? "+" : ""}${trend.delta} points)`;
  const filterName = audience ? `${audienceLabel(audience)} audience` : "all audiences";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-h1">History</h1>
          <p className="mt-2 text-text-secondary">Track how your delivery changes from session to session.</p>
        </div>
        <ButtonLink href="/studio" icon={<Mic size={18} />}>
          New recording
        </ButtonLink>
      </div>

      <div className="flex flex-col gap-2">
        <span id="aud-filter-label" className="text-small text-text">
          Audience
        </span>
        <ToggleGroup.Root
          type="single"
          aria-labelledby="aud-filter-label"
          value={audience ?? "all"}
          onValueChange={(v) => {
            if (!v) return;
            router.push(qs({ audience: v === "all" ? null : (v as Audience), page: 1 }));
          }}
          className="flex flex-wrap gap-2"
        >
          {(["all", ...AUDIENCES] as const).map((a) => (
            <ToggleGroup.Item
              key={a}
              value={a}
              className="inline-flex min-h-10 items-center rounded-full border border-border-strong px-4 text-small text-text-secondary data-[state=on]:border-2 data-[state=on]:border-primary-soft data-[state=on]:bg-surface-raised data-[state=on]:font-semibold data-[state=on]:text-text"
            >
              {a === "all" ? "All" : audienceLabel(a)}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Summary stats
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat icon={<Mic size={18} />} label="Total sessions" sub="All audiences">
            <CountUp value={stats.completedSessions} />
          </Stat>
          <Stat icon={<Timer size={18} />} label="Speaking time" sub="All audiences">
            {formatDurationShort(stats.totalSpeakingMs)}
          </Stat>
          <Stat icon={<Medal size={18} />} label="Best score" sub="All audiences">
            {stats.bestOverallScore ?? "—"}
          </Stat>
          <Stat icon={<Flame size={18} />} label="Practice streak" sub={`Consecutive days, ${filterName}`}>
            {progress.streakDays} {progress.streakDays === 1 ? "day" : "days"}
          </Stat>
          <Stat icon={<TrendingUp size={18} />} label="Trend" sub={`Last 3 vs previous 3, ${filterName}`}>
            <span className="inline-flex items-center gap-1 text-h3" data-testid="trend">
              {trend.kind !== "insufficient" ? <TrendIcon aria-hidden="true" size={20} /> : null}
              {trendText}
            </span>
          </Stat>
        </ul>
      </section>

      {series.length === 0 ? (
        <Card className="text-center" data-testid="empty-history">
          <h2 className="text-h2">{audience ? `No ${audienceLabel(audience)} sessions yet` : "No sessions yet"}</h2>
          <p className="mt-2 text-text-secondary">Record a practice speech and your progress will appear here.</p>
          <ButtonLink href="/studio" className="mt-4" icon={<Mic size={18} />}>
            Record your first speech
          </ButtonLink>
        </Card>
      ) : (
        <>
          <Card>
            <ProgressLineChart data={series} />
          </Card>
          <section aria-labelledby="list-heading" className="flex flex-col gap-3">
            <h2 id="list-heading" className="text-h2">
              Sessions
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/sessions/${it.id}`}
                      className="font-semibold text-text underline-offset-4 hover:underline"
                    >
                      {it.title ?? "Practice session"}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-small text-text-muted">
                      <span>{formatDate(it.completedAt, it.timeZone)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDurationShort(it.durationMs)}</span>
                      <AudienceBadge audience={it.audience} />
                      {it.isSample ? <Badge tone="warning">Sample</Badge> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Sparkline values={sparkById.get(it.id) ?? []} />
                    <span className="inline-flex min-w-28 items-center justify-center gap-1.5 rounded-full border border-border-strong px-3 py-1 text-small">
                      <span className="font-semibold tabular text-text">{it.overall}</span>
                      <span className="text-text-secondary">{scoreLabel(it.overall)}</span>
                    </span>
                    <ConfirmDialog
                      trigger={
                        <IconButton aria-label={`Delete ${it.title ?? "practice session"}`}>
                          <Trash2 size={18} />
                        </IconButton>
                      }
                      title="Delete this session?"
                      description="Its transcript, scores, and coaching will be permanently removed and your stats updated."
                      confirmLabel="Delete session"
                      onConfirm={async () => {
                        try {
                          await deleteSession(it.id);
                          announce("Session deleted.");
                          router.refresh();
                        } catch {
                          announce("Couldn't delete the session. Try again.", { assertive: true });
                        }
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {totalPages > 1 ? (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
                {page > 1 ? (
                  <ButtonLink href={qs({ page: page - 1 })} variant="secondary" icon={<ChevronLeft size={18} />}>
                    Newer
                  </ButtonLink>
                ) : (
                  <span />
                )}
                <span className="text-small text-text-muted">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <ButtonLink href={qs({ page: page + 1 })} variant="secondary">
                    Older <ChevronRight aria-hidden="true" size={18} />
                  </ButtonLink>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, sub, children }: { icon: React.ReactNode; label: string; sub: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-4">
      <span className="flex items-center gap-2 text-small text-text-secondary">
        <span aria-hidden="true" className="text-primary-soft">
          {icon}
        </span>
        {label}
      </span>
      <span className="text-h2 tabular text-text">{children}</span>
      <span className="text-caption text-text-muted">{sub}</span>
    </li>
  );
}
