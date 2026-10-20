"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useState, type KeyboardEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_SCENES, SESSION_SCENE_TYPES, SESSION_TEXT_MAX, type SessionScene, type SessionSceneType } from "../../../../convex/lib/validators/sessions";

type Prep = FunctionReturnType<typeof api.sessionPrep.get>;
type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/** The board's labels for the scene types (B3). */
const SCENE_LABEL: Record<SessionSceneType, string> = { combat: "Combat", social: "Social", exploration: "Exploration", downtime: "Downtime" };
/** Ids of scenes the server has not confirmed yet (optimistic '+ Scene'); their fields wait for the real id. */
const PENDING = "pending:";

/** Patches the cached `sessionPrep.get` (optimistic updates for the scene and hook intents). */
function patchPrep(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; sessionId: string }, patch: (prep: Prep) => Prep) {
  const current = store.getQuery(api.sessionPrep.get, args);
  if (current) store.setQuery(api.sessionPrep.get, args, patch(current));
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

function useRun() {
  const [error, setError] = useState<string | null>(null);
  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }
  return { error, run };
}

function SceneRow({ ids, scene, index }: { ids: Ids; scene: SessionScene; index: number }) {
  const { error, run } = useRun();
  const pending = scene.id.startsWith(PENDING);
  const setScene = useMutation(api.sessionPrep.setScene).withOptimisticUpdate((store, { campaignId, sessionId, sceneId, type, text }) =>
    patchPrep(store, { campaignId, sessionId }, (prep) => ({
      ...prep,
      scenes: prep.scenes.map((s) => (s.id === sceneId ? { ...s, ...(type !== undefined ? { type } : {}), ...(text !== undefined ? { text: text.trim() } : {}) } : s)),
    })),
  );
  const removeScene = useMutation(api.sessionPrep.removeScene).withOptimisticUpdate((store, { campaignId, sessionId, sceneId }) =>
    patchPrep(store, { campaignId, sessionId }, (prep) => ({ ...prep, scenes: prep.scenes.filter((s) => s.id !== sceneId) })),
  );
  const n = index + 1;
  return (
    <li className="ssp-scene">
      <select
        className="ss-in ssp-type"
        aria-label={`Scene ${n} type`}
        value={scene.type}
        disabled={pending}
        onChange={(e) => run(setScene({ ...ids, sceneId: scene.id, type: e.currentTarget.value as SessionSceneType }))}
      >
        {SESSION_SCENE_TYPES.map((type) => (
          <option key={type} value={type}>
            {SCENE_LABEL[type]}
          </option>
        ))}
      </select>
      <input
        className="ss-in ssp-text"
        type="text"
        aria-label={`Scene ${n} description`}
        placeholder="What happens here?"
        defaultValue={scene.text}
        maxLength={SESSION_TEXT_MAX.scene}
        disabled={pending}
        onKeyDown={blurOnEnter}
        onBlur={(e) => {
          const text = e.currentTarget.value;
          if (text.trim() === scene.text) return;
          run(setScene({ ...ids, sceneId: scene.id, text }));
        }}
      />
      <button type="button" className="ss-x" aria-label={`Remove scene ${n}`} disabled={pending} onClick={() => run(removeScene({ ...ids, sceneId: scene.id }))}>
        ×
      </button>
      {error ? (
        <p role="alert" className="ssp-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** 'Planned scenes' (B3): type select, 'What happens here?', remove, '+ Scene'; empty copy from the board. */
export function Scenes({ campaignId, sessionId, scenes }: Ids & { scenes: SessionScene[] }) {
  const ids = { campaignId, sessionId };
  const { error, run } = useRun();
  const addScene = useMutation(api.sessionPrep.addScene).withOptimisticUpdate((store, args) =>
    patchPrep(store, { campaignId: args.campaignId, sessionId: args.sessionId }, (prep) => ({
      ...prep,
      scenes: [...prep.scenes, { id: `${PENDING}${prep.scenes.length}`, type: args.type ?? "combat", text: "" }],
    })),
  );
  const full = scenes.length >= MAX_SCENES;
  return (
    <section className="ss-card" aria-labelledby="ssp-scenes-h">
      <div className="ssp-head">
        <h2 id="ssp-scenes-h" className="ss-h">
          Planned scenes
        </h2>
        <button
          type="button"
          className="ss-ghost"
          disabled={full}
          title={full ? `A session holds at most ${MAX_SCENES} scenes.` : undefined}
          onClick={() => run(addScene(ids))}
        >
          + Scene
        </button>
      </div>
      {scenes.length === 0 ? (
        <p className="ss-muted ss-m0">Plan a few scenes: a fight, a conversation, a place to explore. Keep them loose; the players will take things elsewhere.</p>
      ) : (
        <ol className="ssp-scenes" aria-label="Planned scenes">
          {scenes.map((scene, i) => (
            <SceneRow key={scene.id} ids={ids} scene={scene} index={i} />
          ))}
        </ol>
      )}
      {error ? (
        <p role="alert" className="ssp-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** 'Hooks & loose threads' (B3): saved on blur, at most 4000 characters. */
export function Hooks({ campaignId, sessionId, hooks }: Ids & { hooks: string }) {
  const { error, run } = useRun();
  const setHooks = useMutation(api.sessionPrep.setHooks).withOptimisticUpdate((store, args) =>
    patchPrep(store, { campaignId: args.campaignId, sessionId: args.sessionId }, (prep) => ({ ...prep, hooks: args.hooks.trim() })),
  );
  return (
    <section className="ss-card" aria-labelledby="ssp-hooks-h">
      <h2 id="ssp-hooks-h" className="ss-h">
        Hooks &amp; loose threads
      </h2>
      <textarea
        className="ss-ta"
        rows={6}
        aria-labelledby="ssp-hooks-h"
        defaultValue={hooks}
        maxLength={SESSION_TEXT_MAX.hooks}
        placeholder="Rumors to drop, NPCs to bring back, unanswered questions from last time…"
        onBlur={(e) => {
          const text = e.currentTarget.value;
          if (text.trim() === hooks) return;
          run(setHooks({ campaignId, sessionId, hooks: text }));
        }}
      />
      {error ? (
        <p role="alert" className="ssp-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
