// Plan config AU3: the App admin Lorekeeper tab (design reference/designs/config/Admin.dc.html `.s-lore`) and the GM's
// 'Ask for higher limits' in Campaign settings > Lorekeeper (Q21 changed, N10). Budget (spend meter, questions count,
// monthly limit stepper, at-limit choice, Email me at 80%), Limits per person (steppers, the re-labelled GM-requests
// switch), Requests (approve with the owner's numbers / decline, optimistic hide, rollback), Use by campaign (rows and
// each campaign's own numbers), the Book library (rows, status, Replace / Upload a book with progress and ingest) and
// each card's error boundary; the GM side hidden while requests are off, the current numbers, the ask form, the
// pending request with Withdraw and the last answer. Convex is mocked with a small store, so optimistic updates
// re-render like the real client.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConvexError } from "convex/values";

const fake = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paged: { results: [] as Record<string, unknown>[], status: "Exhausted" as string },
  calls: [] as { name: string; args: Record<string, unknown> }[],
  results: {} as Record<string, unknown>,
  fail: {} as Record<string, unknown>,
  throwIn: null as string | null,
  listeners: new Set<() => void>(),
  version: 0,
}));

const nameOf = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
function bump() {
  fake.version++;
  for (const l of fake.listeners) l();
}

vi.mock("convex/react", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    fake.listeners.add(l);
    return () => fake.listeners.delete(l);
  };
  const read = (name: string, args: unknown) => {
    const value = fake.queries[name];
    return typeof value === "function" ? (value as (a: unknown) => unknown)(args) : value;
  };
  const store = {
    getQuery: (ref: unknown, args: unknown) => read(nameOf(ref), args),
    setQuery: (ref: unknown, _args: unknown, value: unknown) => {
      fake.queries[nameOf(ref)] = value;
    },
  };
  return {
    useQuery: (ref: unknown, args: unknown) => {
      useSyncExternalStore(subscribe, () => fake.version);
      const name = nameOf(ref);
      if (fake.throwIn === name) throw new Error("query broke");
      return read(name, args);
    },
    usePaginatedQuery: (ref: unknown) => {
      useSyncExternalStore(subscribe, () => fake.version);
      if (fake.throwIn === nameOf(ref)) throw new Error("query broke");
      return { ...fake.paged, loadMore: () => {} };
    },
    useMutation: (ref: unknown) => {
      const name = nameOf(ref);
      let optimistic: ((s: typeof store, args: Record<string, unknown>) => void) | null = null;
      const run = async (args: Record<string, unknown>) => {
        fake.calls.push({ name, args });
        const snapshot = { ...fake.queries };
        optimistic?.(store, args);
        bump();
        if (fake.fail[name]) {
          fake.queries = snapshot;
          bump();
          throw fake.fail[name];
        }
        return fake.results[name] ?? null;
      };
      return Object.assign(run, {
        withOptimisticUpdate: (fn: typeof optimistic) => {
          optimistic = fn;
          return run;
        },
      });
    },
  };
});

const { LorekeeperTab } = await import("@/components/admin/lorekeeper");
const { LorekeeperLimits } = await import("@/components/config/sections/lorekeeper/limits");

const SETTINGS = {
  signUpMode: "open",
  caps: { campaignsPerGm: 10, campaignsApp: 100, charactersPerPlayer: 5, playersPerCampaign: 8 },
  lorekeeper: { monthlyUsd: 20, campaignMonthlyUsd: 50, dailyQuestions: 30, dailyWebSearches: 10, atLimit: "gmOnly", allowGmRequests: false, emailAt80: true },
  spendAlertMonth: null,
};
const USE = {
  month: "2026-11",
  total: { questions: 412, costMicros: 8_400_000 },
  campaigns: [
    { campaignId: "c-wither", name: "The Witherwild", deleted: false, questions: 268, costMicros: 5_000_000 },
    { campaignId: "c-umbra", name: "Age of Umbra", deleted: false, questions: 144, costMicros: 3_400_000 },
  ],
  truncated: false,
};
const CURRENT = { dailyQuestions: 30, dailyWebSearches: 10, bookCount: null, bookPages: null, custom: false };
const REQUEST = {
  _id: "r1",
  campaignId: "c-umbra",
  campaignName: "Age of Umbra",
  requestedBy: "u-mira",
  requesterName: "Mira",
  wants: { dailyQuestions: 60, dailyWebSearches: 20 },
  reason: "We play twice a week.",
  status: "pending",
  createdAt: Date.UTC(2026, 10, 2),
  decidedAt: null,
  current: CURRENT,
};
const LIBRARY = {
  books: [
    { bookId: "b-core", key: "core", title: "Daggerheart Core Rulebook", subtitle: "", pages: 412, chunkCount: 900, ingestedAt: 0 },
    { bookId: "b-hf", key: "hopeFear", title: "Hope & Fear", subtitle: "", pages: 0, chunkCount: 0, ingestedAt: 0 },
  ],
  available: [{ key: "frame:witherwild", title: "The Witherwild" }],
};
const VIEW = { requestsOpen: true, current: CURRENT, pending: null, lastDecision: null };

