"use client";

import "./actions.css";

import { Component, useId, useState, useSyncExternalStore, type ReactNode } from "react";

import type { ActionsPanelProps, ResolutionsProps } from "../slots";
import { AdversaryResolutions } from "./adversary/resolutions";
import { AttackBar } from "./attack";
import { PanelMemoryProvider } from "./attack/memory";
import { MapDice, MiniFeed } from "./dice";
import { Resolutions as GmResolutions } from "./gm";
import { GmHand, Hand, HandColumn } from "./hand";
import { TargetList } from "./targets";
import { useActor } from "./targets/state";

export { GmOwnHits, IncomingHit } from "./reactions";
export { TargetsLayer } from "./targets";
export { ActionsProvider, useCombatTargets, type Aim, type CombatTargets } from "./targets/state";

/**
 * Combat actions slot (plan combat-actions CA5): the player's Hand (CA6), Attack bar with the target list, the map dice
 * box and the mini feed; the GM's Resolutions. On a desktop or tablet they are cards in the player column; at 760 px
 * and below they live in a bottom sheet under the map with the tabs Hand / Attack / Dice / Feed (Q11). Export names and
 * props follow src/components/combat-map/slots.ts.
 * HF1 (plan hand-fan, dcm-bxp.99.30): the Hand's cards dock along the bottom of the map at every width, mounted once
 * outside the layout switch; the column's (and the sheet's) Hand card says where they are and holds "Hide my hand".
 */

/** The phone breakpoint of the Combat Map page (combat-map.css). */
export const SHEET_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const list = window.matchMedia(SHEET_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** Whether the page is at phone width (read from the media query during render; no effect, CL7). */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHEET_QUERY).matches,
    () => false,
  );
}

/** Keeps one failing part (a `useQuery` that throws, rule 11) from taking the others down; "Try again" remounts it. */
class PartBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="cm-alert">
        <span>{this.props.label} failed to load.</span>
        <button type="button" className="cm-btn cm-sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

export type SheetTab = "hand" | "attack" | "dice" | "feed";

export const SHEET_TABS: readonly { key: SheetTab; label: string }[] = [
  { key: "hand", label: "Hand" },
  { key: "attack", label: "Attack" },
  { key: "dice", label: "Dice" },
  { key: "feed", label: "Feed" },
];

function TabBody({ tab, props }: { tab: SheetTab; props: ActionsPanelProps }) {
  switch (tab) {
    case "hand":
      return (
        <PartBoundary label="The hand card">
          <HandColumn {...props} />
        </PartBoundary>
      );
    case "attack":
      return (
        <>
          <PartBoundary label="Targets">
            <TargetList {...props} />
          </PartBoundary>
          <PartBoundary label="The Attack bar">
            <AttackBar {...props} />
          </PartBoundary>
        </>
      );
    case "dice":
      return (
        <PartBoundary label="The dice box">
          <MapDice {...props} />
        </PartBoundary>
      );
    case "feed":
      return (
        <PartBoundary label="The roll feed">
          <MiniFeed campaignId={props.campaignId} />
        </PartBoundary>
      );
  }
}

/** Phone: the bottom sheet. Closed it is a bar of tabs under the map; a tab opens it, the open tab (or Hide) closes it. */
function BottomSheet(props: ActionsPanelProps) {
  const [tab, setTab] = useState<SheetTab>("hand");
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="cma-sheet" data-open={open} data-testid="combat-actions-sheet">
      {open ? (
        <div className="cma-sheet-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
          <TabBody tab={tab} props={props} />
        </div>
      ) : null}
      <div className="cma-sheet-bar">
        <div className="cma-tabs" role="tablist" aria-label="Combat actions">
          {SHEET_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${id}-${t.key}`}
              aria-selected={open && tab === t.key}
              aria-controls={open && tab === t.key ? `${id}-panel` : undefined}
              className="cma-tab"
              onClick={() => {
                if (open && tab === t.key) setOpen(false);
                else {
                  setTab(t.key);
                  setOpen(true);
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {open ? (
          <button type="button" className="cma-tab cma-hide" aria-label="Hide the actions" onClick={() => setOpen(false)}>
            ▾
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Desktop and tablet: the parts as cards in the player column. */
function Cards(props: ActionsPanelProps) {
  return (
    <>
      <TabBody tab="hand" props={props} />
      <section className="cm-card cma-card" aria-label="Attack">
        <h2 className="cm-h">Attack</h2>
        <TabBody tab="attack" props={props} />
      </section>
      <section className="cm-card cma-card" aria-label="Map dice">
        <TabBody tab="dice" props={props} />
      </section>
      <section className="cm-card cma-card" aria-label="Roll feed">
        <h2 className="cm-h">Roll feed</h2>
        <TabBody tab="feed" props={props} />
      </section>
    </>
  );
}

/**
 * Player column: everything a player does on the map, once their character has a token on the live map. The panel
 * memory sits above the layout switch, so the last attack and card results survive crossing 760 px (user answer
 * 2026-10-22).
 */
export function ActionsPanel(props: ActionsPanelProps) {
  const phone = usePhoneLayout();
  const actor = useActor(props);
  if (!actor) return null;
  return (
    <PanelMemoryProvider>
      {/* The cards dock over the map's bottom edge at every width (HF1), so they stay mounted across the switch. */}
      <PartBoundary label="Your hand">
        <Hand {...props} />
      </PartBoundary>
      {phone ? <BottomSheet {...props} /> : <Cards {...props} />}
    </PanelMemoryProvider>
  );
}

/**
 * GM column, last (the page's Resolutions slot): the Hand of the selected PC with "Play for this character" and the
 * card uses waiting for the GM (CA6), the latest adversary actions with Undo (AA5, U4), then CA5's Resolutions. The
 * player's incoming-hit prompt (AA4, `./reactions`) is mounted by the page first in the player column; the GM answers
 * open hits with "Resolve now", and a PC the GM owns gets the prompt itself, in AA5's adversary panel.
 */
export function Resolutions(props: ResolutionsProps) {
  return (
    <>
      <PartBoundary label="The hand">
        <GmHand {...props} />
      </PartBoundary>
      <PartBoundary label="Adversary actions">
        <AdversaryResolutions {...props} />
      </PartBoundary>
      <GmResolutions {...props} />
    </>
  );
}
