/**
 * DA7 (plan drawer-answers; docs/tasks/TASK-DA-DA7.md): the drawer's feature list for the `active` state. While Rogue's
 * Dodge's +2 holds (CB p.42, user 2026-10-30) its row shows an "Active" banner with when it comes back and its Use is
 * disabled; once the bonus ends the row is ready again. Convex and the Use flow (SD7) are mocked.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FeatureList } from "@/components/combat-map/drawer/list";
import type { Drawer, DrawerFeature, DrawerUse } from "@/components/combat-map/drawer/list/model";

import type { Id } from "../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

vi.mock("@/components/combat-map/drawer/use", () => ({ FeatureUse: () => null }));

const BACK = "Until an attack succeeds against you, or your next rest";

const drawerUse = (over: Partial<DrawerUse> = {}): DrawerUse => ({
  useId: "main",
  name: "Rogue’s Dodge",
  activation: "action",
  ready: true,
  resetLabel: null,
  usesLeft: null,
  rolls: false,
  targets: null,
  choices: [],
  costs: ["3 Hope"],
  limit: null,
  repeatable: false,
  situations: [],
  ...over,
});

const dodge = (over: Partial<DrawerFeature> = {}): DrawerFeature => ({
  featureId: "hope:rogue",
  source: "hope",
  owner: "rogue",
  name: "Rogue’s Dodge",
  text: "Spend 3 Hope for +2 Evasion.",
  card: null,
  multiclass: false,
  usage: "combat",
  how: "action",
  automated: true,
  state: "ready",
  resetLabel: null,
  tokens: 0,
  upgrades: [],
  uses: [drawerUse()],
  ...over,
});

const drawer = (features: DrawerFeature[]): Drawer => ({
  characterId: "ch" as Id<"characters">,
  name: "Vex",
  trackers: { hp: { marked: 0, max: 6 }, stress: { marked: 0, max: 6 }, hope: { value: 3, max: 6 }, armor: { marked: 0, max: 3 } },
  flying: false,
  canFly: false,
  martial: null,
  counters: [],
  heldDice: [],
  features,
});

function renderList(features: DrawerFeature[], canAct = true) {
  return render(<FeatureList campaignId={"c" as Id<"campaigns">} role="player" map={null} characterId={"ch" as Id<"characters">} drawer={drawer(features)} canAct={canAct} />);
}

const row = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-feature="hope:rogue"]')!;

describe("drawer list: Active features (DA7)", () => {
  it("Rogue's Dodge while its +2 holds: an Active banner with when it comes back, Use disabled", () => {
    const { container } = renderList([dodge({ state: "active", resetLabel: BACK, uses: [drawerUse({ ready: false, resetLabel: BACK })] })]);
    const item = row(container);
    expect(item.dataset.state).toBe("active");
    const banner = within(item).getByTestId("sheet-drawer-active");
    expect(banner).toHaveTextContent("Active");
    expect(banner).toHaveTextContent(`${BACK}.`);
    expect(within(item).getByRole("button", { name: "Use Rogue’s Dodge" })).toBeDisabled();
    // No "Used" badge: it is not exhausted, it is holding.
    expect(within(item).queryByText(/^Used/)).toBeNull();
  });

  it("once the bonus ends the row is ready: no banner, Use enabled", () => {
    const { container } = renderList([dodge()]);
    const item = row(container);
    expect(within(item).queryByTestId("sheet-drawer-active")).toBeNull();
    expect(within(item).getByRole("button", { name: "Use Rogue’s Dodge" })).toBeEnabled();
  });

  it("the GM's greyed view keeps the banner and the disabled Use", () => {
    renderList([dodge({ state: "active", resetLabel: BACK, uses: [drawerUse({ ready: false, resetLabel: BACK })] })], false);
    expect(screen.getByTestId("sheet-drawer-active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Rogue’s Dodge" })).toBeDisabled();
  });
});
