import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction, PLAYER_DICE_UNDO_MS } from "../../convex/lib/actionLog";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState, gainFear } from "../../convex/lib/fear";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

/** A campaign with a GM, two players who each own a character, and an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  /**
   * Stands in for a D5 action (no public function logs yet): changes each
   * character's sheet, gains Fear, and logs one row per character in a group.
   */
  const act = (
    actorId: Id<"users">,
    changes: { characterId: Id<"characters">; change: (s: CharacterSheet) => CharacterSheet }[],
    opts: { fear?: number; group?: boolean; undoable?: boolean; visibility?: "public" | "gm" } = {},
  ) =>
    t.run(async (ctx) => {
      const groupId = opts.group ? crypto.randomUUID() : undefined;
      const { gained } = opts.fear ? await gainFear(ctx, campaignId, opts.fear) : { gained: 0 };
      const rows: Id<"actionLog">[] = [];
      for (const [i, { characterId, change }] of changes.entries()) {
        const before = readSheet((await ctx.db.get("characters", characterId))!.sheet);
        await saveSheet(ctx, characterId, change(before));
        rows.push(
          await logAction(ctx, {
            campaignId,
            characterId,
            actorId,
            kind: "roll",
            visibility: opts.visibility ?? "public",
            summary: "rolled",
            groupId,
            before,
            ...(i === 0 && gained ? { fearDelta: gained } : {}),
            undoable: opts.undoable ?? true,
          }),
        );
      }
      return rows;
    });
  const hope = (s: CharacterSheet) => ({ ...s, hope: s.hope + 1 });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const setFear = (value: number) => gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() });
  const row = (id: Id<"actionLog">) => t.run((ctx) => ctx.db.get("actionLog", id));
  return { t, ids, gm, p1, p2, out, campaignId, a, b, act, hope, sheetOf, fear, setFear, row };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("actionLog.undo", () => {
  useAllowlist(EMAILS);

  it("restores the sheet, takes back the Fear and marks the row undone", async () => {
    const { ids, p1, a, act, hope, sheetOf, fear, row, t } = await setup();
    const hopeBefore = (await sheetOf(a)).hope;
    const [entryId] = await act(ids.p1, [{ characterId: a, change: hope }], { fear: 1 });
    expect(await fear()).toBe(1);

    const result = await p1.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });

    expect(result).toEqual({ undone: [entryId], fearReverted: 1 });
    expect((await sheetOf(a)).hope).toBe(hopeBefore);
    expect(await fear()).toBe(0);
    expect((await row(entryId))?.undoneAt).toBeTypeOf("number");
    expect((await row(entryId))?.undoneBy).toBe(ids.p1);
    const history = await t.run((ctx) => ctx.db.query("history").collect());
    expect(history.map((h) => h.action)).toContain("undo");
  });

  it("refuses a row that is no longer the character's latest live row, and a second undo", async () => {
    const { ids, p1, a, act, hope } = await setup();
    const [older] = await act(ids.p1, [{ characterId: a, change: hope }]);
    const [newer] = await act(ids.p1, [{ characterId: a, change: hope }]);

    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: older, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: newer, idempotencyKey: key() }))).toBe("ok");
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: newer, idempotencyKey: key() }))).toBe("UNDO_STALE");
    // With the newer row undone, the older one is the latest again.
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: older, idempotencyKey: key() }))).toBe("ok");
  });

  it("refuses a row marked not undoable", async () => {
    const { ids, gm, a, act, hope } = await setup();
    const [entryId] = await act(ids.p1, [{ characterId: a, change: hope }], { undoable: false });
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });

  it("keeps GM Fear at 0 or more when Fear was spent since", async () => {
    const { ids, gm, a, act, hope, fear, setFear } = await setup();
    const [entryId] = await act(ids.p1, [{ characterId: a, change: hope }], { fear: 3 });
    await setFear(1);

    const result = await gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });

    expect(result.fearReverted).toBe(1);
    expect(await fear()).toBe(0);
  });

  it("undoes a group across two characters together, and only while each is latest", async () => {
    const { ids, gm, p2, a, b, act, hope, sheetOf, fear } = await setup();
    const before = { a: (await sheetOf(a)).hope, b: (await sheetOf(b)).hope };
    const [rowA, rowB] = await act(ids.gm, [{ characterId: a, change: hope }, { characterId: b, change: hope }], { fear: 2, group: true });

    // A newer row on one character blocks the whole group.
    const [later] = await act(ids.p2, [{ characterId: b, change: hope }]);
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: rowA!, idempotencyKey: key() }))).toBe("UNDO_STALE");
    await p2.mutation(api.actionLog.undo, { entryId: later!, idempotencyKey: key() });

    const result = await gm.mutation(api.actionLog.undo, { entryId: rowB!, idempotencyKey: key() });

    expect([...result.undone].sort()).toEqual([rowA, rowB].sort());
    expect(result.fearReverted).toBe(2);
    expect({ a: (await sheetOf(a)).hope, b: (await sheetOf(b)).hope }).toEqual(before);
    expect(await fear()).toBe(0);
  });

  it("lets only the actor or the GM undo: a player can't undo another player's row or a GM row", async () => {
    const { ids, p1, p2, a, b, act, hope } = await setup();
    const [p1Row] = await act(ids.p1, [{ characterId: a, change: hope }]);
    const [gmRow] = await act(ids.gm, [{ characterId: b, change: hope }]);
    const [secret] = await act(ids.gm, [{ characterId: b, change: hope }], { visibility: "gm" });

    expect(await codeOf(p2.mutation(api.actionLog.undo, { entryId: p1Row!, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await codeOf(p2.mutation(api.actionLog.undo, { entryId: gmRow!, idempotencyKey: key() }))).toBe("FORBIDDEN");
    // A GM-only row is never revealed to a player.
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: secret!, idempotencyKey: key() }))).toBe("NOT_FOUND");
  });

  it("anonymous, outsider, player and GM", async () => {
    const { t, ids, gm, p1, out, a, act, hope } = await setup();
    const [own] = await act(ids.p1, [{ characterId: a, change: hope }]);

    expect(await codeOf(t.mutation(api.actionLog.undo, { entryId: own!, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(out.mutation(api.actionLog.undo, { entryId: own!, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: own!, idempotencyKey: key() }))).toBe("ok");

    const [another] = await act(ids.p1, [{ characterId: a, change: hope }]);
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: another!, idempotencyKey: key() }))).toBe("ok");
  });

  it("refuses a rest row: rests.undo also reopens the rest (review L4)", async () => {
    const { t, ids, gm, campaignId } = await setup();
    const entryId = await t.run((ctx) => logAction(ctx, { campaignId, actorId: ids.gm, kind: "rest", visibility: "public", summary: "Short rest", undoable: true }));
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });

  it("a retry with the same key returns the first result", async () => {
    const { ids, p1, a, act, hope } = await setup();
    const [entryId] = await act(ids.p1, [{ characterId: a, change: hope }], { fear: 1 });
    const idempotencyKey = key();
    const first = await p1.mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey });
    expect(await p1.mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey })).toEqual(first);
  });
});

