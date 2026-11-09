// Plan config U2: Campaign settings, House rules (design reference/designs/config/Settings.dc.html, `.s-rules`). The
// board's hint; today's campaign options for the frame (optionsFor) as switches tagged 'Campaign option' that write
// campaigns.setOption with an optimistic update on campaigns.get (the dashboard panel's field, Q10 b); the table
// rulings (lorekeeperRulings.list) with 'Pinned from the Lorekeeper · Session N' or 'Added here'; add (pin without
// fromMessageId), edit (update, changed fields only, optimistic) and unpin (inline confirm, optimistic); the server's
// limits (80 / 600 characters, 50 rulings with LOREKEEPER_RULING_LIMIT's text).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorMessage } from "@/lib/convex-errors";
import { lorekeeperMessages } from "@/lib/errors/lorekeeper";
import { EXPANSION_OPTIONS, optionsFor, resolveOptions } from "@/lib/frames/options";

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

const { HouseRulesSection, RULES_TEXT, rulingOrigin } = await import("@/components/config/sections/rules");
const { ExpansionsSection, EXPANSIONS_TEXT } = await import("@/components/config/sections/expansions");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;
const LIST = `lorekeeperRulings:list:${JSON.stringify({ campaignId: C1 })}`;

const ruling = (id: string, title: string, extra: Partial<{ sessionN: number | null; fromMessageId: string | null }> = {}) => ({
  _id: id,
  title,
  text: `${title} text.`,
  sessionN: null,
  meta: "Pinned by the GM",
  fromMessageId: null,
  pinnedAt: 1,
  updatedAt: 1,
  ...extra,
});

function Section() {
  useVersion();
  return <HouseRulesSection campaign={store.get(GET) as CampaignSummary} />;
}

function Expansions() {
  useVersion();
  return <ExpansionsSection campaign={store.get(GET) as CampaignSummary} />;
}

const sw = (name: string) => screen.getByRole("switch", { name });
const options = () => (store.get(GET) as CampaignSummary).options;
const rulings = () => store.get(LIST) as ReturnType<typeof ruling>[];

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  store.set(GET, { _id: C1, name: "The Witherwild", frameId: "witherwild", role: "gm", options: resolveOptions("witherwild", undefined) } as unknown as CampaignSummary);
  store.set(LIST, [
    ruling("r1", "Hexes don’t stack", { sessionN: 4, fromMessageId: "m1" }),
    ruling("r2", "Swimming in heavy armour", { fromMessageId: "m2" }),
    ruling("r3", "Short rests take an hour"),
  ]);
});

