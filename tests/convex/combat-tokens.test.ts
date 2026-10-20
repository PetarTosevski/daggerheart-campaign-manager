import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_COMBAT_TOKENS } from "../../convex/lib/combatMaps";
import { freeSquares, initialsOf, moveToken, normalizeAngle, snapTurn } from "../../src/components/combat-map/tokens/geometry";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// D9 C6: tokens on a combat map (R3, R4, R5, Q6). GM functions: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player
// FORBIDDEN. `party`, `move` and `turn` are every member's: a player moves and turns only their own PC's token on
// the live map (COMBAT_NOT_YOUR_TOKEN otherwise) and reads only PC tokens. TE2's authz matrix does not exist yet;
// D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));
const BEAR = { kind: "srd" as const, adversaryId: "bear" };
const BURROWER = { kind: "srd" as const, adversaryId: "acid-burrower" };

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

/** A campaign with a live map, a player who owns "Ash", the GM's own "Bryn", and a running encounter (2 Bears, a Solo). */
async function withTokens() {
  const ctx = await setupWithCampaign();
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
  const add = (source: typeof BEAR | typeof BURROWER, count: number) =>
    gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() });
  const { instanceIds: bears } = await add(BEAR, 2);
  const { instanceIds: [burrower] } = await add(BURROWER, 1);
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  const list = () => gm.query(api.combatTokens.list, { campaignId, mapId });
  const tokenOf = async (name: string) => (await list()).find((tk) => tk.name === name)!;
  return { t, gm, player, other: ctx.other, campaignId, mapId, ash, bryn, encounterId, bears, burrower: burrower!, list, tokenOf };
}

/** A third account outside the campaign. */
async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

