import { api } from "../../../convex/_generated/api";
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import { INITIAL_COMPANION } from "../../../src/lib/frames/extras/companion";
import { characterDraft } from "../../fixtures/characters";
import { freshKey } from "./synth";
import type { Area, World } from "./harness";
import type { WorldOptions } from "./world";

/**
 * Authz matrix: characters (characters, characterExtras). Filled by tracer H7 (.omc/plans/d12-hardening.yaml).
 *
 * `own` rows: `player` (playerA) acts on characterA, their own; `otherPlayer` (playerB) acts on characterA too, so the
 * pair is bead .64's "player owner / player non-owner". Party members view each other's characters (rolePermission
 * gives a player `view` on a character they don't own), so reads stay ok for otherPlayer and writes are FORBIDDEN.
 * GM-only functions on a character (`loadCharacter(..., "owner")`: setTrait, assignOwner, remove, repairCompanion) are
 * `own` with `player: "FORBIDDEN"`.
 *
 * okCodes: a domain code thrown after the access check (`editable` / `loadCharacter` / the extras' `load` run first)
 * still means access was granted; used where a valid call needs state the matrix does not build (scrap, a lost
 * companion, a free Domain Deck pick).
 */

// ---------------------------------------------------------------- frame worlds

const IKONIS = { name: "Spark rod", description: "", trait: "strength", range: "Melee", damageType: "physical" } as const;

/** Motherboard (CB 295, 301-303) with Beastbound rangers: the Ikonis module, the companion and the Corruption Track apply. */
const MOTHERBOARD_RANGER: WorldOptions = {
  frameId: "motherboard",
  classId: "ranger",
  characterArgs: (who) => ({
    ikonis: IKONIS,
    draft: { ...characterDraft(who === "player" ? "Ash" : "Bryn", "ranger"), subclassId: "beastbound", primaryWeaponId: "" },
  }),
};
const DRUID: WorldOptions = { classId: "druid" };
const BEAST_FEAST: WorldOptions = { frameId: "beast-feast" };
const CASTLE_HIGH: WorldOptions = { frameId: "castle-high" };

// ---------------------------------------------------------------- helpers

/** characterA's stored sheet (the fields entries need). */
async function sheetA(w: World) {
  return w.t.run(async (ctx) => {
    const row = await ctx.db.get("characters", w.characterA);
    return row!.sheet as { experiences: { id: string }[]; domainCards: { loadout: string[] } };
  });
}

/** An unclaimed uploaded image, picked for `attachPortrait`'s `v.id("_storage")`. */
async function uploadedImage(w: World) {
  const storageId: Id<"_storage"> = await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" })));
  w.use("_storage" as TableNames, storageId);
}

/** playerA retires characterA, so creating another passes the one-active-character rule (X6). */
async function retireA(w: World) {
  await w.as("player").mutation(api.characters.setStatus, { characterId: w.characterA, status: "retired" });
}

/** playerA adds a recipe to the party cookbook (Beast Feast); its id becomes `entryId`. */
async function recipeByPlayer(w: World) {
  const entry = { name: "Root stew", description: "Bitter.", ingredients: ["Rileroot"], profile: { bitter: 2 }, mealRating: 4 };
  await w.as("player").mutation(api.characterExtras.addCookbookEntry, { campaignId: w.campaignId, entry, idempotencyKey: freshKey() });
  const view = await w.as("gm").query(api.characterExtras.get, { characterId: w.characterA });
  w.set("entryId", view.cookbook![0]!.id);
}

