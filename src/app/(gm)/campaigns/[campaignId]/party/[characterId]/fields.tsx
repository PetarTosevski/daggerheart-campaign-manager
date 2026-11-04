"use client";

import { useState, type ReactNode } from "react";

/**
 * A text field saved on blur. Read-only viewers get plain text. It shows the saved value while unfocused, so live
 * edits from others show up without remounting (CL7, dcm-bxp.40 item 7; the PaperText pattern in sections/story.tsx).
 * After a save it keeps the typed text until the live value catches up, and drops it if `onSave` resolves to false.
 */
export function TextField({
  label,
  value,
  onSave,
  readOnly,
  placeholder,
  multiline = false,
  hideLabel = false,
  maxLength,
  rows,
  labelClassName,
}: {
  label: string;
  value: string;
  onSave: (next: string) => unknown;
  readOnly: boolean;
  placeholder?: string;
  multiline?: boolean;
  hideLabel?: boolean;
  maxLength?: number;
  rows?: number;
  labelClassName?: string;
}) {
  const [draft, setDraft] = useState<{ text: string; base: string; editing: boolean } | null>(null);
  const labelEl = <span className={hideLabel ? "sr-only" : (labelClassName ?? "cs-lbl")}>{label}</span>;
  if (readOnly) {
    return (
      <div className="flex flex-col gap-1">
        {labelEl}
        {multiline ? (
          <p className="cs-ta m-0" style={{ resize: "none", minHeight: rows ? rows * 28 + 14 : 72 }}>
            {value || <span className="text-[#8f7a58] italic">—</span>}
          </p>
        ) : (
          <span className="cs-in cs-ro">{value || <span className="text-[#8f7a58] italic">—</span>}</span>
        )}
      </div>
    );
  }
  const shown = draft && (draft.editing || draft.base === value) ? draft.text : value;
  const field = {
    value: shown,
    placeholder,
    maxLength,
    onFocus: () => setDraft((d) => (d && !d.editing && d.base === value ? { ...d, editing: true } : { text: value, base: value, editing: true })),
    onChange: (e: { target: { value: string } }) => {
      const text = e.target.value;
      setDraft((d) => ({ text, base: d?.base ?? value, editing: true }));
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      const text = multiline ? e.currentTarget.value : e.currentTarget.value.trim();
      if (text === value) {
        setDraft(null);
        return;
      }
      setDraft({ text, base: draft?.base ?? value, editing: false });
      void Promise.resolve(onSave(text)).then((ok) => {
        if (ok === false) setDraft(null);
      });
    },
  };
  return (
    <label className="flex flex-col gap-1">
      {labelEl}
      {multiline ? (
        <textarea className="cs-ta" rows={rows} {...field} />
      ) : (
        <input
          className="cs-in"
          {...field}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      )}
    </label>
  );
}

/** "Name: text" for a class, weapon or armor feature. */
export function FeatureText({ name, text }: { name: string; text: string }) {
  return (
    <p className="cs-small m-0 whitespace-pre-line">
      <strong className="font-display text-[14px]">{name}:</strong> {text}
    </p>
  );
}

/** − value + control; read-only shows the value alone. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  readOnly,
  display,
  className = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  readOnly: boolean;
  display?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`} role="group" aria-label={label}>
      {readOnly ? null : (
        <button type="button" className="cs-step" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
      )}
      <strong className="min-w-8 text-center font-display text-[20px]" aria-live="polite">
        {display ?? value}
      </strong>
      {readOnly ? null : (
        <button type="button" className="cs-step" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      )}
    </div>
  );
}
