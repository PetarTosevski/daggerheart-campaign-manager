import { api } from "../../../convex/_generated/api";
import type { Area, Entry, Outcome, Role, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: journal-plan (Journal JD4, plan .omc/plans/journal.yaml): the Plan view's new session prep functions,
 * `sessionPrep.setSceneState`, `linkSceneEncounter`, `createSceneEncounter` and `unlinkSceneEncounter`. All are GM
 * wrappers (`need: "owner"`): a player and a campaign edit grantee are FORBIDDEN, an outsider NOT_FOUND. Every world
 * gets one planned session (the `sessionId` hint picks it) with one Combat scene (`sceneId`); the encounter entries add
 * an unlinked encounter (the `encounterId` hint picks it). The older sessionPrep functions stay in sessions.entries.ts.
 */

const GM_ONLY: Partial<Record<Role, Outcome>> = { grantee: "FORBIDDEN" };

/** An encounter not linked to any scene (the `encounterId` hint picks it). */
async function encounter(w: World) {
  await w.as("gm").mutation(api.encounters.create, { campaignId: w.campaignId, name: "Ambush", idempotencyKey: freshKey() });
}

const gm = (entry: Omit<Entry, "access">): Entry => ({ ...entry, access: "gm", expect: { ...GM_ONLY, ...entry.expect } });
const scene = (w: World) => ({ sceneId: w.ids.sceneId });

const area: Area = {
  area: "journal-plan",
  setup: async (w) => {
    const gmClient = w.as("gm");
    const { sessionId } = await gmClient.mutation(api.sessionRecords.create, { campaignId: w.campaignId, idempotencyKey: freshKey() });
    const { sceneId } = await gmClient.mutation(api.sessionPrep.addScene, { campaignId: w.campaignId, sessionId });
    w.set("sceneId", sceneId);
  },
  entries: [
    gm({ fn: api.sessionPrep.setSceneState, args: (w) => ({ ...scene(w), state: "playing" }) }),
    gm({ fn: api.sessionPrep.linkSceneEncounter, setup: encounter, args: scene }),
    gm({ fn: api.sessionPrep.createSceneEncounter, args: scene }),
    gm({ fn: api.sessionPrep.unlinkSceneEncounter, args: scene }),
  ],
};

export default area;
