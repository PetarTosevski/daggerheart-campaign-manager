"use client";

import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { designAsset } from "@/lib/design-assets";
import { RANGE_BANDS } from "@/lib/domain/combat-map/ranges";

import { useMapView } from "../map-view/context";
import { MovementOverlay, useLayoutMovementGrid, type SeenMasks } from "../map-view/movement-overlay";
import type { MapLayerProps } from "../slots";
import { okView, useFogMasks, useStoredExplored, useViewing } from "../vision/use-vision";
import { initialsOf, snapTurn, TURN_BUTTON_STEP } from "./geometry";
import { clearNotice, useMoveNotes } from "./move-notes";
import { useRings } from "./rings";
import { SIDES } from "./sides";
import { useTokenActions, useTokens, type TokenView } from "./use-tokens";

/** Ring colours per band (the board's RANGES): Melee, Very Close, Close, Far. */
const RING_COLOURS = ["rgba(255,255,255,0.8)", "rgba(243,207,134,0.9)", "rgba(111,184,166,0.9)", "rgba(198,182,242,0.85)"] as const;

/** Keyboard moves, one square: arrow keys and WASD. */
const KEY_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  A: [-1, 0],
  d: [1, 0],
  D: [1, 0],
  w: [0, -1],
  W: [0, -1],
  s: [0, 1],
  S: [0, 1],
};

/** Token background without a portrait, per side (the board). */
const SIDE_BACKGROUND: Record<TokenView["side"], string> = {
  pc: "radial-gradient(circle at 35% 30%, #4a3a1a, #1d160a)",
  enemy: "radial-gradient(circle at 35% 30%, #6a2018, #2a0a08)",
  ally: "radial-gradient(circle at 35% 30%, #2f5a40, #10241a)",
  neutral: "radial-gradient(circle at 35% 30%, #4a5a60, #1a2428)",
};

/** How long a move announcement ("Blocked", the GM's warning) stays on screen. */
const NOTICE_MS = 4000;

type Drag =
  | { kind: "move"; id: TokenView["_id"]; pointerId: number; sx: number; sy: number; moved: boolean; canMove: boolean }
  | { kind: "turn"; id: TokenView["_id"]; pointerId: number; cx: number; cy: number };

/** The token's portrait as a CSS background (uploaded image or design art), or the side's gradient. */
function background(token: TokenView): CSSProperties {
  const p = token.portrait;
  const url = p?.kind === "url" ? p.url : p?.kind === "asset" ? designAsset(p.asset) : undefined;
  if (url) return { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: p?.kind === "asset" ? p.position : "center 25%" };
  return { background: SIDE_BACKGROUND[token.side] };
}

function ariaLabel(token: TokenView): string {
  const s = token.stats;
  const hp = s && s.hpMax > 0 ? `, ${s.hp} of ${s.hpMax} HP marked` : "";
  return `${token.name}, ${SIDES[token.side].label}${hp}${token.mine ? ", your character" : ""}`;
}

/**
 * Map area (slot `TokensLayer`, D9 C6): the tokens (portrait or initials, side ring, HP bar, condition badge, facing
 * arrow; a downed token is greyed), their range circles (R3) and the turn knob (R5). Dragging a token the caller may
 * move snaps it to a square and it faces the way it moved; dragging the gold knob turns it in 15 degree steps. A
 * click selects a token (page state). Keys: R range circles of the selected token, Delete removes it (GM), arrows
 * move a focused token. In Edit mode the tokens are drawn but do not take the pointer (the editor's tools do).
 * `noDelete` (the Encounter tab's map pane, plan combat-actions AA3b): tokens move and turn, Delete does nothing.
 */