// ---------------------------------------------------------------- D5 review fixes (R1)

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
const ROLL = {
  kind: "action" as const,
  dice: [
    { sides: 12, value: 8, role: "hope" as const },
    { sides: 12, value: 3, role: "fear" as const },
  ],
  modifier: 0,
  total: 11,
  outcome: "successHope" as const,
  manual: false,
};

describe("actionLog.undo: nothing newer is lost (review H1, H2, M2)", () => {
  useAllowlist(EMAILS);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const hopeRoll = (who: { mutation: ReturnType<typeof makeTest>["mutation"] }, characterId: Id<"characters">) =>
    who.mutation(api.rolls.manualRoll, { characterId, values: [8, 3], roll: agility, idempotencyKey: key() });

  it("H1: a roll can't be undone after an unlogged change (applyDamage); the damage stays", async () => {
    const { gm, p1, a, sheetOf } = await setup();
    const roll = await hopeRoll(p1, a);
    later(1000);
    await gm.mutation(api.characters.applyDamage, { characterId: a, damage: 3, useArmorSlot: false, idempotencyKey: key() });
    const damaged = await sheetOf(a);

    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: roll.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: roll.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect(await sheetOf(a)).toEqual(damaged);
  });

  it("H1: undoing newer rows one by one still works (undo's own write is not a newer change)", async () => {
    const { p1, a, sheetOf } = await setup();
    const hopeBefore = (await sheetOf(a)).hope;
    const first = await hopeRoll(p1, a);
    later(1000);
    const second = await hopeRoll(p1, a);
    later(1000);
    await p1.mutation(api.actionLog.undo, { entryId: second.entryId, idempotencyKey: key() });
    later(1000);
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: first.entryId, idempotencyKey: key() }))).toBe("ok");
    expect((await sheetOf(a)).hope).toBe(hopeBefore);
  });

  it("H2: a group is refused while a live row of its character sits between its rows", async () => {
    const { t, ids, gm, campaignId, a, b, act, hope, sheetOf } = await setup();
    /** One row of a two-step action (like a Tag Team roll, then its apply). */
    const groupRow = (characterId: Id<"characters">, groupId: string) =>
      t.run(async (ctx) => {
        const before = readSheet((await ctx.db.get("characters", characterId))!.sheet);
        await saveSheet(ctx, characterId, hope(before));
        return logAction(ctx, { campaignId, characterId, actorId: ids.gm, kind: "roll", visibility: "public", summary: "two steps", groupId, before, undoable: true });
      });
    const split = crypto.randomUUID();
    await groupRow(a, split);
    later(1000);
    await act(ids.gm, [{ characterId: a, change: hope }]);
    later(1000);
    const last = await groupRow(a, split);
    // The newest row is in the group, but undoing it would wipe the roll in between.
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: last, idempotencyKey: key() }))).toBe("UNDO_STALE");

    // Nothing in between: the two steps undo together.
    const hopeBefore = (await sheetOf(b)).hope;
    const whole = crypto.randomUUID();
    await groupRow(b, whole);
    later(1000);
    const end = await groupRow(b, whole);
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: end, idempotencyKey: key() }))).toBe("ok");
    expect((await sheetOf(b)).hope).toBe(hopeBefore);
  });

  it(`M2: a player undoes their dice row only within ${PLAYER_DICE_UNDO_MS / 1000} seconds; the GM any time`, async () => {
    const { ids, gm, p1, a, act, hope } = await setup();
    const fresh = await hopeRoll(p1, a);
    later(PLAYER_DICE_UNDO_MS);
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: fresh.entryId, idempotencyKey: key() }))).toBe("ok");

    const old = await hopeRoll(p1, a);
    later(PLAYER_DICE_UNDO_MS + 1);
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: old.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: old.entryId, idempotencyKey: key() }))).toBe("ok");

    // A row without dice has no time limit.
    const [noDice] = await act(ids.p1, [{ characterId: a, change: hope }]);
    later(10 * PLAYER_DICE_UNDO_MS);
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: noDice!, idempotencyKey: key() }))).toBe("ok");
  });

  it("M2: the limit covers death-move rows that carry dice", async () => {
    const { t, ids, p1, campaignId, a } = await setup();
    const entryId = await t.run((ctx) =>
      logAction(ctx, { campaignId, characterId: a, actorId: ids.p1, kind: "death", visibility: "public", summary: "Risk It All", roll: ROLL, undoable: true }),
    );
    later(PLAYER_DICE_UNDO_MS + 1);
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });
});
