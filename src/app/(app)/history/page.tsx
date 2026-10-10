import type { Metadata } from "next";
import { HistoryScreen } from "@/components/history/HistoryScreen";
import { AUDIENCES, type Audience } from "@/lib/types";
import { getCurrentUser } from "@/server/auth/identity";
import { getStatsSummary, listHistoryPage, listProgressSeries, PAGE_SIZE } from "@/server/db/queries/history";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;
  const rawAudience = typeof sp.audience === "string" ? sp.audience : null;
  const audience: Audience | null = AUDIENCES.includes(rawAudience as Audience) ? (rawAudience as Audience) : null;
  const rawPage = typeof sp.page === "string" ? Number.parseInt(sp.page, 10) : 1;
  const requested = Number.isFinite(rawPage) && rawPage > 0 && rawPage < 10_000 ? rawPage : 1;

  const [series, stats, first] = await Promise.all([
    listProgressSeries(user.id, audience),
    getStatsSummary(user.id),
    listHistoryPage(user.id, requested, audience),
  ]);
  const totalPages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  const list = page === requested ? first : await listHistoryPage(user.id, page, audience);

  return (
    <HistoryScreen
      audience={audience}
      page={page}
      totalPages={totalPages}
      items={list.items}
      series={series}
      stats={stats}
    />
  );
}
