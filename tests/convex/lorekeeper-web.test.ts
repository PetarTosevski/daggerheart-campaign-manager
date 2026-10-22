import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ClaudeFailure } from "../../convex/lib/claude";
import type { RetrievedChunk } from "../../convex/lib/lorekeeper/retrieve";
import { webPass } from "../../convex/lib/lorekeeper/web";
import { BOOKS_ONLY_MISS, WEB_MISS } from "../../src/lib/lorekeeper/copy";
import { WEB_BLOCKED_DOMAINS } from "../../src/lib/lorekeeper/prompt";
import { sseFixture, sseResponse } from "../fixtures/lorekeeper/sse";
import { OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D13 L8: the internet pass. After Sonnet and the Opus retry both say 'none' and the conversation's toggle is on,
// the run makes one more Messages API call with the web search server tool and stores its results as the answer's
// internet block. L10: the web pass also runs after an Opus 'unclear' (the book answer is kept and the web results are
// added), and a web miss says the internet was searched. fetch is stubbed with recorded-shape SSE (tests/fixtures/lorekeeper/web-search.sse and built
// streams): no test reaches the API. `retrieve` is mocked so the first passes have book chunks.

const chunks = vi.hoisted(() => ({ value: [] as RetrievedChunk[] }));
vi.mock("../../convex/lib/lorekeeper/retrieve", () => ({ retrieve: async () => chunks.value }));

const API_KEY = "sk-ant-test-key-123";
const RULING = { title: "Hex stacking", text: "Only the strongest Hex applies." };

type SseEvent = { type: string; [field: string]: unknown };
type Body = { model: string; messages: { role: string; content: { type: string; title?: string; text?: string }[] }[]; tools?: Record<string, unknown>[] };

function sse(events: SseEvent[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** A plain text reply (no citations). Usage: 900 in, 60 out. */
function textReply(text: string, model = "claude-sonnet-5-5"): string {
  return sse([
    { type: "message_start", message: { id: "msg_t", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 900, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 60 } },
    { type: "message_stop" },
  ]);
}

/** A web pass reply: a server tool use, a tool result block with `content`, then text with optional web citations. */
function webReply(content: unknown, text: string, citations: Record<string, unknown>[] = [], searches = 1): string {
  return sse([
    { type: "message_start", message: { id: "msg_w", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], usage: { input_tokens: 2000, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"hex"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text } },
    ...citations.map((citation) => ({ type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation } })),
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 100, server_tool_use: { web_search_requests: searches } } },
    { type: "message_stop" },
  ]);
}

const result = (title: string, url: string) => ({ type: "web_search_result", title, url, encrypted_content: "x", page_age: null });

/** A stream that sends `text` up to `splitAt`, then waits for `release()` (or the request's abort). */
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

/** Everything of a web reply but the end of its text block: the text and its citations are sent. */
const beforeLastBlockStop = (text: string) => text.lastIndexOf("event: content_block_stop");
const CITED = { type: "web_search_result_location", cited_text: "Most tables apply only the strongest.", url: "https://example.com/t/1", title: "Do two curses stack?", encrypted_index: "y" };

