import { api } from "../../../convex/_generated/api";
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../../convex/lib/characterSheet";
import { PLACEABLE_KINDS } from "../../../src/components/combat-map/editor/edit-model";
import type { Area, Entry, Outcome, Role, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: combat (combatMaps, combatMapEdit, combatMapGenerate, combatMapStyle, combatTokens, combatVision,
 * spritePacks). Filled by tracer H11 (.omc/plans/d12-hardening.yaml; beads dcm-bxp.51, dcm-bxp.88). combatActions and
 * combatRequests added by CA3 (.omc/plans/combat-actions.yaml); their content checks are in combat-attack*.test.ts.
 *
 * The area's setup gives every world a live medium map (the campaign's first map is live at once), characterA's PC
 * token at (5, 10) facing east, characterB's at (5, 14), a custom enemy token at (15, 10), and a closed door at
 * (8.5, 10.5) and a campfire at (7.5, 10.5), both in characterA's view. So the player rows of the player-facing
 * functions (playerView, explored, markExplored, move, turn, setCarriedLight, toggleLight, doors, toggleDoor,
 * spriteSources) act on the live map, with the player's own token and objects their character sees. A player switches
 * a door or light only from Melee (plan d12-bugs B4), so the toggleLight and toggleDoor rows first step characterA's
 * token to (7, 10): on the campfire's square and next to the door, still facing both (`inReach`).
 *
 * Domain refusals a player meets past the access check (COMBAT_NOT_YOUR_TOKEN, COMBAT_MAP_NOT_FOUND on a map that is
 * not live, COMBAT_OBJECT_NOT_FOUND for an unseen door, COMBAT_LIGHT_NOT_SEEN, COMBAT_OUT_OF_REACH) are not matrix
 * outcomes; combat.test.ts, combat-doors.test.ts and combat-vision.test.ts
 * asserts them, together with what the players' reads leave out (other maps, unseen tokens and doors, adversary
 * stats, GM packs and sprite labels).
 */

/** A GM-only change on a resource the gm wrapper does not guard (`generate`, a userAction with its own GM check). */
const GM_ONLY: Partial<Record<Role, Outcome>> = { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", player: "FORBIDDEN", gm: "ok" };

export async function setup(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const campaignId = w.campaignId;
  const ids = await w.t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, face: 0, light: "none" as const, revealedTo: [] };
    const tokenA = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10 });
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 5, y: 14 });
    const custom = await ctx.db.insert("combatTokens", {
      ...token,
      ref: { kind: "custom", name: "Goblin", hp: 0, hpMax: 3, stress: 0, stressMax: 0, conditions: [] },
      side: "enemy",
      x: 15,
      y: 10,
      face: Math.PI,
    });
    const door = await ctx.db.insert("combatMapObjects", { mapId, kind: "door", x: 8.5, y: 10.5, r: 1, rot: 0 });
    const campfire = await ctx.db.insert("combatMapObjects", { mapId, kind: "campfire", x: 7.5, y: 10.5, r: 0.5, rot: 0 });
    return { tokenA, custom, door, campfire };
  });
  w.set("mapId", mapId);
  w.set("customTokenId", ids.custom);
  w.set("campfireId", ids.campfire);
  w.use("combatTokens", ids.tokenA);
  w.use("combatMapObjects", ids.door);
}

/** characterA's token steps next to the setup's door and onto its campfire's square (B4: Melee), facing east. */
async function inReach(w: World) {
  const characterA = w.characterA;
  await w.t.run(async (ctx) => {
    const tokens = await ctx.db
      .query("combatTokens")
      .withIndex("by_map", (q) => q.eq("mapId", w.ids.mapId as Id<"combatMaps">))
      .collect();
    const token = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === characterA)!;
    await ctx.db.patch(token._id, { x: 7, y: 10, face: 0 });
  });
}

/** A file stored directly (no upload URL), unclaimed: the `_storage` row synthesis uses. */
async function storedFile(w: World) {
  const storageId = await w.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  // `use` is typed for user tables; synthesis looks the chosen id up before touching the table.
  w.use("_storage" as TableNames, storageId);
}

