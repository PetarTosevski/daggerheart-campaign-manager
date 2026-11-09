// Journal JP1 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JP1.md): the Plan view's scenes, the GM prep
// parchment and the right column's scene pick. convex/react returns the results held here; mutations are recorded.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_SCENES } from "../../../convex/lib/validators/sessions";

let results: Record<string, unknown> = {};
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
// JP2's pieces: markers that show what JP1 mounts and with which props.
vi.mock("../../../src/components/journal/plan/encounter", () => ({
  SceneEncounter: ({ sceneId, sceneNumber }: { sceneId: string; sceneNumber: number }) => <div data-testid="encounter">{`${sceneId}:${sceneNumber}`}</div>,
}));
vi.mock("../../../src/components/journal/plan/battle-points", () => ({
  BattlePointsPanel: ({ sceneId, sceneNumber }: { sceneId: string; sceneNumber: number }) => <div data-testid="bp">{`Battle points · Scene ${sceneNumber} (${sceneId})`}</div>,
}));

const { PlanAside, PlanView } = await import("../../../src/components/journal/plan");
const { applySceneState, asideScene, prepBlocks, sceneBadge } = await import("../../../src/lib/journal/plan");

const campaignId = "c1" as Id<"campaigns">;
const sessionId = "s6" as Id<"sessions">;

type Scene = { id: string; type: "combat" | "social" | "exploration" | "downtime"; text: string; title?: string; state?: "planned" | "playing" | "done"; encounter: null };
const sc = (id: string, type: Scene["type"], title: string, state?: Scene["state"]): Scene => ({ id, type, title, text: `${title} text`, state, encounter: null });
const SCENES: Scene[] = [
  sc("a", "exploration", "The old road north", "done"),
  sc("b", "social", "Bargain with the woodcutter", "done"),
  sc("c", "combat", "Jagged Knife ambush at the camp", "playing"),
  sc("d", "downtime", "Rest at the ruined chapel"),
];
const HOOKS = "- Tamsin’s axe is in the Lieutenant’s tent.\n- If the Sniper escapes, it warns the chapel.\nA plain line";

function setPrep(scenes: Scene[] = SCENES, hooks = HOOKS) {
  results["sessionPrep:get"] = { scenes, hooks, encounter: null };
}

const sceneRow = (n: number) => screen.getByRole("listitem", { name: `Scene ${n}` });
const openMenu = (n: number) => fireEvent.click(screen.getByRole("button", { name: `Scene ${n} options` }));

beforeEach(() => {
  calls.list = [];
  results = { "sessionRecords:list": [{ _id: "s6", n: 6, status: "live" }] };
  setPrep();
});
afterEach(cleanup);

describe("pure helpers", () => {
  it("applySceneState: playing makes the playing scene done; done and planned touch one scene", () => {
    const played = applySceneState(SCENES, "d", "playing");
    expect(played.map((s) => s.state)).toEqual(["done", "done", "done", "playing"]);
    expect(applySceneState(SCENES, "c", "planned").map((s) => s.state)).toEqual(["done", "done", undefined, undefined]);
    expect(applySceneState(SCENES, "d", "done").map((s) => s.state)).toEqual(["done", "done", "playing", "done"]);
  });

  it("applySceneState twice (a double click) ends in the same state as once", () => {
    const once = applySceneState(SCENES, "d", "playing");
    expect(applySceneState(once, "d", "playing")).toEqual(once);
  });

  it("sceneBadge: Done, Playing now, Next (nextSceneId) or nothing", () => {
    expect(sceneBadge(SCENES[0]!, "d")).toBe("done");
    expect(sceneBadge(SCENES[2]!, "d")).toBe("playing");
    expect(sceneBadge(SCENES[3]!, "d")).toBe("next");
    expect(sceneBadge(SCENES[3]!, null)).toBeNull();
  });

  it("asideScene: the playing Combat scene, else the first Combat scene, else null", () => {
    expect(asideScene(SCENES)).toEqual({ sceneId: "c", number: 3 });
    const two = [sc("x", "combat", "First"), sc("y", "social", "Talk"), sc("z", "combat", "Second", "playing")];
    expect(asideScene(two)).toEqual({ sceneId: "z", number: 3 });
    expect(asideScene([sc("x", "combat", "First", "done"), sc("z", "combat", "Second")])).toEqual({ sceneId: "x", number: 1 });
    expect(asideScene([sc("y", "social", "Talk", "playing")])).toBeNull();
  });

  it("prepBlocks: runs of '- ' lines are one list, other lines stay lines, blanks drop", () => {
    expect(prepBlocks("- one\n- two\n\nplain\n- three")).toEqual([
      { kind: "list", items: ["one", "two"] },
      { kind: "line", text: "plain" },
      { kind: "list", items: ["three"] },
    ]);
    expect(prepBlocks("  \n")).toEqual([]);
  });
});

