/**
 * Rule switches RC2 (plan rule-switches): adversary attacks on PCs follow the campaign's modes.
 *
 * - A1 Armor Slots (CB p.114 "negate some (or all) of it by marking an available Armor Slot"; CB p.19 "You can only mark
 *   one Armor Slot per attack"): Book asks the hit PC; Manual offers no slot, the damage lands at full severity and the
 *   GM gets "Ash took Major damage; Armor Slot not offered".
 * - C1 Conditions change the dice, adversary side (CB p.102 "While Hidden, any rolls against you have disadvantage"):
 *   Book rolls the attack on a Hidden PC with disadvantage; Manual rolls it plain and tells the GM.
 * - D2 / D4 / Massive Damage on PCs (CB p.99, p.92, p.91): the hit's window resolves with the campaign's modes; the
 *   Manual notes ride in the hit's group. Massive with an Armor Slot is Severe (user 2026-11-06).
 * - S1, the adversary side (bead dcm-bxp.99.32.4; CB p.100, p.194): an adversary action spotlights the adversary: the
 *   spotlight goes to the GM and the map lights its token; one already lit is not counted (or charged) twice.
 *
 * Every assertion reads the rolled numbers back (damage from the hit row, d20s from the roll record), so it holds for
 * every roll.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { applyRiders } from "../../convex/lib/incomingHits";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import {
  applyHitToPc,
  hitRuleNotes,
  hiddenCondition,
  openWindow,
  pcSeverity,
  resolveWindow,
  respond,
  targetArmorPreview,
  targetPrompt,
  type PcDefense,
  type WindowPc,
} from "../../src/lib/domain/adversary-actions/index";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();

const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

/** A custom adversary that always hits (ATK +20) for `damage`. */
const brute = (damage: string) => ({
  name: "Brute",
  tier: 1 as const,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee" as const, damage },
  experiences: [],
  features: [],
});

type RuleChange = { key: "armorSlots" | "conditionDice" | "massiveDamage" | "spotlightToGm" | "stressOverflow" | "resistance"; value: string | boolean };

/**
 * The authz world with a running encounter (GM turn 1) and one Brute (custom adversary dealing `damage`) and Ash
 * (characterA: level 1, Chainmail, no cards, no armor marked, easy to hit). `rules` are set before anything else.
 */
async function arena(opts: { damage?: string; rules?: RuleChange[]; sheet?: (s: CharacterSheet) => CharacterSheet; map?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  for (const change of opts.rules ?? []) await gm.mutation(api.ruleSettings.set, { campaignId, change } as never);
  await t.run(async (ctx) => {
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    const base: CharacterSheet = { ...s, armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, conditions: [], effects: [EASY], domainCards: { owned: [], loadout: [] } };
    await saveSheet(ctx, w.characterA, opts.sheet ? opts.sheet(base) : base);
  });
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary: brute(opts.damage ?? "1d4+9 phy"), idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "custom", customId },
      label: "Brute",
      order: 0,
      summoned: false,
      stats: { difficulty: 10, major: 5, severe: 10, hpMax: 5, stressMax: 3 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    return { encounterId, instanceId };
  });
  let tokenId: Id<"combatTokens"> | null = null;
  if (opts.map) {
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    tokenId = await t.run(async (ctx) => {
      await ctx.db.patch("combatMaps", mapId, { live: true });
      await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: ids.instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
    });
  }
  const attack = async () => {
    let r = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: ids.instanceId, targets: [w.characterA], idempotencyKey: key() });
    if (r.status === "confirmFear") r = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: ids.instanceId, targets: [w.characterA], spendFear: r.fear, idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`attack not resolved: ${r.status}`);
    return r;
  };
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const request = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))! as Doc<"combatRequests"> & { payload: { damage: number; groupId: string } });
  const answer = (requestId: Id<"combatRequests">, choice: { kind: "noArmor" } | { kind: "armor"; slots?: number }) =>
    player.mutation(api.adversaryActions.respond, { campaignId, requestId, characterId: w.characterA, choice, idempotencyKey: key() });
  const pending = () => player.query(api.adversaryActionsReads.pending, { campaignId, characterId: w.characterA });
  const feed = (c: typeof gm) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  const spotlight = () => gm.query(api.combatSpotlight.state, { campaignId });
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (n: number) =>
    t.run(async (ctx) => {
      const s = await campaignFearState(ctx, campaignId);
      await ctx.db.patch("campaignState", s._id, { fear: n });
    });
  const instance = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", ids.instanceId))!);
  return { w, t, gm, player, campaignId, ...ids, tokenId, attack, rows, notes, sheet, request, answer, pending, feed, spotlight, fear, setFear, instance };
}

