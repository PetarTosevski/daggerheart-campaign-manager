// Plan config U5: Campaign settings, Sessions (design reference/designs/config/Settings.dc.html, `.s-session`). The
// board's rows minus the clock (Q4 d); each writes campaignSettings.set, one field per call with an optimistic update
// on campaigns.get (rule 12); a refused save rolls back and shows inline; the Archive row (S3) confirms, then archives
// (creator only, Q7 a).
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

const { SessionsSection, SESSIONS_TEXT } = await import("@/components/config/sections/sessions");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;

function Section() {
  useVersion();
  return <SessionsSection campaign={store.get(GET) as CampaignSummary} />;
}

const settings = () => (store.get(GET) as CampaignSummary).settings;
const group = (name: string) => screen.getByRole("group", { name });
const logSwitch = () => screen.getByRole("switch", { name: SESSIONS_TEXT.sessionLog.label });

function seed(isCreator = true) {
  store.set(GET, { _id: C1, name: "The Witherwild", role: "gm", isCreator, settings: { ...TABLE_SETTING_DEFAULTS } } as unknown as CampaignSummary);
}

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  seed();
});

describe("Campaign settings: Sessions", () => {
  it("shows the board's rows with their hints and the defaults, and no clock row (Q4 d)", () => {
    render(<Section />);
    expect(screen.getByText("GM Fear at the start of a session")).toBeInTheDocument();
    expect(screen.getByText("Fear carries over between sessions by default.")).toBeInTheDocument();
    expect(screen.getByText("A new session opens on")).toBeInTheDocument();
    expect(screen.getByText("Write the session log from the Combat Map")).toBeInTheDocument();
    expect(screen.getByText("Rolls, hits, Fear spent and defeats, with times.")).toBeInTheDocument();

    const fear = group("GM Fear at the start of a session");
    expect(within(fear).getByRole("button", { name: "Carry over" })).toHaveAttribute("aria-pressed", "true");
    expect(within(fear).getByRole("button", { name: "Reset to number of PCs" })).toHaveAttribute("aria-pressed", "false");
    const opens = group("A new session opens on");
    expect(within(opens).getByRole("button", { name: "Journal" })).toHaveAttribute("aria-pressed", "true");
    expect(within(opens).getByRole("button", { name: "Combat Map" })).toHaveAttribute("aria-pressed", "false");
    expect(logSwitch()).toHaveAttribute("aria-checked", "true");

    expect(screen.queryByText(/Day and night clock/)).toBeNull();
    expect(screen.queryByText(/Advance per scene/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Manual" })).toBeNull();
  });

  it("saves Fear at the start of a session, one field, optimistically", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to number of PCs" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset to number of PCs" })).toHaveAttribute("aria-pressed", "true"));
    // The current choice again writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "Reset to number of PCs" }));
    expect(calls).toEqual([{ name: "campaignSettings:set", args: { campaignId: C1, change: { key: "fearAtStart", value: "pcs" } } }]);
    expect(settings()).toEqual({ ...TABLE_SETTING_DEFAULTS, fearAtStart: "pcs" });
  });

  it("saves where a new session opens", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Combat Map" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Combat Map" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Journal" })).toHaveAttribute("aria-pressed", "false");
    expect(calls).toEqual([{ name: "campaignSettings:set", args: { campaignId: C1, change: { key: "sessionOpensOn", value: "combatMap" } } }]);
    expect(settings()).toEqual({ ...TABLE_SETTING_DEFAULTS, sessionOpensOn: "combatMap" });
  });

  it("saves the session log switch", async () => {
    render(<Section />);
    fireEvent.click(logSwitch());
    await waitFor(() => expect(logSwitch()).toHaveAttribute("aria-checked", "false"));
    expect(calls).toEqual([{ name: "campaignSettings:set", args: { campaignId: C1, change: { key: "autoSessionLog", value: false } } }]);
    expect(settings()).toEqual({ ...TABLE_SETTING_DEFAULTS, autoSessionLog: false });
  });

  it("shows a refused save inline and rolls the row back", async () => {
    refuse = new ConvexError({ code: "CAMPAIGN_ARCHIVED" });
    render(<Section />);
    fireEvent.click(logSwitch());
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(logSwitch()).toHaveAttribute("aria-checked", "true");
    expect(settings().autoSessionLog).toBe(true);
  });

  it("shows the creator the Archive row; 'Archive…' asks first, then archives (S3)", async () => {
    render(<Section />);
    const row = screen.getByTestId("settings-archive");
    expect(within(row).getByText("Archive this campaign")).toBeInTheDocument();
    expect(within(row).getByText("Keeps everything read-only. You can restore it later.")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Archive…" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(group("Archive The Witherwild?")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls).toEqual([{ name: "campaignSettings:archive", args: { campaignId: C1 } }]));
  });

  it("hides the Archive row from a co-GM (only the creator archives, Q7 a)", () => {
    seed(false);
    render(<Section />);
    expect(screen.queryByTestId("settings-archive")).toBeNull();
    expect(screen.getByRole("group", { name: "GM Fear at the start of a session" })).toBeInTheDocument();
  });
});