describe("combat tokens: access", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("keeps every GM function from anonymous callers, outsiders and players, and lets the GM run each", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 4, side: "enemy", idempotencyKey: key() });
    const tokenId = (await f.tokenOf("Bandit"))._id;
    const all = {
      list: (c: Client) => c.query(api.combatTokens.list, { campaignId, mapId }),
      combatants: (c: Client) => c.query(api.combatTokens.combatants, { campaignId, mapId }),
      addParty: (c: Client) => c.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() }),
      placeAdversaries: (c: Client) => c.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [f.bears[0]!], idempotencyKey: key() }),
      addCustom: (c: Client) => c.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Wolf", hp: 3, side: "enemy", idempotencyKey: key() }),
      rename: (c: Client) => c.mutation(api.combatTokens.rename, { campaignId, tokenId, name: "Bandit Archer" }),
      setSide: (c: Client) => c.mutation(api.combatTokens.setSide, { campaignId, tokenId, side: "neutral" }),
      setSize: (c: Client) => c.mutation(api.combatTokens.setSize, { campaignId, tokenId, size: 2 }),
      markCustom: (c: Client) => c.mutation(api.combatTokens.markCustom, { campaignId, tokenId, track: "hp", delta: 1, idempotencyKey: key() }),
      toggleCustomCondition: (c: Client) =>
        c.mutation(api.combatTokens.toggleCustomCondition, { campaignId, tokenId, condition: "hidden", idempotencyKey: key() }),
      remove: (c: Client) => c.mutation(api.combatTokens.remove, { campaignId, tokenId }),
      clear: (c: Client) => c.mutation(api.combatTokens.clear, { campaignId, mapId }),
    };
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(12);
    const out = await outsider(f.t);
    for (const name of names) expect([name, await code(all[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(all[name](f.player))]).toEqual([name, "FORBIDDEN"]);
    // In this order every GM call is valid (remove and clear come last).
    for (const name of names) expect([name, await code(all[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("lets a player move and turn only their own PC token, on the live map only (R4)", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [f.bears[0]!], idempotencyKey: key() });
    const ash = await f.tokenOf("Ash");
    const bryn = await f.tokenOf("Bryn");
    const bear = await f.tokenOf("Bear");
    const out = await outsider(f.t);
    const move = (c: Client, tokenId: string) => c.mutation(api.combatTokens.move, { campaignId, tokenId, x: 5, y: 5 });
    const turn = (c: Client, tokenId: string) => c.mutation(api.combatTokens.turn, { campaignId, tokenId, angle: 1 });

    for (const run of [move, turn]) {
      expect(await code(run(f.t as unknown as Client, ash._id))).toBe("UNAUTHENTICATED");
      expect(await code(run(out, ash._id))).toBe("NOT_FOUND");
      expect(await code(run(f.player, ash._id))).toBe("ok");
      expect(await code(run(f.player, bryn._id))).toBe("COMBAT_NOT_YOUR_TOKEN");
      expect(await code(run(f.player, bear._id))).toBe("COMBAT_NOT_YOUR_TOKEN");
      expect(await code(run(f.gm, bear._id))).toBe("ok");
      expect(await code(run(f.gm, bryn._id))).toBe("ok");
    }

    // Another map that is not live: players don't see it, so they can't move on it.
    const { mapId: hidden } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId: hidden, idempotencyKey: key() });
    const hiddenAsh = (await f.gm.query(api.combatTokens.list, { campaignId, mapId: hidden })).find((tk) => tk.name === "Ash")!;
    expect(await code(move(f.player, hiddenAsh._id))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(move(f.gm, hiddenAsh._id))).toBe("ok");
  });

  it("gives players the PC tokens only: their own and the other PCs', never an adversary or a custom token (R4, Q4)", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: f.bears, idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 4, side: "enemy", idempotencyKey: key() });
    const out = await outsider(f.t);
    const party = (c: Client, id: string = mapId) => c.query(api.combatTokens.party, { campaignId, mapId: id });

    expect(await code(party(f.t as unknown as Client))).toBe("UNAUTHENTICATED");
    expect(await code(party(out))).toBe("NOT_FOUND");
    const seen = await party(f.player);
    expect(seen.map((tk) => [tk.name, tk.kind, tk.mine, tk.canMove]).sort()).toEqual([
      ["Ash", "pc", true, true],
      ["Bryn", "pc", false, false],
    ]);
    expect(seen.every((tk) => tk.revealedTo === undefined)).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/Bear|Bandit|difficulty/);
    // The GM sees five tokens in the list and may move every one.
    expect((await f.list()).map((tk) => tk.name).sort()).toEqual(["Ash", "Bandit", "Bear", "Bear 2", "Bryn"]);
    expect((await f.list()).every((tk) => tk.canMove && !tk.mine && tk.revealedTo !== undefined)).toBe(true);

    // A map that is not live reads as empty for players; a bad or other campaign's map id reads as empty.
    const { mapId: hidden } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId: hidden, idempotencyKey: key() });
    expect(await party(f.player, hidden)).toEqual([]);
    expect(await party(f.gm, hidden)).toHaveLength(2);
    expect(await party(f.player, "not-an-id")).toEqual([]);
    expect(await f.gm.query(api.combatTokens.list, { campaignId, mapId: "not-an-id" })).toEqual([]);
  });

  it("refuses another campaign's token and map ids", async () => {
    const f = await withTokens();
    await f.gm.mutation(api.combatTokens.addParty, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() });
    const ash = await f.tokenOf("Ash");
    const { campaignId: mine } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await code(f.gm.mutation(api.combatTokens.move, { campaignId: mine, tokenId: ash._id, x: 1, y: 1 }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatTokens.remove, { campaignId: mine, tokenId: ash._id }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatTokens.remove, { campaignId: f.campaignId, tokenId: "nope" }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatTokens.addParty, { campaignId: mine, mapId: f.mapId, idempotencyKey: key() }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatTokens.clear, { campaignId: mine, mapId: f.mapId }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await f.gm.query(api.combatTokens.list, { campaignId: mine, mapId: f.mapId })).toEqual([]);
  });
});

