"use client";

import "../statblock/statblock.css";
import "../scene/scene.css";
import "./revive.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { refusalFor } from "@/lib/errors/refusals";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Track } from "../statblock/track";
import { hudToasts } from "../toasts/store";
import { hudButtonClass, PartBoundary } from "../ui";
import { afterReviveInstances, afterReviveTokens, FULL_HEALTH, hpCap, reviveLine, stepMarks, type ReviveTarget } from "./model";

export { canRevive, type ReviveTarget } from "./model";

/**
 * Revive a defeated adversary (bead dcm-6c2o, user 2026-11-04: "a Revive button on hover that brings back the popup to set
 * the creature's HP / Stress"). GM only: the callers render these only for the GM, and the server refuses anyone else.
 *
 * - `ReviveButton`: the small "Revive" pill that shows on hover or keyboard focus of a defeated adversary (its map token in
 *   `tokens-layer.tsx`, its greyed "Defeated" row in the spotlight popover). A sibling of the token / row button, never
 *   inside it (CL13); revive.css shows it (always on a touch screen, which has no hover).
 * - `ReviveBox`: the modal "Revive <name>?" (native `<dialog>`, CL12, the End scene dialog's look) holding the stat
 *   block's own HP and Stress rows (`statblock/track.tsx`, the steppers the GM marks the live tracker with), starting at
 *   full health (0 and 0). A Minion group steps its fallen Minions instead of HP (0 = the whole group back). Revive sends
 *   one keyed intent, `encounterTracking.reviveInstance` (marks + the defeat cleared), with an optimistic update on the
 *   map's tokens and the encounter, and closes; a refusal shows as a toast. One GM undo in the feed reverts it.
 */

export function ReviveButton({ target, onOpen, className, style }: { target: ReviveTarget; onOpen: (target: ReviveTarget) => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      className={cn(hudButtonClass("confirm", "sm"), "hud-rv-btn", className)}
      style={style}
      aria-label={`Revive ${target.name}`}
      data-testid="hud-revive"
      // The map board pans on a pointer down it sees undisturbed (map-view/context.ts).
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onOpen(target)}
    >
      Revive
    </button>
  );
}

export type ReviveBoxProps = {
  campaignId: Id<"campaigns">;
  /** The map whose token list gets the optimistic update. */
  mapId?: Id<"combatMaps">;
  target: ReviveTarget;
  onClose: () => void;
};

/** Mount it to open it (the caller holds the target); it closes through `onClose` (Cancel, Escape, the backdrop, Revive). */
export function ReviveBox({ campaignId, mapId, target, onClose }: ReviveBoxProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Opens as a modal on mount (DOM only, as brand/modal.tsx): focus trap, Escape and the backdrop from the browser.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="hud-em hud-rv"
      data-testid="hud-revive-box"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      // The box may sit inside the map: its keys never reach the map's shortcuts (arrows move, Delete removes the
      // selected token) and its pointer never starts a pan. Escape still closes it (the dialog's own cancel).
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="hud-em-k">Defeated</span>
      <h2 id={titleId}>Revive {target.name}?</h2>
      <PartBoundary label="Revive">
        <ReviveForm campaignId={campaignId} mapId={mapId} target={target} onClose={onClose} />
      </PartBoundary>
    </dialog>
  );
}

/** The instance behind the target, from the running encounter (the stat block's reads: shared subscriptions). */
function useInstance(campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">) {
  const list = useQuery(api.encounters.list, { campaignId });
  const running = list?.active.find((e) => e.status === "running") ?? null;
  const view = useQuery(api.encounters.get, running ? { campaignId, encounterId: running._id } : "skip");
  if (list === undefined || (running !== null && view === undefined)) return { loading: true as const };
  return { loading: false as const, instance: view?.instances.find((i) => i._id === instanceId) ?? null };
}

