// Plan config U4: Campaign settings, Lorekeeper (design reference/designs/config/Settings.dc.html, `.s-lore`). Every
// library book with its switch (lorekeeperLibrary.setEnabled, optimistic) and the Indexed / Off pill; the House rules
// (notes) book on its own row; table rulings locked on, GM-only notes locked off; internet search and who can ask write
// campaignSettings.set one field per call (rule 12); a refused save rolls back and shows inline. Also the composer's
// side (Config L1 client): with webAllowed false the internet toggle is hidden.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLE_SETTING_DEFAULTS } from "@/lib/config/campaign-settings";
import { errorMessage } from "@/lib/convex-errors";
import { WEB_TOGGLE_GROUP_LABEL, WEB_TOGGLE_LABEL } from "@/lib/lorekeeper/copy";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";
import type { Library } from "../../../convex/lorekeeperLibrary";

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

const { LorekeeperSection, LORE_TEXT } = await import("@/components/config/sections/lorekeeper");
const { Composer } = await import("@/components/lorekeeper/composer/composer");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;
const LIBRARY = `lorekeeperLibrary:list:${JSON.stringify({ campaignId: C1 })}`;
const CORE = "b-core" as Id<"lorekeeperBooks">;
const HOPE = "b-hope" as Id<"lorekeeperBooks">;
const NOTES = "b-notes" as Id<"lorekeeperBooks">;

function book(bookId: Id<"lorekeeperBooks">, key: string, title: string, enabled: boolean) {
  return { bookId, key, title, subtitle: "", cover: "core", pages: 10, chunkCount: 5, enabled };
}

function Section() {
  useVersion();
  return <LorekeeperSection campaign={store.get(GET) as CampaignSummary} />;
}

const sw = (name: string) => screen.getByRole("switch", { name });
const settings = () => (store.get(GET) as CampaignSummary).settings;
const library = () => store.get(LIBRARY) as Library;

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  store.set(GET, { _id: C1, name: "The Witherwild", role: "gm", settings: { ...TABLE_SETTING_DEFAULTS } } as unknown as CampaignSummary);
  store.set(LIBRARY, {
    books: [
      book(CORE, "core", "Daggerheart Core Rulebook", true),
      book(HOPE, "hopeFear", "Hope & Fear", false),
      book(NOTES, "houseRules", "House rules (notes)", true),
    ],
    indexedCount: 2,
  } satisfies Library);
});

describe("Campaign settings: Lorekeeper", () => {
  it("lists every book with its switch and pill, and the notes book on its own row", () => {
    render(<Section />);
    expect(screen.getByText(LORE_TEXT.sources)).toBeInTheDocument();
    expect(sw("Daggerheart Core Rulebook")).toHaveAttribute("aria-checked", "true");
    expect(sw("Hope & Fear")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Indexed")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    // The house-rules pseudo-book is named after the campaign, not listed as a book.
    expect(screen.queryByText("House rules (notes)")).toBeNull();
    expect(sw("Your The Witherwild notes")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(LORE_TEXT.notesHint)).toBeInTheDocument();
  });

  it("locks table rulings on and GM-only notes off, with no setting", () => {
    render(<Section />);
    const rulings = sw(LORE_TEXT.rulings.label);
    const gmNotes = sw(LORE_TEXT.gmNotes.label);
    expect(rulings).toBeDisabled();
    expect(rulings).toHaveAttribute("aria-checked", "true");
    expect(gmNotes).toBeDisabled();
    expect(gmNotes).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(LORE_TEXT.rulings.hint)).toBeInTheDocument();
    expect(screen.getByText(LORE_TEXT.gmNotes.hint)).toBeInTheDocument();
    expect(screen.getByText("Always on")).toBeInTheDocument();
    expect(screen.getByText("Always off")).toBeInTheDocument();
    fireEvent.click(rulings);
    fireEvent.click(gmNotes);
    expect(calls).toEqual([]);
  });

  it("switches a book through setEnabled, optimistically on the library", async () => {
    render(<Section />);
    fireEvent.click(sw("Hope & Fear"));
    expect(calls).toEqual([{ name: "lorekeeperLibrary:setEnabled", args: { campaignId: C1, bookId: HOPE, enabled: true } }]);
    await waitFor(() => expect(sw("Hope & Fear")).toHaveAttribute("aria-checked", "true"));
    expect(library().indexedCount).toBe(3);
    fireEvent.click(sw("Your The Witherwild notes"));
    expect(calls[1]).toEqual({ name: "lorekeeperLibrary:setEnabled", args: { campaignId: C1, bookId: NOTES, enabled: false } });
  });

  it("saves internet search and who can ask one field per call", async () => {
    render(<Section />);
    expect(screen.getByText(LORE_TEXT.web.hint)).toBeInTheDocument();
    const web = sw(LORE_TEXT.web.label);
    expect(web).toHaveAttribute("aria-checked", "true");
    fireEvent.click(web);
    await waitFor(() => expect(sw(LORE_TEXT.web.label)).toHaveAttribute("aria-checked", "false"));

    const seg = screen.getByRole("group", { name: "Who can ask" });
    expect(within(seg).getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(seg).getByRole("button", { name: "GM only" }));
    await waitFor(() => expect(within(seg).getByRole("button", { name: "GM only" })).toHaveAttribute("aria-pressed", "true"));
    // The current choice again writes nothing.
    fireEvent.click(within(seg).getByRole("button", { name: "GM only" }));

    expect(calls).toEqual([
      { name: "campaignSettings:set", args: { campaignId: C1, change: { key: "lorekeeperWeb", value: false } } },
      { name: "campaignSettings:set", args: { campaignId: C1, change: { key: "lorekeeperAsk", value: "gm" } } },
    ]);
    expect(settings()).toEqual({ ...TABLE_SETTING_DEFAULTS, lorekeeperWeb: false, lorekeeperAsk: "gm" });
  });

  it("shows a refused save inline and rolls the switch back", async () => {
    refuse = new ConvexError({ code: "CAMPAIGN_ARCHIVED" });
    render(<Section />);
    fireEvent.click(sw(LORE_TEXT.web.label));
    await waitFor(() => expect(screen.getByText(errorMessage(refuse))).toBeInTheDocument());
    expect(sw(LORE_TEXT.web.label)).toHaveAttribute("aria-checked", "true");
    expect(settings().lorekeeperWeb).toBe(true);
  });

  it("shows a loading line until the library arrives, and the settings rows meanwhile", () => {
    store.delete(LIBRARY);
    render(<Section />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("switch", { name: "Daggerheart Core Rulebook" })).toBeNull();
    expect(sw(LORE_TEXT.web.label)).toBeInTheDocument();
  });
});

describe("Composer: the campaign's internet switch (Config L1)", () => {
  const base = {
    disabled: null,
    streaming: false,
    sending: false,
    onAsk: vi.fn(async () => true),
    webSearch: true,
    onWebSearch: vi.fn(),
    visibility: null,
    notice: null,
    onNewConversation: vi.fn(),
  };

  it("shows the internet toggle by default", () => {
    render(<Composer {...base} />);
    expect(screen.getByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeInTheDocument();
    expect(screen.getByText(WEB_TOGGLE_LABEL)).toBeInTheDocument();
  });

  it("hides the internet toggle while the GM keeps the internet off", () => {
    render(<Composer {...base} webAllowed={false} />);
    expect(screen.queryByRole("group", { name: WEB_TOGGLE_GROUP_LABEL })).toBeNull();
    expect(screen.queryByText(WEB_TOGGLE_LABEL)).toBeNull();
  });
});