/** The live map made from an uploaded image (a claimed `combatMap` file and a 40 px grid), for `setGrid`. */
async function imageMap(w: World) {
  const mapId = w.ids.mapId as Id<"combatMaps">;
  const campaignId = w.campaignId;
  const gm = w.users.gm;
  await w.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["img"], { type: "image/png" }));
    const fileId = await ctx.db.insert("files", { storageId, campaignId, uploadedBy: gm, kind: "combatMap", refId: mapId, createdAt: 0 });
    await ctx.db.patch(mapId, { source: "image", image: { fileId, grid: { cell: 40, offsetX: 0, offsetY: 0 } } });
  });
}

/** A GM pack of the campaign. */
async function pack(w: World) {
  const campaignId = w.campaignId;
  const gm = w.users.gm;
  const packId = await w.t.run((ctx) => ctx.db.insert("spritePacks", { campaignId, name: "Moors", extends: "forest", createdBy: gm, createdAt: 0, updatedAt: 0 }));
  w.set("packId", packId);
}

/** Two uploaded sprites in the pack (so `reorderSprite` has a neighbour); the first is the one synthesis picks. */
export async function sprites(w: World) {
  await pack(w);
  const campaignId = w.campaignId;
  const packId = w.ids.packId as Id<"spritePacks">;
  const gm = w.users.gm;
  const first = await w.t.run(async (ctx) => {
    const ids = [];
    for (const [order, name] of ["Standing stone", "Cairn"].entries()) {
      const storageId = await ctx.storage.store(new Blob(["img"], { type: "image/webp" }));
      const fileId = await ctx.db.insert("files", { storageId, campaignId, uploadedBy: gm, kind: "sprite", refId: "pending", createdAt: 0 });
      const spriteId = await ctx.db.insert("spritePackSprites", {
        campaignId,
        packId,
        fileId,
        name,
        slug: name.toLowerCase().replace(/ /g, "-"),
        category: "object",
        w: 1,
        h: 1,
        sight: "block",
        light: "none",
        height: "tall",
        footprint: "circle",
        classicKind: "pillar",
        px: { w: 160, h: 160 },
        order,
        createdAt: 0,
      });
      await ctx.db.patch(fileId, { refId: spriteId });
      ids.push(spriteId);
    }
    return ids[0]!;
  });
  w.use("spritePackSprites", first);
}

const maps: Entry[] = [
  { fn: api.combatMaps.list, access: "gm" },
  { fn: api.combatMaps.get, access: "gm" },
  // Players read only the live map's layout (without the GM's prompt); combat.test.ts checks the content.
  { fn: api.combatMaps.live, access: "view", expect: { otherPlayer: "ok" } },
  { fn: api.combatMaps.tokenCount, access: "gm" },
  { fn: api.combatMaps.create, access: "gm", args: () => ({ size: "small" }) },
  { fn: api.combatMaps.rename, access: "gm", args: () => ({ name: "Renamed" }) },
  { fn: api.combatMaps.setLive, access: "gm" },
  { fn: api.combatMaps.duplicate, access: "gm" },
  { fn: api.combatMaps.remove, access: "gm" },
  // Covered for access only: no blob goes through an upload URL.
  { fn: api.combatMaps.imageUploadUrl, access: "gm" },
  // convex-test files carry no content type, so the GM's attach resolves with { ok: false }, which still proves access.
  { fn: api.combatMaps.attachImage, access: "gm", setup: storedFile, args: () => ({ width: 1200, height: 800 }) },
  {
    fn: api.combatMaps.setGrid,
    access: "gm",
    setup: imageMap,
    args: () => ({ grid: { cell: 40, offsetX: 0, offsetY: 0 }, imageWidth: 1200, imageHeight: 800 }),
  },
];

const edit: Entry[] = [
  { fn: api.combatMapEdit.paintCells, access: "gm", args: () => ({ squares: [0, 1], paint: "wall" }) },
  { fn: api.combatMapEdit.clearPaint, access: "gm", args: () => ({ layer: "terrain" }) },
  { fn: api.combatMapEdit.addObject, access: "gm", args: () => ({ kind: PLACEABLE_KINDS[0], x: 3, y: 3 }) },
  { fn: api.combatMapEdit.moveObject, access: "gm", args: () => ({ x: 9.5, y: 4.5 }) },
  { fn: api.combatMapEdit.removeObject, access: "gm" },
  { fn: api.combatMapEdit.setObjectSight, access: "gm", args: () => ({ sight: "cover" }) },
  { fn: api.combatMapEdit.updateObject, access: "gm", args: () => ({ rot: 1 }) },
];

