/**
 * The Encounter tab's adversary actions (plan combat-actions AA3) with Convex mocked: the target picker (party without a
 * live map, PCs on the map with one; Q18), the spotlight note (CB p.153), the Fear question (Q19: nothing paid until
 * the GM taps Spend, then the same intent again with spendFear), Attack fired once per click with the picked targets,
 * Use on every non-passive feature (passives are modifiers), the GM's result (roll, hit / miss, damage, waiting), the
 * reaction offers (default No), and the reaction windows with Resolve now (Q17). AA3b: a feature that needs choices
 * (AA2c's featureAsk) asks them in a dialog before useFeature; a used-up feature says why Use is off.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { StatBlockAdversary } from "@/components/adversaries/catalogue/stat-block";
import { askFear, choiceArgs, initialAnswers, missing, needsChoices, pick, type FeatureAsk } from "@/components/adversaries/tracker/actions/ask";
import { fearPrompt, rollText, spotlightNote, targetOptions, toggled } from "@/components/adversaries/tracker/actions/model";
import { ActionPanel } from "@/components/adversaries/tracker/actions/panel";
import { useAdversaryActions } from "@/components/adversaries/tracker/actions/use-adversary-actions";
import { ReactionWindows } from "@/components/adversaries/tracker/actions/windows";

import type { Id } from "../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const results: Record<string, unknown[]> = {};
const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const queried: { name: string; args: unknown }[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    queried.push({ name, args });
    const q = queries[name];
    return typeof q === "function" ? (q as (a: unknown) => unknown)(args) : q;
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name]?.shift() ?? null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  // jsdom has no showModal/close; model the browser: close() drops `open` and fires the dialog's close event.
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
  calls.length = 0;
  queried.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  for (const k of Object.keys(queries)) delete queries[k];
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const PARTY = [
  { _id: "mira", status: "active", sheet: { name: "Mira" } },
  { _id: "tabby", status: "active", sheet: { name: "Tabby" } },
  { _id: "gone", status: "retired", sheet: { name: "Old Bram" } },
];

const BEAR: StatBlockAdversary = {
  name: "Bear",
  tier: 1,
  type: "Bruiser",
  description: "A large bear.",
  motives: "Maul",
  difficulty: 14,
  thresholds: { major: 9, severe: 17 },
  hp: 7,
  stress: 2,
  attack: { modifier: 1, name: "Claws", range: "Melee", damage: "1d8+3 phy" },
  experiences: [{ name: "Ambusher", value: 3 }],
  features: [
    { name: "Overwhelming Force", kind: "passive", text: "Targets who mark HP are knocked back." },
    { name: "Bite", kind: "action", text: "Mark a Stress to bite." },
    { name: "Momentum", kind: "reaction", text: "Gain a Fear on a hit." },
    { name: "Roar", kind: "action", text: "Spend a Fear to roar.", fearCost: 1 },
  ],
};

const ROLL = { kind: "action", dice: [{ sides: 20, value: 14, role: "d20" }], modifier: 1, total: 15, outcome: "none", manual: false };
const RESOLVED = {
  status: "resolved",
  groupId: "g1",
  entryId: "e1",
  roll: ROLL,
  success: true,
  targets: [
    { characterId: "mira", hit: true, requestId: "r1", damage: 9, resolved: false },
    { characterId: "tabby", hit: false, resolved: true },
  ],
  fearDelta: 1,
  prompts: [{ kind: "move", text: "Knock Mira back to Close range." }],
  offers: [{ feature: "Snap", useId: "snap-1", trigger: "onHit" }],
};

/** The panel as the tracker mounts it, with its own target state and the real hook over the mocked Convex. */
function Harness({ fear = 3, mode = "party" as "party" | "map", spotNote = null as string | null, onDice = () => {}, defeated = false }) {
  const acts = useAdversaryActions(CAMPAIGN);
  const [targets, setTargets] = useState<string[]>([]);
  const { options } = targetOptions({ party: PARTY, tokens: null, instanceId: "i1" });
  return (
    <ActionPanel
      instanceId="i1"
      actor="Bear"
      block={BEAR}
      defeated={defeated}
      fear={fear}
      spotNote={spotNote}
      mode={mode}
      options={options}
      targets={targets}
      onTargets={setTargets}
      acts={acts}
      onDice={onDice}
      adversaries={[
        { id: "i1", name: "Bear" },
        { id: "i2", name: "Wolf" },
      ]}
    />
  );
}