describe("combat tokens: placing", () => {
  useAllowlist();

  it("places the active party once, on free squares on the left (the board)", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    expect((await f.gm.query(api.combatTokens.combatants, { campaignId, mapId })).partyLeft).toBe(2);
    const idempotencyKey = key();
    expect(await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey })).toEqual({ added: 2 });
    // A retried click applies once; a new click finds nobody left.
    expect(await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey })).toEqual({ added: 2 });
    expect(await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() })).toEqual({ added: 0 });
    const tokens = await f.list();
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens.map((tk) => `${tk.x},${tk.y}`)).size).toBe(2);
    for (const tk of tokens) {
      expect(tk).toMatchObject({ kind: "pc", side: "pc", size: 1, face: 0, light: "none" });
      expect(tk.x).toBeLessThan(15);
    }
    expect((await f.gm.query(api.combatTokens.combatants, { campaignId, mapId })).partyLeft).toBe(0);

    // A character who is not active (benched) is not placed.
    await f.player.mutation(api.characters.setStatus, { characterId: f.ash, status: "away" });
    const { mapId: second } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    expect(await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId: second, idempotencyKey: key() })).toEqual({ added: 1 });
  });

  it("places the running encounter's adversaries from the queue: one, then all; a Solo takes 2 × 2", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    const queue = async () => (await f.gm.query(api.combatTokens.combatants, { campaignId, mapId })).queue;
    expect((await queue()).map((q) => [q.name, q.solo])).toEqual([
      ["Bear", false],
      ["Bear 2", false],
      ["Acid Burrower", true],
    ]);
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [f.bears[0]!], idempotencyKey: key() });
    expect((await queue()).map((q) => q.name)).toEqual(["Bear 2", "Acid Burrower"]);
    // "Place all" with an id already placed skips it.
    const all = [f.bears[0]!, ...(await queue()).map((q) => q.instanceId)];
    expect(await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: all, idempotencyKey: key() })).toEqual({ added: 2 });
    expect(await queue()).toEqual([]);
    const burrower = await f.tokenOf("Acid Burrower");
    expect(burrower).toMatchObject({ kind: "adversary", side: "enemy", size: 2, instanceId: f.burrower, tracked: true });
    expect(burrower.face).toBeCloseTo(Math.PI);
    expect(burrower.x).toBeGreaterThan(15);
    expect(burrower.stats).toMatchObject({ hp: 0, stress: 0, down: false });
    expect(burrower.stats!.difficulty).toBeGreaterThan(0);

    // Defeated instances leave the queue.
    await f.gm.mutation(api.combatTokens.clear, { campaignId, mapId });
    await f.gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId: f.bears[1]!, delta: 7, idempotencyKey: key() });
    expect((await queue()).map((q) => q.name)).toEqual(["Bear", "Acid Burrower"]);
  });

  it("refuses an instance of another encounter (NOT_FOUND) and places nothing without a running encounter", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    const { encounterId: draftId } = await f.gm.mutation(api.encounters.create, { campaignId, name: "Later", idempotencyKey: key() });
    const { instanceIds } = await f.gm.mutation(api.encounters.addAdversary, {
      campaignId,
      encounterId: draftId,
      source: BEAR,
      count: 1,
      summoned: false,
      idempotencyKey: key(),
    });
    const place = (ids: string[]) => f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: ids, idempotencyKey: key() });
    expect(await code(place(instanceIds))).toBe("NOT_FOUND");
    expect(await code(place(["not-an-id"]))).toBe("NOT_FOUND");
    expect(await code(place([]))).toBe("INVALID");
    await f.gm.mutation(api.encounters.end, { campaignId, encounterId: f.encounterId });
    expect(await code(place([f.bears[0]!]))).toBe("ENCOUNTER_NOT_RUNNING");
    expect((await f.gm.query(api.combatTokens.combatants, { campaignId, mapId })).encounter).toBeNull();
  });

  it("adds custom tokens with their own numbers and refuses past MAX_COMBAT_TOKENS", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    const add = (name: string, hp = 4) => f.gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name, hp, side: "ally", idempotencyKey: key() });
    const { tokenId } = await add("  Guard Captain  ", 6);
    expect(await f.tokenOf("Guard Captain")).toMatchObject({ _id: tokenId, kind: "custom", side: "ally", stats: { hp: 0, hpMax: 6, stress: 0, stressMax: 0, conditions: [] } });
    expect(await code(add("   "))).toBe("INVALID");
    expect(await code(add("x".repeat(61)))).toBe("INVALID");
    expect(await code(add("Ogre", 100))).toBe("INVALID");
    expect(await code(add("Ogre", 2.5))).toBe("INVALID");

    // Fill the map to the cap; the next token is refused, and so is a party that would not fit.
    await f.t.run(async (c) => {
      const row = await c.db.get("combatTokens", tokenId);
      const { _id, _creationTime, ...fields } = row!;
      void _id;
      void _creationTime;
      for (let i = 1; i < MAX_COMBAT_TOKENS; i++) await c.db.insert("combatTokens", fields);
    });
    expect(await code(add("One too many"))).toBe("COMBAT_TOKEN_LIMIT");
    expect(await code(f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() }))).toBe("COMBAT_TOKEN_LIMIT");
  });
});

