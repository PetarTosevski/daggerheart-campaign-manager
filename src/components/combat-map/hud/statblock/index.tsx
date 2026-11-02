"use client";

import "./statblock.css";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import type { HudPartProps } from "../state";
import { useHud } from "../state";
import { useFearAsk, useGmActs } from "./acts";

function Loading() {
  return (
    <p role="status" className="hud-loading">
      Loading the stat block…
    </p>
  );
}

// CL8: the panel carries the SRD stat blocks (tracker rules); load them only when the GM opens one.
const StatBlockPanel = dynamic(() => import("./panel").then((m) => m.StatBlockPanel), { loading: Loading });

/**
 * The GM's adversary stat block on parchment in the sheet panel, with the attack picker (plan combat-hud H5.2;
 * GMDesktop 'Adversary acting'). An enemy token (H1.3) opens it through `useHud().toggleSheet({ kind: "adversary",
 * tokenId })`; another token swaps it, the same one, ✕ or Esc closes it. The shell mounts this for the GM only, in its
 * own PartBoundary; it stays mounted with no panel open, so FearConfirm (answer 6a) and the last result outlive the
 * panel (a question asked from the purple picking panel still gets its answer when the stat block closes).
 */
export const HudStatBlock: (props: HudPartProps) => ReactNode = ({ state }) => {
  const hud = useHud();
  const fear = useFearAsk();
  const acts = useGmActs(state.campaignId, fear.ask);
  const sheet = hud.sheet;
  return (
    <>
      {sheet?.kind === "adversary" ? <StatBlockPanel state={state} tokenId={sheet.tokenId} acts={acts} ask={fear.ask} onClose={hud.closeSheet} /> : null}
      {fear.node}
    </>
  );
};
