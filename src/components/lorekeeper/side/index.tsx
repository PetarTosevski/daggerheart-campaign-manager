"use client";

import "./side.css";

import { useId, useState } from "react";

import { LEGEND_TITLE, VERDICT_COPY } from "@/lib/lorekeeper/copy";

import type { LorekeeperSideProps } from "../slots";
import { IndexPillView, LibraryCard } from "./library";
import { RulingsCard } from "./rulings";

/** The board's three legend rows, in its order and colours. */
const LEGEND = [
  { verdict: "rules", pill: "lk-pill lk-ok" },
  { verdict: "unclear", pill: "lk-pill lk-amber" },
  { verdict: "none", pill: "lk-pill lk-red" },
] as const;

/** How I answer (board: the three legend rows verbatim). */
function LegendCard() {
  return (
    <section className="lk-card" aria-label="How answers are marked">
      <h2 className="lk-h">{LEGEND_TITLE}</h2>
      <div className="lk-legend">
        {LEGEND.map(({ verdict, pill }) => (
          <div key={verdict} className="lk-legendrow">
            <span className={pill}>{VERDICT_COPY[verdict].label}</span>
            <span>{VERDICT_COPY[verdict].legend}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The sidebar (D13 L7; contract in ../slots.ts): Library, How I answer and Table rulings. On phones (<= 760 px) they
 * sit in a 'Library & rulings' fold above the chat, closed at first (Q12); on wider screens the fold's button is
 * hidden and the cards always show.
 */
export function LorekeeperSide(props: LorekeeperSideProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="lk-fold" data-open={open}>
      <button type="button" className="lk-foldbtn" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((was) => !was)}>
        <span>Library &amp; rulings</span>
        <span aria-hidden="true" className="lk-foldicon">
          ▾
        </span>
      </button>
      <div id={bodyId} className="lk-foldbody">
        <LibraryCard {...props} />
        <LegendCard />
        <RulingsCard {...props} />
      </div>
    </div>
  );
}

/** The chat header's '<N> books indexed' pill. */
export function IndexPill(props: LorekeeperSideProps) {
  return <IndexPillView {...props} />;
}
