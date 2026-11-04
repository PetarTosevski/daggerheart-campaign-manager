import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { key, setupWithCampaign } from "./helpers";

// Combat HUD HD1 (user answer 10a, bead dcm-bxp.99.32.8): a player's view of a visible adversary or other token carries
// its condition names, never a number; hidden tokens still never reach the player.

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

/**
 * Daylight on a live medium map: Ash (the player's) at (5, 10) looking east; a Bear (running encounter) at (9, 10) and
 * a custom Bandit at (12, 10) in front of Ash, a custom Lurker at (1, 10) behind Ash (out of the cone, hidden).
 */
async function withEnemies() {
  const { t, gm, other: player, campaignId } = await setupWithCampaign("witherwild");
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
  const list = () => gm.query(api.combatTokensReads.list, { campaignId, mapId });
  const tokenOf = async (name: string) => (await list()).find((tk) => tk.name === name)!._id;
  const place = (tokenId: Id<"combatTokens">, x: number, y: number, face = 0) => t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, face }));
  const custom = async (name: string, x: number, y: number) => {
    const { tokenId } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name, hp: 3, side: "enemy", idempotencyKey: key() });
    await place(tokenId, x, y, Math.PI);
    return tokenId;
  };
  await t.run(async (c) => {
    const time = await c.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    const day = { cycle: "DAY" as const, cycleDay: 3 };
    if (time === null) await c.db.insert("campaignTime", { campaignId, week: 1, ...day });
    else await c.db.patch("campaignTime", time._id, day);
  });
  await place(await tokenOf("Ash"), 5, 10, 0);
  const bear = await tokenOf("Bear");
  await place(bear, 9, 10, Math.PI);
  const bandit = await custom("Bandit", 12, 10);
  const lurker = await custom("Lurker", 1, 10);
  const view = async () => {
    const v = await player.query(api.combatVision.playerView, { campaignId });
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v;
  };
  return { t, gm, player, campaignId, mapId, ash, bear, bandit, lurker, instanceId: instanceIds[0]!, view };
}

describe("players' view of enemy conditions", () => {
  it("sends the condition names of visible adversaries and custom tokens, never their numbers", async () => {
    const f = await withEnemies();
    await f.t.run(async (c) => {
      await c.db.patch("encounterAdversaries", f.instanceId, { conditions: ["vulnerable", "restrained"], hp: 2, stress: 1 });
      for (const id of [f.bandit, f.lurker]) {
        const token = (await c.db.get("combatTokens", id))!;
        if (token.ref.kind === "custom") await c.db.patch("combatTokens", id, { ref: { ...token.ref, hp: 1, conditions: ["hidden"] } });
      }
    });
    const v = await f.view();
    const byName = new Map(v.others.map((o) => [o.name, o]));
    expect([...byName.keys()].sort()).toEqual(["Bandit", "Bear"]);
    expect(byName.get("Bear")!.conditions).toEqual([
      { id: "vulnerable", label: "Vulnerable" },
      { id: "restrained", label: "Restrained" },
    ]);
    expect(byName.get("Bandit")!.conditions).toEqual([{ id: "hidden", label: "Hidden" }]);
    for (const row of v.others) {
      expect(Object.keys(row).sort()).toEqual(["_id", "conditions", "face", "name", "portrait", "revealed", "side", "size", "x", "y"]);
      for (const c of row.conditions!) expect(Object.keys(c).sort()).toEqual(["id", "label"]);
    }
    // No HP, Stress, Difficulty or thresholds for any non-PC token; the hidden Lurker is absent altogether.
    expect(JSON.stringify(v.others)).not.toMatch(/hp|stress|difficulty|threshold|major|severe|revealedTo/i);
    expect(JSON.stringify(v)).not.toMatch(/difficulty|threshold|Lurker|revealedTo/i);
    expect(v.others.some((o) => o._id === f.lurker)).toBe(false);
    // The GM's preview is exactly the player's view (R12), conditions included.
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId: f.campaignId, characterId: f.ash })).toEqual(v);
  });

  it("leaves the field out for a token without conditions (the D9 row shape)", async () => {
    const f = await withEnemies();
    const v = await f.view();
    for (const row of v.others) expect("conditions" in row).toBe(false);
  });
});
