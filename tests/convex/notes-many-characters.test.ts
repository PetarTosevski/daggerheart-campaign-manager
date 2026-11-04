import { expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { key } from "./helpers";
import { makeTest } from "./setup";

// J7 (dcm-bxp.141): Notes finds the caller's character in this campaign through the owner+campaign index. Before,
// it read the caller's first 200 characters across all campaigns, so a player owning more than 200 elsewhere got a
// journal without its character (named after the account). The shared e2e player account hit this.

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass(cls.id)[0]!.id,
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

it("a player owning more than 200 characters in another campaign still gets this campaign's character on the journal", async () => {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: "p1@example.com", emailVerificationTime: 1, name: "Petra" }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|s` });
  const player = t.withIdentity({ subject: `${ids.player}|s` });
  async function campaignWithPlayer(name: string) {
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: key() });
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await player.mutation(api.members.joinByCode, { code });
    return campaignId;
  }

  // 210 older characters of the player in another campaign (cloned rows: only their owner and creation order matter).
  const elsewhere = await campaignWithPlayer("Elsewhere");
  const { characterId: first } = await player.mutation(api.characters.create, { campaignId: elsewhere, draft: draft("Old"), idempotencyKey: key() });
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...row } = (await ctx.db.get("characters", first))!;
    void _id;
    void _creationTime;
    for (let i = 0; i < 210; i++) await ctx.db.insert("characters", row);
  });

  const campaignId = await campaignWithPlayer("Here");
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });

  // Before the first write the hero already names the character.
  const before = await player.query(api.notes.journal, { campaignId });
  expect(before.whoName).toContain("Ash");

  // The first write creates the journal attached to Ash, and the GM's list names it after Ash.
  await player.mutation(api.notesEntries.add, { campaignId, page: { template: 0 }, kind: "note", text: "found a brass key" });
  const view = await player.query(api.notes.journal, { campaignId });
  expect(view.journal).not.toBeNull();
  expect(view.whoName).toContain("Ash");
  const journal = await t.run((ctx) => ctx.db.get("journals", view.journal!._id));
  expect(journal?.characterId).toBe(ash);
  const shared = await gm.query(api.notesSharing.shared, { campaignId, tab: "players" });
  expect(shared.length).toBeGreaterThan(0);
  expect(shared.every((row) => row.ownerName === "Ash")).toBe(true);
}, 60_000);
