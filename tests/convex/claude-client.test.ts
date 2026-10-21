import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeFailure,
  CLAUDE_TIMEOUT_MS,
  fakeModelEnabled,
  lorekeeperAvailable,
  messagesStream,
  modelFor,
  OPUS,
  SONNET,
  SseDecoder,
  type Citation,
  type MessagesBody,
} from "../../convex/lib/claude";
import { sseFixture, sseResponse } from "../fixtures/lorekeeper/sse";

// D13 L0: the Lorekeeper's streaming Messages API client. fetch is stubbed with recorded-shape SSE fixtures
// (tests/fixtures/lorekeeper/*.sse) served in chunks of every size; no test calls the real API.

const KEY = "sk-ant-test-0123456789-secret";
const ENV_NAMES = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "LOREKEEPER_MODEL", "LOREKEEPER_FAKE_MODEL", "CONVEX_CLOUD_URL"] as const;
const LOCAL_URL = "http://127.0.0.1:3212";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";

const BODY: MessagesBody = { max_tokens: 2000, messages: [{ role: "user", content: "<question>What is a critical hit?</question>" }] };

let saved: Record<string, string | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = KEY;
  process.env.CONVEX_CLOUD_URL = CLOUD_URL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  errorSpy.mockRestore();
});

/** Runs a stream, collecting the callbacks. */
async function run(body: MessagesBody = BODY, signal?: AbortSignal) {
  const deltas: string[] = [];
  const citations: { citation: Citation; block: number }[] = [];
  const result = await messagesStream(
    body,
    (delta) => deltas.push(delta),
    (citation, block) => citations.push({ citation, block }),
    signal,
  );
  return { result, deltas, citations };
}

/** The ClaudeFailure a stream ends with. */
async function failure(body: MessagesBody = BODY, signal?: AbortSignal): Promise<ClaudeFailure> {
  try {
    await run(body, signal);
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeFailure);
    return error as ClaudeFailure;
  }
  throw new Error("expected a ClaudeFailure");
}

/** Neither the error (message, fields, partial reply) nor anything logged mentions the key. */
function expectNoKey(error: unknown) {
  expect(String(error)).not.toContain(KEY);
  expect(JSON.stringify(error)).not.toContain(KEY);
  expect(JSON.stringify((errorSpy.mock.calls as unknown[][]).map((call) => call.map(String)))).not.toContain(KEY);
}