function ReviveForm({ campaignId, mapId, target, onClose }: ReviveBoxProps) {
  const found = useInstance(campaignId, target.instanceId);
  const [hp, setHp] = useState<number>(FULL_HEALTH.hp);
  const [stress, setStress] = useState<number>(FULL_HEALTH.stress);
  const lineId = useId();
  const revive = useMutation(api.encounterTracking.reviveInstance).withOptimisticUpdate((store, args) => {
    const marks = { hp: args.hp, stress: args.stress };
    const id = args.instanceId as Id<"encounterAdversaries">;
    const cid = args.campaignId as Id<"campaigns">;
    if (mapId) {
      const tokens = store.getQuery(api.combatTokensReads.list, { campaignId: cid, mapId });
      if (tokens !== undefined) store.setQuery(api.combatTokensReads.list, { campaignId: cid, mapId }, afterReviveTokens(tokens, id, marks));
    }
    const running = store.getQuery(api.encounters.list, { campaignId: cid })?.active.find((e) => e.status === "running");
    if (!running) return;
    const view = store.getQuery(api.encounters.get, { campaignId: cid, encounterId: running._id });
    if (view) store.setQuery(api.encounters.get, { campaignId: cid, encounterId: running._id }, { ...view, instances: afterReviveInstances(view.instances, id, marks) });
  });

  const cancel = (
    <button type="button" className={hudButtonClass("cancel")} onClick={onClose}>
      Cancel
    </button>
  );
  if (found.loading) {
    return (
      <>
        <p role="status" className="hud-em-p">
          Loading {target.name}…
        </p>
        <div className="hud-em-f">{cancel}</div>
      </>
    );
  }
  const { instance } = found;
  if (instance === null || !(instance.defeated || instance.hp >= instance.stats.hpMax)) {
    return (
      <>
        <p className="hud-em-p">{instance === null ? `${target.name} is not in the running encounter.` : `${target.name} is no longer defeated.`}</p>
        <div className="hud-em-f">{cancel}</div>
      </>
    );
  }
  const { hpMax, stressMax } = instance.stats;
  const minions = instance.minionCount !== undefined;
  const cap = hpCap(hpMax);
  const marks = { hp: Math.min(hp, cap), stress: Math.min(stress, stressMax) };

  function confirm() {
    onClose();
    revive({ campaignId, instanceId: target.instanceId, hp: marks.hp, stress: marks.stress, idempotencyKey: crypto.randomUUID() }).catch((e: unknown) =>
      hudToasts.refusal(refusalFor(e, { viewer: "gm" })),
    );
  }

  return (
    <>
      <p className="hud-em-p">
        {minions ? "The whole group comes back" : "It comes back at full health"}; adjust its marks, then revive it.{" "}
        <b id={lineId} data-testid="hud-revive-line">
          {reviveLine(marks, instance.stats, minions)}.
        </b>
      </p>
      <div className="hsb hsb-trk hud-rv-trk" data-testid="hud-revive-tracks">
        {minions ? (
          <Track kind="hp" name="Fallen" noun={["fallen Minion", "fallen Minions"]} marked={marks.hp} max={hpMax} cap={cap} onStep={(d) => setHp(stepMarks(marks.hp, d, cap))} />
        ) : (
          <Track kind="hp" name="HP" noun={["Hit Point", "Hit Points"]} marked={marks.hp} max={hpMax} cap={cap} onStep={(d) => setHp(stepMarks(marks.hp, d, cap))} />
        )}
        {stressMax > 0 ? (
          <Track kind="stress" name="Stress" noun={["Stress", "Stress"]} marked={marks.stress} max={stressMax} onStep={(d) => setStress(stepMarks(marks.stress, d, stressMax))} />
        ) : null}
      </div>
      <div className="hud-em-f">
        {cancel}
        <button type="button" className={hudButtonClass("primary")} aria-describedby={lineId} data-testid="hud-revive-confirm" onClick={confirm}>
          Revive
        </button>
      </div>
    </>
  );
}
