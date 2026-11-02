"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { designAsset } from "@/lib/design-assets";
import { DOMAIN_CARD_ART } from "@/lib/srd/art";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { cn } from "@/lib/utils";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatPageState } from "../../slots";
import { CostPill, Toggle, hudButtonClass } from "../ui";
import { bandLabel, GM_APPROVES_LINE, keepPicks, primaryProblem, rowLabel, ruleText, selectionOf, STATE_WORD, stateOf, togglePick, canToggle } from "./model";
import { usePickScene } from "./scene";
import { usePick, type PickLive } from "./session";
import type { PickRow, PickSource } from "./types";

/**
 * The picking panel (plan combat-hud H3.0; CmpPicking "One target · a card", Main "Picking a target"): anchored 42 px
 * right of the primary target (the first pick; the actor's own token before any pick), vertically centred, flipped to
 * the left near the screen's right edge; a bottom sheet on a phone (pick.css). Header: art, name, the rule, ✕. Target
 * list: one row per creature, in step with the rings (both write `setPicked`). Riders and options: switches with cost
 * pills. Footer: what you'll pay and ONE primary naming the action. Not modal (the map stays usable, rings take taps);
 * focus moves to the panel's title when it opens; Esc or ✕ cancels and gives focus back.
 */

const PANEL_W = 292;
const EDGE = 8;

const CARD_ART = new Map(DOMAIN_CARDS.map((c) => [c.id, c.art]));

function artOf(source: PickSource): string | null {
  if (!source.cardId) return null;
  const id = CARD_ART.get(source.cardId) ?? DOMAIN_CARD_ART[source.cardId];
  return id ? (designAsset(id) ?? null) : null;
}

type Spot = { x: number; y: number; flipped: boolean };

/**
 * Where the panel stands in the pop region: beside the anchor token's on-screen box, kept on screen. Measured every
 * frame while open (the map pans, zooms and makes room under it); state changes only when the spot moves.
 */
function useSpot(anchorId: Id<"combatTokens"> | null, panel: React.RefObject<HTMLElement | null>): Spot | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = panel.current;
      // The pop region (the PartBoundary around the panel draws nothing).
      const region = el?.parentElement;
      if (!el || !(region instanceof HTMLElement)) return;
      const p = region.getBoundingClientRect();
      const h = el.offsetHeight;
      const token = anchorId === null ? null : document.querySelector(`.hud-map [data-token="${anchorId}"]`);
      let x: number;
      let y: number;
      let flipped = false;
      if (token) {
        const r = token.getBoundingClientRect();
        const cx = r.left + r.width / 2 - p.left;
        const cy = r.top + r.height / 2 - p.top;
        const gap = Math.max(42, r.width * 0.62 + 12);
        x = cx + gap;
        if (x + PANEL_W > p.width - EDGE) {
          x = cx - gap - PANEL_W;
          flipped = true;
        }
        y = cy - h / 2;
      } else {
        // No token to stand beside (an area pick, a token off the map): the middle of the screen.
        x = (p.width - PANEL_W) / 2;
        y = (p.height - h) / 2;
      }
      x = Math.round(Math.max(EDGE, Math.min(x, p.width - PANEL_W - EDGE)));
      y = Math.round(Math.max(EDGE, Math.min(y, p.height - h - EDGE)));
      setSpot((s) => (s && s.x === x && s.y === y && s.flipped === flipped ? s : { x, y, flipped }));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anchorId, panel]);
  return spot;
}

export function PickPanel({ state }: { state: CombatPageState }) {
  const pick = usePick();
  if (!pick.session) return null;
  // Remounts per session id only (a new session starts with fresh focus and spot); never keyed on live content.
  return <Panel key={pick.session.spec.id} state={state} live={pick.session} />;
}

