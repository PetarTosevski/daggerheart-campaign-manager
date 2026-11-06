"use client";

import { cn } from "@/lib/utils";

import { Pips } from "../ui";
import { markedText } from "./model";

export type TrackProps = {
  kind: "hp" | "stress";
  name: string;
  /** What one mark is, singular and plural ("Hit Point", "Hit Points"): names the pips and the − / + buttons. */
  noun: [string, string];
  marked: number;
  max: number;
  /** The most marks + may reach (default `max`): the revive box stops one short of a defeating HP mark. */
  cap?: number;
  onStep: (delta: -1 | 1) => void;
};

/**
 * One HP or Stress row of the GM's stat block (plan combat-hud H5.2; GMDesktop `.ad-trk`): the label, the pips, "n of
 * max marked" and − / +. The stat block steps the live tracker with it; the revive box (bead dcm-6c2o) steps the marks it
 * will send. The caller owns the value (CL3, CL7). Styles: statblock.css (`.hsb-tr`, under `.hsb-trk`).
 */
export function Track({ kind, name, noun, marked, max, cap = max, onStep }: TrackProps) {
  const text = markedText(marked, max);
  return (
    <div className={cn("hsb-tr", `hsb-tr-${kind}`)}>
      <span className="hsb-l">{name}</span>
      <Pips kind={kind} on={marked} max={max} label={`${marked} of ${max} ${noun[1]} marked`} />
      <b className="hsb-n">{text}</b>
      <span className="hsb-step">
        <button type="button" aria-label={`Clear 1 ${noun[0]}`} disabled={marked <= 0} onClick={() => onStep(-1)}>
          −
        </button>
        <button type="button" aria-label={`Mark 1 ${noun[0]}`} disabled={marked >= cap} onClick={() => onStep(1)}>
          +
        </button>
      </span>
    </div>
  );
}
