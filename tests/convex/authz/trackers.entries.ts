import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { key } from "../helpers";
import type { Area, Entry, Outcome, Role, World } from "./harness";
import type { WorldOptions } from "./world";

/**
 * Authz matrix: trackers (ageOfUmbra, andaluria, colossus, fiveBanners, horizon, weredragon). Filled by tracer H14
 * (.omc/plans/d12-hardening.yaml).
 *
 * Every tracker is frame-exclusive (`assertTrackerFrame` answers MECHANIC_DISABLED elsewhere), so each entry runs on a
 * world of its own frame; trackers.test.ts proves the wrong-frame refusal for the GM. The GM-only changes are
 * `keyedGmMutation` (owner): the grantee's campaign `edit` grant does not reach them, so every gm entry adds a grantee
 * row (FORBIDDEN), and every view entry a grantee row (ok, the player's view). `fiveBanners.operateObjective` takes no
 * campaignId and checks owner through `campaignAccess` on the countdown's campaign (scoped). The Weredragon player
 * mutations `readNightSky` and `submitSecret` are `need: "view"`: every member may roll the night sky and submit a
 * secret.
 */

const UMBRA: WorldOptions = { frameId: "age-of-umbra" };
const ANDALURIA: WorldOptions = { frameId: "dark-heart-of-andaluria" };
const COLOSSUS: WorldOptions = { frameId: "colossus-of-the-drylands" };
const BANNERS: WorldOptions = { frameId: "five-banners-burning" };
const HORIZON: WorldOptions = { frameId: "journey-to-horizon" };
const WEREDRAGON: WorldOptions = { frameId: "reign-of-the-weredragon" };

/** GM change: the grantee's edit grant is below owner. */
const GM: Partial<Record<Role, Outcome>> = { grantee: "FORBIDDEN" };
/** Member read: the grantee reads the player's view. */
const VIEW: Partial<Record<Role, Outcome>> = { otherPlayer: "ok", grantee: "ok" };

const gm = (w: World) => w.as("gm");

/** The tracker's entries, each on a world of the tracker's frame. */
const onFrame = (world: WorldOptions, entries: Entry[]): Entry[] => entries.map((entry) => ({ ...entry, world }));

/** A lit pyre (`pyreId`). */
async function pyre(w: World) {
  const { pyreId } = await gm(w).mutation(api.trackers.ageOfUmbra.addPyre, { campaignId: w.campaignId, settlement: "Ashford", idempotencyKey: key() });
  w.set("pyreId", pyreId);
}

/** One Blessed Branch and an extinguished pyre (`pyreId`) to relight. */
async function branchAndDarkPyre(w: World) {
  const campaignId = w.campaignId;
  const { pyreId } = await gm(w).mutation(api.trackers.ageOfUmbra.addPyre, { campaignId, settlement: "Ashford", lit: false, idempotencyKey: key() });
  await gm(w).mutation(api.trackers.ageOfUmbra.adjustBranches, { campaignId, delta: 1, idempotencyKey: key() });
  w.set("pyreId", pyreId);
}

/** A hunt (`huntId`). */
async function hunt(w: World) {
  const { huntId } = await gm(w).mutation(api.trackers.andaluria.createHunt, { campaignId: w.campaignId, title: "The Beast", idempotencyKey: key() });
  w.set("huntId", huntId);
}

/** A hunt (`huntId`) with a clue (`clueId`). */
async function huntWithClue(w: World) {
  await hunt(w);
  const { clueId } = await gm(w).mutation(api.trackers.andaluria.createClue, {
    campaignId: w.campaignId,
    huntId: w.ids.huntId,
    text: "Claw marks",
    idempotencyKey: key(),
  });
  w.set("clueId", clueId);
}

/** A major objective for Polaris (`countdownId`, also the `countdowns` row synthesis uses). */
async function objective(w: World) {
  const { countdownId } = await gm(w).mutation(api.trackers.fiveBanners.createObjective, {
    campaignId: w.campaignId,
    nation: "polaris",
    kind: "objective-major",
    name: "Seize the straits",
    notes: "",
    steps: 10,
    idempotencyKey: key(),
  });
  w.set("countdownId", countdownId);
  w.use("countdowns", countdownId);
}