function Panel({ state, live }: { state: CombatPageState; live: PickLive }) {
  const pick = usePick();
  const { spec } = live;
  const scene = usePickScene(state, spec, live.picked);
  const picked = scene.loading ? [...live.picked] : keepPicks(live.picked, scene.rows);
  const selection = selectionOf(scene.rows, picked, live.options);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const problemId = useId();
  const spot = useSpot(picked[0] ?? scene.actorTokenId, panelRef);

  // Focus to the panel once it stands at its spot (hidden until then, and a hidden element can't take focus). Focus is
  // not state: an effect may move it.
  const placed = spot !== null;
  const focused = useRef(false);
  useEffect(() => {
    if (!placed || focused.current) return;
    focused.current = true;
    titleRef.current?.focus();
  }, [placed]);

  // Esc cancels while focus is in the panel or on the map (not in the sheet panel or another prompt).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    const inPanel = target !== null && panelRef.current?.contains(target);
    const onMap = target === null || target === document.body || target.closest(".hud-map") !== null;
    if (inPanel || onMap) pick.cancel();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const art = artOf(spec.source);
  const pay = selection.outOfRange ? GM_APPROVES_LINE : (spec.primary.pay?.(selection) ?? null);
  const problem = primaryProblem(selection, spec.rule, spec.primary.blocked?.(selection) ?? null);
  const label = spec.primary.label(selection);
  const style = spot ? ({ "--pk-x": `${spot.x}px`, "--pk-y": `${spot.y}px` } as CSSProperties) : undefined;
  const ringLabels = new Map((spec.options ?? []).filter((o) => o.tokenId && live.options[o.id]).map((o) => [o.tokenId as string, o.ringLabel ?? o.label]));

  function toggle(row: PickRow) {
    pick.setPicked(togglePick(picked, row.tokenId, spec.rule, row));
  }

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cn("hud-pk", spot ? "hud-pk-placed" : null, spot?.flipped && "hud-pk-flipped")}
      style={style}
      data-testid="hud-pick"
      data-session={spec.id}
    >
      <div className="hud-pk-h">
        {art ? (
          <span className="hud-pk-art">
            <Image src={art} alt="" fill sizes="58px" />
          </span>
        ) : null}
        <div className="hud-pk-ht">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {spec.source.name}
          </h2>
          <span data-testid="hud-pick-rule">{ruleText(spec.rule)}</span>
        </div>
        <button type="button" className="hud-pk-x" aria-label={`Cancel ${spec.source.name}`} onClick={() => pick.cancel()}>
          ✕
        </button>
      </div>

      {scene.loading ? (
        <p role="status" className="hud-pk-note">
          Loading the targets…
        </p>
      ) : scene.rows.length === 0 ? (
        <p className="hud-pk-note" data-testid="hud-pick-empty">
          No one on the map fits. Creatures you can see appear here.
        </p>
      ) : (
        <ul className="hud-pk-list" aria-label="Targets">
          {scene.rows.map((row) => {
            const st = stateOf(row, picked);
            const can = canToggle(row, spec.rule);
            return (
              <li key={row.tokenId}>
                <button
                  type="button"
                  className={cn("hud-pk-r", `hud-pk-${st}`, row.reach === "out" && "hud-pk-away", row.side !== "enemy" && "hud-pk-ally")}
                  aria-pressed={st === "picked"}
                  aria-disabled={can ? undefined : true}
                  aria-label={rowLabel(row, st)}
                  data-testid="hud-pick-row"
                  data-state={st}
                  data-reach={row.reach}
                  data-token={row.tokenId}
                  onClick={() => (can ? toggle(row) : undefined)}
                >
                  <span className="hud-pk-ring" aria-hidden="true" />
                  <span className="hud-pk-n" aria-hidden="true">
                    {row.name}
                    {row.conditions.map((c) => (
                      <span key={c} className="hud-pk-cd">
                        {c}
                      </span>
                    ))}
                  </span>
                  {row.side !== "self" && bandLabel(row.band) ? (
                    <span className="hud-pk-b" aria-hidden="true">
                      {bandLabel(row.band)}
                    </span>
                  ) : null}
                  {st === "picked" ? (
                    <span className="hud-pk-st" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="12" height="12">
                        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {row.reach === "out" ? " GM approves" : null}
                    </span>
                  ) : st !== "in" ? (
                    <span className="hud-pk-st" aria-hidden="true">
                      {STATE_WORD[st]}
                    </span>
                  ) : null}
                </button>
                {ringLabels.has(row.tokenId) ? <span className="sr-only">{ringLabels.get(row.tokenId)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      {spec.extra ? (
        <div className="hud-pk-extra">
          {spec.extra({ selection, data: spec.data, update: pick.update, close: pick.cancel })}
        </div>
      ) : null}

      {(spec.options ?? []).length > 0 ? (
        <div className="hud-pk-opts">
          {(spec.options ?? []).map((o) => (
            <Toggle
              key={o.id}
              checked={live.options[o.id] === true}
              disabled={o.disabled}
              onChange={(on) => pick.setOption(o.id, on)}
              label={o.label}
              note={o.note}
              end={o.cost ? <CostPill amount={o.cost.amount} resource={o.cost.resource} /> : undefined}
            />
          ))}
        </div>
      ) : null}

      <div className="hud-pk-f">
        <span className={cn("hud-pk-pay", selection.outOfRange && "hud-pk-pay-gm")} data-testid="hud-pick-pay">
          {pay}
        </span>
        <button
          type="button"
          className={cn(hudButtonClass("primary"), "hud-pk-go")}
          disabled={problem !== null || live.sending}
          aria-describedby={problem ? problemId : undefined}
          data-testid="hud-pick-go"
          onClick={() => void pick.send(selection)}
        >
          {live.sending ? "Sending…" : label}
        </button>
      </div>
      {problem ? (
        <p id={problemId} className="hud-pk-why" data-testid="hud-pick-why">
          {problem}
        </p>
      ) : null}
      {live.message ? (
        <p role="alert" className="hud-pk-err" data-testid="hud-pick-error">
          {live.message}
        </p>
      ) : null}
    </section>
  );
}
