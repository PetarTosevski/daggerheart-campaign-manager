/**
 * Plan rule-switches RS2 (docs/tasks/TASK-RULES-RS2.md; bead dcm-bxp.99.32.5): S2 `playersWait`, "Players wait while
 * the GM has it". CB p.100: "When play passes to the GM, the GM can make a move to spotlight an adversary … Once the GM
 * has finished, play passes back to the PCs."
 *
 * - Book: while the GM holds the spotlight a player's action roll, Tag Team, card, feature, weapon attack and token move
 *   are refused with SPOTLIGHT_WITH_GM before anything is written. Reaction rolls and damage rolls pass; the GM, a co-GM
 *   and the GM playing for a PC are never refused.
 * - Manual (user answer Q4 a): everything goes through; the GM gets one note per PC and kind for the spotlight
 *   ("Ash acted while you held the spotlight", "Ash moved while you held the spotlight").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { playersWaitNote, useActKind } from "../../convex/lib/spotlight";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>(), features: new Map<string, unknown>() }));

vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});

const n = (value: number) => ({ kind: "fixed" as const, value });
const ABILITY = "deft-maneuvers";
/** A level 1 card in Ash's vault (Book of Ava, Recall Cost 2). */
const VAULTED = "book-of-ava";
const ONE_ENEMY = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
/** A card with an Agility action roll against a fixed Difficulty 12. */
const CARD: CardEffect = {
  cardId: ABILITY,
  uses: [{ id: "hex", name: "Hex", activation: { kind: "action" }, roll: { kind: "trait", trait: "agility", difficulty: { kind: "fixed", value: 12 } }, targets: ONE_ENEMY, steps: [] }],
};
/** A feature attack with a trait roll against the target's Difficulty. */
const BITE_ID = "subclass:call-of-the-brave:battle-ritual";
const BITE: FeatureEffect = {
  featureId: BITE_ID,
  source: "subclass",
  owner: "call-of-the-brave",
  card: "foundation",
  uses: [
    {
      id: "main",
      name: "Bite",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "agility", difficulty: { kind: "target" }, attack: true },
      targets: ONE_ENEMY,
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: n(1), sides: 4 } }, type: "physical" }],
    },
  ],
};
injected.cards.set(CARD.cardId, CARD);
injected.features.set(BITE.featureId, BITE);

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn (Hope Die first), then repeat. */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
};

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/**
 * The world (Ash is the player's character), a live medium map with Ash's token at (5, 10) and a Bear (Difficulty 1)
 * next to it in a running encounter, Ash holding the test card and feature. `gmHolds` (default): the GM took the spotlight.
 */
async function table(playersWait: "book" | "manual", options: { gmHolds?: boolean; encounter?: "running" | "draft" } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: { playersWait } });
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const status = options.encounter ?? "running";
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status, pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, ...(status === "running" ? { startedAt: now } : {}) });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Bear",
      order: 0,
      summoned: false,
      stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    });
    const bear = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", hope: 6, domainCards: { owned: [ABILITY, VAULTED], loadout: [ABILITY] } } as CharacterSheet);
    return { ash, bear };
  });
  if (options.gmHolds !== false) await gm.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: key() });

  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule" && r.ruleId === "playersWait");
  const token = () => t.run(async (ctx) => (await ctx.db.get("combatTokens", ids.ash))!);
  type Who = typeof player;
  const acts = {
    actionRoll: (as: Who = player) => as.mutation(api.rolls.actionRoll, { characterId: w.characterA, kind: "action", ...rollFields, idempotencyKey: key() }),
    manualRoll: (as: Who = player) => as.mutation(api.rolls.manualRoll, { characterId: w.characterA, values: [8, 3], roll: { ...agility, difficulty: 1 }, idempotencyKey: key() }),
    tagTeam: (as: Who = player) =>
      as.mutation(api.rolls.tagTeam, { characterId: w.characterA, partnerId: w.characterB, initiator: { trait: "agility", modifier: 0 }, partner: { trait: "agility", modifier: 0 }, idempotencyKey: key() }),
    useCard: (as: Who = player) =>
      as.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell: "hex", targetTokenIds: [ids.bear], choices: [], idempotencyKey: key() }),
    useFeature: (as: Who = player) =>
      as.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: BITE_ID, targetTokenIds: [ids.bear], choices: [], idempotencyKey: key() }),
    attack: (as: Who = player) =>
      as.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds: [ids.bear], slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() } as never),
  } as const;
  const recall = (as: Who = player) => as.mutation(api.characters.moveCard, { characterId: w.characterA, cardId: VAULTED, to: "loadout" });
  const loadout = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet).domainCards.loadout);
  const state = (as: Who = player) => as.query(api.combatSpotlight.state, { campaignId });
  const move = (as: Who = player, x = 4) => as.mutation(api.combatTokens.move, { campaignId, tokenId: ids.ash, x, y: 10 });
  return { w, t, campaignId, mapId, gm, player, ...ids, rows, notes, token, acts, move, recall, loadout, state };
}