type Seen = { status: string; phase: string; text: string };
/** Shown text only ever grows: each text extends the one before it (L12). */
function expectOnlyGrows(seen: Seen[]) {
  let before = "";
  for (const { text } of seen) {
    expect(text.startsWith(before), `"${text}" does not extend "${before}"`).toBe(true);
    before = text;
  }
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
    c.db.insert("lorekeeperBooks", { key: "core", title: "Mini Manual", subtitle: "Core rules", cover: "core", pages: 12, chunkCount: 1, ingestedAt: 1, schemaVersion: 1 }),
  );
  const chunkId = await t.run((c) => c.db.insert("lorekeeperChunks", { bookId, page: 2, section: "Core Mechanics → Duality Dice", text: "Roll two d12s.", ord: 0 }));
  chunks.value = [{ chunkId, bookId, bookKey: "core", bookTitle: "Mini Manual", page: 2, section: "Core Mechanics → Duality Dice", text: "Roll two d12s." }];
  await gm.mutation(api.lorekeeperRulings.pin, { campaignId, ...RULING });
  const row = (id: Id<"lorekeeperMessages">) => t.run((c) => c.db.get("lorekeeperMessages", id));
  const finished = (id: Id<"lorekeeperMessages">) => waitFor(() => row(id), (r) => r !== null && TERMINAL.has(r.status));
  const ask = (webSearch: boolean, question = "Do two Hexes stack?") => player.mutation(api.lorekeeper.ask, { campaignId, question, webSearch });
  /** Records every distinct (status, phase, text) of the row until it ends. */
  const trace = (answerId: Id<"lorekeeperMessages">, ms = 20_000) => {
    const seen: Seen[] = [];
    const done = waitFor(
      async () => {
        const r = await row(answerId);
        const next = { status: r?.status ?? "gone", phase: r?.phase ?? "books", text: r?.text ?? "" };
        const last = seen.at(-1);
        if (!last || last.status !== next.status || last.phase !== next.phase || last.text !== next.text) seen.push(next);
        return r;
      },
      (r) => r !== null && TERMINAL.has(r.status) && r.usage !== undefined,
      ms,
    );
    return { seen, done };
  };
  const campaignCost = () =>
    t.run(async (c) => {
      const rows = await c.db.query("lorekeeperUsage").withIndex("by_campaign_period", (q) => q.eq("campaignId", campaignId)).take(5);
      return rows.reduce((sum, r) => sum + r.costMicros, 0);
    });
  return { ...ctx, player, row, finished, ask, campaignCost, trace };
}

