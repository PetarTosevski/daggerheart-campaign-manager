import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaudeFailure, messagesCreate } from "../../convex/lib/claude";

// PS2 (dcm-ccnm): messagesCreate's HTTP failures carry the safe facts of the error body (`detail`), so photo import can
// tell "credits used up" (a 400 about the credit balance) from a 400 our own request caused. The streaming client's
// tests live in tests/convex/claude-client.test.ts.

const KEY = "sk-ant-test-0123456789-secret";
const CREDIT_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." },
});
const SCHEMA_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "Schemas contains too many parameters with union types (29 parameters with type arrays or anyOf)" },
});

let savedKey: string | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = KEY;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

async function failure(status: number, body: string): Promise<ClaudeFailure> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  try {
    await messagesCreate({ max_tokens: 10, messages: [] }, { label: "Test" });
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeFailure);
    return error as ClaudeFailure;
  }
  throw new Error("expected a ClaudeFailure");
}

describe("messagesCreate HTTP failures", () => {
  it("marks a 400 about the credit balance as billing, keeping only derived values", async () => {
    const error = await failure(400, CREDIT_BODY);
    expect(error.reason).toBe("HTTP 400");
    expect(error.detail).toEqual({ errorType: "invalid_request_error", billing: true });
    // Never the body's text, in the error or its fields; the log still shows the reply.
    expect(JSON.stringify(error)).not.toContain("credit balance");
    expect(error.message).not.toContain("credit balance");
    expect(errorSpy).toHaveBeenCalledWith("Test: the Messages API answered 400.", expect.stringContaining("credit balance"));
  });

  it("marks a plain 400 (our own request) as not billing", async () => {
    const error = await failure(400, SCHEMA_BODY);
    expect(error.reason).toBe("HTTP 400");
    expect(error.detail).toEqual({ errorType: "invalid_request_error", billing: false });
  });

  it("reads a body that isn't JSON without keeping it", async () => {
    expect((await failure(529, "Overloaded")).detail).toEqual({ billing: false });
    expect((await failure(402, "billing problem")).detail).toEqual({ billing: true });
  });
});
