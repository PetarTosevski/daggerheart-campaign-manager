import { Droplet, DropletOff, Heart, Skull, Sparkles, Star, type LucideIcon } from "lucide-react";

import type { TallyKey } from "@/lib/journal/tally";

/**
 * The session tally's icons. The tiles, `barPercent` and the optimistic Reset are framework-free in
 * `src/lib/journal/tally.ts` (shared with the phone, dcm-gdzi.46).
 */
export const TALLY_ICONS: Record<TallyKey, LucideIcon> = {
  fearGained: Droplet,
  fearSpent: DropletOff,
  hopeSpent: Star,
  hpMarked: Heart,
  adversariesDefeated: Skull,
  criticals: Sparkles,
};
