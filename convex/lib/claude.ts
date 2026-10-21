/**
 * The Claude Messages API client of the Lorekeeper (D13 L0, analysis 4 and 5.1): raw `fetch` with `stream: true`,
 * the SSE parser, a 120 s timeout, caller aborts (Stop) and `ClaudeFailure` reasons. The only module that reads
 * `ANTHROPIC_API_KEY` (CF19: through the typed `env`, inside calls, never at module scope). The key is never
 * returned, logged or put into an error. Runs in an action (`fetch` and timers); no "use node" needed.
 *
 * On the local e2e deployment only, `LOREKEEPER_FAKE_MODEL=true` replaces the API with canned answers that go
 * through the same parser (`fakeStream`), so browser tests never call the real API. Anywhere else the flag is
 * ignored, key or no key.
 *
 * `convex/combatMapGenerate.ts` and `convex/photoImport.ts` still call the API themselves (a follow-up moves them
 * here).
 */
import { env } from "../_generated/server";
import { isE2EDeployment } from "./allowlist";

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
/** How long one Messages API call may take, stream included (as combatMapGenerate.ts). */
export const CLAUDE_TIMEOUT_MS = 120_000;

export const SONNET = "claude-sonnet-5-5";
export const OPUS = "claude-opus-5-5";

/**
 * What a call is for (Q2): `answer` is the first pass, `retry` the automatic second pass when the first finds
 * nothing ('Checked again with a stronger model'), `web` the internet pass (L8).
 */
export type LorekeeperTask = "answer" | "retry" | "web";

/** The API key, read in the call (CF19); undefined when unset or blank. Never return or log it. */
export function apiKey(): string | undefined {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

/** Whether canned answers replace the API: only on the local e2e deployment, and only with the flag set. */
export function fakeModelEnabled(): boolean {
  return isE2EDeployment(env) && env.LOREKEEPER_FAKE_MODEL === "true";
}

/** Whether the Lorekeeper can answer on this deployment (L3's `lorekeeper.available`, a boolean only). */
export function lorekeeperAvailable(): boolean {
  return apiKey() !== undefined || fakeModelEnabled();
}

/** The model for a task: `retry` is Opus 5.5; otherwise LOREKEEPER_MODEL, else ANTHROPIC_MODEL, else Sonnet 5.5. */
export function modelFor(task: LorekeeperTask): string {
  if (task === "retry") return OPUS;
  return env.LOREKEEPER_MODEL?.trim() || env.ANTHROPIC_MODEL?.trim() || SONNET;
}

// ---------------------------------------------------------------- types

/** Token usage of one call (cumulative over the stream). */
export type StreamUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  webSearches: number;
};

/**
 * A citation as the API sends it: `content_block_location` for custom-content documents (the chunks),
 * `char_location` / `page_location` for other documents, `web_search_result_location` for web results.
 * L1's answer parser maps them to quotes.
 */
export type Citation = {
  type: string;
  cited_text: string;
  document_index?: number;
  document_title?: string | null;
  start_block_index?: number;
  end_block_index?: number;
  start_char_index?: number;
  end_char_index?: number;
  url?: string;
  title?: string | null;
};

/** A content block of the reply: text with its citations, or any other block (server tool use and results). */
export type StreamBlock =
  | { type: "text"; text: string; citations: Citation[] }
  | { type: "other"; blockType: string; raw: Record<string, unknown>; inputJson: string };

export type StreamResult = {
  model: string;
  /** All text blocks joined. */
  text: string;
  blocks: StreamBlock[];
  stopReason: string | null;
  usage: StreamUsage;
};

/** Why a call failed. `HTTP <status>` carries the API's status; `aborted` is the caller's own abort (Stop). */
export type ClaudeFailureReason =
  | "unavailable"
  | "timeout"
  | "aborted"
  | "network"
  | `HTTP ${number}`
  | "refusal"
  | "too long"
  | "stream error"
  | "no answer";

/**
 * A failed call, with what had streamed so far (`partial`: text and usage, so the caller can keep the text after a
 * Stop and settle the caps with the real usage). The message names only the reason, never the key or the request.
 */
