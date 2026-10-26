import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: countdowns (countdowns, countdownRolls, countdownTracks, environmentActions; bead dcm-bxp.79). Filled by
 * tracer H6 (.omc/plans/d12-hardening.yaml). The rolls, rests and actionLog functions .79 also names are in play
 * (H8) and core (H5).
 *
 * Every world gets one dashboard countdown: long-term (so the countdownTracks functions accept it), unarmed (so a
 * finished long rest does not tick it before `tickOnRest` does) and private (so `listByCampaign` hides it from players).
 * Entries that need more state (a counted roll, a finished long rest, a chase at 0) add it in their own setup.
 */

const gm = (w: World) => w.as("gm");

/** A standard, public countdown at 4 (a roll can tick it, unlike the long-term one). */
async function standardCountdown(w: World) {
  const { countdownId } = await gm(w).mutation(api.countdowns.create, {
    campaignId: w.campaignId,
    name: "Doom",
    description: "",
    category: "threat",
    consequence: "The dam breaks",
    startingValue: 4,
    idempotencyKey: freshKey(),
  });
  w.set("standardId", countdownId);
}

/** playerA's server-rolled action roll: a counted roll row of the feed. */
async function countedRoll(w: World) {
  await standardCountdown(w);
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

/** The campaign's latest rest is a finished long rest. */
async function finishedLongRest(w: World) {
  const { restId } = await gm(w).mutation(api.rests.start, { campaignId: w.campaignId, kind: "long", idempotencyKey: freshKey() });
  await gm(w).mutation(api.rests.finish, { campaignId: w.campaignId, restId, idempotencyKey: freshKey() });
  w.use("rests", restId);
}

/** A chase whose two sides both reached 0, so the GM must call it (decideChase). */
async function chaseAtZero(w: World) {
  const { partyId, rivalsId } = await gm(w).mutation(api.countdowns.createChase, {
    campaignId: w.campaignId,
    name: "The thief",
    description: "",
    startingValue: 2,
    lead: "small",
    party: "pursuing",
    idempotencyKey: freshKey(),
  });
  await w.t.run(async (ctx) => {
    for (const id of [partyId, rivalsId]) await ctx.db.patch("countdowns", id, { currentValue: 0, status: "completed" });
  });
  w.use("countdowns", partyId);
}

/** Environment features are listed for this campaign (Hope & Fear on) and the GM holds Fear to spend. */
async function environments(w: World) {
  await gm(w).mutation(api.campaigns.setOption, { campaignId: w.campaignId, option: "hopeAndFear", enabled: true });
  await gm(w).mutation(api.fear.set, { campaignId: w.campaignId, value: 5, idempotencyKey: freshKey() });
}

const area: Area = {
  area: "countdowns",
  setup: async (w) => {
    const { countdownId } = await gm(w).mutation(api.countdowns.create, {
      campaignId: w.campaignId,
      name: "Invasion",
      description: "",
      category: "threat",
      consequence: "The city falls",
      startingValue: 8,
      mode: "longTerm",
      visibility: { mode: "private" },
      idempotencyKey: freshKey(),
    });
    w.use("countdowns", countdownId);
  },
  entries: [
    // ---------------------------------------------------------------- countdowns
    // campaignQuery view/owner: players read, but the only countdown is private, so they get none (filtering itself is
    // tested in countdowns-modes / countdown visibility tests). The edit grantee is not the owner either.
    { fn: api.countdowns.listByCampaign, access: "view", expect: { player: "empty", otherPlayer: "empty", grantee: "empty" } },
    { fn: api.countdowns.create, access: "gm", args: () => ({ startingValue: 4 }) },
    { fn: api.countdowns.createChase, access: "gm", args: () => ({ startingValue: 6, lead: "small", party: "pursuing" }) },
    { fn: api.countdowns.setVisibility, access: "gm" },
    { fn: api.countdowns.setArmed, access: "gm", args: () => ({ armed: true }) },
    { fn: api.countdowns.decideChase, access: "gm", setup: chaseAtZero, args: () => ({ result: "caught" }) },
    // keyedUserMutation: the campaign comes from the countdown and the handler requires "owner" (campaignAccess).
    // Members who are not the GM are refused whether or not the countdown is revealed to them: the plan's "player
    // NOT_FOUND on hidden, ok on revealed" does not match the code; players never operate dashboard countdowns.
    {
      fn: api.countdowns.operate,
      access: "scoped",
      args: () => ({ action: "advance" }),
      expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", grantee: "FORBIDDEN", gm: "ok" },
    },
    // ---------------------------------------------------------------- countdownRolls
    { fn: api.countdownRolls.preview, access: "gm", setup: countedRoll },
    {
      fn: api.countdownRolls.applyRoll,
      access: "gm",
      setup: countedRoll,
      args: (w) => ({ countdownIds: [w.ids.standardId as Id<"countdowns">] }),
    },
    { fn: api.countdownRolls.countedRows, access: "gm", setup: countedRoll, args: async (w) => ({ entryIds: [await w.idOf("actionLog")] }) },
    // ---------------------------------------------------------------- countdownTracks
    { fn: api.countdownTracks.setStep, access: "gm", args: () => ({ value: 5, text: "Scouts at the border" }) },
    { fn: api.countdownTracks.setRestMode, access: "gm", args: () => ({ restMode: "remind" }) },
    { fn: api.countdownTracks.afterRest, access: "gm" },
    { fn: api.countdownTracks.tickOnRest, access: "gm", setup: finishedLongRest },
    // ---------------------------------------------------------------- environmentActions
    {
      fn: api.environmentActions.spendFear,
      access: "gm",
      setup: environments,
      args: () => ({ environmentId: "raging-river", featureName: "Undertow" }),
    },
    {
      fn: api.environmentActions.startCountdown,
      access: "gm",
      setup: environments,
      args: () => ({ environmentId: "mountain-pass", featureName: "Icy Winds" }),
    },
  ],
};

export default area;