describe("PlanView", () => {
  it("shows a loading line, then the scenes with number, type, title, text and state", () => {
    delete results["sessionPrep:get"];
    const { rerender } = render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the plan");
    setPrep();
    rerender(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);

    expect(screen.getByRole("heading", { name: "Planned scenes" })).toBeInTheDocument();
    const first = sceneRow(1);
    expect(within(first).getByText("Exploration")).toBeInTheDocument();
    expect(within(first).getByRole("textbox", { name: "Scene 1 title" })).toHaveValue("The old road north");
    expect(within(first).getByRole("textbox", { name: "Scene 1 description" })).toHaveValue("The old road north text");
    expect(within(first).getByText("Done")).toBeInTheDocument();
    expect(within(sceneRow(3)).getByText("Playing now")).toBeInTheDocument();
    expect(sceneRow(3)).toHaveClass("jp-playing");
    expect(within(sceneRow(4)).getByText("Next")).toBeInTheDocument();
  });

  it("mounts SceneEncounter in Combat scenes only", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getAllByTestId("encounter").map((e) => e.textContent)).toEqual(["c:3"]);
    expect(within(sceneRow(3)).getByTestId("encounter")).toBeInTheDocument();
  });

  it("saves a title and a text on blur, only when they changed", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    const title = screen.getByRole("textbox", { name: "Scene 4 title" });
    fireEvent.focus(title);
    fireEvent.blur(title);
    expect(calls.list).toEqual([]);

    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "  Bells at dusk " } });
    expect(title).toHaveValue("  Bells at dusk ");
    fireEvent.blur(title);
    expect(calls.list).toEqual([{ name: "sessionPrep:setScene", args: { campaignId, sessionId, sceneId: "d", title: "  Bells at dusk " } }]);

    const text = screen.getByRole("textbox", { name: "Scene 2 description" });
    fireEvent.focus(text);
    fireEvent.change(text, { target: { value: "She wants the axe." } });
    fireEvent.keyDown(text, { key: "Enter" });
    fireEvent.blur(text);
    expect(calls.list.at(-1)).toEqual({ name: "sessionPrep:setScene", args: { campaignId, sessionId, sceneId: "b", text: "She wants the axe." } });
  });

  it("the scene menu plays a non-combat scene, marks done, back to planned, changes the type and removes", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    openMenu(4);
    fireEvent.click(screen.getByRole("button", { name: "Play this scene" }));
    expect(calls.list.at(-1)).toEqual({ name: "sessionPrep:setSceneState", args: { campaignId, sessionId, sceneId: "d", state: "playing" } });
    // The menu closes after a pick.
    expect(screen.queryByRole("button", { name: "Play this scene" })).not.toBeInTheDocument();

    openMenu(1);
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to planned" }));
    expect(calls.list.at(-1)?.args).toMatchObject({ sceneId: "a", state: "planned" });

    openMenu(4);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(calls.list.at(-1)?.args).toMatchObject({ sceneId: "d", state: "done" });

    openMenu(2);
    expect(screen.getByRole("button", { name: "Social" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Exploration" }));
    expect(calls.list.at(-1)).toEqual({ name: "sessionPrep:setScene", args: { campaignId, sessionId, sceneId: "b", type: "exploration" } });

    openMenu(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove scene" }));
    expect(calls.list.at(-1)).toEqual({ name: "sessionPrep:removeScene", args: { campaignId, sessionId, sceneId: "b" } });
  });

  it("a Combat scene plays from the Combat Map (Q7): no 'Play this scene', a hint instead", () => {
    setPrep([sc("c", "combat", "Ambush")]);
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    openMenu(1);
    expect(screen.queryByRole("button", { name: "Play this scene" })).not.toBeInTheDocument();
    expect(screen.getByText("Plays when its encounter goes on the Combat Map.")).toBeInTheDocument();
  });

  it("a played session's scenes cannot start playing", () => {
    results["sessionRecords:list"] = [{ _id: "s6", n: 6, status: "played" }];
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    openMenu(4);
    expect(screen.queryByRole("button", { name: "Play this scene" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });

  it("Escape closes the menu and returns focus to its button", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    openMenu(4);
    expect(screen.getByRole("button", { name: "Scene 4 options" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Scene 4 options" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Scene 4 options" })).toHaveFocus();
  });

  it("'+ Add scene' asks the type first (dcm-z9rz.30), then adds one; it is off at MAX_SCENES; an empty plan shows the hint", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    const before = calls.list.length;
    const add = screen.getByRole("button", { name: "Add scene" });
    fireEvent.click(add);
    expect(calls.list.length).toBe(before);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Scene type" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Exploration", "Social", "Combat", "Downtime", "Cancel"]);
    expect(within(group).getByRole("button", { name: "Exploration" })).toHaveFocus();
    // Escape closes it without adding, focus back on the button.
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Scene type" })).toBeNull();
    expect(add).toHaveFocus();
    expect(calls.list.length).toBe(before);
    fireEvent.click(add);
    fireEvent.click(within(screen.getByRole("group", { name: "Scene type" })).getByRole("button", { name: "Social" }));
    expect(calls.list.at(-1)).toEqual({ name: "sessionPrep:addScene", args: { campaignId, sessionId, type: "social" } });
    expect(screen.queryByRole("group", { name: "Scene type" })).toBeNull();
    cleanup();

    setPrep(Array.from({ length: MAX_SCENES }, (_, i) => sc(`s${i}`, "social", `S${i}`)));
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByRole("button", { name: "Add scene" })).toBeDisabled();
    cleanup();

    setPrep([], "");
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByText(/Plan a few scenes/)).toBeInTheDocument();
  });

  it("a scene the server has not confirmed is read only", () => {
    setPrep([sc("pending:0", "combat", "")]);
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByRole("textbox", { name: "Scene 1 title" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Scene 1 options" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("encounter")).not.toBeInTheDocument();
  });

  it("GM prep: bullets for '- ' lines; Edit opens the text, leaving it saves once", () => {
    render(<PlanView campaignId={campaignId} isGm sessionId={sessionId} />);
    const items = screen.getAllByRole("listitem").filter((li) => li.closest(".jp-prep"));
    expect(items.map((li) => li.textContent)).toEqual(["Tamsin’s axe is in the Lieutenant’s tent.", "If the Sniper escapes, it warns the chapel."]);
    expect(screen.getByText("A plain line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit GM prep" }));
    const field = screen.getByRole("textbox", { name: "GM prep" });
    expect(field).toHaveValue(HOOKS);
    fireEvent.blur(field);
    expect(calls.list).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Edit GM prep" }));
    fireEvent.change(screen.getByRole("textbox", { name: "GM prep" }), { target: { value: "- New hook" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "GM prep" }));
    expect(calls.list).toEqual([{ name: "sessionPrep:setHooks", args: { campaignId, sessionId, hooks: "- New hook" } }]);
    expect(screen.queryByRole("textbox", { name: "GM prep" })).not.toBeInTheDocument();
  });
});

describe("PlanAside", () => {
  it("frames the Battle Points of the playing Combat scene, else the first one, else nothing", () => {
    const { rerender, container } = render(<PlanAside campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByTestId("bp")).toHaveTextContent("Battle points · Scene 3 (c)");

    setPrep([sc("x", "combat", "First", "done"), sc("y", "social", "Talk", "playing"), sc("z", "combat", "Second")]);
    rerender(<PlanAside campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByTestId("bp")).toHaveTextContent("Battle points · Scene 1 (x)");

    setPrep([sc("y", "social", "Talk")]);
    rerender(<PlanAside campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(container).toBeEmptyDOMElement();

    delete results["sessionPrep:get"];
    rerender(<PlanAside campaignId={campaignId} isGm sessionId={sessionId} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the Battle Points");
  });
});
