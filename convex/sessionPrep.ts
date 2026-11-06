import { v, type Infer } from "convex/values";

import { BP_COSTS, budgetFor, minionGroups, spentFor, verdict, type BudgetEntry } from "../src/lib/domain/encounters/budget";
import { sceneEncounterId } from "../src/lib/domain/journal/scenes";
import { appError } from "../src/lib/errors/app-error";
import { srdAdversary } from "../src/lib/srd/adversary-lookup";
import type { AdversaryType } from "../src/lib/srd/types";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { placedInstances } from "./lib/combatTokenViews";
import { liveCombatMap, tokensOnMap } from "./lib/combatMaps";
import { loadEncounter, MAX_ENCOUNTERS, MAX_INSTANCES, MAX_PCS } from "./lib/encounters";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { campaignEncounter, cleanText, currentSessionEncounter, loadSession, playScene, sessionPrepOf } from "./lib/sessions";
import { adversaryTypeValidator, encounterStatusValidator } from "./lib/validators/encounters";
import { MAX_SCENES, sessionSceneStateValidator, sessionSceneTypeValidator, sessionSceneValidator, type SessionScene } from "./lib/validators/sessions";

/**
 * Session prep (D10 S4, plan `.omc/plans/d10-sessions.yaml`, rules B3, K6, K10 and Q1; Journal JD4, plan
 * `.omc/plans/journal.yaml`, user answers Q6 and Q7): the GM's planned scenes with their title, state (Planned /
 * Playing now / Done) and, for a Combat scene, its own D8 encounter; 'Hooks & loose threads'; and the session's
 * legacy encounter (`sessionPrep.encounterId`, read as the first Combat scene's, Q6). GM-only on the server (every
 * public function is a GM wrapper: a player gets FORBIDDEN, an outsider NOT_FOUND; the legacy encounter's create and
 * link are internal seeding functions since JF3). The prep row is created by the first
 * write (`sessionPrepOf` null = empty prep). Encounters stay D8's (convex/encounters.ts edits them; never copied);
 * this file only creates drafts and keeps the links, which may dangle after D8 deletes an encounter (read as none).
 */

/** Party size when the campaign has no active character (D8's default, convex/encounters.ts). */
const DEFAULT_PCS = 4;
/** Characters read to count the active ones (as D8's `create`). */
const MAX_CHARACTERS_READ = 100;


// ---------------------------------------------------------------- validators

/** The linked encounter as Prep shows it before D8's builder loads: name, status and Battle Points (K6, budget.ts). */
const encounterSummaryValidator = v.object({
  _id: v.id("encounters"),
  name: v.string(),
  status: encounterStatusValidator,
  pcs: v.number(),
  adversaries: v.number(),
  budget: v.number(),
  spent: v.number(),
  verdict: v.string(),
});

/** One adversary chip of a scene's encounter (Journal Plan board). */
const sceneInstanceValidator = v.object({
  _id: v.id("encounterAdversaries"),
  /** "Bear 2". */
  label: v.string(),
  /** The stat block's type; null when a custom block was deleted. */
  type: v.union(adversaryTypeValidator, v.null()),
  /** A Minion group's size, else 1. */
  count: v.number(),
  /**
   * Its Battle Points (CB p.197): the type's cost; a Minion group costs its own groups the size of the party (the
   * encounter's `spent` groups every Minion together, so the chips may add up to more); summoned or unknown = 0.
   */
  bp: v.number(),
  defeated: v.boolean(),
  /** It has a token on the campaign's live map. */
  onMap: v.boolean(),
});

/** A Combat scene's encounter: the summary plus its chips and whether any of it is on the live map ('On the Combat Map'). */
const sceneEncounterValidator = v.object({
  ...encounterSummaryValidator.fields,
  instances: v.array(sceneInstanceValidator),
  onMap: v.boolean(),
});

const prepSceneValidator = v.object({
  ...sessionSceneValidator.fields,
  /**
   * The scene's encounter (`sceneEncounterId`: its own, or the legacy session encounter on the first Combat scene).
   * Always sent (null for none); optional in the type only so the old Sessions UI's optimistic `addScene` (which JX2
   * deletes) still type-checks.
   */
  encounter: v.optional(v.union(sceneEncounterValidator, v.null())),
});

const prepValidator = v.object({
  scenes: v.array(prepSceneValidator),
  hooks: v.string(),
  /** The legacy session encounter (D10 Q1, the old Sessions UI). */
  encounter: v.union(encounterSummaryValidator, v.null()),
});

// ---------------------------------------------------------------- helpers

