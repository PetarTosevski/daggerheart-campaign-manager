// Plan config AU7 (Q27 b, N1 changed): the app owner's read-only view in the campaign pages. With `campaigns.get`
// answering `ownerView: true` the shell shows the banner (role=status), hides the gear and the Players button (art
// header and Combat Map bar), never calls markOpened, mounts no ConfigMounts (so no presence heartbeat, no settings
// panel), hides Start Session and keeps the clock read-only; a write that slips through reads as OWNER_VIEW_READ_ONLY.
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";

const CAMPAIGN = "c1" as Id<"campaigns">;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const results: Record<string, unknown> = {};
const mutations: string[] = [];
let pathname = `/campaigns/${CAMPAIGN}`;

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[functionName(ref)]),
  usePreloadedQuery: () => results["campaigns:get"],
  useMutation: (ref: unknown) =>
    Object.assign(
      () => {
        mutations.push(functionName(ref));
        return Promise.resolve(null);
      },
      { withOptimisticUpdate() { return this; } },
    ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/app-bar", () => ({
  CampaignNav: () => null,
  CampaignSettingsButton: () => <button type="button">Campaign settings</button>,
  PreferencesButton: () => <button type="button">Your preferences</button>,
  CombatAppBarFrame: ({ isGm, settings = true, children }: { isGm: boolean; settings?: boolean; children: React.ReactNode }) => (
    <div data-testid="combat-app-frame">
      {isGm && settings ? <button type="button">Campaign settings</button> : null}
      {children}
    </div>
  ),
}));
vi.mock("@/components/config/shell", () => ({
  ConfigMounts: () => <div data-testid="config-mounts" />,
  openSettings: vi.fn(),
}));
vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-tome", () => ({ CampaignTome: () => null }));
// The Witherwild has the time arc; every other frame the day card. Either stands in as "the clock".
vi.mock("@/app/(gm)/campaigns/[campaignId]/time-arc", () => ({
  TimeArc: ({ readOnly }: { readOnly: boolean }) => <span data-testid="clock" data-read-only={String(readOnly)} />,
}));
vi.mock("@/app/(gm)/campaigns/[campaignId]/time-of-day", () => ({
  DayCard: ({ readOnly }: { readOnly: boolean }) => <span data-testid="clock" data-read-only={String(readOnly)} />,
}));

const { CampaignShell } = await import("@/app/(gm)/campaigns/[campaignId]/campaign-shell");
const { OWNER_VIEW_BANNER_TEXT, OWNER_VIEW_BANNER_TITLE } = await import("@/components/config/owner-view-banner");
const { ARCHIVED_BANNER_TEXT } = await import("@/components/config/archived-banner");
const { errorMessage } = await import("@/lib/convex-errors");

function summary(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    _id: CAMPAIGN,
    name: "The Witherwild",
    frameId: "witherwild",
    role: "gm",
    isCreator: false,
    archived: false,
    ownerView: false,
    tier: 1,
    level: 1,
    options: {},
    settings: { sessionOpensOn: "journal" },
    ...overrides,
  } as unknown as CampaignSummary;
}

function renderShell() {
  return render(
    <CampaignShell campaignId={CAMPAIGN} preloaded={null}>
      <p>Page body</p>
    </CampaignShell>,
  );
}

const refused = (code: string) => new ConvexError({ code });

beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key];
  mutations.length = 0;
  pathname = `/campaigns/${CAMPAIGN}`;
  results["sessionWrap:dashboard"] = { live: null, dashboardNumber: "No sessions yet", nextDate: null, nextSessionLine: "Next session not scheduled" };
});

afterEach(cleanup);

describe("owner's read-only view (ownerView true)", () => {
  beforeEach(() => {
    results["campaigns:get"] = summary({ ownerView: true });
  });

  it("shows the banner as a status, with no gear, no Players button and no config mounts", () => {
    renderShell();
    const banner = screen.getByTestId("owner-view-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(`${OWNER_VIEW_BANNER_TITLE} · ${OWNER_VIEW_BANNER_TEXT}`);
    expect(banner).toHaveTextContent("Read-only view · You are not in this campaign. Nothing can be changed here.");
    expect(screen.queryByRole("button", { name: "Campaign settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Players" })).toBeNull();
    expect(screen.queryByTestId("config-mounts")).toBeNull();
    expect(screen.getByText("Page body")).toBeInTheDocument();
  });

  it("never records the open", () => {
    renderShell();
    expect(mutations).not.toContain("campaigns:markOpened");
  });

  it("hides Start Session and keeps the clock read-only", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Start Session" })).toBeNull();
    expect(screen.getByTestId("clock")).toHaveAttribute("data-read-only", "true");
  });

  it("has no gear in the Combat Map's app bar either", () => {
    pathname = `/campaigns/${CAMPAIGN}/combat-map`;
    renderShell();
    expect(screen.getByTestId("combat-app-frame")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Campaign settings" })).toBeNull();
    expect(screen.getByTestId("owner-view-banner")).toBeInTheDocument();
  });

  it("carries the archived line in its own banner (no Restore, no second banner)", () => {
    results["campaigns:get"] = summary({ ownerView: true, archived: true });
    renderShell();
    expect(screen.getByTestId("owner-view-banner")).toHaveTextContent(ARCHIVED_BANNER_TEXT);
    expect(screen.queryByTestId("archived-banner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("reads a refused write as OWNER_VIEW_READ_ONLY while open, and as itself once closed", () => {
    const view = renderShell();
    expect(errorMessage(refused("NOT_FOUND"))).toBe("You're viewing this campaign read-only.");
    expect(errorMessage(refused("FORBIDDEN"))).toBe("You're viewing this campaign read-only.");
    expect(errorMessage(refused("OWNER_VIEW_READ_ONLY"))).toBe("You're viewing this campaign read-only.");
    view.unmount();
    expect(errorMessage(refused("NOT_FOUND"))).not.toBe("You're viewing this campaign read-only.");
  });
});

describe("a GM in their own campaign (ownerView false)", () => {
  beforeEach(() => {
    results["campaigns:get"] = summary({ isCreator: true });
  });

  it("keeps the gear, the Players button, Start Session and the config mounts, and records the open; no banner", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Campaign settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Players" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(screen.getByTestId("config-mounts")).toBeInTheDocument();
    expect(screen.getByTestId("clock")).toHaveAttribute("data-read-only", "false");
    expect(screen.queryByTestId("owner-view-banner")).toBeNull();
    expect(mutations).toContain("campaigns:markOpened");
    expect(errorMessage(refused("NOT_FOUND"))).not.toBe("You're viewing this campaign read-only.");
  });

  it("keeps the gear in the Combat Map's app bar", () => {
    pathname = `/campaigns/${CAMPAIGN}/combat-map`;
    renderShell();
    expect(screen.getByRole("button", { name: "Campaign settings" })).toBeInTheDocument();
  });
});
