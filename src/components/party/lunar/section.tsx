"use client";

import "./lunar.css";

import { useMutation } from "convex/react";
import { useRef, useState } from "react";

import { SheetBox, Small } from "@/components/party/sheet-ui";
import { errorMessage } from "@/lib/convex-errors";
import type { FeatureScope } from "@/lib/domain/class-features/types";
import { bumpMoonDie, bumpUsed, currentPhase, holdsLunarPhases, MOON_PHASES, moonDie, type MoonPhase } from "@/lib/domain/session-features";
import type { CharacterSheet } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { SlotProps } from "../slots";
import { MoonArt } from "./moon-art";

// Lunar Phases (Moon Witch mastery, HF p.17; plan session-features U6): the four phases with their moons, the
// current one highlighted, the die and the once-per-rest "Spend a Hope: +1 to the moon die". Rendered only for
// `holdsLunarPhases` (Moon subclass at mastery, Hope & Fear on). Styles: ./lunar.css.

type Sheet = SlotProps["character"]["sheet"];

/** The campaign scope the sheet knows: Lunar Phases answers only with Hope & Fear on. */
export function scopeOf(hopeAndFear: boolean): FeatureScope {
  return { hopeAndFear, ikonis: false };
}

/** F0's pure bump on the view's sheet (optional arrays filled), or null when it would be refused. */
function bumped(sheet: Sheet, scope: FeatureScope): Sheet | null {
  try {
    const full = { ...sheet, featureUses: sheet.featureUses ?? [] } as CharacterSheet;
    return bumpMoonDie(full, scope).sheet as Sheet;
  } catch {
    return null;
  }
}

function range(p: MoonPhase): string {
  return p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
}

/** Why the bump button is off, or null when it can be pressed. */
function bumpBlocked(sheet: Sheet): string | null {
  if (moonDie(sheet) === undefined) return "No moon die to raise yet.";
  if (bumpUsed({ featureUses: sheet.featureUses ?? [] })) return "Used this rest; it refreshes after a rest.";
  if (sheet.hope < 1) return "Needs 1 Hope.";
  return null;
}

/** The Lunar Phases box, or nothing for a sheet without the mastery (or with Hope & Fear off). */
export function LunarPhasesSection({ character, canEdit, hopeAndFear }: SlotProps) {
  const sheet = character.sheet;
  const scope = scopeOf(hopeAndFear);
  const characterId = character._id;
  const bump = useMutation(api.sessionFeatures.bumpMoonDie).withOptimisticUpdate((store, args) => {
    const view = store.getQuery(api.characters.get, { characterId: args.characterId });
    if (!view) return;
    const next = bumped(view.sheet, scope);
    if (next) store.setQuery(api.characters.get, { characterId: args.characterId }, { ...view, sheet: next });
  });
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!holdsLunarPhases(sheet, scope)) return null;
  const die = moonDie(sheet);
  const phase = currentPhase(sheet, scope);
  const blocked = bumpBlocked(sheet);

  async function onBump() {
    key.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      await bump({ characterId, idempotencyKey: key.current });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      key.current = null;
      setBusy(false);
    }
  }

  return (
    <SheetBox title="Lunar Phases" className="ln" data-testid="lunar-phases">
      <ol className="ln-phases" aria-label="Moon phases">
        {MOON_PHASES.map((p) => {
          const on = phase?.key === p.key;
          return (
            <li key={p.key} className="ln-card" data-current={on || undefined} aria-current={on ? "true" : undefined}>
              <MoonArt phase={p.key} glow={on} />
              <span className="ln-name">{p.name}</span>
              <span className="ln-range" aria-label={`Roll ${range(p)}`}>
                {range(p)}
              </span>
              <span className="ln-effect">{p.effect}</span>
            </li>
          );
        })}
      </ol>
      <div className="ln-now">
        <div className="ln-die" aria-label={die === undefined ? "No moon die" : `Moon die ${die}`}>
          <span aria-hidden="true">{die ?? "–"}</span>
        </div>
        <div className="ln-now-text" aria-live="polite">
          {phase ? (
            <>
              <span className="ln-now-name">{phase.name} moon</span>
              <Small>{phase.effect}, until the session ends.</Small>
            </>
          ) : (
            <Small className="italic">No moon die: rolled when the session starts.</Small>
          )}
        </div>
      </div>
      {canEdit ? (
        <div className="ln-bump-row">
          <button type="button" className="ln-bump" disabled={busy || blocked !== null} aria-describedby={`ln-why-${characterId}`} onClick={() => void onBump()}>
            <span aria-hidden="true">☾ </span>Spend a Hope: +1 to the moon die
          </button>
          <Small id={`ln-why-${characterId}`} className="ln-why italic">
            {blocked ?? "Once per rest; a 6 becomes a 1."}
          </Small>
          {error ? (
            <p role="alert" className="ln-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </SheetBox>
  );
}
