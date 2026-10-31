/**
 * Plan lanes-2 wave 9, E1.3b (docs/tasks/TASK-LN3-E1B.md): what the target brings to a PC's map attack, and the plain
 * Duality roll's weapon pick and ends.
 *
 * Book texts:
 * - Hidden (CB p.102): "While Hidden, any rolls against you have disadvantage." Vulnerable (CB p.102): "When a creature is
 *   Vulnerable, all rolls targeting them have advantage."
 * - Breaking Blow (CB p.331): "When you make a successful attack, you can mark a Stress to make the next successful attack
 *   against that same target deal an extra 2d12 damage."
 * - Vanishing Act (CB p.42): "You remain Cloaked in this way until you roll with Fear or until your next rest."
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn while the test runs. */
function serverDice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const encounterId = await t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    return ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
  });
  let order = 0;
  const enemy = async (label: string, extra: { conditions?: string[]; tags?: string[]; x?: number } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: (extra.conditions ?? []) as never,
        tags: extra.tags ?? [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: extra.x ?? 6, y: 10, face: Math.PI });
      return { instanceId, tokenId };
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: { spiritWeapon?: boolean } = {}) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], ...extra, idempotencyKey: key() });
  return { w, t, player, enemy, sheet, edit, rows, attack };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

const roles = (r: { roll: { dice: { role: string }[] } }) => r.roll.dice.map((d) => d.role);

describe("the target's conditions reach the attack roll (dcm-c09o, CB p.102)", () => {
  it("a Hidden target gives the attack disadvantage; a Vulnerable one advantage; both cancel", async () => {
    const a = await arena();
    const hidden = await a.enemy("Shade", { conditions: ["hidden"] });
    expect(roles(resolved(await a.attack(a.player, [hidden.tokenId])))).toContain("disadvantage");
    const open = await a.enemy("Brute", { conditions: ["vulnerable"] });
    const r = resolved(await a.attack(a.player, [open.tokenId]));
    expect(roles(r)).toContain("advantage");
    expect(roles(r)).not.toContain("disadvantage");
  });
});

describe("an instance's attackedRider on a PC's attack (dcm-yd5h, dcm-9gw)", () => {
  it("Breaking Blow's tag adds 2d12 to another PC's successful attack, named in the riders; the GM row says how much", async () => {
    const a = await arena();
    const target = await a.enemy("Ogre", { tags: ["Breaking Blow"] });
    serverDice(6, 3);
    const r = resolved(await a.attack(a.player, [target.tokenId]));
    expect(r.roll.outcome).not.toBe("critical");
    expect(r.targets[0]!.hit).toBe(true);
    expect(r.riders).toContain("Breaking Blow");
    const gm = (await a.rows()).map((row) => row.summary).join("\n");
    expect(gm).toMatch(/Breaking Blow \+\d+/);
  });

  it("the caster's own attack doesn't add it twice (by: others; Breaking Blow in the loadout)", async () => {
    const a = await arena();
    await a.edit((s) => ({ domainCards: { owned: [...s.domainCards.owned, "breaking-blow"], loadout: [...s.domainCards.loadout, "breaking-blow"] } }));
    const target = await a.enemy("Ogre", { tags: ["Breaking Blow"] });
    serverDice(6, 3);
    resolved(await a.attack(a.player, [target.tokenId]));
    const gm = (await a.rows()).map((row) => row.summary).join("\n");
    expect(gm).not.toMatch(/Breaking Blow \+\d+/);
  });
});

describe("orchestrator: a ticked Spirit Weapon reaches Close in combatActions.attack (dcm-xbtw, CB p.44)", () => {
  it("a Close target is in range with the box ticked; unticked it goes to the GM", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "seraph", subclassId: "divine-wielder", subclassRank: "foundation", primaryWeaponId: "broadsword" }) as Partial<CharacterSheet>);
    const close = await a.enemy("Archer", { x: 10 });
    serverDice(6, 3);
    expect((await a.attack(a.player, [close.tokenId])).status).toBe("pending");
    expect((await a.attack(a.player, [close.tokenId], { spiritWeapon: true })).status).not.toBe("pending");
  });
});

describe("plain Duality rolls (dcm-6qrn, dcm-bxp.99.19.66)", () => {
  const roll = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [] };

  it("an attack roll may name its weapon; a plain roll can't name one without being an attack", async () => {
    const a = await arena();
    const out = await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, ...roll, attack: true, weapon: "primary", idempotencyKey: key() });
    expect(out.roll.kind).toBe("action");
    const plain = await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, ...roll, attack: false, weapon: "primary", idempotencyKey: key() }).then(
      () => "ok",
      (e: unknown) => errorCode(e),
    );
    // The weapon is only read on an attack roll: a plain roll with one still rolls.
    expect(plain).toBe("ok");
  });

  it("a plain roll with Fear ends Vanishing Act's Cloaked (CB p.42); with Hope it stays", async () => {
    const a = await arena();
    const marker: Effect = { id: `${effectKeyOf("subclass:nightwalker:vanishing-act")}:1`, source: "Vanishing Act", text: "cloaked", until: "rest" };
    await a.edit((s) => ({ conditions: ["cloaked"], effects: [...s.effects, marker] }));
    // Hope 6, Fear 3: with Hope.
    serverDice(6, 3);
    await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, ...roll, attack: false, idempotencyKey: key() });
    expect((await a.sheet()).conditions).toContain("cloaked");
    vi.restoreAllMocks();
    // Hope 2, Fear 5: with Fear (a reaction roll too: "until you roll with Fear").
    serverDice(2, 5);
    await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, ...roll, kind: "reaction", attack: false, idempotencyKey: key() });
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });
});
