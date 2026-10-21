"use client";

import type { NotesSlotProps } from "../slots";

const GROUPS = [
  { label: "Session logs", add: "New session log" },
  { label: "Collections", add: "New collection" },
  { label: "Future log", add: "New future page" },
] as const;

/**
 * The index column's own-page groups (B2): 'Session logs' / 'Collections' / 'Future log', each with '＋' and its page
 * buttons (tape tab, title, count). N0 stub: the empty groups; N2 fills them from the `journal` query.
 */
export function PageGroups({ search }: NotesSlotProps) {
  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.label} className="bj-group">
          <div className="bj-lbl bj-group-head">
            <span>{group.label}</span>
            <button type="button" className="bj-ghost bj-plus" aria-label={group.add} title={group.add} disabled>
              ＋
            </button>
          </div>
          <div className="bj-empty">{search ? "No matches." : "Nothing here yet."}</div>
        </div>
      ))}
    </>
  );
}