/** The session's prep row, inserted empty on the first write. */
async function ensurePrep(ctx: MutationCtx, session: Doc<"sessions">): Promise<Doc<"sessionPrep">> {
  const existing = await sessionPrepOf(ctx, session._id);
  if (existing !== null) return existing;
  const id = await ctx.db.insert("sessionPrep", { campaignId: session.campaignId, sessionId: session._id, scenes: [], updatedAt: Date.now() });
  return (await ctx.db.get("sessionPrep", id))!;
}

/** The legacy linked encounter when it still exists in this campaign; a dangling or foreign id reads as none (S0). */
async function linkedEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">, prep: Doc<"sessionPrep"> | null): Promise<Doc<"encounters"> | null> {
  return campaignEncounter(ctx, campaignId, prep?.encounterId);
}

type InstanceEntry = { row: Doc<"encounterAdversaries">; entry: BudgetEntry };

/** The encounter's instances in order with their stat block type and tier (SRD bundle or the campaign's custom adversary; null when it is gone). */
async function instanceEntries(ctx: QueryCtx, encounter: Doc<"encounters">): Promise<InstanceEntry[]> {
  const rows = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES);
  const customs = new Map<Id<"customAdversaries">, { type: AdversaryType; tier: number } | null>();
  const entries: InstanceEntry[] = [];
  for (const row of rows) {
    let block: { type: AdversaryType; tier: number } | null;
    if (row.source.kind === "srd") {
      block = srdAdversary(row.source.adversaryId) ?? null;
    } else {
      const customId = row.source.customId;
      if (!customs.has(customId)) {
        const custom = await ctx.db.get("customAdversaries", customId);
        customs.set(customId, custom && custom.campaignId === encounter.campaignId ? custom : null);
      }
      block = customs.get(customId) ?? null;
    }
    entries.push({ row, entry: { type: block?.type ?? null, tier: block?.tier ?? null, summoned: row.summoned, minionCount: row.minionCount } });
  }
  return entries;
}

function summaryOf(encounter: Doc<"encounters">, entries: InstanceEntry[]) {
  const budget = budgetFor(encounter.pcs, encounter.adjustments);
  const spent = spentFor(
    entries.map((e) => e.entry),
    encounter.pcs,
  );
  return {
    _id: encounter._id,
    name: encounter.name,
    status: encounter.status,
    pcs: encounter.pcs,
    adversaries: entries.length,
    budget,
    spent,
    verdict: verdict(budget - spent),
  };
}

/** One chip's Battle Points (see `sceneInstanceValidator.bp`). */
function instanceBp(entry: BudgetEntry, pcs: number): number {
  if (entry.summoned || entry.type === null) return 0;
  if (entry.type === "Minion") return minionGroups([entry], pcs);
  return BP_COSTS[entry.type];
}

/** Active characters, D8's default Battle Points party size (CB p.197 "the number of PCs in combat"), 4 with none. */
async function activePcs(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  const characters = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_READ);
  const active = characters.filter((c) => c.status === "active").length;
  return active === 0 ? DEFAULT_PCS : Math.min(MAX_PCS, active);
}

function sceneIndex(prep: Doc<"sessionPrep"> | null, sceneId: string): number {
  const i = prep?.scenes.findIndex((s) => s.id === sceneId) ?? -1;
  if (i === -1) throw appError("SESSION_SCENE_NOT_FOUND");
  return i;
}

/** Refuses (SESSION_HAS_ENCOUNTER) a second encounter for the session (Q1: one per session). */
async function assertNoEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">, prep: Doc<"sessionPrep"> | null, except?: Id<"encounters">) {
  const linked = await linkedEncounter(ctx, campaignId, prep);
  if (linked !== null && linked._id !== except) throw appError("SESSION_HAS_ENCOUNTER");
}

/** Refuses (SESSION_SCENE_STATE) an encounter on a scene that is not a Combat scene (Q6). */
function assertCombat(scene: SessionScene): void {
  if (scene.type !== "combat") throw appError("SESSION_SCENE_STATE", "Only a Combat scene has an encounter.");
}

/**
 * Refuses (SESSION_HAS_ENCOUNTER) linking an encounter to a scene that already shows another one (its own, or the
 * legacy session encounter on the first Combat scene) that still exists.
 */
async function assertSceneFree(ctx: QueryCtx, campaignId: Id<"campaigns">, prep: Doc<"sessionPrep">, index: number, except?: Id<"encounters">) {
  const current = await campaignEncounter(ctx, campaignId, sceneEncounterId(prep.scenes[index]!, index, prep));
  if (current !== null && current._id !== except) throw appError("SESSION_HAS_ENCOUNTER", "This scene already has an encounter. Unlink it first.");
}

