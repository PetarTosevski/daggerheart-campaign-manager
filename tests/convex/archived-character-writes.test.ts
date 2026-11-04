import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key } from "./helpers";
import { buildWorld, type Role, type World } from "./authz/world";

/**
 * Bead dcm-jh6d.64: an archived campaign is read-only for everyone (Q9 a), also for the writes that skip the campaign
 * wrappers. Character writes on `userMutation` / `keyedUserMutation` load the character through
 * `loadCharacter` (convex/lib/characterSheet.ts), which refuses an archived campaign in a mutation; the other writes
 * that load their campaign themselves (World map, Codex, countdown operate, undo, invite revocation, the photo import
 * and the combat map generator) refuse it too (`refuseArchived*`, convex/lib/archived.ts). Queries still read, and
 * unarchiving opens writes again. Every refusal asserts `ConvexError.data.code`.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

/** Manual dice: Hope 2, Fear 8. */
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

type Fixture = { entryId: Id<"codexEntries">; countdownId: Id<"countdowns">; inviteId: Id<"campaignInvites">; logEntryId: Id<"actionLog"> };

/** A world with a Codex entry, a countdown, a pending invite and an undoable roll of character A, then archived. */
async function archivedWorld(): Promise<{ w: World; f: Fixture }> {
  const w = await buildWorld();
  const campaignId = w.campaignId;
  const gm = w.as("gm");
  const { entryId } = await gm.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: key() });
  const { countdownId } = await gm.mutation(api.countdowns.create, {
    campaignId,
    name: "The bridge collapses",
    description: "",
    category: "threat",
    startingValue: 3,
    consequence: "The road east is cut off.",
    idempotencyKey: key(),
  });
  const inviteId = await gm.mutation(api.members.invite, { campaignId, email: "late@example.com" });
  await gm.mutation(api.rolls.manualRoll, { characterId: w.characterA, values: [2, 8], roll: agility, idempotencyKey: key() });
  const logEntryId = await w.t.run(async (ctx) => {
    const row = await ctx.db
      .query("actionLog")
      .withIndex("by_character_at", (q) => q.eq("characterId", w.characterA))
      .order("desc")
      .first();
    return row!._id;
  });
  await gm.mutation(api.campaignSettings.archive, { campaignId });
  return { w, f: { entryId, countdownId, inviteId, logEntryId } };
}

/** Each guarded write path, with who would otherwise be allowed to call it. */
const WRITES: { name: string; as: Role; call: (w: World, f: Fixture) => Promise<unknown> }[] = [
  // Character writes through `editable` / `loadCharacter`.
  {
    name: "rolls.manualRoll (player, own character)",
    as: "player",
    call: (w) => w.as("player").mutation(api.rolls.manualRoll, { characterId: w.characterA, values: [2, 8], roll: agility, idempotencyKey: key() }),
  },
  {
    name: "rolls.manualRoll (GM)",
    as: "gm",
    call: (w) => w.as("gm").mutation(api.rolls.manualRoll, { characterId: w.characterA, values: [2, 8], roll: agility, idempotencyKey: key() }),
  },
  { name: "characters.adjustGold", as: "player", call: (w) => w.as("player").mutation(api.characters.adjustGold, { characterId: w.characterA, coin: "handfuls", delta: 1 }) },
  { name: "characters.setGoldChest", as: "player", call: (w) => w.as("player").mutation(api.characters.setGoldChest, { characterId: w.characterA, chest: true }) },
  { name: "characters.addInventory", as: "player", call: (w) => w.as("player").mutation(api.characters.addInventory, { characterId: w.characterA, name: "Lantern" }) },
  { name: "characters.setStatus", as: "gm", call: (w) => w.as("gm").mutation(api.characters.setStatus, { characterId: w.characterA, status: "retired" }) },
  { name: "characters.assignOwner", as: "gm", call: (w) => w.as("gm").mutation(api.characters.assignOwner, { characterId: w.characterA, ownerId: w.users.gm }) },
  { name: "characters.portraitUploadUrl", as: "player", call: (w) => w.as("player").mutation(api.characters.portraitUploadUrl, { characterId: w.characterA }) },
  // Writes that load their campaign themselves.
  { name: "actionLog.undo", as: "gm", call: (w, f) => w.as("gm").mutation(api.actionLog.undo, { entryId: f.logEntryId, idempotencyKey: key() }) },
  { name: "maps.addToken", as: "gm", call: (w) => w.as("gm").mutation(api.maps.addToken, { campaignId: w.campaignId, type: "village", x: 50, y: 50, idempotencyKey: key() }) },
  { name: "maps.mapImageUploadUrl", as: "gm", call: (w) => w.as("gm").mutation(api.maps.mapImageUploadUrl, { campaignId: w.campaignId }) },
  { name: "codex.update", as: "gm", call: (w, f) => w.as("gm").mutation(api.codex.update, { entryId: f.entryId, patch: { name: "Renamed" } }) },
  { name: "countdowns.operate", as: "gm", call: (w, f) => w.as("gm").mutation(api.countdowns.operate, { countdownId: f.countdownId, action: "advance", idempotencyKey: key() }) },
  { name: "members.revokeInvite", as: "gm", call: (w, f) => w.as("gm").mutation(api.members.revokeInvite, { inviteId: f.inviteId }) },
  { name: "photoImport.read", as: "gm", call: (w) => w.as("gm").action(api.photoImport.read, { campaignId: w.campaignId }) },
  {
    name: "combatMapGenerate.generate",
    as: "gm",
    call: (w) => w.as("gm").action(api.combatMapGenerate.generate, { campaignId: w.campaignId, mapId: "none", prompt: "a bridge", size: "small" }),
  },
];

