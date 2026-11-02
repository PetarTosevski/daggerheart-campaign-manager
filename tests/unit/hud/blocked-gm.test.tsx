/**
 * Plan combat-hud H6.3 (docs/tasks/TASK-HUD-H6.3.md; CmpBlocked GM rows, GMDesktop): the blocked states on the GM's
 * surfaces, through H6.1's layers and refusal table.
 * - NOT_ENOUGH_FEAR: every GM Fear cost (Spotlight · 1 Fear, End · n Fear, a Fear feature, an Experience, FearConfirm)
 *   is disabled with "This needs 2 Fear. You have 1."; a refusal at the click says the table's words.
 * - ADVERSARY_NOT_SPOTLIT: an adversary action whose own spotlight the GM can't pay says "Spotlight the … first.".
 * - REQUEST_NOT_OPEN / DEATH_MOVE_NOT_WAITING: an answered request toasts "Already answered" and the card drops out.
 * Convex is mocked; FearConfirm in the stat block is a stub (the real one is rendered on its own).
 */
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FearConfirm } from "@/components/combat-map/hud/fear/confirm";
import { useAdjustFear } from "@/components/combat-map/hud/fear/banner";
import { adversaryActBlocked, fearBlocked, fearShortText, spotlightFirst } from "@/components/combat-map/hud/fear/blocked";
import { PickProvider, usePick, type PickApi } from "@/components/combat-map/hud/pick";
import { HudQueue } from "@/components/combat-map/hud/queue";
import { useFearAsk, useGmActs } from "@/components/combat-map/hud/statblock/acts";
import { StatBlockPanel } from "@/components/combat-map/hud/statblock/panel";
import { HudProvider } from "@/components/combat-map/hud/state";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";
import type { CombatPageState } from "@/components/combat-map/slots";

import type { Id } from "../../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const calls: { name: string; args: Record<string, unknown> }[] = [];
/** Answers per mutation, in order; a thrown value is thrown. */
const answers: Record<string, unknown[]> = {};
const failures: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    const value = queries[name];
    return name === "deathMoves:state" ? (value as Record<string, unknown> | undefined)?.[(args as { characterId: string }).characterId] : value;
  },
  useQueries: (request: Record<string, { query: unknown; args: { characterId: string } }>) =>
    Object.fromEntries(Object.entries(request).map(([k, q]) => [k, (queries[functionName(q.query)] as Record<string, unknown> | undefined)?.[q.args.characterId]])),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (failures[name]) throw failures[name];
      return answers[name]?.shift() ?? null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ campaignId: "c1" }) }));
vi.mock("@/components/combat-map/hud/statblock/fear-confirm", () => ({
  FearConfirm: ({ amount }: { amount: number }) => <div data-testid="fear-confirm" data-amount={amount} />,
}));
vi.mock("@/components/combat-map/actions/adversary/sight", () => ({ useLiveSight: () => null }));
vi.mock("@/components/adversaries/tracker/actions/feature-use", () => ({
  FeatureUse: ({ feature, onUse, disabled }: { feature: string; onUse: (ask: unknown) => void; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onUse(null)}>
      Use {feature}
    </button>
  ),
}));
vi.mock("@/components/adversaries/tracker/actions/choices", () => ({ FeatureChoices: () => null }));
vi.mock("@/components/adversaries/tracker/actions/result", () => ({ ActionResultView: () => null }));

beforeEach(() => hudToasts.reset());
afterEach(() => {
  for (const o of [queries, answers, failures]) for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  calls.length = 0;
  hudToasts.reset();
});

const refuse = (code: string) => new ConvexError({ code });

// ---------------------------------------------------------------- the helpers

