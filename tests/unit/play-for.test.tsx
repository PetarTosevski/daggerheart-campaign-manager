/**
 * DA6 (plan drawer-answers, user answers 2026-10-30): one "Play for this character" switch per PC, shared by the map Hand
 * and the sheet drawer, stored on the server (convex/playFor.ts). `usePlayFor` reads `playFor.list` (skipped for a
 * player), sends `playFor.set` as an intent with an optimistic update, and shows a refusal. The Convex client is a small
 * reactive fake here: the optimistic update writes the fake store and every reader re-renders.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlayFor } from "@/components/combat-map/play-for";

import type { Id } from "../../convex/_generated/dataModel";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
const calls: { name: string; args: unknown }[] = [];
let refuse = false;
const skipped: string[] = [];

const keyOf = (ref: unknown, args: unknown) => `${functionName(ref)}:${JSON.stringify(args)}`;
function write(key: string, value: unknown) {
  store.set(key, value);
  version++;
  for (const l of listeners) l();
}

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => version,
    );
    if (args === "skip") {
      skipped.push(functionName(ref));
      return undefined;
    }
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
        // The server refused: the optimistic value is rolled back.
        for (const [k, v] of before) write(k, v);
        throw new Error("Nope");
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

const C1 = "c1" as Id<"campaigns">;
const ASH = "ch-ash" as Id<"characters">;
const MIRA = "ch-mira" as Id<"characters">;
const LIST = `playFor:list:${JSON.stringify({ campaignId: C1 })}`;

function Switch({ label, characterId = ASH, gm = true }: { label: string; characterId?: Id<"characters">; gm?: boolean }) {
  const { on, set, error } = usePlayFor(C1, characterId, gm);
  return (
    <div>
      <label>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
        {label}
      </label>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

afterEach(() => {
  store.clear();
  calls.length = 0;
  skipped.length = 0;
  refuse = false;
});

describe("usePlayFor", () => {
  it("is off while loading and when the server lists no switch", () => {
    render(<Switch label="Hand" />);
    expect(screen.getByRole("switch", { name: "Hand" })).not.toBeChecked();
    act(() => write(LIST, []));
    expect(screen.getByRole("switch", { name: "Hand" })).not.toBeChecked();
  });

  it("is one switch: the Hand's and the drawer's read the same list, and an intent turns both", async () => {
    write(LIST, []);
    render(
      <>
        <Switch label="Hand" />
        <Switch label="Drawer" />
        <Switch label="Mira" characterId={MIRA} />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Hand" })));
    expect(calls).toEqual([{ name: "playFor:set", args: { campaignId: C1, characterId: ASH, on: true } }]);
    expect(screen.getByRole("switch", { name: "Drawer" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Mira" })).not.toBeChecked();
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Drawer" })));
    expect(calls[1]).toEqual({ name: "playFor:set", args: { campaignId: C1, characterId: ASH, on: false } });
    expect(screen.getByRole("switch", { name: "Hand" })).not.toBeChecked();
  });

  it("follows the server: a switch turned on elsewhere (another device) shows on", () => {
    write(LIST, []);
    render(<Switch label="Hand" />);
    act(() => write(LIST, [ASH]));
    expect(screen.getByRole("switch", { name: "Hand" })).toBeChecked();
  });

  it("shows a refusal and falls back to the server's value", async () => {
    write(LIST, []);
    refuse = true;
    render(<Switch label="Hand" />);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Hand" })));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Hand" })).not.toBeChecked();
  });

  it("never asks for the GM's list from a player's view", () => {
    render(<Switch label="Player" gm={false} />);
    expect(skipped).toContain("playFor:list");
    expect(screen.getByRole("switch", { name: "Player" })).not.toBeChecked();
  });
});
