import type { ReactNode } from "react";

import { rangeCheck } from "@/lib/domain/combat-actions/distance";
import type { Range } from "@/lib/domain/card-effects/types";
import type { TraitId, Weapon } from "@/lib/srd/types";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { pickOf, riderProblem, ridersToSend, riseToSend, type RiderOption, type RiderPicks } from "../../actions/attack/riders";
import { NO_ROLL_OPTIONS, type Roller, type RollValues } from "../../actions/roll-controls";
import type { TargetHint, WeaponSlot } from "../../actions/targets";
import type { CostResource } from "../ui";
import type { PickContext, PickOutcome, PickPatch, PickRow, PickRowInput, PickSelection, PickSessionSpec } from "../pick";

/**
 * The HUD's weapon attack picker, pure (plan combat-hud H3.2; boards CmpPicking 'Weapon attack', CmpPromptsPlayer 'With
 * this attack', 'Forced attack', 'Lead by Example', 'Your hit can defeat 2 more Minions'). It builds the pick-session
 * spec (H3.0's `usePick().open`) from what the classic Attack bar already reads: the equipped weapons
 * (`equippedWeapons`), the riders of `combatActions.riders` (`ridersToSend`, `riderProblem`, `riseToSend`), the roll
 * options (Experiences, advantage, Help: `RollValues`), the sheet's trait pick / extra targets / Spirit Weapon
 * (`actions/attack/mods.ts`), a target's rider benefit (Lead by Example: `combatActions.targets` `benefits`) and the
 * forced attacks of `combatRequests.forcedAttacks`. `combatActions.attack` decides; nothing here is a rule of its own.
 * No React here (the extra rows come in as a render function), so the unit tests read it directly.
 */

/** What the player set in the panel (kept in the session's `data`). */
export type AttackData = {
  slot: WeaponSlot;
  roll: RollValues;
  /** The trait the roll uses when the sheet offers a pick (Versatile Fighter, a "choice" weapon); null: the weapon's. */
  trait: TraitId | null;
  /** "Use as Spirit Weapon" (CB p.44), per attack. */
  spirit: boolean;
  /** The picked rider benefit (Lead by Example's "Clear a Stress"); null: the first one offered. */
  benefit: string | null;
  riders: RiderPicks;
};

export type AttackWeapon = { slot: WeaponSlot; weapon: Weapon };

/** A forced attack waiting on the character (`combatRequests.forcedAttacks`, Beguiled HF p.75): its targets are locked. */
export type ForcedAttack = {
  requestId: Id<"combatRequests">;
  instanceLabel: string;
  feature: string;
  targets: readonly { tokenId: Id<"combatTokens">; name: string }[];
};

/** A target's rider benefit (`combatActions.targets` `benefits`): Lead by Example's options. */
export type Benefit = NonNullable<TargetHint["benefits"]>[number];

/** The picker's decisions, as `combatActions.attack` takes them (the hook adds campaign, character, map and the key). */
export type AttackArgs = {
  targetTokenIds: Id<"combatTokens">[];
  slot: WeaponSlot;
  trait?: TraitId;
  spiritWeapon?: true;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  riders: ReturnType<typeof ridersToSend>;
  riseToTheChallenge?: false;
  forcedRequestId?: Id<"combatRequests">;
  benefit?: string;
};

/** What the server answered (the three shapes of `combatActions.attack`; only what the HUD reads). */
export type AttackAnswer =
  | { status: "resolved"; damage: { total: number } | null; targets: readonly { tokenId: string; hit: boolean; defeated: boolean }[] }
  | { status: "pending"; requestId: Id<"combatRequests"> }
  | { status: "awaiting" };

/** What the HUD tells the player after a send (HANDOFF hard rule 2: Hit / Miss / Defeated, their own damage total). */
export type AttackReport = {
  characterId: Id<"characters">;
  weaponName: string;
  /** One line per target, by name. */
  verdicts: readonly { name: string; verdict: "Hit" | "Miss" | "Defeated" }[];
  /** The player's own damage total (null: every target missed). */
  damage: number | null;
  /** A held roll (after-roll features): answered in Map tools until the HUD's result panel (H4.1). */
  note: string | null;
};

