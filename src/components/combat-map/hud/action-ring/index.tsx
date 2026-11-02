"use client";

import "./action-ring.css";

import { useQuery } from "convex/react";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActor } from "../../actions/targets";
import { FeatureUse } from "../../drawer/use";
import { usePick } from "../pick";
import { useAttackPicker } from "../pick-attack";
import { useAreaPickState } from "../pick-area";
import { featurePlan, useFeatureUse } from "../pick-feature";
import { useHud, type HudLayerProps } from "../state";
import { raiseHand } from "./hand";
import {
  attackLock,
  castLock,
  featureLock,
  hopeNeeded,
  moreItem,
  ringItems,
  ringPoint,
  ringRadius,
  ringSlots,
  ringUses,
  splitRing,
  stepFocus,
  type RingItem,
} from "./model";
import { closeActionRing, useActionRing, type RingOpen } from "./store";

export { closeActionRing, openActionRing, toggleActionRing, useActionRing, resetActionRingForTests, type RingOpen } from "./store";
export { raiseHand } from "./hand";
export * from "./model";

/**
 * The action ring around your own token (plan combat-hud H3.4; board Main 'Picking a target' / 'Can't afford'; answer
 * 3b). A click on your token (H1.3's handler in tokens-layer.tsx calls `toggleActionRing`) opens it; it draws, from the
 * left over the top of the token and clear of its HP / Stress arcs:
 *
 *   Attack   H3.2's weapon attack picker (`useAttackPicker(state).open()`)
 *   Cast     raises the hand (H2.3 / H3.1: unfolds it and focuses the first playable card; its Use opens the card picker)
 *   Sheet    your sheet panel (H2.1; on while it shows)
 *   <each feature with a Use button>   H3.3's `useFeatureUse().open()`; "classic" shows the classic FeatureUse beside the
 *            ring (Warden's Protection, Charge), as the sheet panel does
 *
 * A locked button stays focusable (`aria-disabled`) and shows its reason beside it on hover, focus or a tap ("Evolution
 * needs 3 Hope. You have 1."); the reason is also its accessible description. More buttons than the arc holds: the last
 * slot is "More", a list beside the ring (decided over a second ring; model.ts `splitRing`). The ring stays open while
 * a picker it started runs, with that button lit (the board's Cast `.on`), so cancelling gives focus back to it; it
 * hides during square picking. Esc closes it (after the picker's own Esc), as do a click on your token or on the bare
 * map. Arrow keys move between its buttons. Players only: the GM's token clicks still open sheets and stat blocks.
 *
 * Positions are stage pixels around the token's centre (like the target rings), so the ring scrolls, zooms and makes
 * room with the map (H2.2) and needs no pointer maths of its own.
 */
export function HudActionRing(props: HudLayerProps) {
  const open = useActionRing();
  if (props.role !== "player" || props.mode !== "play" || open === null) return null;
  return <RingFor layer={props} open={open} />;
}

function RingFor({ layer, open }: { layer: HudLayerProps; open: RingOpen }) {
  const actor = useActor(layer);
  const area = useAreaPickState();
  if (!actor || actor.view.tokenId !== open.tokenId || area.live !== null) return null;
  const me = actor.view.pcs.find((p) => p._id === open.tokenId);
  if (!me) return null;
  const step = layer.viewport.cell * layer.viewport.zoom;
  const pad = layer.viewport.pad;
  const centre = { x: (me.x + me.size / 2 + pad) * step, y: (me.y + me.size / 2 + pad) * step };
  return <ActionRing layer={layer} open={open} characterId={actor.characterId} name={me.name} centre={centre} size={me.size * step} />;
}

type Classic = { featureId: string; useId: string };

