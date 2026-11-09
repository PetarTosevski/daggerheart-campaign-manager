import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Bead dcm-psg9 (user 2026-11-09): the GM gives or removes a PC's Hope & Fear transformation (HF p.34: "A PC can have
// only one transformation"), in any campaign with Hope & Fear content on. Dark Heart of Andaluria with transformations on
// (HF p.153): Reanimated cuts the maximum loadout to one, and the "Raise loadout" downtime move raises it to five.

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

async function setup(frameId: PublishedFrameId, transformations = true) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  if (frameId === "dark-heart-of-andaluria") await gm.mutation(api.campaigns.setOption, { campaignId, option: "transformations", enabled: transformations });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: characterDraft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: characterDraft("Bryn"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const give = (who: typeof gm, characterId: Id<"characters">, transformationId: string | null) => who.mutation(api.characters.setTransformation, { characterId, transformationId });
  const feed = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const choose = (who: typeof p1, restId: Id<"rests">, characterId: Id<"characters">, moves: { move: string }[]) =>
    who.mutation(api.rests.choose, { restId, characterId, moves: moves as { move: "prepare" }[], idempotencyKey: key() });
  const pickable = async (characterId: Id<"characters">) =>
    (await gm.query(api.restsReads.current, { campaignId })).open?.moves.find((m) => m.characterId === characterId)?.moves;
  return { t, gm, p1, p2, campaignId, a, b, sheetOf, edit, give, feed, start, finish, choose, pickable };
}

/** Three level-1 cards of the character's class domains, all in the loadout. */
async function threeCards(h: Awaited<ReturnType<typeof setup>>, id: Id<"characters">): Promise<string[]> {
  const s = await h.sheetOf(id);
  const cards = cardsForDomains(getClass(s.classId)!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 3)
    .map((c) => c.id);
  await h.edit(id, (sheet) => ({ ...sheet, domainCards: { owned: cards, loadout: cards } }));
  return cards;
}

describe("GM gives and removes transformations (dcm-psg9)", () => {
  useAllowlist(EMAILS);

  it("the GM gives, replaces and removes one transformation; each change is a public, undoable feed row", async () => {
    const h = await setup("dark-heart-of-andaluria");
    expect(await h.give(h.gm, h.a, "vampire")).toEqual({ transformationId: "vampire", loadoutMax: 5, vaulted: [] });
    expect((await h.sheetOf(h.a)).transformationId).toBe("vampire");
    // One per PC (HF p.34): a new one replaces it.
    await h.give(h.gm, h.a, "werewolf");
    expect((await h.sheetOf(h.a)).transformationId).toBe("werewolf");
    // The same one again changes nothing and logs nothing.
    await h.give(h.gm, h.a, "werewolf");
    await h.give(h.gm, h.a, null);
    expect((await h.sheetOf(h.a)).transformationId).toBeUndefined();
    const rows = (await h.feed()).filter((r) => r.characterId === h.a && r.kind === "feature");
    expect(rows.map((r) => [r.summary, r.visibility, r.undoable])).toEqual([
      ["Ash gains the Vampire transformation", "public", true],
      ["Ash's Vampire transformation becomes Werewolf", "public", true],
      ["Ash is no longer Werewolf", "public", true],
    ]);
  });

  it("players can't, the GM's call needs Hope & Fear content and a known transformation", async () => {
    const h = await setup("dark-heart-of-andaluria");
    expect(await codeOf(h.give(h.p1, h.a, "ghost"))).toBe("FORBIDDEN");
    expect(await codeOf(h.give(h.p2, h.a, "ghost"))).toBe("FORBIDDEN");
    expect(await codeOf(h.give(h.gm, h.a, "lich"))).toBe("INVALID");
    // Witherwild is a Core Rulebook frame: Hope & Fear content starts off.
    const core = await setup("witherwild");
    expect(await codeOf(core.give(core.gm, core.a, "ghost"))).toBe("MECHANIC_DISABLED");
    await core.gm.mutation(api.campaigns.setOption, { campaignId: core.campaignId, option: "hopeAndFear", enabled: true });
    expect(await codeOf(core.give(core.gm, core.a, "ghost"))).toBe("ok");
  });

  it("Andaluria (HF p.153): Reanimated cuts the maximum loadout to one, the rest go to the vault, and recalls stop at one", async () => {
    const h = await setup("dark-heart-of-andaluria");
    const cards = await threeCards(h, h.a);
    expect(await h.give(h.gm, h.a, "reanimated")).toEqual({ transformationId: "reanimated", loadoutMax: 1, vaulted: cards.slice(1) });
    const s = await h.sheetOf(h.a);
    expect(s.loadoutMax).toBe(1);
    expect(s.domainCards).toEqual({ owned: cards, loadout: cards.slice(0, 1) });
    expect((await h.feed()).at(-1)?.summary).toBe("Ash gains the Reanimated transformation; maximum loadout 1, 2 cards to the vault");
    expect(await codeOf(h.p1.mutation(api.characters.moveCard, { characterId: h.a, cardId: cards[1]!, to: "loadout" }))).toBe("INVALID");
    // Removing Reanimated restores the normal five; the vaulted cards stay in the vault.
    await h.give(h.gm, h.a, null);
    const after = await h.sheetOf(h.a);
    expect(after.loadoutMax).toBeUndefined();
    expect(after.domainCards.loadout).toEqual(cards.slice(0, 1));
  });

  it("Raise loadout: offered only to a Reanimated PC below five; each pick raises the maximum by one, up to five", async () => {
    const h = await setup("dark-heart-of-andaluria");
    await h.give(h.gm, h.a, "reanimated");
    const { restId } = await h.start("short");
    expect(await h.pickable(h.a)).toContain("raiseLoadout");
    expect(await h.pickable(h.b)).not.toContain("raiseLoadout");
    expect(await codeOf(h.choose(h.p2, restId, h.b, [{ move: "raiseLoadout" }, { move: "clearStress" }]))).toBe("REST_RULE");
    // CB 105: the same move twice.
    await h.choose(h.p1, restId, h.a, [{ move: "raiseLoadout" }, { move: "raiseLoadout" }]);
    await h.finish(restId);
    expect((await h.sheetOf(h.a)).loadoutMax).toBe(3);
    await h.edit(h.a, (s) => ({ ...s, loadoutMax: 4 }));
    const next = (await h.start("long")).restId;
    await h.choose(h.p1, next, h.a, [{ move: "raiseLoadout" }, { move: "raiseLoadout" }]);
    await h.finish(next);
    expect((await h.sheetOf(h.a)).loadoutMax).toBeUndefined();
    // At five the move is no longer offered.
    await h.start("short");
    expect(await h.pickable(h.a)).not.toContain("raiseLoadout");
  });

  it("with Andaluria's transformations off, Reanimated keeps the normal loadout and offers no move", async () => {
    const h = await setup("dark-heart-of-andaluria", false);
    await threeCards(h, h.a);
    expect(await h.give(h.gm, h.a, "reanimated")).toEqual({ transformationId: "reanimated", loadoutMax: 5, vaulted: [] });
    expect((await h.sheetOf(h.a)).domainCards.loadout).toHaveLength(3);
    await h.start("short");
    expect(await h.pickable(h.a)).not.toContain("raiseLoadout");
  });
});
