// Plan config AU8: Campaign settings > Lorekeeper, the GM's own books (server LB1's campaignBooks). Each own book is
// the board's 'Uploaded by you' row with '<pages> pages · This campaign only' and the Indexed / Off switch; a book being
// read says 'Reading the book…' and cannot be removed; a failed read says so; Remove asks first and is optimistic;
// 'Upload a book' checks the file, title and first printed page, uploads with progress, then calls add (a refusal
// shows inline). The shared 'Sources it may search' list leaves campaign books to these rows.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLE_SETTING_DEFAULTS } from "@/lib/config/campaign-settings";

import type { CampaignBooks } from "../../../convex/campaignBooks";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";
import type { Library } from "../../../convex/lorekeeperLibrary";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
const calls: { name: string; args: Record<string, unknown> }[] = [];
const results = new Map<string, unknown>();

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
      update?.(fake, args);
      return results.get(name) ?? null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (s: unknown, args: Record<string, unknown>) => void) => {
        update = fn;
        return run;
      },
    });
  },
}));

const uploads: { url: string; file: File }[] = [];
vi.mock("@/components/admin/lorekeeper/upload", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/admin/lorekeeper/upload")>();
  return {
    ...original,
    uploadWithProgress: async (url: string, file: File, onProgress: (share: number) => void) => {
      uploads.push({ url, file });
      onProgress(0.5);
      return "storage-1";
    },
  };
});

const { LorekeeperCampaignBooks } = await import("@/components/config/sections/lorekeeper/books");
const { LorekeeperSection } = await import("@/components/config/sections/lorekeeper");
const { BOOKS_TEXT } = await import("@/components/config/sections/lorekeeper/books/text");

const C1 = "c1" as Id<"campaigns">;
const GET = `campaigns:get:${JSON.stringify({ campaignId: C1 })}`;
const LIBRARY = `lorekeeperLibrary:list:${JSON.stringify({ campaignId: C1 })}`;
const OWN = `campaignBooks:list:${JSON.stringify({ campaignId: C1 })}`;
const CORE = "b-core" as Id<"lorekeeperBooks">;
const READY = "b-ready" as Id<"lorekeeperBooks">;
const READING = "b-reading" as Id<"lorekeeperBooks">;
const BROKEN = "b-broken" as Id<"lorekeeperBooks">;

function ownBook(bookId: Id<"lorekeeperBooks">, title: string, status: "reading" | "ready" | "failed", pages: number) {
  return { bookId, title, status, pages, chunkCount: pages, sizeBytes: 1000, firstPrintedPage: 1, uploadedAt: 1 };
}
function libBook(bookId: Id<"lorekeeperBooks">, key: string, title: string, enabled: boolean) {
  return { bookId, key, title, subtitle: "", cover: "core", pages: 10, chunkCount: 5, enabled };
}

function Books() {
  useVersion();
  return <LorekeeperCampaignBooks campaign={store.get(GET) as CampaignSummary} />;
}
function Section() {
  useVersion();
  return <LorekeeperSection campaign={store.get(GET) as CampaignSummary} />;
}

const own = () => store.get(OWN) as CampaignBooks;
const named = (name: string) => calls.filter((c) => c.name === name);

beforeEach(() => {
  store.clear();
  calls.length = 0;
  uploads.length = 0;
  results.clear();
  store.set(GET, { _id: C1, name: "The Witherwild", role: "gm", settings: { ...TABLE_SETTING_DEFAULTS } } as unknown as CampaignSummary);
  store.set(LIBRARY, {
    books: [
      libBook(CORE, "core", "Daggerheart Core Rulebook", true),
      libBook(READY, `campaign:${C1}:1`, "Harbour Almanac", true),
      libBook(READING, `campaign:${C1}:2`, "Tide Tables", true),
    ],
    indexedCount: 3,
  } satisfies Library);
  store.set(OWN, {
    books: [ownBook(READY, "Harbour Almanac", "ready", 42), ownBook(READING, "Tide Tables", "reading", 0), ownBook(BROKEN, "Scanned Atlas", "failed", 0)],
    failures: [{ title: "Old Map", finishedAt: 5, code: "BOOK_PARSE_FAILED" }],
  } satisfies CampaignBooks);
});