beforeEach(() => {
  fake.queries = {
    "appAdmin:settings": structuredClone(SETTINGS),
    "adminLorekeeper:useByCampaign": structuredClone(USE),
    "adminLibrary:list": structuredClone(LIBRARY),
    "adminLibrary:ingestStatus": null,
    "lorekeeperLimitRequests:forCampaign": structuredClone(VIEW),
  };
  fake.paged = { results: [structuredClone(REQUEST)], status: "Exhausted" };
  fake.calls = [];
  fake.results = {};
  fake.fail = {};
  fake.throwIn = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderTab = () => render(<LorekeeperTab onTab={() => {}} />);
const card = (name: string) => screen.getByRole("region", { name });
const callsOf = (name: string) => fake.calls.filter((c) => c.name === name).map((c) => c.args);
const refused = (code: string) => new ConvexError({ code });

describe("Budget", () => {
  it("draws the spend meter, the month's question count, the limit, the at-limit choice and the 80% switch", () => {
    renderTab();
    const budget = card("Budget");
    const meter = within(budget).getByRole("meter", { name: "Spend this month" });
    expect(meter).toHaveAttribute("aria-valuenow", "8.4");
    expect(meter).toHaveAttribute("aria-valuemax", "20");
    expect(budget).toHaveTextContent("$8.40 of $20.00");
    expect(budget).toHaveTextContent("Questions this month412");
    expect(within(budget).queryByText(/of 1500/)).toBeNull(); // Q22 a: count only
    expect(within(budget).getByText("Resets on the 1st.")).toBeInTheDocument();
    expect(within(within(budget).getByRole("group", { name: "Monthly spend limit" })).getByText("$20")).toBeInTheDocument();
    const modes = within(budget).getByRole("group", { name: "When the limit is reached" });
    expect(within(modes).getAllByRole("button").map((b) => b.textContent)).toEqual(["Pause the Lorekeeper", "GMs only", "Shorter answers"]);
    expect(within(modes).getByRole("button", { name: "GMs only" })).toHaveAttribute("aria-pressed", "true");
    expect(within(budget).getByRole("switch", { name: "Email me at 80%" })).toHaveAttribute("aria-checked", "true");
  });

  it("each click is one field, optimistic: + $5, the at-limit mode, the 80% email off", () => {
    renderTab();
    const budget = card("Budget");
    const limit = within(budget).getByRole("group", { name: "Monthly spend limit" });
    fireEvent.click(within(limit).getByRole("button", { name: "More" }));
    fireEvent.click(within(limit).getByRole("button", { name: "More" }));
    expect(within(limit).getByText("$30")).toBeInTheDocument();
    fireEvent.click(within(budget).getByRole("button", { name: "Shorter answers" }));
    fireEvent.click(within(budget).getByRole("button", { name: "Shorter answers" })); // already chosen: no write
    fireEvent.click(within(budget).getByRole("switch", { name: "Email me at 80%" }));
    expect(within(budget).getByRole("switch", { name: "Email me at 80%" })).toHaveAttribute("aria-checked", "false");
    expect(callsOf("adminLorekeeper:setLimit")).toEqual([
      { change: { field: "monthlyUsd", value: 25 } },
      { change: { field: "monthlyUsd", value: 30 } },
      { change: { field: "atLimit", value: "short" } },
      { change: { field: "emailAt80", value: false } },
    ]);
  });

  it("a refused write rolls back and says why", async () => {
    fake.fail["adminLorekeeper:setLimit"] = refused("FORBIDDEN");
    renderTab();
    const budget = card("Budget");
    await act(async () => {
      fireEvent.click(within(budget).getByRole("switch", { name: "Email me at 80%" }));
    });
    expect(within(budget).getByRole("switch", { name: "Email me at 80%" })).toHaveAttribute("aria-checked", "true");
    expect(within(budget).getByRole("alert")).toBeInTheDocument();
  });
});

describe("Limits per person", () => {
  it("steppers and the re-labelled GM requests switch (N10)", () => {
    renderTab();
    const person = card("Limits per person");
    expect(within(person).getByText("For each player and GM. You have no limit.")).toBeInTheDocument();
    expect(within(person).getByText("You approve each request.")).toBeInTheDocument();
    expect(within(person).queryByText(/raise limits for their own table/)).toBeNull();
    fireEvent.click(within(within(person).getByRole("group", { name: "Questions per day" })).getByRole("button", { name: "More" }));
    fireEvent.click(within(within(person).getByRole("group", { name: "Internet searches per day" })).getByRole("button", { name: "Fewer" }));
    fireEvent.click(within(person).getByRole("switch", { name: "Let GMs ask for higher limits" }));
    expect(callsOf("adminLorekeeper:setLimit")).toEqual([
      { change: { field: "dailyQuestions", value: 31 } },
      { change: { field: "dailyWebSearches", value: 9 } },
      { change: { field: "allowGmRequests", value: true } },
    ]);
    expect(within(person).getByRole("switch", { name: "Let GMs ask for higher limits" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Requests", () => {
  it("shows the campaign, the GM, the reason and the asked numbers next to the current ones", () => {
    renderTab();
    const reqs = card("Requests");
    const item = within(reqs).getByRole("listitem", { name: "Age of Umbra" });
    expect(item).toHaveTextContent("Mira · asked 2 Nov");
    expect(item).toHaveTextContent("We play twice a week.");
    expect(within(item).getByRole("textbox", { name: /Questions per day/ })).toHaveValue("60");
    expect(within(item).getByRole("textbox", { name: /Internet searches per day/ })).toHaveValue("20");
    expect(item).toHaveTextContent("now 30");
    expect(within(item).queryByRole("textbox", { name: /Books/ })).toBeNull();
  });

  it("approves with the owner's numbers and hides the row at once", () => {
    renderTab();
    const item = within(card("Requests")).getByRole("listitem", { name: "Age of Umbra" });
    fireEvent.change(within(item).getByRole("textbox", { name: /Questions per day/ }), { target: { value: "50" } });
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(callsOf("lorekeeperLimitRequests:decide")).toEqual([{ requestId: "r1", approve: true, numbers: { dailyQuestions: 50, dailyWebSearches: 20 } }]);
    expect(within(card("Requests")).queryByRole("listitem")).toBeNull();
    expect(card("Requests")).toHaveTextContent("No requests waiting.");
  });

  it("declines; a refused decision brings the row back with the message", async () => {
    fake.fail["lorekeeperLimitRequests:decide"] = refused("INVALID");
    renderTab();
    await act(async () => {
      fireEvent.click(within(card("Requests")).getByRole("button", { name: "Decline" }));
    });
    expect(callsOf("lorekeeperLimitRequests:decide")).toEqual([{ requestId: "r1", approve: false }]);
    expect(within(card("Requests")).getByRole("listitem", { name: "Age of Umbra" })).toBeInTheDocument();
    expect(within(card("Requests")).getByRole("alert")).toBeInTheDocument();
  });

  it("refuses a number that isn't whole without calling the server", () => {
    renderTab();
    const item = within(card("Requests")).getByRole("listitem", { name: "Age of Umbra" });
    fireEvent.change(within(item).getByRole("textbox", { name: /Questions per day/ }), { target: { value: "2.5" } });
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    expect(callsOf("lorekeeperLimitRequests:decide")).toEqual([]);
    expect(within(item).getByRole("alert")).toHaveTextContent("whole number");
  });

  it("says when nothing is waiting", () => {
    fake.paged = { results: [], status: "Exhausted" };
    renderTab();
    expect(card("Requests")).toHaveTextContent("No requests waiting.");
  });
});

describe("Use by campaign", () => {
  it("lists each campaign's questions and spend, and sets its own numbers one field at a time", () => {
    renderTab();
    const use = card("Use by campaign");
    expect(use).toHaveTextContent("Questions this month.");
    expect(use).toHaveTextContent("The Witherwild268$5.00");
    expect(use).toHaveTextContent("Age of Umbra144$3.40");
    fireEvent.click(within(use).getByRole("button", { name: "Limits: Age of Umbra" }));
    const limits = within(use).getByRole("group", { name: "Limits: Age of Umbra" });
    const questions = within(limits).getByRole("textbox", { name: "Questions per day" });
    expect(questions).toHaveValue(""); // the app's number (placeholder 30)
    expect(questions).toHaveAttribute("placeholder", "30");
    fireEvent.change(questions, { target: { value: "80" } });
    fireEvent.submit(questions.closest("form")!);
    fireEvent.change(within(limits).getByRole("textbox", { name: "Books" }), { target: { value: "" } });
    fireEvent.submit(within(limits).getByRole("textbox", { name: "Books" }).closest("form")!);
    expect(callsOf("lorekeeperLimitRequests:setCampaignLimits")).toEqual([
      { campaignId: "c-umbra", change: { field: "dailyQuestions", value: 80 } },
      { campaignId: "c-umbra", change: { field: "bookCount", value: null } },
    ]);
  });
});

describe("Book library", () => {
  it("lists the shared books with their pages, the running read and Upload a book", () => {
    fake.queries["adminLibrary:ingestStatus"] = ({ bookKey }: { bookKey: string }) =>
      bookKey === "hopeFear" ? { bookKey, status: "running", result: null } : bookKey === "core" ? { bookKey, status: "failed", result: { ok: false, code: "BOOK_PARSE_FAILED" } } : null;
    renderTab();
    const lib = card("Book library");
    expect(lib).toHaveTextContent("Shared by every campaign. GMs choose which ones their Lorekeeper searches.");
    expect(lib).toHaveTextContent("Daggerheart Core Rulebook412 pages · indexed");
    expect(lib).toHaveTextContent("Hope & FearNo text yet");
    expect(within(lib).getByRole("status")).toHaveTextContent("Reading the PDF…");
    expect(within(lib).getByRole("alert")).toHaveTextContent("The text of that PDF couldn't be read.");
    expect(within(lib).getByRole("button", { name: "Upload a book" })).toBeEnabled();
    expect(lib).toHaveTextContent("Up to 20 MB and 300 pages");
  });

  it("refuses a file that isn't a PDF before uploading", async () => {
    renderTab();
    const lib = card("Book library");
    fireEvent.click(within(lib).getByRole("button", { name: "Replace: Daggerheart Core Rulebook" }));
    const form = within(lib).getByRole("form", { name: "Replace: Daggerheart Core Rulebook" });
    fireEvent.change(within(form).getByLabelText("PDF file"), { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(within(form).getByRole("alert")).toHaveTextContent("Books must be PDF files.");
    expect(callsOf("adminLibrary:uploadUrl")).toEqual([]);
  });

  it("uploads a new book with progress, then starts the read", async () => {
    const sent: { url: string; type: string | null }[] = [];
    class FakeXhr {
      upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      responseText = JSON.stringify({ storageId: "s1" });
      private url = "";
      private type: string | null = null;
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader(_name: string, value: string) {
        this.type = value;
      }
      send() {
        sent.push({ url: this.url, type: this.type });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    fake.results["adminLibrary:uploadUrl"] = "https://upload.example/1";
    fake.results["adminLibrary:ingest"] = { ok: true, bookId: "b-new" };
    renderTab();
    const lib = card("Book library");
    fireEvent.click(within(lib).getByRole("button", { name: "Upload a book" }));
    const form = within(lib).getByRole("form", { name: "Upload a book" });
    expect(within(form).getByRole("combobox", { name: "Book" })).toHaveValue("frame:witherwild");
    fireEvent.change(within(form).getByRole("textbox", { name: "Printed page number of the PDF’s first page" }), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("PDF file"), { target: { files: [new File(["%PDF-"], "w.pdf", { type: "application/pdf" })] } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(sent).toEqual([{ url: "https://upload.example/1", type: "application/pdf" }]);
    expect(callsOf("adminLibrary:ingest")).toEqual([{ storageId: "s1", bookKey: "frame:witherwild", firstPrintedPage: 3 }]);
    expect(within(lib).queryByRole("form")).toBeNull();
  });

  it("shows the server's refusal of the upload", async () => {
    class FakeXhr {
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      status = 200;
      responseText = JSON.stringify({ storageId: "s1" });
      open() {}
      setRequestHeader() {}
      send() {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    fake.results["adminLibrary:uploadUrl"] = "https://upload.example/1";
    fake.results["adminLibrary:ingest"] = { ok: false, code: "BOOK_INGEST_RUNNING" };
    renderTab();
    const lib = card("Book library");
    fireEvent.click(within(lib).getByRole("button", { name: "Replace: Hope & Fear" }));
    const form = within(lib).getByRole("form", { name: "Replace: Hope & Fear" });
    fireEvent.change(within(form).getByLabelText("PDF file"), { target: { files: [new File(["%PDF-"], "h.pdf", { type: "application/pdf" })] } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(callsOf("adminLibrary:ingest")).toEqual([{ storageId: "s1", bookKey: "hopeFear", firstPrintedPage: 1 }]);
    expect(within(form).getByRole("alert")).toHaveTextContent("That book is still being read.");
  });
});

describe("error boundaries", () => {
  it("a failing card shows its own alert and the others still render", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.throwIn = "adminLibrary:list";
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Book library failed to load.");
    expect(card("Budget")).toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });
});

// ---------------------------------------------------------------- the GM's side

const campaign = { _id: "c-umbra", name: "Age of Umbra" } as unknown as Parameters<typeof LorekeeperLimits>[0]["campaign"];
const renderGm = () => render(<LorekeeperLimits campaign={campaign} />);

describe("Campaign settings: Ask for higher limits", () => {
  it("is hidden while the owner takes no requests", () => {
    fake.queries["lorekeeperLimitRequests:forCampaign"] = { ...VIEW, requestsOpen: false };
    renderGm();
    expect(screen.queryByTestId("settings-lorekeeper-limits")).toBeNull();
  });

  it("shows the current numbers and sends a request with what was typed", () => {
    renderGm();
    const box = screen.getByRole("region", { name: "Lorekeeper limits" });
    expect(box).toHaveTextContent("Questions per day30");
    expect(box).toHaveTextContent("Internet searches per day10");
    expect(box).not.toHaveTextContent("Book pages");
    fireEvent.click(within(box).getByRole("button", { name: "Ask for higher limits" }));
    const form = within(box).getByRole("form", { name: "Ask for higher limits" });
    fireEvent.change(within(form).getByRole("textbox", { name: /Questions per day/ }), { target: { value: "60" } });
    fireEvent.change(within(form).getByRole("textbox", { name: /Book pages/ }), { target: { value: "300" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Reason" }), { target: { value: "  Long sessions.  " } });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(callsOf("lorekeeperLimitRequests:request")).toEqual([
      { campaignId: "c-umbra", wants: { dailyQuestions: 60, bookPages: 300 }, reason: "Long sessions." },
    ]);
    expect(box).toHaveTextContent("waiting for an answer");
    expect(box).toHaveTextContent("Questions per day 60 · Book pages 300");
  });

  it("asks for a number and a reason before sending", () => {
    renderGm();
    fireEvent.click(screen.getByRole("button", { name: "Ask for higher limits" }));
    const form = screen.getByRole("form", { name: "Ask for higher limits" });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Ask for at least one number.");
    fireEvent.change(within(form).getByRole("textbox", { name: /Questions per day/ }), { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Give a short reason.");
    fireEvent.change(within(form).getByRole("textbox", { name: /Questions per day/ }), { target: { value: "5000" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Reason" }), { target: { value: "x" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("whole number from 0 to 1000");
    expect(callsOf("lorekeeperLimitRequests:request")).toEqual([]);
  });

  it("shows the pending request with Withdraw, and the last answer", () => {
    fake.queries["lorekeeperLimitRequests:forCampaign"] = {
      ...VIEW,
      pending: { _id: "r2", wants: { dailyWebSearches: 30 }, reason: "r", status: "pending", createdAt: Date.UTC(2026, 10, 3), decidedAt: null, mine: true },
      lastDecision: { _id: "r1", wants: { dailyQuestions: 60 }, reason: "r", status: "declined", createdAt: Date.UTC(2026, 9, 1), decidedAt: Date.UTC(2026, 9, 2), mine: false },
    };
    renderGm();
    const box = screen.getByRole("region", { name: "Lorekeeper limits" });
    expect(box).toHaveTextContent("Request sent 3 Nov · waiting for an answer");
    expect(box).toHaveTextContent("Last request declined 2 Oct");
    expect(within(box).queryByRole("button", { name: "Ask for higher limits" })).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Withdraw" }));
    expect(callsOf("lorekeeperLimitRequests:cancel")).toEqual([{ campaignId: "c-umbra", requestId: "r2" }]);
    expect(within(box).getByRole("button", { name: "Ask for higher limits" })).toBeInTheDocument();
  });
});
