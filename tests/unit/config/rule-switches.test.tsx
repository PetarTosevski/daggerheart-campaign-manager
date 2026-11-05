// Plan rule-switches RU: House rules' rule rows. Every rule of the frame from the registry, by area (Optional rules
// first); a wired switch rule gets a Book / variant / Manual radio group that writes ruleSettings.set one field at a time
// with an optimistic update on ruleSettings.get; optional rules a switch; Book-only rules a read-only row with its page;
// rules the engine doesn't follow yet show their mode read-only with 'Coming soon'; a live session disables every
// control (the campaign options too, Q17 a) with the lock hint; players read the same rows from the Preferences popover
// (Q18 a) with the modes as text.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorMessage } from "@/lib/convex-errors";
import { resolveOptions } from "@/lib/frames/options";
import { resolveRuleModes, rulesFor, type StoredRuleModes } from "@/lib/rules";

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

const { HouseRulesSection } = await import("@/components/config/sections/rules");
const { WIRED_RULES, pageTag, ruleGroups, ruleTag, applyRuleChange, RULE_ROWS_TEXT } = await import("@/components/config/sections/rules/model");
const { PreferenceRows } = await import("@/components/config/prefs");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;
const RULES = `ruleSettings:get:${JSON.stringify({ campaignId: C1 })}`;
const PREFS = `preferences:get:${JSON.stringify({})}`;

type View = { modes: ReturnType<typeof resolveRuleModes>; locked: boolean; canEdit: boolean };
const view = () => store.get(RULES) as View;

function setUp(frameId: "witherwild" | "journey-to-horizon" | "age-of-umbra", stored: StoredRuleModes = {}, extra: Partial<View> = {}) {
  store.set(GET, { _id: C1, name: "Test", frameId, role: "gm", options: resolveOptions(frameId, undefined) } as unknown as CampaignSummary);
  store.set(RULES, { modes: resolveRuleModes(frameId, stored), locked: false, canEdit: true, ...extra });
  store.set(`lorekeeperRulings:list:${JSON.stringify({ campaignId: C1 })}`, []);
}

function Section() {
  useVersion();
  return <HouseRulesSection campaign={store.get(GET) as CampaignSummary} />;
}

const row = (id: string) => document.querySelector(`[data-rule="${id}"]`) as HTMLElement;
const added: string[] = [];

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  setUp("witherwild");
});
afterEach(() => {
  for (const id of added.splice(0)) (WIRED_RULES as Set<string>).delete(id);
});
function wire(id: string) {
  (WIRED_RULES as Set<string>).add(id);
  added.push(id);
}

describe("rule rows: model", () => {
  it("lists the frame's rules by area, Optional rules first, choices before Book-only rows", () => {
    const groups = ruleGroups("witherwild");
    expect(groups[0]!.label).toBe("Optional rules");
    expect(groups.map((g) => g.area)).toEqual(["optional", "rolls", "hopeFear", "damage", "armor", "conditions", "rests", "death", "spotlight", "map", "levelUp", "countdowns", "adversaries", "frame"]);
    expect(groups.flatMap((g) => g.rules)).toHaveLength(rulesFor("witherwild").length);
    for (const g of groups) {
      const firstBook = g.rules.findIndex((r) => r.kind === "bookOnly");
      if (firstBook >= 0) expect(g.rules.slice(firstBook).every((r) => r.kind === "bookOnly")).toBe(true);
    }
    // Another frame's rules are hidden: Witherwild has W1, not the Horizon rules.
    const ids = groups.flatMap((g) => g.rules.map((r) => r.id));
    expect(ids).toContain("witherTokens");
    expect(ids).not.toContain("horizonSanctuaryRest");
    expect(ids).not.toContain("horizonEncounterBonuses");
  });

  it("names the books in page tags", () => {
    expect(pageTag([{ book: "CB", page: 90 }, { book: "CB", page: 154 }])).toBe("Core Rulebook p.90, p.154");
    expect(pageTag([{ book: "HF", page: 176 }])).toBe("Hope & Fear p.176");
    const groups = ruleGroups("witherwild").flatMap((g) => g.rules);
    expect(ruleTag(groups.find((r) => r.id === "massiveDamage")!)).toBe("Optional rule · Core Rulebook p.91");
    expect(ruleTag(groups.find((r) => r.id === "fearCap")!)).toBe("Book · Core Rulebook p.154");
    expect(ruleTag(groups.find((r) => r.id === "fearFromRests")!)).toBe("Core Rulebook p.105");
  });

  it("applies a change the way the server resolves it (X2 turns Manual with X1)", () => {
    const next = applyRuleChange(view(), { key: "deathMovePrompt", value: "manual" });
    expect(next.modes.deathMovePrompt).toBe("manual");
    expect(next.modes.deathMoveResolve).toBe("manual");
    expect(applyRuleChange(view(), { key: "darknessDifficulty", value: 5 }).modes.darknessDifficulty).toBe(5);
  });
});