/** An action roll's fields (Agility, no modifiers, Difficulty 1). */
const rollFields = { trait: "agility" as const, modifier: 0, difficulty: 1, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

const ACTIONS = ["actionRoll", "manualRoll", "tagTeam", "useCard", "useFeature", "attack"] as const;

describe("S2 Book: a player's action waits while the GM holds the spotlight", () => {
  for (const name of ACTIONS) {
    it(`${name} is SPOTLIGHT_WITH_GM and writes nothing`, async () => {
      const a = await table("book");
      const before = (await a.rows()).length;
      const sheet = await a.t.run(async (ctx) => (await ctx.db.get("characters", a.w.characterA))!.sheet);
      dice(8, 3);
      expect(await code(a.acts[name]())).toBe("SPOTLIGHT_WITH_GM");
      expect((await a.rows()).length).toBe(before);
      expect(await a.t.run(async (ctx) => (await ctx.db.get("characters", a.w.characterA))!.sheet)).toEqual(sheet);
    });
  }

  it("a token move is SPOTLIGHT_WITH_GM and the token stays; the GM's drag goes through", async () => {
    const a = await table("book");
    expect(await code(a.move())).toBe("SPOTLIGHT_WITH_GM");
    expect((await a.token()).x).toBe(5);
    expect(await code(a.move(a.gm, 3))).toBe("ok");
    expect((await a.token()).x).toBe(3);
  });

  it("reactions and follow-ups pass: a reaction roll and a damage roll", async () => {
    const a = await table("book");
    dice(8, 3);
    expect(await code(a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, kind: "reaction", ...rollFields, idempotencyKey: key() }))).toBe("ok");
    expect(await code(a.player.mutation(api.rolls.manualRoll, { characterId: a.w.characterA, values: [8, 3], roll: { ...agility, kind: "reaction" }, idempotencyKey: key() }))).toBe("ok");
    expect(
      await code(a.player.mutation(api.rolls.damageRoll, { characterId: a.w.characterA, source: { kind: "dice", dice: [{ count: 1, sides: 6 }] }, modifier: 0, critical: false, options: [], idempotencyKey: key() })),
    ).toBe("ok");
  });

  for (const name of ACTIONS) {
    it(`the GM playing for Ash is never refused (${name})`, async () => {
      const a = await table("book");
      dice(8, 3);
      expect(await code(a.acts[name](a.gm))).toBe("ok");
    });
  }

  it("a co-GM's action and drag for Ash pass", async () => {
    const a = await table("book");
    dice(8, 3);
    expect(await code(a.acts.actionRoll(a.w.as("coGm")))).toBe("ok");
    expect(await code(a.move(a.w.as("coGm")))).toBe("ok");
  });

  it("once the GM hands the spotlight back (to the PC or the party) the player acts again", async () => {
    const a = await table("book");
    await a.gm.mutation(api.combatSpotlight.handTo, { campaignId: a.campaignId, characterId: a.w.characterB, idempotencyKey: key() });
    dice(8, 3);
    expect(await code(a.acts.actionRoll())).toBe("ok");
    expect(await code(a.move())).toBe("ok");
  });

  it("nobody holding it: nothing waits", async () => {
    const a = await table("book", { gmHolds: false });
    dice(8, 3);
    for (const name of ACTIONS) expect([name, await code(a.acts[name]())]).toEqual([name, "ok"]);
    expect(await a.notes()).toEqual([]);
  });
});

