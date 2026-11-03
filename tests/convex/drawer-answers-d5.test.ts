// DA7 (plan drawer-answers, bead dcm-bxp.99.19; docs/tasks/TASK-DA-DA7.md) through Convex: Rogue's Dodge is Active and
// refused while its +2 holds (CB p.42, user 2026-10-30), Hex at the maximum ends the oldest or the picked Hex (HF p.16,
// user 2026-10-29), Prayer Dice refuse a damage roll (CB p.44, user 2026-10-29), and Drop out of Beastform also ends
// Evolution in one undoable row (CB p.30, user 2026-10-30). Role checks: tests/convex/authz/features.entries.ts.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { RANGER_ROGUE_IDS } from "../../src/lib/srd/feature-effects/ranger-rogue";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

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

async function setup(change: Partial<CharacterSheet>) {
  const { t, gm, campaignId } = await setupWithCampaign();
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const id = (await gm.mutation(api.characters.create, { campaignId, draft: draft("Vex"), idempotencyKey: key() })).characterId;
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const patch = (next: Partial<CharacterSheet>) => t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...next }));
  await patch(change);
  const use = (featureKey: string, params: { choice?: string; amount?: number; dieIndexes?: number[] } = {}) =>
    gm.mutation(api.classFeatures.use, { characterId: id, featureKey, params, idempotencyKey: key() });
  const drawer = () => gm.query(api.combatFeaturesReads.drawer, { campaignId, characterId: id });
  const rows = () =>
    t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", id))
        .collect(),
    );
  return { t, gm, campaignId, id, sheet, patch, use, drawer, rows };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

// The first test loads every Convex module (the drawer reads the feature tables): slow on a loaded machine.
describe("DA7: D5-delegated features and the drawer read model", { timeout: 60_000 }, () => {
  useAllowlist();

  it("Rogue's Dodge: Active in the drawer, a second use refused with nothing paid, usable again after a hit", async () => {
    const env = await setup({ classId: "rogue", subclassId: "nightwalker", hope: 6 });
    const dodge = async () => (await env.drawer()).features.find((f) => f.featureId === RANGER_ROGUE_IDS.roguesDodge)!;
    expect((await dodge()).state).toBe("ready");

    await env.use("roguesDodge");
    expect((await env.sheet()).hope).toBe(3);
    expect(await dodge()).toMatchObject({ state: "active", resetLabel: "Until an attack succeeds against you, or your next rest" });
    expect((await dodge()).uses.every((u) => !u.ready)).toBe(true);

    expect(await codeOf(env.use("roguesDodge"))).toBe("CLASS_FEATURE_RULE");
    expect((await env.sheet()).hope).toBe(3);
    expect((await env.sheet()).effects.filter((e) => e.id === "rogues-dodge")).toHaveLength(1);

    await env.gm.mutation(api.classFeatures.gotHit, { characterId: env.id, idempotencyKey: key() });
    expect((await dodge()).state).toBe("ready");
    expect(await codeOf(env.use("roguesDodge"))).toBe("ok");
  });

  it("Hex at the maximum ends the oldest by default, or the picked Hex; the drawer lists the picks", async () => {
    // Hedge witch, Knowledge 2: two Hexes at once.
    const env = await setup({ classId: "witch", subclassId: "hedge", traits: { agility: 0, strength: 1, finesse: 0, instinct: 0, presence: 1, knowledge: 2 } });
    await env.use("hex", { choice: "Ghoul" });
    await env.use("hex", { choice: "Bandit" });
    const hexUse = async () => (await env.drawer()).features.find((f) => f.featureId === "class:witch:hex")!.uses[0]!;
    expect((await hexUse()).choices[0]!.options?.map((o) => o.label)).toEqual(["The oldest (Ghoul)", "Ghoul", "Bandit"]);

    const out = await env.use("hex", { choice: "Ooze" });
    expect(out.summary).toMatch(/ended the Hex on Ghoul/);
    expect((await env.sheet()).classState.hexes).toEqual(["Bandit", "Ooze"]);

    await env.use("hex", { choice: "Wraith", amount: 2 });
    expect((await env.sheet()).classState.hexes).toEqual(["Bandit", "Wraith"]);
    expect(await codeOf(env.use("hex", { choice: "Imp", amount: 5 }))).toBe("CLASS_FEATURE_RULE");
  });

  it("Prayer Dice add to an action roll but refuse a damage roll", async () => {
    const env = await setup({ classId: "seraph", subclassId: "divine-wielder", heldDice: [{ id: "prayer-1", kind: "prayer", sides: 4, value: 2, until: "session" }] });
    const logRoll = (roll: NonNullable<Parameters<typeof logAction>[1]["roll"]>) =>
      env.t.run(async (ctx) =>
        logAction(ctx, { campaignId: env.campaignId, characterId: env.id, actorId: (await ctx.db.query("users").first())!._id, kind: "roll", visibility: "public", summary: "rolled", roll, before: readSheet((await ctx.db.get("characters", env.id))!.sheet), undoable: true }),
      );
    await logRoll({ kind: "damage", dice: [{ sides: 8, value: 5, role: "damage" }], modifier: 0, total: 5, outcome: "none", manual: false });
    expect(await codeOf(env.use("prayerRoll"))).toBe("CLASS_FEATURE_RULE");
    expect((await env.sheet()).heldDice).toHaveLength(1);

    await logRoll({ kind: "reaction", dice: [{ sides: 12, value: 4, role: "hope" }, { sides: 12, value: 3, role: "fear" }], modifier: 0, total: 9, difficulty: 10, outcome: "failHope", manual: false });
    const out = await env.use("prayerRoll");
    expect(out.roll).toMatchObject({ kind: "reaction", total: 11, outcome: "successHope" });
  });

  it("Drop out of Beastform also ends Evolution, in one row that undo restores", async () => {
    const env = await setup({
      classId: "druid",
      subclassId: "warden-of-the-elements",
      effects: [
        { id: "beastform", source: "Beastform", text: "Agile Scout.", until: "manual", mods: { evasion: 2 } },
        { id: "evolution", source: "Evolution", text: "Beastform: +1 agility until you drop out of it.", until: "manual", mods: { trait: { id: "agility", delta: 1 } } },
        { id: "other", source: "Other", text: "Stays.", until: "manual" },
      ],
    });
    await env.gm.mutation(api.classFeatures.endEffect, { characterId: env.id, effectId: "beastform", idempotencyKey: key() });
    expect((await env.sheet()).effects.map((e) => e.id)).toEqual(["other"]);
    const rows = await env.rows();
    const row = rows.at(-1)!;
    expect(row.summary).toBe("ended Beastform, Evolution");
    expect(rows.filter((r) => r.summary.startsWith("ended"))).toHaveLength(1);

    await env.gm.mutation(api.actionLog.undo, { entryId: row._id as Id<"actionLog">, idempotencyKey: key() });
    expect((await env.sheet()).effects.map((e) => e.id)).toEqual(["beastform", "evolution", "other"]);

    // Ending Evolution alone leaves the form.
    await env.gm.mutation(api.classFeatures.endEffect, { characterId: env.id, effectId: "evolution", idempotencyKey: key() });
    expect((await env.sheet()).effects.map((e) => e.id)).toEqual(["beastform", "other"]);
  });
});
