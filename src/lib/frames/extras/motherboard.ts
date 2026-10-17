// Motherboard: quantum wallet, scrap, Ikonis and augments (Core Book pp.301–303,
// module sheet p.354 of the PDF). Scrap values and rolls live in
// src/lib/domain/frames/motherboard.ts.

import { z } from "zod";

import { RELIC_VALUE, SCRAP_CATEGORIES, SCRAP_TABLES, STARTING_QUANTUM, scrapValue, type GatheredScrap } from "../../domain/frames/motherboard";
import type { Range } from "../../srd/types";
import { rangeSchema, traitIdSchema } from "./common";

export const SCRAP_NAMES: readonly string[] = SCRAP_CATEGORIES.flatMap((c) => SCRAP_TABLES[c].items.map((i) => i.name));
const scrapName = z.string().refine((n) => SCRAP_NAMES.includes(n), "Unknown scrap.");

/** Module sheet: "Choose range and damage dice." */
export const IKONIS_RANGES: readonly { range: Range; damage: string }[] = [
  { range: "Melee", damage: "d12+1" },
  { range: "Very Close", damage: "d10+2" },
  { range: "Close", damage: "d10" },
  { range: "Far", damage: "d8+1" },
  { range: "Very Far", damage: "d6+1" },
];

export type Augment = { id: string; name: string; text: string; recipe: Record<string, number>; precompileTier: number };

const a = (name: string, text: string, recipe: Record<string, number>, precompileTier = 1): Augment => ({
  id: name.toLowerCase(),
  name,
  text,
  recipe,
  precompileTier,
});

/** The module sheet's 18 base augments with recipes and Tier precompiles. "Relic" means any Relic. */
export const AUGMENTS: readonly Augment[] = [
  a("Force", "+1 damage", { Gear: 3, Lens: 2, Aluminum: 4, Capacitor: 1 }),
  a("Guard", "+1 Armor Score", { Wire: 3, Silver: 2, Platinum: 2, Fuse: 3 }),
  a("Converge", "+1 to attack rolls", { Coil: 4, Crystal: 2, Gold: 5, Disc: 3 }),
  a("Amplify", "On a successful attack, roll an additional damage die and drop the lowest result.", { Crystal: 4, Cobalt: 4, Copper: 4, Capacitor: 4 }),
  a("Scope", "Increase range by one step (Melee to Very Close, Close to Far, etc.).", { Lens: 5, Silver: 3, Circuit: 2, Relay: 2 }),
  a("Deny", "+2 Armor Score", { Coil: 6, Wire: 3, Copper: 2, Battery: 4 }),
  a("Target", "+2 to attack rolls", { Wire: 10, Gold: 7, Fuse: 5, Circuit: 5, Battery: 2 }),
  a("Split", "When you make an attack, mark a Stress to target another creature within range.", { Gear: 12, Lens: 5, Aluminum: 15, Relay: 9 }),
  a("Fix", "When you deal Severe damage, clear a Hit Point.", { Coil: 6, Wire: 4, Crystal: 1, Cobalt: 5, Silver: 5, Relay: 7, Battery: 2 }),
  a("Scare", "When you critically succeed on an attack, the target must mark a Stress.", { Trigger: 6, Copper: 8, Aluminum: 9, Disc: 10 }),
  a("Sear", "+2 damage", { Trigger: 11, Platinum: 11, Circuit: 11, Disc: 7 }, 2),
  a("Absorb", "You can mark an additional Armor Slot against incoming damage.", { Gear: 26, Gold: 13, Relay: 15, Battery: 8 }, 2),
  a("Kick", "On a successful attack, you can mark 2 Stress to force the target to mark an additional Hit Point.", { Trigger: 33, Crystal: 13, Cobalt: 23, Disc: 16 }, 2),
  a("Block", "+3 Armor Score; −1 Evasion", { Crystal: 27, Aluminum: 67, Relay: 33, Capacitor: 4, Battery: 5 }, 3),
  a("Zip", "Move up to Far range as part of an attack.", { Coil: 37, Silver: 43, Fuse: 67, Capacitor: 12 }, 3),
  a("Bury", "+3 damage", { Trigger: 28, Circuit: 28, Relay: 28, Relic: 1 }, 3),
  a("Follow", "Mark 2 Stress to reroll your attack.", { Gear: 75, Lens: 67, Copper: 30, Circuit: 33 }, 4),
  a("Override", "Attack rolls have advantage.", { Wire: 63, Gold: 71, Disc: 58, Relic: 5 }, 4),
];

export const getAugment = (id: string) => AUGMENTS.find((x) => x.id === id);

/** "starts with two Augment slots at Tier 1… and it gains an additional slot at each subsequent tier." */
export const augmentSlots = (tier: number) => tier + 1;

const relicSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(80) });
export type Relic = z.infer<typeof relicSchema>;

export const ikonisSchema = z.object({
  name: z.string().trim().max(80),
  description: z.string().max(2000),
  trait: traitIdSchema.nullable(),
  range: rangeSchema.nullable(),
  damageType: z.enum(["physical", "tech"]).nullable(),
});
export type Ikonis = z.infer<typeof ikonisSchema>;

export const motherboardStateSchema = z.object({
  quantum: z.number().int().min(0).max(1_000_000),
  scrap: z.record(scrapName, z.number().int().min(0).max(9999)),
  relics: z.array(relicSchema).max(100),
  ikonis: ikonisSchema,
  /** Crafted augments; `relics` remembers which Relics went in, for salvage. */
  built: z.array(z.object({ id: z.string(), relics: z.array(relicSchema) })).max(AUGMENTS.length),
  installed: z.array(z.string()).max(5),
});
export type MotherboardState = z.infer<typeof motherboardStateSchema>;

