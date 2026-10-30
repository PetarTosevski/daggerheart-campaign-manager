/**
 * Party rests and downtime moves (D5 T3, CB 105-106; decision 10: no solo rests).
 *
 * The GM starts a short or long rest (`start`; a fourth short rest in a row
 * is refused), each player picks two moves for their own character
 * (`choose`, one `restChoices` row per character), and the GM finishes it
 * (`finish`): server dice, the moves, the loadout cards' rest timing uses (CA4b:
 * `afterRest` before expiry, `afterLongRest` after a finished long rest's
 * expiry; convex/lib/cardHand.ts), expiry and class hooks, a long rest
 * wakes the Unconscious, GM Fear, frame hooks (convex/lib/restHooks.ts), and
 * one actionLog row per resting PC plus a campaign row, all in one group.
 * `interrupt` ends a rest early (a short rest gives nothing, a long rest
 * gives a short rest's benefits); `undo` reverts the latest rest's sheets and
 * Fear through the group and reopens it. Project ticks are not reverted
 * (plan note 11).
 * A finished long rest (not an interrupted one) also ticks each armed, active
 * long-term dashboard countdown set to Automatic once, keyed on the rest's
 * campaign row, and the undo takes those ticks back (countdowns-advanced K4,
 * Q3, D11; convex/countdownTracks.ts).
 * Martial Preparation (CB 48, dcm-bxp.63) is every resting PC's move on either
 * rest while a resting PC holds the Call of the Slayer mastery card; each
 * taker gains a Slayer Die (src/lib/domain/rest `applyMoves`).
 * Rest-time heritage features (SD-R, src/lib/domain/rest/feature-moves.ts),
 * applied in the same transaction and undo group: Hardy clears a Hit Point on
 * any rest that gives benefits, Efficient lets a short rest take one long rest
 * move, Celestial Trance allows a third move. Oasis (HF 27; DA5, user
 * 2026-10-30): a short rest (and an interrupted long rest) stores its downtime
 * dice and its Oasis holders on the rest row; after the dice are shown the
 * party has one reroll per holder (DA15, user 2026-10-30): any holder spends
 * one on any party member's die (`oasisReroll`, the same die again while the
 * pool lasts) and keeps the higher result, in the rest's undo group; each
 * holder closes their own panel (`closeOasis`), withdrawing their unused
 * reroll. `current`
 * offers Undo only while the rest's log rows are still undoable (the 30-day
 * snapshot strip, dcm-c26).
 */
import { v, type Infer } from "convex/values";

