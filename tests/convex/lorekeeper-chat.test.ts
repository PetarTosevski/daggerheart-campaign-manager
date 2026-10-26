import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RetrievedChunk } from "../../convex/lib/lorekeeper/retrieve";
import { BOOKS_ONLY_MISS, STOPPED_EARLY_NOTE } from "../../src/lib/lorekeeper/copy";
import { SYSTEM_PROMPT } from "../../src/lib/lorekeeper/prompt";
import { sseFixture, sseResponse } from "../fixtures/lorekeeper/sse";
import { errorCode, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D13 L3: the Lorekeeper chat. `lorekeeper.ask` stores the question and a pending answer and schedules
// `lorekeeperRun.run`, which streams the (stubbed) Messages API reply into the answer row. fetch is stubbed with
// recorded-shape SSE: no test reaches the API. `retrieve` (L2's) is mocked so answers have book chunks to cite.

const chunks = vi.hoisted(() => ({ value: [] as RetrievedChunk[] }));
vi.mock("../../convex/lib/lorekeeper/retrieve", () => ({ retrieve: async () => chunks.value }));

const API_KEY = "sk-ant-test-key-123";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

type SseEvent = { type: string; [field: string]: unknown };

function sse(events: SseEvent[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** A plain text reply (no citations) streamed in small deltas. */
function textReply(text: string, model = "claude-sonnet-5-5"): string {
  const deltas = text.match(/[\s\S]{1,9}/g) ?? [];
  return sse([
    { type: "message_start", message: { id: "msg_t", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...deltas.map((d) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 60 } },
    { type: "message_stop" },
  ]);
}

/**
 * A stream that sends `text` up to `splitAt`, then waits for `release()` (or the request's abort, which errors the
 * body like a cut connection).
 */
function gated(text: string, splitAt: number, signal: AbortSignal | null | undefined) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, splitAt)));
      const aborted = new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      await Promise.race([gate, aborted]);
      if (signal?.aborted) {
        controller.error(new DOMException("aborted", "AbortError"));
        return;
      }
      controller.enqueue(encoder.encode(text.slice(splitAt)));
      controller.close();
    },
  });
  return { response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }), release: () => release() };
}

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > until) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const TERMINAL = new Set(["done", "error", "stopped"]);

async function setup() {
  const ctx = await setupWithCampaign();
  const { t, gm, campaignId } = ctx;
  await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
  const player = ctx.other;
  const bookId = await t.run((c) =>
    c.db.insert("lorekeeperBooks", { key: "core", title: "Mini Manual", subtitle: "Core rules", cover: "core", pages: 12, chunkCount: 2, ingestedAt: 1, schemaVersion: 1 }),
  );
  const chunkIds = await t.run(async (c) => [
    await c.db.insert("lorekeeperChunks", { bookId, page: 2, section: "Core Mechanics → Duality Dice", text: "Roll two d12s.", ord: 0 }),
    await c.db.insert("lorekeeperChunks", { bookId, page: 3, section: "Core Mechanics → Critical Hits", text: "A critical hit always succeeds.", ord: 1 }),
  ]);
  chunks.value = [
    { chunkId: chunkIds[0]!, bookId, bookKey: "core", bookTitle: "Mini Manual", page: 2, section: "Core Mechanics → Duality Dice", text: "Roll two d12s." },
    { chunkId: chunkIds[1]!, bookId, bookKey: "core", bookTitle: "Mini Manual", page: 3, section: "Core Mechanics → Critical Hits", text: "A critical hit always succeeds." },
  ];
  const row = (id: Id<"lorekeeperMessages">) => t.run((c) => c.db.get("lorekeeperMessages", id));
  const finished = (id: Id<"lorekeeperMessages">) => waitFor(() => row(id), (r) => r !== null && TERMINAL.has(r.status));
  const ask = (client = player, args: { question?: string; webSearch?: boolean; conversationId?: Id<"lorekeeperConversations">; visibility?: "campaign" | "private" } = {}) =>
    client.mutation(api.lorekeeper.ask, {
      campaignId,
      question: args.question ?? "What does a critical hit do?",
      webSearch: args.webSearch ?? false,
      ...(args.conversationId === undefined ? {} : { conversationId: args.conversationId }),
      ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
    });
  /** The campaign's monthly cost counter (L5's caps), in micros. */
  const campaignCost = () =>
    t.run(async (c) => {
      const rows = await c.db.query("lorekeeperUsage").withIndex("by_campaign_period", (q) => q.eq("campaignId", campaignId)).take(5);
      return rows.reduce((sum, r) => sum + r.costMicros, 0);
    });
  return { ...ctx, player, bookId, row, finished, ask, campaignCost };
}

