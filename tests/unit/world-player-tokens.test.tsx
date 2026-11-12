/**
 * dcm-yzxx: the players' World map. The marker list selects a marker; the details card is read-only (no field, no
 * checkbox, no select, no Delete or Send party) and shows "Open in Codex" only for a marker `codex.mapLinks` links
 * to a location the viewer may see (Convex mocked).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexLink, codexEntryFor, codexEntryHref, PlayerTokenDetails, PlayerTokenPanel } from "@/app/(gm)/campaigns/[campaignId]/world/player-tokens";
import type { MapToken } from "@/lib/world/map-state";
import { tokenTypes } from "@/lib/world/token-types";

import type { Id } from "../../convex/_generated/dataModel";

let links: unknown = undefined;
let failing = false;
vi.mock("convex/react", () => ({
  useQuery: () => {
    if (failing) throw new Error("boom");
    return links;
  },
}));

afterEach(() => {
  links = undefined;
  failing = false;
});

const campaignId = "c1" as Id<"campaigns">;
const types = tokenTypes({ customTypes: [], typeLabels: {} });
const alula: MapToken = { id: 1, type: "village", x: 40, y: 40, name: "Alula", notes: "", hidden: false, location: true };
const camp: MapToken = { id: 2, type: "camp", x: 60, y: 60, name: "", notes: "", hidden: false, location: false };

describe("PlayerTokenPanel", () => {
  it("lists every marker it is given and selects one on click", () => {
    const onSelect = vi.fn();
    render(<PlayerTokenPanel tokens={[alula, camp]} types={types} selectedId={1} onSelect={onSelect} />);
    const list = screen.getByRole("complementary", { name: "Markers on the map" });
    expect(within(list).getByText("2 markers")).toBeTruthy();
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    expect(buttons[0].textContent).toContain("Alula");
    // An unnamed marker shows its type.
    expect(buttons[1].textContent).toContain(types.find((t) => t.id === "camp")!.label);
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(camp);
  });

  it("says so when nothing is revealed", () => {
    render(<PlayerTokenPanel tokens={[]} types={types} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByText("No markers have been revealed yet.")).toBeTruthy();
  });
});

describe("PlayerTokenDetails", () => {
  it("is read-only: name, type, distances and close, no edit control", () => {
    const onClose = vi.fn();
    render(
      <PlayerTokenDetails token={alula} types={types} fromParty="12 km · ½ day" distances={[{ name: "Camp", text: "3 km" }]} onClose={onClose} />,
    );
    const card = screen.getByRole("region", { name: "About Alula" });
    expect(within(card).getByRole("heading", { name: "Alula" })).toBeTruthy();
    expect(within(card).getByText("12 km · ½ day")).toBeTruthy();
    expect(within(card).getByText("3 km")).toBeTruthy();
    expect(within(card).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(card).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(card).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(card).queryByRole("button", { name: /delete|send party/i })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the linked Codex location", () => {
    links = [{ tokenId: 1, entryId: "e1", known: true }];
    render(
      <PlayerTokenDetails
        token={alula}
        types={types}
        fromParty=""
        distances={[]}
        onClose={() => undefined}
        codexLink={<CodexLink campaignId={campaignId} tokenId={1} knownOnly={false} />}
      />,
    );
    const link = screen.getByRole("link", { name: /open in codex/i });
    expect(link.getAttribute("href")).toBe("/campaigns/c1/codex?entry=e1");
  });

  it("shows no Codex link for an unlinked marker, while loading, or when the query fails", () => {
    links = [{ tokenId: 1, entryId: "e1", known: true }];
    const { rerender } = render(<CodexLink campaignId={campaignId} tokenId={2} knownOnly={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    links = undefined;
    rerender(<CodexLink campaignId={campaignId} tokenId={1} knownOnly={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    failing = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<CodexLink campaignId={campaignId} tokenId={1} knownOnly={false} />);
    spy.mockRestore();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("codexEntryFor", () => {
  const all = [
    { tokenId: 3, entryId: "secret", known: false },
    { tokenId: 3, entryId: "known", known: true },
    { tokenId: 1, entryId: "e1", known: true },
  ];

  it("takes the first link of the marker; the GM's player preview only a known one", () => {
    expect(codexEntryFor(all, 3, false)).toBe("secret");
    expect(codexEntryFor(all, 3, true)).toBe("known");
    expect(codexEntryFor(all, 9, false)).toBeNull();
    expect(codexEntryFor(undefined, 1, false)).toBeNull();
    expect(codexEntryHref("c", "e")).toBe("/campaigns/c/codex?entry=e");
  });
});
