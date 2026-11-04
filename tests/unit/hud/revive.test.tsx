/**
 * Revive a defeated adversary (bead dcm-6c2o, user 2026-11-04): the hover / focus "Revive" pill, the box (the stat
 * block's HP / Stress rows, starting at full health; a Minion group's fallen Minions), its one keyed intent with the
 * optimistic update, the spotlight popover's defeated row, and the model helpers. Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resetPanels } from "@/components/combat-map/hud/panels";
import { ReviveBox, ReviveButton } from "@/components/combat-map/hud/revive";
import { afterReviveInstances, afterReviveTokens, canRevive, hpCap, reviveLine, stepMarks } from "@/components/combat-map/hud/revive/model";
import { SpotlightDisc } from "@/components/combat-map/hud/spotlight";
import type { SpotlightState } from "@/components/combat-map/hud/spotlight/model";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";

import type { Id } from "../../../convex/_generated/dataModel";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const updaters: Record<string, (store: unknown, args: unknown) => void> = {};
let failNext: unknown = null;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      return { moved: true };
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: unknown, args: unknown) => void) => {
        updaters[name] = fn;
        return run;
      },
    });
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
  failNext = null;
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(updaters)) delete updaters[k];
  act(() => {
    resetPanels();
    hudToasts.reset();
  });
});

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = "m1" as Id<"combatMaps">;
const ENC = "e1" as Id<"encounters">;
const OGRE = { tokenId: "tk-ogre" as Id<"combatTokens">, instanceId: "i-ogre" as Id<"encounterAdversaries">, name: "Cave Ogre" };
const ZOMBIES = { tokenId: "tk-z" as Id<"combatTokens">, instanceId: "i-z" as Id<"encounterAdversaries">, name: "Rotted Zombies" };

const instance = (id: Id<"encounterAdversaries">, over: Record<string, unknown> = {}) => ({
  _id: id,
  label: "Cave Ogre",
  hp: 8,
  stress: 3,
  defeated: true,
  stats: { difficulty: 13, major: 8, severe: 15, hpMax: 8, stressMax: 3 },
  conditions: [],
  ...over,
});

function encounter(...instances: ReturnType<typeof instance>[]) {
  queries["encounters:list"] = { active: [{ _id: ENC, status: "running" }], ended: [] };
  queries["encounters:get"] = { encounter: { _id: ENC }, instances };
}

describe("ReviveButton", () => {
  it("is a real button named for the adversary that opens the box with its target", () => {
    const onOpen = vi.fn();
    render(<ReviveButton target={OGRE} onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: "Revive Cave Ogre" });
    expect(btn).toHaveTextContent("Revive");
    expect(btn).toHaveClass("hud-rv-btn");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith(OGRE);
  });
});

describe("ReviveBox", () => {
  it("opens as a modal at full health: 0 of 8 HP and 0 of 3 Stress marked", () => {
    encounter(instance(OGRE.instanceId));
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={() => {}} />);
    const box = screen.getByRole("dialog", { name: "Revive Cave Ogre?" });
    expect(box).toHaveAttribute("open");
    expect(within(box).getByLabelText("0 of 8 Hit Points marked")).toBeInTheDocument();
    expect(within(box).getByLabelText("0 of 3 Stress marked")).toBeInTheDocument();
    expect(within(box).getByTestId("hud-revive-line")).toHaveTextContent("Full health: no HP or Stress marked.");
    expect(within(box).getByRole("button", { name: "Clear 1 Hit Point" })).toBeDisabled();
  });

  it("the GM adjusts the marks (HP stops one short of defeated), then Revive sends one keyed intent and closes", () => {
    encounter(instance(OGRE.instanceId));
    const onClose = vi.fn();
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={onClose} />);
    const markHp = screen.getByRole("button", { name: "Mark 1 Hit Point" });
    for (let i = 0; i < 10; i++) fireEvent.click(markHp);
    expect(screen.getByLabelText("7 of 8 Hit Points marked")).toBeInTheDocument();
    expect(markHp).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear 1 Hit Point" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 Stress" }));
    expect(screen.getByTestId("hud-revive-line")).toHaveTextContent("6 of 8 HP marked, 1 of 3 Stress marked.");
    fireEvent.click(screen.getByRole("button", { name: "Revive" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("encounterTracking:reviveInstance");
    expect(calls[0]!.args).toMatchObject({ campaignId: CAMPAIGN, instanceId: OGRE.instanceId, hp: 6, stress: 1 });
    expect(typeof calls[0]!.args.idempotencyKey).toBe("string");
  });

  it("the optimistic update lifts the token's grey and the instance's defeat at once", () => {
    encounter(instance(OGRE.instanceId));
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={() => {}} />);
    const store: Record<string, unknown> = {
      "combatTokensReads:list": [{ _id: OGRE.tokenId, instanceId: OGRE.instanceId, stats: { hp: 8, stress: 3, down: true } }],
      "encounters:list": queries["encounters:list"],
      "encounters:get": queries["encounters:get"],
    };
    const fake = {
      getQuery: (ref: unknown) => store[functionName(ref)],
      setQuery: (ref: unknown, _args: unknown, value: unknown) => {
        store[functionName(ref)] = value;
      },
    };
    updaters["encounterTracking:reviveInstance"]!(fake, { campaignId: CAMPAIGN, instanceId: OGRE.instanceId, hp: 0, stress: 0, idempotencyKey: "k" });
    expect(store["combatTokensReads:list"]).toEqual([{ _id: OGRE.tokenId, instanceId: OGRE.instanceId, stats: { hp: 0, stress: 0, down: false } }]);
    expect((store["encounters:get"] as { instances: { defeated: boolean; hp: number }[] }).instances[0]).toMatchObject({ hp: 0, stress: 0, defeated: false });
  });

  it("a Minion group steps its fallen Minions: the whole group back by default", () => {
    encounter(instance(ZOMBIES.instanceId, { label: "Rotted Zombies", minionCount: 4, hp: 4, stress: 0, stats: { difficulty: 8, major: 0, severe: 0, hpMax: 4, stressMax: 0 } }));
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={ZOMBIES} onClose={() => {}} />);
    expect(screen.getByTestId("hud-revive-line")).toHaveTextContent("4 of 4 Minions standing.");
    expect(screen.getByLabelText("0 of 4 fallen Minions marked")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Stress marked/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 fallen Minion" }));
    expect(screen.getByTestId("hud-revive-line")).toHaveTextContent("3 of 4 Minions standing.");
    fireEvent.click(screen.getByRole("button", { name: "Revive" }));
    expect(calls[0]!.args).toMatchObject({ instanceId: ZOMBIES.instanceId, hp: 1, stress: 0 });
  });

  it("Cancel closes it without a call; an adversary no longer defeated offers only Cancel", () => {
    encounter(instance(OGRE.instanceId, { hp: 2, defeated: false }));
    const onClose = vi.fn();
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={onClose} />);
    expect(screen.getByText("Cave Ogre is no longer defeated.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revive" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("loading says so", () => {
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Cave Ogre…");
  });

  it("a refusal shows as a toast", async () => {
    encounter(instance(OGRE.instanceId));
    failNext = Object.assign(new Error("x"), { data: { code: "ENCOUNTER_NOT_RUNNING" } });
    render(<ReviveBox campaignId={CAMPAIGN} mapId={MAP} target={OGRE} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revive" }));
    });
    expect(hudToasts.get()).toHaveLength(1);
  });
});

describe("the spotlight popover's defeated row (GM)", () => {
  const state: SpotlightState = { holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, canMove: true, adversaryTokenId: null, adversaryName: null, adversaryPortrait: null };
  const tokens = [
    { _id: "tk-lt", kind: "adversary", instanceId: "i-lt", tracked: true, name: "Lieutenant", sub: "Leader", stats: { hp: 2, hpMax: 6, down: false } },
    { _id: OGRE.tokenId, kind: "adversary", instanceId: OGRE.instanceId, tracked: true, name: "Cave Ogre", sub: "Solo", stats: { hp: 8, hpMax: 8, down: true } },
    // Defeated in an encounter that no longer runs: nothing to revive into.
    { _id: "tk-old", kind: "adversary", instanceId: "i-old", tracked: false, name: "Old Bones", sub: "Standard", stats: { hp: 3, hpMax: 3, down: true } },
  ];

  it("a defeated row of the running encounter carries a Revive pill beside it (not inside it) that opens the box", () => {
    queries["combatSpotlight:state"] = state;
    queries["combatHud:party"] = [];
    queries["combatTokensReads:list"] = tokens;
    encounter(instance(OGRE.instanceId));
    render(<SpotlightDisc campaignId={CAMPAIGN} mapId={MAP} gm fear={3} />);
    fireEvent.click(screen.getByRole("button", { name: /^Spotlight: The party/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Adversaries" }));
    const wraps = screen.getAllByTestId("hud-spotlight-defeated");
    expect(wraps).toHaveLength(2);
    const pill = within(wraps[0]!).getByRole("button", { name: "Revive Cave Ogre" });
    expect(pill.closest(".hud-spr")).toBeNull();
    expect(within(wraps[1]!).queryByRole("button", { name: /Revive/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revive Lieutenant" })).toBeNull();

    fireEvent.click(pill);
    expect(screen.queryByRole("dialog", { name: "Spotlight" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Revive Cave Ogre?" })).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Revive" }));
    expect(calls.map((c) => c.name)).toEqual(["encounterTracking:reviveInstance"]);
    expect(screen.queryByRole("dialog", { name: "Revive Cave Ogre?" })).toBeNull();
  });
});

describe("the revive model", () => {
  it("canRevive: an adversary token of a running encounter that is defeated", () => {
    const t = { kind: "adversary", instanceId: OGRE.instanceId, tracked: true, stats: { hp: 8, hpMax: 8, down: false } };
    expect(canRevive(t)).toBe(true);
    expect(canRevive({ ...t, stats: { hp: 2, hpMax: 8, down: true } })).toBe(true);
    expect(canRevive({ ...t, stats: { hp: 2, hpMax: 8, down: false } })).toBe(false);
    expect(canRevive({ ...t, tracked: false })).toBe(false);
    expect(canRevive({ ...t, kind: "pc" })).toBe(false);
    expect(canRevive({ ...t, stats: null })).toBe(false);
  });

  it("hpCap, stepMarks and reviveLine", () => {
    expect(hpCap(8)).toBe(7);
    expect(hpCap(1)).toBe(0);
    expect(stepMarks(7, 1, 7)).toBe(7);
    expect(stepMarks(0, -1, 7)).toBe(0);
    expect(reviveLine({ hp: 0, stress: 0 }, { hpMax: 8, stressMax: 3 }, false)).toBe("Full health: no HP or Stress marked");
    expect(reviveLine({ hp: 2, stress: 0 }, { hpMax: 8, stressMax: 0 }, false)).toBe("2 of 8 HP marked");
    expect(reviveLine({ hp: 1, stress: 0 }, { hpMax: 4, stressMax: 0 }, true)).toBe("3 of 4 Minions standing");
  });

  it("the optimistic helpers touch only the revived instance", () => {
    const tokens = [
      { instanceId: OGRE.instanceId, stats: { hp: 8, stress: 3, down: true } },
      { instanceId: ZOMBIES.instanceId, stats: { hp: 4, stress: 0, down: true } },
    ];
    expect(afterReviveTokens(tokens, OGRE.instanceId, { hp: 1, stress: 0 })).toEqual([{ instanceId: OGRE.instanceId, stats: { hp: 1, stress: 0, down: false } }, tokens[1]]);
    const rows = [instance(OGRE.instanceId), instance(ZOMBIES.instanceId)];
    expect(afterReviveInstances(rows, ZOMBIES.instanceId, { hp: 0, stress: 0 })[1]).toMatchObject({ hp: 0, stress: 0, defeated: false });
    expect(afterReviveInstances(rows, ZOMBIES.instanceId, { hp: 0, stress: 0 })[0]).toBe(rows[0]);
  });
});
