"use client";

import "./actions.css";

import { Component, type ReactNode } from "react";

import type { ResolutionsProps } from "../slots";
import { AdversaryResolutions } from "./adversary/resolutions";
import { Resolutions as GmResolutions } from "./gm";
import { EndSceneButton } from "./scene";

export { GmOwnHits } from "./reactions";
export { TargetsLayer } from "./targets";
export { ActionsProvider, useCombatTargets, type Aim, type CombatTargets } from "./targets/state";

/**
 * Combat actions slot (plan combat-actions CA5): the GM's Resolutions, the target rings layer and the shared target
 * state. Plan combat-hud H8.1 (cut-over): the player's Hand, Attack bar, target list, map dice, mini feed and phone
 * bottom sheet are the HUD's now (`hud/hand`, `hud/pick-attack`, `hud/pick`, `hud/scene/dice.tsx`, `hud/feed`,
 * `hud/phone`), and the GM plays a PC's cards from the HUD's hand. Export names and props follow
 * src/components/combat-map/slots.ts.
 */

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

/**
 * GM column, last (the page's Resolutions slot): the latest adversary actions with Undo (AA5, U4), then CA5's
 * Resolutions. Last, the End scene button (SD8, `combatScenes.end`; CB p.107): it reads nothing, so it needs no
 * boundary.
 */
export function Resolutions(props: ResolutionsProps) {
  return (
    <>
      <PartBoundary label="Adversary actions">
        <AdversaryResolutions {...props} />
      </PartBoundary>
      <GmResolutions {...props} />
      <section className="cm-card cma-card" aria-label="Scene">
        <h2 className="cm-h">Scene</h2>
        <div className="flex flex-wrap items-center gap-2">
          <EndSceneButton campaignId={props.campaignId} className="cm-btn" />
        </div>
      </section>
    </>
  );
}