describe("lorekeeper internet pass", () => {
  useAllowlist();
  const fetchMock = vi.fn<typeof fetch>();
  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Body);
  /** Sonnet 'none', Opus 'none', then `web` for the third call. */
  const missThen = (web: string) =>
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: none\nNothing in the books.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: none\nStill nothing.", "claude-opus-5-5")))
      .mockResolvedValueOnce(sseResponse(web));

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

  it("a 'none' verdict with the toggle on runs exactly one web pass and stores its results, costed", async () => {
    const s = await setup();
    missThen(sseFixture("web-search"));
    const { answerId } = await s.ask(true);
    const done = await s.finished(answerId);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(done!.status).toBe("done");
    expect(done!.text).toBe("Tables online mostly let only the strongest apply.");
    expect(done!.parts).toEqual({
      verdict: "none",
      quotes: [],
      web: [{ title: "Do two curses stack?", site: "example.com", url: "https://example.com/t/1", snippet: "We only apply the biggest one." }],
    });
    expect(done!.checkedAgain).toBe(true);
    expect(done!.model).toBe("claude-sonnet-5-5");
    expect(done!.usage?.webSearches).toBe(1);
    // Sonnet 900/60 = 2,400; Opus 900/60 = 4,800; web pass 3,000/120 = 7,200 plus one search at $10 per 1,000 = 10,000.
    expect(done!.usage?.costMicros).toBe(2_400 + 4_800 + 7_200 + 10_000);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);

    // The web request: the server tool with its cap and blocked hosts; rulings before the question; no book excerpts,
    // no history, no campaign data.
    const [primary, , web] = bodies();
    expect(primary!.tools).toBeUndefined();
    expect(web!.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3, blocked_domains: [...WEB_BLOCKED_DOMAINS] }]);
    expect(WEB_BLOCKED_DOMAINS).toEqual(expect.arrayContaining(["scribd.com", "pdfcoffee.com", "annas-archive.org"]));
    expect(web!.messages).toHaveLength(1);
    const content = web!.messages[0]!.content;
    expect(content.map((b) => b.type)).toEqual(["document", "text"]);
    expect(content[0]!.title).toBe("Table rulings");
    const raw = JSON.stringify(web);
    expect(raw).toContain("Only the strongest Hex applies.");
    expect(raw).not.toContain("Roll two d12s.");
    expect(raw).not.toContain("Mini Manual");
    expect(content[1]!.text).toContain("Campaign frame: none\nAsker's characters: none\nParty classes: none");
    expect(content[1]!.text).toContain("Do two Hexes stack?");
    expect(raw).not.toContain(API_KEY);
  });

  it("with the toggle off the books-only miss is stored and no web call is made", async () => {
    const s = await setup();
    missThen(sseFixture("web-search"));
    const { answerId } = await s.ask(false);
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies().every((b) => b.tools === undefined)).toBe(true);
    expect(done!.text).toBe(BOOKS_ONLY_MISS);
    expect(done!.parts).toEqual({ verdict: "none", quotes: [] });
  });

  it("a 'rules' verdict never triggers the web pass", async () => {
    const s = await setup();
    fetchMock.mockResolvedValue(sseResponse(textReply("VERDICT: rules\nRoll two d12s.")));
    const { answerId } = await s.ask(true, "How do I roll?");
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(done!.parts?.verdict).toBe("rules");
    expect(done!.parts?.web).toBeUndefined();
  });

  it("a server-tool error result (HTTP 200) degrades to the web miss (D3), and the pass is still costed", async () => {
    const s = await setup();
    missThen(webReply({ type: "web_search_tool_result_error", error_code: "unavailable" }, "VERDICT: none\nThe search failed.", [], 0));
    const { answerId } = await s.ask(true);
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(done!.status).toBe("done");
    expect(done!.text).toBe(WEB_MISS);
    expect(done!.parts).toEqual({ verdict: "none", quotes: [] });
    // Sonnet 2,400 + Opus 4,800 + the web pass's tokens (2,000/100 on Sonnet = 5,000), no search billed.
    expect(done!.usage?.costMicros).toBe(2_400 + 4_800 + 5_000);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);
  });

  it("a web pass where the model runs no search stores the web miss and logs the reason, never the key (D3, D5)", async () => {
    const s = await setup();
    missThen(textReply("VERDICT: none\nThe meaning of life is not a rules question."));
    const { answerId } = await s.ask(true, "Whats the meaning of life");
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(done!.text).toBe(WEB_MISS);
    expect(done!.text).not.toContain("internet search is off");
    expect(done!.parts).toEqual({ verdict: "none", quotes: [] });
    // Sonnet 2,400 + Opus 4,800 + the web pass's tokens (900/60 on Sonnet = 2,400).
    expect(done!.usage?.costMicros).toBe(2_400 + 4_800 + 2_400);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(" "));
    expect(logged.some((line) => line.includes("internet pass failed (no answer)"))).toBe(true);
    expect(logged.join("\n")).not.toContain(API_KEY);
    expect(logged.join("\n")).not.toContain("meaning of life");
  });

  it("an 'unclear' Opus answer with the toggle on gets a web pass: the book answer stays and the web results are added", async () => {
    const s = await setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")))
      .mockResolvedValueOnce(sseResponse(sseFixture("web-search")));
    const { answerId } = await s.ask(true);
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(done!.status).toBe("done");
    expect(done!.text).toBe("Two Hexes are not covered.\n\nTables online mostly let only the strongest apply.");
    expect(done!.parts).toEqual({
      verdict: "unclear",
      quotes: [],
      call: "Apply only the strongest one.",
      web: [{ title: "Do two curses stack?", site: "example.com", url: "https://example.com/t/1", snippet: "We only apply the biggest one." }],
    });
    expect(done!.checkedAgain).toBe(true);
    expect(done!.usage?.webSearches).toBe(1);
    expect(done!.usage?.costMicros).toBe(2_400 + 4_800 + 7_200 + 10_000);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);

    // The web request says the books were unclear, sends the question, keeps the cap and blocked hosts, and carries
    // no book excerpts and no campaign data.
    const web = bodies()[2]!;
    expect(web.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 3, blocked_domains: [...WEB_BLOCKED_DOMAINS] }]);
    const text = web.messages[0]!.content.at(-1)!.text!;
    expect(text).toContain("touch on this question but don't settle it");
    expect(text).not.toContain("books had nothing");
    expect(text).toContain("Do two Hexes stack?");
    expect(text).toContain("Campaign frame: none\nAsker's characters: none\nParty classes: none");
    expect(JSON.stringify(web)).not.toContain("Roll two d12s.");
  });

  it("an 'unclear' answer whose web pass finds nothing keeps the Opus answer unchanged, the pass costed", async () => {
    const s = await setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")))
      .mockResolvedValueOnce(sseResponse(webReply({ type: "web_search_tool_result_error", error_code: "unavailable" }, "VERDICT: unclear\nThe search failed.", [], 0)));
    const { answerId } = await s.ask(true);
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(done!.text).toBe("Two Hexes are not covered.");
    expect(done!.parts).toEqual({ verdict: "unclear", quotes: [], call: "Apply only the strongest one." });
    expect(done!.model).toBe("claude-opus-5-5");
    expect(done!.usage?.costMicros).toBe(2_400 + 4_800 + 5_000);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);
  });

  it("Stop during the web pass keeps the retry's finished answer (shown under 'web'), the web pass costed (L11, L12)", async () => {
    const s = await setup();
    let webSignal: AbortSignal | null | undefined;
    let webCalled = false;
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")))
      .mockImplementationOnce((_url, init) => {
        webSignal = init?.signal;
        webCalled = true;
        // A web reply that never ends until the request is aborted.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(webReply([], "x").slice(0, 300)));
            webSignal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
      });
    const { answerId } = await s.ask(true);
    const searching = await waitFor(() => s.row(answerId), (r) => r?.phase === "web" && webCalled);
    // L12: the kept book answer shows (with its 'Checked again' note) while the internet pass runs.
    expect([searching!.status, searching!.text, searching!.parts?.verdict, searching!.parts?.call, searching!.parts?.web, searching!.checkedAgain]).toEqual([
      "streaming",
      "Two Hexes are not covered.",
      "unclear",
      "Apply only the strongest one.",
      undefined,
      true,
    ]);
    await s.player.mutation(api.lorekeeper.stop, { campaignId: s.campaignId, answerId });
    const stopped = await waitFor(() => s.row(answerId), (r) => r?.usage !== undefined);
    expect(webSignal?.aborted).toBe(true);
    expect([stopped!.status, stopped!.text, stopped!.parts?.verdict, stopped!.parts?.call, stopped!.parts?.web, stopped!.checkedAgain]).toEqual([
      "stopped",
      "Two Hexes are not covered.",
      "unclear",
      "Apply only the strongest one.",
      undefined,
      true,
    ]);
    expect(stopped!.reserved?.micros).toBe(0);
    expect(await s.campaignCost()).toBe(stopped!.usage!.costMicros);
  });

  it("unclear + web: the kept book answer shows when the web pass starts, then the web part writes out under it (L12)", async () => {
    const s = await setup();
    let release = () => {};
    let webStartedAt: { phase?: string; text?: string } | null = null;
    const web = webReply([result("Do two curses stack?", "https://example.com/t/1")], "Tables online mostly let only the strongest apply.", [CITED]);
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")))
      .mockImplementationOnce(async (_url, init) => {
        const r = await s.t.run(async (c) => (await c.db.query("lorekeeperMessages").order("desc").take(5)).find((m) => m.role === "answer"));
        webStartedAt = { phase: r?.phase, text: r?.text };
        const g = gated(web, beforeLastBlockStop(web), init?.signal);
        release = g.release;
        return g.response;
      });
    const { answerId } = await s.ask(true);
    const { seen, done } = s.trace(answerId);
    // The web part writes out live once the pass has a result (its citation), under the book answer.
    const live = await waitFor(() => s.row(answerId), (r) => r?.status === "streaming" && (r.text ?? "").includes("Tables online"));
    expect(webStartedAt).toEqual({ phase: "web", text: "Two Hexes are not covered." });
    expect([live!.phase, live!.text, live!.parts?.call, live!.parts?.web?.map((w) => w.url)]).toEqual([
      "web",
      "Two Hexes are not covered.\n\nTables online mostly let only the strongest apply.",
      "Apply only the strongest one.",
      ["https://example.com/t/1"],
    ]);
    release();
    const final = await done;
    expect([final!.status, final!.text, final!.checkedAgain]).toEqual(["done", "Two Hexes are not covered.\n\nTables online mostly let only the strongest apply.", true]);
    expect(seen.filter((x) => x.phase === "books" || x.phase === "retry").every((x) => x.text === "")).toBe(true);
    expectOnlyGrows(seen);
    expect(final!.reserved?.micros).toBe(0);
    expect(await s.campaignCost()).toBe(final!.usage!.costMicros);
  });

  it("none + web: nothing shows before the web pass has a result, then the web answer writes out (L12)", async () => {
    const s = await setup();
    let release = () => {};
    const web = webReply([result("Do two curses stack?", "https://example.com/t/1")], "Tables online mostly let only the strongest apply.", [CITED]);
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: none\nNothing in the books.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: none\nStill nothing.", "claude-opus-5-5")))
      .mockImplementationOnce((_url, init) => {
        const g = gated(web, beforeLastBlockStop(web), init?.signal);
        release = g.release;
        return Promise.resolve(g.response);
      });
    const { answerId } = await s.ask(true);
    const { seen, done } = s.trace(answerId);
    const live = await waitFor(() => s.row(answerId), (r) => r?.status === "streaming" && r.text !== "");
    expect([live!.phase, live!.text, live!.parts?.verdict, live!.parts?.web?.length]).toEqual(["web", "Tables online mostly let only the strongest apply.", "none", 1]);
    release();
    const final = await done;
    expect([final!.status, final!.text, final!.parts?.verdict]).toEqual(["done", "Tables online mostly let only the strongest apply.", "none"]);
    expect(seen.some((x) => /Nothing in the books|Still nothing/.test(x.text))).toBe(false);
    expectOnlyGrows(seen);
  });

  it("a web miss never shows the web pass's text: the row goes from empty to the web miss (L12)", async () => {
    const s = await setup();
    missThen(webReply({ type: "web_search_tool_result_error", error_code: "unavailable" }, "VERDICT: none\nThe search failed.", [], 0));
    const { answerId } = await s.ask(true);
    const { seen, done } = s.trace(answerId);
    const final = await done;
    expect(final!.text).toBe(WEB_MISS);
    expect(seen.filter((x) => x.status !== "done").every((x) => x.text === "")).toBe(true);
    expect(seen.some((x) => x.text.includes("The search failed"))).toBe(false);
  });

  it("an 'unclear' answer with the toggle off makes no web call", async () => {
    const s = await setup();
    fetchMock
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nThe books don't settle it.")))
      .mockResolvedValueOnce(sseResponse(textReply("VERDICT: unclear\nTwo Hexes are not covered.\nGM CALL: Apply only the strongest one.", "claude-opus-5-5")));
    const { answerId } = await s.ask(false);
    const done = await s.finished(answerId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(done!.parts).toEqual({ verdict: "unclear", quotes: [], call: "Apply only the strongest one." });
  });

  it("stores result text as plain text: at most 3 results, cited ones first, non-http urls dropped, snippets cut to 300", async () => {
    const s = await setup();
    const longSnippet = `${"word ".repeat(100)}end`;
    missThen(
      webReply(
        [
          result("javascript trick", "javascript:alert(1)"),
          result("<b>Bold</b> & co", "https://forum.example.com/a"),
          result("Second", "https://www.example.org/b"),
          result("Third", "http://example.net/c"),
          result("Fourth", "https://example.edu/d"),
        ],
        "VERDICT: none\n**Most** tables <i>let</i> the GM decide.",
        [{ type: "web_search_result_location", cited_text: longSnippet, url: "https://example.edu/d", title: "Fourth", encrypted_index: "y" }],
        2,
      ),
    );
    const { answerId } = await s.ask(true);
    const done = await s.finished(answerId);
    const web = done!.parts!.web!;
    expect(web.map((w) => w.url)).toEqual(["https://example.edu/d", "https://forum.example.com/a", "https://www.example.org/b"]);
    expect(web[0]!.snippet.length).toBeLessThanOrEqual(300);
    expect(web[0]!.snippet.endsWith("…")).toBe(true);
    expect(web[1]).toEqual({ title: "<b>Bold</b> & co", site: "forum.example.com", url: "https://forum.example.com/a", snippet: "" });
    expect(web[2]!.site).toBe("example.org");
    expect(done!.text).toBe("**Most** tables <i>let</i> the GM decide.");
    expect(done!.usage?.webSearches).toBe(2);
  });
});

