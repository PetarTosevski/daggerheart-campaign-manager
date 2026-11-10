import type { CharacterView } from "../../../convex/characters";
import type { FeatureInput, FeatureMeta } from "../domain/class-features/types";
import { bumpUsed, moonDie } from "../domain/session-features/index";

/**
 * Pure helpers of the sheet's class features panel and its Lunar Phases box. Framework-free (no React, no "@/"),
 * shared by the website (components/party/features/panel.tsx, components/party/lunar/section.tsx) and the phone app.
 */

/** A feature's cost in words ("1 Hope, once per long rest"), or null when it costs nothing. */
export function costLabel(feature: FeatureMeta): string | null {
  const c = feature.cost;
  if (!c) return null;
  const parts = [c.hope ? `${c.hope} Hope` : null, c.stress ? `${c.stress} Stress` : null, c.use ? `once per ${c.use.until === "longRest" ? "long rest" : c.use.until}` : null];
  return parts.filter(Boolean).join(", ") || null;
}

/** Whether an input still needs a value before the feature can be used. */
export function inputMissing(input: FeatureInput, values: { choice: string; amount: string; dieIndexes: number[]; target: string }): boolean {
  switch (input.kind) {
    case "select":
      return input.required && values.choice === "";
    case "number": {
      const n = Number(values.amount);
      return values.amount === "" || !Number.isInteger(n) || n < input.min || n > input.max;
    }
    case "rollDice":
      return values.dieIndexes.length === 0;
    case "ally":
      return input.required && values.target === "";
    case "text":
    case "heldDice":
      return false;
  }
}

/** Why the Lunar Phases bump button is off, or null when it can be pressed. */
export function bumpBlocked(sheet: CharacterView["sheet"]): string | null {
  if (moonDie(sheet) === undefined) return "No moon die to raise yet.";
  if (bumpUsed({ featureUses: sheet.featureUses ?? [] })) return "Used this rest; it refreshes after a rest.";
  if (sheet.hope < 1) return "Needs 1 Hope.";
  return null;
}
