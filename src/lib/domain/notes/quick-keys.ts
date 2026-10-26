// Quick keys of the add row (D11 N1; board rule B4). Pure module.
//
// B4: "quick keys '* . o - ! + ^' + space". Board l.278-281: a line that starts with one of the keys and a space takes
// that key's kind and loses the prefix; any other line keeps the selected kind. The text is trimmed.
//
// ```ts
// parseQuickKey("^ ambush at the ford", "task");   // { kind: "fear", text: "ambush at the ford" }
// parseQuickKey("*no space", "note");              // { kind: "note", text: "*no space" }
// ```

import type { EntryKind } from "./types";

/** The quick keys and their kinds (board l.278). '*' and '.' both write a task. */
export const QUICK_KEYS: Readonly<Record<string, EntryKind>> = {
  "*": "task",
  ".": "task",
  o: "event",
  "-": "note",
  "!": "idea",
  "+": "hope",
  "^": "fear",
};

const QUICK_KEY_RE = /^\s*([*.o!+^-])\s+([\s\S]*)$/;

/**
 * The kind and text an add-row line becomes: a leading quick key plus whitespace picks the kind and is dropped;
 * otherwise `selectedKind` applies. The text is trimmed and may come back empty (the caller adds nothing then).
 */
export function parseQuickKey(text: string, selectedKind: EntryKind): { kind: EntryKind; text: string } {
  const m = QUICK_KEY_RE.exec(text);
  const kind = m ? QUICK_KEYS[m[1]!] : undefined;
  if (m && kind) return { kind, text: m[2]!.trim() };
  return { kind: selectedKind, text: text.trim() };
}

/** The Quick keys card copy in the index column (board l.103-105). */
export const QUICK_KEYS_COPY = {
  title: "Quick keys",
  keys: "Start a line with * task · o event · - note · ! idea · + Hope · ^ Fear",
  mentions: "Type @name to link someone or somewhere from Characters & Locations.",
} as const;
