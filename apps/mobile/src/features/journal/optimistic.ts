import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";

import { spotlight as zeroSpotlight } from "../../../../../src/lib/domain/sessions";
import type { JournalLog, JournalLogLine } from "../../../../../convex/journalLog";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { api, type Id } from "../../convex";
import { PENDING_LINE, PENDING_SCENE, withSceneState, type Prep } from "./model";

/**
 * The Journal's optimistic updates (rule 12: a tap with visible latency shows at once), the same patches the website's
 * Journal slots apply. The test harness's mutations are plain functions without `withOptimisticUpdate`.
 */
export function useOptimistic<M extends FunctionReference<"mutation">>(
  ref: M,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  const mutation = useMutation(ref);
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

type CampaignArgs = { campaignId: Id<"campaigns"> };
type SessionArgs = CampaignArgs & { sessionId: string };

/** One session of the cached `sessionRecords.list`. */
export function patchSession(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, patch: Partial<SessionListItem>) {
  const list = store.getQuery(api.sessionRecords.list, { campaignId });
  if (list === undefined) return;
  store.setQuery(
    api.sessionRecords.list,
    { campaignId },
    list.map((s) => (s._id === sessionId ? { ...s, ...patch } : s)),
  );
}

/** The cached `sessionPrep.get` of one session. */
export function patchPrep(store: OptimisticLocalStore, args: SessionArgs, change: (prep: Prep) => Prep) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const prep = store.getQuery(api.sessionPrep.get, key);
  if (prep !== undefined) store.setQuery(api.sessionPrep.get, key, change(prep));
}

export const prepPatches = {
  addScene: (store: OptimisticLocalStore, args: SessionArgs & { type?: Prep["scenes"][number]["type"] }) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: [...prep.scenes, { id: `${PENDING_SCENE}${prep.scenes.length}`, type: args.type ?? "combat", text: "", encounter: null }],
    })),
  setScene: (
    store: OptimisticLocalStore,
    args: SessionArgs & { sceneId: string; type?: Prep["scenes"][number]["type"]; text?: string; title?: string },
  ) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => {
        if (s.id !== args.sceneId) return s;
        if (args.type !== undefined) return args.type === "combat" ? { ...s, type: args.type } : { ...s, type: args.type, encounterId: undefined, encounter: null };
        if (args.text !== undefined) return { ...s, text: args.text.trim() };
        const title = (args.title ?? "").trim();
        return { ...s, title: title === "" ? undefined : title };
      }),
    })),
  setSceneState: (store: OptimisticLocalStore, args: SessionArgs & { sceneId: string; state: "planned" | "playing" | "done" }) =>
    patchPrep(store, args, (prep) => ({ ...prep, scenes: withSceneState(prep.scenes, args.sceneId, args.state) })),
  removeScene: (store: OptimisticLocalStore, args: SessionArgs & { sceneId: string }) =>
    patchPrep(store, args, (prep) => ({ ...prep, scenes: prep.scenes.filter((s) => s.id !== args.sceneId) })),
  setHooks: (store: OptimisticLocalStore, args: SessionArgs & { hooks: string }) =>
    patchPrep(store, args, (prep) => ({ ...prep, hooks: args.hooks.trim() })),
  unlink: (store: OptimisticLocalStore, args: SessionArgs & { sceneId: string }) =>
    patchPrep(store, args, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => (s.id === args.sceneId ? { ...s, encounterId: undefined, encounter: null } : s)),
    })),
};

/** The cached `journalLog.list` of one session. */
function patchLog(store: OptimisticLocalStore, args: SessionArgs, change: (log: JournalLog) => JournalLog) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const log = store.getQuery(api.journalLog.list, key);
  if (log !== undefined) store.setQuery(api.journalLog.list, key, change(log));
}

/** One line (by source and source id) of the cached log of one session. */
function patchOneLine(
  store: OptimisticLocalStore,
  args: SessionArgs & { source: string; sourceId: string },
  change: (line: JournalLogLine) => JournalLogLine,
) {
  patchLog(store, args, (log) => ({
    ...log,
    lines: log.lines.map((line) => (line.source === args.source && line.sourceId === args.sourceId ? change(line) : line)),
  }));
}

export const logPatches = {
  add: (store: OptimisticLocalStore, args: SessionArgs & { text: string; idempotencyKey: string }) => {
    const sourceId = `${PENDING_LINE}${args.idempotencyKey}`;
    const line: JournalLogLine = {
      key: `gm:${sourceId}`,
      source: "gm",
      sourceId,
      at: Date.now(),
      title: args.text.trim(),
      icon: "note",
      hidden: false,
      edited: false,
      removable: true,
    };
    patchLog(store, args, (log) => ({ ...log, lines: [...log.lines, line] }));
  },
  remove: (store: OptimisticLocalStore, args: SessionArgs & { logId: string }) =>
    patchLog(store, args, (log) => ({ ...log, lines: log.lines.filter((l) => !(l.source === "gm" && l.sourceId === args.logId)) })),
  hidden:
    (hidden: boolean) =>
    (store: OptimisticLocalStore, args: SessionArgs & { source: string; sourceId: string }) =>
      patchOneLine(store, args, (line) => ({ ...line, hidden })),
  /** An empty text on a generated line drops the re-wording; its own words are not known here, so it waits. */
  text: (store: OptimisticLocalStore, args: SessionArgs & { source: string; sourceId: string; text: string }) => {
    const text = args.text.trim();
    if (text !== "") patchOneLine(store, args, (line) => ({ ...line, title: text, edited: true }));
  },
};

/** Reset: every count of the cached Journal spotlight to 0, all due. */
export function resetSpotlight(store: OptimisticLocalStore, args: SessionArgs) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const entries = store.getQuery(api.journalTally.spotlight, key);
  if (!entries) return;
  const names = new Map(entries.map((e) => [e.characterId, e.name]));
  const zeroed = zeroSpotlight(
    entries.map((e) => e.characterId),
    [],
  ).map((e) => ({ ...e, name: names.get(e.characterId) ?? "Unnamed character" }));
  store.setQuery(api.journalTally.spotlight, key, zeroed);
}

/** The recap: the GM's `sessionWrap.get` and a player's `sessionRecords.list` row. */
export function patchRecap(store: OptimisticLocalStore, args: SessionArgs & { recap: string }) {
  const recap = args.recap.trim() || undefined;
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const wrap = store.getQuery(api.sessionWrap.get, key);
  if (wrap) store.setQuery(api.sessionWrap.get, key, { ...wrap, recap });
  patchSession(store, args.campaignId, args.sessionId, { recap });
}

/** Loot on the cached `sessionWrap.after`. */
export function patchLoot(store: OptimisticLocalStore, args: SessionArgs & { loot: string }) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const after = store.getQuery(api.sessionWrap.after, key);
  if (after) store.setQuery(api.sessionWrap.after, key, { ...after, loot: args.loot.trim() || null });
}

/** 'Allow extra characters this session' on the cached `sessions.current`. */
export function patchExtras(store: OptimisticLocalStore, args: CampaignArgs & { allow: boolean }) {
  const current = store.getQuery(api.sessions.current, { campaignId: args.campaignId });
  if (current) store.setQuery(api.sessions.current, { campaignId: args.campaignId }, { ...current, extraCharacters: args.allow });
}
