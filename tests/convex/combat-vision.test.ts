import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { decodeExplored, exploredLength } from "../../src/lib/domain/combat-map/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, errorData, key, setupWithCampaign, useAllowlist } from "./helpers";

// D9 C7: vision on the server (R8-R12, Q1, Q3, Q4). Access: playerView / explored / markExplored /
// setCarriedLight / toggleLight are every member's (a player only for their own character, on the live map);
// previewAs / revealTo / unrevealTo / paintFog are the GM's (player FORBIDDEN, outsider NOT_FOUND, anonymous
// UNAUTHENTICATED). TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];
type Frame = "witherwild" | "beast-feast";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));
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

/** Campaign time phases used here (R8): Deep Night, Nightfall (dim) and Morning. */
const NIGHT = { cycle: "NIGHT" as const, cycleDay: 3 };
const NIGHTFALL = { cycle: "NIGHT" as const, cycleDay: 1 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

/**
 * A live medium map (30 x 20, grass) with the party placed: the player's "Ash" and the GM's "Bryn". Tokens are
 * positioned directly so the geometry is exact.
 */
async function withScene(frameId: Frame = "witherwild") {
  const ctx = await setupWithCampaign(frameId);
  const { t, gm, other: player, campaignId } = ctx;
  const joinCode = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await player.mutation(api.members.joinByCode, { code: joinCode });
  const { characterId: ash } = await player.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() });
  const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: key() });
  const list = () => gm.query(api.combatTokens.list, { campaignId, mapId });
  const tokenOf = async (name: string) => (await list()).find((tk) => tk.name === name)!;
  const ashToken = (await tokenOf("Ash"))._id;
  const brynToken = (await tokenOf("Bryn"))._id;
  const place = (tokenId: Id<"combatTokens">, x: number, y: number, face = 0) => t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, face }));
  const setTime = (time: { cycle: "DAY" | "NIGHT"; cycleDay: number }) =>
    t.run(async (c) => {
      const row = await c.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      if (row === null) await c.db.insert("campaignTime", { campaignId, week: 1, ...time });
      else await c.db.patch("campaignTime", row._id, time);
    });
  const enemy = async (name: string, x: number, y: number, light: "none" | "torch" = "none") => {
    const { tokenId } = await gm.mutation(api.combatTokens.addCustom, { campaignId, mapId, name, hp: 3, side: "enemy", idempotencyKey: key() });
    await t.run((c) => c.db.patch("combatTokens", tokenId, { x, y, light }));
    return tokenId;
  };
  const view = (c: Client = player) => c.query(api.combatVision.playerView, { campaignId });
  const okView = async (c: Client = player) => {
    const v = await view(c);
    if (v.state !== "ok") throw new Error(`expected a view, got ${v.state}`);
    return v;
  };
  const names = async (c: Client = player) => (await okView(c)).others.map((o) => o.name).sort();
  // Ash at (5, 10) looking east; Bryn out of the way in the top-left corner looking west.
  await place(ashToken, 5, 10, 0);
  await place(brynToken, 1, 1, Math.PI);
  await setTime(DAY);
  return { t, gm, player, campaignId, mapId, ash, bryn, ashToken, brynToken, list, tokenOf, place, setTime, enemy, view, okView, names };
}

/** A third account outside the campaign. */
async function outsider(t: Setup["t"]) {
  const id = await t.run((c) => c.db.insert("users", { email: "outsider@example.com", emailVerificationTime: 1 }));
  return t.withIdentity({ subject: `${id}|session` });
}

/** Squares of column x from top to bottom, as `y * w + x` for a map w wide. */
const column = (x: number, w: number, h: number) => Array.from({ length: h }, (_, y) => y * w + x);

