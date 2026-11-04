// Plan config U1: Campaign settings, At the table (design reference/designs/config/Settings.dc.html, `.s-table`). The
// board's rows; switches are role=switch with aria-checked and save one field per call with an optimistic update (rule
// 12); hand sharing writes campaigns.setPlayersSeeHands and reads combatCardsReads.handSharing (the Combat Map's pair,
// Q10 b); the other rows write campaignSettings.set and read campaigns.get's settings; errors show inline and roll back;
// the adversary stats row is a disabled switch with the 'Always off' lock.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLE_SETTING_DEFAULTS } from "@/lib/config/campaign-settings";
import { errorMessage } from "@/lib/convex-errors";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";

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

const { TableSection, TABLE_TEXT } = await import("@/components/config/sections/table");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;
const SHARING = `combatCardsReads:handSharing:${JSON.stringify({ campaignId: C1 })}`;

/** The shell passes its live campaigns.get; here it reads the fake store the same way. */
function Section() {
  useVersion();
  return <TableSection campaign={store.get(GET) as CampaignSummary} />;
}

const sw = (name: string) => screen.getByRole("switch", { name });
const settings = () => (store.get(GET) as CampaignSummary).settings;

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  store.set(GET, { _id: C1, name: "The Witherwild", role: "gm", settings: { ...TABLE_SETTING_DEFAULTS } } as unknown as CampaignSummary);
  store.set(SHARING, { playersSeeHands: true, hidden: [] });
});

describe("Campaign settings: At the table", () => {
  it("shows the board's rows with their hints and the current values", () => {
    render(<Section />);
    for (const row of [TABLE_TEXT.hands, TABLE_TEXT.fear, TABLE_TEXT.outOfRange, TABLE_TEXT.spotlight, TABLE_TEXT.adversary]) {
      expect(screen.getByText(row.label)).toBeInTheDocument();
      expect(screen.getByText(row.hint)).toBeInTheDocument();
    }
    expect(screen.getByText("The bars in the session recap.")).toBeInTheDocument();
    expect(sw("Players can see each other’s hands")).toHaveAttribute("aria-checked", "true");
    expect(sw("Players see the GM’s Fear")).toHaveAttribute("aria-checked", "true");
    expect(sw("Show spotlight balance to players")).toHaveAttribute("aria-checked", "false");
    const seg = screen.getByRole("group", { name: "Out-of-range actions" });
    expect(within(seg).getByRole("button", { name: "Ask me" })).toHaveAttribute("aria-pressed", "true");
    expect(within(seg).getByRole("button", { name: "Refuse" })).toHaveAttribute("aria-pressed", "false");
  });

  it("locks the adversary stats row off with no setting", () => {
    render(<Section />);
    const locked = sw("Show adversary HP, Stress and Difficulty to players");
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Always off")).toBeInTheDocument();
    fireEvent.click(locked);
    expect(calls).toEqual([]);
  });

  it("saves hand sharing through setPlayersSeeHands, optimistically on the Combat Map's query", async () => {
    render(<Section />);
    fireEvent.click(sw("Players can see each other’s hands"));
    expect(calls).toEqual([{ name: "campaigns:setPlayersSeeHands", args: { campaignId: C1, enabled: false } }]);
    expect(store.get(SHARING)).toEqual({ playersSeeHands: false, hidden: [] });
    await waitFor(() => expect(sw("Players can see each other’s hands")).toHaveAttribute("aria-checked", "false"));
  });

  it("saves one setting per call through campaignSettings.set, optimistically on campaigns.get", async () => {
    render(<Section />);
    fireEvent.click(sw("Players see the GM’s Fear"));
    await waitFor(() => expect(sw("Players see the GM’s Fear")).toHaveAttribute("aria-checked", "false"));
    expect(settings().playersSeeFear).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refuse" })).toHaveAttribute("aria-pressed", "true"));
    // The current choice again writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));

    fireEvent.click(sw("Show spotlight balance to players"));
    await waitFor(() => expect(sw("Show spotlight balance to players")).toHaveAttribute("aria-checked", "true"));

    expect(calls).toEqual([
      { name: "campaignSettings:set", args: { campaignId: C1, change: { key: "playersSeeFear", value: false } } },
      { name: "campaignSettings:set", args: { campaignId: C1, change: { key: "outOfRange", value: "refuse" } } },
      { name: "campaignSettings:set", args: { campaignId: C1, change: { key: "spotlightToPlayers", value: true } } },
    ]);
    // Only the changed fields moved.
    expect(settings()).toEqual({ ...TABLE_SETTING_DEFAULTS, playersSeeFear: false, outOfRange: "refuse", spotlightToPlayers: true });
  });

  it("shows a refused save inline and rolls the switch back", async () => {
    refuse = new ConvexError({ code: "CAMPAIGN_ARCHIVED" });
    render(<Section />);
    fireEvent.click(sw("Players see the GM’s Fear"));
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(sw("Players see the GM’s Fear")).toHaveAttribute("aria-checked", "true");
    expect(settings().playersSeeFear).toBe(true);
  });

  it("shows a loading line for hand sharing until its query arrives", () => {
    store.delete(SHARING);
    render(<Section />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("switch", { name: "Players can see each other’s hands" })).toBeNull();
  });
});
