import {
  ArrowUpCircle,
  BookmarkPlus,
  Compass,
  Crosshair,
  Dices,
  Download,
  Droplet,
  Flag,
  HeartCrack,
  Hourglass,
  Leaf,
  Moon,
  PenLine,
  Play,
  Shield,
  ShieldHalf,
  Skull,
  Sparkles,
  Speech,
  Square,
  Swords,
  Sword,
  type LucideIcon,
} from "lucide-react";

import { LOG_LABELS } from "@/lib/journal/log";

import type { JournalLogIcon } from "../../../../convex/journalLog";

/**
 * The session log's icons (JL). The labels, the clock and the optimistic updates of `journalLog.list` are
 * framework-free in `src/lib/journal/log.ts` (shared with the phone, dcm-gdzi.46).
 */

/** One icon per line kind and roll type (design: scene compass, roll, combat, spell, Fear, hit, defeat; dcm-z9rz.28). */
const ICONS: Record<JournalLogIcon, LucideIcon> = {
  roll: Dices,
  reactionRoll: ShieldHalf,
  damageRoll: HeartCrack,
  attackRoll: Crosshair,
  // Journal JF2 (dcm-z9rz.28): lucide has no mouth; Speech (a speaking head) is the closest.
  socialRoll: Speech,
  gmRoll: Dices,
  feature: Sparkles,
  levelUp: ArrowUpCircle,
  rest: Moon,
  death: Skull,
  wither: Leaf,
  session: BookmarkPlus,
  import: Download,
  countdown: Hourglass,
  combat: Sword,
  adversary: Shield,
  rule: PenLine,
  fear: Droplet,
  combatBegan: Swords,
  combatEnded: Flag,
  start: Play,
  end: Square,
  scene: Compass,
  auto: BookmarkPlus,
  note: PenLine,
};

/** Each kind's icon with its label (`LOG_LABELS`). */
export const LOG_ICONS = Object.fromEntries(
  (Object.keys(ICONS) as JournalLogIcon[]).map((kind) => [kind, { Icon: ICONS[kind], label: LOG_LABELS[kind] }]),
) as Record<JournalLogIcon, { Icon: LucideIcon; label: string }>;
