import type { Metadata } from "next";
import { StudioScreen } from "@/components/studio/StudioScreen";
import { getCurrentUser } from "@/server/auth/identity";
import { getUserSettings } from "@/server/db/queries/users";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage() {
  const user = await getCurrentUser();
  const settings = user ? await getUserSettings(user.id) : null;
  return <StudioScreen defaultAudience={settings?.defaultAudience ?? "general"} />;
}
