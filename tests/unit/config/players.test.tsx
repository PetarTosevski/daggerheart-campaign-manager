// Plan config U3: Campaign settings, Players (design reference/designs/config/Settings.dc.html `.s-players`). Rows
// (Owner, Co-GM badge, 'plays <character> · <class>'), the '···' menu (Make / Remove co-GM for the creator only,
// Remove from campaign with a confirm), the invite card (link, Copy link + 'Copied', New link, Make a link), email
// invites with 'Invite as' Player / Co-GM for the creator (Q8 b), pending co-GM invites marked; optimistic roster edits.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";

const CAMPAIGN = "c1" as Id<"campaigns">;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const results: Record<string, unknown> = {};
const calls: Record<string, unknown[]> = {};
const optimistic: Record<string, (store: unknown, args: unknown) => void> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const fn = Object.assign(
      (args: unknown) => {
        (calls[name] ??= []).push(args);
        return Promise.resolve(null);
      },
      {
        withOptimisticUpdate: (update: (store: unknown, args: unknown) => void) => {
          optimistic[name] = update;
          return fn;
        },
      },
    );
    return fn;
  },
}));

const { PlayersSection } = await import("@/components/config/sections/players");
const { EmailInvites } = await import("@/components/config/sections/players/invite");
const lib = await import("@/components/config/sections/players/lib");

const ANA = "u-ana" as Id<"users">;
const MARKO = "u-marko" as Id<"users">;

function campaign(isCreator: boolean): CampaignSummary {
  return { _id: CAMPAIGN, name: "The Witherwild", role: "gm", isCreator } as unknown as CampaignSummary;
}

const roster = () => ({
  viewer: "gm" as const,
  gm: { userId: "u-gm", name: "Petar" },
  players: [
    { userId: ANA, name: "Ana", joinedAt: 1, coGm: false, email: "ana@example.com" },
    { userId: MARKO, name: "Marko", joinedAt: 2, coGm: true, email: "marko@example.com" },
  ],
});

beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key];
  for (const key of Object.keys(calls)) delete calls[key];
  results["members:roster"] = roster();
  results["members:access"] = {
    joinCode: "ABCD2345",
    invites: [
      { _id: "i1", email: "iva@example.com", createdAt: 1, asCoGm: false },
      { _id: "i2", email: "luka@example.com", createdAt: 2, asCoGm: true },
    ],
  };
  results["charactersReads:listByCampaign"] = [
    { _id: "ch1", ownerId: ANA, status: "active", sheet: { name: "Moss", classId: "druid", subclassId: "", ancestry: { kind: "single", id: "elf" } }, portraitUrl: null },
  ];
});

const row = (name: string) => screen.getByTestId(`settings-member-${name}`);

describe("helpers", () => {
  it("formats the code and the link", () => {
    expect(lib.formatJoinCode("ABCD2345")).toBe("ABCD-2345");
    expect(lib.joinUrl("https://x.test", "ABCD2345")).toBe("https://x.test/join/ABCD2345");
  });
  it("writes 'plays' lines; retired, dead and corrupt characters are left out", () => {
    const c = (name: string, status = "active", corrupt?: true) => ({ ownerId: "a", status, corrupt, sheet: { name, classId: "warrior" } });
    expect(lib.playsLine("a", [c("Brannoc")])).toBe("plays Brannoc · Warrior");
    expect(lib.playsLine("a", [c("A"), c("B", "away")])).toBe("plays A · Warrior, B · Warrior");
    expect(lib.playsLine("a", [c("A", "retired"), c("B", "dead"), c("C", "active", true)])).toBeNull();
    expect(lib.playsLine("b", [c("A")])).toBeNull();
    expect(lib.playsLine("a", undefined)).toBeNull();
  });
  it("row actions follow Q7 a", () => {
    expect(lib.rowActions(true, { coGm: true })).toEqual({ toggleCoGm: true, remove: true });
    expect(lib.rowActions(true, { coGm: false })).toEqual({ toggleCoGm: true, remove: true });
    expect(lib.rowActions(false, { coGm: false })).toEqual({ toggleCoGm: false, remove: true });
    expect(lib.rowActions(false, { coGm: true })).toEqual({ toggleCoGm: false, remove: false });
  });
});

