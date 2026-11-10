/**
 * useIntent: a fresh idempotency key per click by default; a form passes its own key so a second click (the
 * character wizard's double click) repeats the first request instead of making a second character.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIntent } from "@/lib/use-intent";

import { api } from "../../convex/_generated/api";

const calls = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("convex/react", () => ({
  useMutation: () => async (args: Record<string, unknown>) => {
    calls.push(args);
    return { characterId: "c1" };
  },
}));

afterEach(() => {
  calls.length = 0;
});

describe("useIntent", () => {
  it("sends a new key per call unless the caller passes one", async () => {
    const { result } = renderHook(() => useIntent(api.characters.create));
    const args = { campaignId: "camp" } as unknown as Parameters<typeof result.current.fire>[0];
    await act(async () => {
      await result.current.fire(args);
      await result.current.fire(args);
      await result.current.fire(args, { key: "wizard-1" });
      await result.current.fire(args, { key: "wizard-1" });
    });
    const keys = calls.map((c) => c.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.slice(2)).toEqual(["wizard-1", "wizard-1"]);
  });
});