describe("combat vision: access", () => {
  useAllowlist("gm@example.com,other@example.com,outsider@example.com");

  it("keeps the GM functions from anonymous callers, outsiders and players, and lets the GM run each", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const goblin = await f.enemy("Goblin", 8, 10);
    const gmOnly = {
      previewAs: (c: Client) => c.query(api.combatVision.previewAs, { campaignId, characterId: f.ash }),
      revealTo: (c: Client) => c.mutation(api.combatVision.revealTo, { campaignId, tokenId: goblin, characterId: f.ash }),
      unrevealTo: (c: Client) => c.mutation(api.combatVision.unrevealTo, { campaignId, tokenId: goblin, characterId: f.ash }),
      paintFog: (c: Client) => c.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [0, 1], mark: "hide" }),
    };
    const names = Object.keys(gmOnly) as (keyof typeof gmOnly)[];
    const out = await outsider(f.t);
    for (const name of names) expect([name, await code(gmOnly[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(gmOnly[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(gmOnly[name](f.player))]).toEqual([name, "FORBIDDEN"]);
    for (const name of names) expect([name, await code(gmOnly[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("lets members read and write vision only for their own character, on the live map", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const { objectId } = await f.gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 12.5, y: 10.5 });
    // Ash next to the campfire, looking at it (plan d12-bugs B4: a player switches a light only from Melee).
    await f.place(f.ashToken, 11, 10, 0);
    const members = {
      playerView: (c: Client) => c.query(api.combatVision.playerView, { campaignId }),
      explored: (c: Client) => c.query(api.combatVision.explored, { campaignId, characterId: f.ash }),
      markExplored: (c: Client) => c.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: "_" }),
      setCarriedLight: (c: Client) => c.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: f.ashToken, light: "torch" }),
      toggleLight: (c: Client) => c.mutation(api.combatVision.toggleLight, { campaignId, objectId, lit: false }),
    };
    const names = Object.keys(members) as (keyof typeof members)[];
    const out = await outsider(f.t);
    for (const name of names) expect([name, await code(members[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(members[name](out))]).toEqual([name, "NOT_FOUND"]);
    for (const name of names) expect([name, await code(members[name](f.player))]).toEqual([name, "ok"]);
    for (const name of names) expect([name, await code(members[name](f.gm))]).toEqual([name, "ok"]);

    // Another character's view, explored area and light are not the player's.
    expect(await code(f.player.query(api.combatVision.playerView, { campaignId, characterId: f.bryn }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(f.player.query(api.combatVision.explored, { campaignId, characterId: f.bryn }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.bryn, bits: "_" }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    expect(await code(f.player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: f.brynToken, light: "torch" }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    const goblin = await f.enemy("Goblin", 8, 10);
    expect(await code(f.player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: goblin, light: "torch" }))).toBe("COMBAT_NOT_YOUR_TOKEN");
    // The GM sets any token's light (Q3).
    expect(await code(f.gm.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: goblin, light: "lantern" }))).toBe("ok");
    expect((await f.tokenOf("Goblin")).light).toBe("lantern");
    expect((await f.tokenOf("Ash")).light).toBe("torch");

    // A map that is not live: players get nothing from it.
    const { mapId: hidden } = await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    await f.gm.mutation(api.combatTokens.addParty, { campaignId, mapId: hidden, idempotencyKey: key() });
    const hiddenAsh = (await f.gm.query(api.combatTokens.list, { campaignId, mapId: hidden })).find((tk) => tk.name === "Ash")!;
    expect(await code(f.player.mutation(api.combatVision.markExplored, { campaignId, mapId: hidden, characterId: f.ash, bits: "_" }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.player.query(api.combatVision.explored, { campaignId, characterId: f.ash, mapId: hidden }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: hiddenAsh._id, light: "torch" }))).toBe("COMBAT_MAP_NOT_FOUND");
    expect(await code(f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.ash, mapId: hidden }))).toBe("ok");

    // Bad and other campaigns' ids.
    expect(await code(f.gm.query(api.combatVision.previewAs, { campaignId, characterId: "nope" }))).toBe("NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatVision.revealTo, { campaignId, tokenId: "nope", characterId: f.ash }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatVision.toggleLight, { campaignId, objectId: "nope", lit: true }))).toBe("COMBAT_OBJECT_NOT_FOUND");
    expect(await code(f.gm.mutation(api.combatVision.paintFog, { campaignId, mapId: "nope", squares: [], mark: "hide" }))).toBe("COMBAT_MAP_NOT_FOUND");
    const { campaignId: mine } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await code(f.gm.mutation(api.combatVision.revealTo, { campaignId: mine, tokenId: goblin, characterId: f.ash }))).toBe("COMBAT_TOKEN_NOT_FOUND");
    expect(await code(f.gm.query(api.combatVision.previewAs, { campaignId: mine, characterId: f.ash }))).toBe("NOT_FOUND");
  });

  it("answers noMap and noCharacter instead of throwing", async () => {
    const f = await withScene();
    const { campaignId } = f;
    const { campaignId: empty } = await f.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Empty", idempotencyKey: key() });
    expect(await f.gm.query(api.combatVision.playerView, { campaignId: empty })).toEqual({ state: "noMap" });
    await f.gm.mutation(api.combatTokens.remove, { campaignId, tokenId: f.ashToken });
    expect(await f.view()).toEqual({ state: "noCharacter", mapId: f.mapId });
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.ash })).toEqual({ state: "noCharacter", mapId: f.mapId });
    expect(await code(f.player.mutation(api.combatVision.markExplored, { campaignId, mapId: f.mapId, characterId: f.ash, bits: "_" }))).toBe(
      "COMBAT_NO_CHARACTER",
    );
  });
});

