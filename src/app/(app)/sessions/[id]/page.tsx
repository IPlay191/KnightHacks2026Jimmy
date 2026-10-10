import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportScreen } from "@/components/report/ReportScreen";
import { getCurrentUser } from "@/server/auth/identity";
import { getSessionReport, sessionExistsForUser } from "@/server/db/queries/reports";

export const metadata: Metadata = { title: "Session report" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Report for one completed session. Unknown or unowned IDs render not-found (R10.7). */
export default async function SessionReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !UUID_RE.test(id)) notFound();
  const sessionId = id.toLowerCase();
  const report = await getSessionReport(user.id, sessionId);
  if (!report) {
    // Owned but not finished yet: show its progress instead.
    if (await sessionExistsForUser(user.id, sessionId)) redirect(`/sessions/${sessionId}/processing`);
    notFound();
  }
  return <ReportScreen report={report} />;
}
