// Plan config AU6: the App admin link in the Preferences popover (design reference/designs/config/Settings.dc.html,
// `.pm-adm`). It reads appAdmin.me and shows 'App admin · Limits, costs and feature switches · only you', linking to
// /admin, only when the caller is the app owner; nothing while loading, when signed out or for anyone else.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppAdminLink } from "@/components/config/prefs/admin-link";

import type { Id } from "../../../convex/_generated/dataModel";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
let me: { isOwner: boolean } | null | undefined;
const asked: string[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    asked.push(functionName(ref));
    return me;
  },
}));

const C1 = "c1" as Id<"campaigns">;

beforeEach(() => {
  me = undefined;
  asked.length = 0;
});

describe("AppAdminLink", () => {
  it("shows the owner the App admin link to /admin", () => {
    me = { isOwner: true };
    render(<AppAdminLink campaignId={C1} isGm />);
    const link = screen.getByRole("link", { name: /App admin/ });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(link.textContent).toContain("Limits, costs and feature switches · only you");
    expect(link.className).toContain("gb");
    expect(asked).toContain("appAdmin:me");
  });

  it("shows nothing to a signed-in user who is not the owner, GM or player", () => {
    me = { isOwner: false };
    const gm = render(<AppAdminLink campaignId={C1} isGm />);
    expect(gm.container.innerHTML).toBe("");
    gm.unmount();
    const player = render(<AppAdminLink campaignId={C1} isGm={false} />);
    expect(player.container.innerHTML).toBe("");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing while appAdmin.me loads", () => {
    me = undefined;
    const { container } = render(<AppAdminLink campaignId={C1} isGm />);
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when signed out", () => {
    me = null;
    const { container } = render(<AppAdminLink campaignId={C1} isGm={false} />);
    expect(container.innerHTML).toBe("");
  });
});
