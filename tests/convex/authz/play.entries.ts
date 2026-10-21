import { api } from "../../../convex/_generated/api";
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import { validDraft } from "../../fixtures/photo-import";
import type { Area, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: play (classFeatures, levelUp, deathMoves, rests, rolls, sessionFeatures, photoImport). Filled by tracer
 * H8 (.omc/plans/d12-hardening.yaml); covers the session-features set of bead dcm-bxp.64.
 *
 * Most character functions are `own`: `loadCharacter(..., "edit")` lets the owner (player) and the GM act and refuses
 * the other party member with FORBIDDEN (view only), a stranger with NOT_FOUND. The GM-only character functions
 * (`levelUp.correctLevel`, `deathMoves.returnFromAway`, `deathMoves.settleAway`) load with `"owner"`, so the owning
 * player is FORBIDDEN too. A call that passes the access check and then meets a game rule (no such feature, no
 * level-up called, no death move due) answers with that rule's code, listed in `okCodes`.
 */

const ROLL_RULES = ["DICE_RULE", "NOT_ENOUGH_HOPE"];

/** Patches a character's stored sheet (no public call sets HP or Hope to an exact value). */
async function patchSheet(w: World, characterId: Id<"characters">, patch: (sheet: Record<string, unknown>) => Record<string, unknown>) {
  await w.t.run(async (ctx) => {
    const character = await ctx.db.get("characters", characterId);
    if (character === null) throw new Error("no character");
    await ctx.db.patch("characters", characterId, { sheet: { ...character.sheet, ...patch(character.sheet as Record<string, unknown>) } as typeof character.sheet });
  });
}

/** The GM opens a short rest; synthesis then uses it for `restId`. */
async function openRest(w: World) {
  const { restId } = await w.as("gm").mutation(api.rests.start, { campaignId: w.campaignId, kind: "short", idempotencyKey: freshKey() });
  w.use("rests", restId);
}

/** playerA makes an action roll on characterA; synthesis then uses its log row for `entryId`. */
async function playerRolled(w: World) {
  const { entryId } = await w.as("player").mutation(api.rolls.actionRoll, {
    characterId: w.characterA,
    kind: "action",
    trait: "agility",
    modifier: 0,
    experienceIds: [],
    advantage: 0,
    disadvantage: 0,
    help: 0,
    attack: false,
    options: [],
    idempotencyKey: freshKey(),
  });
  w.use("actionLog", entryId);
}

const area: Area = {
  area: "play",
  entries: [
    // ---------------------------------------------------------------- classFeatures
    { fn: api.classFeatures.use, access: "own", args: () => ({ featureKey: "none", params: {} }), okCodes: ["CLASS_FEATURE_RULE"] },
    { fn: api.classFeatures.endEffect, access: "own", okCodes: ["CLASS_FEATURE_RULE"] },
    { fn: api.classFeatures.gotHit, access: "own", okCodes: ["CLASS_FEATURE_RULE"] },
    // Character rolls are public: every member reads the latest one.
    { fn: api.classFeatures.lastRoll, access: "own" },

    // ---------------------------------------------------------------- levelUp
    // The owner without the GM's flag, and the GM with an empty choice, meet LEVEL_UP_RULE after the access check.
    { fn: api.levelUp.apply, access: "own", okCodes: ["LEVEL_UP_RULE"] },
    { fn: api.levelUp.undoLast, access: "own", okCodes: ["LEVEL_UP_RULE"] },
    // Resolves for every member (false without edit access or a level-up to undo).
    { fn: api.levelUp.canUndo, access: "own" },
    // GM only (`loadCharacter(..., "owner")`). The level must be valid: an out-of-range level is refused before access.
    { fn: api.levelUp.correctLevel, access: "own", args: () => ({ level: 2 }), expect: { player: "FORBIDDEN" } },
    { fn: api.levelUp.partyLevelUp, access: "gm" },

    // ---------------------------------------------------------------- deathMoves
    { fn: api.deathMoves.choose, access: "own", okCodes: ["DEATH_MOVE_RULE"] },
    { fn: api.deathMoves.finishBlaze, access: "own", okCodes: ["DEATH_MOVE_RULE"] },
    { fn: api.deathMoves.resolveRiskItAll, access: "own", okCodes: ["DEATH_MOVE_RULE"] },
    { fn: api.deathMoves.returnFromAway, access: "own", expect: { player: "FORBIDDEN" }, okCodes: ["DEATH_MOVE_RULE"] },
    { fn: api.deathMoves.settleAway, access: "own", expect: { player: "FORBIDDEN" }, okCodes: ["DEATH_MOVE_RULE"] },
    { fn: api.deathMoves.state, access: "own" },
    {
      // A real death move by playerA (every Hit Point marked, then Avoid Death): its actor or the GM undoes it.
      fn: api.deathMoves.undo,
      access: "scoped",
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "ok", gm: "ok" },
      setup: async (w) => {
        await patchSheet(w, w.characterA, (sheet) => ({ hp: sheet.hpMax }));
        const { entryId } = await w.as("player").mutation(api.deathMoves.choose, { characterId: w.characterA, move: "avoidDeath", idempotencyKey: freshKey() });
        w.use("actionLog", entryId);
      },
    },

    // ---------------------------------------------------------------- rests
    { fn: api.rests.current, access: "view" },
    { fn: api.rests.projects, access: "own" },
    { fn: api.rests.start, access: "gm", okCodes: ["REST_RULE"] },
    { fn: api.rests.finish, access: "gm", setup: openRest },
    { fn: api.rests.interrupt, access: "gm", setup: openRest },
    // The open rest is the latest but changed nothing yet: the GM meets REST_RULE after the access check.
    { fn: api.rests.undo, access: "gm", setup: openRest, okCodes: ["REST_RULE"] },
    { fn: api.rests.choose, access: "own", setup: openRest, okCodes: ["REST_RULE"] },
    { fn: api.rests.createProject, access: "own", args: () => ({ name: "Forge a blade", startingValue: 4 }) },

    // ---------------------------------------------------------------- rolls
    { fn: api.rolls.actionRoll, access: "own", okCodes: ROLL_RULES },
    { fn: api.rolls.damageRoll, access: "own", okCodes: ROLL_RULES },
    { fn: api.rolls.manualRoll, access: "own", okCodes: ROLL_RULES },
    // characterA leads with characterB as partner; the lead must be editable, the partner only visible.
    { fn: api.rolls.tagTeam, access: "own", args: (w) => ({ partnerId: w.characterB }), okCodes: ROLL_RULES },
    // Edit access needed: the other party member may not read another character's open choices.
    { fn: api.rolls.pendingChoices, access: "own", expect: { otherPlayer: "FORBIDDEN" } },
    // Answers characterA's own latest roll (CLASS_FEATURE_RULE: a warrior has no Slayer pool).
    { fn: api.rolls.storeSlayerDie, access: "own", setup: playerRolled, okCodes: ["CLASS_FEATURE_RULE"] },
    {
      // U9: either participant's editor or the GM picks; anyone else is refused. playerB leads a Tag Team with
      // characterB and characterA, so playerA is the partner's editor. The grantee row runs with the grant removed:
      // a plain member outside the Tag Team.
      fn: api.rolls.tagTeamApply,
      access: "own",
      expect: { otherPlayer: "ok", grantee: "FORBIDDEN" },
      note: "grantee = a member without the edit grant (removed in setup), not in the Tag Team",
      setup: async (w) => {
        await patchSheet(w, w.characterB, () => ({ hope: 3 }));
        const { rolls } = await w.as("otherPlayer").mutation(api.rolls.tagTeam, {
          characterId: w.characterB,
          partnerId: w.characterA,
          initiator: { trait: "agility", modifier: 0 },
          partner: { trait: "agility", modifier: 0 },
          idempotencyKey: freshKey(),
        });
        w.use("actionLog", rolls[0]!.entryId);
        await w.t.run(async (ctx) => {
          const grants = await ctx.db.query("grants").collect();
          for (const grant of grants) if (grant.principalId === w.users.grantee) await ctx.db.delete("grants", grant._id);
        });
      },
    },
    { fn: api.rolls.gmRoll, access: "gm", args: () => ({ dice: [{ count: 1, sides: 6 }] }) },
    {
      fn: api.rolls.reveal,
      access: "gm",
      setup: async (w) => {
        const { entryId } = await w.as("gm").mutation(api.rolls.gmRoll, { campaignId: w.campaignId, dice: [{ count: 1, sides: 6 }], modifier: 0, idempotencyKey: freshKey() });
        w.use("actionLog", entryId);
      },
    },

    // ---------------------------------------------------------------- sessionFeatures
    // CLASS_FEATURE_RULE: a warrior has no Lunar Phases.
    { fn: api.sessionFeatures.bumpMoonDie, access: "own", okCodes: ["CLASS_FEATURE_RULE", "NOT_ENOUGH_HOPE"] },

    // ---------------------------------------------------------------- photoImport
    { fn: api.photoImport.available, access: "gm" },
    // The test deployment has no ANTHROPIC_API_KEY.
    { fn: api.photoImport.uploadUrl, access: "gm", okCodes: ["PHOTO_IMPORT_UNAVAILABLE"] },
    {
      // A stored file that is not an image: the GM's claim deletes it and answers { ok: false }.
      fn: api.photoImport.claim,
      access: "gm",
      setup: async (w) => {
        const storageId = await w.t.run((ctx) => ctx.storage.store(new Blob(["not an image"], { type: "text/plain" })));
        w.use("_storage" as TableNames, storageId);
      },
    },
    { fn: api.photoImport.discard, access: "gm" },
    {
      // GM only through the internal readContext query; without a key (or, with one, without photos) the GM gets past it.
      fn: api.photoImport.read,
      access: "scoped",
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", gm: "ok" },
      okCodes: ["PHOTO_IMPORT_UNAVAILABLE", "PHOTO_IMPORT_RULE"],
    },
    { fn: api.photoImport.create, access: "gm", args: () => ({ draft: validDraft() }) },
  ],
  pending: [],
};

export default area;
