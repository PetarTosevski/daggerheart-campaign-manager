import { v } from "convex/values";

import { budgetFor, spentFor, verdict, type BudgetEntry } from "../src/lib/domain/encounters/budget";
import { appError } from "../src/lib/errors/app-error";
import { ADVERSARIES } from "../src/lib/srd/adversaries";
import type { AdversaryType } from "../src/lib/srd/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { loadEncounter, MAX_ENCOUNTERS, MAX_INSTANCES, MAX_PCS } from "./lib/encounters";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { cleanText, currentSessionEncounter, loadSession, sessionPrepOf } from "./lib/sessions";
import { encounterStatusValidator } from "./lib/validators/encounters";
import { MAX_SCENES, sessionSceneTypeValidator, sessionSceneValidator } from "./lib/validators/sessions";

/**
 * Session prep (D10 S4, plan `.omc/plans/d10-sessions.yaml`, rules B3, K6, K10 and Q1): the GM's planned scenes,
 * 'Hooks & loose threads' and the session's one D8 encounter. GM-only on the server (every function is a GM wrapper:
 * a player gets FORBIDDEN, an outsider NOT_FOUND). The prep row is created by the first write (`sessionPrepOf` null
 * = empty prep). The encounter itself stays D8's (convex/encounters.ts edits it); this file only creates the
 * session's draft and keeps the link on `sessionPrep.encounterId`, which may dangle after D8 deletes the encounter
 * (read as no encounter).
 */

/** Party size when the campaign has no active character (D8's default, convex/encounters.ts). */
const DEFAULT_PCS = 4;
/** Characters read to count the active ones (as D8's `create`). */
const MAX_CHARACTERS_READ = 100;

const SRD_BY_ID = new Map(ADVERSARIES.map((a) => [a.id, a]));

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

const prepValidator = v.object({
  scenes: v.array(sessionSceneValidator),
  hooks: v.string(),
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

/** The linked encounter when it still exists in this campaign; a dangling or foreign id reads as none (S0). */
async function linkedEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">, prep: Doc<"sessionPrep"> | null): Promise<Doc<"encounters"> | null> {
  if (!prep?.encounterId) return null;
  const encounter = await ctx.db.get("encounters", prep.encounterId);
  return encounter !== null && encounter.campaignId === campaignId ? encounter : null;
}

/** The instance's stat block type and tier (SRD bundle or the campaign's custom adversary; null when it is gone). */
async function budgetEntries(ctx: QueryCtx, encounter: Doc<"encounters">): Promise<BudgetEntry[]> {
  const rows = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES);
  const customs = new Map<Id<"customAdversaries">, { type: AdversaryType; tier: number } | null>();
  const entries: BudgetEntry[] = [];
  for (const row of rows) {
    let block: { type: AdversaryType; tier: number } | null;
    if (row.source.kind === "srd") {
      block = SRD_BY_ID.get(row.source.adversaryId) ?? null;
    } else {
      const customId = row.source.customId;
      if (!customs.has(customId)) {
        const custom = await ctx.db.get("customAdversaries", customId);
        customs.set(customId, custom && custom.campaignId === encounter.campaignId ? custom : null);
      }
      block = customs.get(customId) ?? null;
    }
    entries.push({ type: block?.type ?? null, tier: block?.tier ?? null, summoned: row.summoned, minionCount: row.minionCount });
  }
  return entries;
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

// ---------------------------------------------------------------- query

/**
 * The session's prep: scenes in order, hooks ('' when none) and the linked encounter's summary with its Battle Points
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
    let summary = null;
    if (encounter !== null) {
      const entries = await budgetEntries(ctx, encounter);
      const budget = budgetFor(encounter.pcs, encounter.adjustments);
      const spent = spentFor(entries, encounter.pcs);
      summary = {
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
    return { scenes: prep?.scenes ?? [], hooks: prep?.hooks ?? "", encounter: summary };
  },
});

/**
 * The Sessions hub's link back (TASK-SESSIONS-HUB): the live session, else the newest planned one, when it links an
 * encounter that still exists, with that encounter's id; null otherwise. The encounter tracker shows a 'Session N'
 * chip when its open encounter is this one. GM-only (K10: players never see session prep).
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

/** One scene's type or text (exactly one of them; INVALID otherwise). Text is trimmed, at most 300 characters. */
export const setScene = gmMutation({
  args: { sessionId: v.string(), sceneId: v.string(), type: v.optional(sessionSceneTypeValidator), text: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sessionId, sceneId, type, text }) => {
    if ((type === undefined) === (text === undefined)) throw appError("INVALID", "Change the scene's type or its text.");
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    const i = sceneIndex(prep, sceneId);
    const patch = type !== undefined ? { type } : { text: cleanText("scene", text!) };
    const scenes = prep!.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s));
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

// ---------------------------------------------------------------- the session encounter (Q1)

/**
 * 'Create the session encounter': a D8 draft named 'Session N encounter' with the active PCs as its party size, under
 * the same rules as `encounters.create` (ENCOUNTER_LIMIT past MAX_ENCOUNTERS), linked to the session.
 * SESSION_HAS_ENCOUNTER when one is linked already. Retry-safe.
 */
export const createEncounter = keyedGmMutation({
  args: { sessionId: v.string() },
  returns: v.object({ encounterId: v.id("encounters") }),
  handler: async (ctx, { sessionId }) =>
    ctx.once("session_prep_create_encounter", { sessionId }, async () => {
      const campaignId = ctx.campaign._id;
      const session = await loadSession(ctx, campaignId, sessionId);
      const prep = await ensurePrep(ctx, session);
      await assertNoEncounter(ctx, campaignId, prep);
      const existing = await ctx.db
        .query("encounters")
        .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
        .take(MAX_ENCOUNTERS);
      if (existing.length >= MAX_ENCOUNTERS) throw appError("ENCOUNTER_LIMIT");
      const now = Date.now();
      const encounterId = await ctx.db.insert("encounters", {
        campaignId,
        name: `Session ${session.n} encounter`,
        status: "draft",
        pcs: await activePcs(ctx, campaignId),
        adjustments: [],
        gmTurn: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("sessionPrep", prep._id, { encounterId, updatedAt: now });
      return { encounterId };
    }),
});

/** Links an existing encounter of the campaign (NOT_FOUND otherwise). SESSION_HAS_ENCOUNTER when another is linked. */
export const linkEncounter = gmMutation({
  args: { sessionId: v.string(), encounterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, encounterId }) => {
    const campaignId = ctx.campaign._id;
    const session = await loadSession(ctx, campaignId, sessionId);
    const encounter = await loadEncounter(ctx, campaignId, encounterId);
    const prep = await ensurePrep(ctx, session);
    await assertNoEncounter(ctx, campaignId, prep, encounter._id);
    if (prep.encounterId === encounter._id) return null;
    await ctx.db.patch("sessionPrep", prep._id, { encounterId: encounter._id, updatedAt: Date.now() });
    return null;
  },
});

/** Drops the session's link; the encounter itself stays in the Adversaries tab. A session without one is a no-op. */
export const unlinkEncounter = gmMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const prep = await sessionPrepOf(ctx, session._id);
    if (prep?.encounterId === undefined) return null;
    await ctx.db.patch("sessionPrep", prep._id, { encounterId: undefined, updatedAt: Date.now() });
    return null;
  },
});
