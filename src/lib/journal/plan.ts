import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SessionSceneState, SessionSceneType } from "../../../convex/lib/validators/sessions";
import { BP_COSTS, minionGroups } from "../domain/encounters/budget";

/**
 * The Journal's Plan view (JP1, JP2), shared by the website and the phone (dcm-gdzi.46): the scenes as the server
 * applies them, the optimistic patches of `sessionPrep.get`, which Combat scene's Battle Points show, the GM prep note
 * read as paper, and an encounter's adversary chips.
 */

export type Prep = FunctionReturnType<typeof api.sessionPrep.get>;
export type PrepScene = Prep["scenes"][number];

/** Ids of scenes the server has not confirmed yet (optimistic '+ Add scene'); they wait for the real id. */
export const PENDING = "pending:";

/** The order '+ Add scene' offers the types in (dcm-z9rz.30: Exploration / Social / Combat / Downtime). */
export const ADD_SCENE_TYPES: readonly SessionSceneType[] = ["exploration", "social", "combat", "downtime"];

type PrepArgs = { campaignId: Id<"campaigns">; sessionId: string };

/** Patches the cached `sessionPrep.get` (the optimistic updates of the plan's intents); never mutates the store's object. */
export function patchPrep(store: OptimisticLocalStore, args: PrepArgs, patch: (prep: Prep) => Prep) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const current = store.getQuery(api.sessionPrep.get, key);
  if (current !== undefined) store.setQuery(api.sessionPrep.get, key, patch(current));
}

/** `setSceneState` as the server applies it: 'playing' makes the scene that was playing Done (`playScene`). */
export function applySceneState(scenes: readonly PrepScene[], sceneId: string, state: SessionSceneState): PrepScene[] {
  return scenes.map((s) => {
    if (s.id === sceneId) return { ...s, state: state === "planned" ? undefined : state };
    return state === "playing" && s.state === "playing" ? { ...s, state: "done" as const } : s;
  });
}

/** The optimistic updates of the plan's intents (`sessionPrep.*`), as each mutation's server change. */
export const prepPatches = {
  /** '+ Add scene': the row shows at once with a pending id until the server's arrives. */
  addScene: (store: OptimisticLocalStore, args: PrepArgs & { type?: SessionSceneType }) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: [...prep.scenes, { id: `${PENDING}${prep.scenes.length}`, type: args.type ?? "combat", text: "", encounter: null }],
    })),
  /** One field of a scene: its type (leaving Combat unlinks the encounter), its text or its title (empty clears it). */
  setScene: (store: OptimisticLocalStore, args: PrepArgs & { sceneId: string; type?: SessionSceneType; text?: string; title?: string }) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => {
        if (s.id !== args.sceneId) return s;
        if (args.type !== undefined) return args.type === "combat" ? { ...s, type: args.type } : { ...s, type: args.type, encounterId: undefined, encounter: null };
        if (args.text !== undefined) return { ...s, text: args.text.trim() };
        const clean = (args.title ?? "").trim();
        return { ...s, title: clean === "" ? undefined : clean };
      }),
    })),
  setSceneState: (store: OptimisticLocalStore, args: PrepArgs & { sceneId: string; state: SessionSceneState }) =>
    patchPrep(store, args, (prep) => ({ ...prep, scenes: applySceneState(prep.scenes, args.sceneId, args.state) })),
  removeScene: (store: OptimisticLocalStore, args: PrepArgs & { sceneId: string }) =>
    patchPrep(store, args, (prep) => ({ ...prep, scenes: prep.scenes.filter((s) => s.id !== args.sceneId) })),
  setHooks: (store: OptimisticLocalStore, args: PrepArgs & { hooks: string }) =>
    patchPrep(store, args, (prep) => ({ ...prep, hooks: args.hooks.trim() })),
  /** `unlinkSceneEncounter`: the Combat scene keeps no encounter. */
  unlink: (store: OptimisticLocalStore, args: PrepArgs & { sceneId: string }) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => (s.id === args.sceneId ? { ...s, encounterId: undefined, encounter: null } : s)),
    })),
};

/** What a scene's right side shows: its state, or 'Next' (`nextSceneId`), or nothing. */
export type SceneBadge = "done" | "playing" | "next" | null;

export function sceneBadge(scene: Pick<PrepScene, "id" | "state">, nextId: string | null): SceneBadge {
  if (scene.state === "done") return "done";
  if (scene.state === "playing") return "playing";
  return scene.id === nextId ? "next" : null;
}

/**
 * The Combat scene whose Battle Points the plan shows: the playing Combat scene, else the first Combat scene; null
 * without one. `number` is 1-based ('Scene N'). Pass the confirmed scenes (no `PENDING` ids).
 */
export function asideScene(scenes: readonly Pick<PrepScene, "id" | "type" | "state">[]): { sceneId: string; number: number } | null {
  let index = scenes.findIndex((s) => s.type === "combat" && s.state === "playing");
  if (index === -1) index = scenes.findIndex((s) => s.type === "combat");
  return index === -1 ? null : { sceneId: scenes[index]!.id, number: index + 1 };
}

/** A block of the prep note: a run of '- ' lines (a bullet list) or one plain line. */
export type PrepBlock = { kind: "list"; items: string[] } | { kind: "line"; text: string };

/** Splits the hooks text into blocks: consecutive '- ' lines form one list; blank lines are dropped. */
export function prepBlocks(text: string): PrepBlock[] {
  const blocks: PrepBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else {
      blocks.push({ kind: "line", text: line });
    }
  }
  return blocks;
}

/** One instance of `encounters.get` for an encounter that exists. */
export type EncounterInstance = NonNullable<FunctionReturnType<typeof api.encounters.get>>["instances"][number];

/** One adversary chip: a stat block's instances together ('Bandit ×2', 'Lackey ×4' for a Minion group). */
export type EncounterChip = { key: string; name: string; count: number; type: string | null; bp: number };

/**
 * The encounter's instances (`encounters.get`) as the board's chips: instances of one stat block (same name, type and
 * summoned flag) share a chip with their count (a Minion group counts its size) and their Battle Points (CB p.197:
 * the type's cost each; Minions per group the size of the party; summoned or unknown = 0). In first-added order.
 */
export function encounterChips(instances: readonly EncounterInstance[], pcs: number): EncounterChip[] {
  const groups = new Map<string, { name: string; type: EncounterInstance["type"]; items: EncounterInstance[] }>();
  for (const i of instances) {
    const name = i.name ?? i.label;
    const key = `${name}|${i.type ?? ""}|${i.summoned ? "s" : ""}`;
    const group = groups.get(key) ?? { name, type: i.type, items: [] };
    group.items.push(i);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { name, type, items }]) => {
    const count = items.reduce((n, i) => n + (i.minionCount ?? 1), 0);
    const counted = items.filter((i) => !i.summoned);
    let bp = 0;
    if (type === "Minion") bp = minionGroups(counted, pcs);
    else if (type !== null) bp = BP_COSTS[type] * counted.length;
    return { key, name, count, type, bp };
  });
}
