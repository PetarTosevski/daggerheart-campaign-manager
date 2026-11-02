/**
 * The GM's adversary stat block and attack picker (plan combat-hud H5.2; docs/tasks/TASK-HUD-H5.2.md; GMDesktop
 * 'Adversary acting'): the parchment block (motives, Difficulty / Thresholds / Attack, HP / Stress "n of N marked" with
 * intent steppers, weapon and Experience, conditions with 'End · 1 Fear', features with kind, Fear cost and Use), the
 * Spotlight button (FearConfirm when it costs, then the tracker's spotlight and combatSpotlight.gmTake), and Attack
 * opening the purple pick session "Acting for the …" whose send asks FearConfirm on `confirmFear` and sends again with
 * spendFear (answer 6a). Convex is mocked; FearConfirm (H5.3) is a stub.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickProvider, usePick, type PickApi } from "@/components/combat-map/hud/pick";
import { useFearAsk, useGmActs } from "@/components/combat-map/hud/statblock/acts";
import {
  actionSpotlightCost,
  attackFooter,
  attackLabel,
  attackLine,
  conditionChips,
  featureUsable,
  fearReasons,
  gmAttackRows,
  pickedExperience,
  spotlightButtonText,
  spotlightCost,
  thresholdsText,
} from "@/components/combat-map/hud/statblock/model";
import { StatBlockPanel } from "@/components/combat-map/hud/statblock/panel";
import { HudProvider } from "@/components/combat-map/hud/state";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
/** Answers per mutation, in order (default null). */
const answers: Record<string, unknown[]> = {};
const updaters: Record<string, (store: unknown, args: unknown) => void> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return answers[name]?.shift() ?? null;
    };
    const withUpdate = (fn: (store: unknown, args: unknown) => void) => {
      updaters[name] = fn;
      return run;
    };
    return Object.assign(run, { withOptimisticUpdate: withUpdate });
  },
}));

vi.mock("@/components/combat-map/hud/statblock/fear-confirm", () => ({
  FearConfirm: ({ amount, reasons, onConfirm, onCancel }: { amount: number; reasons: readonly string[]; onConfirm: () => void; onCancel?: () => void }) => (
    <div data-testid="fear-confirm" data-amount={amount}>
      <span>{reasons.join(" | ")}</span>
      <button type="button" onClick={onConfirm}>
        Yes spend
      </button>
      <button type="button" onClick={() => onCancel?.()}>
        No keep
      </button>
    </div>
  ),
}));
vi.mock("@/components/combat-map/actions/adversary/sight", () => ({ useLiveSight: () => null }));
vi.mock("@/components/adversaries/tracker/actions/feature-use", () => ({
  FeatureUse: ({ feature, onUse, disabled }: { feature: string; onUse: (ask: unknown) => void; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onUse(featureAsks[feature] ?? null)}>
      Use {feature}
    </button>
  ),
}));
vi.mock("@/components/adversaries/tracker/actions/choices", () => ({ FeatureChoices: () => <div data-testid="classic-choices" /> }));
vi.mock("@/components/adversaries/tracker/actions/result", () => ({
  ActionResultView: ({ shown }: { shown: { label: string } }) => <div data-testid="action-result">{shown.label}</div>,
}));

const featureAsks: Record<string, unknown> = {};

afterEach(() => {
  for (const o of [queries, answers, updaters, featureAsks]) for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  calls.length = 0;
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];
const LT = "tk-lt" as Id<"combatTokens">;
const LT_INSTANCE = "in-lt";
const ENC = "enc1";

function pageState(): CombatPageState {
  return { campaignId: CAMPAIGN, role: "gm", mode: "play", map: MAP, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} };
}

function token(id: string, kind: "pc" | "adversary", name: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return { _id: id, kind, name, side: kind === "pc" ? "party" : "enemy", x, y, size: 1, face: 0, sub: "", portrait: null, canMove: true, mine: false, stats: null, ...extra };
}

