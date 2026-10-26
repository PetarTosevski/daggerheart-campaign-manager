import { v, type Infer } from "convex/values";

import { createAnswerParser, type AnswerSnapshot, type ApiCitation } from "../src/lib/lorekeeper/answer";
import { BOOKS_ONLY_MISS, STOPPED_EARLY_NOTE, WEB_MISS, WEB_UNAVAILABLE } from "../src/lib/lorekeeper/copy";
import { modelForPass, nextStep, phaseForPass, streamsLive, type AnswerPhase, type Pass } from "../src/lib/lorekeeper/flow";
import { addUsage, costMicros, ZERO_USAGE, type TokenUsage } from "../src/lib/lorekeeper/pricing";
import { REFUSAL_FALLBACK_BETA, requestBody, WEB_SEARCH_MAX_USES } from "../src/lib/lorekeeper/prompt";
import type { HistoryTurn, PromptChunk, PromptContext, PromptRuling, Quote as ParsedQuote } from "../src/lib/lorekeeper/types";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { ClaudeFailure, messagesStream, modelFor, OPUS, SONNET, type StreamResult } from "./lib/claude";
import { buildContext } from "./lib/lorekeeper/context";
import { reservePass, settle, type UsageScopes } from "./lib/lorekeeper/caps";
import { retrieve } from "./lib/lorekeeper/retrieve";
import { webPass } from "./lib/lorekeeper/web";
import { answerPhaseValidator, LOREKEEPER_LIMITS, verdictValidator, webResultValidator, type AnswerParts, type FailureCode, type Quote } from "./lib/validators/lorekeeper";

/**
 * The answer run of the Lorekeeper (D13 L3; analysis 4, option A). `lorekeeper.ask` schedules `run` for a pending
 * answer row; `run` reads everything it needs in one `prepare` query, streams the Messages API reply and patches the
 * row through `appendAnswer` about every 250 ms (or 200 new characters), then writes the final parts, usage and model
 * with `finalize`. Each patch returns whether the row is still in flight: a Stop (`lorekeeper.stop`) or the watchdog
 * makes it answer false, and the run aborts its stream.
 *
 * Passes (Q2, `nextStep`): Sonnet answers; a verdict other than 'rules' gets one automatic Opus retry ('Checked again
 * with a stronger model'). With the conversation's toggle on, an Opus verdict of 'unclear'
 * or 'none' gets the internet pass (L10 D1):
 * - 'unclear' + web results: the book answer (verdict, quotes, GM call) is kept, its prose gets the web note
 *   appended and the web results go under it (D2); 'unclear' + no web results: the Opus answer unchanged;
 * - 'none' + web results: the web answer (verdict 'none'); 'none' + a search that found nothing usable: WEB_MISS
 *   (D3); 'none' + a pass that couldn't run (no budget, HTTP error, timeout): WEB_UNAVAILABLE (dcm-bxp.82.5).
 * With the toggle off an 'unclear' answer stands and a 'none' stores the books-only miss.
 *
 * Think before showing (L11, user decision 2026-10-22, binding), widened by L12 (user answers 2026-10-22, binding):
 * a pass writes into the row live only when its text is known to be the text the run keeps, and shown text only ever
 * grows (the writer never writes a text that does not extend what it wrote before).
 * - A book pass streams once its verdict line says the run ends with it (`streamsLive`): a first-pass 'rules'; a
 *   retry 'rules', or a retry 'unclear' with search off. Any other book pass runs hidden.
 * - The web pass streams once it has its first web result (until then a web miss is still possible). For 'unclear'
 *   the kept book answer is written when the web pass starts and the web note writes out under it; for 'none' the web
 *   answer writes out; a miss stores WEB_MISS or WEB_UNAVAILABLE (never shown before).
 * - The row's `phase` names the pass really running, set as the pass starts (`phaseForPass`): 'books' -> 'retry'
 *   (only once the Opus pass starts) -> 'web' (only once the internet pass starts) -> 'done'.
 * A Stop keeps what the reader sees (a live pass's text so far), else the best finished answer (the first pass's
 * while the retry runs hidden, the retry's while the web pass runs), never a hidden partial; with neither it stores
 * STOPPED_EARLY_NOTE. While a pass runs hidden the writer still touches `updatedAt` every HEARTBEAT_MS, so the
 * watchdog sees progress.
 *
 * Money (L5's contract, docs/tasks/TASK-D13-L5.md): `ask` reserves the primary pass's worst case; before the Opus
 * retry and the web pass the run reserves that pass (`caps.reservePass`; refused = the pass is skipped and the answer
 * it has is kept). The answer row's `reserved.micros` is always the reservation not yet settled. After each pass
 * (success, failure or Stop) the run settles that pass's real cost against its reservation (`settlePass`); Stop and
 * the watchdog release whatever is still reserved. Every settle takes at most what is still reserved
 * (`settleReservation`), so no order of Stop, watchdog, run and stale-run sweep counts a reservation twice. The
 * question stays counted (no refund).
 */

