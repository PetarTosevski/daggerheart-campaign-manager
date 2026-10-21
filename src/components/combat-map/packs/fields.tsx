"use client";

import { useId, useRef, useState } from "react";

import type { CombatObjectKind, CombatTerrain, SightMode } from "../../../../convex/lib/validators/combatMaps";
import type { SpriteCategory, SpriteFootprint, SpriteHeight, SpriteLight } from "../../../../convex/lib/validators/spritePacks";
import { CLASSIC_LOOKS } from "./labels";

/** The label controls shared by the labelling grid (new cuts) and the sprite list (saved sprites). */

const SIZES = [1, 2, 3, 4] as const;
const CATEGORY: readonly [SpriteCategory, string][] = [
  ["object", "Object"],
  ["texture", "Terrain texture"],
];
const SIGHT: readonly [SightMode, string][] = [
  ["block", "Blocks sight"],
  ["cover", "Cover"],
  ["none", "None"],
];
const LIGHT: readonly [SpriteLight, string][] = [
  ["none", "None"],
  ["faintglow", "Faint glow"],
  ["torch", "Torch"],
  ["campfire", "Campfire"],
];
const HEIGHT: readonly [SpriteHeight, string][] = [
  ["flat", "Flat"],
  ["low", "Low"],
  ["tall", "Tall"],
];
const FOOTPRINT: readonly [SpriteFootprint, string][] = [
  ["circle", "Round"],
  ["rect", "Rectangle"],
];
const TERRAINS: readonly CombatTerrain[] = ["grass", "dirt", "path", "sand", "water", "deep", "swamp", "stone", "cave", "wall", "wood", "snow", "lava", "void"];

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CLASSIC_LABEL: Partial<Record<CombatObjectKind, string>> = { deadtree: "Dead tree", walltorch: "Wall torch" };

/** One labelled select. */
function Pick<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <span className="cm-pk-field">
      <label htmlFor={id} className="cm-pk-flabel">
        {label}
      </label>
      <select
        id={id}
        className="cm-in cm-pk-select"
        value={String(value)}
        onChange={(e) => {
          const picked = options.find(([v]) => String(v) === e.target.value);
          if (picked) onChange(picked[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </span>
  );
}

export type FieldValues = {
  category: SpriteCategory;
  w: number;
  h: number;
  sight: SightMode;
  light: SpriteLight;
  height: SpriteHeight;
  classicKind: CombatObjectKind;
  terrain?: CombatTerrain;
  footprint?: SpriteFootprint;
  rotatable?: boolean;
};

/** One changed field (the sprite list saves each as its own intent). */
export type FieldChange =
  | { category: SpriteCategory }
  | { w: number }
  | { h: number }
  | { sight: SightMode }
  | { light: SpriteLight }
  | { height: SpriteHeight }
  | { classicKind: CombatObjectKind }
  | { terrain: CombatTerrain }
  | { footprint: SpriteFootprint }
  | { rotatable: boolean };

/** Object / texture, size, sight, light, shadow, Classic look (+ terrain class for textures; footprint and rotation when given). */
export function SpriteFields({ values, onChange }: { values: FieldValues; onChange: (change: FieldChange) => void }) {
  const rotateId = useId();
  const sizes = SIZES.map((n) => [n, String(n)] as const);
  return (
    <div className="cm-pk-fields">
      <Pick label="Kind" value={values.category} options={CATEGORY} onChange={(category) => onChange({ category })} />
      <span className="cm-pk-size">
        <Pick label="Width (squares)" value={values.w} options={sizes} onChange={(w) => onChange({ w })} />
        <Pick label="Height (squares)" value={values.h} options={sizes} onChange={(h) => onChange({ h })} />
      </span>
      <Pick label="Sight" value={values.sight} options={SIGHT} onChange={(sight) => onChange({ sight })} />
      <Pick label="Gives light" value={values.light} options={LIGHT} onChange={(light) => onChange({ light })} />
      <Pick label="Shadow" value={values.height} options={HEIGHT} onChange={(height) => onChange({ height })} />
      <Pick
        label="Classic look"
        value={values.classicKind}
        options={CLASSIC_LOOKS.map((k) => [k, CLASSIC_LABEL[k] ?? title(k)] as const)}
        onChange={(classicKind) => onChange({ classicKind })}
      />
      {values.footprint !== undefined ? (
        <Pick label="Footprint" value={values.footprint} options={FOOTPRINT} onChange={(footprint) => onChange({ footprint })} />
      ) : null}
      {values.category === "texture" ? (
        <Pick
          label="Terrain"
          value={values.terrain ?? "grass"}
          options={TERRAINS.map((t) => [t, title(t)] as const)}
          onChange={(terrain) => onChange({ terrain })}
        />
      ) : null}
      {values.category === "texture" && values.rotatable !== undefined ? (
        <span className="cm-pk-field cm-pk-check">
          <input id={rotateId} type="checkbox" checked={values.rotatable} onChange={(e) => onChange({ rotatable: e.target.checked })} />
          <label htmlFor={rotateId}>Rotate tiles</label>
        </span>
      ) : null}
    </div>
  );
}

/**
 * A text field that saves on blur or Enter (CL7: local text only while focused, so live updates never wipe
 * typing). Escape restores the saved value.
 */
export function BlurText({
  label,
  value,
  maxLength,
  onCommit,
  className = "",
}: {
  label: string;
  value: string;
  maxLength: number;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  function commit() {
    if (draft === null || cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) onCommit(next);
  }
  return (
    <span className={`cm-pk-field ${className}`}>
      <label htmlFor={id} className="cm-pk-flabel">
        {label}
      </label>
      <input
        id={id}
        className="cm-in"
        value={draft ?? value}
        maxLength={maxLength}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}
