import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProcessingScreen } from "@/components/processing/ProcessingScreen";
import { getCurrentUser } from "@/server/auth/identity";
import { sessionExistsForUser } from "@/server/db/queries/reports";
import { getUserSettings } from "@/server/db/queries/users";

export const metadata: Metadata = { title: "Analyzing" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !UUID_RE.test(id) || !(await sessionExistsForUser(user.id, id))) notFound();
  const settings = await getUserSettings(user.id);
  return <ProcessingScreen sessionId={id.toLowerCase()} autoAdvance={settings.autoAdvanceReport} />;
}