/** Sets the scene's own encounter. */
async function linkScene(ctx: MutationCtx, prep: Doc<"sessionPrep">, index: number, encounterId: Id<"encounters">) {
  const scenes = prep.scenes.map((s, j) => (j === index ? { ...s, encounterId } : s));
  await ctx.db.patch("sessionPrep", prep._id, { scenes, updatedAt: Date.now() });
}

// ---------------------------------------------------------------- query

/**
 * The session's prep: scenes in order (with title, state and, for a Combat scene, its encounter's summary, chips and
 * 'On the Combat Map'), hooks ('' when none) and the legacy linked encounter's summary with its Battle Points
 * (budget.ts, K6), or null when none is linked or the linked one was deleted. GM-only (K10).
 */
export const get = gmQuery({
  args: { sessionId: v.string() },
  returns: prepValidator,
  handler: async (ctx, { sessionId }) => {
    const campaignId = ctx.campaign._id;
    const session = await loadSession(ctx, campaignId, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const encounter = await linkedEncounter(ctx, campaignId, prep);
    const legacy = encounter === null ? null : summaryOf(encounter, await instanceEntries(ctx, encounter));
    if (prep === null) return { scenes: [], hooks: "", encounter: legacy };

    // Tokens on the live map, read once (a map holds at most MAX_COMBAT_TOKENS).
    let onMap: Set<Id<"encounterAdversaries">> | null = null;
    const placed = async () => {
      if (onMap === null) {
        const map = await liveCombatMap(ctx, campaignId);
        onMap = map === null ? new Set() : placedInstances(await tokensOnMap(ctx, map._id));
      }
      return onMap;
    };

    const scenes: Infer<typeof prepSceneValidator>[] = [];
    for (const [i, scene] of prep.scenes.entries()) {
      const linked = scene.type === "combat" ? await campaignEncounter(ctx, campaignId, sceneEncounterId(scene, i, prep)) : null;
      let summary = null;
      if (linked !== null) {
        const entries = await instanceEntries(ctx, linked);
        const set = await placed();
        const instances = entries.map(({ row, entry }) => ({
          _id: row._id,
          label: row.label,
          type: entry.type,
          count: row.minionCount ?? 1,
          bp: instanceBp(entry, linked.pcs),
          defeated: row.defeated,
          onMap: set.has(row._id),
        }));
        summary = { ...summaryOf(linked, entries), instances, onMap: instances.some((x) => x.onMap) };
      }
      scenes.push({ ...scene, encounter: summary });
    }
    return { scenes, hooks: prep.hooks ?? "", encounter: legacy };
  },
});

/**
 * The Sessions hub's link back (TASK-SESSIONS-HUB): the live session, else the newest planned one, with the encounter
 * it plays now (Journal JD4: the playing or next Combat scene's, else the legacy session encounter) when that still
 * exists, with that encounter's id; null otherwise. The encounter tracker shows a 'Session N' chip when its open
 * encounter is this one. GM-only (K10: players never see session prep).
 */
export const current = gmQuery({
  args: {},
  returns: v.union(
    v.object({ sessionId: v.id("sessions"), n: v.number(), live: v.boolean(), encounterId: v.id("encounters") }),
    v.null(),
  ),
  handler: async (ctx) => {
    const found = await currentSessionEncounter(ctx, ctx.campaign._id);
    if (found === null) return null;
    const { session, encounter } = found;
    return { sessionId: session._id, n: session.n, live: session.status === "live", encounterId: encounter._id };
  },
});

// ---------------------------------------------------------------- scenes and hooks (B3)

/** '+ Scene': appends a scene (type default Combat, empty text) and returns its id. SESSION_SCENE_LIMIT past MAX_SCENES. */
export const addScene = gmMutation({
  args: { sessionId: v.string(), type: v.optional(sessionSceneTypeValidator) },
  returns: v.object({ sceneId: v.string() }),
  handler: async (ctx, { sessionId, type = "combat" }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await ensurePrep(ctx, session);
    if (prep.scenes.length >= MAX_SCENES) throw appError("SESSION_SCENE_LIMIT");
    const sceneId = crypto.randomUUID();
    await ctx.db.patch("sessionPrep", prep._id, { scenes: [...prep.scenes, { id: sceneId, type, text: "" }], updatedAt: Date.now() });
    return { sceneId };
  },
});

/**
 * One scene's type, text or title (exactly one of them; INVALID otherwise). Text is trimmed, at most 300 characters;
 * the title (Journal) trimmed, at most 120, and an empty title clears it. Changing a scene to a non-Combat type drops
 * its own encounter link (the encounter stays in the Adversaries tab; Q6: only Combat scenes have one).
 */
export const setScene = gmMutation({
  args: {
    sessionId: v.string(),
    sceneId: v.string(),
    type: v.optional(sessionSceneTypeValidator),
    text: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId, type, text, title }) => {
    if ([type, text, title].filter((x) => x !== undefined).length !== 1) throw appError("INVALID", "Change the scene's type, text or title.");
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    const scenes = prep!.scenes.map((s, j) => {
      if (j !== i) return s;
      if (type !== undefined) return type === "combat" ? { ...s, type } : { ...s, type, encounterId: undefined };
      if (text !== undefined) return { ...s, text: cleanText("scene", text) };
      const clean = cleanText("sceneTitle", title!);
      return { ...s, title: clean === "" ? undefined : clean };
    });
    await ctx.db.patch("sessionPrep", prep!._id, { scenes, updatedAt: Date.now() });
    return null;
  },
});