describe("Campaign settings: House rules", () => {
  it("shows the board's hint and the frame's campaign options as tagged switches", () => {
    render(<Section />);
    expect(screen.getByText("The Lorekeeper quotes these as table rulings before it searches anywhere else.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Campaign options" });
    // Hope & Fear content moved to Campaign settings > Expansions (user 2026-11-09).
    const frameOptions = optionsFor("witherwild").filter((o) => !EXPANSION_OPTIONS.includes(o.id));
    expect(within(list).queryByRole("switch", { name: "Hope & Fear content" })).toBeNull();
    expect(within(list).getAllByRole("switch")).toHaveLength(frameOptions.length);
    for (const o of frameOptions) {
      expect(within(list).getByText(o.label)).toBeInTheDocument();
      expect(within(list).getByText(o.description)).toBeInTheDocument();
      expect(sw(o.label)).toHaveAttribute("aria-checked", String(options()[o.id]));
    }
    expect(within(list).getAllByText(RULES_TEXT.optionTag)).toHaveLength(frameOptions.length);
    // No rule switches from the board (dcm-bxp.134 is a later plan).
    expect(screen.queryByRole("switch", { name: "Massive damage" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Action tracker" })).toBeNull();
  });

  it("only offers another frame's own options", () => {
    store.set(GET, { _id: C1, frameId: "castle-high", role: "gm", options: resolveOptions("castle-high", undefined) } as unknown as CampaignSummary);
    render(<Section />);
    // A new Castle High campaign starts with Less Lethal off (RD2); the GM turns it on here.
    expect(sw("Less lethal (Castle High)")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("switch", { name: "Wither stays across sessions (house rule)" })).toBeNull();
  });

  it("writes campaigns.setOption, one option per call, optimistically on campaigns.get", async () => {
    render(<Section />);
    fireEvent.click(sw("Wither stays across sessions (house rule)"));
    await waitFor(() => expect(sw("Wither stays across sessions (house rule)")).toHaveAttribute("aria-checked", "true"));
    expect(calls).toEqual([{ name: "campaigns:setOption", args: { campaignId: C1, option: "witherPersists", enabled: true } }]);
    expect(options().witherPersists).toBe(true);
    expect(options().hopeAndFear).toBe(resolveOptions("witherwild", undefined).hopeAndFear);
  });

  it("rolls a refused option back and shows the reason inline", async () => {
    refuse = new ConvexError({ code: "CAMPAIGN_ARCHIVED" });
    render(<Section />);
    fireEvent.click(sw("Wither stays across sessions (house rule)"));
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(sw("Wither stays across sessions (house rule)")).toHaveAttribute("aria-checked", "false");
  });

  it("Expansions holds the Hope & Fear switch (moved out of House rules, user 2026-11-09) and writes campaigns.setOption", async () => {
    render(<Expansions />);
    const list = screen.getByRole("list", { name: EXPANSIONS_TEXT.label });
    expect(within(list).getAllByRole("switch")).toHaveLength(1);
    expect(within(list).getByText(EXPANSIONS_TEXT.tag)).toBeInTheDocument();
    const before = options().hopeAndFear;
    fireEvent.click(sw("Hope & Fear content"));
    await waitFor(() => expect(sw("Hope & Fear content")).toHaveAttribute("aria-checked", String(!before)));
    expect(calls).toEqual([{ name: "campaigns:setOption", args: { campaignId: C1, option: "hopeAndFear", enabled: !before } }]);
  });

  it("lists the rulings with where they came from", () => {
    render(<Section />);
    const list = screen.getByRole("list", { name: "Table rulings" });
    expect(within(list).getByText("Hexes don’t stack")).toBeInTheDocument();
    expect(within(list).getByText("Pinned from the Lorekeeper · Session 4")).toBeInTheDocument();
    expect(within(list).getByText("Pinned from the Lorekeeper")).toBeInTheDocument();
    expect(within(list).getByText("Added here")).toBeInTheDocument();
    expect(rulingOrigin({ fromMessageId: null, sessionN: 3 })).toBe("Added here · Session 3");
  });

  it("adds a house rule through pin without fromMessageId or a session", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Add a house rule" }));
    const form = screen.getByRole("form", { name: "Add a house rule" });
    const submit = within(form).getByRole("button", { name: "Add rule" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "  Falling  " } });
    fireEvent.change(within(form).getByLabelText("Ruling"), { target: { value: "1d10 per 10 feet." } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add a house rule" })).toBeNull());
    expect(calls).toEqual([{ name: "lorekeeperRulings:pin", args: { campaignId: C1, title: "Falling", text: "1d10 per 10 feet." } }]);
  });

  it("caps the fields at the server's 80 and 600 characters", () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Add a house rule" }));
    expect(screen.getByLabelText("Title")).toHaveAttribute("maxLength", "80");
    expect(screen.getByLabelText("Ruling")).toHaveAttribute("maxLength", "600");
  });

  it("shows the server's refusal in the form and keeps it open", async () => {
    refuse = new ConvexError({ code: "LOREKEEPER_RULING_LIMIT" });
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Add a house rule" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "One more" } });
    fireEvent.change(screen.getByLabelText("Ruling"), { target: { value: "Too many." } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(screen.getByText(lorekeeperMessages.LOREKEEPER_RULING_LIMIT)).toBeInTheDocument());
    expect(screen.getByRole("form", { name: "Add a house rule" })).toBeInTheDocument();
  });

  it("turns Add off at 50 rulings with the limit's text", () => {
    store.set(
      LIST,
      Array.from({ length: 50 }, (_, i) => ruling(`r${i}`, `Rule ${i}`)),
    );
    render(<Section />);
    expect(screen.getByRole("button", { name: "Add a house rule" })).toBeDisabled();
    expect(screen.getByText(lorekeeperMessages.LOREKEEPER_RULING_LIMIT)).toBeInTheDocument();
  });

  it("edits a ruling inline, sending only the changed field, optimistically", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Hexes don’t stack" }));
    const form = screen.getByRole("form", { name: "Edit Hexes don’t stack" });
    expect(within(form).getByLabelText("Title")).toHaveValue("Hexes don’t stack");
    fireEvent.change(within(form).getByLabelText("Ruling"), { target: { value: "Only the biggest Hex applies." } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit Hexes don’t stack" })).toBeNull());
    expect(calls).toEqual([{ name: "lorekeeperRulings:update", args: { campaignId: C1, rulingId: "r1", text: "Only the biggest Hex applies." } }]);
    expect(rulings()[0]!.text).toBe("Only the biggest Hex applies.");
    expect(screen.getByText("Only the biggest Hex applies.")).toBeInTheDocument();
  });

  it("saves nothing when an edit changes nothing, and Escape cancels the form", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Hexes don’t stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add a house rule" }));
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("unpins after an inline confirm, optimistically", async () => {
    render(<Section />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Swimming in heavy armour" }));
    const confirm = screen.getByRole("group", { name: "Unpin Swimming in heavy armour?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Swimming in heavy armour" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Unpin Swimming in heavy armour?" })).getByRole("button", { name: "Unpin" }));
    await waitFor(() => expect(screen.queryByText("Swimming in heavy armour")).toBeNull());
    expect(calls).toEqual([{ name: "lorekeeperRulings:unpin", args: { campaignId: C1, rulingId: "r2" } }]);
    expect(rulings().map((r) => r._id)).toEqual(["r1", "r3"]);
  });

  it("shows the empty line and a loading line", () => {
    store.set(LIST, []);
    const { unmount } = render(<Section />);
    expect(screen.getByText(RULES_TEXT.empty)).toBeInTheDocument();
    unmount();
    store.delete(LIST);
    render(<Section />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
});
