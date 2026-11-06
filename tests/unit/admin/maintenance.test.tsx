// Plan config AU5: the App admin Maintenance tab (design reference/designs/config/Admin.dc.html `.s-maint`) and the
// read-only banner. Mode switch + banner message (single intents with an optimistic update of appStatus.get), the
// backups link (no fake time), Export -> status -> Download (token in a header, never in the URL), keys as Set /
// Missing / Connected only, and READ_ONLY_MODE carrying the banner message in errorMessage.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };
type Call = { name: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  calls: [] as Call[],
  optimistic: {} as Record<string, (store: Store, args: Record<string, unknown>) => void>,
  reject: null as unknown,
  token: "owner-token" as string | null,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => state.queries[getFunctionName(ref as never)],
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (state.reject) throw state.reject;
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: Store, args: Record<string, unknown>) => void) => {
        state.optimistic[name] = fn;
        return run;
      },
    });
  },
}));

vi.mock("@convex-dev/auth/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken: async () => state.token }),
}));

process.env.NEXT_PUBLIC_CONVEX_URL = "https://happy-otter-123.convex.cloud";

const { MaintenanceTab, READ_ONLY_MESSAGE_MAX, MAINTENANCE_TEXT } = await import("@/components/admin/maintenance");
const { exportDownloadUrl, exportFilename, EXPORT_FALLBACK_NAME } = await import("@/components/admin/maintenance/download");
const { ReadOnlyBanner, READ_ONLY_BANNER_DEFAULT } = await import("@/components/read-only-banner");
const { errorMessage } = await import("@/lib/convex-errors");
const server = await import("../../../convex/adminMaintenance");

const KEYS_ALL = { database: true, anthropicKey: true, resendKey: true, mailFrom: true, siteUrl: true, google: true };

function setQueries(overrides: Record<string, unknown> = {}) {
  state.queries = {
    "appStatus:get": null,
    "adminMaintenance:backups": { dashboardUrl: "https://dashboard.convex.dev/d/happy-otter-123/settings/backups", note: "Backups are managed in the Convex dashboard." },
    "adminMaintenance:keys": KEYS_ALL,
    "adminExport:status": null,
    ...overrides,
  };
}

/** A store double for an optimistic update: records what it sets. */
function fakeStore(current: Record<string, unknown> = {}) {
  const set: Record<string, unknown> = {};
  const store: Store = {
    getQuery: (ref) => current[getFunctionName(ref as never)],
    setQuery: (ref, _args, value) => {
      set[getFunctionName(ref as never)] = value;
    },
  };
  return { store, set };
}

const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("section")!;