import { applyCountdownAction, CountdownRangeError, CountdownRuleError, MAX_COUNTDOWN_START } from "../src/lib/domain/countdowns/index";
import {
  allowedMoves,
  interruptedMoves,
  MOVE_LABELS,
  mustLongRest,
  restedSheet,
  SHORT_REST_LIMIT_MESSAGE,
  restFear,
  shortRestsSinceLong,
  type RestKind as DomainRestKind,
  type RestMove as DomainRestMove,
} from "../src/lib/domain/rest/index";
import {
  applyDieDelta,
  applyHardy,
  applyMovesWithDice,
  DIE_UNIT,
  efficientMoves,
  extraMoveGrants,
  NO_REST_FEATURES,
  oasisPool,
  oasisReroll as rerollDie,
  restFeaturesOf,
  restMoveSlots,
  validateFeatureChoice,
  type DiceMove as DomainDiceMove,
  type DowntimeDie,
  type RestFeatures,
} from "../src/lib/domain/rest/feature-moves";
import { holdsMartialPreparation } from "../src/lib/domain/session-features/holders";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId, undoEntry } from "./lib/actionLog";
import { tickLongTermOnRest } from "./countdownTracks";
import { runRestTiming } from "./lib/cardHand";
import { assertCanAct, loadCharacter, MAX_CHARACTERS_PER_CAMPAIGN, readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { gainFear } from "./lib/fear";
import { featureScope } from "./lib/featureScope";
import { campaignQuery, keyedGmMutation, keyedUserMutation, userQuery } from "./lib/functions";
import { restMovesFor, runRestHooks } from "./lib/restHooks";
import {
  downtimeDieValidator,
  restChoiceMoveValidator,
  restKindValidator,
  restMoveValidator,
  restStatusValidator,
  type DiceMove,
  type RestKind,
  type RestMove,
} from "./lib/validators/rests";
import { recordHistory } from "./tables/history";
import { assertSanctuaryLongRest } from "./trackers/horizon";

// The domain mirrors the stored validators; these fail typecheck if they drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const kindMatches: Same<RestKind, DomainRestKind> = true;
const moveMatches: Same<RestMove, DomainRestMove> = true;
const diceMoveMatches: Same<DiceMove, DomainDiceMove> = true;
void kindMatches;
void moveMatches;
void diceMoveMatches;

type StoredDie = Infer<typeof downtimeDieValidator>;

/** Rests read back to count short rests; a long rest is never this far back in practice. */
const REST_SCAN = 50;
/** The most resting PCs a rest takes: its undo group holds 50 rows, one of them the campaign's (review M5). */
const REST_PARTY_MAX = 49;

/** The campaign's resting PCs, or REST_RULE when there are more than an undo group holds. */
async function restingParty(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"characters">[]> {
  // Bounded by the campaign's character cap (convex/characters.ts).
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  const pcs = party.filter(resting);
  if (pcs.length > REST_PARTY_MAX) throw restRule(`A rest takes at most ${REST_PARTY_MAX} PCs.`);
  return pcs;
}

function restRule(message: string) {
  return appError("REST_RULE", message);
}

async function openRest(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"rests"> | null> {
  return ctx.db
    .query("rests")
    .withIndex("by_campaign_status_started", (q) => q.eq("campaignId", campaignId).eq("status", "open"))
    .first();
}

async function recentRests(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"rests">[]> {
  return ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(REST_SCAN);
}

async function choicesOf(ctx: QueryCtx, restId: Id<"rests">): Promise<Doc<"restChoices">[]> {
  // One row per resting PC (at most REST_PARTY_MAX), so the campaign's character cap bounds it.
  return ctx.db
    .query("restChoices")
    .withIndex("by_rest_character", (q) => q.eq("restId", restId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
}

/** A resting PC: active (not dead, retired or away, HF 127). Unconscious PCs rest but pick no moves (decision 9). */
const resting = (c: Doc<"characters">) => c.status === "active";

/**
 * Each resting PC's pickable moves for this rest. A sheet that fails to read gets the core moves. Read only while a
 * rest is open (`current`), bounded by the campaign's character cap.
 */
async function pickableMoves(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  kind: RestKind,
): Promise<{ characterId: Id<"characters">; moves: RestMove[]; efficient: RestMove[]; slots: number; trance: boolean; extraMoves: number; oasis: boolean }[]> {
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  const pcs = party.filter(resting).map((c) => ({ c, sheet: sheetOrNull(c) }));
  const martialPreparation = pcs.some(({ sheet }) => sheet !== null && holdsMartialPreparation(sheet));
  return pcs.map(({ c, sheet }) => {
    const rules = restMovesFor(campaign, sheet ?? { classId: "" }, { martialPreparation });
    const features = featuresOf(campaign, sheet);
    const base = allowedMoves(kind, rules.extra, rules.forbidden);
    // dcm-bxp.99.19.2: extra moves granted for this rest (Eloquent, CB 29).
    const extraMoves = sheet === null ? 0 : extraMoveGrants(sheet);
    return {
      characterId: c._id,
      moves: base,
      efficient: efficientMoves(kind, features, base, rules.forbidden),
      slots: restMoveSlots(features, extraMoves).max,
      trance: features.trance,
      extraMoves,
      oasis: kind === "short" && features.oasis,
    };
  });
}

/** The rest-time heritage features the sheet holds (Hardy, Efficient, Celestial Trance, Oasis; SD-R), none for an unreadable sheet. */
function featuresOf(campaign: Doc<"campaigns">, sheet: CharacterSheet | null): RestFeatures {
  return sheet === null ? NO_REST_FEATURES : restFeaturesOf(sheet, { hopeAndFear: featureScope(campaign).hopeAndFear });
}

/** The character's sheet, or null when it fails to read. */
function sheetOrNull(c: Doc<"characters">): CharacterSheet | null {
  try {
    return readSheet(c.sheet);
  } catch {
    return null;
  }
}

/**
 * Martial Preparation (Call of the Slayer mastery, CB 48): "Your party gains access to the Martial Preparation
 * downtime move" while a resting PC holds the mastery card (user 2026-10-22). Bounded by the campaign's character cap.
 */
async function partyHasMartialPreparation(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<boolean> {
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  return party.some((c) => {
    if (!resting(c)) return false;
    const sheet = sheetOrNull(c);
    return sheet !== null && holdsMartialPreparation(sheet);
  });
}

// ---------------------------------------------------------------- reads

/**
 * Whether the rest's actionLog group can still be undone: its first row is undoable and not undone. The daily
 * snapshot strip (`cleanup.stripActionLogSnapshots`) marks rows older than 30 days not undoable (dcm-c26), so an old
 * rest offers no Undo that `undo` would refuse with UNDO_STALE (dcm-bxp.63).
 */
async function groupUndoable(ctx: QueryCtx, campaignId: Id<"campaigns">, groupId: string | undefined): Promise<boolean> {
  if (groupId === undefined) return false;
  const [row] = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId))
    .take(1);
  return row !== undefined && row.undoable && row.undoneAt === undefined;
}

const choiceView = v.object({ characterId: v.id("characters"), moves: v.array(restChoiceMoveValidator) });
const movesView = v.object({
  characterId: v.id("characters"),
  moves: v.array(restMoveValidator),
  /** Efficient (CB 53): the long rest moves the PC can take one of on this short rest, with `choose`'s `efficient`. */
  efficient: v.array(restMoveValidator),
  /** Most moves the PC can pick: 2, +1 with Celestial Trance (CB 56), +1 per extra move granted (Eloquent, CB 29). */
  slots: v.number(),
  /** The PC holds Celestial Trance (CB 56): one of the extra slots is the trance's. */
  trance: v.boolean(),
  /** Extra downtime moves granted for this rest (Eloquent, CB 29: "an additional downtime move during their next rest"). */
  extraMoves: v.number(),
  /** The PC holds Oasis and this is a short rest: after the dice are shown, they add one reroll to the party's pool (HF 27). */
  oasis: v.boolean(),
});

/** A countdown Work on a Project can tick: the character's own project (not an Endurance or Lycanthropy countdown). */
const isProject = (c: Doc<"countdowns">, characterId: Id<"characters">) => c.ownerKey === characterId && c.kind === "project" && c.status !== "cancelled";

/**
 * The open rest with its choices and each resting PC's pickable moves (core,
 * frame and class moves, `restMovesFor`), the short-rest count (CB 105), and
 * the latest ended rest for undo. Everyone in the campaign.
 */
export const current = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({
    open: v.union(
      v.object({
        _id: v.id("rests"),
        kind: restKindValidator,
        startedAt: v.number(),
        gmOverride: v.boolean(),
        choices: v.array(choiceView),
        moves: v.array(movesView),
      }),
      v.null(),
    ),
    shortRestsSinceLong: v.number(),
    last: v.union(
      v.object({
        _id: v.id("rests"),
        kind: restKindValidator,
        status: restStatusValidator,
        finishedAt: v.union(v.number(), v.null()),
        fearRoll: v.union(v.number(), v.null()),
        fearGained: v.union(v.number(), v.null()),
        undoable: v.boolean(),
        /** The downtime dice it rolled, in roll order (`oasisReroll`'s `die` is the index); empty for older rows. */
        dice: v.array(downtimeDieValidator),
        /** The resting PCs who held Oasis when it ended; each adds one reroll to the party's pool (HF 27; DA15). */
        oasisHolders: v.array(v.id("characters")),
        /** The holders who closed their own Oasis panel (DA15); their unused reroll left the pool. */
        oasisClosed: v.array(v.id("characters")),
        /** The rerolls left in the party's Oasis pool (DA15): holders with an open panel whose reroll nobody spent. */
        oasisLeft: v.number(),
        /** The Oasis window is open (DA15): dice rolled and at least one holder has not closed their panel. */
        resultsOpen: v.boolean(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx) => {
    const rests = await recentRests(ctx, ctx.campaign._id);
    const open = rests.find((r) => r.status === "open") ?? null;
    const newest = rests[0];
    const last = newest !== undefined && newest.status !== "open" ? newest : null;
    return {
      open:
        open === null
          ? null
          : {
              _id: open._id,
              kind: open.kind,
              startedAt: open.startedAt,
              gmOverride: open.gmOverride ?? false,
              choices: (await choicesOf(ctx, open._id)).map((c) => ({ characterId: c.characterId, moves: c.moves })),
              moves: await pickableMoves(ctx, ctx.campaign, open.kind),
            },
      shortRestsSinceLong: shortRestsSinceLong(rests),
      last:
        last === null
          ? null
          : {
              _id: last._id,
              kind: last.kind,
              status: last.status,
              finishedAt: last.finishedAt ?? null,
              fearRoll: last.fearRoll ?? null,
              fearGained: last.fearGained ?? null,
              undoable: await groupUndoable(ctx, ctx.campaign._id, last.groupId),
              dice: last.dice ?? [],
              oasisHolders: last.oasisHolders ?? [],
              oasisClosed: last.oasisClosed ?? [],
              oasisLeft: oasisWindowOpen(last) ? oasisPool(last.dice ?? [], oasisPoolOf(last)).left : 0,
              resultsOpen: oasisWindowOpen(last),
            },
    };
  },
});

const projectView = v.object({
  _id: v.id("countdowns"),
  name: v.string(),
  startingValue: v.number(),
  currentValue: v.number(),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed"), v.literal("cancelled")),
});

/** A character's project countdowns (Work on a Project, CB 105; `kind` "project"), not cancelled. Everyone who can see the character. */
export const projects = userQuery({
  args: { characterId: v.id("characters") },
  returns: v.array(projectView),
  handler: async (ctx, { characterId }) => {
    const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "view");
    // A character has a handful of projects.
    const rows = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaign._id).eq("ownerKey", character._id))
      .collect();
    return rows
      .filter((c) => isProject(c, character._id))
      .map((c) => ({ _id: c._id, name: c.name, startingValue: c.startingValue, currentValue: c.currentValue, status: c.status }));
  },
});

// ---------------------------------------------------------------- the GM's rest

/**
 * Starts a party rest. A fourth short rest since the last long rest is refused
 * for everyone (CB 105, HF 176; decision 17 settled by RF2). GM only.
 */
export const start = keyedGmMutation({
  args: {
    kind: restKindValidator,
    /** @deprecated Ignored: the GM override is gone (RF2). Kept so older clients still validate; narrow it later. */
    override: v.optional(v.boolean()),
  },
  returns: v.object({ restId: v.id("rests") }),
  handler: async (ctx, { kind }) =>
    ctx.once("rest_start", { kind }, async () => {
      const campaignId = ctx.campaign._id;
      if ((await openRest(ctx, campaignId)) !== null) throw restRule("A rest is already under way.");
      if (mustLongRest(kind, shortRestsSinceLong(await recentRests(ctx, campaignId)))) throw restRule(SHORT_REST_LIMIT_MESSAGE);
      await restingParty(ctx, campaignId);
      // Journey to Horizon: a long rest only in a sanctuary (HF 176), refused before the rest opens.
      if (kind === "long") await assertSanctuaryLongRest(ctx, ctx.campaign);
      const restId = await ctx.db.insert("rests", {
        campaignId,
        kind,
        status: "open",
        startedBy: ctx.user._id,
        startedAt: Date.now(),
      });
      return { restId };
    }),
});

type Ending = { rest: Doc<"rests">; interrupted: boolean };

/**
 * Applies a rest: the moves (with server dice), expiry, class hooks, a long
 * rest's wake-up, frame hooks, GM Fear, project ticks, and the actionLog
 * group (one row per resting PC plus the campaign row). An interrupted long
 * rest runs as a short rest with short-rest moves (CB 105).
 */
async function applyRest(ctx: MutationCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, { rest, interrupted }: Ending) {
  const campaign = ctx.campaign;
  const kind: RestKind = interrupted ? "short" : rest.kind;
  const pcs = await restingParty(ctx, campaign._id);
  const before = new Map<Id<"characters">, CharacterSheet>(pcs.map((c) => [c._id, readSheet(c.sheet)]));

  const features = new Map<Id<"characters">, RestFeatures>(pcs.map((c) => [c._id, featuresOf(campaign, before.get(c._id)!)]));
  const allChoices = await choicesOf(ctx, rest._id);
  // Moves count only for PCs who can still act (not knocked out since choosing).
  const choices = allChoices
    .filter((c) => {
      const sheet = before.get(c.characterId);
      return sheet !== undefined && !sheet.conditions.includes("unconscious");
    })
    .map((c) => {
      const moves = c.moves.map((m) => ({
        move: m.move,
        ...(m.targetId !== undefined ? { targetId: m.targetId } : {}),
        ...(m.countdownId !== undefined ? { countdownId: m.countdownId } : {}),
      }));
      // dcm-bxp.99.19.58: Efficient (CB 53) keeps one long rest pick on an interrupted long rest.
      const efficient = features.get(c.characterId)?.efficient === true;
      return { characterId: c.characterId, moves: interrupted ? interruptedMoves(rest.kind, moves, efficient) : moves };
    });

  const input: Record<string, CharacterSheet> = {};
  for (const [id, sheet] of before) input[id] = sheet;
  const moved = applyMovesWithDice(kind, input, choices, rollDie);
  // The dice's ids are the resting PCs' (the moves' keys): map them back to typed ids without a cast (CD7).
  const pcIds = new Map<string, Id<"characters">>(pcs.map((c) => [c._id, c._id]));
  const storedDie = (d: DowntimeDie): StoredDie => {
    const characterId = pcIds.get(d.characterId)!;
    const targetId = d.targetId !== undefined ? pcIds.get(d.targetId) : undefined;
    return { characterId, move: d.move, ...(targetId !== undefined ? { targetId } : {}), sides: d.sides, bonus: d.bonus, rolled: d.rolled, value: d.value, rerolls: [] };
  };
  // Oasis (HF 27, "During a short rest"): on a short rest (an interrupted long rest runs as one) the dice and the
  // holders who can still act are stored, and each holder picks a die to reroll afterwards (`oasisReroll`).
  const oasisHolders =
    kind === "short" ? pcs.filter((c) => features.get(c._id)!.oasis && !before.get(c._id)!.conditions.includes("unconscious")).map((c) => c._id) : [];

  // Card timing uses (CA4b, convex/lib/cardHand.ts): `afterRest` before the rest's expiry (Wild Surge needs its effect
  // active to drop it), `afterLongRest` after a finished long rest's expiry (Inspirational Words' tokens).
  const sheets = new Map<Id<"characters">, CharacterSheet>();
  const cardLines = new Map<Id<"characters">, string[]>();
  for (const pc of pcs) {
    const sheet = moved.sheets[pc._id] ?? before.get(pc._id)!;
    const timed = runRestTiming(sheet, pc._id, "afterRest", rollDie);
    let rested = restedSheet(timed.sheet, kind);
    const lines = [...timed.lines];
    // Hardy (HF 29): "When you take a rest, you clear a Hit Point." Any rest; an interrupted long rest is a short one.
    const hardy = applyHardy(rested, features.get(pc._id)!);
    rested = hardy.sheet;
    if (hardy.line !== null) lines.push(hardy.line);
    if (kind === "long") {
      const long = runRestTiming(rested, pc._id, "afterLongRest", rollDie);
      rested = long.sheet;
      lines.push(...long.lines);
    }
    sheets.set(pc._id, rested);
    cardLines.set(pc._id, lines);
  }
  const hookLines = await runRestHooks(ctx, { campaign, rest, kind, interrupted, actorId: ctx.user._id, choices: allChoices, sheets, rng: rollDie });

  const projectLines: string[] = [];
  for (const work of moved.projects) {
    const name = moved.sheets[work.characterId]?.name ?? "A PC";
    if (work.countdownId === undefined) {
      projectLines.push(`${name}: the GM asks for a project action roll`);
      continue;
    }
    const countdownId = ctx.db.normalizeId("countdowns", work.countdownId);
    const countdown = countdownId === null ? null : await ctx.db.get("countdowns", countdownId);
    if (countdown === null || countdown.ownerKey !== work.characterId || countdown.campaignId !== campaign._id) continue;
    try {
      const next = applyCountdownAction(countdown, "advance");
      await ctx.db.patch("countdowns", countdown._id, {
        currentValue: next.currentValue,
        status: next.status,
        completedAt: next.completedNow ? Date.now() : countdown.completedAt,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId: campaign._id,
        kind: "countdown",
        action: "advance",
        countdownId: countdown._id,
        before: { currentValue: countdown.currentValue, status: countdown.status },
        after: { currentValue: next.currentValue, status: next.status },
      });
      projectLines.push(`${name}'s project “${countdown.name}”: ${next.currentValue} left${next.completedNow ? ", complete" : ""}`);
    } catch (error) {
      if (!(error instanceof CountdownRuleError || error instanceof CountdownRangeError)) throw error;
      projectLines.push(`${name}'s project “${countdown.name}” can't tick (${countdown.status})`);
    }
  }

  const fearRoll = rollDie(4);
  const { gained } = await gainFear(ctx, campaign._id, restFear(kind, fearRoll, pcs.length));

  const groupId = newGroupId();
  const label = interrupted ? "Interrupted long rest (short-rest benefits)" : rest.kind === "long" ? "Long rest" : "Short rest";
  for (const pc of pcs) {
    const after = sheets.get(pc._id)!;
    await saveSheet(ctx, pc._id, after);
    const lines = [...(moved.lines[pc._id] ?? []), ...(cardLines.get(pc._id) ?? [])];
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: pc._id,
      actorId: ctx.user._id,
      kind: "rest",
      visibility: "public",
      summary: `${label}${lines.length > 0 ? `: ${lines.join("; ")}` : ""}`,
      groupId,
      before: before.get(pc._id)!,
      undoable: true,
    });
  }
  const fearText = kind === "long" ? `1d4 ${fearRoll} + ${pcs.length} PCs` : `1d4 ${fearRoll}`;
  const campaignRowId = await logAction(ctx, {
    campaignId: campaign._id,
    actorId: ctx.user._id,
    kind: "rest",
    visibility: "public",
    summary: [`${label}: GM gains ${gained} Fear (${fearText})`, ...projectLines, ...hookLines].join("; "),
    groupId,
    fearDelta: gained,
    undoable: true,
  });

  // Long-term countdowns (CB p.164 "During a long rest, you should generally tick down a relevant long-term countdown
  // once"; Q3): only a finished long rest, after its own effects. The step text stays out of the public rows above.
  let countdownLines: string[] | undefined;
  if (!interrupted && rest.kind === "long") {
    const { lines, reminders } = await tickLongTermOnRest(ctx, campaign._id, campaignRowId, ctx.user._id);
    const notice = [...lines, ...reminders.map((name) => `Reminder: tick ${name}?`)];
    // GM-only and in the rest's group, so the rest's undo marks it undone too; skipped only for a party at the group cap.
    if (notice.length > 0 && pcs.length < REST_PARTY_MAX) {
      await logAction(ctx, {
        campaignId: campaign._id,
        actorId: ctx.user._id,
        kind: "countdown",
        visibility: "gm",
        summary: `Long rest: ${notice.join("; ")}`,
        groupId,
        undoable: true,
      });
    }
    if (lines.length > 0) countdownLines = lines;
  }

  await ctx.db.patch("rests", rest._id, {
    status: interrupted ? "interrupted" : "finished",
    finishedAt: Date.now(),
    fearRoll,
    fearGained: gained,
    groupId,
    ...(kind === "short" && moved.dice.length > 0 ? { dice: moved.dice.map(storedDie) } : {}),
    ...(oasisHolders.length > 0 ? { oasisHolders } : {}),
  });
  return { fearRoll, fearGained: gained, ...(countdownLines !== undefined ? { countdownLines } : {}) };
}

async function loadOpenRest(ctx: QueryCtx, campaignId: Id<"campaigns">, restId: Id<"rests">): Promise<Doc<"rests">> {
  const rest = await ctx.db.get("rests", restId);
  if (rest === null || rest.campaignId !== campaignId) throw appError("NOT_FOUND");
  if (rest.status !== "open") throw restRule("That rest is over.");
  return rest;
}

const endResult = v.object({
  fearRoll: v.union(v.number(), v.null()),
  fearGained: v.number(),
  /** GM only (finish is a GM mutation): each long-term countdown the long rest ticked, with its step (K4). */
  countdownLines: v.optional(v.array(v.string())),
});

/** Finishes the open rest and applies it (CB 105-106). GM only. */
export const finish = keyedGmMutation({
  args: { restId: v.id("rests") },
  returns: endResult,
  handler: async (ctx, { restId }) =>
    ctx.once("rest_finish", { restId }, async () => {
      const rest = await loadOpenRest(ctx, ctx.campaign._id, restId);
      return applyRest(ctx, { rest, interrupted: false });
    }),
});

/** Interrupts the open rest: a short rest gives nothing; a long rest gives a short rest's benefits (CB 105). GM only. */
export const interrupt = keyedGmMutation({
  args: { restId: v.id("rests") },
  returns: endResult,
  handler: async (ctx, { restId }) =>
    ctx.once("rest_interrupt", { restId }, async () => {
      const rest = await loadOpenRest(ctx, ctx.campaign._id, restId);
      if (rest.kind === "long") return applyRest(ctx, { rest, interrupted: true });
      await ctx.db.patch("rests", rest._id, { status: "interrupted", finishedAt: Date.now() });
      return { fearRoll: null, fearGained: 0 };
    }),
});

/**
 * Undoes the campaign's latest rest: every resting PC's sheet and the GM's
 * Fear come back through the actionLog group (UNDO_STALE once a PC has acted
 * since), and the rest reopens so the GM can finish it again. Project ticks
 * and frame tracker changes keep their own history (plan note 11). GM only.
 */
export const undo = keyedGmMutation({
  args: { restId: v.id("rests") },
  returns: v.object({ fearReverted: v.number() }),
  handler: async (ctx, { restId }) =>
    ctx.once("rest_undo", { restId }, async () => {
      const [newest] = await recentRests(ctx, ctx.campaign._id);
      if (newest === undefined || newest._id !== restId) {
        const rest = await ctx.db.get("rests", restId);
        if (rest === null || rest.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
        throw restRule("Only the latest rest can be undone.");
      }
      if (newest.groupId === undefined) throw restRule("That rest changed nothing to undo.");
      const groupId = newest.groupId;
      const rows = await ctx.db
        .query("actionLog")
        .withIndex("by_campaign_group", (q) => q.eq("campaignId", ctx.campaign._id).eq("groupId", groupId))
        .take(1);
      const [row] = rows;
      if (row === undefined) throw restRule("That rest changed nothing to undo.");
      const { fearReverted } = await undoEntry(ctx, ctx.user, row._id);
      await ctx.db.patch("rests", newest._id, {
        status: "open",
        finishedAt: undefined,
        fearRoll: undefined,
        fearGained: undefined,
        groupId: undefined,
        dice: undefined,
        oasisHolders: undefined,
        resultsClosedAt: undefined,
        oasisClosed: undefined,
      });
      return { fearReverted };
    }),
});

/** The rest's Oasis holders and who closed their panel (DA15), for `oasisPool` and `oasisReroll`. */
const oasisPoolOf = (rest: Doc<"rests">) => ({ holders: rest.oasisHolders ?? [], closed: rest.oasisClosed ?? [] });

/**
 * The ended rest's Oasis window is open (DA15, user 2026-10-30): it rolled dice, the GM did not close it for everyone
 * under DA5 (`resultsClosedAt`, no longer written) and at least one holder has not closed their own panel. Starting
 * the next rest ends it too (only the latest rest counts; the callers check that).
 */
function oasisWindowOpen(rest: Doc<"rests">): boolean {
  return (rest.dice ?? []).length > 0 && rest.resultsClosedAt === undefined && oasisPool(rest.dice ?? [], oasisPoolOf(rest)).open.length > 0;
}

/**
 * The latest ended rest of the campaign that ran as a short rest (a short rest, or an interrupted long one, CB 105),
 * for Oasis. NOT_FOUND for a rest of another campaign; REST_RULE otherwise.
 */
async function latestShortRest(ctx: MutationCtx, campaignId: Id<"campaigns">, restId: Id<"rests">): Promise<Doc<"rests">> {
  const rest = await ctx.db.get("rests", restId);
  if (rest === null || rest.campaignId !== campaignId) throw appError("NOT_FOUND");
  const ranShort = (rest.kind === "short" && rest.status === "finished") || (rest.kind === "long" && rest.status === "interrupted");
  if (!ranShort) throw restRule("Oasis rerolls a die of a short rest, once its downtime dice are rolled (HF 27).");
  const [newest] = await ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(1);
  if (newest === undefined || newest._id !== rest._id) throw restRule("Only the latest rest's downtime dice can be rerolled.");
  return rest;
}

/**
 * A Duneborne closes their own Oasis panel (DA15, user 2026-10-30; replaces DA5's GM-wide `closeResults`):
 * `characterId` is the Oasis holder (its owner or the GM acts). Closing withdraws the holder's unused reroll from the
 * party's pool; once every holder closed, the window is over. Closing twice is a no-op. REST_RULE when the rest is not
 * the latest ended short rest or the character held no Oasis at its end. Not logged: it changes no sheet, and the
 * rest's undo clears it with the dice.
 */
export const closeOasis = keyedUserMutation({
  args: { restId: v.id("rests"), characterId: v.id("characters") },
  returns: v.null(),
  handler: async (ctx, { restId, characterId }) =>
    ctx.once("rest_oasis_close", { restId, characterId }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const rest = await latestShortRest(ctx, campaign._id, restId);
      const { holders, closed } = oasisPoolOf(rest);
      if (!holders.includes(character._id)) throw restRule("Only a character who held Oasis (HF 27) during this rest has an Oasis panel.");
      if (!closed.includes(character._id)) await ctx.db.patch("rests", rest._id, { oasisClosed: [...closed, character._id] });
      return null;
    }),
});

/** The rows one undo group holds (`GROUP_MAX`, convex/lib/actionLog.ts): a reroll that would overflow it is refused. */
const UNDO_GROUP_MAX = 50;

/**
 * Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take
 * the higher result." The player picks the die after the dice are shown (user 2026-10-30, DA5): `characterId` is the
 * Oasis holder pressing the button (its owner or the GM acts), `die` the index of one of the latest rest's downtime
 * dice (any party member's). The rerolls are a party pool (DA15, user 2026-10-30): one per holder, spent by any holder
 * whose panel is open, on any die, the same die again while rerolls remain (an interrupted long rest runs as a short
 * one, CB 105). The server rolls, keeps the higher result and clears the difference on the move's target, logged in the
 * rest's actionLog group so the rest's undo reverts it. REST_RULE when the rest is not the latest ended short rest, the
 * character held no Oasis at its end or closed their panel, the die doesn't exist or the pool is empty.
 */
export const oasisReroll = keyedUserMutation({
  args: { restId: v.id("rests"), characterId: v.id("characters"), die: v.number() },
  returns: v.object({ rolled: v.number(), kept: v.number(), cleared: v.number() }),
  handler: async (ctx, { restId, characterId, die }) =>
    ctx.once("rest_oasis", { restId, characterId, die }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const rest = await latestShortRest(ctx, campaign._id, restId);
      // A rest the GM closed for everyone under DA5 stays closed (`resultsClosedAt`, no longer written).
      if (rest.resultsClosedAt !== undefined) throw restRule("The rest's results are closed: Oasis can no longer reroll its dice.");
      const groupId = rest.groupId;
      if (groupId === undefined) throw restRule("That rest rolled no downtime dice.");

      const dice = rest.dice ?? [];
      // The holder's panel is open and the pool holds a reroll (DA15); `rerollDie` throws REST_RULE otherwise.
      const pool = oasisPoolOf(rest);
      const r = rerollDie(dice, die, character._id, rollDie, pool);
      const old = dice[die]!;
      const kept = r.die.value;
      const spentFrom = pool.holders.find((h) => h === r.spentFrom)!;
      const stored = dice.map((d, i) => (i === die ? { ...d, value: kept, rerolls: [...d.rerolls, { holderId: character._id, rolled: r.rolled, kept, spentFrom }] } : d));

      // The rest's undo group must still hold the extra row (undo refuses a partial group).
      const group = await ctx.db
        .query("actionLog")
        .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaign._id).eq("groupId", groupId))
        .take(UNDO_GROUP_MAX);
      if (group.length >= UNDO_GROUP_MAX) throw restRule("This rest touched too many characters to add an Oasis reroll.");

      const targetId = old.targetId ?? old.characterId;
      const target = await ctx.db.get("characters", targetId);
      const mover = old.characterId === targetId ? target : await ctx.db.get("characters", old.characterId);
      const targetSheet = target !== null && target.campaignId === campaign._id ? readSheet(target.sheet) : null;
      const applied = targetSheet === null ? { sheet: null, cleared: 0 } : applyDieDelta(targetSheet, old.move, r.delta);
      if (targetSheet !== null && applied.sheet !== null && applied.cleared > 0) await saveSheet(ctx, targetId, applied.sheet);
      await ctx.db.patch("rests", rest._id, { dice: stored });

      const holderName = readSheet(character.sheet).name;
      const moverName = mover !== null ? (sheetOrNull(mover)?.name ?? "A PC") : "A PC";
      const on = old.targetId !== undefined && targetSheet !== null ? ` on ${targetSheet.name}` : "";
      const effect = applied.cleared > 0 ? `: clears ${applied.cleared} more ${DIE_UNIT[old.move]}` : "";
      await logAction(ctx, {
        campaignId: campaign._id,
        ...(targetSheet !== null ? { characterId: targetId } : {}),
        actorId: ctx.user._id,
        kind: "rest",
        visibility: "public",
        summary: `Oasis (${holderName}): rerolled ${moverName}'s ${MOVE_LABELS[old.move]}${on} d${old.sides} (${r.before}, then ${r.rolled}), kept ${kept}${effect}`,
        groupId,
        ...(targetSheet !== null && applied.cleared > 0 ? { before: targetSheet } : {}),
        undoable: true,
      });
      return { rolled: r.rolled, kept, cleared: applied.cleared };
    }),
});