const generate: Entry[] = [
  // Without ANTHROPIC_API_KEY the keyword layout is drawn; COMBAT_GENERATE_UNAVAILABLE (no layout at all) still means
  // the GM got through.
  {
    fn: api.combatMapGenerate.generate,
    access: "scoped",
    setup: async () => void delete process.env.ANTHROPIC_API_KEY,
    args: () => ({ prompt: "A forest clearing with a campfire", size: "small" }),
    okCodes: ["COMBAT_GENERATE_UNAVAILABLE"],
    expect: GM_ONLY,
  },
  { fn: api.combatMapGenerate.stop, access: "gm" },
];

const style: Entry[] = [
  { fn: api.combatMapStyle.setStyle, access: "gm", args: () => ({ style: "sprites" }) },
  { fn: api.combatMapStyle.setSetting, access: "gm", args: () => ({ setting: { builtin: "forest" } }) },
  { fn: api.combatMapStyle.settings, access: "gm" },
  // Every member on the live map (players: only the sprites the map references, unlabelled; combat.test.ts).
  { fn: api.combatMapStyle.spriteSources, access: "view", expect: { otherPlayer: "ok" } },
];

const tokens: Entry[] = [
  { fn: api.combatTokens.list, access: "gm" },
  // Players get the PC tokens only (never an adversary's stats); combat.test.ts checks the content.
  { fn: api.combatTokens.party, access: "view", expect: { otherPlayer: "ok" } },
  { fn: api.combatTokens.combatants, access: "gm" },
  { fn: api.combatTokens.sessionEncounter, access: "gm" },
  { fn: api.combatTokens.addParty, access: "gm" },
  // No running encounter in the world: the GM gets ENCOUNTER_NOT_RUNNING past the access check.
  { fn: api.combatTokens.placeAdversaries, access: "gm", args: () => ({ instanceIds: ["x"] }), okCodes: ["ENCOUNTER_NOT_RUNNING"] },
  // No session with a linked encounter: the GM gets SESSION_NO_ENCOUNTER past the access check.
  { fn: api.combatTokens.placeSessionEncounter, access: "gm", okCodes: ["SESSION_NO_ENCOUNTER"] },
  { fn: api.combatTokens.addCustom, access: "gm", args: () => ({ name: "Wolf", hp: 4, side: "enemy" }) },
  { fn: api.combatTokens.rename, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId, name: "Hobgoblin" }) },
  { fn: api.combatTokens.setSide, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId, side: "ally" }) },
  { fn: api.combatTokens.setSize, access: "gm", args: () => ({ size: 2 }) },
  { fn: api.combatTokens.markCustom, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId, track: "hp", delta: 1 }) },
  { fn: api.combatTokens.toggleCustomCondition, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId, condition: "vulnerable" }) },
  { fn: api.combatTokens.remove, access: "gm" },
  { fn: api.combatTokens.clear, access: "gm" },
  // The player moves and turns their own PC's token on the live map (another's: COMBAT_NOT_YOUR_TOKEN, combat.test.ts).
  { fn: api.combatTokens.move, access: "view", args: () => ({ x: 6, y: 10 }) },
  { fn: api.combatTokens.turn, access: "view", args: () => ({ angle: 1 }) },
];

const vision: Entry[] = [
  // The player's own character's view of the live map; the other player's of theirs; the GM has no token (noCharacter).
  { fn: api.combatVision.playerView, access: "view", expect: { otherPlayer: "ok" } },
  { fn: api.combatVision.previewAs, access: "gm" },
  { fn: api.combatVision.explored, access: "view" },
  { fn: api.combatVision.markExplored, access: "view", args: () => ({ bits: "" }) },
  { fn: api.combatVision.forgetExplored, access: "gm" },
  { fn: api.combatVision.revealTo, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId }) },
  { fn: api.combatVision.unrevealTo, access: "gm", args: (w) => ({ tokenId: w.ids.customTokenId }) },
  { fn: api.combatVision.setCarriedLight, access: "view", args: () => ({ light: "torch" }) },
  { fn: api.combatVision.toggleLight, access: "view", setup: inReach, args: (w) => ({ objectId: w.ids.campfireId, lit: false }) },
  // The player lists and switches only doors their character has seen (the setup's door is in view), from Melee (B4).
  { fn: api.combatVision.doors, access: "view", expect: { otherPlayer: "ok" } },
  { fn: api.combatVision.toggleDoor, access: "view", setup: inReach, args: () => ({ open: true }) },
  { fn: api.combatVision.paintFog, access: "gm", args: () => ({ squares: [0], mark: "reveal" }) },
];

