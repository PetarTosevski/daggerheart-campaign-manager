import { describe, expect, it } from "vitest";

import { modelForPass, nextStep } from "../../../src/lib/lorekeeper/flow";
import {
  CACHE_WRITE_5M_MULTIPLIER,
  MODEL_PRICES,
  PRIMARY_MODEL,
  RETRY_MODEL,
  WEB_SEARCH_MICROS,
  ZERO_USAGE,
  addUsage,
  costMicros,
  formatUsd,
  priceFor,
  reserveMicros,
  usageFromApi,
  usdToMicros,
} from "../../../src/lib/lorekeeper/pricing";

describe("price table", () => {
  it("holds the plan's prices per million tokens", () => {
    expect(MODEL_PRICES["claude-opus-5-5"]).toMatchObject({ input: 4, output: 20, cacheRead: 0.2 });
    expect(MODEL_PRICES["claude-sonnet-5-5"]).toMatchObject({ input: 2, output: 10, cacheRead: 0.2 });
    expect(MODEL_PRICES["claude-haiku-5-5"]).toMatchObject({ input: 0.1, output: 0.5, cacheRead: 0.2 });
    expect(CACHE_WRITE_5M_MULTIPLIER).toBe(1.25);
    expect(WEB_SEARCH_MICROS).toBe(10_000);
    expect(PRIMARY_MODEL).toBe("claude-sonnet-5-5");
    expect(RETRY_MODEL).toBe("claude-opus-5-5");
  });
});

describe("costMicros", () => {
  it("prices one token of each kind in micro-dollars", () => {
    const one = (k: keyof typeof ZERO_USAGE) => costMicros({ ...ZERO_USAGE, [k]: 1_000_000 }, "claude-sonnet-5-5");
    expect(one("input")).toBe(2_000_000);
    expect(one("output")).toBe(10_000_000);
    expect(one("cacheRead")).toBe(200_000);
    expect(one("cacheWrite")).toBe(2_500_000);
    expect(one("webSearches")).toBe(10_000 * 1_000_000);
  });

  it("matches the analysis example for a typical Sonnet question (~$0.04)", () => {
    const usage = { input: 9500, cacheRead: 1500, cacheWrite: 0, output: 2000, webSearches: 0 };
    expect(costMicros(usage, "claude-sonnet-5-5")).toBe(19_000 + 300 + 20_000);
    expect(costMicros(usage, "claude-opus-5-5")).toBe(38_000 + 300 + 40_000);
  });

  it("adds web searches at $10 per 1,000", () => {
    expect(costMicros({ ...ZERO_USAGE, webSearches: 3 }, "claude-sonnet-5-5")).toBe(30_000);
  });

  it("rounds fractional micros up, without float noise", () => {
    expect(costMicros({ ...ZERO_USAGE, input: 3 }, "claude-haiku-5-5")).toBe(1);
    expect(costMicros({ ...ZERO_USAGE, input: 10 }, "claude-haiku-5-5")).toBe(1);
    expect(costMicros({ ...ZERO_USAGE, input: 11 }, "claude-haiku-5-5")).toBe(2);
    expect(costMicros(ZERO_USAGE, "claude-haiku-5-5")).toBe(0);
  });

  it("prices dated variants as their base model and unknown models as the priciest", () => {
    expect(priceFor("claude-sonnet-5-5-20261001").model).toBe("claude-sonnet-5-5");
    expect(priceFor("claude-sonnet-5").model).toBeNull();
    expect(priceFor("mystery-model")).toEqual({ model: null, price: MODEL_PRICES["claude-opus-5-5"] });
    expect(costMicros({ ...ZERO_USAGE, output: 1000 }, "mystery-model")).toBe(20_000);
  });
});

describe("reserveMicros", () => {
  it("is the worst case: 20k input at the cache-write price plus max_tokens output", () => {
    expect(reserveMicros("claude-sonnet-5-5")).toBe(20_000 * 2.5 + 2000 * 10);
    expect(reserveMicros("claude-opus-5-5", 2000)).toBe(20_000 * 5 + 2000 * 20);
    expect(reserveMicros("claude-sonnet-5-5", 1000, { inputTokens: 1000, webSearches: 3 })).toBe(2500 + 10_000 + 30_000);
  });

  it("is never below the cost of a request within those limits", () => {
    const real = { input: 15_000, cacheRead: 2_000, cacheWrite: 3_000, output: 2000, webSearches: 0 };
    for (const m of Object.keys(MODEL_PRICES)) expect(reserveMicros(m)).toBeGreaterThanOrEqual(costMicros(real, m));
  });
});

describe("usage helpers", () => {
  it("converts the API usage object, treating missing and bad values as 0", () => {
    expect(
      usageFromApi({
        input_tokens: 120,
        output_tokens: 45,
        cache_read_input_tokens: 1500,
        cache_creation_input_tokens: null,
        server_tool_use: { web_search_requests: 2 },
      }),
    ).toEqual({ input: 120, output: 45, cacheRead: 1500, cacheWrite: 0, webSearches: 2 });
    expect(usageFromApi(undefined)).toEqual(ZERO_USAGE);
    expect(usageFromApi({ input_tokens: -5, output_tokens: Number.NaN })).toEqual(ZERO_USAGE);
  });

  it("adds usages of several passes", () => {
    const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, webSearches: 0 };
    expect(addUsage(a, a, { ...ZERO_USAGE, webSearches: 1 })).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8, webSearches: 1 });
    expect(addUsage()).toEqual(ZERO_USAGE);
  });

  it("formats and converts dollars", () => {
    expect(formatUsd(39_300)).toBe("$0.04");
    expect(formatUsd(12_500_000)).toBe("$12.50");
    expect(formatUsd(1_200)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
    expect(usdToMicros(50)).toBe(50_000_000);
  });
});

describe("flow (Q2)", () => {
  it("retries with Opus after a primary 'unclear' or 'none', never after 'rules'", () => {
    expect(nextStep({ pass: "primary", verdict: "rules", webSearch: true })).toBe("done");
    expect(nextStep({ pass: "primary", verdict: "unclear", webSearch: false })).toBe("retry");
    expect(nextStep({ pass: "primary", verdict: "none", webSearch: true })).toBe("retry");
  });

  it("runs the internet pass only after the retry also finds nothing and the toggle is on", () => {
    expect(nextStep({ pass: "retry", verdict: "rules", webSearch: true })).toBe("done");
    expect(nextStep({ pass: "retry", verdict: "unclear", webSearch: true })).toBe("done");
    expect(nextStep({ pass: "retry", verdict: "none", webSearch: true })).toBe("web");
    expect(nextStep({ pass: "retry", verdict: "none", webSearch: false })).toBe("booksOnlyMiss");
    expect(nextStep({ pass: "web", verdict: "none", webSearch: true })).toBe("done");
  });

  it("picks the model per pass", () => {
    expect(modelForPass("primary")).toBe("claude-sonnet-5-5");
    expect(modelForPass("retry")).toBe("claude-opus-5-5");
    expect(modelForPass("web")).toBe("claude-sonnet-5-5");
    expect(modelForPass("primary", " claude-haiku-5-5 ")).toBe("claude-haiku-5-5");
    expect(modelForPass("primary", "")).toBe("claude-sonnet-5-5");
    expect(modelForPass("retry", "claude-haiku-5-5")).toBe("claude-opus-5-5");
  });
});