describe("lorekeeper internet pass with the e2e fake model (L10)", () => {
  useAllowlist();
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    process.env.CONVEX_CLOUD_URL = "http://127.0.0.1:3212";
    process.env.LOREKEEPER_FAKE_MODEL = "true";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LOREKEEPER_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.CONVEX_CLOUD_URL;
    delete process.env.LOREKEEPER_FAKE_MODEL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("'Do our Hexes stack?' with the toggle on keeps the unclear answer, its book quote and GM call, and adds web results", async () => {
    const s = await setup();
    const { answerId } = await s.ask(true, "Do our Hexes stack?");
    // L11/L12: watch the row while it runs: the phases in order; no text during 'books' or 'retry'; the kept book
    // answer first shows under 'web', then the web part is added under it; the text only grows.
    const { seen, done: finished } = s.trace(answerId, 45_000);
    const done = await finished;
    expect(seen.map((x) => x.phase).filter((p, i, a) => a.indexOf(p) === i)).toEqual(["books", "retry", "web", "done"]);
    expect(seen.filter((x) => x.phase === "books" || x.phase === "retry").every((x) => x.text === "")).toBe(true);
    const firstShown = seen.find((x) => x.text !== "")!;
    expect(firstShown.phase).toBe("web");
    expect(firstShown.text).toMatch(/^The books describe one Hex at a time/);
    expect(firstShown.text).not.toContain("Online, players");
    expectOnlyGrows(seen);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(done!.status).toBe("done");
    expect(done!.checkedAgain).toBe(true);
    expect(done!.parts?.verdict).toBe("unclear");
    expect(done!.parts?.quotes).toEqual([expect.objectContaining({ kind: "book", page: 2, section: "Core Mechanics → Duality Dice" })]);
    expect(done!.parts?.call).toBe("Apply only the strongest Hex, and say so at the table.");
    expect(done!.parts?.web?.map((w) => w.url)).toEqual(["https://example.com/forum/thread-1", "https://example.org/blog/rulings"]);
    expect(done!.text).toMatch(/^The books describe one Hex at a time[\s\S]*\n\nOnline, players describe/);
    expect(done!.usage?.webSearches).toBe(1);
    expect(await s.campaignCost()).toBe(done!.usage!.costMicros);
    expect(done!.reserved?.micros).toBe(0);
  }, 60_000);

  it("the same question with the toggle off keeps the unclear answer without a web block", async () => {
    const s = await setup();
    const { answerId } = await s.ask(false, "Do our Hexes stack?");
    const done = await waitFor(() => s.row(answerId), (r) => r !== null && TERMINAL.has(r.status), 45_000);
    expect(done!.parts?.verdict).toBe("unclear");
    expect(done!.parts?.web).toBeUndefined();
    expect(done!.usage?.webSearches).toBe(0);
  }, 60_000);
});