const area: Area = {
  area: "characters",
  nameHints: { entryId: (w) => w.ids.entryId },
  entries: [
    // ---------------------------------------------------------------- characters: party and creation
    { fn: api.characters.listByCampaign, access: "view" },
    {
      fn: api.characters.create,
      access: "view",
      args: () => ({ draft: characterDraft("Cass") }),
      setup: retireA,
      note: "playerA retires characterA first (one active character per player); the GM's own characters are exempt",
    },
    {
      fn: api.characters.assignOwner,
      access: "own",
      expect: { player: "FORBIDDEN" },
      note: "GM only: loadCharacter(..., 'owner'); ownerId is playerA (already the owner)",
    },

    // ---------------------------------------------------------------- characters: sheet intents (owner or GM)
    { fn: api.characters.updateSheet, access: "own", args: () => ({ patch: { notes: "Matrix" } }) },
    { fn: api.characters.adjustGold, access: "own", args: () => ({ coin: "handfuls", delta: 1 }), note: "delta 0 is INVALID before the access check" },
    { fn: api.characters.setGoldChest, access: "own", args: () => ({ chest: true }) },
    {
      fn: api.characters.setTrait,
      access: "own",
      args: () => ({ trait: "agility", value: 1 }),
      expect: { player: "FORBIDDEN" },
      note: "GM only by design: players change traits through level-up (user 2026-10-18; loadCharacter(..., 'owner'))",
    },
    { fn: api.characters.addInventory, access: "own", args: () => ({ name: "Lantern" }) },
    { fn: api.characters.removeInventory, access: "own" },
    { fn: api.characters.addExperience, access: "own", args: () => ({ name: "Matrix" }) },
    { fn: api.characters.setExperience, access: "own", args: async (w) => ({ experienceId: (await sheetA(w)).experiences[0]!.id, value: 3 }) },
    { fn: api.characters.removeExperience, access: "own" },
    { fn: api.characters.adjustResource, access: "own", args: () => ({ resource: "stress", delta: 1 }), note: "delta 0 is INVALID before the access check" },
    { fn: api.characters.toggleCondition, access: "own", note: "bead dcm-bxp.51: owner or GM, used by the Combat Map token card" },
    {
      fn: api.characters.applyDamage,
      access: "own",
      args: () => ({ damage: 1, useArmorSlot: false, negateMinor: true }),
      okCodes: ["CLASS_FEATURE_RULE"],
      note: "bead dcm-bxp.64: the negateMinor path; with no New moon the owner and GM get CLASS_FEATURE_RULE after the access check",
    },
    {
      fn: api.characters.moveCard,
      access: "own",
      args: async (w) => ({ cardId: (await sheetA(w)).domainCards.loadout[0]!, to: "vault" }),
      note: "CA4b: the GM moves / recalls for any character of the campaign, logged as the GM for it (characters.test.ts)",
    },
    {
      fn: api.characters.takeCard,
      access: "own",
      okCodes: ["INVALID"],
      note: "a level-1 character has no Domain Deck pick left, so the owner and GM get INVALID after the access check",
    },
    { fn: api.characters.setStatus, access: "own", args: () => ({ status: "retired" }) },
    { fn: api.characters.remove, access: "own", expect: { player: "FORBIDDEN" }, note: "GM only: loadCharacter(..., 'owner')" },

    // ---------------------------------------------------------------- characters: portraits
    { fn: api.characters.portraitUploadUrl, access: "own" },
    { fn: api.characters.attachPortrait, access: "own", setup: uploadedImage },
    { fn: api.characters.portraitUrl, access: "own" },

    // ---------------------------------------------------------------- characterExtras: reads
    { fn: api.characterExtras.get, access: "own" },
    { fn: api.characterExtras.corruption, access: "own", world: MOTHERBOARD_RANGER },
    { fn: api.characterExtras.augmentSwapOpen, access: "own", world: MOTHERBOARD_RANGER },

    // ---------------------------------------------------------------- characterExtras: class extras
    { fn: api.characterExtras.setBeastform, access: "own", world: DRUID, args: () => ({ state: { formId: "agile-scout" } }) },
    { fn: api.characterExtras.saveCompanion, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ state: { ...INITIAL_COMPANION, name: "Bolt" } }) },
    { fn: api.characterExtras.setCompanionRemnant, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ remnant: true }) },
    {
      fn: api.characterExtras.repairCompanion,
      access: "own",
      world: MOTHERBOARD_RANGER,
      expect: { player: "FORBIDDEN" },
      okCodes: ["EXTRA_RULE"],
      note: "GM only (CB 295, a technomancer's repair); with no Corruption marked the GM gets EXTRA_RULE after the access check",
    },
    {
      fn: api.characterExtras.replaceCompanion,
      access: "own",
      world: MOTHERBOARD_RANGER,
      okCodes: ["EXTRA_RULE"],
      note: "the companion is not lost, so the owner and GM get EXTRA_RULE after the access check",
    },

    // ---------------------------------------------------------------- characterExtras: Motherboard module
    { fn: api.characterExtras.saveIkonis, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ ikonis: IKONIS }) },
    { fn: api.characterExtras.gatherScrap, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ shards: 1, metals: 0, components: 0 }), note: "zero dice is INVALID before the access check" },
    {
      fn: api.characterExtras.tradeScrap,
      access: "own",
      world: MOTHERBOARD_RANGER,
      args: () => ({ name: "Silver", quantity: 1, direction: "buy" }),
      okCodes: ["EXTRA_RULE"],
      note: "5 starting quantum may not cover the price: EXTRA_RULE after the access check",
    },
    { fn: api.characterExtras.addRelic, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ name: "Steelhorn" }) },
    { fn: api.characterExtras.sellRelic, access: "own", world: MOTHERBOARD_RANGER, okCodes: ["EXTRA_RULE"], note: "no relic held: EXTRA_RULE after the access check" },
    { fn: api.characterExtras.craftAugment, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ augmentId: "force" }), okCodes: ["EXTRA_RULE"], note: "no scrap: EXTRA_RULE after the access check" },
    { fn: api.characterExtras.salvageAugment, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ augmentId: "force" }), okCodes: ["EXTRA_RULE"], note: "nothing built: EXTRA_RULE after the access check" },
    { fn: api.characterExtras.installAugments, access: "own", world: MOTHERBOARD_RANGER, okCodes: ["EXTRA_RULE"], note: "no open rest (downtime): EXTRA_RULE after the access check" },
    { fn: api.characterExtras.correctWallet, access: "own", world: MOTHERBOARD_RANGER, args: () => ({ correction: { quantum: 7 } }) },

    // ---------------------------------------------------------------- characterExtras: Beast Feast
    {
      fn: api.characterExtras.addIngredient,
      access: "own",
      world: BEAST_FEAST,
      args: () => ({ ingredient: { name: "Rileroot", flavors: [{ flavor: "bitter", strength: 1 }] } }),
    },
    { fn: api.characterExtras.removeIngredient, access: "own", world: BEAST_FEAST, okCodes: ["EXTRA_RULE"], note: "no such ingredient: EXTRA_RULE after the access check" },
    {
      fn: api.characterExtras.addCookbookEntry,
      access: "view",
      world: BEAST_FEAST,
      args: () => ({ entry: { name: "Root stew", description: "", ingredients: [], profile: { bitter: 1 }, mealRating: null } }),
      note: "any member adds to the party cookbook",
    },
    {
      fn: api.characterExtras.removeCookbookEntry,
      access: "view",
      world: BEAST_FEAST,
      setup: recipeByPlayer,
      expect: { otherPlayer: "FORBIDDEN" },
      note: "playerA's recipe: its author and the GM remove it, another player is FORBIDDEN",
    },

    // ---------------------------------------------------------------- characterExtras: Castle High
    { fn: api.characterExtras.saveSkyshard, access: "own", world: CASTLE_HIGH, args: () => ({ skyshard: { name: "Old broom", description: "" } }) },
  ],
};

export default area;
