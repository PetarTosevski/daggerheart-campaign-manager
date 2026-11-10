/**
 * Plan finish-in-progress FP2 (bead dcm-bxp.134.2): the Encounter tab's adversary action panel offers what the server
 * already accepts and the Combat Map HUD's stat block offers (rule switches WF, docs/tasks/TASK-RULES-WF.md), with Convex
 * mocked: W3 Tier 3 Dark-Hearted (`darkHearted: true` on the Attack and on attack-roll features, "1 for Dark-Hearted"
 * in the Fear question), F4 Manual (an Experience asks no Fear: "spend 1 Fear by hand", never off for Fear), and a path
 * feature's destination (`featureAsk.pathMove`) picked on the live map pane and sent as `useFeature` `destination`.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { StatBlockAdversary } from "@/components/adversaries/catalogue/stat-block";
import type { FeatureAsk } from "@/components/adversaries/tracker/actions/ask";
import { experienceText, fearPrompt, targetOptions } from "@/components/adversaries/tracker/actions/model";
import { ActionPanel } from "@/components/adversaries/tracker/actions/panel";
import { pathCrossed, pathOutside } from "@/components/adversaries/tracker/actions/path";
import { useAdversaryActions } from "@/components/adversaries/tracker/actions/use-adversary-actions";
import { cancelAreaPick, finishAreaPick, useAreaPick } from "@/components/combat-map/map-view/area-pick";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const q = queries[functionName(ref)];
    return typeof q === "function" ? (q as (a: unknown) => unknown)(args) : q;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      const next = results[name]?.shift() ?? null;
      if (next instanceof Error) throw next;
      return next;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  act(() => cancelAreaPick());
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const PARTY = [
  { _id: "mira", status: "active", sheet: { name: "Mira" } },
  { _id: "tabby", status: "active", sheet: { name: "Tabby" } },
];

const OGRE: StatBlockAdversary = {
  name: "Ogre",
  tier: 1,
  type: "Bruiser",
  description: "A large ogre.",
  motives: "Smash",
  difficulty: 13,
  thresholds: { major: 8, severe: 15 },
  hp: 7,
  stress: 3,
  attack: { modifier: 1, name: "Club", range: "Very Close", damage: "1d10+2 phy" },
  experiences: [{ name: "Ambusher", value: 3 }],
  features: [
    { name: "Bite", kind: "action", text: "Bite a target." },
    { name: "Trample", kind: "action", text: "Move and hit everyone in its path." },
    { name: "Rampaging Fury", kind: "action", text: "Move and hit all targets in its path." },
  ],
};

const ASK: FeatureAsk = {
  feature: "Bite",
  useId: "main",
  uses: [{ id: "main", activation: "action" }],
  automated: true,
  activation: "action",
  needsSpotlight: true,
  spotlit: false,
  available: true,
  unavailable: [],
  attack: true,
  followUpAttack: false,
  targets: { side: "enemy", range: "melee", count: "one", max: 1, sight: true },
  picked: null,
  allies: null,
  followUp: null,
  trigger: null,
  options: [],
  optionals: [],
  situations: [],
  splits: [],
  eitherCosts: [],
  fear: { total: 0, spotlight: 0, feature: 0, perTrigger: false, gmFear: 3, enough: true },
  stress: 0,
  experiences: [],
  reactions: [],
};
const TRAMPLE: FeatureAsk = { ...ASK, feature: "Trample", attack: false, targets: { side: "enemy", range: "close", count: "all", max: null, sight: false, area: "path" }, pathMove: "close" };
const FURY: FeatureAsk = { ...ASK, feature: "Rampaging Fury", attack: false, targets: { side: "any", range: "close", count: "all", max: null, sight: false, area: "path" }, pathMove: "close" };

const MAP = { _id: "m1", name: "Bridge", live: true, source: { kind: "blank" }, w: 20, h: 20 };
const TOKENS = [
  { _id: "t-ogre", kind: "adversary", instanceId: "i1", name: "Ogre", x: 0, y: 0, size: 1, stats: null },
  { _id: "t-wolf", kind: "adversary", instanceId: "i2", name: "Wolf", x: 3, y: 0, size: 1, stats: null },
  { _id: "t-mira", kind: "pc", characterId: "mira", name: "Mira", x: 2, y: 0, size: 1, stats: { conditions: [] } },
  { _id: "t-tabby", kind: "pc", characterId: "tabby", name: "Tabby", x: 0, y: 5, size: 1, stats: { conditions: [] } },
];

const RESOLVED = { status: "resolved", groupId: "g1", entryId: "e1", roll: null, success: true, targets: [], fearDelta: 0, prompts: [], offers: [] };

function Harness({ fear = 3, onMap = false, block = OGRE }: { fear?: number; onMap?: boolean; block?: StatBlockAdversary }) {
  const acts = useAdversaryActions(CAMPAIGN);
  const [targets, setTargets] = useState<string[]>([]);
  const { mode, options } = targetOptions({ party: PARTY, tokens: onMap ? TOKENS : null, instanceId: "i1" });
  return (
    <ActionPanel
      instanceId="i1"
      actor="Ogre"
      block={block}
      defeated={false}
      fear={fear}
      spotNote={null}
      mode={mode}
      options={options}
      targets={targets}
      onTargets={setTargets}
      acts={acts}
      onDice={() => {}}
      adversaries={[
        { id: "i1", name: "Ogre" },
        { id: "i2", name: "Wolf" },
      ]}
    />
  );
}

/** The map pane's square pick, as the tracker's live map shows it (the banner reads the same store). */
function PickProbe() {
  const pick = useAreaPick();
  return <p data-testid="pick">{pick.request ? pick.request.prompt : "none"}</p>;
}