const packs: Entry[] = [
  { fn: api.spritePacks.packs, access: "gm" },
  { fn: api.spritePacks.createPack, access: "gm", args: () => ({ name: "Moors", extends: "forest" }) },
  { fn: api.spritePacks.renamePack, access: "gm", setup: pack, args: () => ({ name: "Fens" }) },
  { fn: api.spritePacks.setPackExtends, access: "gm", setup: pack, args: () => ({ extends: null }) },
  { fn: api.spritePacks.deletePack, access: "gm", setup: pack },
  // Covered for access only: no blob goes through an upload URL.
  { fn: api.spritePacks.spriteUploadUrl, access: "gm" },
  {
    fn: api.spritePacks.attachSprite,
    access: "gm",
    setup: async (w) => {
      await pack(w);
      await storedFile(w);
    },
    args: () => ({
      name: "Standing stone",
      category: "object",
      w: 1,
      h: 1,
      sight: "block",
      light: "none",
      height: "tall",
      footprint: "circle",
      classicKind: "pillar",
      px: { w: 160, h: 160 },
    }),
  },
  { fn: api.spritePacks.updateSprite, access: "gm", setup: sprites, args: () => ({ patch: { name: "Menhir" } }) },
  { fn: api.spritePacks.removeSprite, access: "gm", setup: sprites },
  { fn: api.spritePacks.reorderSprite, access: "gm", setup: sprites, args: () => ({ direction: "down" }) },
];

/**
 * Weapon attacks (plan combat-actions CA3): a running encounter with a Minion pack ("Minion (1)", Difficulty 1) next to
 * characterA's token at (6, 10), so every attack hits and offers extra Minions, and an archer at (8, 10), out of melee
 * range, so an attack on it waits for the GM. Registers `packId`, `packToken`, `archerToken`.
 */
async function arena(w: World) {
  const { campaignId } = w;
  const mapId = w.ids.mapId as Id<"combatMaps">;
  const now = Date.now();
  const ids = await w.t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const customId = await ctx.db.insert("customAdversaries", {
      campaignId,
      name: "Rat",
      tier: 1,
      type: "Minion",
      description: "",
      motives: "",
      difficulty: 1,
      thresholds: { major: null, severe: null },
      hp: 1,
      stress: 1,
      attack: { modifier: 0, name: "Bite", range: "Melee", damage: "1 phy" },
      experiences: [],
      features: [{ name: "Minion (1)", kind: "passive", text: "" }],
      createdAt: now,
      updatedAt: now,
    });
    const base = { campaignId, encounterId, summoned: false, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now };
    const pack = await ctx.db.insert("encounterAdversaries", {
      ...base,
      source: { kind: "custom", customId },
      label: "Rats",
      order: 0,
      minionCount: 6,
      stats: { difficulty: 1, major: null, severe: null, hpMax: 6, stressMax: 1 },
    });
    const archer = await ctx.db.insert("encounterAdversaries", {
      ...base,
      source: { kind: "srd", adversaryId: "bear" },
      label: "Archer",
      order: 1,
      stats: { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 1 },
    });
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [], side: "enemy" as const, face: Math.PI };
    const packToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: pack }, x: 6, y: 10 });
    const archerToken = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: archer }, x: 8, y: 10 });
    return { pack, packToken, archerToken };
  });
  w.set("packId", ids.pack);
  w.set("packToken", ids.packToken);
  w.set("archerToken", ids.archerToken);
}

function attackArgs(w: World, target: string) {
  return {
    characterId: w.characterA,
    mapId: w.ids.mapId,
    targetTokenIds: [target],
    slot: "primary",
    modifier: 0,
    experienceIds: [],
    advantage: 0,
    disadvantage: 0,
    help: 0,
    options: [],
  };
}

/** characterA's player attacks the pack: a resolved attack with a Minion offer (`entryId`). */
async function attacked(w: World) {
  await arena(w);
  const r = await w.as("player").mutation(api.combatActions.attack, { campaignId: w.campaignId, idempotencyKey: freshKey(), ...attackArgs(w, w.ids.packToken!) } as never);
  if (r.status !== "resolved" || r.minionOffer === null) throw new Error("expected a resolved attack with a Minion offer");
  w.set("entryId", r.entryId);
}