function instance(over: Record<string, unknown> = {}) {
  return {
    _id: LT_INSTANCE,
    _creationTime: 0,
    campaignId: CAMPAIGN,
    encounterId: ENC,
    source: { kind: "srd", adversaryId: "jagged-knife-lieutenant" },
    label: "Jagged Knife Lieutenant",
    order: 0,
    summoned: false,
    stats: { difficulty: 13, major: 7, severe: 14, hpMax: 6, stressMax: 3 },
    hp: 2,
    stress: 1,
    defeated: false,
    conditions: ["vulnerable"],
    tags: [],
    spotlights: 0,
    spotlightTurn: 1,
    updatedAt: 0,
    name: "Jagged Knife Lieutenant",
    type: "Leader",
    tier: 1,
    ...over,
  };
}

/** The scene: the Lieutenant at (14, 10); Brannoc Very Close (11, 10), Moss Far (4, 10). */
function seed({ spotlitOther = false, fear = 5 } = {}) {
  queries["combatTokens:list"] = [
    token(LT, "adversary", "Jagged Knife Lieutenant", 14, 10, { instanceId: LT_INSTANCE }),
    token("tk-br", "pc", "Brannoc", 11, 10, { characterId: "ch-br" }),
    token("tk-moss", "pc", "Moss", 4, 10, { characterId: "ch-moss", stats: { conditions: ["vulnerable"] } }),
  ];
  queries["encounters:list"] = { active: [{ _id: ENC, status: "running", name: "Camp" }], ended: [], moreEnded: false };
  const other = instance({ _id: "in-b", label: "Bandit", spotlights: spotlitOther ? 1 : 0, conditions: [] });
  queries["encounters:get"] = { encounter: { _id: ENC, gmTurn: 1 }, instances: [instance(), other] };
  queries["campaigns:fear"] = fear;
  queries["combatEffects:fearEnds"] = [{ effectId: "eff-v", label: "Vulnerable", source: "Coup", fear: 1 }];
}

const probe: { api: PickApi | null } = { api: null };
function PickProbe() {
  const api = usePick();
  useLayoutEffect(() => {
    probe.api = api;
  });
  return null;
}

function Harness({ children }: { children?: ReactNode }) {
  const fear = useFearAsk();
  const acts = useGmActs(CAMPAIGN, fear.ask);
  return (
    <>
      <StatBlockPanel state={pageState()} tokenId={LT} acts={acts} ask={fear.ask} onClose={() => {}} />
      {fear.node}
      {children}
    </>
  );
}

function renderBlock() {
  return render(
    <HudProvider>
      <PickProvider>
        <Harness>
          <PickProbe />
        </Harness>
      </PickProvider>
    </HudProvider>,
  );
}

const flush = () => act(async () => {});

