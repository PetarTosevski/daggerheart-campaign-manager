// Free rolls of mixed dice and the Revealed tag (user 2026-11-04): `rolls.freeRoll` (any member, public), `rolls.gmRoll`
// (mixed dice, hidden), `rolls.reveal` stamping `revealedAt`, and `feed.list` showing `revealed` to GM and player.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,out@example.com";
const page = { numItems: 20, cursor: null };

type Caller = Pick<ReturnType<typeof makeTest>, "mutation" | "query">;

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** A campaign with a GM, one player (named Pell) and an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com", name: "Pell" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, out] = [as(ids.gm), as(ids.p1), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  await p1.mutation(api.members.joinByCode, { code: await gm.mutation(api.members.rotateJoinCode, { campaignId }) });
  return { t, gm, p1, out, campaignId };
}

const mixed = { dice: [{ count: 3, sides: 6 }, { count: 1, sides: 8 }], modifier: 2 };

describe("rolls.freeRoll", () => {
  useAllowlist(EMAILS);

  it("anonymous, outsider, player and GM", async () => {
    const { t, gm, p1, out, campaignId } = await setup();
    const roll = (who: Caller) => who.mutation(api.rolls.freeRoll, { campaignId, ...mixed, idempotencyKey: key() });
    expect(await codeOf(roll(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(roll(out))).toBe("NOT_FOUND");
    expect(await codeOf(roll(p1))).toBe("ok");
    expect(await codeOf(roll(gm))).toBe("ok");
  });

  it("the server rolls every die with its size; the row is public, named, and the GM's to undo", async () => {
    const { t, gm, p1, campaignId } = await setup();
    // The args carry no die values (the server rolls, `rollDie`); 2d6 + 1d8 + 1d6 merge to 3d6 + 1d8.
    const { entryId, roll } = await p1.mutation(api.rolls.freeRoll, { campaignId, dice: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }, { count: 1, sides: 6 }], modifier: 2, label: "Trap", idempotencyKey: key() });
    expect(roll).toMatchObject({ kind: "free", modifier: 2, manual: false, outcome: "none" });
    expect(roll.dice.map((d) => d.sides)).toEqual([6, 6, 6, 8]);
    for (const d of roll.dice) {
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(d.sides);
    }
    expect(roll.total).toBe(roll.dice.reduce((s, d) => s + d.value, 0) + 2);
    // Values sent by a client are refused by the validator.
    const forged = { campaignId, dice: [{ count: 1, sides: 6, value: 6 }], modifier: 0, idempotencyKey: key() } as unknown as Parameters<typeof p1.mutation<typeof api.rolls.freeRoll>>[1];
    await expect(p1.mutation(api.rolls.freeRoll, forged)).rejects.toThrow();

    const row = await t.run((ctx) => ctx.db.get("actionLog", entryId));
    expect(row).toMatchObject({ kind: "roll", visibility: "public", summary: `Pell: Trap, 3d6 + 1d8 + 2 = ${roll.total}` });
    expect(row?.characterId).toBeUndefined();

    const playerView = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(playerView.page[0]).toMatchObject({ _id: entryId, visibility: "public", canUndo: false });
    expect(playerView.page[0]).not.toHaveProperty("revealed");
    const gmView = await gm.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(gmView.page[0]).toMatchObject({ _id: entryId, canUndo: true, revealable: false });
    await gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
    expect((await t.run((ctx) => ctx.db.get("actionLog", entryId)))?.undoneAt).toBeDefined();
  });

  it("the GM's free roll is public and says GM", async () => {
    const { t, gm, campaignId } = await setup();
    const { entryId, roll } = await gm.mutation(api.rolls.freeRoll, { campaignId, dice: [{ count: 1, sides: 20 }], modifier: -1, idempotencyKey: key() });
    expect((await t.run((ctx) => ctx.db.get("actionLog", entryId)))?.summary).toBe(`GM: 1d20 - 1 = ${roll.total}`);
  });

  it("limits: DICE_RULE for no dice, more than 20, an unknown size, a bad count or modifier", async () => {
    const { p1, gm, campaignId } = await setup();
    const bad = [
      { dice: [], modifier: 0 },
      { dice: [{ count: 0, sides: 6 }], modifier: 3 },
      { dice: [{ count: 15, sides: 6 }, { count: 6, sides: 8 }], modifier: 0 },
      { dice: [{ count: 1, sides: 7 }], modifier: 0 },
      { dice: [{ count: 1, sides: 100 }], modifier: 0 },
      { dice: [{ count: 1.5, sides: 6 }], modifier: 0 },
      { dice: [{ count: -1, sides: 6 }, { count: 2, sides: 8 }], modifier: 0 },
      { dice: [{ count: 1, sides: 6 }], modifier: 61 },
      { dice: [{ count: 1, sides: 6 }], modifier: 0.5 },
    ];
    for (const args of bad) {
      expect(await codeOf(p1.mutation(api.rolls.freeRoll, { campaignId, ...args, idempotencyKey: key() })), JSON.stringify(args)).toBe("DICE_RULE");
      expect(await codeOf(gm.mutation(api.rolls.gmRoll, { campaignId, ...args, idempotencyKey: key() })), JSON.stringify(args)).toBe("DICE_RULE");
    }
    expect(await codeOf(p1.mutation(api.rolls.freeRoll, { campaignId, dice: [{ count: 12, sides: 6 }, { count: 8, sides: 20 }], modifier: -60, idempotencyKey: key() }))).toBe("ok");
  });
});

