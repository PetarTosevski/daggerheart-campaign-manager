"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { Check, Ellipsis, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { brandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { nextSceneId } from "@/lib/domain/journal/scenes";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_SCENES, SESSION_SCENE_TYPES, SESSION_TEXT_MAX, type SessionSceneState, type SessionStatus } from "../../../../convex/lib/validators/sessions";
import { SCENE_TYPE_DISPLAY, TypeChip } from "../ui";
import { SceneEncounter } from "./encounter";

/**
 * 'Planned scenes' (JP1, design reference/designs/journal/journal_views.jpg, Plan): one row per scene with its number,
 * type chip, title and serif text (both edited in place, saved on blur), its state on the right (Done / Playing now /
 * Next) and the GM's scene menu (Play this scene, Mark done, Back to planned, the type, Remove). A Combat scene mounts
 * JP2's `SceneEncounter` under its text. User answer Q7: a Combat scene starts playing from the Combat Map (its
 * encounter placed with '+ Session encounter'), so its menu has no 'Play this scene'; the GM marks the other scenes.
 */

export type Prep = FunctionReturnType<typeof api.sessionPrep.get>;
export type PrepScene = Prep["scenes"][number];
export type PlanIds = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/** Ids of scenes the server has not confirmed yet (optimistic '+ Add scene'); they wait for the real id. */
export const PENDING = "pending:";

/** Patches the cached `sessionPrep.get` (the optimistic updates of the plan's intents); never mutates the store's object. */
export function patchPrep(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; sessionId: string }, patch: (prep: Prep) => Prep) {
  const current = store.getQuery(api.sessionPrep.get, args);
  if (current !== undefined) store.setQuery(api.sessionPrep.get, args, patch(current));
}

/** `setSceneState` as the server applies it: 'playing' makes the scene that was playing Done (`playScene`). */
export function applySceneState(scenes: readonly PrepScene[], sceneId: string, state: SessionSceneState): PrepScene[] {
  return scenes.map((s) => {
    if (s.id === sceneId) return { ...s, state: state === "planned" ? undefined : state };
    return state === "playing" && s.state === "playing" ? { ...s, state: "done" as const } : s;
  });
}

/** What a scene's right side shows: its state, or 'Next' (`nextSceneId`), or nothing. */
export type SceneBadge = "done" | "playing" | "next" | null;

export function sceneBadge(scene: Pick<PrepScene, "id" | "state">, nextId: string | null): SceneBadge {
  if (scene.state === "done") return "done";
  if (scene.state === "playing") return "playing";
  return scene.id === nextId ? "next" : null;
}

/** Runs an intent and keeps its error for the row's alert. */
export function useRun() {
  const [error, setError] = useState<string | null>(null);
  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }
  return { error, run };
}

/**
 * A text field that shows the server's value and keeps its own draft only while focused (CL7: re-sync while
 * unfocused, no effect, no content key). `onSave` runs on blur when the trimmed text changed.
 */
function useBlurDraft(value: string, onSave: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onChange: (e: { currentTarget: { value: string } }) => setDraft(e.currentTarget.value),
    onBlur: () => {
      const text = draft;
      setDraft(null);
      if (text !== null && text.trim() !== value) onSave(text);
    },
  };
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.currentTarget.blur();
  }
};

function StateBadge({ badge }: { badge: SceneBadge }) {
  if (badge === "done")
    return (
      <span className="jp-state" data-state="done">
        <Check aria-hidden="true" />
        Done
      </span>
    );
  if (badge === "playing")
    return (
      <span className="jp-state" data-state="playing">
        <span className="jr-dot" aria-hidden="true" />
        Playing now
      </span>
    );
  if (badge === "next")
    return (
      <span className="jp-state" data-state="next">
        Next
      </span>
    );
  return null;
}

/** The GM's '⋯' menu on a scene (a disclosure: plain buttons, closed by Escape or a click outside). */
function SceneMenu({ n, children }: { n: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Picking any item closes the menu and returns focus to its button.
  function onPanelClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target as HTMLElement).closest("button")) return;
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div ref={root} className="jp-menu">
      <button
        ref={button}
        type="button"
        className="jp-menu-btn"
        aria-label={`Scene ${n} options`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {/* The clicks land on the buttons inside; this only closes the menu after one. */}
      <div id={panelId} className="jp-menu-panel" hidden={!open} onClick={onPanelClick}>
        {open ? children : null}
      </div>
    </div>
  );
}