/** How often the run patches the streamed text (and checks for Stop). */
export const PATCH_MS = 250;
/** Patch early once this many new characters arrived. */
export const PATCH_CHARS = 200;
/** While a pass runs hidden (L11), how often its progress touches the row's `updatedAt` for the watchdog. */
export const HEARTBEAT_MS = 10_000;
/** The watchdog's period: an in-flight answer with no patch for this long ends as LOREKEEPER_TIMEOUT. */
export const WATCHDOG_MS = 3 * 60 * 1000;
/** Messages deleted per transaction when a conversation is deleted. */
export const DELETE_BATCH = 100;
/** History sent with a question: the last messages of the conversation (L1 keeps HISTORY_TURNS of them). */
const HISTORY_READ = 8;

// ---------------------------------------------------------------- shared helpers (also used by lorekeeper.ts)

function scopesOf(row: Doc<"lorekeeperMessages">, reserved: NonNullable<Doc<"lorekeeperMessages">["reserved"]>): UsageScopes {
  return { userId: row.userId, campaignId: row.campaignId, day: reserved.day, month: reserved.month };
}

/**
 * Settles `actualMicros` against up to `reservedMicros` of the row's open reservation (never more than is still
 * reserved), and lowers `reserved.micros` by what it took. `settleReservation(ctx, row, row.reserved.micros, 0)`
 * releases everything still reserved (Stop, watchdog).
 */
export async function settleReservation(ctx: MutationCtx, row: Doc<"lorekeeperMessages">, reservedMicros: number, actualMicros: number): Promise<void> {
  if (row.reserved === undefined) return;
  const take = Math.min(Math.max(0, reservedMicros), row.reserved.micros);
  await settle(ctx, scopesOf(row, row.reserved), take, actualMicros);
  if (take > 0) await ctx.db.patch("lorekeeperMessages", row._id, { reserved: { ...row.reserved, micros: row.reserved.micros - take } });
}

