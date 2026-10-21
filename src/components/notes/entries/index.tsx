"use client";

import type { NotesSlotProps } from "../slots";

const KEY = ["• task", "× done", "> migrated", "< scheduled", "○ event", "– note", "! idea"];

/**
 * A page's entries (B4): rows, the 'Bullet type' chips, the add row and the KEY legend. N0 stub: the empty line and
 * the KEY; N3 fills it from the `entries` query.
 */
export function Entries(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <>
      <p className="bj-line">A fresh page. What happened at the table?</p>
      <div className="bj-keybox">
        <div className="bj-keyhead">KEY</div>
        <div className="bj-key">
          {KEY.map((text) => (
            <span key={text}>{text}</span>
          ))}
          <span className="bj-hope">✦ Hope · a boon</span>
          <span className="bj-fear">☠ Fear · a threat</span>
          <span>★ priority</span>
        </div>
      </div>
    </>
  );
}

/** '➜ Migrate open tasks' for the page toolbar (B6). N0 stub: disabled; N3 wires it. */
export function MigrateButton(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <button type="button" className="bj-ghost bj-paper-btn" disabled title="Copy open tasks to a new page and mark them > here">
      ➜ Migrate open tasks
    </button>
  );
}
