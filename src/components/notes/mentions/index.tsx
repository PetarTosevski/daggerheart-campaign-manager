"use client";

import "./mentions.css";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Fragment, useCallback, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { countMentions, MAX_MENTIONS, parseTokens, renderParts, type TextPart } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { EntryTextProps, MentionInputProps } from "../slots";
import {
  caretMention,
  countChips,
  fillEditor,
  insertChip,
  insertPlainText,
  placeCaret,
  serializeEditor,
  type CaretMention,
} from "./editor-dom";
import { codexHref, pickerOptions, visibleRefs, type PickerOption } from "./options";

/**
 * An entry's text (D11 N5; Q6, D7). Text without mention tokens is shown as written. A token for a Codex entry the
 * viewer can see (their own `codex.list`: the GM every entry, a player the entries the party knows) is a link with the
 * entry's CURRENT name and its role as the tooltip, opening the Codex on it; any other token is its stored name as plain
 * text, never a link or a role. While the list loads, the stored names show as plain text.
 */
export function EntryText({ campaignId, text }: EntryTextProps) {
  const parts = parseTokens(text);
  if (!parts.some((p) => p.type === "mention")) return <>{text}</>;
  return <MentionedText campaignId={campaignId} parts={parts} />;
}

function MentionedText({ campaignId, parts }: { campaignId: Id<"campaigns">; parts: TextPart[] }) {
  const data = useQuery(api.codex.list, { campaignId });
  const ids = new Set(parts.flatMap((p) => (p.type === "mention" ? [p.id] : [])));
  const rendered = renderParts(parts, data === undefined ? new Map() : visibleRefs(data.entries, ids));
  return (
    <>
      {rendered.map((p, i) =>
        p.type === "text" ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : (
          <Link key={i} className="bj-mention" href={codexHref(campaignId, p.id)} title={p.tip}>
            {p.text}
          </Link>
        ),
      )}
    </>
  );
}

/** What the options list lets the input do with the keyboard. */
type PickerHandle = { count: () => number; choose: (index: number) => boolean };

/**
 * The add / edit field with the @ picker (D11 N5; Q6, D7) as a rich editor (dcm-bxp.106): a single-line
 * contenteditable in which every mention is a name chip while writing and editing, never the raw token. Typing '@'
 * (at the start, after a space or right after a chip) opens a listbox of the Characters & Locations entries the
 * writer can see, filtered by what follows the '@'. Arrow keys move, Enter or a click puts a chip there with a space
 * after it, Escape closes the list (a second Escape cancels an edit). Backspace removes a chip whole. At most
 * MAX_MENTIONS chips per entry: then the list only says so. Enter without an open choice submits the stored text
 * (chips as '@[name](id)' tokens), trimmed; paste inserts plain text only; line breaks never enter.
 *
 * The editor's DOM is the state (editor-dom.ts): React renders no children into it, so live updates never reset the
 * caret; `defaultValue` fills it once when it mounts. A chip shows the name its token stores.
 *
 * ARIA: the ARIA 1.1 combobox pattern (a `combobox` wrapper owning the listbox; the editor a single-line `textbox` with
 * `aria-autocomplete`, `aria-controls` and `aria-activedescendant`), so the field keeps its textbox role and name
 * ('New entry' / 'Edit entry'). The placeholder is `aria-placeholder` (and `placeholder`, drawn by CSS while empty).
 */
