// Model prices and cost estimates (D13 L1; analysis 7 and 8; Q2, Q9). Pure module: L5's caps reserve
// reserveMicros before a question and settle with costMicros afterwards; L3 / L8 store costMicros per answer.
//
// All money is integer micro-dollars (1 USD = 1,000,000 micros). A price "per million tokens" in USD is exactly the
// price of one token in micros, so cost = tokens × price, rounded up once at the end.
//
// ```ts
// costMicros({ input: 9500, cacheRead: 1500, cacheWrite: 0, output: 2000, webSearches: 0 }, "claude-sonnet-5-5"); // 39_300
// reserveMicros("claude-sonnet-5-5", 2000); // 70_000 ($0.07: 20k input at the cache-write price + 2k output)
// formatUsd(39_300);                         // "$0.04"
// ```

/** Price list date (Claude API price list as quoted in the analysis). Update together with MODEL_PRICES. */
export const PRICES_AS_OF = "2026-10-06";

/** The model that answers first (Q2). */
export const PRIMARY_MODEL = "claude-sonnet-5-5";
/** The model of the automatic retry after 'unclear' / 'none' (Q2). */
export const RETRY_MODEL = "claude-opus-5-5";

export type ModelPrice = {
  /** Display name. */
  label: string;
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens (thinking included). */
  output: number;
  /** USD per million cache-read input tokens. */
  cacheRead: number;
};

/**
 * The one price table. Edit here when prices change (and PRICES_AS_OF). Haiku's cache-read price was not looked up;
 * the plan's flat $0.20 is used, which can only over-estimate.
 */
export const MODEL_PRICES = {
  "claude-opus-5-5": { label: "Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.2 },
} as const satisfies Record<string, ModelPrice>;

export type KnownModel = keyof typeof MODEL_PRICES;

/** A 5-minute cache write costs this multiple of the input price. */
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
/** Web search server tool: USD per 1,000 searches. */
export const WEB_SEARCH_USD_PER_1000 = 10;
/** Micro-dollars per web search ($10 / 1,000 = $0.01). */
export const WEB_SEARCH_MICROS = (WEB_SEARCH_USD_PER_1000 / 1000) * 1_000_000;

/** Default answer length cap (analysis 5.1). */
export const DEFAULT_MAX_TOKENS = 2000;
/** Worst-case input tokens of one question: system + ~8k excerpts + history + context, with headroom. */
export const RESERVE_INPUT_TOKENS = 20_000;

/** Token usage of one or more requests, normalised. */
export type TokenUsage = {
  /** Uncached input tokens. */
  input: number;
  /** Output tokens (thinking included). */
  output: number;
  /** Input tokens read from the cache. */
  cacheRead: number;
  /** Input tokens written to the 5-minute cache. */
  cacheWrite: number;
  /** Web search requests made by the server tool. */
  webSearches: number;
};

/** The Messages API `usage` object (message_start / message_delta / final message), fields as the API names them. */
export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export const ZERO_USAGE: TokenUsage = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 });

/** Convert the API's usage object. Missing or negative fields count as 0. */
export function usageFromApi(raw: ApiUsage | null | undefined): TokenUsage {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    input: n(raw?.input_tokens),
    output: n(raw?.output_tokens),
    cacheRead: n(raw?.cache_read_input_tokens),
    cacheWrite: n(raw?.cache_creation_input_tokens),
    webSearches: n(raw?.server_tool_use?.web_search_requests),
  };
}

/** Sum usages (e.g. the Sonnet pass, the Opus retry and the web pass of one answer). */
export function addUsage(...usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (a, b) => ({
      input: a.input + b.input,
      output: a.output + b.output,
      cacheRead: a.cacheRead + b.cacheRead,
      cacheWrite: a.cacheWrite + b.cacheWrite,
      webSearches: a.webSearches + b.webSearches,
    }),
    { ...ZERO_USAGE },
  );
}

/**
 * The price row for a model id. Exact ids match; a dated or suffixed variant ("claude-sonnet-5-5-20261001") matches
 * its base id; anything else (an unknown LOREKEEPER_MODEL) is priced as the most expensive row, so caps never
 * under-count.
 */
export function priceFor(model: string): { model: KnownModel | null; price: ModelPrice } {
  const ids = Object.keys(MODEL_PRICES) as KnownModel[];
  const exact = ids.find((id) => id === model) ?? ids.find((id) => model.startsWith(`${id}-`));
  if (exact) return { model: exact, price: MODEL_PRICES[exact] };
  const priciest = ids.reduce((a, b) => (MODEL_PRICES[b].output > MODEL_PRICES[a].output ? b : a));
  return { model: null, price: MODEL_PRICES[priciest] };
}

/** The cost of a usage record on a model, in whole micro-dollars (rounded up). */
export function costMicros(usage: TokenUsage, model: string): number {
  const { price } = priceFor(model);
  const micros =
    usage.input * price.input +
    usage.cacheWrite * price.input * CACHE_WRITE_5M_MULTIPLIER +
    usage.cacheRead * price.cacheRead +
    usage.output * price.output +
    usage.webSearches * WEB_SEARCH_MICROS;
  // Round away float noise (0.1 × 3 = 0.30000000000000004) before rounding up.
  return Math.ceil(Math.round(micros * 1000) / 1000);
}

/**
 * The worst-case cost of one request, reserved against the caps before it runs (L5): every input token at the
 * cache-write price, the full max_tokens of output, and any web searches allowed.
 */
export function reserveMicros(
  model: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
  opts: { inputTokens?: number; webSearches?: number } = {},
): number {
  return costMicros(
    {
      input: 0,
      cacheRead: 0,
      cacheWrite: opts.inputTokens ?? RESERVE_INPUT_TOKENS,
      output: maxTokens,
      webSearches: opts.webSearches ?? 0,
    },
    model,
  );
}

/** "$0.04", "$12.50", "<$0.01" for display. */
export function formatUsd(micros: number): string {
  if (micros > 0 && micros < 5_000) return "<$0.01";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** Dollars to micros (cap settings are entered in dollars). */
export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}