/** A featureAsk with nothing to ask (Bite: one PC target, which the panel's chips name). */
const PLAIN_ASK: FeatureAsk = {
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
  stress: 1,
  experiences: [],
  reactions: [],
};

/** Roar asks: pick a howl (one of two), an optional drag (1 Fear), a situation, an ally, and how to pay (Fear or Stress). */
const ROAR_ASK: FeatureAsk = {
  ...PLAIN_ASK,
  feature: "Roar",
  attack: false,
  stress: 0,
  targets: { side: "enemy", range: "close", count: "upTo", max: 2, sight: false },
  allies: { side: "ally", range: "far", count: "one", max: 1, sight: false },
  options: [{ id: "howl", label: "Howl", count: 1, distinct: true, options: [{ id: "fear", label: "Frighten" }, { id: "rally", label: "Rally" }] }],
  optionals: [{ id: "drag", label: "Drag the target", fear: 1, stress: 0 }],
  situations: [{ text: "The Bear is cornered", feature: "Roar" }],
  eitherCosts: [{ index: 0, options: [{ index: 0, fear: 1, stress: 0, hp: 0, label: "Spend a Fear" }, { index: 1, fear: 0, stress: 1, hp: 0, label: "Mark a Stress" }] }],
  fear: { total: 1, spotlight: 0, feature: 1, perTrigger: false, gmFear: 3, enough: true },
};