// ---------------------------------------------------------------- the player's picks

/**
 * Sets a character's two downtime moves for the open rest (CB 105), three with
 * Celestial Trance (CB 56); with `efficient`, a Clank's short rest takes one
 * long rest move (CB 53; src/lib/domain/rest/feature-moves.ts). The character's owner or the GM; dead, away and unconscious characters can't
 * (CHARACTER_UNAVAILABLE). The moves are the rest's, with the frame and class
 * moves and without the frame's forbidden ones (`restMovesFor`: Beast Feast
 * refuses moves that clear Stress, clear HP or gain Hope, CB 278). An ally
 * target must be another resting PC of the campaign; a project countdown must
 * be one of the character's own projects.
 */
export const choose = keyedUserMutation({
  args: {
    restId: v.id("rests"),
    characterId: v.id("characters"),
    moves: v.array(restChoiceMoveValidator),
    /** The PC uses Efficient (Clank, CB 53) on this short rest: one of the moves may be a long rest move. */
    efficient: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { restId, characterId, moves, efficient: useEfficient }) =>
    ctx.once("rest_choose", { restId, characterId, moves, efficient: useEfficient ?? false }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const sheet = readSheet(character.sheet);
      assertCanAct(character, sheet);
      if (character.status !== "active") throw appError("CHARACTER_UNAVAILABLE");
      const rest = await loadOpenRest(ctx, campaign._id, restId);
      const rules = restMovesFor(campaign, sheet, { martialPreparation: await partyHasMartialPreparation(ctx, campaign._id) });
      const features = featuresOf(campaign, sheet);
      const base = allowedMoves(rest.kind, rules.extra, rules.forbidden);
      // Efficient's long rest moves only when the player uses it, so a Clank's short rest otherwise checks as anyone's.
      const efficient = useEfficient === true ? efficientMoves(rest.kind, features, base, rules.forbidden) : [];
      validateFeatureChoice(
        characterId,
        moves.map((m) => ({ move: m.move, targetId: m.targetId, countdownId: m.countdownId })),
        [...base, ...efficient],
        features,
        efficient,
        extraMoveGrants(sheet),
      );
      for (const m of moves) {
        if (m.targetId !== undefined) {
          const target = await ctx.db.get("characters", m.targetId);
          if (target === null || target.campaignId !== campaign._id || !resting(target)) throw restRule(`${MOVE_LABELS[m.move]} needs a resting ally.`);
        }
        if (m.countdownId !== undefined) {
          const countdown = await ctx.db.get("countdowns", m.countdownId);
          if (countdown === null || countdown.campaignId !== campaign._id || !isProject(countdown, characterId)) {
            throw restRule("Pick one of this character's projects.");
          }
        }
      }
      const existing = await ctx.db
        .query("restChoices")
        .withIndex("by_rest_character", (q) => q.eq("restId", restId).eq("characterId", characterId))
        .unique();
      const row = { moves, updatedBy: ctx.user._id, updatedAt: Date.now() };
      if (existing === null) await ctx.db.insert("restChoices", { campaignId: campaign._id, restId, characterId, ...row });
      else await ctx.db.patch("restChoices", existing._id, row);
      return null;
    }),
});

