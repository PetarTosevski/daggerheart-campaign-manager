/**
 * Plan lanes-2 wave 10, tracer S1.4 (docs/tasks/TASK-LN4-S1.md): the domain-card data switched this wave, proven through
 * the real server paths with the real SRD entries (no fixtures). Printed pages: CB = Core Book, HF = Hope & Fear.
 *
 * - Vitality (CB p.330): "When you choose this card, permanently gain two of the following benefits: • One Stress slot
 *   • One Hit Point slot • +2 bonus to your damage thresholds Then place this card in your vault permanently."
 * - Invisibility (CB p.334): "After the action that spends the last token is resolved, the effect ends."
 * - Time Lock (Book of Grynn, CB p.333): "If a creature tries to move it, make a Spellcast Roll against them to maintain
 *   this spell."
 * - Confusing Aura (CB p.329): "If any roll a 5 or higher, one layer of the aura is destroyed and the attack fails. If all
 *   the results are 4 or lower, you take the damage and this spell ends."
 * - Through Your Eyes (CB p.335) / Sensory Projection (CB p.329): "until you cast another spell" / "casting another spell".
 * - Rune Ward (CB p.328): "The ward's holder can spend a Hope to reduce incoming damage by 1d8."
 * - Encore (CB p.335): "you deal the same damage to the target that your ally dealt."
 * - Breaking Blow (CB p.331): "the next successful attack against that same target deal an extra 2d12 damage."
 * - Lead by Example (CB p.342): "The next PC to make an attack against that adversary can clear a Stress or gain a Hope"
 *   (user answers: other PCs only; the pick is made before the roll and used up by that attack, hit or miss).
 * - Hold the Line (CB p.342): "If an adversary moves within Very Close range, they're pulled into Melee range and
 *   Restrained."
 * - Mysterious Mist (Book of Tyfar, CB p.332), Hush, Veil of Night (CB p.336), Eclipse (CB p.337): the card areas.
 * - Kept: Flight (CB p.328) and Avatar of Terror (HF p.181) still need their reminders on the attack path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { areaSpecOf } from "../../convex/combatAreas";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { bandsOnMap, openIncomingHit, partyMembers } from "../../convex/lib/incomingHits";
import { tokenDistance } from "../../src/lib/domain/combat-actions/distance";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

/** The server's dice: each queued value is the next die; the real generator after. */
function serverDice(...values: number[]) {
  vi.restoreAllMocks();
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

allowWorldEmails();
afterEach(() => {
  vi.restoreAllMocks();
});

type Choice = { id: string; value: unknown };
type Square = { x: number; y: number };

/** The world on a live map: Ash (characterA) at (5, 10), Bryn (characterB) at (5, 12), a running encounter. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const other = w.as("otherPlayer");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 5, y: 12, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = (label: string, x: number, y: number, extra: { difficulty?: number } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: extra.difficulty ?? 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const token = (id: Id<"combatTokens">) => t.run(async (ctx) => (await ctx.db.get("combatTokens", id))!);
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const sheet = () => sheetOf(w.characterA);
  const editOf = (id: Id<"characters">, patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, primaryWeaponId: "shortbow", ...patch });
    });
  const edit = (patch: Partial<CharacterSheet>) => editOf(w.characterA, patch);
  const holding = (cards: string[], extra: Partial<CharacterSheet> = {}) => edit({ domainCards: { owned: cards, loadout: cards.slice(0, 5) }, hope: 4, stress: 0, ...extra });
  const attackAs = (who: "a" | "b", targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    (who === "a" ? player : other).mutation(api.combatActions.attack, {
      campaignId,
      characterId: who === "a" ? w.characterA : w.characterB,
      mapId,
      targetTokenIds,
      slot: "primary",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
      ...extra,
    } as never);
  const attack = (targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) => attackAs("a", targetTokenIds, extra);
  const use = (cardId: string, extra: { spell?: string; targetTokenIds?: Id<"combatTokens">[]; choices?: Choice[]; point?: Square; points?: Square[] } = {}) =>
    player.mutation(api.combatCards.useCard, {
      campaignId,
      characterId: w.characterA,
      mapId,
      cardId,
      targetTokenIds: extra.targetTokenIds ?? [],
      choices: (extra.choices ?? []) as never,
      ...(extra.spell ? { spell: extra.spell } : {}),
      ...(extra.point ? { point: extra.point } : {}),
      ...(extra.points ? { points: extra.points } : {}),
      idempotencyKey: key(),
    });
  const areas = () => t.run(async (ctx) => (await ctx.db.query("combatAreas").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).take(50)).filter((a) => a.status === "active"));
  /** A bear's physical hit on Ash, resolved without armor (Ash's answer, then Done if the window stays open). */
  const hitAsh = async (instanceId: Id<"encounterAdversaries">, amount: number) => {
    const opened = await t.run(async (ctx) =>
      openIncomingHit(ctx, {
        campaignId,
        encounterId: ids.encounterId,
        mapId,
        createdBy: w.users.gm,
        groupId: `g-${key()}`,
        attacker: { instanceId, label: "Bear" },
        targetCharacterId: w.characterA,
        hit: { amount, type: "physical", direct: false, forcedArmor: 0, critical: false },
        party: await partyMembers(ctx, campaignId),
        bands: await bandsOnMap(ctx, undefined),
      }),
    );
    const respond = (choice: Record<string, unknown>) => player.mutation(api.adversaryActions.respond, { campaignId, requestId: opened.requestId!, characterId: w.characterA, choice: choice as never, idempotencyKey: key() });
    if ((await respond({ kind: "noArmor" })).status === "open") await respond({ kind: "pass" });
  };
  return { w, t, campaignId, mapId, gm, player, other, ...ids, enemy, instance, token, sheet, sheetOf, edit, editOf, holding, attack, attackAs, use, areas, hitAsh };
}