describe("feature asks (AA3b)", () => {
  it("asks only when the use needs more than the panel's PC targets", () => {
    expect(needsChoices(PLAIN_ASK)).toBe(false);
    expect(needsChoices({ ...PLAIN_ASK, targets: { side: "enemy", range: "close", count: "all", max: null, sight: false } })).toBe(false);
    expect(needsChoices(ROAR_ASK)).toBe(true);
    expect(needsChoices({ ...PLAIN_ASK, optionals: ROAR_ASK.optionals })).toBe(true);
    expect(needsChoices({ ...PLAIN_ASK, targets: { side: "ally", range: "far", count: "one", max: 1, sight: false } })).toBe(true);
    expect(needsChoices({ ...PLAIN_ASK, trigger: { kind: "situation", text: "When hit", source: false, subject: false, amount: false } })).toBe(false);
    expect(needsChoices({ ...PLAIN_ASK, trigger: { kind: "onDamaged", source: false, subject: false, amount: true } })).toBe(true);
    expect(needsChoices({ ...PLAIN_ASK, uses: [{ id: "main", activation: "action" }, { id: "react", activation: "reaction" }] })).toBe(true);
  });

  it("starts from the panel's picks, says what is missing, and builds useFeature's arguments", () => {
    const a = initialAnswers(ROAR_ASK, ["mira", "tabby", "bram"]);
    expect(a.targets).toEqual(["mira", "tabby"]);
    expect(a.eitherCosts).toEqual([0]);
    expect(missing(ROAR_ASK, a)).toEqual(["Pick one for allies", "Pick 1 for Howl"]);
    const done = { ...a, allies: ["i2"], options: { howl: ["rally"] }, optionals: ["drag"], eitherCosts: [1] };
    expect(missing(ROAR_ASK, done)).toEqual([]);
    expect(askFear(ROAR_ASK, a)).toBe(1);
    expect(askFear(ROAR_ASK, done)).toBe(0);
    expect(choiceArgs(ROAR_ASK, done, ["mira"])).toEqual({
      useId: "main",
      targets: ["mira", "tabby"],
      allies: ["i2"],
      options: [{ id: "howl", values: ["rally"] }],
      optionals: ["drag"],
      eitherCosts: [1],
    });
    // A use without a pickable target list sends the panel's targets.
    const noList = { ...PLAIN_ASK, targets: null };
    expect(choiceArgs(noList, initialAnswers(noList, []), ["mira"])).toEqual({ useId: "main", targets: ["mira"] });
    expect(pick(["a"], "b", 1)).toEqual(["b"]);
    expect(pick(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});

describe("model", () => {
  it("targets every active party PC without a live map, and only PCs with a token when the adversary is on the map (Q18)", () => {
    expect(targetOptions({ party: PARTY, tokens: null, instanceId: "i1" })).toEqual({
      mode: "party",
      options: [
        { characterId: "mira", name: "Mira" },
        { characterId: "tabby", name: "Tabby" },
      ],
    });
    const tokens = [
      { _id: "t1", kind: "pc", characterId: "mira", name: "Mira" },
      { _id: "t2", kind: "adversary", instanceId: "i1", name: "Bear" },
    ];
    expect(targetOptions({ party: PARTY, tokens, instanceId: "i1" })).toEqual({ mode: "map", options: [{ characterId: "mira", name: "Mira", tokenId: "t1" }] });
    // The adversary has no token on the live map: the party list (the server does the same).
    expect(targetOptions({ party: PARTY, tokens, instanceId: "i2" }).mode).toBe("party");
  });

  it("notes the spotlight's Fear like the tracker (CB p.153): free when already spotlit or first of the turn", () => {
    expect(spotlightNote({ spotlights: 0, spotlightTurn: 1 }, 1, 0)).toBeNull();
    expect(spotlightNote({ spotlights: 0, spotlightTurn: 1 }, 1, 1)).toBe("Spotlight: 1 Fear");
    expect(spotlightNote({ spotlights: 1, spotlightTurn: 1 }, 1, 2)).toBeNull();
    // A count from an older GM turn doesn't hold the spotlight now.
    expect(spotlightNote({ spotlights: 1, spotlightTurn: 1 }, 2, 1)).toBe("Spotlight: 1 Fear");
  });

  it("words the Fear question and the roll", () => {
    expect(fearPrompt({ fear: 2, spotlight: 1, feature: 0, experience: 1 })).toBe("Spend 2 Fear? 1 for the spotlight, 1 for the Experience.");
    expect(fearPrompt({ fear: 1, spotlight: 0, feature: 1, experience: 0 })).toBe("Spend 1 Fear? 1 for the feature.");
    expect(rollText({ dice: [{ sides: 20, value: 14 }], modifier: 1, total: 15 })).toBe("15 (d20 14, +1)");
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("ActionPanel", () => {
  it("picks targets from the party and fires one attack per click with them; the GM sees roll, hit / miss and damage", async () => {
    const onDice = vi.fn();
    results["adversaryActions:attack"] = [RESOLVED];
    render(<Harness onDice={onDice} spotNote="Spotlight: 1 Fear" />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    const targets = within(panel).getByRole("group", { name: "Targets" });
    expect(within(targets).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mira", "Tabby"]);
    expect(within(panel).getByRole("button", { name: /Attack/ })).toBeDisabled();
    expect(panel).toHaveTextContent("Spotlight: 1 Fear");

    fireEvent.click(within(targets).getByRole("button", { name: "Mira" }));
    fireEvent.click(within(targets).getByRole("button", { name: "Tabby" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Advantage" }));
    const attack = within(panel).getByRole("button", { name: "⚔ Attack Mira and Tabby with Claws" });
    await act(async () => {
      fireEvent.click(attack);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "adversaryActions:attack", args: { campaignId: CAMPAIGN, instanceId: "i1", targets: ["mira", "tabby"], advantage: 1 } });
    expect(calls[0]!.args).not.toHaveProperty("spendFear");
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
    expect(onDice).toHaveBeenCalledWith(ROLL.dice);

    const result = within(panel).getByRole("region", { name: "Action result" });
    expect(result).toHaveTextContent("Bear attacks");
    expect(within(result).getByTestId("tracker-action-roll")).toHaveTextContent("Roll 15 (d20 14, +1)");
    const rows = within(within(result).getByRole("list", { name: "Targets" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("MiraHit9 damagewaiting for answers");
    expect(rows[1]).toHaveTextContent("TabbyMiss");
    expect(result).toHaveTextContent("Gained 1 Fear.");
    expect(result).toHaveTextContent("Knock Mira back to Close range.");
  });

  it("asks before spending Fear (Q19): nothing paid until Spend, then the same intent with spendFear; Cancel drops it", async () => {
    results["adversaryActions:attack"] = [{ status: "confirmFear", fear: 2, spotlight: 1, feature: 0, experience: 1 }, RESOLVED];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    fireEvent.change(within(panel).getByRole("combobox", { name: "Experience" }), { target: { value: "Ambusher" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Attack Mira/ }));
    });
    const question = within(panel).getByRole("group", { name: "Spend Fear?" });
    expect(question).toHaveTextContent("Spend 2 Fear? 1 for the spotlight, 1 for the Experience.");
    expect(within(panel).queryByRole("region", { name: "Action result" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(question).getByRole("button", { name: "Spend 2 Fear" }));
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toMatchObject({ targets: ["mira"], experience: "Ambusher", spendFear: 2 });
    expect(calls[1]!.args.idempotencyKey).not.toBe(calls[0]!.args.idempotencyKey);
    expect(within(panel).queryByRole("group", { name: "Spend Fear?" })).toBeNull();
    expect(within(panel).getByRole("region", { name: "Action result" })).toBeInTheDocument();
  });

  it("disables Spend when the GM holds too little Fear, and Cancel closes the question", async () => {
    results["adversaryActions:useFeature"] = [{ status: "confirmFear", fear: 2, spotlight: 1, feature: 1, experience: 0 }];
    render(<Harness fear={1} />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Use Roar (1 Fear)" }));
    });
    const question = within(panel).getByRole("group", { name: "Spend Fear?" });
    expect(within(question).getByRole("button", { name: "Spend 2 Fear" })).toBeDisabled();
    expect(question).toHaveTextContent("You hold only 1 Fear.");
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(within(panel).queryByRole("group", { name: "Spend Fear?" })).toBeNull();
  });

  it("gives every non-passive feature a Use button; passives are modifiers", async () => {
    results["adversaryActions:useFeature"] = [{ ...RESOLVED, roll: null, targets: [], offers: [], prompts: [], fearDelta: 0 }];
    render(<Harness />);
    const feats = within(screen.getByRole("region", { name: "Adversary actions" })).getByRole("list", { name: "Features" });
    const rows = within(feats).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(rows[0]).toHaveTextContent("Modifier: applies on its own");
    expect(within(feats).getByRole("button", { name: "Use Bite" })).toBeEnabled();
    expect(within(feats).getByRole("button", { name: "Use Momentum" })).toBeEnabled();
    await act(async () => {
      fireEvent.click(within(feats).getByRole("button", { name: "Use Bite" }));
    });
    expect(calls).toEqual([expect.objectContaining({ name: "adversaryActions:useFeature", args: expect.objectContaining({ instanceId: "i1", feature: "Bite", targets: [] }) })]);
    expect(screen.getByRole("region", { name: "Action result" })).toHaveTextContent("Bear uses Bite");
  });

  it("offers reactions as one tap, default No: Yes fires the feature with the hit PC as trigger, No drops it", async () => {
    results["adversaryActions:attack"] = [RESOLVED];
    results["adversaryActions:useFeature"] = [{ ...RESOLVED, offers: [] }];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Attack Mira/ }));
    });
    const offers = within(panel).getByRole("list", { name: "Reactions you may use" });
    expect(offers).toHaveTextContent("Use Snap?");
    await act(async () => {
      fireEvent.click(within(offers).getByRole("button", { name: "Yes" }));
    });
    expect(calls[1]).toMatchObject({ name: "adversaryActions:useFeature", args: { feature: "Snap", useId: "snap-1", targets: ["mira"], trigger: { subjectId: "mira" } } });
  });

  it("No on an offer hides it without a call", async () => {
    results["adversaryActions:attack"] = [RESOLVED];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Attack Mira/ }));
    });
    fireEvent.click(within(within(panel).getByRole("list", { name: "Reactions you may use" })).getByRole("button", { name: "No" }));
    expect(within(panel).queryByRole("list", { name: "Reactions you may use" })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("sends opted-in attack reactions (Q19 default off)", async () => {
    results["adversaryActions:attack"] = [RESOLVED];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    const reactions = within(panel).getByRole("group", { name: "Reactions on this attack" });
    expect(within(reactions).getByRole("button", { name: "Momentum" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(reactions).getByRole("button", { name: "Momentum" }));
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Attack Mira/ }));
    });
    expect(calls[0]!.args).toMatchObject({ reactions: ["Momentum"] });
  });

  it("shows a server refusal and keeps nothing", async () => {
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    // The mocked mutation answers null for an unknown result: the hook reads it as an error.
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /Attack Mira/ }));
    });
    expect(within(panel).queryByRole("region", { name: "Action result" })).toBeNull();
    expect(within(panel).getByRole("status")).not.toBeEmptyDOMElement();
  });
});

