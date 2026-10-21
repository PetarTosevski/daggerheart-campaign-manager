"use client";

import type { EntryTextProps, MentionInputProps } from "../slots";

/**
 * An entry's text (Q6, D7). N0 stub: the raw text; N5 renders mention tokens as links (visible entries) or plain stored
 * names.
 */
export function EntryText({ text }: EntryTextProps) {
  return <>{text}</>;
}

/** The add / edit input with the @ picker (Q6). N0 stub: a plain input submitting on Enter; N5 adds the picker. */
export function MentionInput({ label, placeholder, className, defaultValue, onSubmit, onCancel }: MentionInputProps) {
  return (
    <input
      className={className ?? "bj-add"}
      type="text"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={defaultValue}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel?.();
        if (event.key !== "Enter") return;
        event.preventDefault();
        const text = event.currentTarget.value.trim();
        if (!text) return;
        onSubmit(text);
        event.currentTarget.value = "";
      }}
    />
  );
}
