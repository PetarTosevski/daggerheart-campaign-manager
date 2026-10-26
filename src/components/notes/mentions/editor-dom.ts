// The rich entry editor's DOM (dcm-bxp.106): a contenteditable holds text nodes and mention chips, and turns into the
// stored D7 text ('@[<name>](<codexEntryId>)' tokens) and back. Browser-only helpers over the editor element; no React.

import { activeMentionQuery, formatToken, parseTokens, sanitizeMentionName } from "@/lib/domain/notes";

/** The class every chip carries (styles in mentions.css). */
export const CHIP_CLASS = "bj-mi-chip";

/** A non-breaking space: the space typed after a chip, kept visible by the browser; stored as a plain space. */
const NBSP = " ";

/** One mention chip: not editable inside, carries the entry id and the name its token stores. */
export function createChip(doc: Document, id: string, name: string): HTMLSpanElement {
  const chip = doc.createElement("span");
  chip.className = CHIP_CLASS;
  chip.setAttribute("contenteditable", "false");
  chip.dataset.id = id;
  chip.dataset.name = sanitizeMentionName(name);
  chip.textContent = chip.dataset.name;
  return chip;
}

function isChip(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.id !== undefined;
}

/** Replaces the editor's content with the stored text: text runs as text, tokens as chips. */
export function fillEditor(editor: HTMLElement, text: string): void {
  const doc = editor.ownerDocument;
  editor.replaceChildren(
    ...parseTokens(text).map((part) => (part.type === "text" ? doc.createTextNode(part.text) : createChip(doc, part.id, part.name))),
  );
}

/** The stored text the editor holds: chips become tokens, non-breaking spaces and line breaks plain spaces. */
export function serializeEditor(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) out += (child as Text).data;
    else if (isChip(child)) out += formatToken(child.dataset.name ?? child.textContent ?? "", child.dataset.id!);
    else if (child.nodeName === "BR") out += " ";
    else out += serializeEditor(child);
  }
  return out.replace(new RegExp(NBSP, "g"), " ").replace(/[\r\n]+/g, " ");
}

/** The number of chips (MAX_MENTIONS applies to them). */
export function countChips(editor: HTMLElement): number {
  return editor.querySelectorAll(`.${CHIP_CLASS}`).length;
}

/** The '@query' the caret is in: its text node, the '@' offset, the caret offset and the typed query; else null. */
export type CaretMention = { node: Text; start: number; end: number; query: string };

export function caretMention(editor: HTMLElement): CaretMention | null {
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE || !editor.contains(anchorNode)) return null;
  const node = anchorNode as Text;
  const found = activeMentionQuery(node.data.replace(new RegExp(NBSP, "g"), " "), anchorOffset);
  return found === null ? null : { node, start: found.start, end: anchorOffset, query: found.query };
}

/**
 * Replaces the typed '@query' with a chip and one space after it (an existing leading space of the rest is reused) and
 * puts the caret after that space.
 */
export function insertChip(editor: HTMLElement, at: CaretMention, ref: { id: string; name: string }): void {
  const doc = editor.ownerDocument;
  const range = doc.createRange();
  range.setStart(at.node, at.start);
  range.setEnd(at.node, at.end);
  range.deleteContents();
  const chip = createChip(doc, ref.id, ref.name);
  range.insertNode(chip);
  let after = chip.nextSibling;
  if (after !== null && after.nodeType === Node.TEXT_NODE) {
    const text = after as Text;
    text.data = NBSP + text.data.replace(/^[  ]/, "");
  } else {
    after = doc.createTextNode(NBSP);
    chip.after(after);
  }
  // Drop the empty text node the range may leave before the chip.
  if (at.node.data === "" && at.node.parentNode) at.node.remove();
  placeCaret(editor, after, 1);
}

/** Inserts plain text at the caret (paste), replacing the selection, and puts the caret after it. */
export function insertPlainText(editor: HTMLElement, text: string): void {
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  const clean = text.replace(/[\r\n]+/g, " ");
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    const node = doc.createTextNode(clean);
    editor.append(node);
    placeCaret(editor, node, node.length);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = doc.createTextNode(clean);
  range.insertNode(node);
  placeCaret(editor, node, node.length);
}

/** Puts a collapsed caret at (node, offset), or at the editor's end when no node is given. */
export function placeCaret(editor: HTMLElement, node?: Node, offset?: number): void {
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return;
  const range = editor.ownerDocument.createRange();
  if (node === undefined) {
    range.selectNodeContents(editor);
    range.collapse(false);
  } else {
    range.setStart(node, offset ?? 0);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