describe("ActionPanel feature choices (AA3b)", () => {
  const asks = (byFeature: Record<string, FeatureAsk>) => (args: { feature: string; use?: string }) => byFeature[args.feature];

  it("asks a feature's choices in a dialog before useFeature, then sends them once", async () => {
    queries["adversaryActions:featureAsk"] = asks({ Roar: ROAR_ASK, Bite: PLAIN_ASK, Momentum: { ...PLAIN_ASK, feature: "Momentum" } });
    results["adversaryActions:useFeature"] = [{ ...RESOLVED, roll: null, targets: [], offers: [], prompts: [], fearDelta: 0 }];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Mira" }));
    const use = within(panel).getByRole("button", { name: "Use Roar (1 Fear)" });
    expect(use).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(use);
    expect(calls).toHaveLength(0);

    const dialog = screen.getByRole("dialog", { name: "Bear: Roar" });
    // The panel's pick carries over; the ally list leaves the Bear itself out.
    expect(within(dialog).getByRole("checkbox", { name: "Mira" })).toBeChecked();
    expect(within(dialog).queryByRole("radio", { name: "Bear" })).toBeNull();
    const submit = within(dialog).getByRole("button", { name: "Use Roar" });
    expect(submit).toBeDisabled();
    expect(dialog).toHaveTextContent("Pick one for allies. Pick 1 for Howl.");
    expect(within(dialog).getByRole("checkbox", { name: "Drag the target (1 Fear)" })).not.toBeChecked();
    expect(within(dialog).getByTestId("feature-ask-cost")).toHaveTextContent("Asks 1 Fear (you hold 3).");

    fireEvent.click(within(dialog).getByRole("radio", { name: "Wolf" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Rally" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Drag the target (1 Fear)" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "The Bear is cornered" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Mark a Stress" }));
    expect(within(dialog).getByTestId("feature-ask-cost")).toHaveTextContent("No Fear up front.");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Use Roar" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "adversaryActions:useFeature",
      args: {
        instanceId: "i1",
        feature: "Roar",
        useId: "main",
        targets: ["mira"],
        allies: ["i2"],
        options: [{ id: "howl", values: ["rally"] }],
        optionals: ["drag"],
        situations: ["The Bear is cornered"],
        eitherCosts: [1],
      },
    });
    expect(screen.getByRole("region", { name: "Action result" })).toHaveTextContent("Bear uses Roar");
  });

  it("Cancel closes the dialog without a call; a feature with nothing to ask fires at once", async () => {
    queries["adversaryActions:featureAsk"] = asks({ Roar: ROAR_ASK, Bite: PLAIN_ASK, Momentum: { ...PLAIN_ASK, feature: "Momentum" } });
    results["adversaryActions:useFeature"] = [{ ...RESOLVED, roll: null, targets: [], offers: [], prompts: [], fearDelta: 0 }];
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Adversary actions" });
    fireEvent.click(within(panel).getByRole("button", { name: "Use Roar (1 Fear)" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Bear: Roar" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toHaveLength(0);

    expect(within(panel).getByRole("button", { name: "Use Bite" })).not.toHaveAttribute("aria-haspopup");
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Use Bite" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([expect.objectContaining({ name: "adversaryActions:useFeature", args: expect.objectContaining({ feature: "Bite" }) })]);
  });

  it("a feature with two uses asks which, reading the other use's featureAsk", () => {
    const twoUses: FeatureAsk = { ...PLAIN_ASK, feature: "Momentum", uses: [{ id: "main", activation: "action" }, { id: "react", activation: "reaction" }] };
    queries["adversaryActions:featureAsk"] = (args: { feature: string; use?: string }) =>
      args.use === "react" ? { ...twoUses, useId: "react", activation: "reaction", optionals: [{ id: "extra", label: "Gain an extra Fear", fear: 0, stress: 0 }] } : args.feature === "Momentum" ? twoUses : PLAIN_ASK;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Use Momentum" }));
    const dialog = screen.getByRole("dialog", { name: "Bear: Momentum" });
    expect(within(dialog).getByRole("radio", { name: "Action 1" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Reaction 2" }));
    expect(queried).toContainEqual({ name: "adversaryActions:featureAsk", args: expect.objectContaining({ feature: "Momentum", use: "react" }) });
    expect(within(dialog).getByRole("checkbox", { name: "Gain an extra Fear" })).toBeInTheDocument();
  });

  it("a used-up feature's Use is off with the server's reason; a defeated adversary reads no featureAsk", () => {
    queries["adversaryActions:featureAsk"] = asks({ Roar: { ...ROAR_ASK, available: false, unavailable: ["Used up this scene"] }, Bite: PLAIN_ASK, Momentum: PLAIN_ASK });
    const { unmount } = render(<Harness />);
    const roar = screen.getByRole("button", { name: "Use Roar (1 Fear)" });
    expect(roar).toBeDisabled();
    expect(roar.closest("li")).toHaveTextContent("Used up this scene");
    unmount();
    queried.length = 0;
    render(<Harness defeated />);
    expect(queried.filter((q) => q.name === "adversaryActions:featureAsk")).toHaveLength(0);
  });

  it("a refused featureAsk keeps the plain Use, which sends at once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queries["adversaryActions:featureAsk"] = () => {
      throw new Error("ADVERSARY_FEATURE_UNAVAILABLE");
    };
    results["adversaryActions:useFeature"] = [{ ...RESOLVED, roll: null, targets: [], offers: [], prompts: [], fearDelta: 0 }];
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use Bite" }));
    });
    expect(calls).toEqual([expect.objectContaining({ name: "adversaryActions:useFeature" })]);
    vi.restoreAllMocks();
  });
});

describe("ReactionWindows", () => {
  const WINDOW = {
    requestId: "r1",
    encounterId: "enc1",
    instanceId: "i1",
    attackerLabel: "Bear",
    originalTargetId: "mira",
    targetCharacterId: "mira",
    targetName: "Mira",
    damage: 9,
    damageType: "physical",
    direct: false,
    critical: false,
    awaiting: [
      { characterId: "mira", name: "Mira", role: "target" },
      { characterId: "tabby", name: "Tabby", role: "ally" },
    ],
    answers: 0,
    createdAt: 1,
  };

  function Windows() {
    const acts = useAdversaryActions(CAMPAIGN);
    return <ReactionWindows campaignId={CAMPAIGN} encounterId="enc1" acts={acts} />;
  }

  it("lists who still has to answer and resolves now on the GM's tap (Q17); other encounters' windows are left out", async () => {
    queries["adversaryActions:windows"] = [WINDOW, { ...WINDOW, requestId: "r2", encounterId: "enc2", targetName: "Elsewhere" }];
    results["adversaryActions:resolve"] = [{ status: "resolved", requestId: "r1", targetId: "mira", severity: "major", hpMarked: 2, deathMove: false }];
    render(<Windows />);
    const region = screen.getByRole("region", { name: "Reaction windows" });
    const rows = within(region).getAllByTestId("tracker-window");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Bear hit Mira: 9 physical damage");
    expect(rows[0]).toHaveTextContent("Waiting for Mira (armor choice), Tabby (ally reaction)");
    await act(async () => {
      fireEvent.click(within(rows[0]!).getByRole("button", { name: "Resolve now: Bear hit Mira" }));
    });
    expect(calls).toEqual([expect.objectContaining({ name: "adversaryActions:resolve", args: expect.objectContaining({ campaignId: CAMPAIGN, requestId: "r1" }) })]);
  });

  it("renders nothing without an open window", () => {
    queries["adversaryActions:windows"] = [];
    const { container } = render(<Windows />);
    expect(container).toBeEmptyDOMElement();
  });
});