describe("lorekeeper chat", () => {
  useAllowlist();
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = API_KEY;
    delete process.env.LOREKEEPER_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams a cited answer into the row in several patches and ends with quotes carrying page and section", async () => {
    const s = await setup();
    const text = sseFixture("answer-cited");
    // Hold the stream after the first text deltas, until a patch has shown them.
    const splitAt = text.indexOf("event: content_block_start", text.indexOf("content_block_stop"));
    let release = () => {};
    fetchMock.mockImplementation((_url, init) => {
      const g = gated(text, splitAt, init?.signal);
      release = g.release;
      return Promise.resolve(g.response);
    });

    const { answerId, conversationId } = await s.ask();
    const partial = await waitFor(() => s.row(answerId), (r) => r?.status === "streaming" && r.text.length > 0);
    expect(partial!.text).toBe("A critical hit always succeeds —");
    expect(partial!.parts?.verdict).toBe("rules");
    // L11: a first-pass 'rules' answer streams under the 'books' phase.
    expect(partial!.phase).toBe("books");
    release();

    const done = await s.finished(answerId);
    expect(done!.status).toBe("done");
    expect(done!.text).toBe("A critical hit always succeeds — and it deals the weapon's highest damage plus a roll.");
    expect(done!.parts?.verdict).toBe("rules");
    expect(done!.parts?.quotes).toEqual([
      { kind: "book", text: "A critical hit always succeeds.", bookId: s.bookId, page: 3, section: "Core Mechanics → Critical Hits" },
    ]);
    expect(done!.model).toBe("claude-sonnet-5-5");
    expect(done!.usage?.output).toBe(412);
    expect(done!.usage?.costMicros).toBeGreaterThan(0);
    expect(done!.checkedAgain).toBeUndefined();
    expect(done!.phase).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The reservation is settled to the real cost.
    expect(done!.reserved?.micros).toBe(0);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);

    // The outgoing request: system prompt, cited documents, the question; never the key in the body.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = String(init?.body);
    expect(body).not.toContain(API_KEY);
    const parsed = JSON.parse(body) as { system: { text: string }[]; messages: { content: unknown }[]; stream: boolean; model: string };
    expect(parsed.stream).toBe(true);
    expect(parsed.model).toBe("claude-sonnet-5-5");
    expect(parsed.system[0]!.text).toBe(SYSTEM_PROMPT);
    expect(body).toContain('"citations":{"enabled":true}');
    expect(body).toContain("Mini Manual · p.3 · Core Mechanics → Critical Hits");
    expect(body).toContain("What does a critical hit do?");

    // The reader sees the question then the answer (newest first), without the reservation or usage.
    const page = await s.player.query(api.lorekeeper.listMessages, { campaignId: s.campaignId, conversationId, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((m) => [m.role, m.status])).toEqual([
      ["answer", "done"],
      ["question", "done"],
    ]);
    expect(Object.keys(page.page[0]!)).not.toContain("reserved");
    expect(Object.keys(page.page[0]!)).not.toContain("usage");
  });

  it("an unclear answer is checked again with Opus and stores the GM call", async () => {
    const s = await setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")));
    const { answerId } = await s.ask(undefined, { question: "Do two Hexes stack?" });
    const done = await s.finished(answerId);
    expect(done!.status).toBe("done");
    expect(done!.parts?.verdict).toBe("unclear");
    expect(done!.parts?.call).toBe("Apply only the strongest one.");
    expect(done!.text).toBe("Two Hexes are not covered.");
    expect(done!.checkedAgain).toBe(true);
    expect(done!.model).toBe("claude-opus-5-5");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const models = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { model: string }).model);
    expect(models).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    // Both passes are settled: the counter holds their real cost, nothing stays reserved.
    expect(done!.reserved?.micros).toBe(0);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
  });

  describe("think before showing (L11) and the kept pass writes out live (L12)", () => {
    const FIRST = "VERDICT: unclear\nThe books don't settle it.\nGM CALL: Your call.";
    const RETRY = "VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.";
    const RETRY_RULES = "VERDICT: rules\nOnly the strongest Hex applies, per the book.";
    /** Everything but the end of the reply: all text deltas are sent, the block and message stay open. */
    const holdAt = (text: string) => text.indexOf("event: content_block_stop");
    const view = async (s: Awaited<ReturnType<typeof setup>>, conversationId: Id<"lorekeeperConversations">) =>
      (await s.gm.query(api.lorekeeper.listMessages, { campaignId: s.campaignId, conversationId, paginationOpts: { numItems: 10, cursor: null } })).page[0]!;
    /** The newest answer row (the run reads it while fetch is called, before the test knows its id). */
    const newestAnswer = (s: Awaited<ReturnType<typeof setup>>) =>
      s.t.run(async (c) => (await c.db.query("lorekeeperMessages").order("desc").take(5)).find((m) => m.role === "answer") ?? null);
    type Seen = { status: string; phase: string; text: string };
    /** Records every distinct (status, phase, text) of the row until it ends. */
    const trace = (s: Awaited<ReturnType<typeof setup>>, answerId: Id<"lorekeeperMessages">) => {
      const seen: Seen[] = [];
      const done = waitFor(
        async () => {
          const r = await s.row(answerId);
          const next = { status: r?.status ?? "gone", phase: r?.phase ?? "books", text: r?.text ?? "" };
          const last = seen.at(-1);
          if (!last || last.status !== next.status || last.phase !== next.phase || last.text !== next.text) seen.push(next);
          return r;
        },
        (r) => r !== null && TERMINAL.has(r.status) && r.usage !== undefined,
        20_000,
      );
      return { seen, done };
    };
    /** Shown text only ever grows: each text extends the one before it (L12). */
    const expectOnlyGrows = (seen: Seen[]) => {
      let before = "";
      for (const { text } of seen) {
        expect(text.startsWith(before), `"${text}" does not extend "${before}"`).toBe(true);
        before = text;
      }
    };

    it("the phase stays 'books' through the first verdict line, becomes 'retry' only as the Opus pass starts, and a retry 'rules' writes out live", async () => {
      const s = await setup();
      const releases: (() => void)[] = [];
      const replies = [textReply(FIRST), textReply(RETRY_RULES, "claude-opus-5-5")];
      let phaseAtRetry: string | undefined;
      fetchMock.mockImplementation(async (_url, init) => {
        if (releases.length === 1) phaseAtRetry = (await newestAnswer(s))?.phase;
        const text = replies[releases.length]!;
        const g = gated(text, holdAt(text), init?.signal);
        releases.push(g.release);
        return g.response;
      });
      const { answerId, conversationId } = await s.ask(undefined, { question: "Do two Hexes stack?", webSearch: true });
      const { seen, done } = trace(s, answerId);

      // The first pass's verdict line ('unclear') arrived, but the Opus pass hasn't started: still 'Searching your books…'.
      await waitFor(async () => releases.length, (n) => n === 1);
      await new Promise((resolve) => setTimeout(resolve, 600));
      let row = await s.row(answerId);
      expect([row!.status, row!.phase, row!.text, row!.parts]).toEqual(["pending", "books", "", undefined]);
      expect((await view(s, conversationId)).phase).toBe("books");

      // The retry's request goes out only after the row says 'retry'; its 'rules' answer writes out live.
      releases[0]!();
      row = await waitFor(() => s.row(answerId), (r) => r?.text !== "" && r?.status === "streaming");
      expect(phaseAtRetry).toBe("retry");
      expect([row!.phase, row!.text, row!.parts?.verdict]).toEqual(["retry", "Only the strongest Hex applies, per the book.", "rules"]);
      expect((await view(s, conversationId)).text).toBe("Only the strongest Hex applies, per the book.");

      releases[1]!();
      const final = await done;
      expect([final!.status, final!.phase, final!.text, final!.checkedAgain]).toEqual(["done", "done", "Only the strongest Hex applies, per the book.", true]);
      expect(seen.map((x) => x.phase).filter((p, i, a) => a.indexOf(p) === i)).toEqual(["books", "retry", "done"]);
      expect(seen.filter((x) => x.phase === "books").every((x) => x.text === "")).toBe(true);
      expectOnlyGrows(seen);
      expect(final!.reserved?.micros).toBe(0);
      expect(await s.campaignCost()).toBe(final!.usage!.costMicros);
    });

    it("with search off a retry 'unclear' is final, so it writes out live with its GM call", async () => {
      const s = await setup();
      let release = () => {};
      const retryText = textReply(RETRY, "claude-opus-5-5");
      fetchMock.mockResolvedValueOnce(sseResponse(textReply(FIRST))).mockImplementationOnce((_url, init) => {
        const g = gated(retryText, holdAt(retryText), init?.signal);
        release = g.release;
        return Promise.resolve(g.response);
      });
      const { answerId } = await s.ask(undefined, { question: "Do two Hexes stack?", webSearch: false });
      const { seen, done } = trace(s, answerId);
      const live = await waitFor(() => s.row(answerId), (r) => r?.text !== "" && r?.status === "streaming");
      expect([live!.phase, live!.text, live!.parts?.verdict, live!.parts?.call]).toEqual(["retry", "Two Hexes are not covered.", "unclear", "Apply only the strongest one."]);
      release();
      const final = await done;
      expect([final!.status, final!.text, final!.parts?.call, final!.checkedAgain]).toEqual(["done", "Two Hexes are not covered.", "Apply only the strongest one.", true]);
      expectOnlyGrows(seen);
    });

    it("with search on a retry 'unclear' stays hidden; the web pass then shows the kept book answer and adds its part under it", async () => {
      const s = await setup();
      const releases: (() => void)[] = [];
      const replies = [textReply(FIRST), textReply(RETRY, "claude-opus-5-5")];
      fetchMock.mockImplementation((_url, init) => {
        if (releases.length === 2) return Promise.resolve(sseResponse(sseFixture("web-search")));
        const text = replies[releases.length]!;
        const g = gated(text, holdAt(text), init?.signal);
        releases.push(g.release);
        return Promise.resolve(g.response);
      });
      const { answerId, conversationId } = await s.ask(undefined, { question: "Do two Hexes stack?", webSearch: true });
      const { seen, done } = trace(s, answerId);

      await waitFor(async () => releases.length, (n) => n === 1);
      releases[0]!();
      await waitFor(async () => releases.length, (n) => n === 2);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const row = await s.row(answerId);
      expect([row!.phase, row!.text, row!.parts, row!.checkedAgain]).toEqual(["retry", "", undefined, undefined]);
      const seenNow = await view(s, conversationId);
      expect([seenNow.phase, seenNow.text, seenNow.checkedAgain]).toEqual(["retry", "", undefined]);

      releases[1]!();
      const final = await done;
      expect([final!.status, final!.text, final!.parts?.verdict, final!.parts?.call, final!.checkedAgain]).toEqual([
        "done",
        "Two Hexes are not covered.\n\nTables online mostly let only the strongest apply.",
        "unclear",
        "Apply only the strongest one.",
        true,
      ]);
      // Nothing showed during 'books' or 'retry'; the first text shown is the kept book answer; text only grew.
      expect(seen.filter((x) => x.phase === "books" || x.phase === "retry").every((x) => x.text === "")).toBe(true);
      expect(seen.find((x) => x.text !== "")!.text.startsWith("Two Hexes are not covered.")).toBe(true);
      expect(seen.some((x) => x.text.includes("The books don't settle it"))).toBe(false);
      expectOnlyGrows(seen);
      expect(final!.reserved?.micros).toBe(0);
      expect(await s.campaignCost()).toBe(final!.usage!.costMicros);
    });

    it("Stop during a hidden retry keeps the first pass's finished answer, never the retry's partial text", async () => {
      const s = await setup();
      let retrySignal: AbortSignal | null | undefined;
      const retryText = textReply(RETRY, "claude-opus-5-5");
      fetchMock.mockResolvedValueOnce(sseResponse(textReply(FIRST))).mockImplementationOnce((_url, init) => {
        retrySignal = init?.signal;
        return Promise.resolve(gated(retryText, holdAt(retryText), init?.signal).response);
      });
      const { answerId } = await s.ask(undefined, { question: "Do two Hexes stack?", webSearch: true });
      await waitFor(async () => fetchMock.mock.calls.length, (n) => n === 2);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
      await waitFor(async () => retrySignal?.aborted === true, (aborted) => aborted);
      const stopped = await waitFor(() => s.row(answerId), (r) => r?.usage !== undefined);
      expect([stopped!.status, stopped!.phase, stopped!.text, stopped!.parts?.verdict, stopped!.parts?.call]).toEqual([
        "stopped",
        "done",
        "The books don't settle it.",
        "unclear",
        "Your call.",
      ]);
      expect(stopped!.text).not.toContain("Hexes are not covered");
      expect(stopped!.checkedAgain).toBeUndefined();
      // Both passes are costed (the retry with what streamed before the Stop); nothing stays reserved.
      expect(stopped!.reserved?.micros).toBe(0);
      expect(await s.campaignCost()).toBe(stopped!.usage!.costMicros);
    });

    it("Stop during a live retry keeps the retry's text so far, never swaps back to the first answer", async () => {
      const s = await setup();
      const retryText = textReply(RETRY, "claude-opus-5-5");
      fetchMock
        .mockResolvedValueOnce(sseResponse(textReply(FIRST)))
        .mockImplementationOnce((_url, init) => Promise.resolve(gated(retryText, holdAt(retryText), init?.signal).response));
      const { answerId } = await s.ask(undefined, { question: "Do two Hexes stack?", webSearch: false });
      await waitFor(() => s.row(answerId), (r) => r?.text !== "" && r?.status === "streaming");
      await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
      const stopped = await waitFor(() => s.row(answerId), (r) => r?.usage !== undefined);
      expect([stopped!.status, stopped!.text, stopped!.parts?.verdict]).toEqual(["stopped", "Two Hexes are not covered.", "unclear"]);
      expect(stopped!.reserved?.micros).toBe(0);
      expect(await s.campaignCost()).toBe(stopped!.usage!.costMicros);
    });

    it("Stop during the first pass before any answer is ready stores the early-Stop note", async () => {
      const s = await setup();
      fetchMock.mockImplementation((_url, init) => Promise.resolve(gated(textReply(FIRST), holdAt(textReply(FIRST)), init?.signal).response));
      const { answerId } = await s.ask(undefined, { question: "Do two Hexes stack?" });
      await waitFor(async () => fetchMock.mock.calls.length, (n) => n === 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await s.row(answerId))!.phase).toBe("books");
      await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
      const stopped = await waitFor(() => s.row(answerId), (r) => r?.usage !== undefined);
      expect([stopped!.status, stopped!.phase, stopped!.text, stopped!.parts]).toEqual(["stopped", "done", STOPPED_EARLY_NOTE, undefined]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stopped!.reserved?.micros).toBe(0);
      expect(await s.campaignCost()).toBe(stopped!.usage!.costMicros);
    });

    it("an answer stopped before its run started gets the early-Stop note when the run releases it", async () => {
      const s = await setup();
      const answerId = await s.t.run(async (c) => {
        const user = (await c.db.query("users").take(5)).find((u) => u.email === OTHER_EMAIL)!;
        const conversationId = await c.db.insert("lorekeeperConversations", { campaignId: s.campaignId, userId: user._id, title: "Stopped", visibility: "campaign", webSearch: true, messageCount: 2, lastAt: 1, createdAt: 1 });
        const base = { conversationId, campaignId: s.campaignId, userId: user._id, createdAt: 1, updatedAt: 1 };
        await c.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Q?" });
        return c.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "stopped", text: "", phase: "done" });
      });
      await s.t.action(internal.lorekeeperRun.run, { answerId });
      const row = await s.row(answerId);
      expect([row!.status, row!.text]).toEqual(["stopped", STOPPED_EARLY_NOTE]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("listMessages returns what the run wrote: the kept book answer during the internet pass", async () => {
      const s = await setup();
      const { conversationId, answerId } = await s.t.run(async (c) => {
        const user = (await c.db.query("users").take(5)).find((u) => u.email === OTHER_EMAIL)!;
        const conversationId = await c.db.insert("lorekeeperConversations", { campaignId: s.campaignId, userId: user._id, title: "Web", visibility: "campaign", webSearch: true, messageCount: 2, lastAt: 1, createdAt: 1 });
        const base = { conversationId, campaignId: s.campaignId, userId: user._id, createdAt: 1, updatedAt: 1 };
        await c.db.insert("lorekeeperMessages", { ...base, role: "question", status: "done", text: "Q?" });
        const answerId = await c.db.insert("lorekeeperMessages", { ...base, role: "answer", status: "streaming", text: "Kept", parts: { verdict: "unclear", quotes: [] }, checkedAgain: true, phase: "web" });
        return { conversationId, answerId };
      });
      const seen = await view(s, conversationId);
      expect([seen._id, seen.phase, seen.text, seen.parts?.verdict, seen.checkedAgain]).toEqual([answerId, "web", "Kept", "unclear", true]);
    });
  });

  it("without budget for the re-check the first answer is kept", async () => {
    const s = await setup();
    // Room for the Sonnet worst case ($0.07) but not for Opus's ($0.14) on top.
    process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD = "0.1";
    try {
      fetchMock.mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.\nGM CALL: Your call.")));
      const { answerId } = await s.ask();
      const done = await s.finished(answerId);
      expect([done!.status, done!.parts?.verdict, done!.parts?.call, done!.checkedAgain]).toEqual(["done", "unclear", "Your call.", undefined]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    } finally {
      delete process.env.LOREKEEPER_CAMPAIGN_MONTHLY_USD;
    }
  });

  it("a miss in the books with the toggle off stores the books-only miss after the Opus retry", async () => {
    const s = await setup();
    chunks.value = [];
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(textReply("VERDICT: none\nNothing in the books."))));
    const { answerId } = await s.ask(undefined, { question: "What is the capital of France?", webSearch: false });
    // L12: a retry 'none' with search off is replaced by the miss text, so it never writes out.
    let shown = false;
    const done = await waitFor(
      async () => {
        const r = await s.row(answerId);
        if (r !== null && !TERMINAL.has(r.status) && r.text !== "") shown = true;
        return r;
      },
      (r) => r !== null && TERMINAL.has(r.status),
    );
    expect(shown).toBe(false);
    expect(done!.status).toBe("done");
    expect(done!.parts).toEqual({ verdict: "none", quotes: [] });
    expect(done!.text).toBe(BOOKS_ONLY_MISS);
    expect(done!.checkedAgain).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a refusal ends as an error with generic text only", async () => {
    const s = await setup();
    fetchMock.mockResolvedValue(sseResponse(sseFixture("refusal")));
    const { answerId } = await s.ask();
    const done = await s.finished(answerId);
    expect(done!.status).toBe("error");
    expect(done!.errorCode).toBe("LOREKEEPER_REFUSED");
    expect(done!.text).toBe("");
    expect(done!.usage?.output).toBe(5);
  });

  it("HTTP 529 and a mid-stream overload end as errors", async () => {
    const s = await setup();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error" } }), { status: 529 }));
    const first = await s.ask();
    const failed = await s.finished(first.answerId);
    expect([failed!.status, failed!.errorCode, failed!.text]).toEqual(["error", "LOREKEEPER_FAILED", ""]);

    fetchMock.mockResolvedValueOnce(sseResponse(sseFixture("overloaded")));
    const second = await s.ask(undefined, { conversationId: first.conversationId });
    const overloaded = await s.finished(second.answerId);
    expect([overloaded!.status, overloaded!.errorCode]).toEqual(["error", "LOREKEEPER_FAILED"]);
  });

  it("Stop mid-stream ends the answer as stopped, keeps the text so far and aborts the stream", async () => {
    const s = await setup();
    const text = sseFixture("answer-cited");
    const splitAt = text.indexOf("event: content_block_start", text.indexOf("content_block_stop"));
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((_url, init) => {
      signal = init?.signal;
      return Promise.resolve(gated(text, splitAt, init?.signal).response);
    });
    const { answerId } = await s.ask();
    await waitFor(() => s.row(answerId), (r) => r?.status === "streaming" && r.text.length > 0);

    expect(await code(s.gm.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId }))).toBe("LOREKEEPER_NOT_FOUND");
    await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
    await waitFor(async () => signal?.aborted === true, (aborted) => aborted);
    const stopped = await waitFor(() => s.row(answerId), (r) => r?.usage !== undefined);
    expect(stopped!.status).toBe("stopped");
    expect(stopped!.text).toBe("A critical hit always succeeds —");
    expect(stopped!.errorCode).toBeUndefined();
    // Only what streamed before the Stop is counted.
    expect(stopped!.reserved?.micros).toBe(0);
    expect(await s.campaignCost()).toBe(stopped!.usage!.costMicros);
    // Stopping a finished answer changes nothing.
    await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
    expect((await s.row(answerId))!.status).toBe("stopped");
  });

  it("the watchdog ends a stuck answer and leaves a progressing one alone", async () => {
    const s = await setup();
    const players = await s.t.run((c) => c.db.query("users").take(5));
    const userId = players.find((u) => u.email === OTHER_EMAIL)!._id;
    const insertAnswer = (updatedAt: number) =>
      s.t.run(async (c) => {
        const conversationId = await c.db.insert("lorekeeperConversations", { campaignId: s.campaignId, userId, title: "Stuck", visibility: "campaign", webSearch: false, messageCount: 2, lastAt: 1, createdAt: 1 });
        return c.db.insert("lorekeeperMessages", { conversationId, campaignId: s.campaignId, userId, role: "answer", status: "streaming", text: "Half", createdAt: 1, updatedAt, reserved: { micros: 70_000, day: "2026-10-21", month: "2026-10" } });
      });
    const stuck = await insertAnswer(Date.now() - 4 * 60 * 1000);
    const alive = await insertAnswer(Date.now());
    await s.t.mutation(internal.lorekeeperRun.watchdog, { answerId: stuck });
    await s.t.mutation(internal.lorekeeperRun.watchdog, { answerId: alive });
    const ended = await s.row(stuck);
    expect([ended!.status, ended!.errorCode, ended!.reserved?.micros]).toEqual(["error", "LOREKEEPER_TIMEOUT", 0]);
    expect((await s.row(alive))!.status).toBe("streaming");
  });

  describe("ask", () => {
    it("validates the question, needs a key, and refuses a second question while one is answered", async () => {
      const s = await setup();
      expect(await code(s.ask(undefined, { question: "   " }))).toBe("LOREKEEPER_QUESTION_INVALID");
      expect(await code(s.ask(undefined, { question: "x".repeat(1001) }))).toBe("LOREKEEPER_QUESTION_INVALID");
      delete process.env.ANTHROPIC_API_KEY;
      expect(await code(s.ask())).toBe("LOREKEEPER_UNAVAILABLE");
      expect(await s.player.query(api.lorekeeper.available, { campaignId: s.campaignId })).toBe(false);
      process.env.ANTHROPIC_API_KEY = API_KEY;
      expect(await s.player.query(api.lorekeeper.available, { campaignId: s.campaignId })).toBe(true);

      const text = sseFixture("answer-cited");
      // The player's answer is held open; the GM's question answers at once.
      fetchMock.mockImplementation((_url, init) =>
        Promise.resolve(String(init?.body).includes("GM asks") ? sseResponse(textReply("VERDICT: rules\nYes.")) : gated(text, 10, init?.signal).response),
      );
      const { answerId } = await s.ask();
      expect(await code(s.ask())).toBe("LOREKEEPER_BUSY");
      // Another member is not blocked by it.
      const gmAsk = await s.ask(s.gm, { question: "GM asks: what is Hope?" });
      await s.finished(gmAsk.answerId);
      await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
      expect((await s.row(answerId))!.status).toBe("stopped");
    });

    it("asks only in the caller's own conversation and refuses a full one", async () => {
      const s = await setup();
      fetchMock.mockImplementation(() => Promise.resolve(sseResponse(textReply("VERDICT: rules\nYes."))));
      const mine = await s.ask();
      await s.finished(mine.answerId);
      expect(await code(s.ask(s.gm, { conversationId: mine.conversationId }))).toBe("LOREKEEPER_NOT_FOUND");

      const again = await s.ask(undefined, { conversationId: mine.conversationId, question: "And a failure?" });
      await s.finished(again.answerId);
      const conversation = await s.t.run((c) => c.db.get("lorekeeperConversations", mine.conversationId));
      expect([conversation!.messageCount, conversation!.title]).toEqual([4, "What does a critical hit do?"]);
      // The second request carries the first exchange as history.
      const history = (JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as { messages: unknown[] }).messages;
      expect(history.length).toBe(3);

      await s.t.run((c) => c.db.patch("lorekeeperConversations", mine.conversationId, { messageCount: 199 }));
      expect(await code(s.ask(undefined, { conversationId: mine.conversationId }))).toBe("LOREKEEPER_CONVERSATION_FULL");
      const messages = await s.t.run((c) => c.db.query("lorekeeperMessages").withIndex("by_conversation", (q) => q.eq("conversationId", mine.conversationId)).take(10));
      expect(messages).toHaveLength(4);
    });
  });

  describe("conversations (Q3: public by default, private on request; Q10: the asker deletes)", () => {
    it("members read public conversations; a private one exists only for its asker", async () => {
      const s = await setup();
      fetchMock.mockImplementation(() => Promise.resolve(sseResponse(textReply("VERDICT: rules\nYes."))));
      const { answerId, conversationId } = await s.ask();
      await s.finished(answerId);
      const read = (client: typeof s.gm) => client.query(api.lorekeeper.listMessages, { campaignId: s.campaignId, conversationId, paginationOpts: { numItems: 5, cursor: null } });

      const gmList = await s.gm.query(api.lorekeeper.listConversations, { campaignId: s.campaignId });
      expect(gmList.mine).toEqual([]);
      expect(gmList.shared.map((c) => [c._id, c.mine, c.visibility])).toEqual([[conversationId, false, "campaign"]]);
      expect((await read(s.gm)).page).toHaveLength(2);
      expect((await s.gm.query(api.lorekeeper.getConversation, { campaignId: s.campaignId, conversationId })).mine).toBe(false);

      // Only the asker toggles, makes private or deletes.
      expect(await code(s.gm.mutation(api.lorekeeper.setVisibility, { campaignId: s.campaignId, conversationId, visibility: "private" }))).toBe("LOREKEEPER_NOT_FOUND");
      expect(await code(s.gm.mutation(api.lorekeeper.setWebSearch, { campaignId: s.campaignId, conversationId, webSearch: true }))).toBe("LOREKEEPER_NOT_FOUND");
      expect(await code(s.gm.mutation(api.lorekeeper.removeConversation, { campaignId: s.campaignId, conversationId }))).toBe("LOREKEEPER_NOT_FOUND");

      await s.player.mutation(api.lorekeeper.setWebSearch, { campaignId: s.campaignId, conversationId, webSearch: true });
      await s.player.mutation(api.lorekeeper.setVisibility, { campaignId: s.campaignId, conversationId, visibility: "private" });
      expect((await s.gm.query(api.lorekeeper.listConversations, { campaignId: s.campaignId })).shared).toEqual([]);
      expect(await code(read(s.gm))).toBe("LOREKEEPER_NOT_FOUND");
      expect(await code(s.gm.query(api.lorekeeper.getConversation, { campaignId: s.campaignId, conversationId }))).toBe("LOREKEEPER_NOT_FOUND");
      const own = await s.player.query(api.lorekeeper.listConversations, { campaignId: s.campaignId });
      expect(own.mine.map((c) => [c.mine, c.visibility, c.webSearch])).toEqual([[true, "private", true]]);

      // A new conversation can start private.
      const secret = await s.ask(s.gm, { visibility: "private" });
      await s.finished(secret.answerId);
      expect((await s.player.query(api.lorekeeper.listConversations, { campaignId: s.campaignId })).shared).toEqual([]);
    });

    it("the asker deletes their conversation with its messages and Ask-the-GM requests", async () => {
      const s = await setup();
      fetchMock.mockImplementation(() => Promise.resolve(sseResponse(textReply("VERDICT: rules\nYes."))));
      const { answerId, conversationId } = await s.ask();
      await s.finished(answerId);
      const playerId = (await s.row(answerId))!.userId;
      await s.t.run((c) => c.db.insert("lorekeeperAsks", { campaignId: s.campaignId, messageId: answerId, askedBy: playerId, askedAt: 1 }));

      await s.player.mutation(api.lorekeeper.removeConversation, { campaignId: s.campaignId, conversationId });
      const left = await s.t.run(async (c) => ({
        conversation: await c.db.get("lorekeeperConversations", conversationId),
        messages: await c.db.query("lorekeeperMessages").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(5),
        asks: await c.db.query("lorekeeperAsks").withIndex("by_message", (q) => q.eq("messageId", answerId)).take(5),
      }));
      expect(left).toEqual({ conversation: null, messages: [], asks: [] });
      expect(await code(s.player.query(api.lorekeeper.getConversation, { campaignId: s.campaignId, conversationId }))).toBe("LOREKEEPER_NOT_FOUND");
    });

    it("a conversation with an answer on its way cannot be deleted", async () => {
      const s = await setup();
      const text = sseFixture("answer-cited");
      fetchMock.mockImplementation((_url, init) => Promise.resolve(gated(text, 10, init?.signal).response));
      const { answerId, conversationId } = await s.ask();
      expect(await code(s.player.mutation(api.lorekeeper.removeConversation, { campaignId: s.campaignId, conversationId }))).toBe("LOREKEEPER_BUSY");
      await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
      expect((await s.row(answerId))!.status).toBe("stopped");
      await s.player.mutation(api.lorekeeper.removeConversation, { campaignId: s.campaignId, conversationId });
    });
  });
});