describe("messagesStream", () => {
  it.each([1, 7, 17, 64, 100_000])("streams a cited answer served in %i-byte chunks", async (chunkBytes) => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("answer-cited"), chunkBytes));
    const { result, deltas, citations } = await run();

    const text = "VERDICT: rules\nA critical hit always succeeds — and it deals the weapon's highest damage plus a roll.";
    expect(result.text).toBe(text);
    expect(deltas.join("")).toBe(text);
    expect(deltas.length).toBeGreaterThanOrEqual(3);
    expect(result.stopReason).toBe("end_turn");
    expect(result.model).toBe(SONNET);
    expect(result.usage).toEqual({ input: 9480, output: 412, cacheRead: 1512, cacheWrite: 0, webSearches: 0 });
    expect(citations).toEqual([
      {
        block: 1,
        citation: expect.objectContaining({ type: "content_block_location", cited_text: "A critical hit always succeeds.", document_index: 1 }),
      },
    ]);
    expect(result.blocks.map((b) => (b.type === "text" ? b.citations.length : -1))).toEqual([0, 1]);
  });

  it("sends the key only as the x-api-key header, with the API version, stream: true and the default model", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("answer-cited")));
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBeUndefined();
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: SONNET, stream: true, max_tokens: 2000 });
    expect(init.body as string).not.toContain(KEY);
  });

  it("passes betas as one anthropic-beta header and keeps an explicit model", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("answer-cited")));
    await messagesStream({ ...BODY, model: OPUS }, () => {}, () => {}, undefined, { betas: ["a-1", "b-2"] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["anthropic-beta"]).toBe("a-1,b-2");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: OPUS });
  });

  it("keeps server tool blocks (web search) with their input JSON, and counts the searches", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("web-search"), 5));
    const { result, citations } = await run();
    const [use, results, text] = result.blocks;
    expect(use).toMatchObject({ type: "other", blockType: "server_tool_use" });
    expect(use?.type === "other" && JSON.parse(use.inputJson)).toEqual({ query: "two hexes stack" });
    expect(results).toMatchObject({ type: "other", blockType: "web_search_tool_result" });
    expect(text).toMatchObject({ type: "text", text: "Tables online mostly let only the strongest apply." });
    expect(citations[0]).toMatchObject({ block: 2, citation: { type: "web_search_result_location", url: "https://example.com/t/1" } });
    expect(result.usage.webSearches).toBe(1);
  });

  it("ends a refusal as 'refusal', keeping the partial text and usage", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("refusal")));
    const error = await failure();
    expect(error.reason).toBe("refusal");
    expect(error.partial.text).toBe("I can");
    expect(error.partial.usage).toMatchObject({ input: 2100, output: 5 });
    expectNoKey(error);
  });

  it("ends a max_tokens stop as 'too long'", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("max-tokens"), 3));
    const error = await failure();
    expect(error.reason).toBe("too long");
    expect(error.partial.usage.output).toBe(2000);
    expectNoKey(error);
  });

  it("ends a mid-stream overloaded error event as 'HTTP 529'", async () => {
    fetchMock.mockResolvedValue(sseResponse(sseFixture("overloaded"), 9));
    const error = await failure();
    expect(error.reason).toBe("HTTP 529");
    expect(error.partial.text).toBe("VERDICT: ");
    expectNoKey(error);
  });

  it("ends an HTTP error as 'HTTP <status>' and logs at most 500 characters of the reply", async () => {
    fetchMock.mockResolvedValue(new Response(`{"type":"error","error":{"type":"api_error","message":"${"x".repeat(900)}"}}`, { status: 500 }));
    const error = await failure();
    expect(error.reason).toBe("HTTP 500");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![1]).length).toBeLessThanOrEqual(500);
    expectNoKey(error);
  });

  it("ends a failed request as 'network'", async () => {
    fetchMock.mockRejectedValue(new TypeError(`connect failed for ${KEY}`));
    const error = await failure();
    expect(error.reason).toBe("network");
    expectNoKey(error);
  });

  it("ends a stream that stops without message_stop as 'no answer'", async () => {
    const cut = sseFixture("answer-cited").split("event: message_delta")[0]!;
    fetchMock.mockResolvedValue(sseResponse(cut));
    const error = await failure();
    expect(error.reason).toBe("no answer");
    expect(error.partial.text).toContain("A critical hit");
  });

  it("times out after 120 s as 'timeout'", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = failure();
    await vi.advanceTimersByTimeAsync(CLAUDE_TIMEOUT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error.reason).toBe("timeout");
    expectNoKey(error);
  });

  it("ends as 'aborted' when the caller aborts mid-stream (Stop), keeping the text so far", async () => {
    const controller = new AbortController();
    const text = sseFixture("answer-cited");
    const bytes = new TextEncoder().encode(text);
    const half = text.indexOf("event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1");
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(bytes.slice(0, new TextEncoder().encode(text.slice(0, half)).length));
          init.signal!.addEventListener("abort", () => stream.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const deltas: string[] = [];
    const pending = messagesStream(BODY, (delta) => {
      deltas.push(delta);
      if (deltas.join("").includes("always succeeds")) controller.abort();
    }, () => {}, controller.signal);
    const error = await pending.then(
      () => null,
      (e: unknown) => e as ClaudeFailure,
    );
    expect(error?.reason).toBe("aborted");
    expect(error?.partial.text).toBe("VERDICT: rules\nA critical hit always succeeds — ");
  });

  it("refuses without a key ('unavailable') and never calls fetch", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const error = await failure();
    expect(error.reason).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.ANTHROPIC_API_KEY = "   ";
    expect((await failure()).reason).toBe("unavailable");
    expect(lorekeeperAvailable()).toBe(false);
  });
});

describe("SseDecoder", () => {
  it("handles CRLF, comments, multi-line data and a final event without a blank line", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": keep-alive\r\nevent: a\r\ndata: {\"x\":\r\ndata: 1}\r\n\r\nevent: b\r\n")).toEqual([{ event: "a", data: { x: 1 } }]);
    expect(decoder.push("data: {\"y\":2}")).toEqual([]);
    expect(decoder.flush()).toEqual([{ event: "b", data: { y: 2 } }]);
    expect(decoder.push("data: not json\n\n")).toEqual([]);
  });
});