describe("combat tokens: moving, turning, editing", () => {
  useAllowlist();

  it("moves to whole squares inside the map and faces the way it moved; turns snap to 15 degrees (R5)", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    const ash = await f.tokenOf("Ash");
    const move = (x: number, y: number) => f.player.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x, y });

    expect(await move(ash.x, ash.y + 3.4)).toEqual({ x: ash.x, y: ash.y + 3, face: Math.PI / 2 });
    expect(await move(ash.x - 2, ash.y + 1)).toMatchObject({ x: ash.x - 2, y: ash.y + 1 });
    expect((await f.tokenOf("Ash")).face).toBeCloseTo(Math.atan2(-2, -2));
    // Off the map: clamped to the edge (a medium map is 30 × 20).
    expect(await move(99, -5)).toMatchObject({ x: 29, y: 0 });
    // Not moving keeps the facing.
    const before = (await f.tokenOf("Ash")).face;
    expect((await move(29, 0)).face).toBe(before);

    const turn = (angle: number) => f.player.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle });
    expect((await turn(0.3)).face).toBeCloseTo(Math.PI / 12);
    expect((await turn(-Math.PI / 2 + 0.05)).face).toBeCloseTo(-Math.PI / 2);
    expect((await turn(7 * Math.PI)).face).toBeCloseTo(Math.PI);
    expect((await f.tokenOf("Ash")).face).toBeCloseTo(Math.PI);
  });

  it("keeps stats on their own rows: sheet HP and tracker HP show on the token, the token row holds no copy (R4)", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [f.bears[0]!], idempotencyKey: key() });

    // The player marks 2 HP on their own sheet; the GM marks 2 HP on the bear in the tracker.
    await f.player.mutation(api.characters.adjustResource, { characterId: f.ash, resource: "hp", delta: 2 });
    await f.gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId: f.bears[0]!, delta: 2, idempotencyKey: key() });
    await f.gm.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: f.bears[0]!, condition: "vulnerable", idempotencyKey: key() });
    expect((await f.tokenOf("Ash")).stats).toMatchObject({ hp: 2 });
    expect((await f.tokenOf("Bear")).stats).toMatchObject({ hp: 2, conditions: ["vulnerable"] });
    expect((await f.player.query(api.combatTokens.party, { campaignId, mapId })).find((tk) => tk.mine)!.stats).toMatchObject({ hp: 2 });

    const rows = await f.t.run((c) => c.db.query("combatTokens").withIndex("by_map", (q) => q.eq("mapId", mapId)).collect());
    for (const row of rows) expect(Object.keys(row.ref).sort()).toEqual(row.ref.kind === "pc" ? ["characterId", "kind"] : ["adversaryId", "kind"]);

    // Custom-token edits refuse PC and adversary tokens.
    const ash = await f.tokenOf("Ash");
    expect(await code(f.gm.mutation(api.combatTokens.markCustom, { campaignId, tokenId: ash._id, track: "hp", delta: 1, idempotencyKey: key() }))).toBe("INVALID");
    expect(await code(f.gm.mutation(api.combatTokens.rename, { campaignId, tokenId: ash._id, name: "X" }))).toBe("INVALID");

    // A removed tracker instance leaves a token without stats the GM can still remove.
    await f.gm.mutation(api.encounters.removeInstance, { campaignId, instanceId: f.bears[0]! });
    const gone = (await f.list()).find((tk) => tk.kind === "adversary")!;
    expect(gone).toMatchObject({ name: "Removed adversary", stats: null, tracked: false });
    await f.gm.mutation(api.combatTokens.remove, { campaignId, tokenId: gone._id });
    expect(await f.list()).toHaveLength(2);
  });

  it("marks a custom token's HP and Stress within its track, toggles its conditions and renames it", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    const { tokenId } = await f.gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: key() });
    const mark = (track: "hp" | "stress", delta: number, idempotencyKey = key()) =>
      f.gm.mutation(api.combatTokens.markCustom, { campaignId, tokenId, track, delta, idempotencyKey });
    const k = key();
    expect(await mark("hp", 2, k)).toEqual({ hp: 2, stress: 0 });
    expect(await mark("hp", 2, k)).toEqual({ hp: 2, stress: 0 });
    expect(await mark("hp", 5)).toEqual({ hp: 3, stress: 0 });
    expect(await mark("stress", 1)).toEqual({ hp: 3, stress: 0 });
    expect(await mark("hp", -1)).toEqual({ hp: 2, stress: 0 });
    expect(await code(mark("hp", 0.5))).toBe("INVALID");
    expect((await f.tokenOf("Bandit")).stats!.down).toBe(false);
    await mark("hp", 1);
    expect((await f.tokenOf("Bandit")).stats!.down).toBe(true);

    const toggle = (condition: "hidden" | "restrained") =>
      f.gm.mutation(api.combatTokens.toggleCustomCondition, { campaignId, tokenId, condition, idempotencyKey: key() });
    expect(await toggle("hidden")).toEqual({ conditions: ["hidden"] });
    expect(await toggle("restrained")).toEqual({ conditions: ["hidden", "restrained"] });
    expect(await toggle("hidden")).toEqual({ conditions: ["restrained"] });

    await f.gm.mutation(api.combatTokens.rename, { campaignId, tokenId, name: " Bandit Archer " });
    expect((await f.list()).map((tk) => tk.name)).toEqual(["Bandit Archer"]);
    expect(await code(f.gm.mutation(api.combatTokens.rename, { campaignId, tokenId, name: "" }))).toBe("INVALID");
  });

  it("sets side and size (inside the map), removes one token and clears the map", async () => {
    const f = await withTokens();
    const { campaignId, mapId } = f;
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
    const { tokenId } = await f.gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Ogre", hp: 8, side: "enemy", idempotencyKey: key() });
    expect(await code(f.gm.mutation(api.combatTokens.setSide, { campaignId, tokenId, side: "pc" }))).toBe("INVALID");
    await f.gm.mutation(api.combatTokens.setSide, { campaignId, tokenId, side: "neutral" });
    const ash = await f.tokenOf("Ash");
    await f.gm.mutation(api.combatTokens.setSide, { campaignId, tokenId: ash._id, side: "ally" });
    await f.gm.mutation(api.combatTokens.setSide, { campaignId, tokenId: ash._id, side: "pc" });

    await f.gm.mutation(api.combatTokens.move, { campaignId, tokenId, x: 29, y: 19 });
    await f.gm.mutation(api.combatTokens.setSize, { campaignId, tokenId, size: 3 });
    expect(await f.tokenOf("Ogre")).toMatchObject({ side: "neutral", size: 3, x: 27, y: 17 });
    for (const size of [0, 4, 1.5]) expect(await code(f.gm.mutation(api.combatTokens.setSize, { campaignId, tokenId, size }))).toBe("INVALID");

    await f.gm.mutation(api.combatTokens.remove, { campaignId, tokenId });
    expect((await f.list()).map((tk) => tk.name).sort()).toEqual(["Ash", "Bryn"]);
    expect(await f.gm.mutation(api.combatTokens.clear, { campaignId, mapId })).toEqual({ removed: 2 });
    expect(await f.list()).toEqual([]);
    expect((await f.gm.query(api.combatMaps.tokenCount, { campaignId, mapId: mapId as Id<"combatMaps"> }))).toBe(0);
  });
});