/** Everything the picker reads when it opens (a snapshot: the server refuses what has changed since). */
export type AttackInput = {
  characterId: Id<"characters">;
  weapons: readonly AttackWeapon[];
  proficiency: number;
  roller: Roller;
  /** `combatActions.riders` per equipped weapon slot. */
  riders: Partial<Record<WeaponSlot, readonly RiderOption[]>>;
  /** The sheet lets the player pick the roll's trait for this slot (dcm-5dg: Versatile Fighter, a "choice" weapon). */
  traitPick: Partial<Record<WeaponSlot, boolean>>;
  /** The trait the pick starts on. */
  traitDefault: Partial<Record<WeaponSlot, TraitId>>;
  /** The character's traits after effects (Beastform), for the trait pick's numbers. */
  traitValues: Readonly<Record<TraitId, number>>;
  /** "Use as Spirit Weapon" is offered for this slot (a Melee / Very Close weapon, the feature held). */
  spirit: Partial<Record<WeaponSlot, boolean>>;
  /** Extra targets a weapon attack may take (dcm-y3e: Parallela, `extraTargets(sheetMods(sheet))`). */
  extraTargets: number;
  /** The target hints of the default slot: their `benefits` (Lead by Example). */
  hints: readonly TargetHint[];
  /** Set: this session answers a forced attack (targets locked, `rows` from `forcedRows`). */
  forced: ForcedAttack | null;
  forcedRows: readonly PickRowInput[] | null;
  /** Enemies picked on the map before (the latest win). */
  picked: readonly Id<"combatTokens">[];
  attack: (args: AttackArgs) => Promise<AttackAnswer>;
  onReport: (report: AttackReport) => void;
  /** The panel's extra rows (weapon tiles, trait, Lead by Example, roll chips, riders). */
  render: (ctx: PickContext<AttackData>, input: AttackInput) => ReactNode;
};

// ---------------------------------------------------------------- weapons

/** The weapon the data names (the first one if that slot is empty). */
export function weaponOf(input: Pick<AttackInput, "weapons">, slot: WeaponSlot): AttackWeapon | undefined {
  return input.weapons.find((w) => w.slot === slot) ?? input.weapons[0];
}

/** The riders on offer for the chosen weapon. */
export function ridersOf(input: Pick<AttackInput, "riders">, slot: WeaponSlot): readonly RiderOption[] {
  return input.riders[slot] ?? [];
}

/** How many targets the attack may take: 1 (CB p.96), +1 per extra target (Parallela), +1 for a ticked Spirit Weapon. */
export function mostTargets(input: Pick<AttackInput, "forced" | "extraTargets" | "spirit">, data: Pick<AttackData, "slot" | "spirit">): number {
  if (input.forced) return Math.max(1, input.forced.targets.length);
  return 1 + input.extraTargets + (data.spirit && input.spirit[data.slot] ? 1 : 0);
}

/** The data a session opens with. */
export function initialData(input: Pick<AttackInput, "weapons" | "traitPick" | "traitDefault">, slot?: WeaponSlot): AttackData {
  const chosen = weaponOf(input, slot ?? "primary");
  const s = chosen?.slot ?? "primary";
  return { slot: s, roll: NO_ROLL_OPTIONS, trait: input.traitPick[s] ? (input.traitDefault[s] ?? "strength") : null, spirit: false, benefit: null, riders: {} };
}

/** A weapon switch: the new slot, its trait pick, and a Spirit Weapon box only where it is offered. */
export function switchWeapon(input: Pick<AttackInput, "traitPick" | "traitDefault" | "spirit">, data: AttackData, slot: WeaponSlot): AttackData {
  return { ...data, slot, trait: input.traitPick[slot] ? (data.trait ?? input.traitDefault[slot] ?? "strength") : null, spirit: data.spirit && input.spirit[slot] === true };
}

// ---------------------------------------------------------------- words

/** "the Bandit", "Oriel": adversaries and other creatures take "the", party members don't. */
export function targetName(row: Pick<PickRow, "name" | "side">): string {
  return row.side === "pc" || row.side === "self" ? row.name : `the ${row.name}`;
}

