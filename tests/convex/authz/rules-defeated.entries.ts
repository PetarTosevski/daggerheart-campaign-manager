import { api } from "../../../convex/_generated/api";
import { key } from "../helpers";
import type { Area, Entry, Outcome, Role, World } from "./harness";

/**
 * Authz matrix: the D8 Manual Defeated button (plan rule-switches DEF, bead dcm-jh6d.68). docs/tasks/TASK-RULES-DEF.md.
 *
 * `encounterTracking.markDefeated` is a GM wrapper like the rest of the tracker (convex/encounterTracking.ts): players,
 * the other player and the edit grantee get FORBIDDEN, outsiders NOT_FOUND. The area's world turns D8 to Manual and
 * starts an encounter whose one Bear has every HP marked, so the allowed rows mark it defeated.
 */

const GM_ONLY: Partial<Record<Role, Outcome>> = { otherPlayer: "FORBIDDEN", grantee: "FORBIDDEN" };
const gm = (entry: Omit<Entry, "access">): Entry => ({ access: "gm", ...entry, expect: { ...GM_ONLY, ...entry.expect } });

async function lastHpWorld(w: World) {
  const { campaignId } = w;
  const as = w.as("gm");
  await as.mutation(api.ruleSettings.set, { campaignId, change: { key: "adversaryDefeated", value: "manual" } });
  const { encounterId } = await as.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: key() });
  const { instanceIds } = await as.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId,
    source: { kind: "srd", adversaryId: "bear" },
    count: 1,
    summoned: false,
    idempotencyKey: key(),
  });
  await as.mutation(api.encounters.start, { campaignId, encounterId });
  await as.mutation(api.encounterTracking.markHp, { campaignId, instanceId: instanceIds[0]!, delta: 7, idempotencyKey: key() });
  w.set("encounterId", encounterId);
  w.set("instanceId", instanceIds[0]!);
}

const area: Area = {
  area: "rules-defeated",
  setup: lastHpWorld,
  entries: [gm({ fn: api.encounterTracking.markDefeated })],
};

export default area;
