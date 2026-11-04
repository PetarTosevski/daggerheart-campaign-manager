/**
 * Lane N2 (characters, sheet and actionLog follow-ups): the creation cap and read bound split (dcm-bxp.38), trait and
 * Experience delta intents and the sheet-narrowing audit (dcm-bxp.28), and the
 * distinct undo codes (dcm-bxp.31).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { CHARACTER_READ_BOUND, MAX_CHARACTERS_CREATED_PER_CAMPAIGN, MAX_CHARACTERS_PER_CAMPAIGN, readSheet, storedSheet } from "../../convex/lib/characterSheet";
import { sheetNarrowingProblem } from "../../convex/migrations/characters";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single" as const, id: ANCESTRIES.find((a) => a.source === "core")!.id },
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

/** A campaign with a GM and a player who owns Ash. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1] = [as(ids.gm), as(ids.p1)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  return { t, ids, gm, p1, campaignId, a, sheetOf };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("dcm-bxp.38: creation cap and read bound", () => {
  useAllowlist(EMAILS);

  it("the creation cap never exceeds the read bound; the old name is the read bound", () => {
    expect(MAX_CHARACTERS_CREATED_PER_CAMPAIGN).toBeLessThanOrEqual(CHARACTER_READ_BOUND);
    expect(MAX_CHARACTERS_PER_CAMPAIGN).toBe(CHARACTER_READ_BOUND);
    expect(CHARACTER_READ_BOUND).toBe(50);
  });

  it("create refuses the next character at the creation cap (INVALID)", async () => {
    const { t, ids, gm, campaignId, a } = await setup();
    const sheet = (await t.run(async (ctx) => (await ctx.db.get("characters", a))!.sheet)) as unknown;
    await t.run(async (ctx) => {
      // Ash is one; fill up to the cap with the GM's (unassigned, exempt from one-active) characters.
      for (let i = 1; i < MAX_CHARACTERS_CREATED_PER_CAMPAIGN; i++) {
        await ctx.db.insert("characters", { campaignId, ownerId: ids.gm, createdBy: ids.gm, status: "retired", sheet, createdAt: i, updatedAt: i });
      }
    });
    expect(await codeOf(gm.mutation(api.characters.create, { campaignId, draft: draft("One too many"), idempotencyKey: key() }))).toBe("INVALID");
    // The roster still reads every character.
    expect(await gm.query(api.charactersReads.listByCampaign, { campaignId })).toHaveLength(MAX_CHARACTERS_CREATED_PER_CAMPAIGN);
  });
});

describe("dcm-bxp.28: trait and Experience delta intents", () => {
  useAllowlist(EMAILS);

  it("two trait steps from one stale view add up instead of overwriting each other", async () => {
    const { gm, a, sheetOf } = await setup();
    const start = (await sheetOf(a)).traits.agility;
    await gm.mutation(api.characters.setTrait, { characterId: a, trait: "agility", delta: 1 });
    await gm.mutation(api.characters.setTrait, { characterId: a, trait: "agility", delta: 1 });
    expect((await sheetOf(a)).traits.agility).toBe(start + 2);
  });

  it("a trait delta stays within -5..+10; value and delta together, or neither, are INVALID; players are FORBIDDEN", async () => {
    const { gm, p1, a, sheetOf } = await setup();
    await gm.mutation(api.characters.setTrait, { characterId: a, trait: "presence", delta: 15 });
    expect((await sheetOf(a)).traits.presence).toBe(10);
    await gm.mutation(api.characters.setTrait, { characterId: a, trait: "presence", delta: -15 });
    expect((await sheetOf(a)).traits.presence).toBe(-5);
    expect(await codeOf(gm.mutation(api.characters.setTrait, { characterId: a, trait: "presence", value: 1, delta: 1 }))).toBe("INVALID");
    expect(await codeOf(gm.mutation(api.characters.setTrait, { characterId: a, trait: "presence" }))).toBe("INVALID");
    expect(await codeOf(gm.mutation(api.characters.setTrait, { characterId: a, trait: "presence", delta: 0.5 }))).toBe("INVALID");
    expect(await codeOf(p1.mutation(api.characters.setTrait, { characterId: a, trait: "presence", delta: 1 }))).toBe("FORBIDDEN");
  });

  it("Experience deltas add up and keep the other fields; value with delta is INVALID", async () => {
    const { gm, p1, a, sheetOf } = await setup();
    const [first] = (await sheetOf(a)).experiences;
    await p1.mutation(api.characters.setExperience, { characterId: a, experienceId: first!.id, delta: 1 });
    await gm.mutation(api.characters.setExperience, { characterId: a, experienceId: first!.id, delta: 1 });
    const after = (await sheetOf(a)).experiences.find((e) => e.id === first!.id)!;
    expect(after).toMatchObject({ name: first!.name, value: first!.value + 2 });
    await p1.mutation(api.characters.setExperience, { characterId: a, experienceId: first!.id, delta: 15 });
    expect((await sheetOf(a)).experiences.find((e) => e.id === first!.id)!.value).toBe(10);
    expect(await codeOf(p1.mutation(api.characters.setExperience, { characterId: a, experienceId: first!.id, value: 1, delta: 1 }))).toBe("INVALID");
  });
});

describe("dcm-bxp.28: the sheet-narrowing audit", () => {
  useAllowlist(EMAILS);

  it("a sheet stored by storedSheet passes storedSheetValidator; an old or broken one does not", async () => {
    const { a, sheetOf, t } = await setup();
    const sheet = await sheetOf(a);
    expect(sheetNarrowingProblem(storedSheet(sheet))).toBeNull();
    expect(sheetNarrowingProblem(await t.run(async (ctx) => (await ctx.db.get("characters", a))!.sheet as unknown))).toBeNull();
    // Version 1 (no schemaVersion, string inventory) still needs versionSheets.
    const { schemaVersion: _drop, ...noVersion } = storedSheet(sheet);
    void _drop;
    expect(sheetNarrowingProblem({ ...noVersion, inventory: ["Torch"] })).not.toBeNull();
    expect(sheetNarrowingProblem({ ...storedSheet(sheet), unexpected: 1 })).not.toBeNull();
  });
});

describe("dcm-bxp.31: the undo codes", () => {
  useAllowlist(EMAILS);

  it("UNDO_EXPIRED for a player's dice row (the GM undoes rolls, user 2026-11-02); UNDO_USE_REST for a rest row", async () => {
    const { t, ids, gm, p1, campaignId, a } = await setup();
    const roll = {
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
    const entryId = await t.run((ctx) => logAction(ctx, { campaignId, characterId: a, actorId: ids.p1, kind: "roll", visibility: "public", summary: "rolled", roll, undoable: true }));
    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("UNDO_EXPIRED");
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() }))).toBe("ok");

    const rest = await t.run((ctx) => logAction(ctx, { campaignId, actorId: ids.gm, kind: "rest", visibility: "public", summary: "Short rest", undoable: true }));
    expect(await codeOf(gm.mutation(api.actionLog.undo, { entryId: rest, idempotencyKey: key() }))).toBe("UNDO_USE_REST");
  });
});
