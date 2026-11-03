"use client";

import { useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { keepPicks, stateOf, usePick } from "../pick";
import { bandLabel } from "../pick/model";
import { usePickScene } from "../pick/scene";
import type { HudPartProps } from "../state";
import { edgePlace, edgeText, edgeTone, stackChips, type EdgeArrow, type EdgeSide, type Rect } from "./model";

/**
 * Edge chips for off-screen targets (plan combat-hud H7.2; PlayerPhone `.edge`, "Sniper · Very Far · GM →"; HANDOFF
 * "Phone (390)"). While a pick session is open, every creature the panel lists whose ring is off the visible map (under
 * the strip, behind a bottom sheet, or panned away) gets a chip on the nearest side edge at its height, in its ring's
 * tone: gold in reach, amber out of range ("GM"), salmon without line of sight. A tap pans the map so the target comes
 * into view (user answer 2026-11-02; `panTo`, the map's own scroll pan); the panel's rows and the rings pick, never
 * the chip. No numbers (hard rule 2).
 *
 * Where the rings are is the map's business (pan, zoom, make-room), so the chips read the rings' boxes from the DOM
 * (H3.0's `[data-testid="hud-pick-ring"][data-token]` contract) once per frame while a session is open, through a small
 * external store (`useSyncExternalStore`; no state copied in an effect), and re-render only when a chip moves.
 */
export function PhoneEdges({ state }: HudPartProps) {
  const pick = usePick();
  if (pick.session === null) return null;
  return <EdgeChips state={state} />;
}

type Chip = { id: string; side: EdgeSide; arrow: EdgeArrow; y: number };

const CHIP_H = 28;

/** The visible map inside the HUD root (client coordinates): the viewport less the strip and any bottom sheet. */
function visibleMap(root: HTMLElement): Rect | null {
  const vp = root.querySelector('.hud-map [data-testid="combat-viewport"]');
  if (!vp) return null;
  const box = root.getBoundingClientRect();
  const v = vp.getBoundingClientRect();
  const view: Rect = { left: Math.max(v.left, box.left), right: Math.min(v.right, box.right), top: Math.max(v.top, box.top), bottom: Math.min(v.bottom, box.bottom) };
  const strip = root.querySelector(".hud-ph-strip");
  if (strip) view.top = Math.max(view.top, strip.getBoundingClientRect().bottom);
  // A bottom sheet (ours, or the picking panel when it sits at the bottom edge) covers the map above it.
  for (const el of root.querySelectorAll('.hud-ph-bs, [data-testid="hud-pick"]')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom >= box.bottom - 4) view.bottom = Math.min(view.bottom, r.top);
  }
  return view;
}

/**
 * Pans the map so the token's ring sits in the middle of the visible map (above the bottom sheet, under the strip).
 * The map pans by scrolling its viewport (map-board.tsx's drag pan sets `scrollLeft` / `scrollTop`), so this scrolls it
 * by the ring's distance from that middle; at the map's edge the scroll stops where it can.
 */
export function panTo(tokenId: string): void {
  const root = document.querySelector<HTMLElement>('[data-testid="combat-hud"]');
  const vp = root?.querySelector<HTMLElement>('.hud-map [data-testid="combat-viewport"]');
  const ring = root?.querySelector<HTMLElement>(`.hud-map [data-testid="hud-pick-ring"][data-token="${CSS.escape(tokenId)}"]`);
  const view = root ? visibleMap(root) : null;
  if (!vp || !ring || !view) return;
  const r = ring.getBoundingClientRect();
  vp.scrollBy({ left: r.left + r.width / 2 - (view.left + view.right) / 2, top: r.top + r.height / 2 - (view.top + view.bottom) / 2 });
}

/**
 * The highest a chip may sit on each edge (client coordinates): under the spotlight disc and its pill on the right
 * (PlayerPhone moved the chip from top 150 to 226 to clear `.mspot`) and under "Your character" and the map controls
 * on the left.
 */
function edgeTops(root: HTMLElement, view: Rect): Record<EdgeSide, number> {
  const below = (selector: string) => {
    const el = root.querySelector(selector);
    const r = el?.getBoundingClientRect();
    return r && r.height > 0 ? Math.max(view.top, r.bottom + 6) : view.top;
  };
  return { right: below('[data-testid="hud-phone-spotlight"]'), left: below(".hud-ph-tools") };
}

function measure(root: HTMLElement | null): string {
  if (!root) return "";
  const view = visibleMap(root);
  if (!view) return "";
  const top = root.getBoundingClientRect().top;
  const tops = edgeTops(root, view);
  const chips: Chip[] = [];
  for (const ring of root.querySelectorAll<HTMLElement>('.hud-map [data-testid="hud-pick-ring"][data-token]')) {
    const r = ring.getBoundingClientRect();
    const place = edgePlace({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, view, CHIP_H);
    if (place) {
      const y = Math.min(Math.max(place.y, tops[place.side]), Math.max(tops[place.side], view.bottom - CHIP_H - 4));
      chips.push({ id: ring.dataset.token!, side: place.side, arrow: place.arrow, y: Math.round(y - top) });
    }
  }
  return JSON.stringify(stackChips(chips, CHIP_H));
}

/** A per-instance store: a frame loop while subscribed, notifying only when the chips change. */
function edgeStore(rootOf: () => HTMLElement | null) {
  let snapshot = "";
  return {
    subscribe(onChange: () => void) {
      let frame = 0;
      const tick = () => {
        const next = measure(rootOf());
        if (next !== snapshot) {
          snapshot = next;
          onChange();
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    },
    get: () => snapshot,
  };
}

function EdgeChips({ state }: HudPartProps) {
  // The page has one HUD root (the shell's `combat-hud`).
  const [store] = useState(() => edgeStore(() => document.querySelector<HTMLElement>('[data-testid="combat-hud"]')));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, () => "");
  const pick = usePick();
  const live = pick.session;
  const scene = usePickScene(state, live?.spec ?? null, live?.picked ?? []);
  const chips: Chip[] = snapshot ? (JSON.parse(snapshot) as Chip[]) : [];
  const picked = live ? keepPicks(live.picked, scene.rows) : [];
  const rows = new Map(scene.rows.map((r) => [r.tokenId as string, r]));
  const shown = chips.flatMap((chip) => {
    const row = rows.get(chip.id);
    if (!row || row.side === "self") return [];
    const st = stateOf(row, picked);
    return [{ chip, row, st, text: edgeText({ name: row.name, band: bandLabel(row.band), reach: row.reach }, st, chip.arrow), tone: edgeTone(row, st) }];
  });
  return (
    <ul className="hud-ph-edges" aria-label="Targets off the screen" data-testid="hud-phone-edges" hidden={shown.length === 0}>
      {shown.map(({ chip, row, text, tone, st }) => (
        <li
          key={chip.id}
          className={cn("hud-ph-edge", `hud-ph-edge-${chip.side}`, `hud-ph-edge-${tone}`, st === "picked" && "hud-ph-edge-picked")}
          style={{ top: chip.y }}
          data-testid="hud-phone-edge"
          data-token={chip.id}
          data-state={st}
        >
          <button type="button" className="hud-ph-edge-b" title={`Show ${row.name} on the map`} onClick={() => panTo(chip.id)}>
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}