type Arena = Awaited<ReturnType<typeof arena>>;

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}: ${JSON.stringify(r)}`);
  return r as Extract<T, { status: "resolved" }>;
}

const sources = (s: CharacterSheet) => s.effects.map((e) => e.source);
const tokensOf = (s: CharacterSheet, cardId: string) => s.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0;
/** The manual reminders a resolved use or attack shows the table. */
const reminders = (r: object) => {
  const { prompts = [], riderPrompts = [] } = r as { prompts?: { kind?: string; text?: string }[]; riderPrompts?: { kind?: string; text?: string }[] };
  return [...prompts, ...riderPrompts].filter((p) => p.kind === "manual").map((p) => p.text ?? "");
};
const summaries = (a: Arena) => a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).map((row) => row.summary).join("\n"));

describe("S1.4: Vitality's picks are made at the level-up (blade.ts, dcm-40mj)", () => {
  it("level 5 with Vitality keeps the two benefits for good and vaults the card; without the picks LEVEL_UP_RULE", async () => {
    const w = await buildWorld({ classId: "warrior" });
    const gm = w.as("gm");
    const { cardsForDomains, getClass } = await import("../../src/lib/srd/index");
    const read = () => w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    const owned = new Set((await read()).domainCards.owned);
    const cardFor = (level: number) => {
      const card = cardsForDomains(getClass("warrior")!.domains, level).find((c) => c.level <= level && c.source === "core" && !owned.has(c.id) && c.id !== "vitality")!;
      owned.add(card.id);
      return card.id;
    };
    const levels = [
      { picks: [{ option: "hp" as const, tier: 2 }, { option: "stress" as const, tier: 2 }], experienceName: "Grit", cardId: cardFor(2) },
      { picks: [{ option: "hp" as const, tier: 2 }, { option: "stress" as const, tier: 2 }], cardId: cardFor(3) },
      { picks: [{ option: "evasion" as const, tier: 2 }, { option: "traits" as const, tier: 2, targets: ["agility", "strength"] }], cardId: cardFor(4) },
    ];
    for (const choice of levels) await gm.mutation(api.levelUp.apply, { characterId: w.characterA, choice, idempotencyKey: key() });
    const before = await read();
    const five = { picks: [{ option: "hp" as const, tier: 3 }, { option: "stress" as const, tier: 3 }], experienceName: "Unbreakable", cardId: "vitality" };
    await expect(gm.mutation(api.levelUp.apply, { characterId: w.characterA, choice: five, idempotencyKey: key() }).catch(errorCode)).resolves.toBe("LEVEL_UP_RULE");
    await gm.mutation(api.levelUp.apply, { characterId: w.characterA, choice: { ...five, cardChoices: { vitality: { benefits: ["hp", "thresholds"] } } }, idempotencyKey: key() });
    const after = await read();
    expect(after.level).toBe(5);
    // The level's own Hit Point and Stress slots, plus Vitality's Hit Point slot.
    expect(after.hpMax).toBe(before.hpMax + 2);
    expect(after.stressMax).toBe(before.stressMax + 1);
    expect(after.slotBonuses).toEqual(expect.arrayContaining(["card:vitality:hp+1", "card:vitality:major+2", "card:vitality:severe+2"]));
    expect(after.domainCards.owned).toContain("vitality");
    expect(after.domainCards.loadout).not.toContain("vitality");
  });
});

describe("S1.4: what a card use ends is applied on the card path (cardRows applyUseEnds, dcm-m48i)", () => {
  it("Invisibility: spending the last token ends Invisible on the ally, with no reminder", async () => {
    const a = await arena();
    await a.t.run((ctx) => ctx.db.patch("combatTokens", a.bryn, { y: 11 }));
    await a.holding(["invisibility"]);
    serverDice(12, 5);
    resolved(await a.use("invisibility", { targetTokenIds: [a.bryn] }));
    expect(sources(await a.sheetOf(a.w.characterB))).toContain("Invisibility");
    await a.edit({ cardTokens: [{ cardId: "invisibility", count: 2 }] });
    const first = resolved(await a.use("invisibility", { spell: "spend-token" }));
    expect(reminders(first)).toEqual([]);
    expect(sources(await a.sheetOf(a.w.characterB))).toContain("Invisibility");
    resolved(await a.use("invisibility", { spell: "spend-token" }));
    expect(tokensOf(await a.sheet(), "invisibility")).toBe(0);
    expect(sources(await a.sheetOf(a.w.characterB))).not.toContain("Invisibility");
  });

  it("Time Lock: a failed maintain roll ends the spell, with no reminder", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10, { difficulty: 30 });
    await a.holding(["book-of-grynn"]);
    resolved(await a.use("book-of-grynn", { spell: "time-lock" }));
    expect((await a.sheet()).effects.map((e) => e.text.split("; ")[0])).toContain("Time Lock");
    serverDice(2, 3);
    const r = resolved(await a.use("book-of-grynn", { spell: "time-lock-maintain", targetTokenIds: [bear.tokenId], choices: [{ id: "situations", value: ["A creature tries to move your time-locked object"] }] }));
    expect(r.success).toBe(false);
    expect(reminders(r)).toEqual([]);
    expect((await a.sheet()).effects).toEqual([]);
  });

  it("Confusing Aura: a 5 or higher destroys a layer; all 4 or lower ends the spell, with no reminder", async () => {
    const a = await arena();
    await a.holding(["confusing-aura"]);
    serverDice(12, 5);
    resolved(await a.use("confusing-aura", { choices: [{ id: "n:layers", value: 1 }] }));
    expect(tokensOf(await a.sheet(), "confusing-aura")).toBe(2);
    serverDice(6, 1);
    resolved(await a.use("confusing-aura", { spell: "attacked" }));
    expect(tokensOf(await a.sheet(), "confusing-aura")).toBe(1);
    expect(sources(await a.sheet())).toContain("Confusing Aura");
    serverDice(4);
    const r = resolved(await a.use("confusing-aura", { spell: "attacked" }));
    expect(reminders(r)).toEqual([]);
    expect(sources(await a.sheet())).not.toContain("Confusing Aura");
  });

  it("Through Your Eyes and Sensory Projection end when another spell is cast", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(["through-your-eyes", "sensory-projection", "invisibility"]);
    resolved(await a.use("through-your-eyes", { targetTokenIds: [bear.tokenId] }));
    serverDice(12, 5);
    resolved(await a.use("sensory-projection"));
    expect(sources(await a.sheet())).toEqual(["Sensory Projection"]);
    serverDice(12, 5);
    resolved(await a.use("invisibility", { targetTokenIds: [a.ash] }));
    expect(sources(await a.sheet())).toEqual(["Invisibility"]);
  });
});

describe("S1.4: payers and the trigger's damage type reach the card run (cardRunner, dcm-q40t)", () => {
  it("Rune Ward held by an ally: the holder pays the Hope; with none the ward is refused", async () => {
    const a = await arena();
    await a.holding(["rune-ward"]);
    await a.editOf(a.w.characterB, { hope: 0 });
    const ward = () => a.use("rune-ward", { spell: "ally", targetTokenIds: [a.bryn], choices: [{ id: "triggerSubject", value: a.bryn }] });
    await expect(ward().catch(errorCode)).resolves.toBe("CARD_COST_UNPAID");
    await a.editOf(a.w.characterB, { hope: 2 });
    const r = resolved(await ward());
    expect(reminders(r)).toEqual([]);
    expect((await a.sheetOf(a.w.characterB)).hope).toBe(1);
    expect((await a.sheet()).hope).toBe(4);
  });

  it("Encore: the same damage in the ally's damage type, with no reminder", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(["encore"]);
    serverDice(12, 5);
    const choices = [
      { id: "triggerSubject", value: bear.tokenId },
      { id: "triggerAmount", value: 9 },
      { id: "triggerDamageType", value: "magic" },
    ];
    const r = resolved(await a.use("encore", { targetTokenIds: [bear.tokenId], choices }));
    expect(reminders(r)).toEqual([]);
    expect(await summaries(a)).toMatch(/Encore.*damage 9 mag/);
  });
});

describe("S1.4: tags another PC's attack reads (combatActions instanceAttackedRiders)", () => {
  it("Lead by Example: Bryn's next attack takes the picked Hope and uses the tag up; Ash's own attack doesn't", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 11, { difficulty: 30 });
    await a.holding(["lead-by-example"]);
    await a.editOf(a.w.characterB, { hope: 2 });
    const r = resolved(await a.use("lead-by-example", { targetTokenIds: [bear.tokenId], choices: [{ id: "triggerSubject", value: bear.tokenId }] }));
    expect(reminders(r)).toEqual([]);
    expect((await a.sheet()).stress).toBe(1);
    expect((await a.instance(bear.instanceId)).tags).toContain("Lead by Example");
    // Fail with Hope against Difficulty 30: Ash gains the roll's Hope only (Courage needs Fear).
    serverDice(3, 2);
    resolved(await a.attack([bear.tokenId], { benefit: "hope" }));
    expect((await a.sheet()).hope).toBe(5);
    expect(await summaries(a)).not.toContain("Lead by Example: gains");
    expect((await a.instance(bear.instanceId)).tags).toContain("Lead by Example");
    serverDice(3, 2);
    resolved(await a.attackAs("b", [bear.tokenId], { benefit: "hope" }));
    // The roll's Hope and the benefit's.
    expect((await a.sheetOf(a.w.characterB)).hope).toBe(4);
    expect(await summaries(a)).toContain("Lead by Example: gains 1 Hope");
    expect((await a.instance(bear.instanceId)).tags).not.toContain("Lead by Example");
  });
});

describe("S1.4: Hold the Line's pull runs on the adversary's move (combatAreas rangeTriggersAfterMove, dcm-trib)", () => {
  it("while the stance holds, an adversary moving within Very Close is pulled into Melee and Restrained", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 14, 10);
    await a.holding(["hold-the-line"]);
    const r = resolved(await a.use("hold-the-line"));
    expect(reminders(r)).toEqual([]);
    expect((await a.sheet()).hope).toBe(3);
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: bear.tokenId, x: 7, y: 10 });
    expect(tokenDistance(await a.token(bear.tokenId), await a.token(a.ash))).toBeLessThanOrEqual(1);
    expect((await a.instance(bear.instanceId)).conditions).toContain("restrained");
  });

  it("without the stance the move stays where it ended", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 14, 10);
    await a.holding(["hold-the-line"]);
    await a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: bear.tokenId, x: 7, y: 10 });
    expect(await a.token(bear.tokenId)).toMatchObject({ x: 7, y: 10 });
    expect((await a.instance(bear.instanceId)).conditions).not.toContain("restrained");
  });
});

describe("S1.4: card areas (useCard places them on the squares the Hand picks, dcm-9nlr / dcm-o44e)", () => {
  it("Mysterious Mist: a sight-blocking fog on the picked square, with no reminder", async () => {
    const a = await arena();
    await a.holding(["book-of-tyfar"]);
    serverDice(12, 5);
    const r = resolved(await a.use("book-of-tyfar", { spell: "mysterious-mist", point: { x: 6, y: 10 } }));
    expect(reminders(r)).toEqual([]);
    expect(await a.areas()).toMatchObject([{ label: "Mysterious Mist", blocksSight: true, centre: { kind: "square", x: 6, y: 10 } }]);
  });

  it("Hush: the caster's Major damage ends the area and the target's silence", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(["hush"], { armorId: "chainmail-armor", armorMarked: 0, hp: 0 });
    serverDice(12, 5);
    resolved(await a.use("hush", { targetTokenIds: [bear.tokenId] }));
    expect((await a.areas()).map((x) => x.label)).toEqual(["Hush"]);
    await a.hitAsh(bear.instanceId, 10);
    expect(await a.areas()).toEqual([]);
    expect((await a.instance(bear.instanceId)).effects ?? []).toEqual([]);
  });

  it("Veil of Night: a wall only its caster sees through; casting another spell ends it and the effect", async () => {
    const a = await arena();
    await a.holding(["veil-of-night", "invisibility"]);
    serverDice(12, 5);
    const r = resolved(await a.use("veil-of-night", { point: { x: 8, y: 8 }, points: [{ x: 8, y: 12 }] }));
    expect(reminders(r)).toEqual([]);
    const [veil] = await a.areas();
    expect(veil).toMatchObject({ label: "Veil of Night", shape: "wall", wall: { a: [8, 8], b: [8, 12] }, blocksSight: true });
    expect(areaSpecOf(veil!.featureId, veil!.useId, veil!.label)).toMatchObject({ seeThrough: "owner", ownerPerObserver: "hidden" });
    serverDice(12, 5);
    resolved(await a.use("invisibility", { targetTokenIds: [a.ash] }));
    expect(await a.areas()).toEqual([]);
    expect(sources(await a.sheet())).not.toContain("Veil of Night");
  });

  it("Eclipse: darkness of Far radius where the caster stood, seen through by the party; their Severe damage ends it", async () => {
    const a = await arena();
    await a.holding(["eclipse"], { armorId: "chainmail-armor", armorMarked: 0, hp: 0 });
    serverDice(12, 12);
    const r = resolved(await a.use("eclipse"));
    expect(reminders(r)).toEqual([]);
    const [dark] = await a.areas();
    expect(dark).toMatchObject({ label: "Eclipse", radius: "far", blocksSight: true, centre: { kind: "square", x: 5, y: 10 } });
    expect(areaSpecOf(dark!.featureId, dark!.useId, dark!.label)).toMatchObject({ seeThrough: "ownerAndAllies" });
    const bear = await a.enemy("Bear", 7, 10);
    await a.hitAsh(bear.instanceId, 10);
    expect((await a.areas()).map((x) => x.label)).toEqual(["Eclipse"]);
    await a.hitAsh(bear.instanceId, 20);
    expect(await a.areas()).toEqual([]);
  });
});

describe("S1.4: kept reminders (the engine path is not live on every route; wave 11)", () => {
  it("Flight: an attack spends the last token but Flying stays, so the reminder stays", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(["flight"]);
    serverDice(12, 5);
    resolved(await a.use("flight"));
    await a.edit({ cardTokens: [{ cardId: "flight", count: 1 }] });
    serverDice(12, 5, 3, 3);
    const r = resolved(await a.attack([bear.tokenId]));
    expect(tokensOf(await a.sheet(), "flight")).toBe(0);
    expect(sources(await a.sheet())).toContain("Flight");
    expect(reminders(r).join(" ")).toContain("last Flight token");
  });

  it("Breaking Blow: the attack that marks the target also runs the card's own `extra` use, which clears the new tag", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 11);
    await a.holding(["breaking-blow"]);
    serverDice(9, 3, 4);
    const r = resolved(await a.attack([bear.tokenId], { riders: [{ source: "card", id: "breaking-blow", useId: "main", choices: [] }] }));
    expect(r.riders).toContain("Breaking Blow");
    expect(reminders(r).join(" ")).toContain("extra 2d12");
    expect((await a.instance(bear.instanceId)).tags).not.toContain("Breaking Blow");
  });

  it("Avatar of Terror: at 0 Hope an attack's upkeep doesn't end the form, so the reminder stays", async () => {
    const a = await arena();
    const bear = await a.enemy("Bear", 7, 10);
    await a.holding(["avatar-of-terror"]);
    resolved(await a.use("avatar-of-terror"));
    await a.edit({ hope: 0 });
    serverDice(12, 5, 3, 3);
    const r = resolved(await a.attack([bear.tokenId]));
    expect(sources(await a.sheet())).toContain("Avatar of Terror");
    expect(reminders(r).join(" ")).toContain("revert to your normal form");
  });
});
