// Mention tokens (D11 N1; Q6, D7). Pure module.
//
// D7: "Mentions are stored in the entry text as '@[<name when written>](<codexEntryId>)' tokens (at most 10 per entry;
// the server checks each id is a codex entry of the campaign the author can see, else INVALID); a viewer who can see the
// entry gets a link with its current name, everyone else the stored name as plain text."
// Q6: "An @ picker stores the Codex entry id, so links survive renames; the current name is shown."
// The board draws a link without the '@' (l.229), so the rendered and plain text is the bare name.
//
// ```ts
// const text = "Met @[Marlow](k57abc) at the ford";
// parseTokens(text);   // [{ type: "text", text: "Met " }, { type: "mention", id: "k57abc", name: "Marlow" },
//                      //  { type: "text", text: " at the ford" }]
// toPlainText(text);   // "Met Marlow at the ford"
// renderParts(parseTokens(text), { k57abc: { name: "Marlow the Grey", kind: "character" } });
//   // [..., { type: "link", id: "k57abc", text: "Marlow the Grey", tip: "Character" }, ...]
// ```

import { NOTE_LIMITS } from "./limits";

/** The token pattern: '@[' name without brackets or line breaks ']' '(' an id of letters, digits, '_' or '-' ')'. */
export const MENTION_TOKEN_RE = /@\[([^\][\n\r]*)\]\(([A-Za-z0-9_-]+)\)/g;

export const MAX_MENTIONS = NOTE_LIMITS.MAX_MENTIONS;

export type TextPart =
  | { type: "text"; text: string }
  | { type: "mention"; id: string; name: string };

/** A name as it may sit inside a token: brackets and line breaks become spaces, then trimmed and squeezed. */
export function sanitizeMentionName(name: string): string {
  return name.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

/** '@[name](id)' with the name sanitised. */
export function formatToken(name: string, id: string): string {
  return `@[${sanitizeMentionName(name)}](${id})`;
}

/** Splits entry text into plain runs and mention tokens, in order. Text without tokens is one text part ('' -> []). */
export function parseTokens(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const at = m.index;
    if (at > last) parts.push({ type: "text", text: text.slice(last, at) });
    parts.push({ type: "mention", id: m[2]!, name: m[1]! });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

/** The number of mention tokens in the text (repeats count). */
export function countMentions(text: string): number {
  return [...text.matchAll(MENTION_TOKEN_RE)].length;
}

/** The distinct ids the text mentions, in first-seen order (the server checks each, D7). */
export function mentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_TOKEN_RE)].map((m) => m[2]!))];
}

/** True when the text has at most MAX_MENTIONS tokens. */
export function withinMentionLimit(text: string): boolean {
  return countMentions(text) <= MAX_MENTIONS;
}

/** The text with every token replaced by its stored name (search, export, the tear-out lines). */
export function toPlainText(text: string): string {
  return text.replace(MENTION_TOKEN_RE, (_m, name: string) => name);
}

/**
 * The '@query' the caret is in, for the picker: the last '@' before the caret that starts the text or follows
 * whitespace, with no line break between it and the caret, and not inside an existing token. `start` is the '@' index.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\n\r]/.test(query) || query.startsWith("[")) return null;
  return { start: at, query };
}

/**
 * Replaces text[start, end) (the typed '@query') with the token and one space. Returns the new text and the caret
 * position after the space.
 */
export function insertMention(
  text: string,
  start: number,
  end: number,
  ref: { id: string; name: string },
): { text: string; caret: number } {
  const token = formatToken(ref.name, ref.id) + " ";
  const rest = text.slice(end).replace(/^ /, "");
  return { text: text.slice(0, start) + token + rest, caret: start + token.length };
}

/** A Codex entry the viewer can see (from the viewer's `codex.list`). */
export type VisibleRef = { name: string; kind?: "character" | "location"; role?: string | null };

export type RenderedPart =
  | { type: "text"; text: string }
  | { type: "link"; id: string; text: string; tip: string };

/**
 * Parts for display: a mention of an entry in `visibleRefs` becomes a link with its CURRENT name and the role tooltip
 * (role, else 'Location' for a location, else 'Character'); any other mention is its stored name as plain text (Q6).
 * Adjacent text runs are merged.
 */
export function renderParts(
  parts: readonly TextPart[],
  visibleRefs: Readonly<Record<string, VisibleRef>> | ReadonlyMap<string, VisibleRef>,
): RenderedPart[] {
  const lookup = (id: string): VisibleRef | undefined => {
    if (visibleRefs instanceof Map) return visibleRefs.get(id);
    const record = visibleRefs as Readonly<Record<string, VisibleRef>>;
    return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
  };
  const out: RenderedPart[] = [];
  const pushText = (text: string) => {
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };
  for (const p of parts) {
    if (p.type === "text") {
      pushText(p.text);
      continue;
    }
    const ref = lookup(p.id);
    if (!ref) {
      pushText(p.name);
      continue;
    }
    const tip = ref.role?.trim() || (ref.kind === "location" ? "Location" : "Character");
    out.push({ type: "link", id: p.id, text: ref.name, tip });
  }
  return out;
}