const panel = () => screen.getByRole("region", { name: "Adversary actions" });

describe("Dark-Hearted (W3 Tier 3)", () => {
  it("is offered only once the server says adversaries have it", () => {
    queries["adversaryActions:darkHearted"] = false;
    render(<Harness />);
    expect(within(panel()).queryByRole("button", { name: /Dark-Hearted/ })).toBeNull();
  });

  it("sends darkHearted on the Attack and on an attack-roll feature, and the Fear question names it", async () => {
    queries["adversaryActions:darkHearted"] = true;
    queries["adversaryActions:featureAsk"] = () => ASK;
    results["adversaryActions:attack"] = [{ status: "confirmFear", fear: 1, spotlight: 0, feature: 0, experience: 0, darkHearted: 1 }];
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness />);
    const toggle = within(panel()).getByRole("button", { name: "Dark-Hearted: advantage (1 Fear)" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(panel()).getByRole("button", { name: "Mira" }));
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: /Attack/ }));
    });
    expect(calls[0]).toMatchObject({ name: "adversaryActions:attack", args: { instanceId: "i1", targets: ["mira"], darkHearted: true } });
    expect(within(panel()).getByRole("group", { name: "Spend Fear?" })).toHaveTextContent("Spend 1 Fear? 1 for Dark-Hearted.");

    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Use Bite" }));
    });
    expect(calls[1]).toMatchObject({ name: "adversaryActions:useFeature", args: { feature: "Bite", darkHearted: true } });
  });

  it("is left off a feature that makes no attack roll", async () => {
    queries["adversaryActions:darkHearted"] = true;
    queries["adversaryActions:featureAsk"] = () => ({ ...ASK, attack: false });
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness />);
    fireEvent.click(within(panel()).getByRole("button", { name: /Dark-Hearted/ }));
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Use Bite" }));
    });
    expect(calls[0]?.args).not.toHaveProperty("darkHearted");
    expect(fearPrompt({ fear: 2, spotlight: 1, feature: 0, experience: 0, darkHearted: 1 })).toBe("Spend 2 Fear? 1 for the spotlight, 1 for Dark-Hearted.");
  });
});

