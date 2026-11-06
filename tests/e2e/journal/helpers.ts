// Journal e2e seed (plan .omc/plans/journal.yaml, J1; docs/tasks/TASK-JOURNAL-J1.md). Every Journal spec uses this
// scene from the design (reference/designs/journal/journal_views.jpg): a Witherwild campaign with four PCs (Moss,
// assigned to the e2e player, Brannoc, Vex, Oriel), sessions 2-7 (2-5 played, 6 'Ambush at the Forest Camp' live,
// 7 planned), session 6's four planned scenes with a Combat scene, its encounter 'Jagged Knife ambush' and the GM
// prep note. Scene titles and states (J0's widened scene) are not seeded yet: `JOURNAL_SCENES` carries them so the
// tracers that add them (JD4 / JP1) can set them here.

import { execFileSync } from "node:child_process";

import { expect, type Browser, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { gmAndPlayer, type LiveTable } from "../live";
import { bardDraft } from "../visual/helpers";

/** The party of the design, Moss first (the player's character). */
export const JOURNAL_PCS = ["Moss", "Brannoc", "Vex", "Oriel"] as const;

/** Sessions 2-7 of the design: number, title, date (Sundays, 2025), status. */
export const JOURNAL_SESSIONS = [
  { n: 2, title: "Smoke over Hollowmere", date: "2025-10-05", status: "played" },
  { n: 3, title: "The rootbound shrine", date: "2025-10-12", status: "played" },
  { n: 4, title: "Rain on the old road", date: "2025-10-19", status: "played" },
  { n: 5, title: "Woodcutter’s bargain", date: "2025-10-26", status: "played" },
  { n: 6, title: "Ambush at the Forest Camp", date: "2025-11-02", status: "live" },
  { n: 7, title: "The chapel in the briar", date: "2025-11-09", status: "planned" },
] as const;

/** Session 6's planned scenes: type, title (not stored until J0 / JD4) and text. */
export const JOURNAL_SCENES = [
  {
    type: "exploration",
    title: "The old road north",
    text: "The party follows cart tracks off the road into the autumn wood. Withered trees, birds gone quiet.",
  },
  {
    type: "social",
    title: "Bargain with the woodcutter",
    text: "Old Tamsin knows where the bandits camp; she wants her stolen axe back first.",
  },
  {
    type: "combat",
    title: "Jagged Knife ambush at the camp",
    text: "Three tents around a campfire. The Lieutenant holds the clearing; a Sniper watches from the treeline.",
  },
  {
    type: "downtime",
    title: "Rest at the ruined chapel",
    text: "Short rest, or push on before nightfall. The chapel bell rings on its own.",
  },
] as const;

/** Session 6's GM prep note (the hooks field, one '- ' line per bullet). */
export const JOURNAL_PREP = [
  "- Tamsin’s axe is in the Lieutenant’s tent.",
  "- If the Sniper escapes, it warns the chapel.",
  "- Moss’s player wants a scene with the woodcutter’s grandson.",
].join("\n");

/** The Combat scene's encounter and its adversaries (SRD ids, counts). */
export const JOURNAL_ENCOUNTER = {
  name: "Jagged Knife ambush",
  adversaries: [
    { adversaryId: "jagged-knife-lieutenant", count: 1 },
    { adversaryId: "jagged-knife-bandit", count: 2 },
    { adversaryId: "jagged-knife-sniper", count: 1 },
    { adversaryId: "jagged-knife-lackey", count: 4 },
  ],
} as const;

/**
 * Runs an internal Convex function on the worktree's local e2e backend (`scripts/convex-e2e.mjs run`, as
 * tests/e2e/owner.ts does) and returns its result: with stdout not a TTY the CLI prints the result as JSON, and
 * nothing for a null result.
 */
function runInternal<T>(fn: string, args: Record<string, unknown>): T {
  const out = execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", fn, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return (out === "" ? null : JSON.parse(out)) as T;
}

/**
 * Creates the session's legacy encounter, 'Session N encounter' (internal `sessionPrep:createEncounter`: no UI creates
 * it since the Journal, which links encounters per scene; JF3).
 */
export function createSessionEncounter(campaignId: Id<"campaigns">, sessionId: Id<"sessions">): Id<"encounters"> {
  return runInternal<{ encounterId: Id<"encounters"> }>("sessionPrep:createEncounter", { campaignId, sessionId }).encounterId;
}

/** Links an existing encounter as the session's legacy encounter (internal `sessionPrep:linkEncounter`, JF3). */
export function linkSessionEncounter(campaignId: Id<"campaigns">, sessionId: Id<"sessions">, encounterId: Id<"encounters">) {
  runInternal<null>("sessionPrep:linkEncounter", { campaignId, sessionId, encounterId });
}

export type JournalTable = LiveTable & {
  /** Session ids by number (2-7). */
  sessions: Record<number, Id<"sessions">>;
  /** Session 6, live. */
  liveSessionId: Id<"sessions">;
  /** Session 6's scene ids, in plan order. */
  sceneIds: string[];
  encounterId: Id<"encounters">;
  /** `/campaigns/<id>/journal`. */
  url: string;
};

/**
 * The GM and the e2e player side by side (tests/e2e/live.ts) on the design's campaign; both pages end on the
 * dashboard. Call `close()` at the end of the test.
 */
export async function seedJournal(browser: Browser): Promise<JournalTable> {
  const table = await gmAndPlayer(browser, { draft: { name: JOURNAL_PCS[0] } });
  const { client, campaignId } = table;
  const key = () => crypto.randomUUID();

  for (const name of JOURNAL_PCS.slice(1)) {
    await client.mutation(api.characters.create, { campaignId, draft: { ...bardDraft(name), name }, idempotencyKey: key() });
  }

  // Sessions 1-7, then session 1 goes, so the list reads 7..2 as in the design.
  const ids: Record<number, Id<"sessions">> = {};
  for (let i = 1; i <= 7; i++) {
    const { sessionId, n } = await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: key() });
    ids[n] = sessionId;
  }
  await client.mutation(api.sessionRecords.remove, { campaignId, sessionId: ids[1]! });
  delete ids[1];
  for (const s of JOURNAL_SESSIONS) {
    const sessionId = ids[s.n]!;
    await client.mutation(api.sessionRecords.setTitle, { campaignId, sessionId, title: s.title });
    await client.mutation(api.sessionRecords.setDate, { campaignId, sessionId, date: s.date });
    if (s.status === "played") await client.mutation(api.sessionRecords.setPlayed, { campaignId, sessionId, played: true });
  }

  const liveSessionId = ids[6]!;
  const sceneIds: string[] = [];
  for (const scene of JOURNAL_SCENES) {
    const { sceneId } = await client.mutation(api.sessionPrep.addScene, { campaignId, sessionId: liveSessionId, type: scene.type });
    await client.mutation(api.sessionPrep.setScene, { campaignId, sessionId: liveSessionId, sceneId, text: scene.text });
    sceneIds.push(sceneId);
  }
  await client.mutation(api.sessionPrep.setHooks, { campaignId, sessionId: liveSessionId, hooks: JOURNAL_PREP });
  const encounterId = createSessionEncounter(campaignId, liveSessionId);
  await client.mutation(api.encounters.rename, { campaignId, encounterId, name: JOURNAL_ENCOUNTER.name });
  for (const { adversaryId, count } of JOURNAL_ENCOUNTER.adversaries) {
    await client.mutation(api.encounters.addAdversary, {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId },
      count,
      summoned: false,
      idempotencyKey: key(),
    });
  }
  await client.mutation(api.sessions.start, { campaignId, sessionId: liveSessionId, idempotencyKey: key() });

  return { ...table, sessions: ids, liveSessionId, sceneIds, encounterId, url: `/campaigns/${campaignId}/journal` };
}

/** Opens the Journal (with `query`, e.g. `?tab=notes`) and waits for its H1. */
export async function openJournal(page: Page, table: Pick<JournalTable, "url">, query = "") {
  await page.goto(`${table.url}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
}