/** Deletes up to DELETE_BATCH messages of a conversation (and Ask-the-GM requests on them); true when more remain. */
export async function deleteConversationBatch(ctx: MutationCtx, conversationId: Id<"lorekeeperConversations">): Promise<boolean> {
  const rows = await ctx.db
    .query("lorekeeperMessages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .take(DELETE_BATCH);
  for (const row of rows) {
    if (row.role === "answer") {
      const asks = await ctx.db
        .query("lorekeeperAsks")
        .withIndex("by_message", (q) => q.eq("messageId", row._id))
        .take(10);
      for (const ask of asks) await ctx.db.delete("lorekeeperAsks", ask._id);
    }
    await ctx.db.delete("lorekeeperMessages", row._id);
  }
  return rows.length === DELETE_BATCH;
}

// ---------------------------------------------------------------- internal functions

/** Continues deleting a deleted conversation's messages, rescheduling itself while a full batch went. */
export const purgeConversation = internalMutation({
  args: { conversationId: v.id("lorekeeperConversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    if (await deleteConversationBatch(ctx, conversationId)) {
      await ctx.scheduler.runAfter(0, internal.lorekeeperRun.purgeConversation, { conversationId });
    }
    return null;
  },
});

/**
 * Everything one answer needs, in one transaction (CF8): the question, the toggle, the permitted context and
 * rulings (`buildContext`, as the asker), the retrieved chunks (`retrieve`) and the conversation's recent history.
 * Null when the answer is no longer pending (stopped before the run started, or deleted).
 */
export const prepare = internalQuery({
  args: { answerId: v.id("lorekeeperMessages") },
  handler: async (ctx, { answerId }) => {
    const answer = await ctx.db.get("lorekeeperMessages", answerId);
    if (answer === null || answer.role !== "answer" || answer.status !== "pending") return null;
    const [conversation, user, campaign] = await Promise.all([
      ctx.db.get("lorekeeperConversations", answer.conversationId),
      ctx.db.get("users", answer.userId),
      ctx.db.get("campaigns", answer.campaignId),
    ]);
    if (conversation === null || user === null || campaign === null) return null;

    const recent = await ctx.db
      .query("lorekeeperMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .order("desc")
      .take(HISTORY_READ + 2);
    const before = recent.filter((m) => m._creationTime < answer._creationTime);
    const questionRow = before[0];
    if (questionRow === undefined || questionRow.role !== "question") return null;
    const history: HistoryTurn[] = before
      .slice(1, HISTORY_READ + 1)
      .filter((m) => m.status === "done" && m.text.trim().length > 0)
      .reverse()
      .map((m) => ({ role: m.role, text: m.text }));

    const context = await buildContext(ctx, user, campaign);
    const retrieved = await retrieve(ctx, campaign, questionRow.text);
    const chunks: PromptChunk[] = retrieved.map((c) => ({ bookId: c.bookId, bookTitle: c.bookTitle, page: c.page, section: c.section, text: c.text }));
    // House-rule pages (Q7) are offered to the model as table rulings: GM calls shared with everyone.
    const rulings: PromptRuling[] = [
      ...context.rulings.map((r) => (r.id === undefined ? { title: r.title, text: r.text } : { id: r.id, title: r.title, text: r.text })),
      ...context.houseRules.map((r) => ({ title: r.title, text: r.text })),
    ];
    const promptContext: PromptContext = { frame: context.frame, characters: context.characters, party: context.party };
    return {
      question: questionRow.text,
      webSearch: conversation.webSearch,
      chunks,
      rulings,
      context: promptContext,
      history,
      reservedMicros: answer.reserved?.micros ?? 0,
    };
  },
});

/** A quote as the run sends it: L1's parsed quote, ids still strings (the mutation normalizes them, CD7). */
const streamQuoteValidator = v.object({
  kind: v.union(v.literal("book"), v.literal("ruling")),
  text: v.string(),
  bookId: v.optional(v.string()),
  page: v.optional(v.number()),
  section: v.string(),
  rulingId: v.optional(v.string()),
});
const streamPartsValidator = v.object({
  verdict: verdictValidator,
  quotes: v.array(streamQuoteValidator),
  call: v.optional(v.string()),
  web: v.optional(v.array(webResultValidator)),
});
type StreamParts = Infer<typeof streamPartsValidator>;

/** Stored parts from the run's parts: book quotes need a valid book id; texts are cut to the stored limits. */
function storedParts(ctx: MutationCtx, parts: StreamParts): AnswerParts {
  const quotes: Quote[] = [];
  for (const q of parts.quotes.slice(0, LOREKEEPER_LIMITS.quotes)) {
    const text = q.text.slice(0, LOREKEEPER_LIMITS.quote);
    const section = q.section.slice(0, LOREKEEPER_LIMITS.section);
    if (q.kind === "book") {
      const bookId = q.bookId === undefined ? null : ctx.db.normalizeId("lorekeeperBooks", q.bookId);
      if (bookId === null || q.page === undefined) continue;
      quotes.push({ kind: "book", text, bookId, page: q.page, section });
    } else {
      const rulingId = q.rulingId === undefined ? null : ctx.db.normalizeId("lorekeeperRulings", q.rulingId);
      quotes.push(rulingId === null ? { kind: "ruling", text, title: section } : { kind: "ruling", text, title: section, rulingId });
    }
  }
  const stored: AnswerParts = { verdict: parts.verdict, quotes };
  if (parts.call !== undefined) stored.call = parts.call.slice(0, LOREKEEPER_LIMITS.answer);
  if (parts.web !== undefined) {
    stored.web = parts.web.slice(0, LOREKEEPER_LIMITS.webResults).map((w) => ({
      title: w.title.slice(0, LOREKEEPER_LIMITS.webTitle),
      site: w.site,
      url: w.url,
      snippet: w.snippet.slice(0, LOREKEEPER_LIMITS.snippet),
    }));
  }
  return stored;
}

function isInFlight(row: Doc<"lorekeeperMessages"> | null): row is Doc<"lorekeeperMessages"> {
  return row !== null && (row.status === "pending" || row.status === "streaming");
}

/**
 * One streaming patch: the text so far and the parts known so far (only for a pass shown live), a new `phase`
 * (L11), `checkedAgain` (L12: the kept retry answer shown while the web pass runs), or `touch` (a hidden pass made
 * progress: only `updatedAt` moves, for the watchdog). Fenced: only an
 * in-flight row is patched, and never with an older `at` than its last patch. Returns `go: false` once the row is
 * stopped, ended by the watchdog or gone. With nothing to write it only answers the question (the run's Stop check
 * while the model thinks).
 */
export const appendAnswer = internalMutation({
  args: {
    answerId: v.id("lorekeeperMessages"),
    at: v.number(),
    text: v.optional(v.string()),
    parts: v.optional(streamPartsValidator),
    phase: v.optional(answerPhaseValidator),
    touch: v.optional(v.boolean()),
    checkedAgain: v.optional(v.literal(true)),
  },
  returns: v.object({ go: v.boolean() }),
  handler: async (ctx, { answerId, at, text, parts, phase, touch, checkedAgain }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (!isInFlight(row)) return { go: false };
    if (at < row.updatedAt) return { go: true };
    if (text === undefined && parts === undefined && phase === undefined && touch !== true && checkedAgain === undefined) return { go: true };
    await ctx.db.patch("lorekeeperMessages", row._id, {
      status: "streaming",
      updatedAt: at,
      ...(phase === undefined ? {} : { phase }),
      ...(text === undefined ? {} : { text: text.slice(0, LOREKEEPER_LIMITS.answer) }),
      ...(parts === undefined ? {} : { parts: storedParts(ctx, parts) }),
      ...(checkedAgain === undefined ? {} : { checkedAgain }),
    });
    return { go: true };
  },
});

const usageArg = v.object({ input: v.number(), output: v.number(), cacheRead: v.number(), cacheWrite: v.number(), webSearches: v.number() });

/**
 * The run's last write: `done` with the final text and parts, `stopped` (the stream was aborted) with the text so
 * far (STOPPED_EARLY_NOTE when there is none, L12), or `error` with a failure code and no text. Records the usage of every pass (each was settled by
 * `settlePass`) and releases any reservation still open. A row a Stop already
 * ended keeps `stopped` and takes the final text so far; a row the watchdog ended keeps its error and takes only the
 * usage.
 */
export const finalize = internalMutation({
  args: {
    answerId: v.id("lorekeeperMessages"),
    outcome: v.union(v.literal("done"), v.literal("stopped"), v.literal("error")),
    text: v.string(),
    parts: v.optional(streamPartsValidator),
    errorCode: v.optional(v.union(v.literal("LOREKEEPER_FAILED"), v.literal("LOREKEEPER_REFUSED"), v.literal("LOREKEEPER_TIMEOUT"), v.literal("LOREKEEPER_UNAVAILABLE"))),
    usage: usageArg,
    costMicros: v.number(),
    model: v.optional(v.string()),
    checkedAgain: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("lorekeeperMessages", args.answerId);
    if (row === null) return null;
    const now = Math.max(Date.now(), row.updatedAt);
    const usage = { ...args.usage, costMicros: args.costMicros };
    const common = { usage, updatedAt: now, ...(args.model === undefined ? {} : { model: args.model }), ...(args.checkedAgain ? { checkedAgain: true } : {}) };
    // L12: a Stop before any answer was ready stores the note instead of an empty answer.
    const stoppedEarly = args.outcome === "stopped" && args.text.trim().length === 0;
    const content = {
      text: args.outcome === "error" ? "" : stoppedEarly ? STOPPED_EARLY_NOTE : args.text.slice(0, LOREKEEPER_LIMITS.answer),
      parts: args.parts === undefined || stoppedEarly ? undefined : storedParts(ctx, args.parts),
    };
    if (row.status === "pending" || row.status === "streaming") {
      await ctx.db.patch("lorekeeperMessages", row._id, {
        ...common,
        ...content,
        phase: "done",
        status: args.outcome,
        errorCode: args.outcome === "error" ? (args.errorCode ?? "LOREKEEPER_FAILED") : undefined,
      });
    } else if (row.status === "stopped" && args.outcome !== "error") {
      await ctx.db.patch("lorekeeperMessages", row._id, { ...common, ...content, phase: "done" });
    } else {
      // A row the watchdog ended keeps its error; a stopped row whose run then failed still gets the note (L12).
      const note = row.status === "stopped" && row.text === "" ? { text: STOPPED_EARLY_NOTE, phase: "done" as const } : {};
      await ctx.db.patch("lorekeeperMessages", row._id, { usage, updatedAt: now, ...note });
    }
    await settleReservation(ctx, row, row.reserved?.micros ?? 0, 0);
    return null;
  },
});

/**
 * Reserves a later pass (the Opus retry, the web pass) against the answer's counters. Returns the micros reserved, or
 * null when a budget would go over (nothing reserved: the run skips the pass) or the answer is no longer in flight.
 */
export const reserveNextPass = internalMutation({
  args: { answerId: v.id("lorekeeperMessages"), model: v.string(), webSearches: v.optional(v.number()) },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { answerId, model, webSearches }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (!isInFlight(row) || row.reserved === undefined) return null;
    const micros = await reservePass(ctx, scopesOf(row, row.reserved), model, Date.now(), webSearches === undefined ? {} : { webSearches });
    if (micros === null) return null;
    await ctx.db.patch("lorekeeperMessages", row._id, { reserved: { ...row.reserved, micros: row.reserved.micros + micros } });
    return micros;
  },
});

/** Settles one pass's real cost against its reservation (also after a failure or Stop: the usage so far). */
export const settlePass = internalMutation({
  args: { answerId: v.id("lorekeeperMessages"), reservedMicros: v.number(), actualMicros: v.number() },
  returns: v.null(),
  handler: async (ctx, { answerId, reservedMicros, actualMicros }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (row !== null) await settleReservation(ctx, row, reservedMicros, actualMicros);
    return null;
  },
});

/**
 * Releases the reservation of an answer the run will not answer (stopped or gone before it started). A row stopped
 * before the run started gets STOPPED_EARLY_NOTE (L12).
 */
export const release = internalMutation({
  args: { answerId: v.id("lorekeeperMessages") },
  returns: v.null(),
  handler: async (ctx, { answerId }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (row === null || row.status === "pending" || row.status === "streaming") return null;
    if (row.role === "answer" && row.status === "stopped" && row.text === "") {
      await ctx.db.patch("lorekeeperMessages", row._id, { text: STOPPED_EARLY_NOTE, phase: "done" });
    }
    await settleReservation(ctx, row, row.reserved?.micros ?? 0, 0);
    return null;
  },
});

/**
 * The per-answer watchdog, queued by `ask`: an answer still in flight with no patch for WATCHDOG_MS ends as
 * `error` / LOREKEEPER_TIMEOUT (its run died or hangs) and releases its reservation; one still making progress is
 * checked again later. A finished answer ends the watch. `lorekeeperRetention.expireStaleRuns` is the backstop.
 */
export const watchdog = internalMutation({
  args: { answerId: v.id("lorekeeperMessages") },
  returns: v.null(),
  handler: async (ctx, { answerId }) => {
    const row = await ctx.db.get("lorekeeperMessages", answerId);
    if (!isInFlight(row)) return null;
    const now = Date.now();
    const idle = now - row.updatedAt;
    if (idle < WATCHDOG_MS) {
      await ctx.scheduler.runAfter(WATCHDOG_MS - idle, internal.lorekeeperRun.watchdog, { answerId });
      return null;
    }
    await ctx.db.patch("lorekeeperMessages", row._id, { status: "error", errorCode: "LOREKEEPER_TIMEOUT", updatedAt: now });
    await settleReservation(ctx, row, row.reserved?.micros ?? 0, 0);
    return null;
  },
});

// ---------------------------------------------------------------- the run

/** L1 parsed parts → the run's parts (verdict known). */
function streamParts(verdict: AnswerParts["verdict"], quotes: ParsedQuote[], call?: string | null, web?: StreamParts["web"]): StreamParts {
  const parts: StreamParts = {
    verdict,
    quotes: quotes.map((q) => {
      const quote: StreamParts["quotes"][number] = { kind: q.kind, text: q.text, section: q.section };
      if (q.bookId !== undefined) quote.bookId = q.bookId;
      if (q.page !== undefined) quote.page = q.page;
      if (q.rulingId !== undefined) quote.rulingId = q.rulingId;
      return quote;
    }),
  };
  if (call) parts.call = call;
  if (web && web.length > 0) parts.web = web;
  return parts;
}

/** What the row shows of the answer: its text and the parts known so far (L12: written only for a kept pass). */
type AnswerView = { text: string; parts?: StreamParts; checkedAgain?: true };

/** A snapshot of a book pass as the row shows it. */
function viewOf(snapshot: AnswerSnapshot): AnswerView {
  return snapshot.verdict === null ? { text: snapshot.prose } : { text: snapshot.prose, parts: streamParts(snapshot.verdict, snapshot.quotes, snapshot.call) };
}

/**
 * Patches the answer row while a pass streams: at most one patch in flight, one every PATCH_MS (or sooner after
 * PATCH_CHARS new characters), and a Stop check every PATCH_MS while nothing new arrived. When the row stops being in
 * flight it aborts `controller` (the Messages API stream).
 *
 * L11/L12: the run calls `show(view)` only for a pass whose text it keeps; a hidden pass calls `tick()`, which only
 * counts as progress (a `touch` every HEARTBEAT_MS). `setPhase` writes the phase of the pass that starts. Shown text
 * only grows: a view whose text does not extend the text already shown keeps the shown text (its parts still update).
 */
class AnswerWriter {
  readonly controller = new AbortController();
  private view: AnswerView | null = null;
  private dirty = false;
  private phase: AnswerPhase = "books";
  private phaseDirty = false;
  private hiddenProgress = false;
  private lastWriteAt = Date.now();
  private charsSinceFlush = 0;
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly ctx: ActionCtx,
    private readonly answerId: Id<"lorekeeperMessages">,
  ) {}

  get stopped(): boolean {
    return this.controller.signal.aborted;
  }

  start() {
    this.schedule();
  }

  private schedule() {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
      this.schedule();
    }, PATCH_MS);
  }

  /** What the reader sees (or will at the next patch); null while nothing was shown. */
  get shown(): AnswerView | null {
    return this.view;
  }

  /**
   * Writes a new phase at once (no-op when it is the current one), with any view not yet written. The run awaits it
   * before the pass's request goes out, so the row names a pass only once it really starts (L12).
   */
  setPhase(phase: AnswerPhase): Promise<void> {
    if (phase === this.phase) return this.chain;
    this.phase = phase;
    this.phaseDirty = true;
    return this.flush();
  }

  /** A kept pass's view: written to the row (text only ever grows). */
  show(next: AnswerView) {
    const before = this.view?.text ?? "";
    const text = next.text.startsWith(before) ? next.text : before;
    this.charsSinceFlush += text.length - before.length;
    this.view = { ...next, text };
    this.dirty = true;
    if (this.charsSinceFlush >= PATCH_CHARS) this.flush();
  }

  /** A hidden pass made progress: nothing is written but the heartbeat. */
  tick() {
    this.hiddenProgress = true;
  }

  /** Queues one patch (or a Stop check when nothing changed) behind the previous one. */
  flush(): Promise<void> {
    const now = Date.now();
    const view = this.dirty ? this.view : null;
    const phase = this.phaseDirty ? this.phase : undefined;
    const touch = this.hiddenProgress && now - this.lastWriteAt >= HEARTBEAT_MS;
    this.dirty = false;
    this.phaseDirty = false;
    if (touch) this.hiddenProgress = false;
    this.charsSinceFlush = 0;
    if (view !== null || phase !== undefined || touch) this.lastWriteAt = now;
    this.chain = this.chain.then(async () => {
      if (this.stopped) return;
      const args: { answerId: Id<"lorekeeperMessages">; at: number; text?: string; parts?: StreamParts; phase?: AnswerPhase; touch?: boolean; checkedAgain?: true } = {
        answerId: this.answerId,
        at: Date.now(),
      };
      if (phase !== undefined) args.phase = phase;
      if (touch) args.touch = true;
      if (view !== null) {
        args.text = view.text;
        if (view.parts !== undefined) args.parts = view.parts;
        if (view.checkedAgain) args.checkedAgain = true;
      }
      try {
        const { go } = await this.ctx.runMutation(internal.lorekeeperRun.appendAnswer, args);
        if (!go) this.controller.abort();
      } catch (error) {
        // A failed patch is not fatal: the next one carries the whole text again.
        console.error("Lorekeeper: a streaming patch failed.", error instanceof Error ? error.name : typeof error);
      }
    });
    return this.chain;
  }

  /** Stops the timer and waits for the patches already queued. */
  async close() {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.chain;
  }
}

