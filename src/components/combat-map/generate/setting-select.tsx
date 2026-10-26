"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SettingRef } from "../../../../convex/lib/validators/combatMaps";

/** The select's value for "Let Claude choose". */
const CLAUDE = "";

/** A setting as the select's value: `b:<id>` for a built-in setting, `p:<pack id>` for a GM pack. */
export function settingValue(setting: SettingRef | undefined | null): string {
  if (!setting) return CLAUDE;
  return "builtin" in setting ? `b:${setting.builtin}` : `p:${setting.pack}`;
}

type Options = {
  builtin: { id: string; label: string }[];
  packs: { _id: Id<"spritePacks">; name: string; extends: { id: string; label: string } | null }[];
};

/** The option list's value back to a setting (null = Let Claude choose). */
function parseValue(value: string, options: Options | undefined): SettingRef | null {
  if (value.startsWith("b:")) return { builtin: value.slice(2) };
  if (value.startsWith("p:")) {
    const pack = options?.packs.find((p) => p._id === value.slice(2));
    return pack ? { pack: pack._id } : null;
  }
  return null;
}

/** The label of a stored setting, from the picker's options. */
function labelOf(setting: SettingRef, options: Options | undefined): string | null {
  if ("builtin" in setting) return options?.builtin.find((s) => s.id === setting.builtin)?.label ?? null;
  return options?.packs.find((p) => p._id === setting.pack)?.name ?? null;
}

type Props = {
  campaignId: Id<"campaigns">;
  /** The map on screen, or null before the first map exists. */
  mapId: Id<"combatMaps"> | null;
  /** The map's stored setting and whether the GM picked it (combatMaps.get, GM view). */
  setting: SettingRef | undefined;
  settingPicked: boolean;
  /** Whether a generation has drawn this map (only then "chose: …" is shown). */
  generated: boolean;
  /** Before a map exists: the GM's pick, kept by the Scene card and passed to the first generation. */
  pending: SettingRef | null;
  onPending: (setting: SettingRef | null) => void;
  disabled: boolean;
};

/**
 * Sprite packs P7: the Scene card's Setting picker. "Let Claude choose" first, then the built-in settings by label,
 * then the campaign's packs (own settings, and packs that add to a built-in one). On a map, a change saves at once
 * with `combatMapStyle.setSetting` (optimistic, D7); before the first map it is kept for the first generation. After
 * a generation that Claude or the keywords chose, the first option reads "Let Claude choose (chose: Forest)".
 */
export function SettingSelect({ campaignId, mapId, setting, settingPicked, generated, pending, onPending, disabled }: Props) {
  const options = useQuery(api.combatMapStyle.settings, { campaignId });
  const [error, setError] = useState<string | null>(null);
  const setSetting = useMutation(api.combatMapStyle.setSetting).withOptimisticUpdate((store, args) => {
    const query = { campaignId, mapId: args.mapId };
    const map = store.getQuery(api.combatMaps.get, query);
    if (!map) return;
    store.setQuery(api.combatMaps.get, query, {
      ...map,
      ...(args.setting === null ? {} : { setting: args.setting }),
      settingPicked: args.setting !== null,
    });
  });

  const value = mapId === null ? settingValue(pending) : settingPicked ? settingValue(setting) : CLAUDE;
  const chose = mapId !== null && !settingPicked && generated && setting ? labelOf(setting, options) : null;
  const builtin = [...(options?.builtin ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  // A stored setting the list does not offer (yet) stays selectable, so the select never shows the wrong one.
  const missing = value !== CLAUDE && options !== undefined && parseValue(value, options) === null ? value : null;

  function onChange(next: string) {
    const picked = parseValue(next, options);
    setError(null);
    if (mapId === null) {
      onPending(picked);
      return;
    }
    setSetting({ campaignId, mapId, setting: picked }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <label className="cm-scene-field">
      <span className="cm-lbl">Setting</span>
      <select className="cm-in cm-scene-setting" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value={CLAUDE}>{chose ? `Let Claude choose (chose: ${chose})` : "Let Claude choose"}</option>
        {missing ? <option value={missing}>{setting ? (labelOf(setting, options) ?? "Unknown setting") : "Unknown setting"}</option> : null}
        <optgroup label="Settings">
          {builtin.map((s) => (
            <option key={s.id} value={`b:${s.id}`}>
              {s.label}
            </option>
          ))}
        </optgroup>
        {options && options.packs.length > 0 ? (
          <optgroup label="Your packs">
            {options.packs.map((p) => (
              <option key={p._id} value={`p:${p._id}`}>
                {p.extends ? `${p.name} (adds to ${p.extends.label})` : p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {error ? (
        <span role="alert" className="cm-scene-err">
          {error}
        </span>
      ) : null}
    </label>
  );
}
