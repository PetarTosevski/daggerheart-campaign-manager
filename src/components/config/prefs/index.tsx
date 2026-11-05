"use client";

import "./prefs.css";

import { useState, type ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { DICE_VOLUME_MAX, DICE_VOLUME_MIN, TEXT_SIZES, clampVolume, type TextSize } from "@/lib/config/preferences";
import { errorMessage } from "@/lib/convex-errors";

import type { PreferencesSlotProps } from "../slots";
import { HouseRulesItem } from "./house-rules";
import { useSetPreference, usePreferences, type PreferenceChange } from "./use-preferences";

/** The board's text for the Preferences rows (reference/designs/config/Settings.dc.html, `.pm-pop`). */
export const PREFS_TEXT = {
  dice3d: { label: "3D dice", hint: "Rolls tumble across the screen." },
  diceSound: { label: "Dice sound" },
  volume: { label: "Volume", aria: "Dice volume" },
  reduceMotion: { label: "Reduce motion", hint: "Calmer sheet and card animations." },
  textSize: { label: "Text size" },
  spotlightPing: { label: "Ping me when I get the spotlight" },
} as const;

const TEXT_SIZE_LABEL: Record<TextSize, string> = { small: "Small", medium: "Medium", large: "Large" };

/**
 * The Preferences popover's rows (plan config U6a, design `.pm-pop .row`), for everyone. Each control saves one field
 * of the account's preferences (`preferences.set`) with an optimistic update (rule 12); the volume slider saves on
 * release (pointer up, key up, blur), not on every move. The dice read the same query (`useDiceSettings`), so they
 * follow at once. What reduce motion, text size and the spotlight ping do is U6b's and U6d's; these rows only save them.
 * Players also get 'House rules' (./house-rules.tsx, plan rule-switches RU): the campaign's rule switches, read-only.
 */
export function PreferenceRows(props: PreferencesSlotProps): ReactNode {
  const prefs = usePreferences();
  const set = useSetPreference();
  const [error, setError] = useState<string | null>(null);
  // The slider's value while the user drags it; null when it shows the saved value.
  const [dragVolume, setDragVolume] = useState<number | null>(null);

  if (prefs === undefined) {
    return (
      <p role="status" className="cfg-muted">
        Loading …
      </p>
    );
  }

  const change = (c: PreferenceChange) => {
    setError(null);
    set(c).catch((e: unknown) => setError(errorMessage(e)));
  };
  const commitVolume = () => {
    if (dragVolume === null) return;
    setDragVolume(null);
    if (dragVolume !== prefs.diceVolume) change({ key: "diceVolume", value: clampVolume(dragVolume) });
  };

  return (
    <div data-testid="preference-rows">
      <div className="cfg-row">
        <RowText {...PREFS_TEXT.dice3d} />
        <Switch label={PREFS_TEXT.dice3d.label} checked={prefs.dice3d} onChange={(value) => change({ key: "dice3d", value })} />
      </div>
      <div className="cfg-row">
        <RowText {...PREFS_TEXT.diceSound} />
        <Switch label={PREFS_TEXT.diceSound.label} checked={prefs.diceSound} onChange={(value) => change({ key: "diceSound", value })} />
      </div>
      <div className="cfg-row">
        <RowText label={PREFS_TEXT.volume.label} />
        <input
          type="range"
          className="cfg-rng"
          min={DICE_VOLUME_MIN}
          max={DICE_VOLUME_MAX}
          step={1}
          aria-label={PREFS_TEXT.volume.aria}
          value={dragVolume ?? prefs.diceVolume}
          onChange={(e) => setDragVolume(Number(e.target.value))}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
        />
      </div>
      <div className="cfg-row">
        <RowText {...PREFS_TEXT.reduceMotion} />
        <Switch label={PREFS_TEXT.reduceMotion.label} checked={prefs.reduceMotion} onChange={(value) => change({ key: "reduceMotion", value })} />
      </div>
      <div className="cfg-row cfg-col">
        <RowText {...PREFS_TEXT.textSize} />
        <div className="cfg-seg" role="group" aria-label={PREFS_TEXT.textSize.label}>
          {TEXT_SIZES.map((value) => (
            <button
              key={value}
              type="button"
              className={glassButtonClass({ role: "neutral" })}
              aria-pressed={prefs.textSize === value}
              onClick={() => {
                if (prefs.textSize !== value) change({ key: "textSize", value });
              }}
            >
              {TEXT_SIZE_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="cfg-row">
        <RowText {...PREFS_TEXT.spotlightPing} />
        <Switch label={PREFS_TEXT.spotlightPing.label} checked={prefs.spotlightPing} onChange={(value) => change({ key: "spotlightPing", value })} />
      </div>
      <HouseRulesItem {...props} />
      <p aria-live="polite" className="cfg-muted cfg-prefs-err">
        {error}
      </p>
    </div>
  );
}

function RowText({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="cfg-row-t">
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

/** The design's `.sw`: a button with role switch (the shared `cfg-sw` class). */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="cfg-sw" onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}
