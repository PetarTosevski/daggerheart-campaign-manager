import type { ReactNode } from "react";

import type { LorekeeperSideProps } from "../slots";

/**
 * The sidebar cards: Library, How I answer, Table rulings, and on phones the 'Library & rulings' fold (L7 replaces
 * this L0 stub, keeping the names and props; contract in ../slots.ts). The stub shows the cards' frames.
 */
export const LorekeeperSide: (props: LorekeeperSideProps) => ReactNode = () => {
  return (
    <>
      <section className="lk-card" aria-label="Library">
        <h2 className="lk-h">Library</h2>
        <span className="lk-muted">The Lorekeeper only answers from these books. Turn one off to leave it out.</span>
        <span className="lk-muted">No books yet.</span>
      </section>
      <section className="lk-card" aria-label="How answers are marked">
        <h2 className="lk-h">How I answer</h2>
        <div className="lk-legend">
          <span className="lk-pill lk-ok">From the rules</span>
          <span>Quoted from your books, with the book and section.</span>
          <span className="lk-pill lk-amber">Rules unclear</span>
          <span>The books touch on it but don’t settle it. You get what they say and a suggested GM call.</span>
          <span className="lk-pill lk-red">Not in your books</span>
          <span>Nothing found. Results from the internet follow, clearly marked as unofficial.</span>
        </div>
      </section>
      <section className="lk-card" aria-label="Table rulings">
        <h2 className="lk-h">Table rulings</h2>
        <span className="lk-muted">Calls your GM pinned. The Lorekeeper quotes these before the internet.</span>
        <span className="lk-muted">No rulings yet.</span>
      </section>
    </>
  );
};

/** The chat header's '<N> books indexed' pill (L7). The stub renders nothing. */
export const IndexPill: (props: LorekeeperSideProps) => ReactNode = () => {
  return null;
};