describe("webPass", () => {
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

  it("returns prose, results, usage and model from the recorded stream", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("web-search"), 5));
    const out = await webPass("Do two Hexes stack?", []);
    expect(out).toEqual({
      prose: "Tables online mostly let only the strongest apply.",
      web: [{ title: "Do two curses stack?", site: "example.com", url: "https://example.com/t/1", snippet: "We only apply the biggest one." }],
      usage: { input: 3000, output: 120, cacheRead: 0, cacheWrite: 0, webSearches: 1 },
      model: "claude-sonnet-5-5",
    });
    // Without rulings the user turn is the text block only.
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Body;
    expect(body.messages[0]!.content.map((b) => b.type)).toEqual(["text"]);
  });

  it("uses LOREKEEPER_MODEL when set", async () => {
    process.env.LOREKEEPER_MODEL = "claude-haiku-5-5";
    fetchMock.mockResolvedValue(sseResponse(sseFixture("web-search")));
    await webPass("Do two Hexes stack?", []);
    expect((JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Body).model).toBe("claude-haiku-5-5");
  });

  it("a completed call without usable results throws ClaudeFailure carrying the usage", async () => {
    fetchMock.mockResolvedValue(sseResponse(webReply([result("ftp only", "ftp://example.com/x")], "VERDICT: none\nNothing useful.")));
    const failure = await webPass("Do two Hexes stack?", []).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ClaudeFailure);
    expect((failure as ClaudeFailure).reason).toBe("no answer");
    expect((failure as ClaudeFailure).partial.usage).toEqual({ input: 2000, output: 100, cacheRead: 0, cacheWrite: 0, webSearches: 1 });
  });

  it("an HTTP error and Stop surface as the client's ClaudeFailure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(webPass("q?", [])).rejects.toMatchObject({ reason: "HTTP 500" });
    const stop = new AbortController();
    stop.abort();
    fetchMock.mockImplementationOnce((_url, init) => (init?.signal?.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : Promise.resolve(sseResponse(""))));
    await expect(webPass("q?", [], stop.signal)).rejects.toMatchObject({ reason: "aborted" });
  });

  it("sends nothing for a blank question", async () => {
    expect(await webPass("   ", [])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