export const removeScene = gmMutation({
  args: { sessionId: v.string(), sceneId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    await ctx.db.patch("sessionPrep", prep!._id, { scenes: prep!.scenes.filter((_, j) => j !== i), updatedAt: Date.now() });
    return null;
  },
});

/**
 * A scene's state (Journal Q7; the GM marks non-combat scenes, the Combat Map marks Combat scenes through
 * '+ Session encounter'). 'playing': the scene that was playing becomes Done, and while the session is live one log
 * line 'Scene N began · <title>' is written (event 'scene'); a scene already playing is a no-op. 'done' / 'planned'
 * set only this scene ('planned' clears the state). A played session's scenes cannot start playing
 * (SESSION_SCENE_STATE). "Next" is derived on the client (`nextSceneId`).
 */
export const setSceneState = gmMutation({
  args: { sessionId: v.string(), sceneId: v.string(), state: sessionSceneStateValidator },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId, state }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    if (state === "playing") {
      if (session.status === "played") throw appError("SESSION_SCENE_STATE", "This session was played. Start it again first.");
      await playScene(ctx, session, prep!, i, ctx.user._id);
      return null;
    }
    if ((prep!.scenes[i]!.state ?? "planned") === state) return null;
    const next = state === "planned" ? undefined : state;
    const scenes = prep!.scenes.map((s, j) => (j === i ? { ...s, state: next } : s));
    await ctx.db.patch("sessionPrep", prep!._id, { scenes, updatedAt: Date.now() });
    return null;
  },
});

