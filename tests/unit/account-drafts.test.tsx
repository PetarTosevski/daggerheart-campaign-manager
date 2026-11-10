/**
 * Wizard and custom-frame drafts on the account (plan config U6f, Q15 b): drafts load through `drafts.get` and a zod
 * parser (another schemaVersion or shape is ignored), save from the change handler with typing debounced about 1 s
 * and clicks at once, and finishing clears them with `drafts.clear`. Nothing touches localStorage.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAccountDraft } from "@/app/(gm)/campaigns/[campaignId]/party/new/draft";
import { DRAFT_DEBOUNCE_MS, isTypedWizardPatch, parseDraft, wizardDraftSchema, wizardFromDraft } from "@/lib/party/wizard-draft";
import { emptyWizard } from "@/lib/party/wizard-logic";
import { useCustomDraft } from "@/app/(gm)/new/custom-frame-form";

import type { Id } from "../../convex/_generated/dataModel";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const state = vi.hoisted(() => ({
  stored: undefined as unknown,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  queryArgs: [] as unknown[],
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    state.queryArgs.push({ name: functionName(ref), args });
    return state.stored;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    return async (args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return null;
    };
  },
}));

const CAMPAIGN = "c1" as Id<"campaigns">;
const stored = (data: unknown, schemaVersion = 1) => ({ schemaVersion, data: JSON.stringify(data), updatedAt: 1 });

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  state.stored = undefined;
  state.calls.length = 0;
  state.queryArgs.length = 0;
  window.localStorage.clear();
});

describe("parseDraft", () => {
  it("returns the stored object when the version and shape fit", () => {
    const wizard = { ...emptyWizard(), step: 3, classId: "bard" };
    expect(parseDraft(stored(wizard), wizardDraftSchema)).toMatchObject({ step: 3, classId: "bard" });
  });

  it("ignores no draft, another schemaVersion, broken JSON and a wrong shape", () => {
    expect(parseDraft(null, wizardDraftSchema)).toBeNull();
    expect(parseDraft(undefined, wizardDraftSchema)).toBeNull();
    expect(parseDraft(stored(emptyWizard(), 2), wizardDraftSchema)).toBeNull();
    expect(parseDraft({ schemaVersion: 1, data: "{not json", updatedAt: 1 }, wizardDraftSchema)).toBeNull();
    expect(parseDraft(stored({ ...emptyWizard(), step: "three" }), wizardDraftSchema)).toBeNull();
    expect(parseDraft(stored([1, 2]), wizardDraftSchema)).toBeNull();
  });

  it("wizardFromDraft starts empty from a rejected draft and resumes a good one", () => {
    expect(wizardFromDraft(stored({ classId: 7 }))).toEqual(emptyWizard());
    const resumed = wizardFromDraft(stored({ ...emptyWizard(), step: 4, classId: "bard", name: "Ash" }));
    expect(resumed).toMatchObject({ step: 4, classId: "bard", name: "Ash" });
  });
});

describe("isTypedWizardPatch", () => {
  it("is true only for patches of typed fields", () => {
    expect(isTypedWizardPatch({ name: "A" })).toBe(true);
    expect(isTypedWizardPatch({ experiences: ["a", "b"] })).toBe(true);
    expect(isTypedWizardPatch({ classId: "bard", subclassId: null })).toBe(false);
    expect(isTypedWizardPatch({ step: 2 })).toBe(false);
    expect(isTypedWizardPatch({})).toBe(false);
  });
});

describe("useAccountDraft", () => {
  const saves = () => state.calls.filter((c) => c.name.includes("save"));

  it("reads the campaign's wizard draft", () => {
    renderHook(() => useAccountDraft({ kind: "characterWizard", campaignId: CAMPAIGN }));
    expect(state.queryArgs).toContainEqual({ name: "drafts:get", args: { kind: "characterWizard", campaignId: CAMPAIGN } });
  });

  it("debounces typed saves to one about a second after the last change", () => {
    const { result } = renderHook(() => useAccountDraft({ kind: "characterWizard", campaignId: CAMPAIGN }));
    act(() => result.current.save({ name: "A" }, { typed: true }));
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 100));
    act(() => result.current.save({ name: "Ab" }, { typed: true }));
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 100));
    expect(saves()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(100));
    expect(saves()).toEqual([
      {
        name: "drafts:save",
        args: { kind: "characterWizard", campaignId: CAMPAIGN, schemaVersion: 1, data: JSON.stringify({ name: "Ab" }) },
      },
    ]);
  });

  it("saves a click at once, and flush sends a waiting typed save", () => {
    const { result } = renderHook(() => useAccountDraft({ kind: "customFrame" }));
    act(() => result.current.save({ tones: [] }));
    expect(saves()).toHaveLength(1);
    act(() => result.current.save({ name: "x" }, { typed: true }));
    act(() => result.current.flush());
    expect(saves()).toHaveLength(2);
    expect(saves()[1].args).toEqual({ kind: "customFrame", schemaVersion: 1, data: JSON.stringify({ name: "x" }) });
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2));
    expect(saves()).toHaveLength(2);
  });

  it("clear drops a waiting save and deletes the draft", () => {
    const { result } = renderHook(() => useAccountDraft({ kind: "characterWizard", campaignId: CAMPAIGN }));
    act(() => result.current.save({ name: "A" }, { typed: true }));
    act(() => result.current.clear());
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2));
    expect(saves()).toHaveLength(0);
    expect(state.calls).toEqual([{ name: "drafts:clear", args: { kind: "characterWizard", campaignId: CAMPAIGN } }]);
  });

  it("never sends a draft over the size limit", () => {
    const { result } = renderHook(() => useAccountDraft({ kind: "customFrame" }));
    act(() => result.current.save({ name: "x".repeat(70 * 1024) }));
    expect(saves()).toHaveLength(0);
  });
});

describe("useCustomDraft", () => {
  const custom = {
    name: "Ashfall",
    pitch: "",
    tones: ["Heroic"],
    themes: "",
    touchstones: "",
    partySize: 5,
    startingTier: 2,
    background: "custom",
  };

  it("shows the stored draft, or the empty one when the stored draft is rejected", () => {
    state.stored = stored(custom);
    const { result, rerender } = renderHook(() => useCustomDraft());
    expect(result.current[0]).toMatchObject({ name: "Ashfall", partySize: 5, startingTier: 2 });
    state.stored = stored({ ...custom, partySize: 99 });
    rerender();
    expect(result.current[0]).toMatchObject({ name: "", partySize: 4 });
  });

  it("debounces typing, saves a choice at once and clears on create", () => {
    state.stored = null;
    const { result } = renderHook(() => useCustomDraft());
    act(() => result.current[1]({ ...result.current[0], name: "Ash" }));
    expect(result.current[0].name).toBe("Ash");
    expect(state.calls).toHaveLength(0);
    act(() => vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS));
    expect(state.calls).toHaveLength(1);
    act(() => result.current[1]({ ...result.current[0], partySize: 6 }));
    expect(state.calls).toHaveLength(2);
    expect(JSON.parse(String(state.calls[1].args.data))).toMatchObject({ name: "Ash", partySize: 6 });
    act(() => result.current[2]());
    expect(state.calls[2]).toEqual({ name: "drafts:clear", args: { kind: "customFrame" } });
    expect(window.localStorage.length).toBe(0);
  });
});
