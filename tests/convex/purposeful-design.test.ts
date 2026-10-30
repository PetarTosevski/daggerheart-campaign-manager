import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// DA11 (plan drawer-answers, dcm-bxp.99.19.18). Purposeful Design, CB p.53 Clank: "At character creation, choose one of
// your Experiences that best aligns with this purpose and gain a permanent +1 bonus to it." User 2026-10-29: the sheet
// records the chosen Experience and every roll adds the +1; the stored value is never bumped.

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";
const clank = { kind: "single" as const, id: "clank" };
const dwarf = { kind: "single" as const, id: "dwarf" };
/** Agility +2, no other modifier: an action roll of [8, 3] totals 13 before Experiences. */
const AGILITY = { kind: "action" as const, trait: "agility" as const, modifier: 0, advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const create = async (who: typeof gm, draft: Partial<ReturnType<typeof characterDraft>>) =>
    (await who.mutation(api.characters.create, { campaignId, draft: { ...characterDraft("Cog"), ...draft }, idempotencyKey: key() })).characterId;
  const sheet = async (characterId: Id<"characters">) => (await gm.query(api.characters.get, { characterId }))!.sheet;
  const roll = (characterId: Id<"characters">, experienceIds: string[]) =>
    gm.mutation(api.rolls.manualRoll, { characterId, values: [8, 3], roll: { ...AGILITY, experienceIds }, idempotencyKey: key() });
  return { t, gm, p1, p2, create, sheet, roll };
}

describe("Purposeful Design (DA11)", () => {
  useAllowlist(EMAILS);

  it("the wizard's choice is recorded on the Experience, the value stays +2 and a roll adds +1", async () => {
    const { p1, create, sheet, roll } = await setup();
    const id = await create(p1, { ancestry: clank, purposefulExperience: 1 });
    const s = await sheet(id);
    expect(s.experiences.map((e) => [e.name, e.value, e.purposefulDesign])).toEqual([
      ["Sellsword", 2, undefined],
      ["Lockpick", 2, true],
    ]);
    // 8 + 3 + Agility 2 + Lockpick (2 + 1).
    expect((await roll(id, [s.experiences[1]!.id])).roll.total).toBe(16);
    // The other Experience has no bonus.
    expect((await roll(id, [s.experiences[0]!.id])).roll.total).toBe(15);
  });

  it("a draft without Purposeful Design can't name an Experience for it", async () => {
    const { p1, create } = await setup();
    expect(errorCode(await create(p1, { ancestry: dwarf, purposefulExperience: 0 }).catch((e: unknown) => e))).toBe("INVALID");
    // Mixed ancestry (CB p.71): the Clank's first feature is Purposeful Design, its second is Efficient.
    const mixedSecond = { kind: "mixed" as const, first: "dwarf", second: "clank", name: "" };
    expect(errorCode(await create(p1, { ancestry: mixedSecond, purposefulExperience: 0 }).catch((e: unknown) => e))).toBe("INVALID");
  });

  it("a mixed ancestry whose first feature is the Clank's records it", async () => {
    const { p1, create, sheet } = await setup();
    const id = await create(p1, { ancestry: { kind: "mixed", first: "clank", second: "dwarf", name: "" }, purposefulExperience: 0 });
    expect((await sheet(id)).experiences[0]!.purposefulDesign).toBe(true);
  });

  it("a Clank created without the choice picks it once on the sheet; the value is never bumped", async () => {
    const { gm, p1, p2, create, sheet, roll } = await setup();
    const id = await create(p1, { ancestry: clank });
    const before = await sheet(id);
    expect(before.experiences.some((e) => e.purposefulDesign)).toBe(false);
    const [first, second] = before.experiences;

    // Another player can view but not edit; an unknown Experience is NOT_FOUND.
    const pick = (who: typeof gm, experienceId: string) => who.mutation(api.characters.choosePurposefulDesign, { characterId: id, experienceId, idempotencyKey: key() });
    expect(errorCode(await pick(p2, first!.id).catch((e: unknown) => e))).toBe("FORBIDDEN");
    expect(errorCode(await pick(p1, "nope").catch((e: unknown) => e))).toBe("NOT_FOUND");

    await pick(p1, first!.id);
    const after = await sheet(id);
    expect(after.experiences[0]).toEqual({ ...first, purposefulDesign: true });
    expect(after.experiences[1]).toEqual(second);
    expect((await roll(id, [first!.id])).roll.total).toBe(16);

    // Once only, for the owner and the GM alike.
    expect(errorCode(await pick(gm, second!.id).catch((e: unknown) => e))).toBe("INVALID");
  });

  it("a replay with the same key is a no-op; a sheet without the feature is refused", async () => {
    const { gm, p1, create, sheet } = await setup();
    const id = await create(p1, { ancestry: clank });
    const [first] = (await sheet(id)).experiences;
    const args = { characterId: id, experienceId: first!.id, idempotencyKey: key() };
    await p1.mutation(api.characters.choosePurposefulDesign, args);
    await p1.mutation(api.characters.choosePurposefulDesign, args);
    expect((await sheet(id)).experiences.filter((e) => e.purposefulDesign)).toHaveLength(1);

    const other = await create(gm, { ancestry: dwarf });
    const [exp] = (await sheet(other)).experiences;
    expect(errorCode(await gm.mutation(api.characters.choosePurposefulDesign, { characterId: other, experienceId: exp!.id, idempotencyKey: key() }).catch((e: unknown) => e))).toBe(
      "FEATURE_NOT_OWNED",
    );
  });

  it("a whole-list write keeps the recorded Experience and can't move or add it", async () => {
    const { p1, create, sheet } = await setup();
    const id = await create(p1, { ancestry: clank, purposefulExperience: 0 });
    const [first, second] = (await sheet(id)).experiences;
    await p1.mutation(api.characters.updateSheet, {
      characterId: id,
      patch: { experiences: [{ id: first!.id, name: "Sellsword", value: 3 }, { ...second!, purposefulDesign: true }, { name: "Tinker", value: 2, purposefulDesign: true }] },
    });
    const s = await sheet(id);
    expect(s.experiences.map((e) => [e.name, e.value, e.purposefulDesign])).toEqual([
      ["Sellsword", 3, true],
      ["Lockpick", 2, undefined],
      ["Tinker", 2, undefined],
    ]);
  });

  it("a sheet stored before the field reads back unchanged", async () => {
    const { t, p1, create, sheet } = await setup();
    const id = await create(p1, { ancestry: clank });
    const stored = await t.run(async (ctx) => (await ctx.db.get("characters", id))!.sheet as { experiences: object[] });
    expect(stored.experiences.every((e) => !("purposefulDesign" in e))).toBe(true);
    expect((await sheet(id)).experiences.map((e) => e.value)).toEqual([2, 2]);
  });
});
