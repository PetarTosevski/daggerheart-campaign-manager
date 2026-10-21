"use client";

import "./mentions.css";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Fragment, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { flushSync } from "react-dom";

import { activeMentionQuery, countMentions, insertMention, MAX_MENTIONS, parseTokens, renderParts, type TextPart } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { EntryTextProps, MentionInputProps } from "../slots";
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
 * The add / edit input with the @ picker (D11 N5; Q6, D7). Typing '@' (at the start or after a space) opens a
 * listbox of the Characters & Locations entries the writer can see, filtered by what follows the '@'. Arrow keys move,
 * Enter or a click inserts the N1 token '@[name](id)' with a space after it, Escape closes the list (a second Escape
 * cancels an edit). Existing tokens stay as written. At most MAX_MENTIONS tokens per entry: then the list only says so.
 * Enter without an open choice submits the trimmed text, as before.
 *
 * ARIA: the ARIA 1.1 combobox pattern (a `combobox` wrapper owning the listbox, the input a `textbox` with
 * `aria-autocomplete`, `aria-controls` and `aria-activedescendant`), so the input keeps its textbox role and name
 * ('New entry' / 'Edit entry') for the entries slot and its tests.
 */
export function MentionInput({ campaignId, label, placeholder, className, defaultValue, onSubmit, onCancel }: MentionInputProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  /** The caret while the input has focus; null otherwise (the list shows only while focused). */
  const [caret, setCaret] = useState<number | null>(null);
  /** The '@' index whose list Escape closed. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<PickerHandle>(null);
  const listId = useId();

  const mention = caret === null ? null : activeMentionQuery(value, caret);
  const open = mention !== null && mention.start !== dismissed && !/^\s/.test(mention.query);
  const full = countMentions(value) >= MAX_MENTIONS;
  const optionId = (index: number) => `${listId}-${index}`;

  function choose(option: PickerOption) {
    if (mention === null || caret === null) return;
    const next = insertMention(value, mention.start, caret, { id: option.id, name: option.name });
    flushSync(() => {
      setValue(next.text);
      setCaret(next.caret);
      setActive(0);
    });
    input.current?.setSelectionRange(next.caret, next.caret);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
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
        setDismissed(mention.start);
        return;
      }
    }
    if (event.key === "Escape") onCancel?.();
    if (event.key !== "Enter") return;
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
    setDismissed(null);
  }

  return (
    <span className="bj-mi" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-owns={open ? listId : undefined}>
      <input
        ref={input}
        className={className ?? "bj-add"}
        type="text"
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          const at = event.currentTarget.selectionStart ?? next.length;
          setValue(next);
          setCaret(at);
          setActive(0);
          if (activeMentionQuery(next, at) === null) setDismissed(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onFocus={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setCaret(null)}
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