function ActionRing({ layer, open, characterId, name, centre, size }: { layer: HudLayerProps; open: RingOpen; characterId: Id<"characters">; name: string; centre: { x: number; y: number }; size: number }) {
  const { campaignId, role, map } = layer;
  const hud = useHud();
  const pick = usePick();
  const attack = useAttackPicker(layer);
  const featureUse = useFeatureUse({ campaignId, role, map, characterId });
  const sheet = useQuery(api.combatHud.sheet, { characterId });
  const hand = useQuery(api.combatCards.hand, { campaignId, characterId });
  const [tip, setTip] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [classic, setClassic] = useState<Classic | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const ids = useId();

  const sessionId = pick.session?.spec.id ?? null;
  const hope = sheet ? sheet.trackers.hope.value : null;
  const uses = useMemo(() => (sheet ? ringUses(sheet.features) : []), [sheet]);
  const features = uses.map((u) => {
    const plan = featurePlan(u.featureId, u.useId);
    const need = plan.kind === "classic" ? 0 : hopeNeeded(plan.use.costs);
    const sessionBase = `feature:${characterId}:${u.featureId}:`;
    const on = (sessionId?.startsWith(sessionBase) ?? false) || (classic?.featureId === u.featureId && classic.useId === u.useId);
    return { ...u, locked: featureLock(u, need, hope), on };
  });
  const items = ringItems({
    attack: { locked: attackLock(attack.ready, attack.reason), on: attack.isOpen },
    cast: { locked: castLock(hand ? hand.loadout.length : null), on: sessionId?.startsWith(`card:${characterId}:`) ?? false },
    sheet: { on: hud.sheet?.kind === "pc" && hud.sheet.characterId === characterId },
    features,
  });
  const radius = ringRadius(size);
  const { ring, more } = splitRing(items, ringSlots(radius));
  const shown = more.length > 0 ? [...ring, moreItem(more.length, moreOpen)] : ring;

  function focusToken() {
    const token = document.querySelector<HTMLElement>(`.hud-map button[data-token="${open.tokenId}"]`);
    token?.focus({ preventScroll: true });
  }

  function run(item: RingItem) {
    if (item.locked !== null) {
      setTip(item.id);
      return;
    }
    switch (item.kind) {
      case "attack":
        if (attack.isOpen) pick.cancel();
        else attack.open();
        return;
      case "cast":
        setMoreOpen(false);
        raiseHand();
        return;
      case "sheet":
        hud.toggleSheet({ kind: "pc", characterId });
        return;
      case "more":
        setMoreOpen(!moreOpen);
        return;
      case "feature": {
        if (!item.featureId || !item.useId) return;
        const how = featureUse.open({ featureId: item.featureId, useId: item.useId });
        setClassic(how === "classic" ? { featureId: item.featureId, useId: item.useId } : null);
        if (how !== "classic") setMoreOpen(false);
        return;
      }
    }
  }

  // Esc: the picker's own Esc goes first (an open session or square pick); then the More list, the classic flow, the ring.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || pick.session !== null) return;
    const target = e.target instanceof Element ? e.target : null;
    const inRing = target !== null && rootRef.current?.contains(target) === true;
    const onMap = target === null || target === document.body || target.closest(".hud-map") !== null;
    if (!inRing && !onMap) return;
    if (moreOpen) {
      setMoreOpen(false);
      moreRef.current?.focus();
      return;
    }
    if (classic !== null && inRing) {
      setClassic(null);
      return;
    }
    closeActionRing();
    if (inRing) focusToken();
  });
  // A press on the bare map closes it (a token, the ring itself or any HUD panel does not; nor while a picker runs).
  const onDown = useEffectEvent((e: PointerEvent) => {
    if (pick.session !== null) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(".hud-map") === null) return;
    if (rootRef.current?.contains(target) || target.closest("[data-token]") !== null) return;
    closeActionRing();
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    const down = (e: PointerEvent) => onDown(e);
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down, true);
    };
  }, []);

  // Opened from the keyboard: focus goes to the first button (a mouse open leaves focus on the token, so its arrow-key
  // moves keep working).
  useEffect(() => {
    if (!open.focus) return;
    rootRef.current?.querySelector<HTMLButtonElement>("button.hud-ar-b")?.focus({ preventScroll: true });
  }, [open.seq, open.focus]);

  function onRingKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button.hud-ar-b"));
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const next = stepFocus(at, buttons.length, e.key);
    if (next === null) return;
    // Handled here, so the token layer's arrow keys (window listener, checks defaultPrevented) don't move your token.
    e.preventDefault();
    buttons[next]?.focus();
  }

  const style = { left: centre.x, top: centre.y } as CSSProperties;
  const tipItem = [...shown, ...more].find((i) => i.id === tip && i.locked !== null) ?? null;
  const tipAt = tipItem ? ringPoint(Math.max(0, shown.findIndex((i) => i.id === tipItem.id)), radius) : null;

  return (
    <div
      ref={rootRef}
      className="hud-ar"
      style={style}
      role="toolbar"
      aria-label={`Your actions (${name})`}
      data-testid="hud-action-ring"
      onKeyDown={onRingKey}
      // Presses inside never pan the map or drop the selection (map-board.tsx starts its drag on pointer down).
      onPointerDown={(e) => e.stopPropagation()}
    >
      {shown.map((item, i) => {
        const p = ringPoint(i, radius);
        const reasonId = `${ids}-${item.id}`;
        return (
          <button
            key={item.id}
            ref={item.kind === "more" ? moreRef : undefined}
            type="button"
            className={cn("hud-ar-b", item.on && "on", item.locked !== null && "off")}
            style={{ left: p.x, top: p.y }}
            aria-label={item.name}
            aria-disabled={item.locked !== null ? true : undefined}
            aria-describedby={item.locked !== null ? reasonId : undefined}
            aria-pressed={item.kind === "more" ? undefined : item.on}
            aria-expanded={item.kind === "more" ? moreOpen : undefined}
            data-testid="hud-ar-button"
            data-kind={item.kind}
            onClick={() => run(item)}
            onFocus={() => setTip(item.locked !== null ? item.id : null)}
            onBlur={() => setTip((t) => (t === item.id ? null : t))}
            onPointerEnter={() => (item.locked !== null ? setTip(item.id) : undefined)}
            onPointerLeave={() => setTip((t) => (t === item.id ? null : t))}
          >
            <RingIcon item={item} />
            <span className="hud-ar-l" aria-hidden="true">
              {item.label}
            </span>
            {item.locked !== null ? (
              <span id={reasonId} className="sr-only">
                {item.locked}
              </span>
            ) : null}
          </button>
        );
      })}
      {tipItem && tipAt && !more.some((m) => m.id === tipItem.id) ? (
        <div className="hud-ar-tip" style={{ left: tipAt.x + 30, top: tipAt.y - 14 }} aria-hidden="true" data-testid="hud-ar-tip">
          {tipItem.locked}
        </div>
      ) : null}
      {sheet === undefined ? (
        <span role="status" className="sr-only">
          Loading your features…
        </span>
      ) : null}
      {moreOpen && more.length > 0 ? <MoreList items={more} at={ringPoint(shown.length - 1, radius)} onRun={run} ids={ids} /> : null}
      {classic !== null ? (
        <div className="hud-ar-classic" style={{ left: radius + 36, top: -radius }} data-testid="hud-ar-classic">
          <FeatureUse campaignId={campaignId} role={role} map={map} characterId={characterId} featureId={classic.featureId} useId={classic.useId} onClose={() => setClassic(null)} />
        </div>
      ) : null}
    </div>
  );
}