export class ClaudeFailure extends Error {
  constructor(
    readonly reason: ClaudeFailureReason,
    readonly partial: StreamResult,
  ) {
    super(`The Messages API call failed: ${reason}.`);
    this.name = "ClaudeFailure";
  }
}

/** The request body; `stream` is always set to true and `model` defaults to `modelFor("answer")`. */
export type MessagesBody = { model?: string; [field: string]: unknown };

export type StreamOptions = {
  /** `anthropic-beta` values (e.g. the server-side refusal fallback). */
  betas?: string[];
};

// ---------------------------------------------------------------- SSE parsing

export type SseEvent = { event: string | null; data: unknown };

/**
 * Splits a server-sent-event stream into events, across any chunk boundary. Feed decoded text with `push`; each
 * call returns the events completed by it. `data:` lines are JSON; a malformed one is skipped.
 */
export class SseDecoder {
  private buffer = "";

  push(text: string): SseEvent[] {
    this.buffer += text.replace(/\r\n?/g, "\n");
    const events: SseEvent[] = [];
    let end = this.buffer.indexOf("\n\n");
    while (end !== -1) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const event = parseEvent(raw);
      if (event) events.push(event);
      end = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  /** The last event when the stream ends without a blank line. */
  flush(): SseEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    const event = rest.trim() ? parseEvent(rest) : null;
    return event ? [event] : [];
  }
}

function parseEvent(raw: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) as unknown };
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Applies the Messages API's stream events to a result, calling back on text and citations. */
class StreamState {
  readonly result: StreamResult;
  stopped = false;
  error: { type: string } | null = null;

  constructor(
    model: string,
    private readonly onText: (delta: string, blockIndex: number) => void,
    private readonly onCitation: (citation: Citation, blockIndex: number) => void,
  ) {
    this.result = { model, text: "", blocks: [], stopReason: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 } };
  }

  private usage(raw: unknown) {
    if (!isObject(raw)) return;
    const usage = this.result.usage;
    usage.input = num(raw.input_tokens) ?? usage.input;
    usage.output = num(raw.output_tokens) ?? usage.output;
    usage.cacheRead = num(raw.cache_read_input_tokens) ?? usage.cacheRead;
    usage.cacheWrite = num(raw.cache_creation_input_tokens) ?? usage.cacheWrite;
    if (isObject(raw.server_tool_use)) usage.webSearches = num(raw.server_tool_use.web_search_requests) ?? usage.webSearches;
  }

  handle({ data }: SseEvent) {
    if (!isObject(data) || typeof data.type !== "string") return;
    switch (data.type) {
      case "message_start":
        if (isObject(data.message)) {
          if (typeof data.message.model === "string") this.result.model = data.message.model;
          this.usage(data.message.usage);
        }
        return;
      case "content_block_start": {
        const index = num(data.index);
        const block = data.content_block;
        if (index === undefined || !isObject(block)) return;
        if (block.type === "text") {
          const text = typeof block.text === "string" ? block.text : "";
          this.result.blocks[index] = { type: "text", text, citations: [] };
          if (text) this.text(text, index);
        } else {
          this.result.blocks[index] = { type: "other", blockType: String(block.type), raw: block, inputJson: "" };
        }
        return;
      }
      case "content_block_delta": {
        const index = num(data.index);
        const delta = data.delta;
        if (index === undefined || !isObject(delta)) return;
        const block = this.result.blocks[index];
        if (delta.type === "text_delta" && typeof delta.text === "string" && block?.type === "text") {
          block.text += delta.text;
          this.text(delta.text, index);
        } else if (delta.type === "citations_delta" && isObject(delta.citation) && block?.type === "text") {
          const citation = delta.citation as Citation;
          block.citations.push(citation);
          this.onCitation(citation, index);
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && block?.type === "other") {
          block.inputJson += delta.partial_json;
        }
        return;
      }
      case "message_delta":
        if (isObject(data.delta) && typeof data.delta.stop_reason === "string") this.result.stopReason = data.delta.stop_reason;
        this.usage(data.usage);
        return;
      case "message_stop":
        this.stopped = true;
        return;
      case "error":
        this.error = { type: isObject(data.error) && typeof data.error.type === "string" ? data.error.type : "unknown" };
        return;
      default:
        // ping, content_block_stop, thinking deltas: nothing to keep.
        return;
    }
  }

  private text(delta: string, index: number) {
    this.result.text += delta;
    this.onText(delta, index);
  }
}

