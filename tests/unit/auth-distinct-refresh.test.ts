import { describe, expect, it, vi } from "vitest";

import {
  type FetchAccessToken,
  refreshStep,
  SAME_TOKEN_RETRY_DELAY_MS,
  withDistinctRefresh,
} from "@/lib/auth/distinct-refresh";

// dcm-bxp.123: a forced refresh in the same second as the cached token's sign-in returns the cached token byte for
// byte; the Convex client then gives up and shows "Your session has ended". The wrapper retries once past that second;
// a signed-out or revoked user (null refresh) goes straight to the sign-in path.

describe("refreshStep", () => {
  it("uses a refreshed token that differs from the one Convex holds", () => {
    expect(refreshStep("cached", "fresh", false)).toBe("use");
  });
  it("retries once when the refresh returns the token Convex holds", () => {
    expect(refreshStep("cached", "cached", false)).toBe("retry");
  });
  it("hands an identical token over after the retry (Convex then gives up; no loop)", () => {
    expect(refreshStep("cached", "cached", true)).toBe("use");
  });
  it("treats a null refresh as signed out, never as a retry", () => {
    expect(refreshStep("cached", null, false)).toBe("signed-out");
    expect(refreshStep(null, null, false)).toBe("signed-out");
  });
  it("uses the first token when Convex holds none", () => {
    expect(refreshStep(null, "fresh", false)).toBe("use");
  });
});

/** A fake Convex Auth `fetchAccessToken`: `current` for non-forced calls, the queued results for forced ones. */
function fakeAuth(current: string | null, refreshes: (string | null)[]) {
  const calls: boolean[] = [];
  const fetch: FetchAccessToken = async ({ forceRefreshToken }) => {
    calls.push(forceRefreshToken);
    if (!forceRefreshToken) return current;
    const next = refreshes.shift();
    if (next === undefined) throw new Error("unexpected refresh");
    current = next;
    return next;
  };
  return { fetch, calls };
}

describe("withDistinctRefresh", () => {
  it("passes the cached token through without refreshing", async () => {
    const auth = fakeAuth("cached", []);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await expect(fetch({ forceRefreshToken: false })).resolves.toBe("cached");
    expect(auth.calls).toEqual([false]);
    expect(wait).not.toHaveBeenCalled();
  });

  it("returns a distinct refreshed token at once", async () => {
    const auth = fakeAuth("cached", ["fresh"]);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await fetch({ forceRefreshToken: false });
    await expect(fetch({ forceRefreshToken: true })).resolves.toBe("fresh");
    expect(auth.calls).toEqual([false, true]);
    expect(wait).not.toHaveBeenCalled();
  });

  it("refreshes again past the minting second when the refresh returns the held token", async () => {
    const auth = fakeAuth("cached", ["cached", "next-second"]);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await fetch({ forceRefreshToken: false });
    await expect(fetch({ forceRefreshToken: true })).resolves.toBe("next-second");
    expect(wait).toHaveBeenCalledExactlyOnceWith(SAME_TOKEN_RETRY_DELAY_MS);
    expect(SAME_TOKEN_RETRY_DELAY_MS).toBeGreaterThan(1_000);
    expect(auth.calls).toEqual([false, true, true]);
  });

  it("retries at most once per forced refresh", async () => {
    const auth = fakeAuth("cached", ["cached", "cached"]);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await fetch({ forceRefreshToken: false });
    await expect(fetch({ forceRefreshToken: true })).resolves.toBe("cached");
    expect(auth.calls).toEqual([false, true, true]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("returns null for a signed-out or revoked user without retrying", async () => {
    const auth = fakeAuth("cached", [null]);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await fetch({ forceRefreshToken: false });
    await expect(fetch({ forceRefreshToken: true })).resolves.toBeNull();
    expect(auth.calls).toEqual([false, true]);
    expect(wait).not.toHaveBeenCalled();
  });

  it("compares with the token it last handed out, so a later refresh to that token retries", async () => {
    const auth = fakeAuth("cached", ["fresh", "fresh", "fresher"]);
    const wait = vi.fn(async () => {});
    const fetch = withDistinctRefresh(auth.fetch, { wait });
    await fetch({ forceRefreshToken: false });
    await expect(fetch({ forceRefreshToken: true })).resolves.toBe("fresh");
    await expect(fetch({ forceRefreshToken: true })).resolves.toBe("fresher");
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