/** A night-sky roll waiting to be placed. */
async function pendingRoll(w: World) {
  await gm(w).mutation(api.trackers.weredragon.readNightSky, { campaignId: w.campaignId, idempotencyKey: key() });
}

/** playerA's secret (`secretId`). */
async function secret(w: World) {
  const { secretId } = await w.as("player").mutation(api.trackers.weredragon.submitSecret, { campaignId: w.campaignId, text: "Forlorne fled", idempotencyKey: key() });
  w.set("secretId", secretId);
}

const ageOfUmbra = onFrame(UMBRA, [
  { fn: api.trackers.ageOfUmbra.get, access: "view", expect: VIEW },
  { fn: api.trackers.ageOfUmbra.addPyre, access: "gm", expect: GM, args: () => ({ settlement: "Ashford" }) },
  { fn: api.trackers.ageOfUmbra.renamePyre, access: "gm", expect: GM, setup: pyre, args: (w) => ({ pyreId: w.ids.pyreId, settlement: "Emberfall" }) },
  { fn: api.trackers.ageOfUmbra.removePyre, access: "gm", expect: GM, setup: pyre, args: (w) => ({ pyreId: w.ids.pyreId }) },
  { fn: api.trackers.ageOfUmbra.setLit, access: "gm", expect: GM, setup: pyre, args: (w) => ({ pyreId: w.ids.pyreId, lit: false }) },
  { fn: api.trackers.ageOfUmbra.adjustBranches, access: "gm", expect: GM, args: () => ({ delta: 1 }) },
  { fn: api.trackers.ageOfUmbra.igniteBranch, access: "gm", expect: GM, setup: branchAndDarkPyre, args: (w) => ({ pyreId: w.ids.pyreId }) },
  { fn: api.trackers.ageOfUmbra.setAtPyre, access: "gm", expect: GM, args: () => ({ atPyre: true }) },
  { fn: api.trackers.ageOfUmbra.rollLurkingDarkness, access: "gm", expect: GM },
]);

const andaluria = onFrame(ANDALURIA, [
  { fn: api.trackers.andaluria.get, access: "view", expect: VIEW, setup: huntWithClue },
  { fn: api.trackers.andaluria.createHunt, access: "gm", expect: GM, args: () => ({ title: "The Beast" }) },
  { fn: api.trackers.andaluria.updateHunt, access: "gm", expect: GM, setup: hunt, args: (w) => ({ huntId: w.ids.huntId, patch: { monster: "Werewolf" } }) },
  { fn: api.trackers.andaluria.deleteHunt, access: "gm", expect: GM, setup: hunt, args: (w) => ({ huntId: w.ids.huntId }) },
  { fn: api.trackers.andaluria.createClue, access: "gm", expect: GM, setup: hunt, args: (w) => ({ huntId: w.ids.huntId, text: "Claw marks" }) },
  {
    fn: api.trackers.andaluria.updateClue,
    access: "gm",
    expect: GM,
    setup: huntWithClue,
    args: (w) => ({ huntId: w.ids.huntId, clueId: w.ids.clueId, patch: { revealed: true } }),
  },
  { fn: api.trackers.andaluria.deleteClue, access: "gm", expect: GM, setup: huntWithClue, args: (w) => ({ huntId: w.ids.huntId, clueId: w.ids.clueId }) },
]);

const colossus = onFrame(COLOSSUS, [
  { fn: api.trackers.colossus.get, access: "view", expect: VIEW },
  { fn: api.trackers.colossus.markRest, access: "gm", expect: GM, args: () => ({ kind: "short" }) },
  { fn: api.trackers.colossus.defeatColossus, access: "gm", expect: GM },
  { fn: api.trackers.colossus.setPhase, access: "gm", expect: GM, args: () => ({ phase: "interlude" }) },
  { fn: api.trackers.colossus.correct, access: "gm", expect: GM, args: () => ({ siphonMarked: 2 }) },
]);

