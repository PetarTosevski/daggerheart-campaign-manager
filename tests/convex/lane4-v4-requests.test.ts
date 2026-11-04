import { describe, expect, test } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

/**
 * Plan lanes-2, tracer V4 (docs/tasks/TASK-LN4-V4.md): the widened `combatRequests` shapes store and read back through the
 * real schema; a malformed member is refused; rows of the old shapes still conform (widen only, rule 7).
 */

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "v4@example.com", emailVerificationTime: 1 });
    const campaignId = await ctx.db.insert("campaigns", { ownerId: userId, frameId: "witherwild", name: "V4", nameKey: "v4", tier: 1, level: 1, createdAt: 1, lastOpenedAt: 1 });
    const characterId = await ctx.db.insert("characters", { campaignId, ownerId: userId, createdBy: userId, status: "active", sheet: {}, createdAt: 1, updatedAt: 1 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 4, adjustments: [], gmTurn: 1, createdAt: 1, updatedAt: 1 });
    const instanceId = await ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Gobstalker",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
      hp: 0,
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 1,
      updatedAt: 1,
    });
    const mapId = await ctx.db.insert("combatMaps", { campaignId, name: "Camp", live: true, source: "image", w: 10, h: 10, base: "grass", areas: [], seed: 1, schemaVersion: 1, updatedAt: 1 });
    const token = (x: number, ref: { kind: "pc"; characterId: Id<"characters"> } | { kind: "adversary"; adversaryId: Id<"encounterAdversaries"> }) =>
      ctx.db.insert("combatTokens", { campaignId, mapId, ref, side: ref.kind === "pc" ? "pc" : "enemy", x, y: 1, size: 1, face: 0, light: "torch", revealedTo: [] });
    const pcToken = await token(1, { kind: "pc", characterId });
    const enemyToken = await token(3, { kind: "adversary", adversaryId: instanceId });
    return { userId, campaignId, characterId, encounterId, instanceId, mapId, pcToken, enemyToken };
  });
  return { t, ...ids };
}

type Seed = Awaited<ReturnType<typeof seed>>;
const row = (s: Seed, kind: string, payload: Record<string, unknown>) => ({
  campaignId: s.campaignId,
  encounterId: s.encounterId,
  mapId: s.mapId,
  kind,
  status: "open",
  createdBy: s.userId,
  createdAt: 1,
  responses: [],
  payload,
});

async function roundTrip(s: Seed, doc: Record<string, unknown>) {
  const id = await s.t.run((ctx) => ctx.db.insert("combatRequests", doc as never));
  const back = await s.t.run((ctx) => ctx.db.get("combatRequests", id));
  expect(back).toMatchObject(doc);
}
const refused = (s: Seed, doc: Record<string, unknown>) => expect(s.t.run((ctx) => ctx.db.insert("combatRequests", doc as never))).rejects.toThrow();

describe("V4 combat request widens (plan lanes-2)", () => {
  test("dcm-vx5n: a cloakPrompt row stores and reads back; a bad member is refused", async () => {
    const s = await seed();
    const payload = { schemaVersion: 1, kind: "cloakPrompt", characterId: s.characterId, tokenId: s.pcToken, label: "Words of Discord", groupId: "g-cloak", targetTokenIds: [s.enemyToken] };
    await roundTrip(s, row(s, "cloakPrompt", payload));
    await refused(s, row(s, "cloakPrompt", { ...payload, schemaVersion: 2 }));
    await refused(s, row(s, "cloakPrompt", { ...payload, targetTokenIds: undefined }));
    await refused(s, row(s, "cloakPrompt", { ...payload, ends: true }));
  });

  test("dcm-uxsd: a forcedAttack row stores and reads back; a bad member is refused", async () => {
    const s = await seed();
    const payload = {
      schemaVersion: 1,
      kind: "forcedAttack",
      characterId: s.characterId,
      instanceId: s.instanceId,
      instanceLabel: "Gobstalker",
      feature: "Beguile",
      targetTokenIds: [s.pcToken],
      groupId: "g-forced",
    };
    await roundTrip(s, row(s, "forcedAttack", payload));
    await refused(s, row(s, "forcedAttack", { ...payload, feature: undefined }));
    await refused(s, row(s, "forcedAttack", { ...payload, instanceId: 3 }));
  });

  test("dcm-1sk4 + dcm-mcgj: a sanction keeps the Spirit Weapon box and a feature action's riders", async () => {
    const s = await seed();
    const attack = { kind: "attack", slot: "primary", targetTokenIds: [s.enemyToken], roll: { trait: "strength", spiritWeapon: true } };
    await roundTrip(s, row(s, "sanction", { schemaVersion: 1, kind: "sanction", characterId: s.characterId, action: attack, outOfRange: [{ tokenId: s.enemyToken, band: "far" }] }));
    const feature = {
      kind: "feature",
      featureId: "class:ranger:hold-them-off",
      useId: "main",
      targetTokenIds: [s.enemyToken],
      choices: [],
      roll: { trait: "agility", spiritWeapon: false },
      riders: [{ source: "card", id: "spirit-weapon", choices: [{ id: "situations", value: ["x"] }] }],
    };
    await roundTrip(s, row(s, "sanction", { schemaVersion: 1, kind: "sanction", characterId: s.characterId, action: feature, outOfRange: [{ tokenId: s.enemyToken, band: "far" }] }));
    await refused(s, row(s, "sanction", { schemaVersion: 1, kind: "sanction", characterId: s.characterId, action: { ...attack, roll: { spiritWeapon: "yes" } }, outOfRange: [] }));
    await refused(s, row(s, "sanction", { schemaVersion: 1, kind: "sanction", characterId: s.characterId, action: { ...feature, riders: [{ source: "spell", id: "x", choices: [] }] }, outOfRange: [] }));
  });

  test("dcm-sk4r: an incoming hit carries the GM's keyword ask, before and after the answer", async () => {
    const s = await seed();
    const hit = {
      schemaVersion: 1,
      kind: "incomingHit",
      attacker: { instanceId: s.instanceId, label: "Gobstalker" },
      targetCharacterId: s.characterId,
      damage: 9,
      damageType: "magic",
      direct: false,
      critical: false,
      groupId: "g-hit",
      responders: [{ characterId: s.characterId, role: "target", cardIds: [] }],
    };
    // An old row without the ask still conforms.
    await roundTrip(s, row(s, "incomingHit", hit));
    await roundTrip(s, row(s, "incomingHit", { ...hit, keywordAsk: { keyword: "fire", characterId: s.characterId, feature: "Fireproof" } }));
    await roundTrip(s, row(s, "incomingHit", { ...hit, keywordAsk: { keyword: "fire", characterId: s.characterId, feature: "Fireproof", answer: false, answeredBy: s.userId } }));
    await refused(s, row(s, "incomingHit", { ...hit, keywordAsk: { keyword: "ice", characterId: s.characterId, feature: "Fireproof" } }));
    await refused(s, row(s, "incomingHit", { ...hit, keywordAsk: { keyword: "fire", feature: "Fireproof" } }));
  });

  test("the old kinds are unchanged: an unknown kind is still refused", async () => {
    const s = await seed();
    await refused(s, row(s, "cloak", { schemaVersion: 1, kind: "cloak", characterId: s.characterId }));
  });
});
