import { Baby, GraduationCap, HeartHandshake, Users } from "lucide-react";
import { audienceLabel } from "@/lib/audience";
import type { Audience } from "@/lib/types";
import { Badge } from "@/components/ui/Card";

export const AUDIENCE_ICONS = { general: Users, young: Baby, teen: GraduationCap, senior: HeartHandshake } as const;

/** Audience name in text next to its icon (R20.7, R20.9). */
export function AudienceBadge({ audience }: { audience: Audience }) {
  const Icon = AUDIENCE_ICONS[audience];
  return (
    <Badge tone="primary" icon={<Icon size={14} />}>
      {audienceLabel(audience)} audience
    </Badge>
  );
}
