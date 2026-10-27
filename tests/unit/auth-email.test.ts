import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/server", () => ({ env: {} }));

import {
  RESEND_URL,
  codeEmail,
  generateCode,
  randomSixDigitCode,
  sendCodeEmail,
} from "../../convex/lib/authEmail";

const prod = {
  CONVEX_CLOUD_URL: "https://x.convex.cloud",
  AUTH_RESEND_KEY: "re_secret_key",
  MAIL_FROM: "Duality Heart <noreply@dualityheart.com>",
};
const e2e = {
  CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
  E2E_AUTH_ENABLED: "true",
};

afterEach(() => vi.unstubAllGlobals());

describe("sendCodeEmail", () => {
  it("POSTs the code to Resend with the key and sender", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await sendCodeEmail(prod, "verify", "a@b.com", "654321");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_secret_key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.from).toBe(prod.MAIL_FROM);
    expect(body.to).toEqual(["a@b.com"]);
    expect(body.text).toContain("654321");
    expect(body.html).toContain("654321");
    expect(body.text).not.toMatch(/https?:/);
  });

  it("makes no request in e2e fake mode and stores the code through ctx", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runMutation = vi.fn().mockResolvedValue(null);
    await sendCodeEmail(e2e, "verify", "a@b.com", "246810", { runMutation });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]![1]).toEqual({ email: "a@b.com", code: "246810" });
  });

  it("never stores a code outside e2e fake mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const runMutation = vi.fn();
    await sendCodeEmail(prod, "verify", "a@b.com", "246810", { runMutation });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("throws on a missing key or sender", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      sendCodeEmail({ ...prod, AUTH_RESEND_KEY: undefined }, "verify", "a@b.com", "111111"),
    ).rejects.toThrow(/AUTH_RESEND_KEY/);
    await expect(
      sendCodeEmail({ ...prod, MAIL_FROM: " " }, "reset", "a@b.com", "111111"),
    ).rejects.toThrow(/MAIL_FROM/);
  });

  it("does not skip sending when E2E_AUTH_ENABLED is set on a cloud deployment", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      sendCodeEmail(
        { ...prod, E2E_AUTH_ENABLED: "true", AUTH_RESEND_KEY: undefined },
        "verify",
        "a@b.com",
        "111111",
      ),
    ).rejects.toThrow();
  });

  it("throws on a non-2xx answer without leaking the key or the code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const err = await sendCodeEmail(prod, "verify", "a@b.com", "654321").catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("422");
    expect((err as Error).message).not.toContain("re_secret_key");
    expect((err as Error).message).not.toContain("654321");
  });
});

describe("codes", () => {
  it("generated codes are random 6 digits, never one fixed value", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(40);
  });

  it("random tokens are 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(randomSixDigitCode()).toMatch(/^\d{6}$/);
  });

  it("has two templates with the code once and no link", () => {
    const verify = codeEmail("verify", "042042");
    const reset = codeEmail("reset", "042042");
    expect(verify.subject).not.toBe(reset.subject);
    for (const m of [verify, reset]) {
      expect(m.text.split("042042")).toHaveLength(2);
      expect(m.html.split("042042")).toHaveLength(2);
      expect(m.text + m.html).not.toMatch(/https?:|href/);
    }
  });
});