/** Ash's thresholds (Chainmail + level, CB p.111). */
const thresholdsOf = (s: CharacterSheet) => derivedThresholds(s);

describe("RC2: A1 Armor Slots on adversary hits", () => {
  it("Book: the hit waits for Ash's armor answer; the prompt offers a slot; no note", async () => {
    const a = await arena();
    const r = await a.attack();
    expect(r.targets[0]).toMatchObject({ hit: true, resolved: false });
    const view = (await a.pending()).find((p) => p.requestId === r.targets[0]!.requestId);
    expect(view).toMatchObject({ role: "target", awaiting: true, maxSlots: 1 });
    await a.answer(r.targets[0]!.requestId!, { kind: "armor" });
    expect((await a.sheet()).armorMarked).toBe(1);
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: no offer; full severity lands at once; the GM gets the note in the hit's group; players never see it", async () => {
    const a = await arena({ rules: [{ key: "armorSlots", value: "manual" }] });
    const before = await a.sheet();
    const r = await a.attack();
    const requestId = r.targets[0]!.requestId!;
    expect(r.targets[0]).toMatchObject({ hit: true, resolved: true });
    const row = await a.request(requestId);
    const expected = pcSeverity(row.payload.damage, thresholdsOf(before));
    const s = await a.sheet();
    expect(s.hp).toBe(expected.hp);
    expect(s.armorMarked).toBe(0);
    const [note, ...more] = await a.notes();
    expect(more).toEqual([]);
    const word = { minor: "Minor", major: "Major", severe: "Severe", none: "no" }[expected.severity];
    expect(note).toMatchObject({ ruleId: "armorSlots", visibility: "gm", characterId: a.w.characterA, groupId: row.payload.groupId, summary: `${before.name} took ${word} damage; Armor Slot not offered` });
    expect((await a.feed(a.gm)).page.some((x) => x._id === note!._id)).toBe(true);
    expect((await a.feed(a.player)).page.some((x) => x.kind === "rule")).toBe(false);
    // Undoing the attack takes the note back with it.
    const gmRow = (await a.rows()).find((x) => x.groupId === row.payload.groupId && x.kind === "adversary" && x.visibility === "gm")!;
    await a.gm.mutation(api.actionLog.undo, { entryId: gmRow._id, idempotencyKey: key() });
    expect((await a.notes())[0]!.undoneAt).toBeDefined();
    expect((await a.sheet()).hp).toBe(0);
  });

  it("Manual: no free Armor Slot means nothing was withheld: no note", async () => {
    const a = await arena({ rules: [{ key: "armorSlots", value: "manual" }], sheet: (s) => ({ ...s, armorMarked: 4 }) });
    await a.attack();
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: an armor answer is refused (nothing to mark)", async () => {
    // A window opened under the Book (the switch flipped while it waited) refuses the slot afterwards.
    const a = await arena();
    const r = await a.attack();
    await a.t.run(async (ctx) => {
      const c = (await ctx.db.get("campaigns", a.campaignId))!;
      await ctx.db.patch("campaigns", a.campaignId, { ruleModes: { ...c.ruleModes, armorSlots: "manual" } });
    });
    expect(errorCode(await a.answer(r.targets[0]!.requestId!, { kind: "armor" }).catch((e: unknown) => e))).toBe("INVALID");
    await a.answer(r.targets[0]!.requestId!, { kind: "noArmor" });
    expect((await a.sheet()).armorMarked).toBe(0);
  });
});

describe("RC2: Massive Damage on PCs (CB p.91)", () => {
  it("on: damage at twice the Severe threshold marks 4 HP; an Armor Slot makes it Severe (3 HP)", async () => {
    for (const armor of [false, true]) {
      const a = await arena({ damage: "1d4+40 phy", rules: [{ key: "massiveDamage", value: true }] });
      const r = await a.attack();
      const requestId = r.targets[0]!.requestId!;
      const view = (await a.pending()).find((p) => p.requestId === requestId)!;
      // The prompt previews 4 HP without a slot and 3 with one.
      expect(view.armorPreview?.map((p) => [p.slots, p.severity, p.hp])).toEqual([
        [0, "severe", 4],
        [1, "severe", 3],
      ]);
      await a.answer(requestId, armor ? { kind: "armor" } : { kind: "noArmor" });
      expect((await a.sheet()).hp).toBe(armor ? 3 : 4);
      const gmRow = (await a.rows()).find((x) => x.visibility === "gm" && x.summary.startsWith("Brute → Ash"))!;
      expect(gmRow.summary).toContain(armor ? "Massive, 1 Armor Slot → Severe" : "Massive → Massive");
    }
  });

  it("off (the default): the same damage is Severe, 3 HP", async () => {
    const a = await arena({ damage: "1d4+40 phy" });
    const r = await a.attack();
    await a.answer(r.targets[0]!.requestId!, { kind: "noArmor" });
    expect((await a.sheet()).hp).toBe(3);
  });

  it("on, with A1 Manual: 4 HP at once and the note says Massive", async () => {
    const a = await arena({ damage: "1d4+40 phy", rules: [{ key: "massiveDamage", value: true }, { key: "armorSlots", value: "manual" }] });
    await a.attack();
    expect((await a.sheet()).hp).toBe(4);
    expect((await a.notes()).map((n) => n.summary)).toEqual(["Ash took Massive damage; Armor Slot not offered"]);
  });
});

