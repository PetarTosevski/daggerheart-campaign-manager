// Plan config IMP (N3 a): the browser's old values move to the account once, on the first signed-in load, with nothing
// to click. UI state and drafts go first, then preferences (which marks the account imported); the old keys and the
// dead `dcm:combat-hud` are removed only after every call succeeded; a failure leaves them; an account that already
// imported (another device came first) gets nothing and the keys are dropped.
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEGACY_FOLDS_SENT_MAX,
  runLegacyImport,
  type LegacyImportCalls,
  type LegacyStorage,
} from "@/components/config/legacy-import";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

let auth = { isAuthenticated: true, isLoading: false };
let prefs: { legacyImported: boolean } | undefined;
const sent: { name: string; args: Record<string, unknown> }[] = [];

vi.mock("convex/react", () => ({
  useConvexAuth: () => auth,
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : prefs),
  useMutation: (ref: unknown) => async (args: Record<string, unknown>) => {
    sent.push({ name: functionName(ref), args });
    return null;
  },
}));

const { LegacyImport } = await import("@/components/config/legacy-import");

const CAMPAIGN = "jd7abc123campaign";
const CHARACTER = "k57xyz789character";
const SEEDED: Record<string, string> = {
  "dcm.dice.settings": JSON.stringify({ threeD: false, sound: true }),
  [`dh.combat.handHidden:${CAMPAIGN}:${CHARACTER}`]: "1",
  "dh.combat.names": "1",
  "dh.combat.rings": JSON.stringify(["t1"]),
  "dcm:adversary-sort": "book",
  [`dh.characterWizard.${CAMPAIGN}`]: JSON.stringify({ step: 2 }),
  "dh.customDraft": JSON.stringify({ name: "Moonfall" }),
  "dcm:combat-hud": "{}",
};

function memoryStorage(entries: Record<string, string>): LegacyStorage & { entries: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    removeItem: (k) => void map.delete(k),
  };
}

function fakeCalls(fail?: keyof LegacyImportCalls) {
  const order: string[] = [];
  const args: Partial<Record<keyof LegacyImportCalls, unknown>> = {};
  const make = (name: keyof LegacyImportCalls) =>
    vi.fn(async (a: unknown) => {
      order.push(name);
      args[name] = a;
      if (name === fail) throw new Error("offline");
      return null;
    });
  const calls = { preferences: make("preferences"), uiState: make("uiState"), drafts: make("drafts") };
  return { calls: calls as LegacyImportCalls & typeof calls, order, args };
}