describe("rule rows: the GM", () => {
  it("picks a mode: one field per call, optimistic on ruleSettings.get", async () => {
    render(<Section />);
    const group = within(row("fearFromRests")).getByRole("radiogroup", { name: "Fear from rests" });
    expect(within(group).getByRole("radio", { name: "Book" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Manual" }));
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Manual" })).toBeChecked());
    expect(calls).toEqual([{ name: "ruleSettings:set", args: { campaignId: C1, change: { key: "fearFromRests", value: "manual" } } }]);
    expect(view().modes.fearFromRests).toBe("manual");
    // The variant printed in the book carries no tag.
    expect(within(group).getByRole("radio", { name: "Extended downtime (several days)" })).toBeInTheDocument();
  });

  it("tags a variant the books don't print", () => {
    wire("minions");
    render(<Section />);
    const group = within(row("minions")).getByRole("radiogroup", { name: "Minions" });
    expect(within(group).getByRole("radio", { name: `GM picks the extra Minions ${RULE_ROWS_TEXT.notInBooks}` })).toBeInTheDocument();
    expect(within(group).getAllByText(RULE_ROWS_TEXT.notInBooks)).toHaveLength(1);
  });

  it("switches an optional rule and steps its number", async () => {
    wire("spotlightTracker");
    setUp("witherwild", { spotlightTracker: true });
    render(<Section />);
    const sw = within(row("spotlightTracker")).getByRole("switch", { name: "Spotlight Tracker" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(within(row("spotlightTracker")).getByText("Optional rule · Core Rulebook p.89")).toBeInTheDocument();
    fireEvent.click(within(row("spotlightTracker")).getByRole("button", { name: "Tokens per PC: one more" }));
    await waitFor(() => expect(view().modes.spotlightTrackerTokens).toBe(4));
    expect(calls.at(-1)).toEqual({ name: "ruleSettings:set", args: { campaignId: C1, change: { key: "spotlightTrackerTokens", value: 4 } } });
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(calls.at(-1)!.args.change).toEqual({ key: "spotlightTracker", value: false });
    // Off: no stepper.
    expect(within(row("spotlightTracker")).queryByRole("button", { name: "Tokens per PC: one more" })).toBeNull();
  });

  it("has no upper limit on the darkness Difficulty", () => {
    wire("darkness");
    setUp("witherwild", { darkness: "difficulty", darknessDifficulty: 9 });
    render(<Section />);
    expect(within(row("darkness")).getByRole("button", { name: "Difficulty raised by: one more" })).toBeEnabled();
    expect(within(row("darkness")).getByRole("radio", { name: `Dim light: both ${RULE_ROWS_TEXT.notInBooks}` })).toBeInTheDocument();
  });

  it("shows Book-only rules as rows with their page and no control", () => {
    render(<Section />);
    const fearCap = row("fearCap");
    expect(within(fearCap).getByText("Fear cap")).toBeInTheDocument();
    expect(within(fearCap).getByText("Book · Core Rulebook p.154")).toBeInTheDocument();
    expect(within(fearCap).queryByRole("radio")).toBeNull();
    expect(within(fearCap).queryByRole("switch")).toBeNull();
    expect(within(fearCap).queryByRole("button")).toBeNull();
  });

  it("shows rules the engine doesn't follow yet read-only with 'Coming soon'", () => {
    render(<Section />);
    const r3 = row("hopeFearFromRolls");
    expect(within(r3).queryByRole("radio")).toBeNull();
    expect(within(r3).getByText("Book")).toBeInTheDocument();
    expect(within(r3).getByText(RULE_ROWS_TEXT.comingSoon)).toBeInTheDocument();
    expect(within(row("massiveDamage")).queryByRole("switch")).toBeNull();
    expect(within(row("massiveDamage")).getByText("Off")).toBeInTheDocument();
  });

  it("makes X2 read-only while X1 is Manual", () => {
    wire("deathMovePrompt");
    wire("deathMoveResolve");
    setUp("witherwild", { deathMovePrompt: "manual" });
    render(<Section />);
    expect(within(row("deathMovePrompt")).getByRole("radio", { name: "Manual" })).toBeChecked();
    expect(within(row("deathMoveResolve")).queryByRole("radio")).toBeNull();
    expect(within(row("deathMoveResolve")).getByText(RULE_ROWS_TEXT.blocked)).toBeInTheDocument();
  });

  it("rolls a refused change back and shows the server's reason", async () => {
    refuse = new ConvexError({ code: "RULES_LOCKED" });
    render(<Section />);
    fireEvent.click(within(row("shortRestLimit")).getByRole("radio", { name: "Manual" }));
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(screen.getByText("Rule switches change between sessions. End the session first.")).toBeInTheDocument();
    expect(within(row("shortRestLimit")).getByRole("radio", { name: "Book" })).toBeChecked();
  });

  it("disables every control while a session is live, campaign options too", () => {
    setUp("witherwild", {}, { locked: true });
    render(<Section />);
    expect(screen.getByTestId("rules-locked")).toHaveTextContent(RULE_ROWS_TEXT.locked);
    for (const radio of within(row("fearFromRests")).getAllByRole("radio")) expect(radio).toBeDisabled();
    const options = screen.getByRole("list", { name: "Campaign options" });
    for (const sw of within(options).getAllByRole("switch")) expect(sw).toBeDisabled();
  });

  it("shows the rows read-only when the GM can't edit (archived, owner view)", () => {
    setUp("witherwild", {}, { canEdit: false });
    render(<Section />);
    expect(within(screen.getByTestId("rule-rows")).queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(RULE_ROWS_TEXT.playerIntro)).toBeInTheDocument();
  });
});

describe("rule rows: players", () => {
  function Prefs({ isGm }: { isGm: boolean }) {
    useVersion();
    return <PreferenceRows campaignId={C1} isGm={isGm} />;
  }
  beforeEach(() => {
    store.set(PREFS, { dice3d: true, diceSound: true, diceVolume: 70, reduceMotion: false, textSize: "medium", spotlightPing: true });
    setUp("journey-to-horizon", { fearFromRests: "manual", horizonEncounterBonuses: true }, { canEdit: false });
  });

  it("open House rules from the Preferences popover and read the modes as text", () => {
    render(<Prefs isGm={false} />);
    const open = screen.getByRole("button", { name: "House rules" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("rule-rows")).toBeNull();
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getByTestId("rule-rows");
    expect(within(rows).queryAllByRole("radio")).toHaveLength(0);
    expect(within(rows).queryAllByRole("switch")).toHaveLength(0);
    expect(within(row("fearFromRests")).getByText("Manual")).toBeInTheDocument();
    expect(within(row("horizonEncounterBonuses")).getByText("On")).toBeInTheDocument();
    expect(within(row("horizonSanctuaryRest")).getByText("Hope & Fear p.176")).toBeInTheDocument();
    // M2's default is the app's own rule: labelled not in the books.
    expect(within(row("wallsBlock")).getByText("App rule")).toBeInTheDocument();
    expect(within(row("wallsBlock")).getByText(RULE_ROWS_TEXT.notInBooks)).toBeInTheDocument();
    expect(within(rows).queryByText(RULE_ROWS_TEXT.comingSoon)).toBeNull();
  });

  it("the GM doesn't get the item (Campaign settings has the rows)", () => {
    render(<Prefs isGm />);
    expect(screen.queryByRole("button", { name: "House rules" })).toBeNull();
  });
});
