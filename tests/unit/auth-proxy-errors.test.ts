import { describe, expect, it } from "vitest";

import { messageWithCode, withAuthErrorCode } from "@/lib/auth-errors";

const URL_BASE = "https://happy-animal-123.convex.cloud";
const REDACTED = "[Request ID: abc123] Server Error";

function convexError(extra: Record<string, unknown>) {
  return { status: "error", errorMessage: REDACTED, logLines: [], ...extra };
}

function fakeFetch(body: unknown) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "999" },
    })) as typeof fetch;
}

async function messageOf(response: Response) {
  return ((await response.json()) as { errorMessage: string }).errorMessage;
}

describe("messageWithCode", () => {
  it("names the code from errorData", () => {
    expect(messageWithCode(convexError({ errorData: { code: "EMAIL_TAKEN", message: "x" } }))).toBe(
      'ConvexError: {"code":"EMAIL_TAKEN"}',
    );
  });
  it("ignores bodies without a plain upper-case code", () => {
    expect(messageWithCode(convexError({}))).toBeNull();
    expect(messageWithCode(convexError({ errorData: "text" }))).toBeNull();
    expect(messageWithCode(convexError({ errorData: { code: 'bad code"' } }))).toBeNull();
    expect(messageWithCode({ status: "success", value: 1 })).toBeNull();
    expect(messageWithCode(null)).toBeNull();
  });
});

describe("withAuthErrorCode", () => {
  it("puts the code into a redacted errorMessage and leaks nothing else", async () => {
    const wrapped = withAuthErrorCode(
      fakeFetch(convexError({ errorData: { code: "RATE_LIMITED", secret: "s3cret" } })),
      URL_BASE,
    );
    const message = await messageOf(await wrapped(`${URL_BASE}/api/action`, { method: "POST" }));
    expect(message).toBe('ConvexError: {"code":"RATE_LIMITED"}');
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("Request ID");
  });
  it("leaves other URLs and codeless errors alone", async () => {
    const body = convexError({ errorData: { code: "CODE_INVALID" } });
    const other = await withAuthErrorCode(fakeFetch(body), URL_BASE)("https://example.com/api/action");
    expect(await messageOf(other)).toBe(REDACTED);
    const plain = await withAuthErrorCode(fakeFetch(convexError({})), URL_BASE)(`${URL_BASE}/api/action`);
    expect(await messageOf(plain)).toBe(REDACTED);
  });
  it("is a no-op without a Convex URL", () => {
    const inner = fakeFetch({});
    expect(withAuthErrorCode(inner, undefined)).toBe(inner);
  });
});
