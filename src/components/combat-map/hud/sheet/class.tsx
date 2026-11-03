"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { BEASTFORMS } from "@/lib/srd/beastforms";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { BeastformControl, FlyingToggle, StanceControls } from "../../drawer/list/controls";
import { activeForm, titleCase, type Drawer } from "../../drawer/list/model";
import type { HudSheetData } from "./model";

/**
 * A PC's class controls in the HUD sheet panel (plan combat-hud H9.5, user answer Q5 a, bead dcm-bxp.99.32.43). They
 * were `SheetExtras` in the Map tools drawer after the cut-over (H8.1); each now sits where it belongs on the sheet:
 * - the class counters and held dice under the trackers (`SheetCounters`);
 * - the Beastform's "Drop out" (Q10) and the Martial Artist's Focus / Refocus / stances (Q5) above the features
 *   (`SheetForm`);
 * - the Flying toggle (Q16) with the conditions and lasting effects (`SheetFlying`);
 * - DA7's "Active" on a feature whose effect still holds (`FeatureHeld`, read by the feature row).
 *
 * The controls and their intents are the classic drawer's (`drawer/list/controls.tsx`: `combatFeatures.setFlying`,
 * `classFeatures.endEffect`, `combatFeatures.shiftStance` / `refocus`), on `combatFeatures.drawer`, which only the
 * character's player and the GM may read (U1): own and gm modes. Own: they act. GM: greyed until "Play for this
 * character" (DA6). View mode never reads the drawer; it shows the form and Flying read only from `combatHud.sheet`
 * (`SheetClassView`). Each part is mounted in its own `PartBoundary` by the panel.
 */

export type ClassHere = { campaignId: Id<"campaigns">; characterId: Id<"characters">; canAct: boolean };

function useDrawer({ campaignId, characterId }: ClassHere): Drawer | undefined {
  return useQuery(api.combatFeatures.drawer, { campaignId, characterId });
}

/** What the sheet shows of the drawer (pure): counters and held dice as chip texts, Flying, the form, the stances. */
export function classControlsOf(drawer: Pick<Drawer, "counters" | "heldDice" | "canFly" | "features" | "martial">) {
  // A drawer without counters (an older reply, a test stub) reads as none.
  const chips = [
    ...(drawer.counters ?? []).map((c) => ({ key: `c:${c.key}`, text: `${c.label}: ${c.value}` })),
    ...(drawer.heldDice ?? []).map((d) => ({ key: `d:${d.id}`, text: `d${d.sides} ${d.kind}${d.value !== null ? `: ${d.value}` : ""}` })),
  ];
  return { chips, canFly: drawer.canFly === true, form: activeForm(drawer.features), martial: drawer.martial ?? null };
}

/** The greyed wrapper of the GM's controls (DA6: until "Play for this character" is on). */
function Grey({ canAct, children, testId }: { canAct: boolean; children: ReactNode; testId: string }) {
  return (
    <div className="hsh-class sd-grey" data-greyed={canAct ? "false" : "true"} data-testid={testId}>
      {children}
    </div>
  );
}

/** Class counters (Unstoppable, Favor, Hexes, ...) and held dice (Prayer Dice, Rally die), under the trackers. */
export function SheetCounters(here: ClassHere) {
  const drawer = useDrawer(here);
  if (drawer === undefined) return null;
  const { chips } = classControlsOf(drawer);
  if (chips.length === 0) return null;
  return (
    <Grey canAct={here.canAct} testId="hud-sheet-counters">
      <ul className="sd-chips hsh-chips" aria-label="Class counters">
        {chips.map((c) => (
          <li key={c.key} className="sd-chip">
            {c.text}
          </li>
        ))}
      </ul>
    </Grey>
  );
}

/** The Beastform the character is in (Drop out, Q10) and the Martial Artist's stances (Q5), above the features. */
export function SheetForm(here: ClassHere) {
  const drawer = useDrawer(here);
  if (drawer === undefined) return null;
  const { form, martial } = classControlsOf(drawer);
  if (!form && !martial) return null;
  return (
    <section aria-labelledby="hsh-sec-form" data-testid="hud-sheet-form">
      <h3 id="hsh-sec-form" className="hsh-sec">
        Beastform and stance
      </h3>
      <Grey canAct={here.canAct} testId="hud-sheet-form-controls">
        {form ? <BeastformControl {...here} form={form} /> : null}
        {martial ? <StanceControls {...here} martial={martial} features={drawer.features} /> : null}
      </Grey>
    </section>
  );
}

/** The Flying toggle (Q16) for a character holding a flying feature, with the conditions and lasting effects. */
export function SheetFlying(here: ClassHere) {
  const drawer = useDrawer(here);
  if (drawer === undefined || !classControlsOf(drawer).canFly) return null;
  return (
    <Grey canAct={here.canAct} testId="hud-sheet-flying">
      <FlyingToggle {...here} flying={drawer.flying} />
    </Grey>
  );
}

/**
 * DA7: whether a spent-looking feature is in fact holding its effect (Rogue's Dodge's +2): `combatHud.sheet` folds
 * `active` into `used`; the drawer tells them apart. Hands the row `{ resetLabel }` while it holds, else null (also while
 * the drawer loads: the row keeps "Used").
 */
export function FeatureHeld({ here, featureId, children }: { here: ClassHere; featureId: string; children: (held: { resetLabel: string | null } | null) => ReactNode }) {
  const drawer = useDrawer(here);
  const f = drawer?.features.find((x) => x.featureId === featureId);
  return children(f?.state === "active" ? { resetLabel: f.resetLabel } : null);
}

/** The Beastform's name from a `beastform:<form>:<feature>` feature id ("agile-scout" → "Agile Scout"). */
function formNameOf(featureId: string): string {
  const id = featureId.split(":")[1] ?? featureId;
  return BEASTFORMS.find((b) => b.id === id)?.name ?? titleCase(id);
}

/**
 * View mode (another player's PC): the form and Flying, read only, from `combatHud.sheet` (the drawer is refused to
 * other players while hands are hidden, U1). Counters and Focus are not on that read; the stance features are listed
 * under Features.
 */
export function SheetClassView({ sheet }: { sheet: HudSheetData }) {
  const form = sheet.features.find((f) => f.source === "beastform");
  const flying = sheet.effects.some((e) => e.id === "flying");
  if (!form && !flying) return null;
  return (
    <ul className="sd-chips hsh-chips" aria-label="Class state" data-testid="hud-sheet-class-view">
      {form ? <li className="sd-chip">Beastform: {formNameOf(form.featureId)}</li> : null}
      {flying ? <li className="sd-chip">Flying</li> : null}
    </ul>
  );
}