type PassResult = { final: ReturnType<ReturnType<typeof createAnswerParser>["finish"]> };

/** Which failures end the answer with which code (the card shows only generic text). */
function failureCode(failure: ClaudeFailure): FailureCode {
  if (failure.reason === "refusal") return "LOREKEEPER_REFUSED";
  if (failure.reason === "timeout") return "LOREKEEPER_TIMEOUT";
  if (failure.reason === "unavailable") return "LOREKEEPER_UNAVAILABLE";
  return "LOREKEEPER_FAILED";
}

function usageOf(result: StreamResult): TokenUsage {
  return { ...result.usage };
}

/** The book answer's prose and the web pass's prose, as one text (L10 D2). */
function joinProse(book: string, web: string): string {
  return [book.trim(), web.trim()].filter((p) => p.length > 0).join("\n\n");
}

/**
 * Streams one answer. Never throws for a model failure: every path ends in one `finalize` (done, stopped or error)
 * that books the real cost of all passes.
 */
export const run = internalAction({
  args: { answerId: v.id("lorekeeperMessages") },
  returns: v.null(),
  handler: async (ctx, { answerId }) => {
    const prep = await ctx.runQuery(internal.lorekeeperRun.prepare, { answerId });
    if (prep === null) {
      await ctx.runMutation(internal.lorekeeperRun.release, { answerId });
      return null;
    }

    const writer = new AnswerWriter(ctx, answerId);
    const override = modelFor("answer");
    let usageTotal: TokenUsage = { ...ZERO_USAGE };
    let cost = 0;
    let checkedAgain = false;
    /** The best finished answer so far (L11: what a Stop keeps when no text is shown live). */
    let kept: PassResult | null = null;
    let model: string | undefined;

    const finalize = async (outcome: "done" | "stopped" | "error", text: string, parts?: StreamParts, errorCode?: FailureCode) => {
      await writer.close();
      await ctx.runMutation(internal.lorekeeperRun.finalize, {
        answerId,
        outcome,
        text,
        ...(parts === undefined ? {} : { parts }),
        ...(errorCode === undefined ? {} : { errorCode }),
        usage: usageTotal,
        costMicros: cost,
        ...(model === undefined ? {} : { model }),
        checkedAgain,
      });
    };
    /** Counts a pass's usage and settles its real cost against its reservation. */
    const addPass = async (usage: TokenUsage, passModel: string, reservedMicros: number) => {
      const passCost = costMicros(usage, passModel);
      usageTotal = addUsage(usageTotal, usage);
      cost += passCost;
      await ctx.runMutation(internal.lorekeeperRun.settlePass, { answerId, reservedMicros, actualMicros: passCost });
    };
    /** Reserves a later pass; null = skip it. */
    const reserveNext = (pass: Pass, webSearches?: number) =>
      ctx.runMutation(internal.lorekeeperRun.reserveNextPass, { answerId, model: modelForPass(pass, override), ...(webSearches === undefined ? {} : { webSearches }) });

    /** One streamed book pass; throws ClaudeFailure (usage of the partial reply already counted). */
    const streamPass = async (pass: Pass, reservedMicros: number): Promise<PassResult> => {
      const passModel = modelForPass(pass, override);
      const fallback = passModel === SONNET || passModel === OPUS;
      const { body, sources } = requestBody(prep.question, prep.chunks, prep.rulings, prep.context, prep.history, { model: passModel, refusalFallback: fallback });
      const parser = createAnswerParser(sources);
      let decided = false;
      let live = false;
      const onProgress = () => {
        const snapshot = parser.snapshot();
        // The verdict line decides once (L12 `streamsLive`): a pass the run ends with streams; any other stays hidden.
        // The phase is not touched here: it names the pass that runs, not the one the verdict line points to.
        if (!decided && snapshot.verdict !== null) {
          decided = true;
          live = streamsLive(pass, snapshot.verdict, prep.webSearch);
        }
        if (live) writer.show(viewOf(snapshot));
        else writer.tick();
      };
      try {
        const result = await messagesStream(
          body,
          (delta) => {
            parser.pushText(delta);
            onProgress();
          },
          (citation) => {
            parser.pushCitation(citation as ApiCitation);
            onProgress();
          },
          writer.controller.signal,
          fallback ? { betas: [REFUSAL_FALLBACK_BETA] } : {},
        );
        const usage = usageOf(result);
        await addPass(usage, result.model || passModel, reservedMicros);
        model = result.model || passModel;
        return { final: parser.finish() };
      } catch (error) {
        await addPass(error instanceof ClaudeFailure ? usageOf(error.partial) : { ...ZERO_USAGE }, passModel, reservedMicros);
        throw error;
      }
    };

    /** The passes of Q2; returns how the answer ends. */
    const answerFlow = async (): Promise<Parameters<typeof finalize>> => {
      // A Stop keeps what the reader already sees (a live pass), else the best finished answer, never a hidden
      // partial (L11); with neither, `finalize` stores the early-Stop note (L12).
      const stoppedNow = (): Parameters<typeof finalize> => {
        const shown = writer.shown;
        if (shown !== null) return ["stopped", shown.text, shown.parts];
        if (kept !== null) return ["stopped", kept.final.prose, streamParts(kept.final.verdict, kept.final.quotes, kept.final.call, kept.final.web)];
        return ["stopped", ""];
      };
      const isAbort = (error: unknown) => writer.stopped || (error instanceof ClaudeFailure && error.reason === "aborted");

      let answer: PassResult;
      try {
        answer = await streamPass("primary", prep.reservedMicros);
      } catch (error) {
        if (!(error instanceof ClaudeFailure)) throw error;
        return isAbort(error) ? stoppedNow() : ["error", "", undefined, failureCode(error)];
      }

      kept = answer;
      let step = nextStep({ pass: "primary", verdict: answer.final.verdict, webSearch: prep.webSearch });
      const retryReserved = step === "retry" ? await reserveNext("retry") : null;
      if (step === "retry" && retryReserved === null) {
        // A budget (or a Stop) leaves no room for the re-check: keep the first answer.
        step = "done";
      } else if (step === "retry" && retryReserved !== null) {
        // L12: 'Checking again with a stronger model…' starts with the Opus pass, not with the first verdict line.
        await writer.setPhase(phaseForPass("retry"));
        try {
          answer = await streamPass("retry", retryReserved);
          kept = answer;
          checkedAgain = true;
          step = nextStep({ pass: "retry", verdict: answer.final.verdict, webSearch: prep.webSearch });
        } catch (error) {
          if (!(error instanceof ClaudeFailure)) throw error;
          if (isAbort(error)) return stoppedNow();
          // The re-check failed: keep the first answer.
          console.error(`Lorekeeper: the stronger-model check failed (${error.reason}); keeping the first answer.`);
          step = "done";
        }
      }

      const final = answer.final;
      const bookParts = (web?: StreamParts["web"]) => streamParts(final.verdict, final.quotes, final.call, web);
      const bookEnding = (): Parameters<typeof finalize> => ["done", final.prose, bookParts(final.web)];
      if (step === "booksOnlyMiss") return ["done", BOOKS_ONLY_MISS, streamParts("none", [])];
      if (step !== "web") return bookEnding();

      // The internet pass (toggle on; Opus said 'unclear' or 'none'). Without a usable result the unclear answer stays,
      // and a miss says that the internet was searched too (D3).
      const books = final.verdict === "unclear" ? "unclear" : "none";
      // dcm-bxp.82.5: for 'none', a search that ran and found nothing says WEB_MISS; a pass that couldn't run (no
      // budget, an HTTP error, a timeout, nothing sent) says WEB_UNAVAILABLE.
      const withoutWeb = (searched: boolean): Parameters<typeof finalize> =>
        books === "unclear" ? bookEnding() : ["done", searched ? WEB_MISS : WEB_UNAVAILABLE, streamParts("none", [])];
      const webReserved = await reserveNext("web", WEB_SEARCH_MAX_USES);
      if (webReserved === null) return withoutWeb(false);
      // L12: the web pass is the last pass, so what it adds is kept. For 'unclear' the kept book answer shows first
      // (with its 'Checked again' note) and the web part writes out under it once it has a result; for 'none' the
      // web answer writes out once it has a result. The phase moves to 'web' as the pass starts.
      if (books === "unclear") writer.show({ text: final.prose.trim(), parts: bookParts(), checkedAgain: true });
      await writer.setPhase(phaseForPass("web"));
      const onResults = (prose: string, web: NonNullable<StreamParts["web"]>) =>
        books === "unclear"
          ? writer.show({ text: joinProse(final.prose, prose), parts: bookParts(web), checkedAgain: true })
          : writer.show({ text: prose, parts: streamParts("none", [], null, web) });
      let web: Awaited<ReturnType<typeof webPass>>;
      try {
        // L8's request through webPass (dcm-bxp.82.2): its progress streams once it has a web result, else it only
        // counts as hidden progress for the heartbeat.
        web = await webPass(prep.question, prep.rulings, writer.controller.signal, books, (progress) => {
          if (progress.web.length > 0) onResults(progress.prose, progress.web);
          else writer.tick();
        });
      } catch (error) {
        await addPass(error instanceof ClaudeFailure ? usageOf(error.partial) : { ...ZERO_USAGE }, modelForPass("web", override), webReserved);
        if (isAbort(error)) return stoppedNow();
        if (!(error instanceof ClaudeFailure)) throw error;
        // The reason only (D5): never the key or the request body.
        console.error(`Lorekeeper: the internet pass failed (${error.reason}); answering without it.`);
        // 'no answer' is a completed call with no usable result: the search ran and found nothing.
        return withoutWeb(error.reason === "no answer");
      }
      if (web === null) {
        // Nothing was sent (a blank question): release the pass's reservation.
        await addPass({ ...ZERO_USAGE }, modelForPass("web", override), webReserved);
        return withoutWeb(false);
      }
      await addPass(web.usage, web.model, webReserved);
      model = web.model;
      if (books === "none") return ["done", web.prose, streamParts("none", [], null, web.web)];
      return ["done", joinProse(final.prose, web.prose), bookParts(web.web)];
    };

    writer.start();
    let ending: Parameters<typeof finalize>;
    try {
      ending = await answerFlow();
    } catch (error) {
      // A programming error: end the row as failed (never leave it in flight), then rethrow so it shows as a bug.
      await finalize("error", "", undefined, "LOREKEEPER_FAILED");
      throw error;
    }
    await finalize(...ending);
    return null;
  },
});
