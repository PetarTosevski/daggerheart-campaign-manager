"use client";

import { useEffect, useEffectEvent, useId, useRef } from "react";

import { cn } from "@/lib/utils";

import type { CombatPageState } from "../../slots";
import { hudButtonClass } from "../ui";
import { bannerParts, confirmLabel, confirmProblem, progressText, startCursor, stepCursor, summaryText } from "./model";
import { cancelAreaPick, confirmAreaPick, dismissPickLine, placeSquare, setCursor, useAreaPickState, type AreaPickLive } from "./store";

/**
 * The square-picking bar (plan combat-hud H3.3; CmpPicking `.pickban` + `.bar`): at the top of the map, the banner
 * ("Pick the centre of **Dark Cloud** within Close", "Esc cancels" / "1 of 2 points"), the summary ("Radius: Close (6
 * squares)", "Length 6 squares · within Far", "Blocks sight"), the cost line, Cancel and ONE confirm naming the action
 * ("Place Dark Cloud here"). After a send it shows the result line until dismissed (also used by feature uses that never
 * touch the map: `showPickLine`).
 *
 * Keyboard (the map has no other keyboard path to a square): focus moves to the banner's cursor when the mode starts;
 * the arrow keys move the crosshair a square (captured before the token layer, so your token stays put), Enter places
 * the next point there (all placed: Enter confirms), Esc cancels from anywhere outside a text field.
 */
export function HudAreaPick({ state }: { state: CombatPageState }) {
  const { live, line } = useAreaPickState();
  const map = state.map;
  if (live && map && live.spec.mapId === map._id) return <Bar live={live} w={map.w} h={map.h} />;
  if (!line) return null;
  return (
    <div className={cn("hud-ap-bar hud-ap-line", line.error && "hud-ap-line-err")} role={line.error ? "alert" : "status"} data-testid="hud-area-line">
      <span>{line.text}</span>
      <button type="button" className="hud-ap-x" aria-label="Dismiss" onClick={dismissPickLine}>
        ✕
      </button>
    </div>
  );
}

function Bar({ live, w, h }: { live: AreaPickLive; w: number; h: number }) {
  const { spec, points } = live;
  const cursorRef = useRef<HTMLDivElement>(null);
  const problemId = useId();
  const banner = bannerParts(spec, points.length);
  const problem = confirmProblem(spec, points);
  const full = points.length >= spec.count;

  // Focus to the cursor once per mode (focus is not state; an effect may move it).
  useEffect(() => {
    cursorRef.current?.focus();
  }, [spec.id]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cancelAreaPick();
      return;
    }
    const cursor = live.cursor ?? startCursor(spec.origin, w, h);
    const moved = stepCursor(cursor, e.key, w, h);
    if (moved) {
      e.preventDefault();
      setCursor(live.cursor === null ? cursor : moved);
      return;
    }
    if (e.key !== "Enter") return;
    // Enter on a button keeps its own meaning; on the cursor, the page or the map it places / confirms.
    const here = target === null || target === document.body || target === cursorRef.current || target.closest(".hud-map") !== null;
    if (!here) return;
    e.preventDefault();
    const atCursor = live.cursor !== null && points.some((p) => p.x === live.cursor!.x && p.y === live.cursor!.y);
    if (full && (live.cursor === null || atCursor)) void confirmAreaPick();
    else placeSquare(cursor);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  return (
    <section className="hud-ap-bar" aria-label={`${spec.name}: pick on the map`} data-testid="hud-area-bar" data-pick={spec.id}>
      <div
        ref={cursorRef}
        className="hud-ap-ban"
        tabIndex={-1}
        role="group"
        aria-label="Square picker"
        aria-describedby={`${problemId}-keys`}
        data-testid="hud-area-banner"
      >
        <svg className="hud-ap-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <path d="M2 12h12l-1-7-3 3-2-5-2 5-3-3z" />
        </svg>
        <span role="status" className="hud-ap-prompt">
          {banner.before}
          <b>{banner.name}</b>
          {banner.after}
        </span>
        <span className="hud-ap-prog" data-testid="hud-area-progress">
          {progressText(spec, points.length)}
        </span>
      </div>
      <p id={`${problemId}-keys`} className="sr-only">
        Arrow keys move the crosshair, Enter places a point there, Escape cancels.
      </p>
      <div className="hud-ap-sum">
        <span data-testid="hud-area-summary">{summaryText(spec, points)}</span>
        {spec.blocksSight ? <b>Blocks sight</b> : null}
      </div>
      <div className="hud-ap-f">
        <span className="hud-ap-pay">{spec.pay ?? null}</span>
        <button type="button" className={hudButtonClass("cancel")} onClick={cancelAreaPick} disabled={live.sending}>
          Cancel
        </button>
        <button
          type="button"
          className={cn(hudButtonClass("primary"), "hud-ap-go")}
          disabled={problem !== null || live.sending}
          aria-describedby={problem ? problemId : undefined}
          data-testid="hud-area-go"
          onClick={() => void confirmAreaPick()}
        >
          {live.sending ? "Sending…" : (spec.confirm ?? confirmLabel(spec))}
        </button>
      </div>
      {problem ? (
        <p id={problemId} className="hud-ap-why" data-testid="hud-area-why">
          {problem}
        </p>
      ) : null}
      {live.message ? (
        <p role="alert" className="hud-ap-err" data-testid="hud-area-error">
          {live.message}
        </p>
      ) : null}
    </section>
  );
}
