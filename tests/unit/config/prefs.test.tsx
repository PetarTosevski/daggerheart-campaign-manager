// Plan config U6a: the Preferences popover's rows (design reference/designs/config/Settings.dc.html, `.pm-pop .row`).
// 3D dice, Dice sound, Volume (0-100, saved on release), Reduce motion, Text size Small / Medium / Large and the
// spotlight ping, read from preferences.get and saved one field per call through preferences.set with an optimistic
// update (rule 12); a refused save shows inline and rolls back; the dice box's toggles read the same query.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PREFERENCE_DEFAULTS } from "@/lib/config/preferences";
import { errorMessage } from "@/lib/convex-errors";

import type { Id } from "../../../convex/_generated/dataModel";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
const calls: { name: string; args: Record<string, unknown> }[] = [];
let refuse: Error | null = null;

const keyOf = (ref: unknown, args: unknown) => `${functionName(ref)}:${JSON.stringify(args)}`;
function write(key: string, value: unknown) {
  store.set(key, value);
  version++;
  for (const l of listeners) l();
}
function useVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    useVersion();
    return store.get(keyOf(ref, args));
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    let update: ((s: unknown, args: Record<string, unknown>) => void) | null = null;
    const fake = { getQuery: (q: unknown, a: unknown) => store.get(keyOf(q, a)), setQuery: (q: unknown, a: unknown, value: unknown) => write(keyOf(q, a), value) };
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      const before = new Map(store);
      update?.(fake, args);
      if (refuse) {
        for (const [k, v] of before) write(k, v);
        throw refuse;
      }
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (s: unknown, args: Record<string, unknown>) => void) => {
        update = fn;
        return run;
      },
    });
  },
}));

const { PreferenceRows, PREFS_TEXT } = await import("@/components/config/prefs");
const { BoardDiceToggles } = await import("@/components/party/dice/parts");

const C1 = "c1" as Id<"campaigns">;
const GET = `preferences:get:${JSON.stringify({})}`;
const sw = (name: string) => screen.getByRole("switch", { name });
const prefs = () => store.get(GET) as Record<string, unknown>;
const slider = () => screen.getByRole("slider", { name: "Dice volume" });

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  store.set(GET, { ...PREFERENCE_DEFAULTS, legacyImported: false });
});

describe("Preferences rows", () => {
  it("shows the board's rows with their hints and the account's values", () => {
    render(<PreferenceRows campaignId={C1} isGm={false} />);
    expect(screen.getByText(PREFS_TEXT.dice3d.label)).toBeInTheDocument();
    expect(screen.getByText("Rolls tumble across the screen.")).toBeInTheDocument();
    expect(screen.getByText("Calmer sheet and card animations.")).toBeInTheDocument();
    expect(sw("3D dice")).toHaveAttribute("aria-checked", "true");
    expect(sw("Dice sound")).toHaveAttribute("aria-checked", "false");
    expect(sw("Reduce motion")).toHaveAttribute("aria-checked", "false");
    expect(sw("Ping me when I get the spotlight")).toHaveAttribute("aria-checked", "true");
    expect(slider()).toHaveValue("60");
    expect(slider()).toHaveAttribute("min", "0");
    expect(slider()).toHaveAttribute("max", "100");
    const seg = screen.getByRole("group", { name: "Text size" });
    expect(within(seg).getAllByRole("button").map((b) => b.textContent)).toEqual(["Small", "Medium", "Large"]);
    expect(within(seg).getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves one field per call, optimistically on preferences.get", async () => {
    render(<PreferenceRows campaignId={C1} isGm />);
    fireEvent.click(sw("Dice sound"));
    await waitFor(() => expect(sw("Dice sound")).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(sw("3D dice"));
    fireEvent.click(sw("Reduce motion"));
    fireEvent.click(sw("Ping me when I get the spotlight"));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true"));
    // The current text size again writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(calls).toEqual([
      { name: "preferences:set", args: { change: { key: "diceSound", value: true } } },
      { name: "preferences:set", args: { change: { key: "dice3d", value: false } } },
      { name: "preferences:set", args: { change: { key: "reduceMotion", value: true } } },
      { name: "preferences:set", args: { change: { key: "spotlightPing", value: false } } },
      { name: "preferences:set", args: { change: { key: "textSize", value: "large" } } },
    ]);
    expect(prefs()).toEqual({
      ...PREFERENCE_DEFAULTS,
      legacyImported: false,
      diceSound: true,
      dice3d: false,
      reduceMotion: true,
      spotlightPing: false,
      textSize: "large",
    });
  });

  it("saves the volume on release, not on every move", async () => {
    render(<PreferenceRows campaignId={C1} isGm={false} />);
    fireEvent.change(slider(), { target: { value: "40" } });
    fireEvent.change(slider(), { target: { value: "25" } });
    expect(slider()).toHaveValue("25");
    expect(calls).toEqual([]);
    fireEvent.pointerUp(slider());
    expect(calls).toEqual([{ name: "preferences:set", args: { change: { key: "diceVolume", value: 25 } } }]);
    await waitFor(() => expect(prefs().diceVolume).toBe(25));
    // A key or blur with nothing dragged writes nothing; arrow keys save on key up.
    fireEvent.keyUp(slider(), { key: "Tab" });
    fireEvent.blur(slider());
    expect(calls).toHaveLength(1);
    fireEvent.change(slider(), { target: { value: "26" } });
    fireEvent.keyUp(slider(), { key: "ArrowRight" });
    expect(calls[1]).toEqual({ name: "preferences:set", args: { change: { key: "diceVolume", value: 26 } } });
  });

  it("shows a refused save inline and rolls the switch back", async () => {
    refuse = new ConvexError({ code: "UNAUTHENTICATED" });
    render(<PreferenceRows campaignId={C1} isGm={false} />);
    fireEvent.click(sw("Dice sound"));
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(sw("Dice sound")).toHaveAttribute("aria-checked", "false");
    expect(prefs().diceSound).toBe(false);
  });

  it("shows a loading line until the preferences arrive", () => {
    store.delete(GET);
    render(<PreferenceRows campaignId={C1} isGm={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("keeps the dice box's toggles in step with the rows (one query)", async () => {
    render(
      <>
        <PreferenceRows campaignId={C1} isGm={false} />
        <BoardDiceToggles />
      </>,
    );
    const boardSound = screen.getByRole("checkbox", { name: "Dice sound" });
    expect(boardSound).not.toBeChecked();
    fireEvent.click(sw("Dice sound"));
    await waitFor(() => expect(boardSound).toBeChecked());
    fireEvent.click(screen.getByRole("checkbox", { name: "3D dice" }));
    await waitFor(() => expect(sw("3D dice")).toHaveAttribute("aria-checked", "false"));
    expect(calls.at(-1)).toEqual({ name: "preferences:set", args: { change: { key: "dice3d", value: false } } });
  });
});