describe("the GM's Fear words", () => {
  it("NOT_ENOUGH_FEAR: 'This needs 2 Fear. You have 1.'; nothing when the GM can pay or Fear is loading", () => {
    expect(fearBlocked(2, 1)).toMatchObject({ code: "NOT_ENOUGH_FEAR", refusal: { text: "This needs 2 Fear. You have 1.", title: "GM: not enough Fear" } });
    expect(fearShortText(2, 1)).toBe("This needs 2 Fear. You have 1.");
    expect(fearBlocked(2, 2)).toBeNull();
    expect(fearBlocked(0, 0)).toBeNull();
    expect(fearBlocked(1, undefined)).toBeNull();
  });

  it("ADVERSARY_NOT_SPOTLIT: 'Spotlight the Lieutenant first.' when the action's own spotlight can't be paid", () => {
    expect(spotlightFirst("the Lieutenant", 1, 0)).toMatchObject({ code: "ADVERSARY_NOT_SPOTLIT", text: "Spotlight the Lieutenant first.", refusal: { hint: "Spotlighting costs 1 Fear." } });
    expect(spotlightFirst("the Lieutenant", 0, 0)).toBeNull();
    expect(spotlightFirst("the Lieutenant", 1, 1)).toBeNull();
    // A Fear feature: the spotlight first, then the whole cost.
    expect(adversaryActBlocked("the Lieutenant", 1, 1, 0)?.code).toBe("ADVERSARY_NOT_SPOTLIT");
    expect(adversaryActBlocked("the Lieutenant", 1, 1, 1)?.text).toBe("This needs 2 Fear. You have 1.");
    expect(adversaryActBlocked("the Lieutenant", 1, 0, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------- the stat block

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];
const LT = "tk-lt" as Id<"combatTokens">;
const LT_INSTANCE = "in-lt";
const ENC = "enc1";
const LT_NAME = "the Jagged Knife Lieutenant";

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

/** The Lieutenant with Brannoc Very Close; another adversary already spotlit this GM turn (a spotlight costs 1 Fear). */
function seed(fear: number) {
  queries["combatTokens:list"] = [token(LT, "adversary", "Jagged Knife Lieutenant", 14, 10, { instanceId: LT_INSTANCE }), token("tk-br", "pc", "Brannoc", 11, 10, { characterId: "ch-br" })];
  queries["encounters:list"] = { active: [{ _id: ENC, status: "running", name: "Camp" }], ended: [], moreEnded: false };
  queries["encounters:get"] = { encounter: { _id: ENC, gmTurn: 1 }, instances: [instance(), instance({ _id: "in-b", label: "Bandit", spotlights: 1, conditions: [] })] };
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

describe("the stat block (GMDesktop 'Adversary acting')", () => {
  it("no Fear: Spotlight · 1 Fear and End · 1 Fear say 'This needs 1 Fear. You have 0.', stay focusable and do nothing", async () => {
    seed(0);
    renderBlock();
    const spot = screen.getByTestId("hud-statblock-spotlight");
    expect(spot.textContent).toBe("Spotlight · 1 Fear");
    expect(spot).toHaveAttribute("aria-disabled", "true");
    expect(spot).not.toBeDisabled();
    expect(screen.getByTestId("hud-statblock-spot-why")).toHaveTextContent("This needs 1 Fear. You have 0.");
    expect(spot).toHaveAccessibleDescription("This needs 1 Fear. You have 0.");
    const end = screen.getByRole("button", { name: "End Vulnerable · 1 Fear" });
    expect(end).toHaveAttribute("aria-disabled", "true");
    expect(end).toHaveAccessibleDescription("This needs 1 Fear. You have 0.");
    await act(async () => fireEvent.click(spot));
    await act(async () => fireEvent.click(end));
    expect(screen.queryByTestId("fear-confirm")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("no Fear for its own spotlight: Attack says 'Spotlight the Jagged Knife Lieutenant first.' and opens nothing", () => {
    seed(0);
    renderBlock();
    const attack = screen.getByTestId("hud-statblock-attack");
    expect(attack).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("hud-statblock-attack-why")).toHaveTextContent(`Spotlight ${LT_NAME} first. Spotlighting costs 1 Fear.`);
    act(() => fireEvent.click(attack));
    expect(probe.api!.session).toBeNull();
    // Action features: the same reason; Coup de Grace (1 Fear) too, since its spotlight comes first.
    expect(screen.getByRole("button", { name: "Use Tactician" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use Coup de Grace" })).toBeDisabled();
    expect(screen.getAllByTestId("hud-statblock-feature-why").map((w) => w.textContent)).toContain(`Spotlight ${LT_NAME} first.`);
  });

  it("1 Fear: Attack opens; a Fear feature needing 2 says 'This needs 2 Fear. You have 1.'; the Experience opens disabled", () => {
    seed(1);
    renderBlock();
    expect(screen.getByTestId("hud-statblock-spotlight")).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByTestId("hud-statblock-spot-why")).toBeNull();
    expect(screen.getByRole("button", { name: "Use Tactician" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use Coup de Grace" })).toBeDisabled();
    expect(screen.getAllByTestId("hud-statblock-feature-why").map((w) => w.textContent)).toEqual(["This needs 2 Fear. You have 1."]);
    const attack = screen.getByTestId("hud-statblock-attack");
    expect(attack).not.toHaveAttribute("aria-disabled");
    act(() => fireEvent.click(attack));
    const xp = probe.api!.session!.spec.options![0]!;
    expect(xp).toMatchObject({ id: "xp:Local Knowledge", disabled: true, note: "This needs 2 Fear. You have 1." });
  });

  it("enough Fear: nothing blocked, the Experience says what it costs", () => {
    seed(5);
    renderBlock();
    expect(screen.queryAllByTestId("hud-statblock-feature-why")).toEqual([]);
    expect(screen.queryByTestId("hud-statblock-attack-why")).toBeNull();
    act(() => fireEvent.click(screen.getByTestId("hud-statblock-attack")));
    expect(probe.api!.session!.spec.options![0]).toMatchObject({ note: "Costs 1 Fear" });
    expect(probe.api!.session!.spec.options![0]!.disabled).toBeUndefined();
  });

  it("the picking panel's refusal reads the table, with the adversary's name (ADVERSARY_NOT_SPOTLIT, NOT_ENOUGH_FEAR)", async () => {
    seed(5);
    renderBlock();
    act(() => fireEvent.click(screen.getByTestId("hud-statblock-attack")));
    const live = probe.api!.session!;
    const brannoc = live.spec.rows![0]!;
    const sel = { targets: [{ ...brannoc, conditions: [] }], targetIds: [brannoc.tokenId], outOfRange: false, options: {} };
    failures["adversaryActions:attack"] = refuse("ADVERSARY_NOT_SPOTLIT");
    let out: unknown;
    await act(async () => {
      out = await live.spec.primary.send(sel);
    });
    expect(out).toEqual({ kind: "stay", message: `Spotlight ${LT_NAME} first.` });
    failures["adversaryActions:attack"] = refuse("NOT_ENOUGH_FEAR");
    await act(async () => {
      out = await live.spec.primary.send(sel);
    });
    expect(out).toEqual({ kind: "stay", message: "Not enough Fear for that." });
    // A toast-placed refusal (anything unknown → FALLBACK) goes to the toast host.
    failures["adversaryActions:attack"] = new Error("boom");
    await act(async () => {
      out = await live.spec.primary.send(sel);
    });
    expect(out).toEqual({ kind: "stay" });
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Something went wrong", message: "Something went wrong. Check your connection and try again." })]);
  });

  it("a refusal at Use shows under the controls in the table's words (layer 2)", async () => {
    seed(5);
    renderBlock();
    failures["adversaryActions:useFeature"] = refuse("NOT_ENOUGH_FEAR");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use Tactician" })));
    const alert = within(screen.getByTestId("hud-statblock-error")).getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "NOT_ENOUGH_FEAR");
    expect(alert).toHaveTextContent("Not enough Fear for that.");
  });
});

// ---------------------------------------------------------------- FearConfirm and the banner

describe("FearConfirm and the Fear banner", () => {
  it("FearConfirm says the same words as every GM Fear control and describes Spend with them", () => {
    render(<FearConfirm amount={2} reasons={[]} onConfirm={() => {}} onCancel={() => {}} fear={1} />);
    const spend = screen.getByRole("button", { name: "Spend 2 Fear" });
    expect(spend).toBeDisabled();
    expect(spend).toHaveAccessibleDescription("This needs 2 Fear. You have 1.");
  });

  it("a refusal from Spend shows in the card in the table's words, even a toast-placed one", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(refuse("NOT_ENOUGH_FEAR")).mockRejectedValueOnce(refuse("REQUEST_NOT_OPEN"));
    render(<FearConfirm amount={1} reasons={[]} onConfirm={onConfirm} onCancel={() => {}} fear={3} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Spend 1 Fear" })));
    expect(screen.getByRole("alert")).toHaveAttribute("data-code", "NOT_ENOUGH_FEAR");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Spend 1 Fear" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Someone already answered this.");
    expect(hudToasts.get()).toEqual([]);
  });

  it("the banner's − keeps a refusal as the table's sentence (it still spends without asking, answer 6a)", async () => {
    failures["fear:adjust"] = refuse("FEAR_EMPTY");
    const { result } = renderHook(() => useAdjustFear(CAMPAIGN));
    await act(async () => result.current.step("decrease"));
    expect(calls.map((c) => c.name)).toEqual(["fear:adjust"]);
    expect(result.current.error).toBe("Not enough Fear for that.");
  });
});

// ---------------------------------------------------------------- the queue

function gm(): CombatPageState {
  return { campaignId: "camp", role: "gm", mode: "play", map: null, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {} } as unknown as CombatPageState;
}

function queue() {
  queries["combatRequests:mine"] = [
    { kind: "sanction", requestId: "r-att", characterId: "c-moss", characterName: "Moss", createdAt: 1, slot: "primary", targets: [{ tokenId: "t-s", name: "Sniper" }], outOfRange: [{ tokenId: "t-s", band: "veryFar" }] },
  ];
  queries["combatCards:pending"] = [];
  queries["combatFeatures:pending"] = [];
  queries["combatRequests:difficulties"] = [];
  queries["adversaryActions:windows"] = [];
  queries["cloakPrompts:pending"] = [];
  queries["hitKeywords:asks"] = [];
  queries["characters:listByCampaign"] = [];
  queries["feed:list"] = {
    page: [{ _id: "e1", kind: "combat", visibility: "gm", undone: false, canUndo: true, summary: "Moss hit the Bandit", at: 1, actorName: "Moss" }],
    isDone: true,
    continueCursor: "",
  };
}

describe("the GM's queue (REQUEST_NOT_OPEN)", () => {
  it.each(["REQUEST_NOT_OPEN", "DEATH_MOVE_NOT_WAITING"])("%s: the neutral 'Already answered' toast, nothing on the card", async (code) => {
    queue();
    failures["combatRequests:sanction"] = refuse(code);
    render(<HudQueue state={gm()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Attack" })));
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Already answered", message: "Someone already answered this.", tone: "neutral" })]);
    expect(within(screen.getByTestId("hud-queue-range")).queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Already answered:/)).toBeNull();
  });

  it("another refusal stays under its card in the table's words; an unknown one toasts", async () => {
    queue();
    failures["combatRequests:sanction"] = refuse("COMBAT_NO_LINE_OF_SIGHT");
    render(<HudQueue state={gm()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Attack" })));
    const alert = within(screen.getByTestId("hud-queue-range")).getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "COMBAT_NO_LINE_OF_SIGHT");
    expect(alert).toHaveTextContent("Move or remove what blocks the view.");
    failures["combatRequests:sanction"] = new Error("network");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow: Moss · Attack" })));
    expect(within(screen.getByTestId("hud-queue-range")).queryByRole("alert")).toBeNull();
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Something went wrong", message: "Something went wrong. Check your connection and try again." })]);
  });

  it("Resolutions: UNDO_STALE keeps its own words under the list", async () => {
    queue();
    failures["actionLog:undo"] = new ConvexError({ code: "UNDO_STALE", message: "Something newer happened since." });
    render(<HudQueue state={gm()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo: Moss hit the Bandit" })));
    const alert = within(screen.getByTestId("hud-resolutions-error")).getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "UNDO_STALE");
    expect(alert).toHaveTextContent("Something newer happened since.");
  });
});