describe("combat vision: what a player sees", () => {
  useAllowlist();

  it("drops a token behind a wall (R7, R11) and a GM fog mark decides too (R12)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    await f.enemy("Goblin", 15, 10);
    await f.enemy("Orc", 8, 12);
    expect(await f.names()).toEqual(["Goblin", "Orc"]);
    // A wall column between Ash and the Goblin.
    await f.gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: column(10, 30, 20), paint: "wall" });
    expect(await f.names()).toEqual(["Orc"]);
    // The GM reveals the Goblin's square: tokens there show; hides the Orc's: it goes.
    await f.gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [10 * 30 + 15], mark: "reveal" });
    await f.gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [12 * 30 + 8], mark: "hide" });
    expect(await f.names()).toEqual(["Goblin"]);
    const fog = (await f.gm.query(api.combatMaps.get, { campaignId, mapId }))!.cells.filter((c) => c.layer === "fog");
    expect(fog).toHaveLength(1);
    // Erase brings automatic vision back, and the emptied tile is deleted.
    await f.gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [10 * 30 + 15, 12 * 30 + 8], mark: "erase" });
    expect(await f.names()).toEqual(["Orc"]);
    expect((await f.gm.query(api.combatMaps.get, { campaignId, mapId }))!.cells.filter((c) => c.layer === "fog")).toHaveLength(0);
    expect(await code(f.gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [30 * 20], mark: "hide" }))).toBe("INVALID");
  });

  it("hides a dim-band enemy at night until the GM reveals it, and shows it during Nightfall (R8, R9, R10)", async () => {
    const f = await withScene();
    const { campaignId } = f;
    await f.player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: f.ashToken, light: "torch" });
    const wolf = await f.enemy("Wolf", 14, 10); // 9 squares away: the torch's dim band (6 to 12).
    await f.enemy("Rat", 8, 10); // 3 squares: clear.
    await f.setTime(NIGHT);
    let v = await f.okView();
    expect(v.light).toBe("night");
    expect(v.phase).toBe("Deep Night");
    expect(v.others.map((o) => [o.name, o.revealed])).toEqual([["Rat", false]]);

    await f.gm.mutation(api.combatVision.revealTo, { campaignId, tokenId: wolf, characterId: f.ash });
    await f.gm.mutation(api.combatVision.revealTo, { campaignId, tokenId: wolf, characterId: f.ash }); // idempotent
    expect((await f.tokenOf("Wolf")).revealedTo).toEqual([f.ash]);
    v = await f.okView();
    expect(v.others.map((o) => [o.name, o.revealed]).sort()).toEqual([
      ["Rat", false],
      ["Wolf", true],
    ]);
    // A reveal is for that character only: Bryn (the GM's) standing beside Ash does not get it.
    await f.place(f.brynToken, 5, 9, 0);
    const bryn = await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.bryn });
    expect(bryn.state === "ok" && bryn.others.map((o) => o.name)).toEqual(["Rat"]);

    await f.gm.mutation(api.combatVision.unrevealTo, { campaignId, tokenId: wolf, characterId: f.ash });
    expect((await f.okView()).others.map((o) => o.name)).toEqual(["Rat"]);

    // Nightfall is a dim phase: full vision, tokens shown, the badge (R8).
    await f.setTime(NIGHTFALL);
    v = await f.okView();
    expect(v.light).toBe("dim");
    expect(v.others.map((o) => [o.name, o.revealed]).sort()).toEqual([
      ["Rat", false],
      ["Wolf", false],
    ]);
    await f.setTime(DAY);
    expect((await f.okView()).light).toBe("day");
  });

  it("always shows the other PCs with their sheet numbers but never adds their view (Q4)", async () => {
    const f = await withScene();
    const { campaignId } = f;
    await f.setTime(NIGHT);
    await f.place(f.ashToken, 15, 10, 0);
    await f.place(f.brynToken, 5, 10, Math.PI);
    await f.gm.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: f.brynToken, light: "torch" });
    await f.enemy("Lurker", 3, 10); // in front of Bryn, behind Ash.
    const v = await f.okView();
    expect(v.characterId).toBe(f.ash);
    expect(v.others).toEqual([]);
    const pcs = Object.fromEntries(v.pcs.map((p) => [p.name, p]));
    expect(Object.keys(pcs).sort()).toEqual(["Ash", "Bryn"]);
    expect(pcs.Ash).toMatchObject({ mine: true, canMove: true, _id: f.ashToken });
    expect(pcs.Bryn).toMatchObject({ mine: false, canMove: false, light: "torch" });
    expect(pcs.Bryn!.stats).toMatchObject({ hp: expect.any(Number), hpMax: expect.any(Number), stress: expect.any(Number) });
    expect(pcs.Bryn!.revealedTo).toBeUndefined();
    // The Lurker's square is not in Ash's vision mask, though Bryn sees it.
    const seen = decodeExplored(v.vision.seen, exploredLength(30, 20));
    expect(seen[21 * v.vision.sw + 7]).toBe(0);
    const bryn = await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.bryn });
    expect(bryn.state === "ok" && bryn.others.map((o) => o.name)).toEqual(["Lurker"]);
  });

  it("lets an enemy's carried torch light its own surroundings for a player who can see them (Q3)", async () => {
    const f = await withScene();
    const { campaignId } = f;
    await f.setTime(NIGHT);
    const brute = await f.enemy("Brute", 14, 10, "torch");
    let v = await f.okView();
    expect(v.others.map((o) => [o.name, o.revealed])).toEqual([["Brute", false]]);
    // The squares around the Brute are clear in Ash's mask; far behind Ash nothing is seen.
    const clear = decodeExplored(v.vision.clear, exploredLength(30, 20));
    expect(clear[21 * v.vision.sw + 26]).toBe(1);
    expect(clear[21 * v.vision.sw + 2]).toBe(0);
    // Without the torch the Brute is beyond Ash's bare night vision (3 squares).
    await f.gm.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: brute, light: "none" });
    v = await f.okView();
    expect(v.others).toEqual([]);
  });

  it("never sends an adversary's or custom token's stats (R4)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const { encounterId } = await f.gm.mutation(api.encounters.create, { campaignId, name: "Den", idempotencyKey: key() });
    const { instanceIds } = await f.gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() });
    await f.gm.mutation(api.encounters.start, { campaignId, encounterId });
    await f.gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: key() });
    await f.place((await f.tokenOf("Bear"))._id, 9, 10, Math.PI);
    await f.enemy("Bandit", 12, 10);
    const v = await f.okView();
    expect(v.others.map((o) => o.name).sort()).toEqual(["Bandit", "Bear"]);
    for (const row of v.others) expect(Object.keys(row).sort()).toEqual(["_id", "face", "name", "revealed", "side", "size", "x", "y"]);
    expect(JSON.stringify(v.others)).not.toMatch(/hp|stress|difficulty|conditions|light|revealedTo/i);
    expect(JSON.stringify(v)).not.toMatch(/difficulty|revealedTo/);
  });

  it("gives the GM's preview exactly the player's result (R12)", async () => {
    const f = await withScene();
    const { campaignId } = f;
    await f.enemy("Goblin", 12, 10);
    await f.enemy("Hidden", 2, 2);
    await f.setTime(NIGHTFALL);
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.ash })).toEqual(await f.view());
    await f.setTime(NIGHT);
    expect(await f.gm.query(api.combatVision.previewAs, { campaignId, characterId: f.ash })).toEqual(await f.view());
  });

  it("treats a frame without campaign time as day", async () => {
    const f = await withScene("beast-feast");
    await f.enemy("Goblin", 14, 10);
    const v = await f.okView();
    expect([v.phase, v.light]).toEqual([null, "day"]);
    expect(v.others.map((o) => o.name)).toEqual(["Goblin"]);
    expect(v.coneDeg).toBe(70);
  });
});