// ---------------------------------------------------------------- the call

/**
 * One streamed Messages API call; no retry. Calls `onText` for each text delta and `onCitation` for each citation
 * as they arrive, and resolves with the whole reply (text, blocks, stop reason, usage). Throws `ClaudeFailure`
 * (with the partial reply) on a missing key, the 120 s timeout, the caller's `signal`, a network error, an HTTP
 * error, a stream `error` event, a refusal, `max_tokens` ("too long") or a stream that ends without `message_stop`.
 */
export async function messagesStream(
  body: MessagesBody,
  onText: (delta: string, blockIndex: number) => void,
  onCitation: (citation: Citation, blockIndex: number) => void,
  signal?: AbortSignal,
  options: StreamOptions = {},
): Promise<StreamResult> {
  const request = { ...body, model: body.model ?? modelFor("answer"), stream: true };
  const state = new StreamState(request.model, onText, onCitation);
  const fail = (reason: ClaudeFailureReason) => new ClaudeFailure(reason, state.result);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CLAUDE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", onAbort);
  const abortReason = (): ClaudeFailureReason => (timedOut ? "timeout" : signal?.aborted ? "aborted" : "network");

  try {
    let chunks: AsyncIterable<Uint8Array>;
    if (fakeModelEnabled()) {
      chunks = fakeStream(request, controller.signal);
    } else {
      const key = apiKey();
      if (key === undefined) throw fail("unavailable");
      let response: Response;
      try {
        response = await fetch(MESSAGES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            ...(options.betas?.length ? { "anthropic-beta": options.betas.join(",") } : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (error) {
        const reason = abortReason();
        if (reason === "network") console.error("Lorekeeper: the Messages API request failed.", errorName(error));
        throw fail(reason);
      }
      if (!response.ok) {
        console.error(`Lorekeeper: the Messages API answered ${response.status}.`, (await safeText(response)).slice(0, 500));
        throw fail(`HTTP ${response.status}`);
      }
      if (response.body === null) throw fail("no answer");
      chunks = readerChunks(response.body);
    }

    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    try {
      for await (const chunk of chunks) {
        for (const event of sse.push(decoder.decode(chunk, { stream: true }))) state.handle(event);
        if (state.error) break;
      }
    } catch (error) {
      if (error instanceof ClaudeFailure) throw error;
      const reason = abortReason();
      if (reason === "network") console.error("Lorekeeper: the answer stream broke off.", errorName(error));
      throw fail(reason);
    }
    for (const event of sse.push(decoder.decode())) state.handle(event);
    for (const event of sse.flush()) state.handle(event);

    if (state.error) {
      console.error(`Lorekeeper: the answer stream reported ${state.error.type}.`);
      throw fail(state.error.type === "overloaded_error" ? "HTTP 529" : "stream error");
    }
    if (state.result.stopReason === "refusal") throw fail("refusal");
    if (state.result.stopReason === "max_tokens") throw fail("too long");
    if (!state.stopped) {
      if (controller.signal.aborted) throw fail(abortReason());
      console.error("Lorekeeper: the answer stream ended early.");
      throw fail("no answer");
    }
    return state.result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function* readerChunks(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Only the error's name: messages of fetch errors can echo request details. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// ---------------------------------------------------------------- the e2e fake model

/** Delay between canned stream events, so the e2e answer visibly streams and can be stopped. */
const FAKE_EVENT_MS = 60;

type FakeDocument = { title: string; text: string };

/** The documents (title and text) and the question of the request's last user turn. */
function fakeInputs(request: MessagesBody): { documents: FakeDocument[]; question: string; web: boolean } {
  const messages = Array.isArray(request.messages) ? (request.messages as unknown[]) : [];
  const last = [...messages].reverse().find((m) => isObject(m) && m.role === "user");
  const content = isObject(last) ? last.content : undefined;
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as unknown[]) : [];
  const documents: FakeDocument[] = [];
  let text = "";
  for (const block of blocks) {
    if (!isObject(block)) continue;
    if (block.type === "text" && typeof block.text === "string") text += `${block.text}\n`;
    if (block.type === "document" && isObject(block.source)) {
      const source = block.source;
      const parts = Array.isArray(source.content) ? (source.content as unknown[]) : [];
      const body = typeof source.data === "string" ? source.data : parts.map((p) => (isObject(p) && typeof p.text === "string" ? p.text : "")).join(" ");
      documents.push({ title: typeof block.title === "string" ? block.title : "Document", text: body });
    }
  }
  const tagged = /<question>([\s\S]*?)<\/question>/.exec(text);
  const tools = Array.isArray(request.tools) ? (request.tools as unknown[]) : [];
  const web = tools.some((tool) => isObject(tool) && typeof tool.type === "string" && tool.type.startsWith("web_search"));
  return { documents, question: (tagged?.[1] ?? text).trim(), web };
}

/** The canned reply for a request, as stream events (the board's four samples, in invented words). */
export function fakeEvents(request: MessagesBody): Json[] {
  const { documents, question, web } = fakeInputs(request);
  const model = String(request.model ?? SONNET);
  const events: Json[] = [
    { type: "message_start", message: { id: "msg_fake", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  let index = 0;
  const textBlock = (pieces: string[], citation?: Citation) => {
    events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    for (const piece of pieces) events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
    if (citation) events.push({ type: "content_block_delta", index, delta: { type: "citations_delta", citation } });
    events.push({ type: "content_block_stop", index });
    index++;
  };
  const words = (text: string) => text.match(/^\s+|\S+\s*/g) ?? [text];
  let searches = 0;

  if (web) {
    searches = 1;
    events.push({ type: "content_block_start", index, content_block: { type: "server_tool_use", id: "srvtoolu_fake", name: "web_search", input: {} } });
    events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: question.slice(0, 80) }) } });
    events.push({ type: "content_block_stop", index });
    index++;
    events.push({
      type: "content_block_start",
      index,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_fake",
        content: [
          { type: "web_search_result", title: "Table talk: how we run it", url: "https://example.com/forum/thread-1", encrypted_content: "", page_age: null },
          { type: "web_search_result", title: "A GM's blog on rulings", url: "https://example.org/blog/rulings", encrypted_content: "", page_age: null },
        ],
      },
    });
    events.push({ type: "content_block_stop", index });
    index++;
    textBlock(words("Online, players describe running it as a quick call by the GM, usually in the players' favour."), {
      type: "web_search_result_location",
      cited_text: "Most tables we asked let the GM make a quick call and move on.",
      url: "https://example.com/forum/thread-1",
      title: "Table talk: how we run it",
    });
  } else if (documents.length === 0) {
    textBlock(words("VERDICT: none\nI couldn't find this in your books."));
  } else {
    const document = documents[0]!;
    const citation: Citation = { type: "content_block_location", cited_text: document.text.slice(0, 200), document_index: 0, document_title: document.title, start_block_index: 0, end_block_index: 1 };
    if (/\bhex/i.test(question)) {
      textBlock(words("VERDICT: unclear\nThe books describe one Hex at a time but don't say what happens when two land on the same target."), citation);
      textBlock(words("\nGM CALL: Apply only the strongest Hex, and say so at the table."));
    } else {
      textBlock(words("VERDICT: rules\nThe rule is stated plainly in your books: "));
      textBlock(words("roll the dice as written and apply the result."), citation);
    }
  }
  events.push({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 180, server_tool_use: { web_search_requests: searches } } });
  events.push({ type: "message_stop" });
  return events;
}

/** Plays `fakeEvents` as SSE bytes, one event per tick; the abort signal ends it like a cut connection. */
async function* fakeStream(request: MessagesBody, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const event of fakeEvents(request)) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, FAKE_EVENT_MS);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    yield encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}