describe("S2 Manual (Q4 a): the act goes through and the GM gets a note", () => {
  for (const name of ACTIONS) {
    it(`${name} goes through with one GM-only note`, async () => {
      const a = await table("manual");
      dice(8, 3);
      expect(await code(a.acts[name]())).toBe("ok");
      const notes = await a.notes();
      expect(notes.map((r) => [r.summary, r.visibility, r.kind, r.undoable])).toEqual([["Ash acted while you held the spotlight", "gm", "rule", false]]);
    });
  }

  it("one note per PC and kind while the GM holds it; a new hold notes again", async () => {
    const a = await table("manual");
    dice(8, 3);
    await a.acts.actionRoll();
    await a.acts.actionRoll();
    await a.move();
    await a.move(a.player, 3);
    expect((await a.notes()).map((r) => r.summary)).toEqual(["Ash acted while you held the spotlight", "Ash moved while you held the spotlight"]);

    await a.gm.mutation(api.combatSpotlight.handToParty, { campaignId: a.campaignId, idempotencyKey: key() });
    await a.gm.mutation(api.combatSpotlight.gmTake, { campaignId: a.campaignId, idempotencyKey: key() });
    await a.acts.actionRoll();
    expect((await a.notes()).map((r) => r.summary)).toHaveLength(3);
  });

  it("players never see the note; the GM and reactions add none", async () => {
    const a = await table("manual");
    dice(8, 3);
    await a.player.mutation(api.rolls.actionRoll, { characterId: a.w.characterA, kind: "reaction", ...rollFields, idempotencyKey: key() });
    await a.acts.actionRoll(a.gm);
    await a.move(a.gm, 3);
    expect(await a.notes()).toEqual([]);
    await a.acts.actionRoll();
    const feed = await a.player.query(api.feed.list, { campaignId: a.campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(JSON.stringify(feed)).not.toContain("while you held the spotlight");
  });
});

describe("helpers", () => {
  it("useActKind: a reaction activation or a reaction roll is a reaction; everything else an action", () => {
    expect(useActKind(CARD.uses[0]!)).toBe("action");
    expect(useActKind({ activation: { kind: "reaction", trigger: { kind: "magicalEffect" } } })).toBe("reaction");
    expect(useActKind({ activation: { kind: "action" }, roll: { kind: "reaction", trait: "agility", difficulty: { kind: "gm" } } })).toBe("reaction");
    expect(useActKind({ activation: { kind: "rider", trigger: { kind: "magicalEffect" } } })).toBe("action");
  });

  it("playersWaitNote words the GM's note", () => {
    expect(playersWaitNote("Mira", "action")).toBe("Mira acted while you held the spotlight");
    expect(playersWaitNote("Mira", "move")).toBe("Mira moved while you held the spotlight");
  });
});


describe("only while an encounter is running (user answer 2026-11-06)", () => {
  for (const mode of ["book", "manual"] as const) {
    it(`${mode}: outside a running encounter nothing waits and no note is posted, though the GM holds the spotlight`, async () => {
      const a = await table(mode, { encounter: "draft" });
      expect(await code(a.recall())).toBe("ok");
      expect(await code(a.move())).toBe("ok");
      dice(8, 3);
      // Map actions need a running encounter for their targets; the dice box and the hand do not.
      for (const name of ["actionRoll", "manualRoll", "tagTeam"] as const) expect([name, await code(a.acts[name]())]).toEqual([name, "ok"]);
      expect(await a.notes()).toEqual([]);
      const state = await a.state();
      expect(state).toMatchObject({ holder: { kind: "gm" }, reactionsOnly: false });
      expect(state.spotlightWarning).toBeUndefined();
    });
  }
});

describe("Vault Recall (bead dcm-bxp.99.32.38; CB p.27)", () => {
  it("Book: recalling a vault card is SPOTLIGHT_WITH_GM and the loadout stays; the GM's recall and vaulting a card pass", async () => {
    const a = await table("book");
    expect(await code(a.recall())).toBe("SPOTLIGHT_WITH_GM");
    expect(await a.loadout()).toEqual([ABILITY]);
    expect(await code(a.recall(a.gm))).toBe("ok");
    expect(await a.loadout()).toEqual([ABILITY, VAULTED]);
    expect(await code(a.player.mutation(api.characters.moveCard, { characterId: a.w.characterA, cardId: VAULTED, to: "vault" }))).toBe("ok");
  });

  it("Manual: the recall goes through with the GM's note", async () => {
    const a = await table("manual");
    expect(await code(a.recall())).toBe("ok");
    expect(await a.loadout()).toEqual([ABILITY, VAULTED]);
    expect((await a.notes()).map((r) => r.summary)).toEqual(["Ash acted while you held the spotlight"]);
  });
});

describe("combatSpotlight.state for the HUD", () => {
  it("Book: a player reads reactions only; Manual: no lock and a warning; the GM neither", async () => {
    const book = await table("book");
    const bookState = await book.state();
    expect(bookState).toMatchObject({ reactionsOnly: true });
    expect(bookState.spotlightWarning).toBeUndefined();
    const manual = await table("manual");
    expect(await manual.state()).toMatchObject({ reactionsOnly: false, spotlightWarning: true });
    const gmState = await manual.state(manual.gm);
    expect(gmState).toMatchObject({ reactionsOnly: false });
    expect(gmState.spotlightWarning).toBeUndefined();
  });
});