describe("the stat block", () => {
  it("shows the block on parchment: motives, tiles, marks, weapon, Experience, conditions, features", () => {
    seed();
    renderBlock();
    const panel = screen.getByRole("complementary", { name: "Jagged Knife Lieutenant’s stat block" });
    expect(panel.tagName).toBe("ASIDE");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(panel).getByText("Tier 1 Leader")).toBeTruthy();
    expect(within(panel).getByText(/Bully, command, profit, reinforce/)).toBeTruthy();
    const body = screen.getByTestId("hud-statblock-body");
    expect(body.textContent).toContain("13Difficulty");
    expect(body.textContent).toContain("7/14Thresholds");
    expect(body.textContent).toContain("+2Attack");
    const trk = screen.getByTestId("hud-statblock-trackers");
    expect(within(trk).getByRole("img", { name: "2 of 6 Hit Points marked" })).toBeTruthy();
    expect(within(trk).getByRole("img", { name: "1 of 3 Stress marked" })).toBeTruthy();
    expect(trk.textContent).toContain("2 of 6 marked");
    expect(screen.getByTestId("hud-statblock-weapon").textContent).toBe("JavelinClose · 1d8+3 phyLocal Knowledge +2");
    // The condition with its Fear end.
    expect(screen.getByRole("button", { name: "End Vulnerable · 1 Fear" }).textContent).toBe("End · 1 Fear");
    // Features: kind, Fear cost, Use; Momentum is automatic (no Use).
    expect(screen.getByRole("img", { name: "1 Fear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Coup de Grace" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use Momentum" })).toBeNull();
    expect(screen.getAllByText("Reaction")).toHaveLength(1);
    // First spotlight of the GM turn: free.
    expect(screen.getByTestId("hud-statblock-spotlight").textContent).toBe("Spotlight");
    expect(screen.getByTestId("hud-statblock-attack").textContent).toBe("Attack");
  });

  it("marks and clears HP and Stress as intents with the tracker's optimistic update", () => {
    seed();
    renderBlock();
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 Hit Point" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear 1 Stress" }));
    expect(calls.map((c) => [c.name, c.args.instanceId, c.args.delta])).toEqual([
      ["encounterTracking:markHp", LT_INSTANCE, 1],
      ["encounterTracking:markStress", LT_INSTANCE, -1],
    ]);
    expect(updaters["encounterTracking:markHp"]).toBeTypeOf("function");
  });

  it("Spotlight · 1 Fear asks FearConfirm, then counts the spotlight and takes the scene spotlight", async () => {
    seed({ spotlitOther: true });
    renderBlock();
    const spot = screen.getByTestId("hud-statblock-spotlight");
    expect(spot.textContent).toBe("Spotlight · 1 Fear");
    // No: nothing sent.
    await act(async () => fireEvent.click(spot));
    expect(screen.getByTestId("fear-confirm").textContent).toContain("1 to spotlight the Jagged Knife Lieutenant");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No keep" })));
    expect(calls).toEqual([]);
    // Yes: the tracker's spotlight, then gmTake.
    answers["encounterTracking:spotlight"] = [{ spotlights: 1, gmTurn: 1, fearSpent: true }];
    await act(async () => fireEvent.click(spot));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes spend" })));
    await flush();
    expect(calls.map((c) => c.name)).toEqual(["encounterTracking:spotlight", "combatSpotlight:gmTake"]);
    expect(screen.queryByTestId("fear-confirm")).toBeNull();
  });

  it("a free spotlight asks nothing; too little Fear disables it with the reason", async () => {
    seed();
    renderBlock();
    answers["encounterTracking:spotlight"] = [{ spotlights: 1, gmTurn: 1, fearSpent: false }];
    await act(async () => fireEvent.click(screen.getByTestId("hud-statblock-spotlight")));
    await flush();
    expect(screen.queryByTestId("fear-confirm")).toBeNull();
    expect(calls.map((c) => c.name)).toEqual(["encounterTracking:spotlight", "combatSpotlight:gmTake"]);
  });

  it("disables a Fear spend the GM can't pay", () => {
    seed({ spotlitOther: true, fear: 0 });
    renderBlock();
    // H6.3: blocked controls stay focusable (aria-disabled, H6.1's layer 1) and say the table's NOT_ENOUGH_FEAR sentence.
    expect(screen.getByTestId("hud-statblock-spotlight").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("hud-statblock-spot-why").textContent).toBe("This needs 1 Fear. You have 0.");
    expect(screen.getByRole("button", { name: "End Vulnerable · 1 Fear" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("End · 1 Fear asks FearConfirm and ends the effect with the cost it showed", async () => {
    seed();
    renderBlock();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "End Vulnerable · 1 Fear" })));
    expect(screen.getByTestId("fear-confirm").dataset.amount).toBe("1");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes spend" })));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("combatEffects:endByFear");
    expect(calls[0]!.args).toMatchObject({ target: { kind: "instance", instanceId: LT_INSTANCE }, effectId: "eff-v", fear: 1 });
  });

  it("Attack opens the purple session; confirmFear asks FearConfirm and sends again with spendFear, then takes the spotlight", async () => {
    seed({ spotlitOther: true });
    renderBlock();
    act(() => fireEvent.click(screen.getByTestId("hud-statblock-attack")));
    const live = probe.api!.session!;
    expect(live.spec.id).toBe(`gm-attack:${LT_INSTANCE}`);
    expect(live.spec.source).toEqual({ kind: "adversary", name: "Acting for the Jagged Knife Lieutenant" });
    expect(live.spec.rule).toMatchObject({ side: "enemy", max: 1, range: "close", text: "Javelin · Close · 1d8+3 phy · +2" });
    expect(live.spec.actor).toEqual({ tokenId: LT });
    expect(live.spec.rows!.map((r) => [r.name, r.band, r.reach, r.side])).toEqual([
      ["Brannoc", "veryClose", "in", "enemy"],
      ["Moss", "far", "out", "enemy"],
    ]);
    expect(live.spec.options!.map((o) => [o.id, o.label, o.cost?.resource])).toEqual([["xp:Local Knowledge", "Use Local Knowledge +2", "fear"]]);
    const brannoc = live.spec.rows![0]!;
    const sel = { targets: [{ ...brannoc, conditions: [] }], targetIds: [brannoc.tokenId], outOfRange: false, options: { "xp:Local Knowledge": true } };
    expect(live.spec.primary.label(sel)).toBe("Attack Brannoc");
    expect(live.spec.primary.pay!(sel)).toBe("Spotlight: 1 Fear · Experience: 1 Fear · Momentum on a hit");
    expect(live.spec.primary.pay!({ ...sel, options: {} })).toBe("Spotlight: 1 Fear · Momentum on a hit");

    answers["adversaryActions:attack"] = [
      { status: "confirmFear", fear: 2, spotlight: 1, feature: 0, experience: 1 },
      { status: "resolved", groupId: "g", entryId: "e", roll: null, success: true, targets: [], fearDelta: 1, prompts: [], offers: [] },
    ];
    let out: unknown;
    await act(async () => {
      const sending = live.spec.primary.send(sel);
      await Promise.resolve();
      await Promise.resolve();
      out = sending;
    });
    expect(screen.getByTestId("fear-confirm").dataset.amount).toBe("2");
    expect(screen.getByTestId("fear-confirm").textContent).toContain("1 to spotlight the Jagged Knife Lieutenant | 1 for Local Knowledge");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes spend" })));
    await expect(out).resolves.toEqual({ kind: "done" });
    const sent = calls.filter((c) => c.name === "adversaryActions:attack");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.args).toMatchObject({ instanceId: LT_INSTANCE, targets: ["ch-br"], experience: "Local Knowledge" });
    expect(sent[0]!.args.spendFear).toBeUndefined();
    expect(sent[1]!.args).toMatchObject({ spendFear: 2, targets: ["ch-br"] });
    expect(sent[0]!.args.idempotencyKey).not.toBe(sent[1]!.args.idempotencyKey);
    expect(calls.at(-1)!.name).toBe("combatSpotlight:gmTake");
    expect(updaters["adversaryActions:attack"]).toBeTypeOf("function");
    expect(screen.getByTestId("action-result").textContent).toBe("Jagged Knife Lieutenant attacks");
  });

  it("No on the Fear question keeps the panel open with nothing rolled", async () => {
    seed({ spotlitOther: true });
    renderBlock();
    act(() => fireEvent.click(screen.getByTestId("hud-statblock-attack")));
    const live = probe.api!.session!;
    const brannoc = live.spec.rows![0]!;
    answers["adversaryActions:attack"] = [{ status: "confirmFear", fear: 1, spotlight: 1, feature: 0, experience: 0 }];
    let out: unknown;
    await act(async () => {
      out = live.spec.primary.send({ targets: [{ ...brannoc, conditions: [] }], targetIds: [brannoc.tokenId], outOfRange: false, options: {} });
      await Promise.resolve();
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "No keep" })));
    await expect(out).resolves.toEqual({ kind: "stay", message: "No Fear spent. Nothing was rolled." });
    expect(calls.filter((c) => c.name === "adversaryActions:attack")).toHaveLength(1);
  });

  it("a feature with PC targets opens the purple panel; one without sends at once", async () => {
    seed();
    featureAsks["Coup de Grace"] = {
      feature: "Coup de Grace",
      useId: "u1",
      uses: [{ id: "u1", activation: "action" }],
      targets: { side: "enemy", count: "one", max: 1, range: "close" },
      picked: null,
      allies: null,
      followUp: null,
      options: [],
      optionals: [],
      situations: [],
      splits: [],
      eitherCosts: [],
      trigger: null,
    };
    renderBlock();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Use Coup de Grace" })));
    expect(probe.api!.session!.spec.id).toBe(`gm-attack:${LT_INSTANCE}:Coup de Grace`);
    expect(probe.api!.session!.spec.source).toEqual({ kind: "adversary", name: "Coup de Grace" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Tactician" })));
    await flush();
    expect(calls.find((c) => c.name === "adversaryActions:useFeature")!.args).toMatchObject({ instanceId: LT_INSTANCE, feature: "Tactician", targets: [] });
  });

  it("says what is missing: loading, no running encounter", () => {
    renderBlock();
    expect(screen.getByRole("status").textContent).toBe("Loading the stat block…");
  });

  it("without a running encounter", () => {
    seed();
    queries["encounters:list"] = { active: [], ended: [], moreEnded: false };
    renderBlock();
    expect(screen.getByText(/No encounter is running/)).toBeTruthy();
  });
});

