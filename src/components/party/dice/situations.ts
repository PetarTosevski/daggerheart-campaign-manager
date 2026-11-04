import type { Mod, Step } from "@/lib/domain/card-effects/types";
import { CARD_EFFECTS } from "@/lib/srd/card-effects/index";
import { FEATURE_EFFECTS } from "@/lib/srd/feature-effects/index";

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-hqk1; user answer 2026-10-31): the situational dice a sheet's effects offer on a roll the
 * player marks (Reliable Backup, CB p.43: "When you make a Presence Roll in conversation, they back you up. You can roll a
 * d20 as your Hope Die"). The server decides (convex/lib/rolls.ts `situationalHopeDie` over `liveMods`); this is the dice
 * box's view of the same entries, found by the effect's label (the stored effect keeps only its text).
 */

type EffectView = { id: string; text: string };

/** One check box: the situation the roll is marked as, and what it gives. */
export type SituationalDie = { situation: string; label: string; sides: number };

function nested(steps: readonly Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...(s.kind === "optional" || s.kind === "followUp" ? nested(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => nested(o.steps)) : []),
    ...(s.kind === "save" ? [...nested(s.onFail), ...nested(s.onSuccess)] : []),
    ...(s.kind === "check" ? [...nested(s.then), ...nested(s.otherwise)] : []),
  ]);
}

type Entry = { uses: readonly { steps: readonly Step[] }[]; upgrades?: readonly unknown[] };

function stepListsOf(entry: Entry): (readonly Step[])[] {
  const ups = (entry.upgrades ?? []) as readonly { patch?: { extraOptions?: readonly { steps: readonly Step[] }[] } }[];
  return [...entry.uses.map((u) => u.steps), ...ups.flatMap((u) => (u.patch?.extraOptions ?? []).map((o) => o.steps))];
}

let BY_LABEL: Map<string, Mod[]> | null = null;

/** Every SRD effect step label with a situational `dualityDie` mod, and those mods (cached). */
function dieModsByLabel(): Map<string, Mod[]> {
  if (BY_LABEL !== null) return BY_LABEL;
  const map = new Map<string, Mod[]>();
  const add = (entry: Entry) => {
    for (const list of stepListsOf(entry)) {
      for (const s of nested(list)) {
        if (s.kind !== "effect") continue;
        const mods = s.mods.filter((m) => m.kind === "dualityDie" && m.situation !== undefined);
        if (mods.length > 0) map.set(s.label, [...(map.get(s.label) ?? []), ...mods]);
      }
    }
  };
  for (const e of CARD_EFFECTS.values()) add(e);
  for (const e of FEATURE_EFFECTS.values()) add(e);
  BY_LABEL = map;
  return map;
}

/** The situational Hope dice the sheet's effects offer (one per situation), from `lookup` (default: the SRD tables). */
export function situationalDice(effects: readonly EffectView[] | undefined, lookup: (label: string) => readonly Mod[] = (l) => dieModsByLabel().get(l) ?? []): SituationalDie[] {
  const out: SituationalDie[] = [];
  for (const e of effects ?? []) {
    const label = e.text.split("; ")[0] ?? "";
    for (const m of lookup(label)) {
      if (m.kind !== "dualityDie" || m.die !== "hope" || m.situation === undefined) continue;
      if (out.some((o) => o.situation === m.situation)) continue;
      out.push({ situation: m.situation, label, sides: m.sides });
    }
  }
  return out;
}