/** "the Bandit and the Lieutenant", "the Bandit, Oriel and the Sniper". */
export function targetPhrase(rows: readonly Pick<PickRow, "name" | "side">[]): string {
  const names = rows.map(targetName);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The primary (CmpPicking 'Weapon attack'): "Attack the Bandit with Shortstaff"; "Attack with Shortstaff" before a pick. */
export function attackLabel(weaponName: string | null, targets: readonly Pick<PickRow, "name" | "side">[]): string {
  const withWeapon = weaponName ? ` with ${weaponName}` : "";
  return targets.length > 0 ? `Attack ${targetPhrase(targets)}${withWeapon}` : `Attack${withWeapon}`;
}

/** "Instinct · Close · 1d8+1 mag" (CmpPicking's weapon tile). */
export function weaponLine(trait: string, range: string, damage: string): string {
  return [trait, range, damage].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- costs

const RESOURCE: Record<string, CostResource> = { hope: "hope", stress: "stress", fear: "fear", hp: "hp", "armor slot": "armor", "armor slots": "armor" };

/** A rider's cost badge ("3 Hope", "1 Stress", "1 Armor Slot") as a cost pill, or null for one that isn't a simple count. */
export function costOf(text: string): { amount: number; resource: CostResource } | null {
  const m = /^(\d+) (Hope|Stress|Fear|HP|Armor Slots?)$/i.exec(text.trim());
  if (!m) return null;
  const resource = RESOURCE[m[2]!.toLowerCase()];
  return resource ? { amount: Number(m[1]), resource } : null;
}

/** The riders the player turned on (ready ones only; a default-on rider counts while on, as the server applies it). */
export function ridersOn(riders: readonly RiderOption[], picks: RiderPicks): RiderOption[] {
  return riders.filter((o) => o.ready && pickOf(picks, o).on);
}

const COST_ORDER: readonly CostResource[] = ["hope", "stress", "hp", "armor", "fear"];
const COST_WORD: Record<CostResource, string> = { hope: "Hope", stress: "Stress", hp: "HP", armor: "Armor Slot", fear: "Fear" };

/** What the attack spends before the roll: 1 Hope per Experience (CB p.90) and the toggled riders' costs. */
export function attackCosts(riders: readonly RiderOption[], data: Pick<AttackData, "roll" | "riders">): { totals: Partial<Record<CostResource, number>>; other: string[] } {
  const totals: Partial<Record<CostResource, number>> = {};
  const other: string[] = [];
  const add = (resource: CostResource, n: number) => {
    if (n > 0) totals[resource] = (totals[resource] ?? 0) + n;
  };
  add("hope", data.roll.experienceIds.length);
  for (const o of ridersOn(riders, data.riders)) {
    for (const c of o.costs) {
      const pill = costOf(c);
      if (pill) add(pill.resource, pill.amount);
      else other.push(c);
    }
  }
  return { totals, other };
}

/** The footer line: "With 1 rider · Spends 2 Hope, 1 Stress"; null when the attack spends nothing and takes no rider. */
export function payLine(riders: readonly RiderOption[], data: Pick<AttackData, "roll" | "riders">): string | null {
  const { totals, other } = attackCosts(riders, data);
  const n = ridersOn(riders, data.riders).length;
  const spend = [...COST_ORDER.flatMap((r) => (totals[r] ? [`${totals[r]} ${COST_WORD[r]}${r === "armor" && totals[r]! > 1 ? "s" : ""}`] : [])), ...other];
  const parts = [...(n > 0 ? [`With ${n} rider${n === 1 ? "" : "s"}`] : []), ...(spend.length > 0 ? [`Spends ${spend.join(", ")}`] : [])];
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** CmpBlocked layer 1: why the attack can't send yet ("Needs 2 Hope · you have 1"), or null. */
export function attackBlocked(input: Pick<AttackInput, "weapons" | "roller">, riders: readonly RiderOption[], data: AttackData): string | null {
  if (input.weapons.length === 0) return "No weapon equipped";
  const hope = attackCosts(riders, data).totals.hope ?? 0;
  if (hope > input.roller.hope) return `Needs ${hope} Hope · you have ${input.roller.hope}`;
  return riderProblem(riders, data.riders);
}

// ---------------------------------------------------------------- Lead by Example

/** The benefits the picked targets offer (CB p.342 Lead by Example: clear a Stress or gain a Hope), with where from. */
export function benefitOptions(hints: readonly Pick<TargetHint, "tokenId" | "benefits">[], targetIds: readonly string[]): { id: string; label: string; from: string }[] {
  return hints
    .filter((h) => targetIds.includes(h.tokenId))
    .flatMap((h) => h.benefits ?? [])
    .flatMap((b) => b.options.map((o) => ({ ...o, from: b.label })));
}

/** The benefit sent: the player's pick if still offered, else the first one (as the classic bar does). */
export function chosenBenefit(options: readonly { id: string }[], picked: string | null): string | undefined {
  return options.find((o) => o.id === picked)?.id ?? options[0]?.id;
}

// ---------------------------------------------------------------- the send

/** The `combatActions.attack` arguments for the selection and the data. */
export function attackArgs(input: AttackInput, data: AttackData, selection: Pick<PickSelection, "targetIds">): AttackArgs {
  const chosen = weaponOf(input, data.slot);
  const slot = chosen?.slot ?? data.slot;
  const riders = ridersOf(input, slot);
  const picks: RiderPicks = data.riders;
  const benefit = chosenBenefit(benefitOptions(input.hints, selection.targetIds), data.benefit);
  return {
    targetTokenIds: [...selection.targetIds],
    slot,
    ...(input.traitPick[slot] && data.trait ? { trait: data.trait } : {}),
    ...(data.spirit && input.spirit[slot] ? { spiritWeapon: true as const } : {}),
    experienceIds: [...data.roll.experienceIds],
    advantage: Math.max(0, data.roll.edge),
    disadvantage: Math.max(0, -data.roll.edge),
    help: data.roll.help,
    riders: ridersToSend(riders, picks),
    ...(riseToSend(riders, picks) === false ? { riseToTheChallenge: false as const } : {}),
    ...(input.forced ? { forcedRequestId: input.forced.requestId } : {}),
    ...(benefit !== undefined ? { benefit } : {}),
  };
}

/** Hit / Miss / Defeated per target, by name (U1). */
export function verdictOf(t: { hit: boolean; defeated: boolean }): "Hit" | "Miss" | "Defeated" {
  return t.defeated ? "Defeated" : t.hit ? "Hit" : "Miss";
}

/** What the HUD shows after the server answered (null: pending, which "Waiting for the GM" shows). */
export function reportOf(characterId: Id<"characters">, weaponName: string, out: AttackAnswer, names: ReadonlyMap<string, string>): AttackReport | null {
  if (out.status === "pending") return null;
  if (out.status === "awaiting") return { characterId, weaponName, verdicts: [], damage: null, note: "Your roll waits: answer it in Map tools" };
  return {
    characterId,
    weaponName,
    verdicts: out.targets.map((t) => ({ name: names.get(t.tokenId) ?? "Target", verdict: verdictOf(t) })),
    damage: out.damage?.total ?? null,
    note: null,
  };
}

// ---------------------------------------------------------------- the session

/** The rule of the session: one enemy in the weapon's range (more with extra targets); locked for a forced attack. */
export function attackRule(input: AttackInput, data: AttackData): PickSessionSpec<AttackData>["rule"] {
  const slot = weaponOf(input, data.slot)?.slot ?? data.slot;
  if (input.forced) {
    const n = Math.max(1, input.forced.targets.length);
    return { side: "any", max: n, min: n, range: "weapon", slot, locked: true, text: `${input.forced.instanceLabel}’s ${input.forced.feature}: the target is locked` };
  }
  return { side: "enemy", max: mostTargets(input, data), range: "weapon", slot };
}

/** The parts of the spec that follow the data (a weapon switch, a chip, a rider): pass to `update` with the new data. */
export function attackPatch(input: AttackInput, data: AttackData): PickPatch<AttackData> {
  const chosen = weaponOf(input, data.slot);
  const weaponName = chosen?.weapon.name ?? null;
  const riders = ridersOf(input, chosen?.slot ?? data.slot);
  return {
    data,
    source: { kind: "attack", name: weaponName ?? "Attack" },
    rule: attackRule(input, data),
    primary: {
      label: (s) => attackLabel(weaponName, s.targets),
      pay: () => payLine(riders, data),
      blocked: () => attackBlocked(input, riders, data),
      send: async (s): Promise<PickOutcome> => {
        const names = new Map(s.targets.map((t) => [t.tokenId as string, t.name]));
        const out = await input.attack(attackArgs(input, data, s));
        if (out.status === "pending") return { kind: "pending", requestId: out.requestId };
        const report = reportOf(input.characterId, weaponName ?? "Attack", out, names);
        if (report) input.onReport(report);
        return { kind: "done" };
      },
    },
  };
}

/** The session id: one attack picker per character (a forced attack is its own session). */
export function attackSessionId(characterId: string, forced: Pick<ForcedAttack, "requestId"> | null): string {
  return forced ? `attack:${characterId}:forced:${forced.requestId}` : `attack:${characterId}:weapon`;
}

/** The whole spec `usePick().open` takes. */
export function attackSession(input: AttackInput, data: AttackData): PickSessionSpec<AttackData> {
  const patch = attackPatch(input, data);
  const most = mostTargets(input, data);
  return {
    id: attackSessionId(input.characterId, input.forced),
    source: patch.source!,
    rule: patch.rule!,
    primary: patch.primary!,
    data,
    picked: input.forced ? input.forced.targets.map((t) => t.tokenId) : input.picked.slice(-most),
    ...(input.forcedRows ? { rows: input.forcedRows } : {}),
    extra: (ctx) => input.render(ctx, input),
  };
}

// ---------------------------------------------------------------- rows the picker builds (forced targets, Minions)

type Placed = { _id: Id<"combatTokens">; x: number; y: number; size: number };

/** The band from the actor to every token it sees (the engine's `rangeCheck`, as H3.0's rows use). */
export function bandsFrom(view: { tokenId: Id<"combatTokens">; pcs: readonly (Placed & { name: string })[]; others: readonly (Placed & { name: string; side: string })[] }): Map<string, { band: Range; side: PickRow["side"]; name: string }> {
  const all = [...view.pcs.map((t) => ({ ...t, side: "pc" as const })), ...view.others];
  const self = all.find((t) => t._id === view.tokenId);
  const out = new Map<string, { band: Range; side: PickRow["side"]; name: string }>();
  for (const t of all) {
    const side: PickRow["side"] = t._id === view.tokenId ? "self" : t.side === "pc" || t.side === "enemy" || t.side === "ally" ? t.side : "neutral";
    const band = self ? rangeCheck({ x: self.x, y: self.y, size: self.size }, { x: t.x, y: t.y, size: t.size }, "unlimited").band : "melee";
    out.set(t._id, { band, side, name: t.name });
  }
  return out;
}

/** A forced attack's locked targets as rows (they may be allies: Beguiled attacks "a target chosen by the Gobstalker"). */
export function forcedRows(forced: ForcedAttack, bands: ReadonlyMap<string, { band: Range; side: PickRow["side"] }>): PickRowInput[] {
  return forced.targets.map((t) => {
    const seen = bands.get(t.tokenId);
    // The GM chose them: no range sanction is asked (combatActions.attack `forcedRequestId`), so every row is in reach.
    return { tokenId: t.tokenId, name: t.name, side: seen?.side === "self" ? "pc" : (seen?.side ?? "enemy"), band: seen?.band ?? null, reach: "in" };
  });
}

/** A Minion offer (`combatRequests.mine` kind `minionOffer`, CB p.201). */
export type MinionOffer = {
  requestId: Id<"combatRequests">;
  entryId: Id<"actionLog">;
  extra: number;
  candidates: readonly { instanceId: Id<"encounterAdversaries">; tokenId: Id<"combatTokens">; name: string; available: number }[];
};

/** How many Minions each picked token gives up (one unless the player stepped it up), keyed by instance. */
export type MinionData = { counts: Readonly<Record<string, number>> };

/** "Your hit can defeat 2 more Minions" (CmpPromptsPlayer). */
export function minionTitle(extra: number): string {
  return `Your hit can defeat ${extra} more Minion${extra === 1 ? "" : "s"}`;
}

/** The instance ids to send for the picks: each picked candidate as many times as its count (at least 1). */
export function minionPicks(offer: MinionOffer, targetIds: readonly string[], data: MinionData): Id<"encounterAdversaries">[] {
  return offer.candidates
    .filter((c) => targetIds.includes(c.tokenId))
    .flatMap((c) => Array.from({ length: Math.max(1, Math.min(c.available, data.counts[c.instanceId] ?? 1)) }, () => c.instanceId));
}

/** The Minion pick as a session: the candidates are the rows (the server already checked range and sight). */
export function minionSession({
  offer,
  bands,
  data,
  pick,
  render,
}: {
  offer: MinionOffer;
  bands: ReadonlyMap<string, { band: Range }>;
  data: MinionData;
  pick: (instanceIds: Id<"encounterAdversaries">[]) => Promise<void>;
  render: (ctx: PickContext<MinionData>) => ReactNode;
}): PickSessionSpec<MinionData> {
  return {
    id: `minions:${offer.requestId}`,
    source: { kind: "attack", name: minionTitle(offer.extra) },
    rule: { side: "enemy", max: offer.extra, range: "weapon", text: "Only Minions within your weapon’s range can be picked" },
    rows: offer.candidates.map((c) => ({ tokenId: c.tokenId, name: c.name, side: "enemy", band: bands.get(c.tokenId)?.band ?? null, reach: "in" })),
    data,
    extra: render,
    ...minionPatch(offer, data, pick),
  };
}

/** The primary of the Minion pick for the data ("Defeat 2"). */
export function minionPatch(offer: MinionOffer, data: MinionData, pick: (instanceIds: Id<"encounterAdversaries">[]) => Promise<void>): Pick<PickSessionSpec<MinionData>, "primary" | "data"> {
  return {
    data,
    primary: {
      label: (s) => {
        const n = minionPicks(offer, s.targetIds, data).length;
        return n > 0 ? `Defeat ${n}` : "Defeat";
      },
      blocked: (s) => (minionPicks(offer, s.targetIds, data).length > offer.extra ? `Up to ${offer.extra}` : null),
      send: async (s) => {
        await pick(minionPicks(offer, s.targetIds, data));
        return { kind: "done" };
      },
    },
  };
}