/** characterA's player attacks the archer out of range: an open sanction (`requestId`). */
async function sanctioned(w: World) {
  await arena(w);
  const r = await w.as("player").mutation(api.combatActions.attack, { campaignId: w.campaignId, idempotencyKey: freshKey(), ...attackArgs(w, w.ids.archerToken!) } as never);
  if (r.status !== "pending") throw new Error("expected a pending attack");
  w.set("requestId", r.requestId);
}

// Another player acting for characterA is refused by `loadCharacter` (edit on the character).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;

const attacks: Entry[] = [
  // One target only (CA4b, bead dcm-bxp.99.18): two are COMBAT_TARGET_INVALID after the access check (combat-attack.test.ts).
  { fn: api.combatActions.attack, access: "view", setup: arena, args: (w) => attackArgs(w, w.ids.packToken!), expect: NOT_THEIRS },
  { fn: api.combatActions.targets, access: "view", setup: arena, args: (w) => ({ characterId: w.characterA, mapId: w.ids.mapId }), expect: NOT_THEIRS },
  { fn: api.combatActions.pickMinions, access: "view", setup: attacked, args: (w) => ({ entryId: w.ids.entryId, instanceIds: [w.ids.packId] }), expect: NOT_THEIRS },
  { fn: api.combatRequests.sanction, access: "gm", setup: sanctioned, args: (w) => ({ requestId: w.ids.requestId, approve: false }) },
  { fn: api.combatRequests.mine, access: "view", setup: sanctioned, expect: { otherPlayer: "ok" } },
];

/**
 * Domain cards (plan combat-actions CA4): characterA holds Cinder Grasp (a melee spell) in the `arena` above, so a use
 * on the pack resolves and a use on the archer waits for the GM. Content checks: combat-cards*.test.ts.
 */
async function holdingCards(w: World) {
  await arena(w);
  const characterA = w.characterA;
  await w.t.run(async (ctx) => {
    const sheet = readSheet((await ctx.db.get("characters", characterA))!.sheet);
    await saveSheet(ctx, characterA, { ...sheet, domainCards: { owned: ["cinder-grasp"], loadout: ["cinder-grasp"] } });
  });
}

function cardArgs(w: World, target: string) {
  return { characterId: w.characterA, mapId: w.ids.mapId, cardId: "cinder-grasp", targetTokenIds: [target], choices: [] };
}

/** characterA's player casts Cinder Grasp at the archer, out of melee: an open card sanction (`requestId`). */
async function cardSanctioned(w: World) {
  await holdingCards(w);
  const r = await w.as("player").mutation(api.combatCards.useCard, { campaignId: w.campaignId, idempotencyKey: freshKey(), ...cardArgs(w, w.ids.archerToken!) } as never);
  if (r.status !== "pending") throw new Error("expected a pending card use");
  w.set("requestId", r.requestId);
}

const cards: Entry[] = [
  // The GM may play for any character (user answer 2026-10-22); another player is refused by `loadCharacter` (edit).
  // CA4b changed no access: kept dice and range origins act after the access check (combat-cards.test.ts).
  { fn: api.combatCards.useCard, access: "view", setup: holdingCards, args: (w) => cardArgs(w, w.ids.packToken!), expect: NOT_THEIRS },
  // F7-H4: another player reads the hand while hands are shared (the default); switch off / hidden: combat-cards-authz.test.ts.
  { fn: api.combatCards.hand, access: "view", setup: holdingCards, args: (w) => ({ characterId: w.characterA }), expect: { otherPlayer: "ok" } },
  { fn: api.combatCards.handSharing, access: "view", expect: { otherPlayer: "ok" } },
  { fn: api.combatCards.setHandHidden, access: "view", args: (w) => ({ characterId: w.characterA, hidden: true }), expect: NOT_THEIRS },
  { fn: api.combatCards.sanction, access: "gm", setup: cardSanctioned, args: (w) => ({ requestId: w.ids.requestId, approve: false }) },
  { fn: api.combatCards.pending, access: "view", setup: cardSanctioned, expect: { otherPlayer: "ok" } },
];

const area: Area = {
  area: "combat",
  setup,
  entries: [...maps, ...edit, ...generate, ...style, ...tokens, ...vision, ...packs, ...attacks, ...cards],
};

export default area;
