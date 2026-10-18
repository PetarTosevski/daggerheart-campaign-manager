import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { readSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
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

/** A level-2 choice: the trait option for Agility and Instinct, one HP slot, a level-2 Blade card. */
const CHOICE = {
  picks: [
    { option: "traits" as const, tier: 2, targets: ["agility", "instinct"] },
    { option: "hp" as const, tier: 2 },
  ],
  experienceName: "Always Land on My Feet",
  cardId: cardsForDomains(["blade"], 2).find((c) => c.level === 2)!.id,
};

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
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const logOf = (id: Id<"characters">) =>
    t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", id))
        .collect(),
    );
  return { t, gm, p1, p2, out, campaignId, a, b, ids, sheetOf, logOf };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return errorCode(e);
  }
  throw new Error("expected the call to fail");
}

describe("levelUp", () => {
  useAllowlist(EMAILS);

  it("refuses the owner without the flag (LEVEL_UP_RULE) but not the GM", async () => {
    const { gm, p1, a, sheetOf } = await setup();
    expect(await failure(p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    expect(await gm.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() })).toEqual({ level: 2 });
    expect((await sheetOf(a)).level).toBe(2);
  });

  it("party level-up flags active characters; the owner levels up and the flag clears", async () => {
    const { t, gm, p1, campaignId, a, b, sheetOf, logOf } = await setup();
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "away", away: { reason: "infirmary" } }));
    expect(await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() })).toEqual({ flagged: 1 });
    expect((await sheetOf(a)).levelUpPending).toBe(true);
    expect((await sheetOf(b)).levelUpPending).toBe(false);

    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    const after = await sheetOf(a);
    expect(after).toMatchObject({ level: 2, proficiency: 2, levelUpPending: false, traitMarks: { agility: 1, instinct: 1 } });
    expect(after.traits.agility).toBe(3);
    expect(after.advancements).toHaveLength(1);
    const rows = await logOf(a);
    expect(rows.map((r) => [r.kind, r.visibility, r.undoable])).toEqual([
      ["levelUp", "public", false],
      ["levelUp", "public", false],
    ]);
  });

  it("an invalid choice is LEVEL_UP_RULE", async () => {
    const { gm, a } = await setup();
    const bad = { ...CHOICE, picks: [{ option: "traits" as const, tier: 2, targets: ["agility", "agility"] }, { option: "hp" as const, tier: 2 }] };
    expect(await failure(gm.mutation(api.levelUp.apply, { characterId: a, choice: bad, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("undo restores the previous sheet fields and can repeat", async () => {
    const { gm, p1, campaignId, a, sheetOf } = await setup();
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    const before = await sheetOf(a);
    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    expect(await p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() })).toEqual({ level: 1 });
    expect(await sheetOf(a)).toEqual(before);
    expect(await failure(p1.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("only the owner or the GM may level up or undo; only the GM corrects or flags", async () => {
    const { gm, p2, out, campaignId, a, sheetOf } = await setup();
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    expect(await failure(p2.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(out.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() }))).toBe("NOT_FOUND");
    expect(await failure(p2.mutation(api.levelUp.undoLast, { characterId: a, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(p2.mutation(api.levelUp.correctLevel, { characterId: a, level: 4, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(p2.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await failure(out.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() }))).toBe("NOT_FOUND");

    expect(await gm.mutation(api.levelUp.correctLevel, { characterId: a, level: 4, idempotencyKey: key() })).toEqual({ level: 4 });
    expect((await sheetOf(a)).level).toBe(4);
    expect(await failure(gm.mutation(api.levelUp.correctLevel, { characterId: a, level: 11, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
  });

  it("a level-up row blocks undoing an older roll row", async () => {
    const { t, gm, p1, campaignId, a, ids, sheetOf } = await setup();
    const before = await sheetOf(a);
    const rollId = await t.run((ctx) =>
      logAction(ctx, { campaignId, characterId: a, actorId: ids.p1, kind: "roll", visibility: "public", summary: "rolled", before, undoable: true }),
    );
    await gm.mutation(api.levelUp.partyLevelUp, { campaignId, idempotencyKey: key() });
    await p1.mutation(api.levelUp.apply, { characterId: a, choice: CHOICE, idempotencyKey: key() });
    expect(await failure(p1.mutation(api.actionLog.undo, { entryId: rollId, idempotencyKey: key() }))).toBe("UNDO_STALE");
    expect((await sheetOf(a)).level).toBe(2);
  });
});