/** The overflow list beside "More": every remaining button, a locked one with its reason under its name. */
function MoreList({ items, at, onRun, ids }: { items: readonly RingItem[]; at: { x: number; y: number }; onRun: (item: RingItem) => void; ids: string }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="hud-ar-more" role="group" aria-label="More actions" style={{ left: at.x + 30, top: at.y }} data-testid="hud-ar-more">
      {items.map((item, i) => {
        const reasonId = `${ids}-more-${item.id}`;
        return (
          <button
            key={item.id}
            ref={i === 0 ? first : undefined}
            type="button"
            className={cn("hud-ar-mi", item.on && "on", item.locked !== null && "off")}
            aria-disabled={item.locked !== null ? true : undefined}
            aria-describedby={item.locked !== null ? reasonId : undefined}
            aria-pressed={item.on}
            data-testid="hud-ar-more-item"
            onClick={() => onRun(item)}
          >
            <RingIcon item={item} />
            <span className="hud-ar-mi-t">
              <b>{item.name}</b>
              {item.locked !== null ? <small id={reasonId}>{item.locked}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const ICONS: Record<RingItem["kind"], ReactNode> = {
  attack: <path d="M13.5 1.5l-1 3.5-6 6-2-2 6-6zM3.2 9.3l3.5 3.5M2 14l2.4-2.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />,
  cast: <path d="M2 12h12l-1-7-3 3-2-5-2 5-3-3z" />,
  sheet: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  feature: <path d="M8 1l1.8 4.6L14.5 6l-3.6 3 1.1 4.7L8 11.3 4 13.7l1.1-4.7L1.5 6l4.7-.4z" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="12.5" cy="8" r="1.5" />
    </>
  ),
};

const LOCK = (
  <>
    <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
    <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </>
);

/** The board's icons (Main `.rad .ic`); a locked button shows the lock, as the board's Evolution. */
function RingIcon({ item }: { item: RingItem }) {
  return (
    <svg className="hud-ar-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {item.locked !== null ? LOCK : ICONS[item.kind]}
    </svg>
  );
}