describe("RC2: C1 Hidden PCs, adversary side (CB p.102)", () => {
  const d20s = (r: { roll: { dice: { sides: number }[] } | null }) => r.roll!.dice.filter((d) => d.sides === 20).length;

  it("Book: the attack on a Hidden PC rolls with disadvantage (two d20s); no note", async () => {
    const a = await arena({ sheet: (s) => ({ ...s, conditions: ["hidden"] }) });
    const r = await a.attack();
    expect(d20s(r)).toBe(2);
    expect(await a.notes()).toEqual([]);
  });

  it("Manual: one d20, and the GM is asked in the attack's group", async () => {
    const a = await arena({ rules: [{ key: "conditionDice", value: "manual" }], sheet: (s) => ({ ...s, conditions: ["cloaked"] }) });
    const r = await a.attack();
    expect(d20s(r)).toBe(1);
    const notes = await a.notes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ruleId: "conditionDice", visibility: "gm", groupId: r.groupId, characterId: a.w.characterA, summary: "Brute attacks Ash (Cloaked): roll with disadvantage?" });
  });

  it("Manual: no condition, no note", async () => {
    const a = await arena({ rules: [{ key: "conditionDice", value: "manual" }] });
    const r = await a.attack();
    expect(d20s(r)).toBe(1);
    expect(await a.notes()).toEqual([]);
  });
});

describe("RC2: S1 an adversary action gives the GM the spotlight (bead dcm-bxp.99.32.4)", () => {
  it("Book: the spotlight goes to the GM and the adversary's token on the live map is lit", async () => {
    const a = await arena({ map: true });
    expect((await a.spotlight()).holder).toBeNull();
    await a.attack();
    expect(await a.spotlight()).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: a.tokenId, adversaryName: "Brute" });
  });

  it("Book: without a token the GM just holds it", async () => {
    const a = await arena();
    await a.attack();
    expect(await a.spotlight()).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: null });
  });

  it("Book: an adversary already lit with a paid Fear is not charged or counted twice", async () => {
    const a = await arena({ map: true });
    await a.setFear(3);
    await a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, tokenId: a.tokenId!, pay: "fear", idempotencyKey: key() });
    expect(await a.fear()).toBe(2);
    expect(await a.instance()).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
    const r = await a.gm.mutation(api.adversaryActions.attack, { campaignId: a.campaignId, instanceId: a.instanceId, targets: [a.w.characterA], idempotencyKey: key() });
    expect(r.status).toBe("resolved");
    expect(await a.fear()).toBe(2);
    expect(await a.instance()).toMatchObject({ spotlights: 1, spotlightTurn: 1 });
    expect(await a.spotlight()).toMatchObject({ holder: { kind: "gm" }, adversaryTokenId: a.tokenId });
    // And the other way round: taking (with Fear) what the attack already lit spends nothing.
    expect(await a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, tokenId: a.tokenId!, pay: "fear", idempotencyKey: key() })).toEqual({ moved: false });
    expect(await a.fear()).toBe(2);
  });

});

// ---------------------------------------------------------------- pure: the window and the notes