export const INITIAL_MOTHERBOARD: MotherboardState = {
  quantum: STARTING_QUANTUM,
  scrap: {},
  relics: [],
  ikonis: { name: "", description: "", trait: null, range: null, damageType: null },
  built: [],
  installed: [],
};

const have = (s: MotherboardState, name: string) => s.scrap[name] ?? 0;
const withScrap = (s: MotherboardState, name: string, delta: number): MotherboardState => {
  const next = have(s, name) + delta;
  if (next < 0) throw new Error(`Not enough ${name}.`);
  return { ...s, scrap: { ...s.scrap, [name]: next } };
};

/** Ikonis damage with Bonded: "Gain a bonus to your damage rolls equal to your level." */
export function ikonisDamage(ikonis: Ikonis, level: number): string | null {
  const row = IKONIS_RANGES.find((r) => r.range === ikonis.range);
  if (!row) return null;
  const m = /^d(\d+)(?:\+(\d+))?$/.exec(row.damage)!;
  const bonus = Number(m[2] ?? 0) + level;
  return `d${m[1]}+${bonus} ${ikonis.damageType === "tech" ? "tech" : "phy"}`;
}

export function applyGather(s: MotherboardState, gathered: GatheredScrap[]): MotherboardState {
  return gathered.reduce((acc, g) => withScrap(acc, g.item.name, 1), s);
}

/** Scrap shack: "each piece of scrap is worth its value… whether players are buying or selling" (p.303). */
export function trade(s: MotherboardState, name: string, quantity: number, direction: "buy" | "sell"): MotherboardState {
  const value = scrapValue(name);
  if (value === undefined || name === "Relic") throw new Error("Unknown scrap.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Trade at least one piece.");
  const cost = value * quantity;
  if (direction === "sell") return { ...withScrap(s, name, -quantity), quantum: s.quantum + cost };
  if (s.quantum < cost) throw new Error(`That costs ${cost} quantum; you have ${s.quantum}.`);
  return { ...withScrap(s, name, quantity), quantum: s.quantum - cost };
}

export function addRelic(s: MotherboardState, relic: Relic): MotherboardState {
  return { ...s, relics: [...s.relics, relic] };
}

/** "Relics are worth 20 quantum." */
export function sellRelic(s: MotherboardState, relicId: string): MotherboardState {
  if (!s.relics.some((r) => r.id === relicId)) throw new Error("That relic is gone.");
  return { ...s, relics: s.relics.filter((r) => r.id !== relicId), quantum: s.quantum + RELIC_VALUE };
}

/** Craft (downtime): checks the precompile, spends the recipe; "a PC can spend any Relic they have". */
export function craft(s: MotherboardState, augmentId: string, tier: number): MotherboardState {
  const aug = getAugment(augmentId);
  if (!aug) throw new Error("Unknown augment.");
  if (s.built.some((b) => b.id === aug.id)) throw new Error(`${aug.name} is already built.`);
  if (tier < aug.precompileTier) throw new Error(`${aug.name} needs Tier ${aug.precompileTier} (precompile).`);
  let next = s;
  const missing: string[] = [];
  for (const [name, qty] of Object.entries(aug.recipe)) {
    const owned = name === "Relic" ? s.relics.length : have(s, name);
    if (owned < qty) missing.push(`${qty - owned} ${name}`);
  }
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}.`);
  let spentRelics: Relic[] = [];
  for (const [name, qty] of Object.entries(aug.recipe)) {
    if (name === "Relic") {
      spentRelics = next.relics.slice(0, qty);
      next = { ...next, relics: next.relics.slice(qty) };
    } else next = withScrap(next, name, -qty);
  }
  return { ...next, built: [...next.built, { id: aug.id, relics: spentRelics }] };
}

/** "Augments can always be broken back into their scrap for parts." Uninstalls it first. */
export function salvage(s: MotherboardState, augmentId: string): MotherboardState {
  const entry = s.built.find((b) => b.id === augmentId);
  const aug = getAugment(augmentId);
  if (!entry || !aug) throw new Error("That augment isn't built.");
  let next: MotherboardState = {
    ...s,
    built: s.built.filter((b) => b.id !== augmentId),
    installed: s.installed.filter((id) => id !== augmentId),
    relics: [...s.relics, ...entry.relics],
  };
  for (const [name, qty] of Object.entries(aug.recipe)) if (name !== "Relic") next = withScrap(next, name, qty);
  return next;
}

/** Install/swap (downtime): built augments only, up to the tier's slots. */
export function install(s: MotherboardState, ids: string[], tier: number): MotherboardState {
  if (new Set(ids).size !== ids.length) throw new Error("Install each augment once.");
  if (ids.some((id) => !s.built.some((b) => b.id === id))) throw new Error("Only built augments can be installed.");
  const slots = augmentSlots(tier);
  if (ids.length > slots) throw new Error(`Your Ikonis has ${slots} augment slots at Tier ${tier}.`);
  return { ...s, installed: [...ids] };
}

export const walletCorrectionSchema = z
  .object({
    quantum: z.number().int().min(0).max(1_000_000).optional(),
    scrap: z.record(scrapName, z.number().int().min(0).max(9999)).optional(),
  })
  .refine((c) => c.quantum !== undefined || c.scrap !== undefined, "Nothing to correct.");
export type WalletCorrection = z.infer<typeof walletCorrectionSchema>;

export function correctWallet(s: MotherboardState, c: WalletCorrection): MotherboardState {
  return { ...s, quantum: c.quantum ?? s.quantum, scrap: c.scrap ? { ...s.scrap, ...c.scrap } : s.scrap };
}
