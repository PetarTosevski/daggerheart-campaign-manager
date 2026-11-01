import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, setupWithCampaign } from "./helpers";

// Combat HUD HD1 (plan .omc/plans/combat-hud.yaml): combatHud.party (banners) and combatHud.scene (Fear, light, day).
// Access is in the authz matrix (tests/convex/authz/hud.entries.ts); here: what the rows hold and leave out.

type Frame = "witherwild" | "beast-feast";
const BEAR = { kind: "srd" as const, adversaryId: "bear" };

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0]!.id,
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
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

/** A live map with the player's Ash and the GM's Bryn placed, a running encounter's Bear and a custom Goblin. */
async function withParty(frameId: Frame = "witherwild") {
  const { t, gm, other: player, campaignId } = await setupWithCampaign(frameId);
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Goblin", hp: 3, side: "enemy", idempotencyKey: key() });
  const edit = (characterId: Id<"characters">, patch: Partial<ReturnType<typeof readSheet>>) =>
    t.run(async (ctx) => {
      const row = (await ctx.db.get("characters", characterId))!;
      await saveSheet(ctx, characterId, { ...readSheet(row.sheet), ...patch });
    });
  return { t, gm, player, campaignId, mapId, ash, bryn, edit };
}

describe("combatHud.party", () => {
  it("gives every member one banner per PC token and nothing about adversaries or custom tokens", async () => {
    const f = await withParty();
    const rows = await f.player.query(api.combatHud.party, { campaignId: f.campaignId });
    expect(rows.map((r) => r.name).sort()).toEqual(["Ash", "Bryn"]);
    const ash = rows.find((r) => r.name === "Ash")!;
    expect(ash.mine).toBe(true);
    expect(rows.find((r) => r.name === "Bryn")!.mine).toBe(false);
    expect(ash).toMatchObject({
      characterId: f.ash,
      className: "Warrior",
      level: 1,
      hp: { marked: 0 },
      stress: { marked: 0 },
      armor: { marked: 0 },
      hope: { max: 6 },
      conditions: [],
      down: false,
      deathMoveDue: false,
    });
    expect(ash.hp.max).toBeGreaterThan(0);
    expect(ash.armor.max).toBeGreaterThan(0);
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/Bear|Goblin|difficulty|threshold/i);
    // The GM reads the same rows; their own PC is not "mine" on the GM's screen (as combatTokens.party).
    const gmRows = await f.gm.query(api.combatHud.party, { campaignId: f.campaignId, mapId: f.mapId });
    expect(gmRows.map((r) => [r.name, r.mine]).sort()).toEqual([["Ash", false], ["Bryn", false]]);
  });

  it("follows the sheet: Hope, scars, Armor marked, conditions and a due death move", async () => {
    const f = await withParty();
    await f.edit(f.ash, { hope: 3, scars: 1, armorMarked: 1, conditions: ["vulnerable", "restrained"] });
    let ash = (await f.player.query(api.combatHud.party, { campaignId: f.campaignId })).find((r) => r.name === "Ash")!;
    expect(ash.hope).toEqual({ value: 3, max: 5 });
    expect(ash.armor.marked).toBe(1);
    expect(ash.conditions).toEqual([
      { id: "vulnerable", label: "Vulnerable" },
      { id: "restrained", label: "Restrained" },
    ]);
    const hpMax = ash.hp.max;
    await f.edit(f.ash, { hp: hpMax, conditions: [] });
    ash = (await f.player.query(api.combatHud.party, { campaignId: f.campaignId })).find((r) => r.name === "Ash")!;
    expect(ash).toMatchObject({ hp: { marked: hpMax, max: hpMax }, down: true, deathMoveDue: true });
    // Avoid Death's Unconscious: down, but the move is made.
    await f.edit(f.ash, { conditions: ["unconscious"] });
    ash = (await f.player.query(api.combatHud.party, { campaignId: f.campaignId })).find((r) => r.name === "Ash")!;
    expect(ash).toMatchObject({ down: true, deathMoveDue: false, conditions: [{ id: "unconscious", label: "Unconscious" }] });
  });

  it("reads the live map for players and any map for the GM", async () => {
    const f = await withParty();
    const { mapId: draftMap } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "small", idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.addParty, { campaignId: f.campaignId, mapId: draftMap, idempotencyKey: key() });
    expect(await f.player.query(api.combatHud.party, { campaignId: f.campaignId, mapId: draftMap })).toEqual([]);
    expect((await f.gm.query(api.combatHud.party, { campaignId: f.campaignId, mapId: draftMap })).length).toBe(2);
    expect((await f.player.query(api.combatHud.party, { campaignId: f.campaignId, mapId: f.mapId })).length).toBe(2);
    // An unknown id or another campaign's map reads as empty, never an error.
    expect(await f.gm.query(api.combatHud.party, { campaignId: f.campaignId, mapId: "nope" })).toEqual([]);
  });

  it("is empty without a live map and refuses outsiders with NOT_FOUND", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    expect(await gm.query(api.combatHud.party, { campaignId })).toEqual([]);
    const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
    const outsider = t.withIdentity({ subject: `${id}|session` });
    expect(await outsider.query(api.combatHud.party, { campaignId }).then(() => "ok", errorCode)).toBe("NOT_FOUND");
  });
});

describe("combatHud.scene", () => {
  it("in a frame with campaign time: the phase decides the light, the day shows, the GM opens the time arc", async () => {
    const f = await withParty("witherwild");
    await f.t.run(async (c) => {
      const time = await c.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", f.campaignId))
        .unique();
      const next = { week: 2, cycle: "NIGHT" as const, cycleDay: 3 };
      if (time === null) await c.db.insert("campaignTime", { campaignId: f.campaignId, ...next });
      else await c.db.patch("campaignTime", time._id, next);
      const state = await c.db
        .query("campaignState")
        .withIndex("by_campaign", (q) => q.eq("campaignId", f.campaignId))
        .unique();
      await c.db.patch("campaignState", state!._id, { fear: 4 });
    });
    const gmScene = await f.gm.query(api.combatHud.scene, { campaignId: f.campaignId });
    expect(gmScene).toMatchObject({ fear: 4, day: { week: 2, day: 3, cycle: "NIGHT" }, canSetLight: false, canOpenTimeArc: true });
    expect(gmScene.phase).not.toBeNull();
    const timeOfDay = await f.gm.query(api.campaigns.timeOfDay, { campaignId: f.campaignId });
    expect([gmScene.phase, gmScene.light]).toEqual([timeOfDay.phase, timeOfDay.light]);
    const playerScene = await f.player.query(api.combatHud.scene, { campaignId: f.campaignId });
    expect(playerScene).toEqual({ ...gmScene, canOpenTimeArc: false });
  });

  it("in a frame without campaign time: the GM's Day / Dim / Night, no day, no time arc", async () => {
    const f = await withParty("beast-feast");
    await f.gm.mutation(api.campaigns.setTimeOfDay, { campaignId: f.campaignId, timeOfDay: "dim" });
    expect(await f.gm.query(api.combatHud.scene, { campaignId: f.campaignId })).toEqual({
      fear: 0,
      light: "dim",
      phase: null,
      day: null,
      canSetLight: true,
      canOpenTimeArc: false,
    });
    expect(await f.player.query(api.combatHud.scene, { campaignId: f.campaignId })).toMatchObject({ canSetLight: false, canOpenTimeArc: false });
  });
});