describe("Campaign settings > Lorekeeper: the GM's own books", () => {
  it("shows each own book's row: pages, This campaign only, the pill and switch, reading and failed states", () => {
    render(<Books />);
    expect(screen.getByText("Uploaded by you · 42 pages · This campaign only")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Harbour Almanac" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(BOOKS_TEXT.indexed)).toBeInTheDocument();
    // Being read: the status line, no switch, Remove disabled (the server refuses BOOK_INGEST_RUNNING).
    expect(screen.getByRole("status")).toHaveTextContent(BOOKS_TEXT.reading);
    expect(screen.queryByRole("switch", { name: "Tide Tables" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove: Tide Tables" })).toBeDisabled();
    // A read that stopped, and an upload whose PDF could not be read.
    expect(screen.getByText(`${BOOKS_TEXT.failed} · ${BOOKS_TEXT.failedHint}`)).toBeInTheDocument();
    expect(screen.getByText(BOOKS_TEXT.lastFailed("Old Map"))).toBeInTheDocument();
    expect(screen.getByText("The text of that PDF couldn't be read.")).toBeInTheDocument();
    // N6 b: the size limits and no count limit.
    expect(screen.getByText("PDF · Up to 20 MB and 300 pages")).toBeInTheDocument();
    expect(screen.getByText("3 books uploaded · No limit on the number of books")).toBeInTheDocument();
  });

  it("switches a book off with one intent and an optimistic pill", () => {
    render(<Books />);
    fireEvent.click(screen.getByRole("switch", { name: "Harbour Almanac" }));
    expect(named("lorekeeperLibrary:setEnabled")).toEqual([{ name: "lorekeeperLibrary:setEnabled", args: { campaignId: C1, bookId: READY, enabled: false } }]);
    expect(screen.getByRole("switch", { name: "Harbour Almanac" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(BOOKS_TEXT.off)).toBeInTheDocument();
  });

  it("asks before removing; Cancel keeps the book, Remove takes it away at once", () => {
    render(<Books />);
    fireEvent.click(screen.getByRole("button", { name: "Remove: Harbour Almanac" }));
    const confirm = screen.getByRole("group", { name: "Remove Harbour Almanac?" });
    fireEvent.click(within(confirm).getByRole("button", { name: BOOKS_TEXT.cancel }));
    expect(named("campaignBooks:remove")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove: Harbour Almanac" }));
    const again = screen.getByRole("group", { name: "Remove Harbour Almanac?" });
    expect(within(again).getByRole("button", { name: BOOKS_TEXT.remove }).className).toContain("gb-danger");
    fireEvent.click(within(again).getByRole("button", { name: BOOKS_TEXT.remove }));
    expect(named("campaignBooks:remove")).toEqual([{ name: "campaignBooks:remove", args: { campaignId: C1, bookId: READY } }]);
    expect(screen.queryByText("Harbour Almanac")).toBeNull();
    expect(own().books.map((b) => b.bookId)).toEqual([READING, BROKEN]);
    expect((store.get(LIBRARY) as Library).books.map((b) => b.bookId)).toEqual([CORE, READING]);
  });

  it("checks the file, title and first page, then uploads and starts the read", async () => {
    results.set("campaignBooks:uploadUrl", "https://upload.example/1");
    results.set("campaignBooks:add", { ok: true, bookId: "b-new" });
    render(<Books />);
    fireEvent.click(screen.getByRole("button", { name: BOOKS_TEXT.upload }));
    const form = screen.getByRole("form", { name: BOOKS_TEXT.upload });
    const fileInput = within(form).getByLabelText(BOOKS_TEXT.file);

    fireEvent.change(fileInput, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent("Books must be PDF files.");

    fireEvent.change(fileInput, { target: { files: [new File(["%PDF-"], "Harbour_Guide.pdf", { type: "application/pdf" })] } });
    fireEvent.change(within(form).getByLabelText(BOOKS_TEXT.title), { target: { value: "" } });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(BOOKS_TEXT.needTitle);

    fireEvent.change(within(form).getByLabelText(BOOKS_TEXT.title), { target: { value: "Harbour Guide" } });
    fireEvent.change(within(form).getByLabelText(BOOKS_TEXT.firstPage), { target: { value: "eleven" } });
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(BOOKS_TEXT.badPage);
    expect(calls).toEqual([]);

    fireEvent.change(within(form).getByLabelText(BOOKS_TEXT.firstPage), { target: { value: "11" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("form", { name: BOOKS_TEXT.upload })).toBeNull());
    expect(named("campaignBooks:uploadUrl")).toEqual([{ name: "campaignBooks:uploadUrl", args: { campaignId: C1 } }]);
    expect(uploads.map((u) => [u.url, u.file.name])).toEqual([["https://upload.example/1", "Harbour_Guide.pdf"]]);
    expect(named("campaignBooks:add")).toEqual([
      { name: "campaignBooks:add", args: { campaignId: C1, storageId: "storage-1", title: "Harbour Guide", firstPrintedPage: 11 } },
    ]);
  });

  it("suggests the title from the file name and shows the server's refusal inline", async () => {
    results.set("campaignBooks:uploadUrl", "https://upload.example/2");
    results.set("campaignBooks:add", { ok: false, code: "BOOK_TOO_LARGE" });
    render(<Books />);
    fireEvent.click(screen.getByRole("button", { name: BOOKS_TEXT.upload }));
    const form = screen.getByRole("form", { name: BOOKS_TEXT.upload });
    fireEvent.change(within(form).getByLabelText(BOOKS_TEXT.file), {
      target: { files: [new File(["%PDF-"], "Sea_Lore.pdf", { type: "application/pdf" })] },
    });
    expect(within(form).getByLabelText(BOOKS_TEXT.title)).toHaveValue("Sea Lore");
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent("That book is too large. Books can be up to 20 MB and 300 pages.");
    expect(named("campaignBooks:add")[0]?.args).toMatchObject({ title: "Sea Lore", firstPrintedPage: 1 });
  });

  it("keeps campaign books out of the shared 'Sources it may search' rows", () => {
    render(<Section />);
    // One switch per book: the campaign book's switch is its own row's, not a second one in the shared list.
    expect(screen.getAllByRole("switch", { name: "Harbour Almanac" })).toHaveLength(1);
    expect(screen.getByTestId("settings-lorekeeper-books")).toContainElement(screen.getByRole("switch", { name: "Harbour Almanac" }));
    expect(screen.getByRole("switch", { name: "Daggerheart Core Rulebook" })).toBeInTheDocument();
  });
});
