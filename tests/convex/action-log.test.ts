import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
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

  it("a retry with the same key returns the first result", async () => {
    const { ids, p1, a, act, hope } = await setup();
    const [entryId] = await act(ids.p1, [{ characterId: a, change: hope }], { fear: 1 });
    const idempotencyKey = key();
    const first = await p1.mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey });
    expect(await p1.mutation(api.actionLog.undo, { entryId: entryId!, idempotencyKey })).toEqual(first);
  });
});