const PC: WindowPc = {
  id: "ash",
  thresholds: { major: 8, severe: 16 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 4,
  cards: [],
};
const HIT = { amount: 12, type: "physical" as const, direct: false, attackerId: "brute", critical: false };

describe("RC2: the reaction window reads the modes (pure)", () => {
  it("A1 Manual: nobody is armor-capable, the prompt offers no slot, an armor answer is refused and a stored one ignored", () => {
    const book = openWindow({ hit: HIT, targetId: "ash", party: [PC] });
    expect(book.armorCapable.ash).toBe(true);
    expect(book.responders.map((r) => r.characterId)).toEqual(["ash"]);

    const manual = openWindow({ hit: HIT, targetId: "ash", party: [PC], rules: { armorSlots: "manual" } });
    expect(manual.armorCapable.ash).toBe(false);
    expect(manual.responders).toEqual([]);
    expect(targetPrompt(manual, PC).maxSlots).toBe(0);
    expect(targetArmorPreview(manual, PC)).toEqual([{ slots: 0, severity: "major", hp: 2 }]);
    // A target who is a responder for another reason (a stored window) can't mark a slot.
    const asked = { ...manual, responders: [{ characterId: "ash", role: "target" as const, cardIds: [] }] };
    expect(respond(asked, { characterId: "ash", choice: { kind: "armor" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    const stored = respond(asked, { characterId: "ash", choice: { kind: "armor" } }, { replay: true });
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(resolveWindow(stored.state, [PC]).result).toMatchObject({ armorSlots: 0, severity: "major", hpMarked: 2 });
  });

  it("D2 Manual: a resistant PC takes the damage in full; Book halves it (rounded up)", () => {
    const resistant: PcDefense = { ...PC, resistance: { physical: "resistant", magic: "none" } };
    expect(resolveWindow(openWindow({ hit: HIT, targetId: "ash", party: [{ ...PC, ...resistant }] }), [resistant]).result).toMatchObject({ taken: 6, severity: "minor" });
    const manual = resolveWindow(openWindow({ hit: HIT, targetId: "ash", party: [{ ...PC, ...resistant }], rules: { resistance: "manual" } }), [resistant]).result!;
    expect(manual).toMatchObject({ taken: 12, severity: "major", resistanceApplied: false });
  });

  it("Massive on: the preview and the resolution mark 4 HP; one slot makes it Severe", () => {
    const hit = { ...HIT, amount: 32 };
    const w = openWindow({ hit, targetId: "ash", party: [PC], rules: { massiveDamage: true } });
    expect(targetArmorPreview(w, PC)).toEqual([
      { slots: 0, severity: "severe", hp: 4 },
      { slots: 1, severity: "severe", hp: 3 },
    ]);
    expect(resolveWindow(w, [PC]).result).toMatchObject({ hpMarked: 4, massive: true });
    const slotted = respond(w, { characterId: "ash", choice: { kind: "armor" } });
    if (!slotted.ok) throw new Error("armor refused");
    expect(resolveWindow(slotted.state, [PC]).result).toMatchObject({ hpMarked: 3, severity: "severe" });
    expect(resolveWindow(slotted.state, [PC]).result?.massive).toBeUndefined();
  });

  it("hitRuleNotes: Book says nothing; Manual names what the app left to the GM", () => {
    const resistant: PcDefense = { ...PC, resistance: { physical: "resistant", magic: "none" } };
    const book = applyHitToPc(resistant, HIT);
    expect(hitRuleNotes("Ash", book, {}, { armorWouldBeOffered: true })).toEqual([]);
    const rules = { armorSlots: "manual", resistance: "manual", stressOverflow: "manual" } as const;
    const full = applyHitToPc({ ...resistant, stress: 6 }, HIT, { convert: "stress" }, rules);
    expect(hitRuleNotes("Ash", full, rules, { armorWouldBeOffered: true }).map((n) => [n.ruleId, n.summary])).toEqual([
      ["armorSlots", "Ash took Major damage; Armor Slot not offered"],
      ["resistance", "Ash resists: halve? (12 taken in full; halved: 6)"],
      ["stressOverflow", "Ash: Stress full, mark 1 HP?"],
    ]);
    expect(hitRuleNotes("Ash", applyHitToPc(PC, HIT), rules, { armorWouldBeOffered: false, riderOverflowDropped: true }).map((n) => n.ruleId)).toEqual(["stressOverflow"]);
    expect(hiddenCondition(["vulnerable"])).toBeNull();
    expect(hiddenCondition(["cloaked", "hidden"])).toBe("hidden");
  });

  it("D4 on a Stress rider: Book marks 1 HP past a full track; Manual drops it and flags it", () => {
    const sheet = { stress: 6, stressMax: 6, hp: 0, hpMax: 6 } as unknown as CharacterSheet;
    const pc = { ...sheet, conditions: [], effects: [], hope: 0 } as unknown as CharacterSheet;
    const book = applyRiders(pc, [{ kind: "stress", amount: 1 }], false);
    expect(book.sheet.hp).toBe(1);
    expect(book.overflowDropped).toBeUndefined();
    const manual = applyRiders(pc, [{ kind: "stress", amount: 1 }], false, false, new Set(), { amount: 0 }, { stressOverflow: "manual" });
    expect(manual.sheet).toMatchObject({ hp: 0, stress: 6 });
    expect(manual.overflowDropped).toBe(true);
  });
});