describe("gmRoll mixed dice and the Revealed tag", () => {
  useAllowlist(EMAILS);

  it("a hidden GM roll of mixed dice: Hidden for the GM, absent for the player; after Reveal both see revealed", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const secret = await gm.mutation(api.rolls.gmRoll, { campaignId, ...mixed, label: "Ambush", idempotencyKey: key() });
    expect(secret.roll.dice.map((d) => d.sides)).toEqual([6, 6, 6, 8]);
    const row = await t.run((ctx) => ctx.db.get("actionLog", secret.entryId));
    expect(row?.summary).toBe(`GM: Ambush, 3d6 + 1d8 + 2 = ${secret.roll.total}`);
    expect(row?.revealedAt).toBeUndefined();

    const before = await gm.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(before.page[0]).toMatchObject({ visibility: "gm", revealable: true });
    expect(before.page[0]).not.toHaveProperty("revealed");
    expect((await p1.query(api.feed.list, { campaignId, paginationOpts: page })).page).toHaveLength(0);

    await gm.mutation(api.rolls.reveal, { campaignId, entryId: secret.entryId });
    const stamped = (await t.run((ctx) => ctx.db.get("actionLog", secret.entryId)))?.revealedAt;
    expect(stamped).toBeTypeOf("number");
    // Revealing twice changes nothing.
    await gm.mutation(api.rolls.reveal, { campaignId, entryId: secret.entryId });
    expect((await t.run((ctx) => ctx.db.get("actionLog", secret.entryId)))?.revealedAt).toBe(stamped);

    const gmAfter = await gm.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(gmAfter.page[0]).toMatchObject({ visibility: "public", revealable: false, revealed: true });
    const playerAfter = await p1.query(api.feed.list, { campaignId, paginationOpts: page });
    expect(playerAfter.page[0]).toMatchObject({ _id: secret.entryId, visibility: "public", revealed: true });
  });

  it("an old row revealed before the field (public gmRoll, no revealedAt) and a never-hidden roll get no tag", async () => {
    const { t, gm, p1, campaignId } = await setup();
    const old = await gm.mutation(api.rolls.gmRoll, { campaignId, dice: [{ count: 1, sides: 12 }], modifier: 0, idempotencyKey: key() });
    // As `reveal` wrote it before the widen: visibility only.
    await t.run((ctx) => ctx.db.patch("actionLog", old.entryId, { visibility: "public" }));
    await p1.mutation(api.rolls.freeRoll, { campaignId, dice: [{ count: 1, sides: 4 }], modifier: 0, idempotencyKey: key() });
    for (const who of [gm, p1]) {
      const { page: rows } = await who.query(api.feed.list, { campaignId, paginationOpts: page });
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r).not.toHaveProperty("revealed");
    }
  });
});