describe("runLegacyImport", () => {
  it("sends every value, preferences last, then removes the keys and the dead HUD key", async () => {
    const storage = memoryStorage({ ...SEEDED, "__convexAuthJWT_x": "token", "other-app": "1" });
    const { calls, order, args } = fakeCalls();
    expect(await runLegacyImport(storage, false, calls)).toBe("imported");
    expect(order.at(-1)).toBe("preferences");
    expect(new Set(order)).toEqual(new Set(["uiState", "drafts", "preferences"]));
    expect(args.preferences).toEqual({ dice3d: false, diceSound: true, folds: [{ campaignId: CAMPAIGN, characterId: CHARACTER }] });
    expect(args.uiState).toEqual({ uiState: { tokenNames: true, rangeRings: ["t1"], adversarySort: "book" } });
    expect(args.drafts).toEqual({
      drafts: [
        { kind: "characterWizard", campaignId: CAMPAIGN, data: JSON.stringify({ step: 2 }) },
        { kind: "customFrame", data: JSON.stringify({ name: "Moonfall" }) },
      ],
    });
    // Only keys the app never wrote stay (Convex Auth's own, other apps').
    expect([...storage.entries.keys()].sort()).toEqual(["__convexAuthJWT_x", "other-app"]);
  });

  it.each(["uiState", "drafts", "preferences"] as const)("a failing %s call leaves every key for the next load", async (fail) => {
    const storage = memoryStorage(SEEDED);
    const { calls } = fakeCalls(fail);
    await expect(runLegacyImport(storage, false, calls)).rejects.toThrow("offline");
    expect([...storage.entries.keys()].sort()).toEqual(Object.keys(SEEDED).sort());
  });

  it("a failing UI state or draft call never marks the account imported", async () => {
    const { calls } = fakeCalls("drafts");
    await expect(runLegacyImport(memoryStorage(SEEDED), false, calls)).rejects.toThrow();
    expect(calls.preferences).not.toHaveBeenCalled();
  });

  it("first device wins: an account that already imported sends nothing and drops the keys", async () => {
    const storage = memoryStorage(SEEDED);
    const { calls, order } = fakeCalls();
    expect(await runLegacyImport(storage, true, calls)).toBe("dropped");
    expect(order).toEqual([]);
    expect(storage.entries.size).toBe(0);
  });

  it("only the dead HUD key: removed, nothing sent; nothing found or no storage: nothing at all", async () => {
    const dead = memoryStorage({ "dcm:combat-hud": "{}" });
    const { calls, order } = fakeCalls();
    expect(await runLegacyImport(dead, false, calls)).toBe("dropped");
    expect(dead.entries.size).toBe(0);
    expect(await runLegacyImport(memoryStorage({ "other-app": "1" }), false, calls)).toBe("none");
    expect(await runLegacyImport(undefined, false, calls)).toBe("none");
    expect(order).toEqual([]);
  });

  it("skips empty UI state and drafts calls, and sends at most the server's fold cap", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < LEGACY_FOLDS_SENT_MAX + 5; i++) entries[`dh.combat.handHidden:${CAMPAIGN}:char${i}`] = "1";
    const storage = memoryStorage(entries);
    const { calls, order, args } = fakeCalls();
    await runLegacyImport(storage, false, calls);
    expect(order).toEqual(["preferences"]);
    expect((args.preferences as { folds: unknown[] }).folds).toHaveLength(LEGACY_FOLDS_SENT_MAX);
    expect(storage.entries.size).toBe(0);
  });

  it("blocked storage removal never throws", async () => {
    const storage = memoryStorage(SEEDED);
    storage.removeItem = () => {
      throw new Error("blocked");
    };
    const { calls } = fakeCalls();
    await expect(runLegacyImport(storage, false, calls)).resolves.toBe("imported");
  });
});

describe("<LegacyImport />", () => {
  beforeEach(() => {
    localStorage.clear();
    sent.length = 0;
    auth = { isAuthenticated: true, isLoading: false };
    prefs = { legacyImported: false };
  });

  it("imports once on the first signed-in load (StrictMode and re-renders send nothing twice)", async () => {
    for (const [k, v] of Object.entries(SEEDED)) localStorage.setItem(k, v);
    const view = render(
      <StrictMode>
        <LegacyImport />
      </StrictMode>,
    );
    await waitFor(() => expect(localStorage.length).toBe(0));
    view.rerender(
      <StrictMode>
        <LegacyImport />
      </StrictMode>,
    );
    expect(sent.map((s) => s.name).sort()).toEqual(["drafts:importLegacy", "preferences:importLegacy", "uiState:importLegacy"]);
  });

  it("waits for the account: signed out or still loading it sends nothing and keeps the keys", async () => {
    localStorage.setItem("dh.combat.names", "1");
    auth = { isAuthenticated: false, isLoading: false };
    const view = render(<LegacyImport />);
    prefs = undefined;
    auth = { isAuthenticated: true, isLoading: false };
    view.rerender(<LegacyImport />);
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(localStorage.getItem("dh.combat.names")).toBe("1");
    prefs = { legacyImported: false };
    view.rerender(<LegacyImport />);
    await waitFor(() => expect(localStorage.getItem("dh.combat.names")).toBeNull());
    expect(sent.map((s) => s.name).sort()).toEqual(["preferences:importLegacy", "uiState:importLegacy"]);
  });

  it("an account that already imported only drops the keys", async () => {
    prefs = { legacyImported: true };
    localStorage.setItem("dcm.dice.settings", JSON.stringify({ threeD: true }));
    render(<LegacyImport />);
    await waitFor(() => expect(localStorage.length).toBe(0));
    expect(sent).toEqual([]);
  });
});
