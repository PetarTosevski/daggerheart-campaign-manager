import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";

import { modelForPass } from "../src/lib/lorekeeper/flow";
import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { lorekeeperAvailable, modelFor } from "./lib/claude";
import { campaignMutation, campaignQuery } from "./lib/functions";
import { reserve } from "./lib/lorekeeper/caps";
import {
  answerPhaseValidator,
  conversationVisibilityValidator,
  failureCodeValidator,
  IN_FLIGHT_STATUSES,
  LOREKEEPER_LIMITS,
  messageRoleValidator,
  messageStatusValidator,
  partsValidator,
} from "./lib/validators/lorekeeper";
import { deleteConversationBatch, settleReservation, WATCHDOG_MS } from "./lorekeeperRun";

/**
 * The Lorekeeper's chat (D13 L3, plan `.omc/plans/d13-lorekeeper.yaml`; analysis 4, option A). `ask` stores the
 * question and a pending answer row and schedules `lorekeeperRun.run`, which streams the Messages API reply into
 * that row (patched about every 250 ms); clients see it through `listMessages`. `stop` ends an answer (Q11).
 *
 * Who reads what (Q3, Q10): a conversation is readable by every campaign member unless its asker made it private;
 * a private one exists only for its asker (anyone else gets LOREKEEPER_NOT_FOUND, the GM included). Only the asker
 * asks in, stops, toggles, makes private or deletes their own conversation. No prompt ever holds GM-only data (Q4,
 * `buildContext`), so a public conversation leaks nothing secret.
 */

// ---------------------------------------------------------------- shapes

/** A conversation row as a member sees it (no other fields: `userId` lets the UI name the asker from the roster). */
const conversationView = v.object({
  _id: v.id("lorekeeperConversations"),
  title: v.string(),
  userId: v.id("users"),
  /** The caller asked it (and may ask in it, toggle, make private and delete it). */
  mine: v.boolean(),
  visibility: conversationVisibilityValidator,
  webSearch: v.boolean(),
  messageCount: v.number(),
  lastAt: v.number(),
  createdAt: v.number(),
});
export type ConversationView = Infer<typeof conversationView>;