/** 'Hooks & loose threads': trimmed, at most 4000 characters; empty clears it. */
export const setHooks = gmMutation({
  args: { sessionId: v.string(), hooks: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, hooks }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const text = cleanText("hooks", hooks);
    const existing = await sessionPrepOf(ctx, session._id);
    if (existing === null && text === "") return null;
    const prep = existing ?? (await ensurePrep(ctx, session));
    await ctx.db.patch("sessionPrep", prep._id, { hooks: text === "" ? undefined : text, updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------- per-scene encounters (Journal JD4, Q6)

/** Inserts a D8 draft (`encounters.create`'s rules: ENCOUNTER_LIMIT past MAX_ENCOUNTERS) with the active PCs as party size. */
async function insertDraft(ctx: MutationCtx, campaignId: Id<"campaigns">, name: string): Promise<Id<"encounters">> {
  const existing = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_ENCOUNTERS);
  if (existing.length >= MAX_ENCOUNTERS) throw appError("ENCOUNTER_LIMIT");
  const now = Date.now();
  return ctx.db.insert("encounters", {
    campaignId,
    name,
    status: "draft",
    pcs: await activePcs(ctx, campaignId),
    adjustments: [],
    gmTurn: 1,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Links an existing encounter of the campaign (NOT_FOUND otherwise) to a Combat scene (SESSION_SCENE_STATE for
 * another type). SESSION_HAS_ENCOUNTER when the scene already shows another encounter; linking the one it shows is a
 * no-op. The same encounter may be linked to several scenes.
 */
export const linkSceneEncounter = gmMutation({
  args: { sessionId: v.string(), sceneId: v.string(), encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId, encounterId }) => {
    const campaignId = ctx.campaign._id;
    const session = await loadSession(ctx, campaignId, sessionId);
    const encounter = await loadEncounter(ctx, campaignId, encounterId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    assertCombat(prep!.scenes[i]!);
    await assertSceneFree(ctx, campaignId, prep!, i, encounter._id);
    if (sceneEncounterId(prep!.scenes[i]!, i, prep!) === encounter._id) return null;
    await linkScene(ctx, prep!, i, encounter._id);
    return null;
  },
});

/**
 * '+ Create encounter' on a Combat scene: a D8 draft named after the scene ('<title>', else 'Session N · Scene K')
 * with the active PCs as its party size, linked to the scene. SESSION_SCENE_STATE for a non-Combat scene,
 * SESSION_HAS_ENCOUNTER when the scene already shows one, ENCOUNTER_LIMIT past MAX_ENCOUNTERS. Retry-safe.
 */
export const createSceneEncounter = keyedGmMutation({
  args: { sessionId: v.string(), sceneId: v.string() },
  returns: v.object({ encounterId: v.id("encounters") }),
  handler: async (ctx, { sessionId, sceneId }) =>
    ctx.once("session_prep_create_scene_encounter", { sessionId, sceneId }, async () => {
      const campaignId = ctx.campaign._id;
      const session = await loadSession(ctx, campaignId, sessionId);
      const prep = await sessionPrepOf(ctx, session._id);
      const i = sceneIndex(prep, sceneId);
      const scene = prep!.scenes[i]!;
      assertCombat(scene);
      await assertSceneFree(ctx, campaignId, prep!, i);
      const encounterId = await insertDraft(ctx, campaignId, scene.title ?? `Session ${session.n} · Scene ${i + 1}`);
      await linkScene(ctx, prep!, i, encounterId);
      return { encounterId };
    }),
});

/**
 * Drops a scene's encounter link; the encounter itself stays in the Adversaries tab. On the first Combat scene this
 * also drops the legacy session encounter it shows (Q6), so the scene ends up with none. A scene without one is a
 * no-op.
 */
export const unlinkSceneEncounter = gmMutation({
  args: { sessionId: v.string(), sceneId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    const scene = prep!.scenes[i]!;
    const legacyHere = scene.type === "combat" && prep!.encounterId !== undefined && prep!.scenes.findIndex((s) => s.type === "combat") === i;
    if (scene.encounterId === undefined && !legacyHere) return null;
    const scenes = prep!.scenes.map((s, j) => (j === i ? { ...s, encounterId: undefined } : s));
    await ctx.db.patch("sessionPrep", prep!._id, { scenes, ...(legacyHere ? { encounterId: undefined } : {}), updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------- the legacy session encounter (D10 Q1)

/**
 * Internal (JF3, user 2026-11-06): the old Sessions UI that created and linked the session's legacy encounter is gone
 * (the Journal links per scene); the e2e and convex-test seeding still use these two, through
 * `scripts/convex-e2e.mjs run` and `t.mutation(internal...)`. Not client-callable, so no access check.
 */

/**
 * Creates a D8 draft named 'Session N encounter' with the active PCs as its party size, under the same rules as
 * `encounters.create` (ENCOUNTER_LIMIT past MAX_ENCOUNTERS), and links it to the session. SESSION_HAS_ENCOUNTER when
 * one is linked already.
 */
export const createEncounter = internalMutation({
  args: { campaignId: v.id("campaigns"), sessionId: v.string() },
  returns: v.object({ encounterId: v.id("encounters") }),
  handler: async (ctx, { campaignId, sessionId }) => {
    const session = await loadSession(ctx, campaignId, sessionId);
    const prep = await ensurePrep(ctx, session);
    await assertNoEncounter(ctx, campaignId, prep);
    const encounterId = await insertDraft(ctx, campaignId, `Session ${session.n} encounter`);
    await ctx.db.patch("sessionPrep", prep._id, { encounterId, updatedAt: Date.now() });
    return { encounterId };
  },
});

/** Links an existing encounter of the campaign (NOT_FOUND otherwise). SESSION_HAS_ENCOUNTER when another is linked. */
export const linkEncounter = internalMutation({
  args: { campaignId: v.id("campaigns"), sessionId: v.string(), encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignId, sessionId, encounterId }) => {
    const session = await loadSession(ctx, campaignId, sessionId);
    const encounter = await loadEncounter(ctx, campaignId, encounterId);
    const prep = await ensurePrep(ctx, session);
    await assertNoEncounter(ctx, campaignId, prep, encounter._id);
    if (prep.encounterId === encounter._id) return null;
    await ctx.db.patch("sessionPrep", prep._id, { encounterId: encounter._id, updatedAt: Date.now() });
    return null;
  },
});