describe("combat tokens: geometry (shared by the server and the optimistic updates)", () => {
  it("snaps turns to 15 degrees in (-π, π]", () => {
    expect(snapTurn(0.13)).toBeCloseTo(0);
    expect(snapTurn(0.14)).toBeCloseTo(Math.PI / 12);
    expect(snapTurn(-Math.PI)).toBeCloseTo(Math.PI);
    expect(snapTurn(3 * Math.PI + 0.01)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });

  it("moves to whole squares inside the map, facing the movement", () => {
    const token = { x: 4, y: 4, size: 2, face: 1 };
    expect(moveToken(token, 4, 4, { w: 10, h: 10 })).toEqual({ x: 4, y: 4, face: 1 });
    expect(moveToken(token, 9.6, 4.2, { w: 10, h: 10 })).toEqual({ x: 8, y: 4, face: 0 });
    expect(moveToken(token, 4, -3, { w: 10, h: 10 }).face).toBeCloseTo(-Math.PI / 2);
  });

  it("finds free squares on the preferred side, skipping covered and unwalkable squares", () => {
    const map = { w: 20, h: 12 };
    const [left] = freeSquares(map, [], "left", 1);
    const [right] = freeSquares(map, [], "right", 1);
    expect(left).toEqual({ x: 4, y: 6 });
    expect(right).toEqual({ x: 16, y: 6 });
    const three = freeSquares(map, [{ x: 4, y: 6, size: 1 }], "left", 3);
    expect(new Set(three.map((s) => `${s.x},${s.y}`)).size).toBe(3);
    expect(three).not.toContainEqual({ x: 4, y: 6 });
    const [dry] = freeSquares(map, [], "left", 1, (x) => x > 8);
    expect(dry!.x).toBeGreaterThan(8);
    // A 2 × 2 token never overlaps a token placed before it (the Solo next to a Bear).
    const taken = [{ x: 16, y: 6, size: 1 }];
    const [solo] = freeSquares(map, taken, "right", 1, undefined, 2);
    const overlaps = (a: { x: number; y: number }, as: number, b: { x: number; y: number; size: number }) =>
      a.x < b.x + b.size && a.x + as > b.x && a.y < b.y + b.size && a.y + as > b.y;
    expect(overlaps(solo!, 2, taken[0]!)).toBe(false);
    expect(solo!.x + 2).toBeLessThanOrEqual(map.w);
    expect(initialsOf("Acid Burrower", 2)).toBe("AB");
    expect(initialsOf("bear", 1)).toBe("B");
  });
});