/** A message as a reader sees it: never the reservation, the usage or the raw failure. */
const messageView = v.object({
  _id: v.id("lorekeeperMessages"),
  _creationTime: v.number(),
  conversationId: v.id("lorekeeperConversations"),
  role: messageRoleValidator,
  status: messageStatusValidator,
  text: v.string(),
  parts: v.optional(partsValidator),
  errorCode: v.optional(failureCodeValidator),
  model: v.optional(v.string()),
  checkedAgain: v.optional(v.boolean()),
  /** L11 (widened): where an in-flight answer is; the card shows it while no final text is visible. */
  phase: v.optional(answerPhaseValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type MessageView = Infer<typeof messageView>;

function toConversationView(row: Doc<"lorekeeperConversations">, me: Id<"users">): ConversationView {
  return {
    _id: row._id,
    title: row.title,
    userId: row.userId,
    mine: row.userId === me,
    visibility: row.visibility,
    webSearch: row.webSearch,
    messageCount: row.messageCount,
    lastAt: row.lastAt,
    createdAt: row.createdAt,
  };
}

/**
 * L12: the row is the view. The run writes text and parts only for a pass whose answer it keeps (a live book pass,
 * the kept book answer and the web part during the internet pass), so an in-flight row in 'retry' or 'web' may carry
 * text; a hidden pass never writes any (L11's blanking here is gone: it would hide the live retry and web pass).
 */
function toMessageView(row: Doc<"lorekeeperMessages">): MessageView {
  const view: MessageView = {
    _id: row._id,
    _creationTime: row._creationTime,
    conversationId: row.conversationId,
    role: row.role,
    status: row.status,
    text: row.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.parts !== undefined) view.parts = row.parts;
  if (row.errorCode !== undefined) view.errorCode = row.errorCode;
  if (row.model !== undefined) view.model = row.model;
  if (row.checkedAgain !== undefined) view.checkedAgain = row.checkedAgain;
  if (row.phase !== undefined) view.phase = row.phase;
  return view;
}

// ---------------------------------------------------------------- access helpers

type CampaignCtx = (QueryCtx | MutationCtx) & { user: Doc<"users">; campaign: Doc<"campaigns"> };

/** A conversation of this campaign the caller may read (public, or their own), else LOREKEEPER_NOT_FOUND. */
async function readableConversation(ctx: CampaignCtx, id: Id<"lorekeeperConversations">) {
  const row = await ctx.db.get("lorekeeperConversations", id);
  if (row === null || row.campaignId !== ctx.campaign._id) throw appError("LOREKEEPER_NOT_FOUND");
  if (row.userId !== ctx.user._id && row.visibility === "private") throw appError("LOREKEEPER_NOT_FOUND");
  return row;
}

/** The caller's own conversation in this campaign, else LOREKEEPER_NOT_FOUND (a public one of another member too). */
async function ownConversation(ctx: CampaignCtx, id: Id<"lorekeeperConversations">) {
  const row = await ctx.db.get("lorekeeperConversations", id);
  if (row === null || row.campaignId !== ctx.campaign._id || row.userId !== ctx.user._id) throw appError("LOREKEEPER_NOT_FOUND");
  return row;
}

/** The caller's answer in flight in this campaign, if any (at most one: LOREKEEPER_BUSY). */
async function inFlightAnswer(ctx: CampaignCtx) {
  for (const status of IN_FLIGHT_STATUSES) {
    const row = await ctx.db
      .query("lorekeeperMessages")
      .withIndex("by_campaign_user_status", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id).eq("status", status))
      .first();
    if (row !== null) return row;
  }
  return null;
}

/** A conversation's title: its first question on one line, cut. */
function titleOf(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  const max = LOREKEEPER_LIMITS.conversationTitle;
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------- queries

/** Whether the Lorekeeper can answer on this deployment (a key or the e2e fake model). A boolean only. */
export const available = campaignQuery({
  need: "view",
  args: {},
  returns: v.boolean(),
  handler: async () => lorekeeperAvailable(),
});

/**
 * The conversations menu: the caller's own (newest first, at most 30) and the other members' public ones (newest
 * first, at most 30). Private conversations of others never appear (Q3).
 */
export const listConversations = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({ mine: v.array(conversationView), shared: v.array(conversationView) }),
  handler: async (ctx) => {
    const me = ctx.user._id;
    const mine = await ctx.db
      .query("lorekeeperConversations")
      .withIndex("by_campaign_user_last", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", me))
      .order("desc")
      .take(30);
    // Read past the caller's own public ones so others still fill the list (bounded: 60 rows).
    const publicRows = await ctx.db
      .query("lorekeeperConversations")
      .withIndex("by_campaign_visibility_last", (q) => q.eq("campaignId", ctx.campaign._id).eq("visibility", "campaign"))
      .order("desc")
      .take(60);
    const shared = publicRows.filter((row) => row.userId !== me).slice(0, 30);
    return { mine: mine.map((row) => toConversationView(row, me)), shared: shared.map((row) => toConversationView(row, me)) };
  },
});

/** One readable conversation (title, toggle, visibility); LOREKEEPER_NOT_FOUND for another member's private one. */
export const getConversation = campaignQuery({
  need: "view",
  args: { conversationId: v.id("lorekeeperConversations") },
  returns: conversationView,
  handler: async (ctx, { conversationId }) => toConversationView(await readableConversation(ctx, conversationId), ctx.user._id),
});

/** A readable conversation's messages, newest first (the client reverses them), paginated. */
export const listMessages = campaignQuery({
  need: "view",
  args: { conversationId: v.id("lorekeeperConversations"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(messageView),
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const conversation = await readableConversation(ctx, conversationId);
    const result = await ctx.db
      .query("lorekeeperMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: result.page.map(toMessageView) };
  },
});

// ---------------------------------------------------------------- mutations

/**
 * Asks a question: in the caller's conversation `conversationId`, or in a new one (public unless `visibility` says
 * private; Q3). Stores the question and a pending answer, books the worst-case cost against the caps (same
 * transaction), and schedules the answer run and its watchdog. `webSearch` is the conversation's 'If the books
 * don’t say' toggle (stored on the conversation).
 */
export const ask = campaignMutation({
  need: "view",
  rateLimit: "lorekeeperAsk",
  args: {
    conversationId: v.optional(v.id("lorekeeperConversations")),
    question: v.string(),
    webSearch: v.boolean(),
    visibility: v.optional(conversationVisibilityValidator),
  },
  returns: v.object({ conversationId: v.id("lorekeeperConversations"), answerId: v.id("lorekeeperMessages") }),
  handler: async (ctx, args) => {
    const question = args.question.trim();
    if (question.length === 0 || question.length > LOREKEEPER_LIMITS.question) throw appError("LOREKEEPER_QUESTION_INVALID");
    if (!lorekeeperAvailable()) throw appError("LOREKEEPER_UNAVAILABLE");
    const existing = args.conversationId === undefined ? null : await ownConversation(ctx, args.conversationId);
    // Never delete old messages: a full conversation refuses, and the UI offers a new one.
    if (existing !== null && existing.messageCount + 2 > LOREKEEPER_LIMITS.messagesPerConversation) throw appError("LOREKEEPER_CONVERSATION_FULL");
    if ((await inFlightAnswer(ctx)) !== null) throw appError("LOREKEEPER_BUSY");

    const now = Date.now();
    const reserved = await reserve(ctx, ctx.user, ctx.campaign, modelForPass("primary", modelFor("answer")), now);

    let conversationId: Id<"lorekeeperConversations">;
    if (existing === null) {
      conversationId = await ctx.db.insert("lorekeeperConversations", {
        campaignId: ctx.campaign._id,
        userId: ctx.user._id,
        title: titleOf(question),
        visibility: args.visibility ?? "campaign",
        webSearch: args.webSearch,
        messageCount: 2,
        lastAt: now,
        createdAt: now,
      });
    } else {
      conversationId = existing._id;
      await ctx.db.patch("lorekeeperConversations", existing._id, { webSearch: args.webSearch, messageCount: existing.messageCount + 2, lastAt: now });
    }
    const base = { conversationId, campaignId: ctx.campaign._id, userId: ctx.user._id, createdAt: now, updatedAt: now };
    await ctx.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: question });
    const answerId = await ctx.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "pending", text: "", phase: "books", reserved });
    await ctx.scheduler.runAfter(0, internal.lorekeeperRun.run, { answerId });
    await ctx.scheduler.runAfter(WATCHDOG_MS, internal.lorekeeperRun.watchdog, { answerId });
    return { conversationId, answerId };
  },
});