describe("archived campaign: writes outside the campaign wrappers (dcm-jh6d.64)", () => {
  it.each(WRITES)("$name is refused with CAMPAIGN_ARCHIVED", async ({ call }) => {
    const { w, f } = await archivedWorld();
    expect(await fail(call(w, f))).toBe("CAMPAIGN_ARCHIVED");
  });

  it("checks access first: a stranger gets NOT_FOUND and another player FORBIDDEN, never CAMPAIGN_ARCHIVED", async () => {
    const { w } = await archivedWorld();
    const args = { characterId: w.characterA, coin: "handfuls" as const, delta: 1 };
    expect(await fail(w.as("outsider").mutation(api.characters.adjustGold, args))).toBe("NOT_FOUND");
    expect(await fail(w.as("otherPlayer").mutation(api.characters.adjustGold, args))).toBe("FORBIDDEN");
  });

  it("reads go on: the character, its pending choices (an edit load in a query), the map and the Codex", async () => {
    const { w, f } = await archivedWorld();
    expect(await w.as("player").query(api.charactersReads.get, { characterId: w.characterA })).not.toBeNull();
    expect(await w.as("player").query(api.rolls.pendingChoices, { characterId: w.characterA })).toEqual({ slayer: null, tagTeam: null });
    expect(await w.as("player").query(api.maps.get, { campaignId: w.campaignId })).toMatchObject({ role: "player" });
    expect(await w.as("gm").query(api.codex.entryText, { entryId: f.entryId })).toMatchObject({ role: "gm" });
  });

  it("preferences.setFold still works while archived", async () => {
    const { w } = await archivedWorld();
    await w.as("player").mutation(api.preferences.setFold, { campaignId: w.campaignId, characterId: w.characterA, folded: true });
  });

  it("unarchive opens character and campaign writes again", async () => {
    const { w, f } = await archivedWorld();
    await w.as("gm").mutation(api.campaignSettings.unarchive, { campaignId: w.campaignId });
    await w.as("player").mutation(api.rolls.manualRoll, { characterId: w.characterA, values: [2, 8], roll: agility, idempotencyKey: key() });
    await w.as("player").mutation(api.characters.adjustGold, { characterId: w.characterA, coin: "handfuls", delta: 1 });
    await w.as("gm").mutation(api.maps.addToken, { campaignId: w.campaignId, type: "village", x: 50, y: 50, idempotencyKey: key() });
    await w.as("gm").mutation(api.codex.update, { entryId: f.entryId, patch: { name: "Renamed" } });
    await w.as("gm").mutation(api.countdowns.operate, { countdownId: f.countdownId, action: "advance", idempotencyKey: key() });
    await w.as("gm").mutation(api.members.revokeInvite, { inviteId: f.inviteId });
  });
});