function SceneRow({
  ids,
  scene,
  index,
  badge,
  sessionStatus,
}: {
  ids: PlanIds;
  scene: PrepScene;
  index: number;
  badge: SceneBadge;
  sessionStatus: SessionStatus | undefined;
}) {
  const { error, run } = useRun();
  const n = index + 1;
  const pending = scene.id.startsWith(PENDING);
  const typeGroup = useId();

  const setScene = useMutation(api.sessionPrep.setScene).withOptimisticUpdate((store, { campaignId, sessionId, sceneId, type, text, title }) =>
    patchPrep(store, { campaignId, sessionId }, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        if (type !== undefined) return type === "combat" ? { ...s, type } : { ...s, type, encounterId: undefined, encounter: null };
        if (text !== undefined) return { ...s, text: text.trim() };
        const clean = (title ?? "").trim();
        return { ...s, title: clean === "" ? undefined : clean };
      }),
    })),
  );
  const setState = useMutation(api.sessionPrep.setSceneState).withOptimisticUpdate((store, { campaignId, sessionId, sceneId, state }) =>
    patchPrep(store, { campaignId, sessionId }, (prep) => ({ ...prep, scenes: applySceneState(prep.scenes, sceneId, state) })),
  );
  const removeScene = useMutation(api.sessionPrep.removeScene).withOptimisticUpdate((store, { campaignId, sessionId, sceneId }) =>
    patchPrep(store, { campaignId, sessionId }, (prep) => ({ ...prep, scenes: prep.scenes.filter((s) => s.id !== sceneId) })),
  );

  const title = useBlurDraft(scene.title ?? "", (text) => run(setScene({ ...ids, sceneId: scene.id, title: text })));
  const text = useBlurDraft(scene.text, (value) => run(setScene({ ...ids, sceneId: scene.id, text: value })));

  const state = scene.state ?? "planned";
  const combat = scene.type === "combat";
  // Q7: a Combat scene plays from the Combat Map; a played session's scenes cannot start playing (the server refuses).
  const canPlay = !combat && state !== "playing" && sessionStatus !== "played";

  return (
    <li className={cn("jp-scene", state === "playing" && "jp-playing")} data-state={state} aria-label={`Scene ${n}`}>
      <span className="jp-num" aria-hidden="true">
        {n}
      </span>
      <div className="jp-body">
        <div className="jp-row">
          <TypeChip type={scene.type} />
          <textarea
            className="jp-title"
            rows={1}
            aria-label={`Scene ${n} title`}
            placeholder="Name this scene"
            maxLength={SESSION_TEXT_MAX.sceneTitle}
            disabled={pending}
            onKeyDown={blurOnEnter}
            {...title}
          />
          <StateBadge badge={badge} />
          {pending ? null : (
            <SceneMenu n={n}>
              {canPlay ? (
                <button type="button" className="jp-item" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "playing" }))}>
                  Play this scene
                </button>
              ) : null}
              {combat && state === "planned" ? <p className="jp-hint">Plays when its encounter goes on the Combat Map.</p> : null}
              {state !== "done" ? (
                <button type="button" className="jp-item" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "done" }))}>
                  Mark done
                </button>
              ) : null}
              {state !== "planned" ? (
                <button type="button" className="jp-item" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "planned" }))}>
                  Back to planned
                </button>
              ) : null}
              <div role="group" aria-labelledby={typeGroup} className="jp-types">
                <span id={typeGroup} className="jr-lbl">
                  Type
                </span>
                {SESSION_SCENE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="jp-item"
                    aria-pressed={scene.type === type}
                    onClick={() => {
                      if (type !== scene.type) run(setScene({ ...ids, sceneId: scene.id, type }));
                    }}
                  >
                    {SCENE_TYPE_DISPLAY[type].label}
                  </button>
                ))}
              </div>
              <button type="button" className="jp-item jp-danger" onClick={() => run(removeScene({ ...ids, sceneId: scene.id }))}>
                Remove scene
              </button>
            </SceneMenu>
          )}
        </div>
        <textarea
          className="jp-text"
          rows={1}
          aria-label={`Scene ${n} description`}
          placeholder="What happens here?"
          maxLength={SESSION_TEXT_MAX.scene}
          disabled={pending}
          onKeyDown={blurOnEnter}
          {...text}
        />
        {combat && !pending ? <SceneEncounter campaignId={ids.campaignId} isGm sessionId={ids.sessionId} sceneId={scene.id} sceneNumber={n} /> : null}
        {error ? (
          <p role="alert" className="jp-error">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** '+ Add scene' (optimistic: the row shows at once, disabled until the server's id arrives). Refused past MAX_SCENES. */
export function AddSceneButton({ ids, count }: { ids: PlanIds; count: number }) {
  const { error, run } = useRun();
  const addScene = useMutation(api.sessionPrep.addScene).withOptimisticUpdate((store, args) =>
    patchPrep(store, { campaignId: args.campaignId, sessionId: args.sessionId }, (prep) => ({
      ...prep,
      scenes: [...prep.scenes, { id: `${PENDING}${prep.scenes.length}`, type: args.type ?? "combat", text: "", encounter: null }],
    })),
  );
  const full = count >= MAX_SCENES;
  return (
    <>
      <button
        type="button"
        className={brandButton({ variant: "pill", size: "sm" })}
        disabled={full}
        title={full ? `A session holds at most ${MAX_SCENES} scenes.` : undefined}
        onClick={() => run(addScene(ids))}
      >
        <Plus aria-hidden="true" />
        Add scene
      </button>
      {error ? (
        <p role="alert" className="jp-error">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** The scene rows (the card and '+ Add scene' are PlanView's). */
export function SceneList({ ids, scenes, sessionStatus }: { ids: PlanIds; scenes: readonly PrepScene[]; sessionStatus: SessionStatus | undefined }) {
  if (scenes.length === 0) {
    return <p className="jr-muted jr-m0">Plan a few scenes: a fight, a conversation, a place to explore. Keep them loose; the players will take things elsewhere.</p>;
  }
  const nextId = nextSceneId(scenes);
  return (
    <ol className="jp-scenes" aria-label="Planned scenes">
      {scenes.map((scene, i) => (
        <SceneRow key={scene.id} ids={ids} scene={scene} index={i} badge={sceneBadge(scene, nextId)} sessionStatus={sessionStatus} />
      ))}
    </ol>
  );
}