describe("modelFor", () => {
  it("answers with LOREKEEPER_MODEL, else ANTHROPIC_MODEL, else Sonnet 5.5; retries with Opus 5.5", () => {
    expect(modelFor("answer")).toBe("claude-sonnet-5-5");
    expect(modelFor("web")).toBe("claude-sonnet-5-5");
    expect(modelFor("retry")).toBe("claude-opus-5-5");
    process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";
    expect(modelFor("answer")).toBe("claude-haiku-5-5");
    process.env.LOREKEEPER_MODEL = " claude-opus-5-5 ";
    expect(modelFor("answer")).toBe("claude-opus-5-5");
    expect(modelFor("retry")).toBe("claude-opus-5-5");
  });
});

describe("the e2e fake model", () => {
  /** Runs a stream under fake timers (the fake model ticks between events). */
  async function runFake(body: MessagesBody) {
    vi.useFakeTimers();
    const pending = run(body);
    await vi.runAllTimersAsync();
    return pending;
  }

  const document = (title: string, text: string) => ({
    type: "document",
    source: { type: "content", content: [{ type: "text", text }] },
    title,
    citations: { enabled: true },
  });

  it("replays canned answers on the local e2e deployment, without the key and without fetch", async () => {
    process.env.CONVEX_CLOUD_URL = LOCAL_URL;
    process.env.LOREKEEPER_FAKE_MODEL = "true";
    delete process.env.ANTHROPIC_API_KEY;
    expect(fakeModelEnabled()).toBe(true);
    expect(lorekeeperAvailable()).toBe(true);

    const cited = await runFake({
      messages: [{ role: "user", content: [document("Mini Manual · p.3 · Core Mechanics", "A critical hit always succeeds."), { type: "text", text: "<question>Critical hits?</question>" }] }],
    });
    expect(cited.result.text.startsWith("VERDICT: rules\n")).toBe(true);
    expect(cited.deltas.length).toBeGreaterThan(3);
    expect(cited.citations[0]?.citation).toMatchObject({ type: "content_block_location", document_index: 0, cited_text: "A critical hit always succeeds." });

    const hex = await runFake({
      messages: [{ role: "user", content: [document("Mini Manual · p.10 · Classes → Hex", "A hexed target rolls with a penalty."), { type: "text", text: "<question>Do Hexes stack?</question>" }] }],
    });
    expect(hex.result.text).toMatch(/^VERDICT: unclear\n[\s\S]*\nGM CALL: /);

    const miss = await runFake({ messages: [{ role: "user", content: "<question>Can I fly?</question>" }] });
    expect(miss.result.text.startsWith("VERDICT: none")).toBe(true);
    expect(miss.citations).toEqual([]);

    const web = await runFake({ messages: [{ role: "user", content: "<question>Can I fly?</question>" }], tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] });
    expect(web.result.usage.webSearches).toBe(1);
    expect(web.result.blocks.some((b) => b.type === "other" && b.blockType === "web_search_tool_result")).toBe(true);
    expect(web.citations[0]?.citation.type).toBe("web_search_result_location");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores the flag on any other deployment: the real API is called with the key, or the call is unavailable", async () => {
    process.env.LOREKEEPER_FAKE_MODEL = "true";
    process.env.CONVEX_CLOUD_URL = CLOUD_URL;
    expect(fakeModelEnabled()).toBe(false);
    fetchMock.mockResolvedValue(sseResponse(sseFixture("answer-cited")));
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.ANTHROPIC_API_KEY;
    expect(lorekeeperAvailable()).toBe(false);
    expect((await failure()).reason).toBe("unavailable");

    // A non-local self-hosted URL is not the e2e deployment either.
    process.env.CONVEX_CLOUD_URL = "https://convex.example.com";
    expect(fakeModelEnabled()).toBe(false);
    // The local deployment without the flag uses the real path too.
    process.env.CONVEX_CLOUD_URL = LOCAL_URL;
    process.env.LOREKEEPER_FAKE_MODEL = "1";
    expect(fakeModelEnabled()).toBe(false);
  });

  it("stops the fake stream on abort", async () => {
    process.env.CONVEX_CLOUD_URL = LOCAL_URL;
    process.env.LOREKEEPER_FAKE_MODEL = "true";
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = failure({ messages: [{ role: "user", content: "<question>Can I fly?</question>" }] }, controller.signal);
    await vi.advanceTimersByTimeAsync(200);
    controller.abort();
    await vi.runAllTimersAsync();
    expect((await pending).reason).toBe("aborted");
  });
});