describe("combat vision: lights and explored areas", () => {
  useAllowlist();

  it("merges explored samples, keeps only what the character sees, and writes only when they grow (R11)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const length = exploredLength(30, 20);
    const all = "_".repeat(Math.ceil(length / 6));
    const mark = () => f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: all });
    const stored = async () => {
      const row = await f.player.query(api.combatVision.explored, { campaignId, characterId: f.ash });
      expect(row).toMatchObject({ mapId, characterId: f.ash, length });
      return decodeExplored(row!.bits, length);
    };
    const count = (m: Uint8Array) => m.reduce((n, b) => n + b, 0);
    expect(count(await stored())).toBe(0);

    expect(await mark()).toEqual({ grew: true });
    const first = await stored();
    // Only the samples Ash sees now: the cone east of Ash, nothing behind.
    const seen = decodeExplored((await f.okView()).vision.seen, length);
    expect(Array.from(first)).toEqual(Array.from(seen));
    expect(first[21 * 60 + 2]).toBe(0);
    expect(await mark()).toEqual({ grew: false });

    // Ash turns west: the new samples are added, the old ones kept.
    await f.player.mutation(api.combatTokens.turn, { campaignId, tokenId: f.ashToken, angle: Math.PI });
    expect(await mark()).toEqual({ grew: true });
    const second = await stored();
    expect(second[21 * 60 + 2]).toBe(1);
    for (let i = 0; i < length; i++) if (first[i]) expect(second[i]).toBe(1);
    expect(count(second)).toBeGreaterThan(count(first));

    // An empty delta never writes; a malformed or too long one is INVALID.
    expect(await f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: "" })).toEqual({ grew: false });
    expect(await code(f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: "!!" }))).toBe("INVALID");
    expect(await code(f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: `${all}A` }))).toBe("INVALID");
    // The GM reads any character's explored area.
    expect((await f.gm.query(api.combatVision.explored, { campaignId, characterId: f.ash }))!.bits).toBe(
      (await f.player.query(api.combatVision.explored, { campaignId, characterId: f.ash }))!.bits,
    );
  });

  it("lets a player switch only a light their character sees or has seen, from Melee; the GM any (R9, B4)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    // Ash next to the campfire ahead (B4: Melee), looking east at it.
    await f.place(f.ashToken, 11, 10, 0);
    const add = (x: number, y: number, kind: "campfire" | "walltorch" | "crate" = "campfire") =>
      f.gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind, x, y }).then((r) => r.objectId);
    const ahead = await add(12.5, 10.5);
    const behind = await add(1.5, 10.5);
    const corner = await add(28.5, 1.5, "walltorch");
    const crate = await add(8.5, 10.5, "crate");
    const toggle = (c: Client, objectId: string, lit: boolean) => c.mutation(api.combatVision.toggleLight, { campaignId, objectId, lit });
    const litOf = async (id: string) => (await f.gm.query(api.combatMaps.get, { campaignId, mapId }))!.objects.find((o) => o._id === id)!.lit;

    expect(await toggle(f.player, ahead, false)).toEqual({ lit: false });
    expect(await litOf(ahead)).toBe(false);
    expect(await toggle(f.player, ahead, false)).toEqual({ lit: false }); // a double click changes nothing
    expect(await code(toggle(f.player, behind, false))).toBe("COMBAT_LIGHT_NOT_SEEN");
    expect(await code(toggle(f.player, crate, false))).toBe("INVALID");
    // At night an unlit campfire straight ahead but 7 squares away is dark: not seen now (the other lights are out, so
    // nothing lights it). Switching it at (11, 10) stored it as explored, so this is a fresh scene's campfire.
    const far = await add(12.5, 12.5);
    await toggle(f.gm, behind, false);
    await toggle(f.gm, corner, false);
    await toggle(f.gm, far, false);
    await f.place(f.ashToken, 5, 12, 0);
    await f.setTime(NIGHT);
    expect(await code(toggle(f.player, far, true))).toBe("COMBAT_LIGHT_NOT_SEEN");
    expect(await toggle(f.gm, far, true)).toEqual({ lit: true });
    // Lit, it lights itself: now the player sees it, but from 7 squares away it is out of reach (B4) until Ash walks up.
    expect(await code(toggle(f.player, far, false))).toBe("COMBAT_OUT_OF_REACH");
    await f.place(f.ashToken, 11, 12, 0);
    expect(await toggle(f.player, far, false)).toEqual({ lit: false });

    // Seen once (explored), then out of sight: still allowed, from next to it (Ash at (2, 10), its back to it).
    await f.setTime(DAY);
    await f.place(f.ashToken, 5, 10, 0);
    await f.player.mutation(api.combatTokens.turn, { campaignId, tokenId: f.ashToken, angle: Math.PI });
    await f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: "_".repeat(400) });
    await f.player.mutation(api.combatTokens.turn, { campaignId, tokenId: f.ashToken, angle: 0 });
    expect(await code(toggle(f.player, behind, true))).toBe("COMBAT_OUT_OF_REACH");
    await f.place(f.ashToken, 2, 10, 0);
    expect(await toggle(f.player, behind, true)).toEqual({ lit: true });
    expect(await litOf(behind)).toBe(true);
    // The GM switches anything; a player never on a map that is not live.
    expect(await toggle(f.gm, corner, true)).toEqual({ lit: true });
    await f.gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() }).then(({ mapId: other }) =>
      f.gm.mutation(api.combatMaps.setLive, { campaignId, mapId: other }),
    );
    expect(await code(toggle(f.player, ahead, true))).toBe("COMBAT_MAP_NOT_FOUND");
  });

  it("a player switches a light only from Melee: adjacent or diagonal, never 2 away; the GM from anywhere (B4)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const { objectId: fire } = await f.gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 12.5, y: 10.5 });
    const toggle = (c: Client, lit: boolean) => c.mutation(api.combatVision.toggleLight, { campaignId, objectId: fire, lit });
    // Seen from (10, 10), 2 squares away: refused with the code only (no position).
    await f.place(f.ashToken, 10, 10, 0);
    const refusal = await toggle(f.player, false).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(refusal)).toBe("COMBAT_OUT_OF_REACH");
    expect(Object.keys(errorData(refusal) as object).sort()).toEqual(["code"]);
    // Diagonal (11, 9), facing it: ok.
    await f.place(f.ashToken, 11, 9, Math.PI / 4);
    expect(await toggle(f.player, false)).toEqual({ lit: false });
    // Standing on it: ok.
    await f.place(f.ashToken, 12, 10, 0);
    expect(await toggle(f.player, true)).toEqual({ lit: true });
    // The GM is never limited.
    await f.place(f.ashToken, 5, 10, 0);
    expect(await toggle(f.gm, false)).toEqual({ lit: false });
  });

  it("a light the player switched stays theirs to switch after they turn away (B4, as dcm-bxp.121 for doors)", async () => {
    const f = await withScene();
    const { campaignId, mapId } = f;
    const { objectId: fire } = await f.gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 12.5, y: 10.5 });
    const toggle = (lit: boolean) => f.player.mutation(api.combatVision.toggleLight, { campaignId, objectId: fire, lit });
    // Ash looks at the campfire from next to it; nothing is explored (no markExplored).
    await f.place(f.ashToken, 11, 10, 0);
    expect(await f.player.query(api.combatVision.explored, { campaignId, characterId: f.ash })).toMatchObject({ bits: expect.any(String) });
    expect(await toggle(false)).toEqual({ lit: false });
    // Ash turns west: the campfire is behind, out of the cone, and out (so nothing lights it either).
    await f.place(f.ashToken, 11, 10, Math.PI);
    expect(await toggle(true)).toEqual({ lit: true });
    // Only the light's samples were stored: its centre's, at most a handful.
    const row = await f.player.query(api.combatVision.explored, { campaignId, characterId: f.ash });
    const mask = decodeExplored(row!.bits, row!.length);
    const sw = 30 * 2;
    expect(mask[21 * sw + 25]).toBe(1);
    expect(mask.reduce((n, b) => n + b, 0)).toBeLessThanOrEqual(16);
  });
});

