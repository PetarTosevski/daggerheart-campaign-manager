/**
 * The GM's purple variant of H3.0's picking panel and rings (plan combat-hud H5.2; HANDOFF "GM attack picking uses the
 * same pattern in purple"; GMDesktop 'Adversary acting'): a session whose source is an adversary gets `.hud-pk-gm` /
 * `.hud-tg-gm`, out-of-range rows read "Out of range" (the GM needs no approval: no "GM approves", no GM footer line,
 * no GM badge on the ring), and a player's session keeps the approval copy.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudPick, HudPickLayer, PickProvider, usePick, type PickSessionSpec } from "@/components/combat-map/hud/pick";
import { HudProvider } from "@/components/combat-map/hud/state";
import type { CombatPageState, MapLayerProps } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
});

const tok = (s: string) => s as Id<"combatTokens">;
const LT = tok("lt");
const BRANNOC = tok("br");
const MOSS = tok("moss");
const VEX = tok("vex");
const state = { campaignId: "c1", role: "gm", mode: "play", map: { _id: "m1", name: "Forest Camp", live: true }, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
const layer = { ...state, viewport: { cell: 40, zoom: 1, w: 30, h: 20, pad: 0, toSquares: () => ({ x: 0, y: 0 }), showNames: false } } as unknown as MapLayerProps;

function seed() {
  const t = (_id: string, name: string, x: number, side: string) => ({ _id, name, x, y: 10, size: 1, side, kind: side === "enemy" ? "adversary" : "pc", stats: null });
  queries["combatTokens:list"] = [t(LT, "Lieutenant", 14, "enemy"), t(BRANNOC, "Brannoc", 11, "party"), t(MOSS, "Moss", 4, "party"), t(VEX, "Vex", 8, "party")];
}

const gmSpec = (send = vi.fn(async () => ({ kind: "done" as const }))): PickSessionSpec => ({
  id: "gm-attack:in-lt",
  source: { kind: "adversary", name: "Acting for the Lieutenant" },
  rule: { side: "enemy", max: 1, range: "close", text: "Javelin · Close · 1d8+3 phy · +2" },
  actor: { tokenId: LT },
  rows: [
    { tokenId: BRANNOC, name: "Brannoc", side: "enemy", band: "veryClose", reach: "in" },
    { tokenId: MOSS, name: "Moss", side: "enemy", band: "far", reach: "out" },
    { tokenId: VEX, name: "Vex", side: "enemy", band: "close", reach: "los" },
  ],
  primary: { label: (s) => (s.targets[0] ? `Attack ${s.targets[0].name}` : "Attack"), pay: () => "Momentum on a hit", send },
});

function Opener({ spec }: { spec: PickSessionSpec }) {
  const pick = usePick();
  return (
    <button type="button" onClick={() => pick.open(spec)}>
      Open
    </button>
  );
}

function renderPick(spec: PickSessionSpec) {
  render(
    <HudProvider>
      <PickProvider>
        <Opener spec={spec} />
        <div className="hud-map">
          <HudPickLayer {...layer} />
        </div>
        <HudPick state={state} />
      </PickProvider>
    </HudProvider>,
  );
  act(() => fireEvent.click(screen.getByRole("button", { name: "Open" })));
}

describe("the GM's purple picking panel", () => {
  it("purple classes; out of range reads 'Out of range' with no GM approval line or badge", () => {
    seed();
    renderPick(gmSpec());
    const panel = screen.getByTestId("hud-pick");
    expect(panel.className).toContain("hud-pk-gm");
    expect(screen.getByTestId("hud-pick-rule").textContent).toBe("Javelin · Close · 1d8+3 phy · +2");
    const moss = within(panel).getByRole("button", { name: /^Moss/ });
    expect(moss.textContent).toContain("Out of range");
    expect(moss.getAttribute("aria-label")).toBe("Moss, Far, out of range");
    expect(panel.textContent).not.toContain("GM approves");
    act(() => fireEvent.click(moss));
    expect(moss.getAttribute("aria-pressed")).toBe("true");
    expect(moss.textContent).toContain("Out of range");
    expect(screen.getByTestId("hud-pick-pay").textContent).toBe("Momentum on a hit");
    const rings = screen.getAllByTestId("hud-pick-ring");
    expect(rings.every((r) => r.className.includes("hud-tg-gm"))).toBe(true);
    const mossRing = rings.find((r) => r.dataset.token === MOSS)!;
    expect(mossRing.className).toContain("hud-tg-out");
    expect(mossRing.textContent).not.toContain("GM");
    // Out of sight stays unpickable.
    const vex = within(panel).getByRole("button", { name: /^Vex/ });
    expect(vex.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("hud-pick-go").textContent).toBe("Attack Moss");
  });

  it("a non-adversary session keeps the player's approval copy", () => {
    seed();
    const spec = gmSpec();
    renderPick({ ...spec, id: "attack:x", source: { kind: "attack", name: "Shortstaff" } });
    const panel = screen.getByTestId("hud-pick");
    expect(panel.className).not.toContain("hud-pk-gm");
    const moss = within(panel).getByRole("button", { name: /^Moss/ });
    expect(moss.textContent).toContain("GM approves");
    act(() => fireEvent.click(moss));
    expect(screen.getByTestId("hud-pick-pay").textContent).toContain("the GM approves first");
    expect(screen.getAllByTestId("hud-pick-ring").some((r) => r.className.includes("hud-tg-gm"))).toBe(false);
  });
});
