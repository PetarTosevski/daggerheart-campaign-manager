"use client";

import { useMutation } from "convex/react";
import { Check, Ellipsis, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { nextSceneId } from "@/lib/domain/journal/scenes";
import { ADD_SCENE_TYPES, PENDING, prepPatches, sceneBadge, type PrepScene, type SceneBadge } from "@/lib/journal/plan";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_SCENES, SESSION_SCENE_TYPES, SESSION_TEXT_MAX, type SessionSceneType, type SessionStatus } from "../../../../convex/lib/validators/sessions";
import { SCENE_TYPE_DISPLAY, TypeChip } from "../ui";
import { SceneEncounter } from "./encounter";

/**
 * 'Planned scenes' (JP1, design reference/designs/journal/journal_views.jpg, Plan): one row per scene with its number,
 * type chip, title and serif text (both edited in place, saved on blur), its state on the right (Done / Playing now /
 * Next) and the GM's scene menu (Play this scene, Mark done, Back to planned, the type, Remove). A Combat scene mounts
 * JP2's `SceneEncounter` under its text. User answer Q7: a Combat scene starts playing from the Combat Map (its
 * encounter placed with '+ Session encounter'), so its menu has no 'Play this scene'; the GM marks the other scenes.
 */

export type PlanIds = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

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
      <BrandButton
        ref={button}
        variant="neutral"
        icon
        round
        aria-label={`Scene ${n} options`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis aria-hidden="true" />
      </BrandButton>
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

  const setScene = useMutation(api.sessionPrep.setScene).withOptimisticUpdate(prepPatches.setScene);
  const setState = useMutation(api.sessionPrep.setSceneState).withOptimisticUpdate(prepPatches.setSceneState);
  const removeScene = useMutation(api.sessionPrep.removeScene).withOptimisticUpdate(prepPatches.removeScene);

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
                <BrandButton variant="neutral" size="sm" className="w-full" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "playing" }))}>
                  Play this scene
                </BrandButton>
              ) : null}
              {combat && state === "planned" ? <p className="jp-hint">Plays when its encounter goes on the Combat Map.</p> : null}
              {state !== "done" ? (
                <BrandButton variant="neutral" size="sm" className="w-full" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "done" }))}>
                  Mark done
                </BrandButton>
              ) : null}
              {state !== "planned" ? (
                <BrandButton variant="neutral" size="sm" className="w-full" onClick={() => run(setState({ ...ids, sceneId: scene.id, state: "planned" }))}>
                  Back to planned
                </BrandButton>
              ) : null}
              <div role="group" aria-labelledby={typeGroup} className="jp-types">
                <span id={typeGroup} className="jr-lbl">
                  Type
                </span>
                {SESSION_SCENE_TYPES.map((type) => (
                  <BrandButton
                    key={type}
                    variant="neutral"
                    size="sm"
                    className="jp-type-opt w-full"
                    aria-pressed={scene.type === type}
                    onClick={() => {
                      if (type !== scene.type) run(setScene({ ...ids, sceneId: scene.id, type }));
                    }}
                  >
                    {SCENE_TYPE_DISPLAY[type].label}
                  </BrandButton>
                ))}
              </div>
              <BrandButton variant="danger" size="sm" className="w-full" onClick={() => run(removeScene({ ...ids, sceneId: scene.id }))}>
                Remove scene
              </BrandButton>
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

/**
 * '+ Add scene' asks the scene's type first (dcm-z9rz.30): the button opens a row of the four types and Cancel
 * (Escape closes it too); picking one adds the scene (optimistic: the row shows at once, disabled until the server's id
 * arrives). Refused past MAX_SCENES.
 */
export function AddSceneButton({ ids, count }: { ids: PlanIds; count: number }) {
  const { error, run } = useRun();
  const [picking, setPicking] = useState(false);
  const groupId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const addScene = useMutation(api.sessionPrep.addScene).withOptimisticUpdate(prepPatches.addScene);
  const full = count >= MAX_SCENES;

  function close() {
    setPicking(false);
    opener.current?.focus();
  }

  function pick(type: SessionSceneType) {
    close();
    run(addScene({ ...ids, type }));
  }

  return (
    <div className="jp-add">
      <BrandButton
        ref={opener}
        variant="neutral"
        size="sm"
        disabled={full}
        aria-expanded={picking && !full}
        aria-controls={groupId}
        title={full ? `A session holds at most ${MAX_SCENES} scenes.` : undefined}
        onClick={() => setPicking((v) => !v)}
      >
        <Plus aria-hidden="true" />
        Add scene
      </BrandButton>
      {picking && !full ? (
        <div
          id={groupId}
          role="group"
          aria-labelledby={`${groupId}-l`}
          className="jp-add-types"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <span id={`${groupId}-l`} className="jr-lbl">
            Scene type
          </span>
          {ADD_SCENE_TYPES.map((type, i) => (
            <BrandButton key={type} variant="neutral" size="sm" autoFocus={i === 0} onClick={() => pick(type)}>
              {SCENE_TYPE_DISPLAY[type].label}
            </BrandButton>
          ))}
          <BrandButton variant="neutral" size="sm" onClick={close}>
            Cancel
          </BrandButton>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="jp-error">
          {error}
        </p>
      ) : null}
    </div>
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

