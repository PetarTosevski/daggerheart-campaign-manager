"use client";

import "./adversary.css";

import dynamic from "next/dynamic";

import type { AdversaryPanelProps } from "../../slots";
import { GmOwnHits } from "../reactions";
import { PartBoundary } from "./part-boundary";

export { HitFlashLayer } from "./flash";
export { AdversaryResolutions } from "./resolutions";

function ControlsLoading() {
  return (
    <p role="status" className="cm-muted">
      Loading the adversary controls…
    </p>
  );
}

// CL8: the controls carry the SRD stat blocks (the Encounter tab's rules); load them only in the GM's column.
const AdversaryControls = dynamic(() => import("./controls").then((m) => m.AdversaryControls), { loading: ControlsLoading });

/**
 * GM column in Play, under the token card (plan combat-actions AA5): first the incoming-hit prompt of any PC the GM owns
 * (AA4's prompt; user answer 2026-10-22), then the "Adversaries" card: the open reaction windows with "Resolve now"
 * (Q17) and the selected adversary token's Attack, feature Use buttons and Fear questions, the same as the Encounter
 * tab's (Q12, Q16, Q19). Players never get this panel (U1).
 */
export function AdversaryPanel(props: AdversaryPanelProps) {
  if (props.role !== "gm") return null;
  return (
    <>
      <GmOwnHits campaignId={props.campaignId} role={props.role} />
      <section className="cm-card cma-card cmx-adv" aria-label="Adversaries" data-testid="adversary-panel">
        <h2 className="cm-h">Adversaries</h2>
        <PartBoundary label="The adversary controls">
          <AdversaryControls {...props} />
        </PartBoundary>
      </section>
    </>
  );
}