describe("combat vision: cost on the largest map", () => {
  useAllowlist();

  it("computes playerView within Convex limits on 44 x 32 with 300 objects and 80 tokens", async () => {
    const f = await withScene();
    const { t, campaignId, mapId } = f;
    await t.run(async (c) => {
      await c.db.patch("combatMaps", mapId, {
        w: 44,
        h: 32,
        areas: [
          { terrain: "wall", shape: "border", width: 1 },
          { terrain: "water", shape: "ellipse", x: 22, y: 16, rx: 5, ry: 3 },
          { terrain: "wall", shape: "rect", x: 30, y: 4, w: 1, h: 10 },
          { terrain: "stone", shape: "path", points: [[2, 2], [40, 30]], width: 2 },
        ],
      });
      // 300 objects: 100 trees, 50 boulders, 60 bushes, 40 crates, 25 lit campfires, 25 lit wall torches.
      const kinds = [
        ...Array<"tree">(100).fill("tree"),
        ...Array<"boulder">(50).fill("boulder"),
        ...Array<"bush">(60).fill("bush"),
        ...Array<"crate">(40).fill("crate"),
        ...Array<"campfire">(25).fill("campfire"),
        ...Array<"walltorch">(25).fill("walltorch"),
      ];
      for (let i = 0; i < kinds.length; i++) {
        await c.db.insert("combatMapObjects", { mapId, kind: kinds[i]!, x: 1.5 + ((i * 7) % 41), y: 1.5 + ((i * 11) % 29), r: 0.6, rot: 0 });
      }
      // 78 more tokens (80 with the party), every 7th carrying a torch.
      for (let i = 0; i < 78; i++) {
        await c.db.insert("combatTokens", {
          campaignId,
          mapId,
          ref: { kind: "custom", name: `Foe ${i}`, hp: 0, hpMax: 3, stress: 0, stressMax: 0, conditions: [] },
          side: i % 3 === 0 ? "ally" : "enemy",
          x: (i * 5) % 43,
          y: (i * 3) % 31,
          size: i % 13 === 0 ? 2 : 1,
          face: 0,
          light: i % 7 === 0 ? "torch" : "none",
          revealedTo: [],
        });
      }
    });
    await f.place(f.ashToken, 21, 15, 0);
    await f.player.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: f.ashToken, light: "torch" });
    // Instinct +4 gives the widest cone (130 degrees).
    await t.run(async (c) => {
      const row = (await c.db.get("characters", f.ash))!;
      await c.db.patch("characters", f.ash, { sheet: { ...row.sheet, traits: { ...row.sheet.traits, instinct: 4 } } });
    });

    const timings: Record<string, number> = {};
    for (const [label, time] of [
      ["day", DAY],
      ["night", NIGHT],
    ] as const) {
      await f.setTime(time);
      const runs: number[] = [];
      let bytes = 0;
      let shown = 0;
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        const v = await f.okView();
        runs.push(performance.now() - start);
        bytes = JSON.stringify(v).length;
        shown = v.others.length;
        expect(v.coneDeg).toBe(130);
      }
      runs.sort((a, b) => a - b);
      timings[label] = runs[3]!;
      console.info(`playerView ${label}: median ${runs[3]!.toFixed(1)} ms, max ${runs[6]!.toFixed(1)} ms, ${bytes} bytes, ${shown} other tokens shown`);
    }
    const start = performance.now();
    await f.player.mutation(api.combatVision.markExplored, { campaignId, mapId, characterId: f.ash, bits: "_".repeat(939) });
    console.info(`markExplored: ${(performance.now() - start).toFixed(1)} ms`);
    // Convex gives a query 1 s of execution; the whole call (convex-test overhead included) stays far below.
    expect(timings.day!).toBeLessThan(500);
    expect(timings.night!).toBeLessThan(500);
  });
});