describe("Dark-Hearted switches itself off after one roll (FP6)", () => {
  const CONFIRM = { status: "confirmFear", fear: 1, spotlight: 0, feature: 0, experience: 0, darkHearted: 1 };
  const toggle = () => within(panel()).getByRole("button", { name: "Dark-Hearted: advantage (1 Fear)" });
  function armed() {
    queries["adversaryActions:darkHearted"] = true;
    queries["adversaryActions:featureAsk"] = () => ASK;
    render(<Harness />);
    fireEvent.click(toggle());
    fireEvent.click(within(panel()).getByRole("button", { name: "Mira" }));
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  }
  const attack = () =>
    act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: /Attack/ }));
    });

  it("is off after an Attack the server resolves", async () => {
    results["adversaryActions:attack"] = [RESOLVED];
    armed();
    await attack();
    expect(calls[0]?.args).toMatchObject({ darkHearted: true });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("stays on while the Fear question is open and goes off once the Fear is spent", async () => {
    results["adversaryActions:attack"] = [CONFIRM, RESOLVED];
    armed();
    await attack();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Spend 1 Fear" }));
    });
    expect(calls[1]?.args).toMatchObject({ darkHearted: true, spendFear: 1 });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("is still on after the GM cancels the Fear question", async () => {
    results["adversaryActions:attack"] = [CONFIRM];
    armed();
    await attack();
    fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(within(panel()).queryByRole("group", { name: "Spend Fear?" })).toBeNull();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("is still on after the server refuses the Attack", async () => {
    results["adversaryActions:attack"] = [new Error("refused")];
    armed();
    await attack();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("is off after a feature use with an attack roll", async () => {
    results["adversaryActions:useFeature"] = [RESOLVED];
    armed();
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Use Bite" }));
    });
    expect(calls[0]).toMatchObject({ name: "adversaryActions:useFeature", args: { feature: "Bite", darkHearted: true } });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("stays on after a feature that makes no attack roll (it was not sent)", async () => {
    queries["adversaryActions:darkHearted"] = true;
    queries["adversaryActions:featureAsk"] = () => ({ ...ASK, attack: false });
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness />);
    fireEvent.click(toggle());
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Use Bite" }));
    });
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("F4 adversaryExperienceFear", () => {
  it("Book: an Experience costs 1 Fear and is off without it", () => {
    queries["ruleSettings:get"] = { modes: { adversaryExperienceFear: "book" }, locked: false, canEdit: true };
    render(<Harness fear={0} />);
    const option = within(panel()).getByRole("option", { name: "Ambusher +3 (1 Fear)" });
    expect(option).toBeDisabled();
  });

  it("Manual: no Fear asked, the GM's 'spend by hand' wording, and the Attack sends the Experience", async () => {
    queries["ruleSettings:get"] = { modes: { adversaryExperienceFear: "manual" }, locked: false, canEdit: true };
    results["adversaryActions:attack"] = [RESOLVED];
    render(<Harness fear={0} />);
    const option = within(panel()).getByRole("option", { name: "Ambusher +3 (spend 1 Fear by hand)" });
    expect(option).not.toBeDisabled();
    fireEvent.change(within(panel()).getByRole("combobox"), { target: { value: "Ambusher" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Mira" }));
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: /Attack/ }));
    });
    expect(calls[0]).toMatchObject({ name: "adversaryActions:attack", args: { experience: "Ambusher" } });
    expect(experienceText({ name: "Ambusher", value: 3 }, true)).toBe("Ambusher +3 (spend 1 Fear by hand)");
  });
});

describe("F5 fearFeatures (NB2)", () => {
  // A Fear feature (CB p.154): Earthquake costs 2 Fear in Book. The server's featureAsk asks no Fear for it in Manual.
  const QUAKE_OGRE: StatBlockAdversary = { ...OGRE, features: [...OGRE.features, { name: "Earthquake", kind: "action", text: "Spend 2 Fear to shake the ground.", fearCost: 2 }] };
  const QUAKE: FeatureAsk = { ...ASK, feature: "Earthquake", attack: false, targets: null };
  const row = () => within(panel()).getByText("Earthquake").closest("li")!;

  it("Book: the 'Fear 2' badge and the '(2 Fear)' Use label", () => {
    queries["ruleSettings:get"] = { modes: { fearFeatures: "book" }, locked: false, canEdit: true };
    queries["adversaryActions:featureAsk"] = () => ({ ...QUAKE, fear: { total: 2, spotlight: 0, feature: 2, perTrigger: false, gmFear: 3, enough: true } });
    render(<Harness block={QUAKE_OGRE} />);
    expect(within(row()).getByText("Fear 2")).toBeInTheDocument();
    expect(within(row()).getByRole("button", { name: "Use Earthquake (2 Fear)" })).toBeEnabled();
    expect(within(row()).queryByText("Spend 2 Fear by hand")).toBeNull();
  });

  it("Manual: neither badge nor label, the by-hand wording, never off for lack of Fear, and no Fear sent", async () => {
    queries["ruleSettings:get"] = { modes: { fearFeatures: "manual" }, locked: false, canEdit: true };
    queries["adversaryActions:featureAsk"] = () => ({ ...QUAKE, fear: { total: 0, spotlight: 0, feature: 0, perTrigger: false, gmFear: 0, enough: true } });
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness fear={0} block={QUAKE_OGRE} />);
    expect(within(row()).queryByText("Fear 2")).toBeNull();
    expect(within(row()).getByText("Spend 2 Fear by hand")).toBeInTheDocument();
    const use = within(row()).getByRole("button", { name: "Use Earthquake" });
    expect(use).toBeEnabled();
    await act(async () => {
      fireEvent.click(use);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "adversaryActions:useFeature", args: { feature: "Earthquake" } });
    expect(calls[0]!.args).not.toHaveProperty("spendFear");
  });

  it("Manual before featureAsk loads: the plain Use carries no Fear label either", () => {
    queries["ruleSettings:get"] = { modes: { fearFeatures: "manual" }, locked: false, canEdit: true };
    render(<Harness fear={0} block={QUAKE_OGRE} />);
    expect(within(row()).getByRole("button", { name: "Use Earthquake" })).toBeEnabled();
  });
});

describe("path features' destination (featureAsk.pathMove)", () => {
  function onTheMap(byFeature: Record<string, FeatureAsk>) {
    queries["combatMaps:list"] = [MAP];
    queries["combatTokensReads:list"] = TOKENS;
    queries["adversaryActions:featureAsk"] = (args: { feature: string }) => byFeature[args.feature] ?? ASK;
  }

  it("Trample: picks the square on the live map, pre-picks who the line crosses, then sends destination", async () => {
    onTheMap({ Trample: TRAMPLE });
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(
      <>
        <Harness onMap />
        <PickProbe />
      </>,
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Use Trample" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId("pick")).toHaveTextContent("Pick Ogre’s destination for Trample within Close");
    expect(panel()).toHaveTextContent("Click the destination square on the live map below.");

    // Beyond Close (6 squares): the pick stays open and says why.
    await act(async () => {
      await finishAreaPick({ x: 19, y: 19 });
    });
    expect(screen.getByTestId("pick")).toHaveTextContent("That square is out of range.");
    expect(calls).toHaveLength(0);

    await act(async () => {
      await finishAreaPick({ x: 4, y: 0 });
    });
    expect(screen.getByTestId("pick")).toHaveTextContent("none");
    const confirm = within(panel()).getByRole("group", { name: "Trample destination" });
    expect(confirm).toHaveTextContent("Ogre moves to (4, 0)");
    // Mira (2, 0) is on the line; Tabby (0, 5) is not. The GM may still change the chips.
    expect(within(panel()).getByRole("button", { name: "Mira" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel()).getByRole("button", { name: "Tabby" })).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Use Trample on Mira" }));
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "adversaryActions:useFeature", args: { instanceId: "i1", feature: "Trample", useId: "main", targets: ["mira"], destination: { x: 4, y: 0 } } });
    expect(within(panel()).queryByRole("group", { name: "Trample destination" })).toBeNull();
  });

  it("Rampaging Fury (side any): the choices dialog opens with the crossed creatures, and Use sends destination", async () => {
    onTheMap({ "Rampaging Fury": FURY });
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness onMap />);
    fireEvent.click(within(panel()).getByRole("button", { name: "Use Rampaging Fury" }));
    await act(async () => {
      await finishAreaPick({ x: 4, y: 0 });
    });
    const dialog = screen.getByRole("dialog", { name: "Ogre: Rampaging Fury" });
    expect(within(dialog).getByRole("checkbox", { name: "Mira" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Wolf" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Tabby" })).not.toBeChecked();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Use Rampaging Fury" }));
    });
    expect(calls[0]).toMatchObject({ name: "adversaryActions:useFeature", args: { feature: "Rampaging Fury", targets: ["mira", "i2"], destination: { x: 4, y: 0 } } });
  });

  it("without the adversary on a live map, Use sends at once with no destination (as before)", async () => {
    queries["adversaryActions:featureAsk"] = () => TRAMPLE;
    queries["combatMaps:list"] = [];
    results["adversaryActions:useFeature"] = [RESOLVED];
    render(<Harness />);
    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Use Trample" }));
    });
    expect(calls[0]?.args).not.toHaveProperty("destination");
  });

  it("the pure helpers: the line's creatures nearest first, unconscious PCs left out in C4 Book, the range check", () => {
    const self = TOKENS[0]!;
    const down = TOKENS.map((t) => (t.characterId === "mira" ? { ...t, stats: { conditions: ["unconscious"] } } : t));
    expect(pathCrossed({ self, destination: { x: 4, y: 0 }, tokens: TOKENS, instanceId: "i1", standing: ["i1", "i2"], anySide: true, skipUnconscious: true })).toEqual(["mira", "i2"]);
    expect(pathCrossed({ self, destination: { x: 4, y: 0 }, tokens: TOKENS, instanceId: "i1", standing: ["i1", "i2"], anySide: false, skipUnconscious: true })).toEqual(["mira"]);
    expect(pathCrossed({ self, destination: { x: 4, y: 0 }, tokens: down, instanceId: "i1", standing: ["i1"], anySide: true, skipUnconscious: true })).toEqual([]);
    expect(pathCrossed({ self, destination: { x: 4, y: 0 }, tokens: down, instanceId: "i1", standing: ["i1"], anySide: false, skipUnconscious: false })).toEqual(["mira"]);
    expect(pathOutside(self, "close", { x: 4, y: 0 }, true)).toBe(false);
    expect(pathOutside(self, "close", { x: 19, y: 19 }, true)).toBe(true);
    expect(pathOutside(self, "close", { x: 19, y: 19 }, false)).toBe(false);
  });
});