export function TokensLayer(props: MapLayerProps & { noDelete?: boolean }) {
  const { campaignId, role, mode, map, viewport, selectedTokenId, onSelectToken, noDelete = false } = props;
  const tokens = useTokens(campaignId, role, map._id);
  const actions = useTokenActions(campaignId, map);
  const rings = useRings();
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ id: string; dx: number; dy: number } | { id: string; angle: number } | null>(null);
  const gm = role === "gm";
  const editing = gm && mode === "edit";
  const { cell, zoom, pad } = viewport;
  const selected = tokens?.find((t) => t._id === selectedTokenId) ?? null;

  // Movement (map-movement M1): the hatch over difficult squares the viewer can see (the GM's own view: all of them; a
  // player or the GM's preview: the squares that character sees or has explored, from the vision slot's queries, which
  // Convex shares), and the announcements of the last move ("Blocked", the GM's warning).
  const { layout, cells } = useMapView();
  const grid = useLayoutMovementGrid(layout, cells);
  const viewing = useViewing(props);
  const stored = useStoredExplored(campaignId, viewing);
  const fog = useFogMasks(editing ? null : okView(viewing), stored.mask);
  const seen: SeenMasks | null | "loading" = viewing.kind === "gm" ? null : (fog ?? "loading");
  const notes = useMoveNotes();
  const notice = notes.notice;
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => clearNotice(notice.seq), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // R / Delete (the board's shortcuts); Escape and N are the map board's. Arrow keys or WASD move a token one square (it faces
  // the way it moves) and Q / E turn it (user 2026-10-21): the GM's selected token, a player's selected token or else their own PC,
  // so a player never has to click first.
  const onKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || editing) return;
    const mover = selected?.canMove ? selected : gm ? null : (tokens?.find((t) => t.mine && t.canMove) ?? null);
    const step = KEY_STEPS[e.key];
    if (mover && step) {
      e.preventDefault();
      if (!selected) onSelectToken(mover._id);
      void actions.move(mover._id, mover.x + step[0], mover.y + step[1]);
      return;
    }
    if (mover && (e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E")) {
      e.preventDefault();
      void actions.turn(mover._id, snapTurn(mover.face + (e.key.toLowerCase() === "q" ? -TURN_BUTTON_STEP : TURN_BUTTON_STEP)));
      return;
    }
    if (!selected) return;
    if (e.key === "r" || e.key === "R") rings.toggle(selected._id);
    if (gm && !noDelete && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      onSelectToken(null);
      void actions.remove(selected._id);
    }
  });
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (!tokens) return null;

  function onTokenDown(e: ReactPointerEvent<HTMLButtonElement>, token: TokenView) {
    if (e.button !== 0) return;
    // The map board pans on a pointer down it sees undisturbed (map-view/context.ts).
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", id: token._id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, canMove: token.canMove };
  }
  function onTokenMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.kind !== "move" || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.moved && d.canMove) setPreview({ id: d.id, dx: dx / zoom, dy: dy / zoom });
  }
  function onTokenUp(e: ReactPointerEvent<HTMLButtonElement>, token: TokenView) {
    const d = drag.current;
    if (!d || d.kind !== "move" || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setPreview(null);
    onSelectToken(token._id);
    if (!d.moved || !d.canMove) return;
    const x = Math.round(token.x + (e.clientX - d.sx) / zoom / cell);
    const y = Math.round(token.y + (e.clientY - d.sy) / zoom / cell);
    if (x !== token.x || y !== token.y) void actions.move(token._id, x, y);
  }
  function onTokenKey(e: KeyboardEvent<HTMLButtonElement>, token: TokenView) {
    const step = KEY_STEPS[e.key];
    if (!step || !token.canMove || editing) return;
    e.preventDefault();
    onSelectToken(token._id);
    void actions.move(token._id, token.x + step[0], token.y + step[1]);
  }

  function onKnobDown(e: ReactPointerEvent<HTMLElement>, token: TokenView) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tokenEl = e.currentTarget.closest("[data-token]");
    const r = tokenEl?.getBoundingClientRect();
    if (!r) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "turn", id: token._id, pointerId: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }
  function onKnobMove(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.kind !== "turn" || d.pointerId !== e.pointerId) return;
    setPreview({ id: d.id, angle: Math.atan2(e.clientY - d.cy, e.clientX - d.cx) });
  }
  function onKnobUp(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.kind !== "turn" || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    setPreview(null);
    void actions.turn(d.id, snapTurn(Math.atan2(e.clientY - d.cy, e.clientX - d.cx)));
  }

  const ringed = tokens.filter((t) => rings.on(t._id));
  // The announcement sits above the token it is about (stage pixels), or at the stage's corner.
  const noticeToken = notice ? tokens.find((t) => t._id === notice.tokenId) : undefined;
  const noticeAt: CSSProperties | undefined = noticeToken
    ? { left: (noticeToken.x + pad + noticeToken.size / 2) * cell * zoom, top: (noticeToken.y + pad) * cell * zoom - 6 }
    : undefined;
  return (
    <>
    {grid && !editing ? <MovementOverlay grid={grid} masks={seen} pad={pad} step={cell * zoom} /> : null}
    <div
      className={editing ? "cm-tokens cm-tokens-idle" : "cm-tokens"}
      data-testid="combat-tokens"
      style={{ width: (map.w + 2 * pad) * cell, height: (map.h + 2 * pad) * cell, transform: `scale(${zoom})` }}
    >
      <div className="cm-tokens-map" style={{ left: pad * cell, top: pad * cell }}>
        {ringed.map((t) => {
          const cx = (t.x + t.size / 2) * cell;
          const cy = (t.y + t.size / 2) * cell;
          const first = t.name.split(" ")[0] ?? t.name;
          return (
            <div key={`rings-${t._id}`} data-testid="combat-rings" aria-hidden="true">
              {RANGE_BANDS.map((band, i) => {
                const rad = (band.squares + t.size / 2) * cell;
                return (
                  <div key={band.key}>
                    <div
                      className="cm-ring"
                      style={{ left: cx - rad, top: cy - rad, width: 2 * rad, height: 2 * rad, border: `2px dashed ${RING_COLOURS[i]}`, boxShadow: `inset 0 0 0 1px ${SIDES[t.side].colour}33` }}
                    />
                    <span className="cm-ringlbl" style={{ left: cx + rad * 0.71 + 4, top: cy - rad * 0.71 - 18 }}>
                      {first} · {band.label}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {tokens.map((t) => {
          const on = t._id === selectedTokenId;
          const moving = preview && preview.id === t._id && "dx" in preview ? preview : null;
          const turning = preview && preview.id === t._id && "angle" in preview ? preview : null;
          const deg = ((turning ? turning.angle : t.face) * 180) / Math.PI;
          const side = SIDES[t.side];
          const s = t.stats;
          const hpLeft = s && s.hpMax > 0 ? Math.max(0, s.hpMax - s.hp) / s.hpMax : 0;
          const hpRatio = s && s.hpMax > 0 ? s.hp / s.hpMax : 0;
          const showKnob = (on || t.mine) && t.canMove && !editing;
          const bumped = notes.bump?.tokenId === t._id;
          const classes = ["cm-tok", on ? "sel" : "", t.mine ? "mine" : "", t.canMove ? "" : "fixed", moving ? "dragging" : "", bumped ? "bump" : ""].filter(Boolean).join(" ");
          const shadow = on
            ? `0 3px 8px rgba(0,0,0,.6), 0 0 0 3px #fff, 0 0 18px ${side.colour}`
            : t.mine
              ? "0 3px 8px rgba(0,0,0,.6), 0 0 0 3px var(--cm-acc), 0 0 22px var(--cm-acc)"
              : "0 3px 8px rgba(0,0,0,.6)";
          const hasPortrait = t.portrait !== null && background(t).backgroundImage !== undefined;
          return (
            <button
              key={t._id}
              type="button"
              className={classes}
              data-token={t._id}
              data-testid="combat-token"
              data-face={Math.round((t.face * 180) / Math.PI)}
              data-square={`${t.x},${t.y}`}
              aria-label={ariaLabel(t)}
              aria-pressed={on}
              tabIndex={editing ? -1 : 0}
              style={{
                left: t.x * cell + 3 + (moving?.dx ?? 0),
                top: t.y * cell + 3 + (moving?.dy ?? 0),
                width: t.size * cell - 6,
                height: t.size * cell - 6,
                ...background(t),
                border: `3px solid ${side.colour}`,
                boxShadow: shadow,
                filter: s?.down ? "grayscale(1) brightness(.6)" : undefined,
                zIndex: moving || turning ? 50 : on ? 30 : t.mine ? 25 : 10,
              }}
              onPointerDown={(e) => onTokenDown(e, t)}
              onPointerMove={onTokenMove}
              onPointerUp={(e) => onTokenUp(e, t)}
              onPointerCancel={() => {
                drag.current = null;
                setPreview(null);
              }}
              onClick={(e) => {
                // Keyboard activation (Enter / Space); pointer clicks select in onTokenUp.
                if (e.detail === 0) onSelectToken(t._id);
              }}
              onKeyDown={(e) => onTokenKey(e, t)}
            >
              <span className="cm-face" aria-hidden="true" style={{ transform: `rotate(${deg}deg)`, ["--tc" as string]: side.colour }} />
              {hasPortrait ? null : (
                <span className="cm-ini" aria-hidden="true" style={{ fontSize: Math.round(t.size * cell * 0.34) }}>
                  {initialsOf(t.name, t.size)}
                </span>
              )}
              <span className="cm-tag" aria-hidden="true" style={{ top: t.size * cell - 4 }}>
                {t.name}
              </span>
              {s && s.hpMax > 0 ? (
                <span className="cm-tok-bar" aria-hidden="true">
                  <span
                    style={{ width: `${Math.round(100 * hpLeft)}%`, background: hpRatio > 0.66 ? "#e0715f" : hpRatio > 0.33 ? "#e3b45a" : "#7cc49a" }}
                  />
                </span>
              ) : null}
              {s && s.conditions.length > 0 ? (
                <span className="cm-tok-cond" aria-hidden="true">
                  {s.conditions.map((c) => c.charAt(0).toUpperCase()).join("")}
                </span>
              ) : null}
              {t.light !== "none" ? (
                <span className="cm-badge cm-tok-light" aria-hidden="true">
                  {t.light === "alistair" ? "✦" : "🔥"}
                </span>
              ) : null}
              {showKnob ? (
                <span className="cm-rot" style={{ transform: `rotate(${deg}deg)` }}>
                  <i
                    title="Drag to turn"
                    data-testid="combat-turn-knob"
                    onPointerDown={(e) => onKnobDown(e, t)}
                    onPointerMove={onKnobMove}
                    onPointerUp={onKnobUp}
                    onPointerCancel={() => {
                      drag.current = null;
                      setPreview(null);
                    }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
    {/* Always mounted, so a screen reader hears "Blocked" (politely) the moment it appears. */}
    <p
      className={notice ? `cm-move-notice ${notice.kind}` : "cm-move-notice cm-move-notice-empty"}
      role="status"
      data-testid="combat-move-notice"
      data-kind={notice?.kind ?? ""}
      data-seq={notice?.seq ?? 0}
      style={noticeAt}
    >
      {notice?.text ?? ""}
    </p>
    {actions.error ? (
      <p role="alert" className="cm-alert cm-tokens-error">
        {actions.error}
        <button type="button" className="cm-btn cm-sm" onClick={actions.clearError}>
          Dismiss
        </button>
      </p>
    ) : null}
    </>
  );
}