beforeEach(() => {
  setQueries();
  state.calls = [];
  state.optimistic = {};
  state.reject = null;
  state.token = "owner-token";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Maintenance mode", () => {
  it("shows a loading line while appStatus.get loads", () => {
    setQueries({ "appStatus:get": undefined });
    render(<MaintenanceTab onTab={() => {}} />);
    expect(within(card("Maintenance mode")).getByRole("status")).toHaveTextContent("Loading");
  });

  it("turns read-only on with the typed message (one intent) and the banner query updates at once", () => {
    render(<MaintenanceTab onTab={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Read-only for everyone" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(MAINTENANCE_TEXT.readOnlyHint)).toBeInTheDocument();
    const input = screen.getByLabelText("Banner message");
    expect(input).toHaveAttribute("maxLength", String(READ_ONLY_MESSAGE_MAX));
    fireEvent.change(input, { target: { value: "  Back in ten minutes.  " } });
    // Off: leaving the field saves nothing (the message is a draft until the mode is on).
    fireEvent.blur(input);
    expect(state.calls).toEqual([]);
    fireEvent.click(sw);
    expect(state.calls).toEqual([{ name: "adminMaintenance:setReadOnly", args: { on: true, message: "  Back in ten minutes.  " } }]);

    const { store, set } = fakeStore();
    state.optimistic["adminMaintenance:setReadOnly"]!(store, { on: true, message: "  Back in ten minutes.  " });
    expect(set["appStatus:get"]).toEqual({ readOnly: true, message: "Back in ten minutes." });
    state.optimistic["adminMaintenance:setReadOnly"]!(store, { on: true, message: "   " });
    expect(set["appStatus:get"]).toEqual({ readOnly: true, message: null });
    state.optimistic["adminMaintenance:setReadOnly"]!(store, { on: false });
    expect(set["appStatus:get"]).toBeNull();
  });

  it("while on, saves an edited message on blur or Enter (not an unchanged one) and turns off", () => {
    setQueries({ "appStatus:get": { readOnly: true, message: "Updating." } });
    render(<MaintenanceTab onTab={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Read-only for everyone" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    const input = screen.getByLabelText("Banner message");
    expect(input).toHaveValue("Updating.");
    fireEvent.blur(input);
    expect(state.calls).toEqual([]);
    fireEvent.change(input, { target: { value: "Back at nine." } });
    fireEvent.blur(input);
    fireEvent.submit(input.closest("form")!);
    expect(state.calls).toEqual([
      { name: "adminMaintenance:setReadOnly", args: { on: true, message: "Back at nine." } },
      { name: "adminMaintenance:setReadOnly", args: { on: true, message: "Back at nine." } },
    ]);
    fireEvent.click(sw);
    expect(state.calls.at(-1)).toEqual({ name: "adminMaintenance:setReadOnly", args: { on: false, message: "Back at nine." } });
  });

  it("shows a refused change as an alert", async () => {
    state.reject = new ConvexError({ code: "FORBIDDEN" });
    render(<MaintenanceTab onTab={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Read-only for everyone" }));
    expect(await within(card("Maintenance mode")).findByRole("alert")).toBeInTheDocument();
  });

  it("caps the message at the server's limit", () => {
    expect(READ_ONLY_MESSAGE_MAX).toBe(server.READ_ONLY_MESSAGE_MAX);
  });
});

describe("Backups and export", () => {
  it("links this deployment's dashboard in a new tab, with the note and no backup time", () => {
    render(<MaintenanceTab onTab={() => {}} />);
    const backups = card("Backups");
    const link = within(backups).getByRole("link", { name: "Open the Convex dashboard" });
    expect(link).toHaveAttribute("href", "https://dashboard.convex.dev/d/happy-otter-123/settings/backups");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(backups).getByText("Backups are managed in the Convex dashboard.")).toBeInTheDocument();
    expect(within(backups).queryByText(/Last backup|03:00/)).toBeNull();
  });

  it("says why there is no link off Convex cloud", () => {
    setQueries({ "adminMaintenance:backups": { dashboardUrl: null, note: "Backups are managed in the Convex dashboard." } });
    render(<MaintenanceTab onTab={() => {}} />);
    expect(within(card("Backups")).queryByRole("link")).toBeNull();
    expect(screen.getByText(MAINTENANCE_TEXT.noDashboard)).toBeInTheDocument();
  });

  it("Export starts one export and shows it pending at once", () => {
    render(<MaintenanceTab onTab={() => {}} />);
    expect(screen.getByTestId("export-status")).toHaveTextContent(MAINTENANCE_TEXT.exportHint);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(state.calls).toEqual([{ name: "adminExport:start", args: {} }]);
    const { store, set } = fakeStore({ "adminExport:status": null });
    state.optimistic["adminExport:start"]!(store, {});
    expect(set["adminExport:status"]).toMatchObject({ status: "pending" });
    // Already pending: the optimistic update leaves the server's row alone.
    const pending = fakeStore({ "adminExport:status": { status: "pending" } });
    state.optimistic["adminExport:start"]!(pending.store, {});
    expect(pending.set).toEqual({});
  });

  it("pending: 'Preparing the file', Export disabled; failed: says so and offers Export again", () => {
    setQueries({ "adminExport:status": { exportId: "e1", status: "pending", createdAt: 0, expiresAt: 3_600_000 } });
    const { unmount } = render(<MaintenanceTab onTab={() => {}} />);
    expect(screen.getByTestId("export-status")).toHaveTextContent("Preparing the file");
    expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    unmount();
    setQueries({ "adminExport:status": { exportId: "e1", status: "failed", createdAt: 0, expiresAt: 3_600_000 } });
    render(<MaintenanceTab onTab={() => {}} />);
    expect(screen.getByTestId("export-status")).toHaveTextContent(MAINTENANCE_TEXT.exportFailed);
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("Download fetches with the token in the Authorization header (never the URL) and saves the file", async () => {
    setQueries({ "adminExport:status": { exportId: "e1", status: "ready", createdAt: 0, expiresAt: 3_600_000 } });
    const fetchMock = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "Content-Disposition": 'attachment; filename="dualityheart-export-2026-11-04.json"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<MaintenanceTab onTab={() => {}} />);
    expect(screen.getByTestId("export-status")).toHaveTextContent(/^Ready\. The file is deleted at /);
    expect(screen.getByRole("button", { name: "Export again" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(clicked).toEqual(["dualityheart-export-2026-11-04.json"]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://happy-otter-123.convex.site/admin/export?id=e1");
    expect(url).not.toContain("owner-token");
    expect(init.headers).toEqual({ Authorization: "Bearer owner-token" });
    expect(created).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("a refused download says why", async () => {
    setQueries({ "adminExport:status": { exportId: "e1", status: "ready", createdAt: 0, expiresAt: 3_600_000 } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 })));
    render(<MaintenanceTab onTab={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await within(card("Backups")).findByRole("alert")).toHaveTextContent("That export is gone. Export again.");
  });

  it("download helpers: the URL carries only the id; the file name comes from the header", () => {
    expect(exportDownloadUrl("http://127.0.0.1:3733", "abc")).toBe("http://127.0.0.1:3733/admin/export?id=abc");
    expect(exportFilename('attachment; filename="x.json"')).toBe("x.json");
    expect(exportFilename(null)).toBe(EXPORT_FALLBACK_NAME);
    expect(exportFilename('attachment; filename="../x.json"')).toBe(EXPORT_FALLBACK_NAME);
  });
});

describe("Keys and connections", () => {
  it("shows Set / Connected / Missing only, and the note", () => {
    setQueries({ "adminMaintenance:keys": { ...KEYS_ALL, mailFrom: false, google: false } });
    render(<MaintenanceTab onTab={() => {}} />);
    const keys = card("Keys and connections");
    const row = (label: string) => within(keys).getByText(label, { selector: "b" }).closest(".adm-row") as HTMLElement;
    expect(row("Database")).toHaveTextContent(/Connected$/);
    expect(row("Anthropic API key")).toHaveTextContent(/Set$/);
    expect(row("Email")).toHaveTextContent(/Missing$/);
    expect(row("Site URL")).toHaveTextContent(/Set$/);
    expect(row("Google sign-in")).toHaveTextContent(/Missing$/);
    expect(within(keys).getByText("Keys are never shown or changed here. Change them in the deployment settings.")).toBeInTheDocument();
  });
});

describe("read-only banner", () => {
  it("renders nothing while loading or off", () => {
    state.queries["appStatus:get"] = undefined;
    const { container, rerender } = render(<ReadOnlyBanner />);
    expect(container).toBeEmptyDOMElement();
    state.queries["appStatus:get"] = null;
    rerender(<ReadOnlyBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the owner's message (or the default) and READ_ONLY_MODE errors carry it", () => {
    const refused = new ConvexError({ code: "READ_ONLY_MODE" });
    const base = errorMessage(refused);
    state.queries["appStatus:get"] = { readOnly: true, message: "Back at nine." };
    const { rerender, unmount } = render(<ReadOnlyBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Read-only right now. Back at nine.");
    expect(errorMessage(refused)).toBe(`${base} Back at nine.`);
    // Other codes are untouched.
    expect(errorMessage(new ConvexError({ code: "FORBIDDEN" }))).not.toContain("Back at nine.");

    state.queries["appStatus:get"] = { readOnly: true, message: null };
    rerender(<ReadOnlyBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(READ_ONLY_BANNER_DEFAULT);
    expect(errorMessage(refused)).toBe(base);

    state.queries["appStatus:get"] = { readOnly: true, message: "Again." };
    rerender(<ReadOnlyBanner />);
    act(() => unmount());
    expect(errorMessage(refused)).toBe(base);
  });

  it("a failing query never takes the page down", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(state.queries, "appStatus:get", {
      configurable: true,
      get: () => {
        throw new Error("boom");
      },
    });
    const { container } = render(<ReadOnlyBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