const fiveBanners = onFrame(BANNERS, [
  { fn: api.trackers.fiveBanners.state, access: "view", expect: VIEW, setup: objective },
  { fn: api.trackers.fiveBanners.setRelationship, access: "gm", expect: GM, args: () => ({ a: "polaris", b: "hilltop", value: 1 }) },
  { fn: api.trackers.fiveBanners.setNationSheet, access: "gm", expect: GM, args: () => ({ nation: "polaris", assets: ["Fleet"], problems: [] }) },
  {
    fn: api.trackers.fiveBanners.toggleReveal,
    access: "gm",
    expect: GM,
    args: () => ({ target: { type: "relationship", a: "polaris", b: "hilltop" }, revealed: true }),
  },
  {
    fn: api.trackers.fiveBanners.createObjective,
    access: "gm",
    expect: GM,
    args: () => ({ nation: "polaris", kind: "objective-major", name: "Seize the straits", notes: "", steps: 10 }),
  },
  {
    fn: api.trackers.fiveBanners.operateObjective,
    access: "scoped",
    setup: objective,
    args: (w) => ({ countdownId: w.ids.countdownId as Id<"countdowns">, action: "advance" }),
    expect: { anon: "UNAUTHENTICATED", outsider: "NOT_FOUND", otherPlayer: "FORBIDDEN", player: "FORBIDDEN", grantee: "FORBIDDEN", gm: "ok" },
    note: "no campaignId: owner on the countdown's campaign through campaignAccess",
  },
  {
    fn: api.trackers.fiveBanners.advanceWeek,
    access: "gm",
    expect: GM,
    setup: objective,
    args: (w) => ({ picks: [{ nation: "polaris", objectiveId: w.ids.countdownId }] }),
  },
]);

const horizon = onFrame(HORIZON, [
  { fn: api.trackers.horizon.get, access: "view", expect: VIEW },
  { fn: api.trackers.horizon.markBox, access: "gm", expect: GM, args: () => ({ boxId: "1a" }) },
  {
    fn: api.trackers.horizon.unmarkBox,
    access: "gm",
    expect: GM,
    setup: async (w) => {
      await gm(w).mutation(api.trackers.horizon.markBox, { campaignId: w.campaignId, boxId: "1a", idempotencyKey: key() });
    },
    args: () => ({ boxId: "1a" }),
  },
  {
    fn: api.trackers.horizon.setOccurred,
    access: "gm",
    expect: GM,
    setup: async (w) => {
      await gm(w).mutation(api.trackers.horizon.markBox, { campaignId: w.campaignId, boxId: "1a", idempotencyKey: key() });
    },
    args: () => ({ boxId: "1a", occurred: true }),
  },
  { fn: api.trackers.horizon.setEchoes, access: "gm", expect: GM, args: () => ({ value: 2 }) },
]);

const weredragon = onFrame(WEREDRAGON, [
  { fn: api.trackers.weredragon.get, access: "view", expect: VIEW, setup: secret },
  { fn: api.trackers.weredragon.readNightSky, access: "view", expect: VIEW, note: "the players collectively roll 5d6 (HF p.140)" },
  { fn: api.trackers.weredragon.assignReading, access: "gm", expect: GM, setup: pendingRoll, args: () => ({ assignment: [0, 1, 2, 3, 4] }) },
  { fn: api.trackers.weredragon.updateRevelation, access: "gm", expect: GM, args: () => ({ kind: "ally", die: 6 }) },
  { fn: api.trackers.weredragon.submitSecret, access: "view", expect: VIEW, args: () => ({ text: "Forlorne fled" }) },
  { fn: api.trackers.weredragon.setSecretUsed, access: "gm", expect: GM, setup: secret, args: (w) => ({ secretId: w.ids.secretId, used: true }) },
]);

const area: Area = {
  area: "trackers",
  entries: [...ageOfUmbra, ...andaluria, ...colossus, ...fiveBanners, ...horizon, ...weredragon],
};

export default area;
