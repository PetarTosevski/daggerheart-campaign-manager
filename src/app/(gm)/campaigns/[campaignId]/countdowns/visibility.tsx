"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import {
  COUNTDOWN_HIDEABLE_FIELDS,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownVisibilityPreset,
  DEFAULT_HIDDEN_COUNTDOWN_FIELDS,
  type CountdownHideableField,
  type CountdownVisibility,
  type CountdownVisibilityPreset,
} from "@/lib/domain/countdowns";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../../convex/countdowns";

import { BTN } from "./shared";

export const VISIBILITY_OPTIONS: { preset: CountdownVisibilityPreset; label: string; badge: string; hint: string }[] = [
  { preset: "private", label: "Private", badge: "Private", hint: "Only you see it." },
  { preset: "partly", label: "Public, details hidden", badge: "Partly hidden", hint: "Players see it without the fields you tick." },
  { preset: "public", label: "Public", badge: "Public", hint: "Players see everything." },
];
const FIELD_LABEL: Record<CountdownHideableField, string> = {
  name: "Name",
  description: "Description",
  category: "Category",
  consequence: "Consequence",
  progress: "Progress",
};

/** The picker keeps the ticked fields while another preset is chosen, so switching back loses nothing. */
export type VisibilityChoice = { preset: CountdownVisibilityPreset; hidden: CountdownHideableField[] };
export const choiceOf = (visibility: CountdownVisibility): VisibilityChoice => ({
  preset: countdownVisibilityPreset(visibility),
  hidden: visibility.mode === "public" && visibility.hidden.length > 0 ? visibility.hidden : DEFAULT_HIDDEN_COUNTDOWN_FIELDS,
});export const visibilityOf = (choice: VisibilityChoice): CountdownVisibility =>
  choice.preset === "partly" ? { mode: "public", hidden: choice.hidden } : COUNTDOWN_VISIBILITY_PRESETS[choice.preset];

/** "Who can see this": Private / Public, details hidden (a checkbox per field) / Public. */
export function VisibilityPicker({ value, onChange }: { value: VisibilityChoice; onChange: (next: VisibilityChoice) => void }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Who can see this</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {VISIBILITY_OPTIONS.map(({ preset, label, hint }) => {
          const Icon = preset === "private" ? EyeOff : Eye;
          return (
            <label
              key={preset}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-[10px] border px-3 py-2 text-[14px] text-[#e6ecea]",
                value.preset === preset ? "border-brand bg-[#1d2a2e]" : "border-[#33444a] bg-[#141e22] hover:border-brand",
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  name={name}
                  value={preset}
                  aria-label={label}
                  checked={value.preset === preset}
                  onChange={() => onChange({ ...value, preset })}
                  className="size-4 flex-none accent-[var(--brand)]"
                />
                <Icon className="size-4 flex-none" aria-hidden="true" />
                {label}
              </span>
              <span className="text-[12px] text-[#8fa3a8]">{hint}</span>
            </label>
          );
        })}
      </div>
      {value.preset === "partly" ? (
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-2 rounded-[10px] border border-dashed border-[#33444a] px-3 py-2">
          <legend className="px-1 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Hide from players</legend>
          {COUNTDOWN_HIDEABLE_FIELDS.map((field) => (
            <label key={field} className="flex min-h-8 cursor-pointer items-center gap-2 text-[14px] text-[#e6ecea]">
              <input
                type="checkbox"
                checked={value.hidden.includes(field)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    hidden: event.target.checked ? [...value.hidden, field] : value.hidden.filter((f) => f !== field),
                  })
                }
                className="size-4 accent-[var(--brand)]"
              />
              {FIELD_LABEL[field]}
            </label>
          ))}
        </fieldset>
      ) : null}
    </fieldset>
  );
}

/** A "Hidden" placeholder for a field the GM keeps from players. */
export function Hidden({ field }: { field: CountdownHideableField }) {
  return (
    <span className="cd-hidden" data-testid={`hidden-${field}`}>
      <span className="sr-only">{FIELD_LABEL[field]} </span>Hidden
    </span>
  );
}

/** Changes a countdown's visibility. Mounted only while its dialog is open, so it starts from the stored value. */
export function VisibilityForm({ countdown, campaignId, onDone }: { countdown: CountdownView; campaignId: Id<"campaigns">; onDone: () => void }) {
  const setVisibility = useIntent(api.countdowns.setVisibility);
  const [choice, setChoice] = useState(() => choiceOf(countdown.visibility));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (setVisibility.pending) return;
        const saved = await setVisibility.fire({ campaignId, countdownId: countdown._id, visibility: visibilityOf(choice) });
        if (saved) onDone();
      }}
    >
      <p className="m-0 text-[15px] font-semibold text-[#e6ecea]">{countdown.name}</p>
      <VisibilityPicker value={choice} onChange={setChoice} />
      {setVisibility.error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {setVisibility.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2.5">
        <button type="button" className={BTN} onClick={onDone}>
          Cancel
        </button>
        <BrandButton type="submit" variant="solid" disabled={setVisibility.pending}>
          Save
        </BrandButton>
      </div>
    </form>
  );
}