describe("the stat block model", () => {
  it("lines, thresholds, spotlight costs, footer, labels", () => {
    expect(attackLine({ attack: { name: "Javelin", range: "Close", damage: "1d8+3 phy", modifier: 2 } })).toBe("Javelin · Close · 1d8+3 phy · +2");
    expect(thresholdsText({ major: 7, severe: 14 })).toBe("7/14");
    expect(thresholdsText({ major: null, severe: null })).toBe("None");
    const a = { spotlights: 0, spotlightTurn: 1 };
    const b = { spotlights: 1, spotlightTurn: 1 };
    expect(spotlightCost([a], 1)).toBe(0);
    expect(spotlightCost([a, b], 1)).toBe(1);
    expect(spotlightCost([a, { spotlights: 1, spotlightTurn: 0 }], 1)).toBe(0);
    expect(actionSpotlightCost(b, [b], 1)).toBe(0);
    expect(actionSpotlightCost(a, [a, b], 1)).toBe(1);
    expect(spotlightButtonText(1)).toBe("Spotlight · 1 Fear");
    expect(spotlightButtonText(0)).toBe("Spotlight");
    expect(attackFooter({ spotlightFear: 0, experienceFear: 0, momentum: false })).toBeNull();
    expect(attackLabel([])).toBe("Attack");
    expect(attackLabel(["Brannoc", "Moss"])).toBe("Attack Brannoc and Moss");
    expect(fearReasons({ spotlight: 1, feature: 1, experience: 0 }, "the Lieutenant", "Coup de Grace", null)).toEqual(["1 to spotlight the Lieutenant", "1 for Coup de Grace"]);
    expect(pickedExperience({ "xp:A": true, "xp:B": true })).toBe("many");
    expect(pickedExperience({ "xp:A": false, "rx:C": true })).toBeNull();
    expect(featureUsable({ kind: "passive", name: "Climber" })).toBe(false);
    expect(featureUsable({ kind: "reaction", name: "Momentum" })).toBe(false);
    expect(featureUsable({ kind: "reaction", name: "Heavy Hitter" })).toBe(true);
  });

  it("rows: in range, out of range (amber, still pickable), out of sight", () => {
    const self = { x: 10, y: 10, size: 1 };
    const pc = (name: string, x: number) => ({ tokenId: `tk-${name}` as Id<"combatTokens">, characterId: `ch-${name}` as Id<"characters">, name, x, y: 10, size: 1, conditions: [] });
    const sight = (_: unknown, to: { x: number }) => ({ lineOfSight: to.x !== 12, cover: false }) as never;
    const rows = gmAttackRows(self, [pc("A", 11), pc("B", 12), pc("C", 0)], sight, "Close");
    expect(rows.map((r) => [r.name, r.reach])).toEqual([
      ["A", "in"],
      ["B", "los"],
      ["C", "out"],
    ]);
  });

  it("condition chips pair a condition with its Fear end; other ends get their own chip", () => {
    const chips = conditionChips(["vulnerable", "restrained"], [
      { effectId: "e1", label: "Vulnerable", source: "x", fear: 1 },
      { effectId: "e2", label: "Asleep", source: "Slumber", fear: 1 },
    ]);
    expect(chips.map((c) => [c.label, c.condition, c.end?.effectId ?? null])).toEqual([
      ["Vulnerable", "vulnerable", "e1"],
      ["Restrained", "restrained", null],
      ["Asleep", null, "e2"],
    ]);
  });
});