export function MentionInput({
  campaignId,
  label,
  placeholder,
  className,
  defaultValue,
  autoFocus,
  onSubmit,
  onCancel,
  onBlurText,
}: MentionInputProps) {
  const editor = useRef<HTMLDivElement | null>(null);
  const picker = useRef<PickerHandle>(null);
  /** The '@query' at the caret while the editor has focus; null otherwise (the list shows only while focused). */
  const [mention, setMention] = useState<CaretMention | null>(null);
  /** The '@' whose list Escape closed. */
  const [dismissed, setDismissed] = useState<{ node: Text; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(!defaultValue);
  const [full, setFull] = useState(() => countMentions(defaultValue ?? "") >= MAX_MENTIONS);
  const listId = useId();

  /** Fills the editor once when it mounts (a ref callback, not an effect) and, for an edit, focuses it at the end. */
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      const fresh = element !== null && editor.current !== element;
      editor.current = element;
      if (!fresh) return;
      fillEditor(element, defaultValue ?? "");
      if (autoFocus) {
        element.focus();
        placeCaret(element);
      }
    },
    [defaultValue, autoFocus],
  );

  const open =
    mention !== null &&
    !(dismissed !== null && dismissed.node === mention.node && dismissed.start === mention.start) &&
    !/^\s/.test(mention.query);
  const optionId = (index: number) => `${listId}-${index}`;

  /** Reads the caret's '@query', emptiness and the chip count from the editor (after any change or caret move). */
  function sync() {
    const element = editor.current;
    if (element === null) return;
    const next = caretMention(element);
    setMention((prev) =>
      prev !== null && next !== null && prev.node === next.node && prev.start === next.start && prev.end === next.end && prev.query === next.query
        ? prev
        : next,
    );
    if (next === null) setDismissed(null);
    setEmpty(serializeEditor(element) === "");
    setFull(countChips(element) >= MAX_MENTIONS);
  }

  function choose(option: PickerOption) {
    const element = editor.current;
    if (element === null || mention === null) return;
    insertChip(element, mention, { id: option.id, name: option.name });
    setActive(0);
    sync();
  }

  function submit() {
    const element = editor.current;
    if (element === null) return;
    const text = serializeEditor(element).trim();
    if (!text) return;
    onSubmit(text);
    element.replaceChildren();
    setDismissed(null);
    sync();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    // Plain text only: no bold / italic / underline shortcuts.
    if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    if (open && mention !== null) {
      const count = picker.current?.count() ?? 0;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
        event.preventDefault();
        setActive((i) => (event.key === "ArrowDown" ? (i + 1) % count : (i - 1 + count) % count));
        return;
      }
      if (event.key === "Enter" && picker.current?.choose(active)) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed({ node: mention.node, start: mention.start });
        return;
      }
    }
    if (event.key === "Escape") onCancel?.();
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  return (
    <span className="bj-mi" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-owns={open ? listId : undefined}>
      <div
        ref={attach}
        className={`${className ?? "bj-add"} bj-mi-ed`}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        aria-label={label}
        aria-multiline="false"
        aria-autocomplete="list"
        aria-placeholder={placeholder || undefined}
        {...{ placeholder: placeholder || undefined }}
        data-empty={empty || undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onInput={() => {
          setActive(0);
          sync();
        }}
        onKeyUp={(event) => {
          if (!["Enter", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) sync();
        }}
        onSelect={sync}
        onClick={sync}
        onFocus={sync}
        onBlur={() => {
          setMention(null);
          const element = editor.current;
          if (element !== null) onBlurText?.(serializeEditor(element));
        }}
        onPaste={(event) => {
          event.preventDefault();
          const element = editor.current;
          if (element === null) return;
          insertPlainText(element, event.clipboardData.getData("text/plain"));
          sync();
        }}
        onDrop={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      />
      {open && mention !== null ? (
        <MentionOptions
          ref={picker}
          campaignId={campaignId}
          query={mention.query}
          full={full}
          listId={listId}
          optionId={optionId}
          active={active}
          onActive={setActive}
          onChoose={choose}
        />
      ) : null}
    </span>
  );
}

type OptionsProps = {
  ref: Ref<PickerHandle>;
  campaignId: Id<"campaigns">;
  query: string;
  full: boolean;
  listId: string;
  optionId: (index: number) => string;
  active: number;
  onActive: (index: number) => void;
  onChoose: (option: PickerOption) => void;
};

/**
 * The listbox under the input. It reads the writer's `codex.list` only while it is open (players get the entries the
 * party knows, the GM every entry: exactly what the server accepts in a token, D7). With nothing to choose it shows one
 * disabled option saying why (loading, the limit, or no match), so the input's active descendant always exists.
 */
function MentionOptions({ ref, campaignId, query, full, listId, optionId, active, onActive, onChoose }: OptionsProps) {
  const data = useQuery(api.codex.list, full ? "skip" : { campaignId });
  const options = full || data === undefined ? [] : pickerOptions(data.entries, query);
  const current = Math.min(active, Math.max(options.length - 1, 0));

  useImperativeHandle(ref, () => ({
    count: () => options.length,
    choose: (index) => {
      const option = options[Math.min(index, options.length - 1)];
      if (!option) return false;
      onChoose(option);
      return true;
    },
  }));

  const note = full
    ? `At most ${MAX_MENTIONS} links in one entry.`
    : data === undefined
      ? "Loading Characters & Locations…"
      : data.entries.length === 0
        ? "Nothing in Characters & Locations yet."
        : "No match in Characters & Locations.";

  return (
    <ul className="bj-mi-list" role="listbox" id={listId} aria-label="Characters & Locations">
      {options.length === 0 ? (
        <li className="bj-mi-note" role="option" id={optionId(0)} aria-selected={false} aria-disabled="true">
          {note}
        </li>
      ) : (
        options.map((option, i) => (
          <li
            key={option.id}
            className="bj-mi-opt"
            role="option"
            id={optionId(i)}
            aria-selected={i === current}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => i !== current && onActive(i)}
            onClick={() => onChoose(option)}
          >
            <span className="bj-mi-name">{option.name}</span>
            <span className="bj-mi-tip">{option.tip}</span>
          </li>
        ))
      )}
    </ul>
  );
}