/**
 * Stops the caller's own answer (Q11): it ends as `stopped` with the text so far (or, with no answer ready yet, the
 * run's `finalize` / `release` stores STOPPED_EARLY_NOTE, L12); the run sees it at its next patch
 * and aborts the stream. The open reservation is released now; the run settles what the stream really cost. A finished
 * answer is left as it is.
 */
export const stop = campaignMutation({
  need: "view",
  args: { answerId: v.id("lorekeeperMessages") },
  returns: v.null(),
  handler: async (ctx, { answerId }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (row === null || row.campaignId !== ctx.campaign._id || row.userId !== ctx.user._id || row.role !== "answer") throw appError("LOREKEEPER_NOT_FOUND");
    if (row.status !== "pending" && row.status !== "streaming") return null;
    await ctx.db.patch("lorekeeperMessages", row._id, { status: "stopped", phase: "done", updatedAt: Date.now() });
    await settleReservation(ctx, row, row.reserved?.micros ?? 0, 0);
    return null;
  },
});

/** Sets the caller's conversation's 'If the books don’t say' toggle (true: 'Search the internet too'). */
export const setWebSearch = campaignMutation({
  need: "view",
  args: { conversationId: v.id("lorekeeperConversations"), webSearch: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { conversationId, webSearch }) => {
    const row = await ownConversation(ctx, conversationId);
    if (row.webSearch !== webSearch) await ctx.db.patch("lorekeeperConversations", row._id, { webSearch });
    return null;
  },
});

/** Makes the caller's conversation private or public to the campaign again (Q3). */
export const setVisibility = campaignMutation({
  need: "view",
  args: { conversationId: v.id("lorekeeperConversations"), visibility: conversationVisibilityValidator },
  returns: v.null(),
  handler: async (ctx, { conversationId, visibility }) => {
    const row = await ownConversation(ctx, conversationId);
    if (row.visibility !== visibility) await ctx.db.patch("lorekeeperConversations", row._id, { visibility });
    return null;
  },
});

/**
 * Deletes the caller's own conversation (Q10: only its asker, by hand). Refused with LOREKEEPER_BUSY while one of
 * its answers is on its way. The conversation goes now; its messages (and their Ask-the-GM requests) go in bounded
 * batches, the rest by a scheduled internal job.
 */
export const removeConversation = campaignMutation({
  need: "view",
  args: { conversationId: v.id("lorekeeperConversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    const row = await ownConversation(ctx, conversationId);
    const busy = await inFlightAnswer(ctx);
    if (busy !== null && busy.conversationId === row._id) throw appError("LOREKEEPER_BUSY");
    await ctx.db.delete("lorekeeperConversations", row._id);
    const more = await deleteConversationBatch(ctx, row._id);
    if (more) await ctx.scheduler.runAfter(0, internal.lorekeeperRun.purgeConversation, { conversationId: row._id });
    return null;
  },
});