/**
 * Establishes a project (CB 105, "Working on a Project in Downtime"): a
 * Progress Countdown owned by the character (`ownerKey` = its id), off the
 * dashboard list, ticked by Work on a Project. The character's owner or the GM.
 */
export const createProject = keyedUserMutation({
  args: { characterId: v.id("characters"), name: v.string(), startingValue: v.number() },
  returns: v.object({ countdownId: v.id("countdowns") }),
  handler: async (ctx, { characterId, name, startingValue }) =>
    ctx.once("rest_project", { characterId, name, startingValue }, async () => {
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit");
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 80) throw appError("INVALID", "Name the project (at most 80 characters).");
      if (!Number.isInteger(startingValue) || startingValue < 1 || startingValue > MAX_COUNTDOWN_START) {
        throw appError("INVALID", `A project countdown starts between 1 and ${MAX_COUNTDOWN_START}.`);
      }
      const countdownId = await ctx.db.insert("countdowns", {
        campaignId: campaign._id,
        name: trimmed,
        description: "",
        category: "project",
        startingValue,
        currentValue: startingValue,
        status: "active",
        consequence: "",
        createdAt: Date.now(),
        ownerKey: character._id,
        kind: "project",
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId: campaign._id,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: startingValue, status: "active" },
      });
      return { countdownId };
    }),
});
