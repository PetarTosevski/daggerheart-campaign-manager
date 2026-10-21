import { api } from "../../../convex/_generated/api";
import { fromSrd, validateCustom } from "../../../src/lib/adversaries/custom";
import { ADVERSARIES } from "../../../src/lib/srd/adversaries";
import { key } from "../helpers";
import type { Area, Entry, Outcome, Role, World } from "./harness";

/**
 * Authz matrix: adversaries (encounters, encounterTracking, customAdversaries). Filled by tracer H10
 * (.omc/plans/d12-hardening.yaml).
 *
 * All 27 functions are GM wrappers (`need: "owner"`), so adversary stat blocks, live HP/Stress, Battle Points and
 * encounter notes never reach a player. Every entry adds rows for the other player and the edit-grant player: an edit
 * grant on the campaign is not GM, so both get FORBIDDEN like the player. There is no player-facing (filtered) query
 * in this area; the players' view of adversary tokens on the combat map belongs to the combat area (H11).
 *
 * The area's world: one custom adversary (a copy of the SRD Bear), one encounter holding one instance made from that
 * custom block (so `customBlocks` returns it), started so the tracker mutations run.
 */

const BEAR = ADVERSARIES.find((a) => a.id === "bear")!;
/** The editable fields of a custom copy of the Bear, as the editor sends them. */
const BEAR_COPY = validateCustom(fromSrd(BEAR));

/** GM only: the class defaults plus the other player and the edit grantee, neither of whom is the GM. */
const GM_ONLY: Partial<Record<Role, Outcome>> = { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" };

const gm = (entry: Omit<Entry, "access">): Entry => ({ access: "gm", ...entry, expect: { ...GM_ONLY, ...entry.expect } });

async function encounterWorld(w: World) {
  const { campaignId } = w;
  const as = w.as("gm");
  const { customId } = await as.mutation(api.customAdversaries.create, { campaignId, adversary: { ...BEAR_COPY, name: "Cave Bear" }, idempotencyKey: key() });
  const { encounterId } = await as.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: key() });
  const { instanceIds } = await as.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "custom", customId },
    count: 1,
    summoned: false,
    idempotencyKey: key(),
  });
  await as.mutation(api.encounters.start, { campaignId, encounterId });
  w.set("customId", customId);
  w.set("encounterId", encounterId);
  w.set("instanceId", instanceIds[0]!);
}

/** Ends the area's encounter, so `start` has an encounter to start. */
async function ended(w: World) {
  await w.as("gm").mutation(api.encounters.end, { campaignId: w.campaignId, encounterId: w.ids.encounterId! });
}

/** A Minion group (4 Jagged Knife Lackeys) in the running encounter, chosen as the instance. */
async function minions(w: World) {
  const { instanceIds } = await w.as("gm").mutation(api.encounters.addAdversary, {
    campaignId: w.campaignId,
    encounterId: w.ids.encounterId!,
    source: { kind: "srd", adversaryId: "jagged-knife-lackey" },
    count: 4,
    summoned: false,
    idempotencyKey: key(),
  });
  w.use("encounterAdversaries", instanceIds[0]!);
}

/** A second custom adversary no encounter uses (`remove` refuses a block an instance comes from), chosen as the custom id. */
async function unusedCustom(w: World) {
  const { customId } = await w
    .as("gm")
    .mutation(api.customAdversaries.create, { campaignId: w.campaignId, adversary: { ...BEAR_COPY, name: "Spare Bear" }, idempotencyKey: key() });
  w.use("customAdversaries", customId);
}

/** One Fear for the GM to spend. */
async function oneFear(w: World) {
  await w.as("gm").mutation(api.fear.adjust, { campaignId: w.campaignId, direction: "increase", idempotencyKey: key() });
}

const area: Area = {
  area: "adversaries",
  setup: encounterWorld,
  entries: [
    // customAdversaries
    gm({ fn: api.customAdversaries.list }),
    gm({ fn: api.customAdversaries.create, args: () => ({ adversary: BEAR_COPY, basedOn: "bear" }) }),
    gm({ fn: api.customAdversaries.update, args: () => ({ patch: { hp: 9 } }) }),
    gm({ fn: api.customAdversaries.remove, setup: unusedCustom }),

    // encounters
    gm({ fn: api.encounters.list }),
    gm({ fn: api.encounters.get }),
    gm({ fn: api.encounters.create, args: () => ({ name: "Second" }) }),
    gm({ fn: api.encounters.rename, args: () => ({ name: "Renamed" }) }),
    gm({ fn: api.encounters.setNotes, args: () => ({ notes: "The bear guards the cave." }) }),
    gm({ fn: api.encounters.setBudget, args: () => ({ change: { kind: "pcs", delta: 1 } }) }),
    gm({ fn: api.encounters.start, setup: ended }),
    gm({ fn: api.encounters.end }),
    gm({ fn: api.encounters.remove }),
    gm({ fn: api.encounters.addAdversary, args: () => ({ source: { kind: "srd", adversaryId: "bear" }, count: 1 }) }),
    gm({ fn: api.encounters.removeInstance }),
    gm({ fn: api.encounters.reorder, args: () => ({ direction: "down" }) }),

    // encounterTracking
    gm({ fn: api.encounterTracking.customBlocks }),
    gm({ fn: api.encounterTracking.markHp, args: () => ({ delta: 1 }) }),
    gm({ fn: api.encounterTracking.markStress, args: () => ({ delta: 1 }) }),
    gm({ fn: api.encounterTracking.applyDamage, args: () => ({ amount: 5 }) }),
    gm({ fn: api.encounterTracking.defeatMinions, setup: minions, args: () => ({ count: 1 }) }),
    gm({ fn: api.encounterTracking.toggleCondition, args: () => ({ condition: "vulnerable" }) }),
    gm({ fn: api.encounterTracking.setTags, args: () => ({ tags: ["cornered"] }) }),
    gm({ fn: api.encounterTracking.setNote, args: () => ({ note: "Wounded" }) }),
    gm({ fn: api.encounterTracking.spotlight }),
    gm({ fn: api.encounterTracking.endGmTurn }),
    gm({ fn: api.encounterTracking.spendFear, setup: oneFear, args: () => ({ amount: 1, reason: "move" }) }),
  ],
  pending: [],
};

export default area;