describe("roster", () => {
  it("shows the owner, co-GMs first with a badge, and what each member plays", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    const list = screen.getByRole("list", { name: "People in this campaign" });
    const items = within(list).getAllByRole("listitem").filter((li) => li.classList.contains("cfg-pl"));
    expect(items.map((li) => li.querySelector("b")?.textContent)).toEqual(["You", "Marko", "Ana"]);
    expect(within(items[0]).getByText("Owner")).toBeTruthy();
    expect(within(row("Marko")).getByText("Co-GM")).toBeTruthy();
    expect(within(row("Ana")).getByText("plays Moss · Druid")).toBeTruthy();
    expect(within(row("Marko")).getByText("No character yet")).toBeTruthy();
  });

  it("names the creator for a co-GM viewer", () => {
    render(<PlayersSection campaign={campaign(false)} />);
    expect(screen.getByText("Petar")).toBeTruthy();
  });

  it("creator: Make co-GM / Remove co-GM call setCoGm", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    fireEvent.click(within(row("Ana")).getByRole("button", { name: "Options for Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Make co-GM" }));
    fireEvent.click(within(row("Marko")).getByRole("button", { name: "Options for Marko" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove co-GM" }));
    expect(calls["members:setCoGm"]).toEqual([
      { campaignId: CAMPAIGN, userId: ANA, coGm: true },
      { campaignId: CAMPAIGN, userId: MARKO, coGm: false },
    ]);
  });

  it("Remove from campaign asks first, then removes; Cancel backs out", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    fireEvent.click(within(row("Ana")).getByRole("button", { name: "Options for Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from campaign" }));
    const confirm = screen.getByRole("group", { name: "Remove Ana?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls["members:removePlayer"]).toBeUndefined();
    fireEvent.click(within(row("Ana")).getByRole("button", { name: "Options for Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from campaign" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Remove Ana?" })).getByRole("button", { name: "Remove" }));
    expect(calls["members:removePlayer"]).toEqual([{ campaignId: CAMPAIGN, userId: ANA }]);
  });

  it("co-GM: no co-GM items; removes players only", () => {
    render(<PlayersSection campaign={campaign(false)} />);
    expect(within(row("Marko")).queryByRole("button", { name: "Options for Marko" })).toBeNull();
    fireEvent.click(within(row("Ana")).getByRole("button", { name: "Options for Ana" }));
    expect(screen.queryByRole("button", { name: "Make co-GM" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove co-GM" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove from campaign" })).toBeTruthy();
  });

  it("Escape closes the menu", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    const toggle = within(row("Ana")).getByRole("button", { name: "Options for Ana" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("optimistic updates patch the live roster", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    let stored = roster();
    const store = { getQuery: () => stored, setQuery: (_r: unknown, _a: unknown, value: typeof stored) => (stored = value) };
    optimistic["members:setCoGm"](store, { campaignId: CAMPAIGN, userId: ANA, coGm: true });
    expect(stored.players.find((p) => p.userId === ANA)?.coGm).toBe(true);
    optimistic["members:removePlayer"](store, { campaignId: CAMPAIGN, userId: MARKO });
    expect(stored.players.map((p) => p.userId)).toEqual([ANA]);
  });

  it("shows a loading line while the roster loads", () => {
    delete results["members:roster"];
    render(<PlayersSection campaign={campaign(true)} />);
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Loading …")).toBe(true);
  });
});

describe("invite card", () => {
  it("shows the link, copies it with a 'Copied' status, and rotates it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PlayersSection campaign={campaign(false)} />);
    expect(screen.getByText("Anyone with the link can join this campaign as a player.")).toBeTruthy();
    expect(screen.getByTestId("settings-join-link").textContent).toBe(`${window.location.origin}/join/ABCD2345`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/ABCD2345`);
    expect(screen.getByText("Copied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(calls["members:rotateJoinCode"]).toEqual([{ campaignId: CAMPAIGN, replace: true }]);
  });

  it("offers 'Make a link' when there is no code (a click, not an effect)", () => {
    results["members:access"] = { joinCode: null, invites: [] };
    render(<PlayersSection campaign={campaign(true)} />);
    expect(calls["members:rotateJoinCode"]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Make a link" }));
    expect(calls["members:rotateJoinCode"]).toEqual([{ campaignId: CAMPAIGN }]);
  });
});

describe("email invites", () => {
  it("the creator picks Player / Co-GM; pending co-GM invites are marked", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    const group = screen.getByRole("group", { name: "Invite as" });
    expect(within(group).getByRole("button", { name: "Player" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Co-GM" }));
    fireEvent.change(screen.getByLabelText("Player email"), { target: { value: "new@example.com" } });
    fireEvent.submit(screen.getByLabelText("Player email").closest("form")!);
    expect(calls["members:invite"]).toEqual([{ campaignId: CAMPAIGN, email: "new@example.com", asCoGm: true }]);
    const pending = screen.getByRole("list", { name: "Pending invites" });
    const luka = within(pending).getByText(/luka@example.com/).closest("li")!;
    expect(within(luka).getByText("Co-GM")).toBeTruthy();
    const iva = within(pending).getByText(/iva@example.com/).closest("li")!;
    expect(within(iva).queryByText("Co-GM")).toBeNull();
    fireEvent.click(within(iva).getByRole("button", { name: "Revoke invite for iva@example.com" }));
    expect(calls["members:revokeInvite"]).toEqual([{ inviteId: "i1" }]);
  });

  it("a co-GM (and the Players dialog) invites players only", () => {
    render(<PlayersSection campaign={campaign(false)} />);
    expect(screen.queryByRole("group", { name: "Invite as" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Player email"), { target: { value: "p@example.com" } });
    fireEvent.submit(screen.getByLabelText("Player email").closest("form")!);
    expect(calls["members:invite"]).toEqual([{ campaignId: CAMPAIGN, email: "p@example.com" }]);
  });

  it("a co-GM sees no Revoke on a pending co-GM invite, only on player invites (dcm-0jdy)", () => {
    render(<PlayersSection campaign={campaign(false)} />);
    const pending = screen.getByRole("list", { name: "Pending invites" });
    const luka = within(pending).getByText(/luka@example.com/).closest("li")!;
    expect(within(luka).getByText("Co-GM")).toBeTruthy();
    expect(within(luka).queryByRole("button", { name: /Revoke/ })).toBeNull();
    const iva = within(pending).getByText(/iva@example.com/).closest("li")!;
    fireEvent.click(within(iva).getByRole("button", { name: "Revoke invite for iva@example.com" }));
    expect(calls["members:revokeInvite"]).toEqual([{ inviteId: "i1" }]);
  });

  it("the creator sees Revoke on a pending co-GM invite", () => {
    render(<PlayersSection campaign={campaign(true)} />);
    const luka = screen.getByText(/luka@example.com/).closest("li")!;
    fireEvent.click(within(luka).getByRole("button", { name: "Revoke invite for luka@example.com" }));
    expect(calls["members:revokeInvite"]).toEqual([{ inviteId: "i2" }]);
  });

  it("standalone (the dialog's import) keeps the dialog's labels", () => {
    render(<EmailInvites campaignId={CAMPAIGN} />);
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.getByText(/iva@example.com/).textContent).toContain("iva@example.com · invited");
  });
});
