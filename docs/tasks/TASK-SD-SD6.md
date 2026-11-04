# TASK SD6: Drawer UI shell - Sheet button, drawer, trackers, feature list, full-sheet link

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD6 (depends on SD3). Bead `dcm-bxp.99.19`. Status: Review.

On the Combat Map the page's Sheet button (SD0) opens a right-side drawer over the live map (full screen at 760 px and
below) with the HP / Stress / Hope / Armor trackers and every owned feature grouped by source with its state, badges and
Use button; closing returns to the same map view. The Use flow itself is SD7's `FeatureUse` (still SD0's stub here).

## User answers implemented

- **Q5** (HF p.12): the "Beastform and stance" section shows Focus `n / 6`, the active stance, Refocus (needs the
  "It is a moment of calm" check, once per rest) and "Shift · 1 Focus" per known stance, plus "Shift · 1 Stress" with
  Flow State (HF p.11) - `combatFeatures.refocus` / `shiftStance`.
- **Q10** (CB p.30, Beastform: "You can drop out of this form at any time."): while the character holds a Beastform's
  features, the section shows the form's name and "Drop out" (`classFeatures.endEffect`, effect `beastform`, optimistic).
  Transforming is the Beastform class feature's Use (SD7).
- **Q11**: a "Transformation" section for the transformation's features.
- **Q15 (a)**: out-of-combat and narrative features sit under "Other features" as text with an "Out of combat" /
  "Narrative" badge; Commune (HF p.16) and Get In & Get Out (HF p.8) keep their existing D5 Use (`classFeatures.use`,
  the server's summary as the result line). **Q15 (b)**: Hardy, Efficient, Celestial Trance and Oasis are listed there
  with "Applied at rest" and no button (SD-R applies them in the rest flow).
- **Q16**: a "Flying" toggle (`aria-pressed`, `combatFeatures.setFlying`, optimistic) when the character holds a flying
  feature.
- **CA6 / U4**: the GM's view of a PC is greyed (every control disabled) until the drawer's "Play for this character"
  switch is on (see QUESTIONS 1).

## What changed

| File | What |
|------|------|
| `src/components/combat-map/drawer/index.tsx` | `SheetDrawer`: a native modal `<dialog>` labelled "Character sheet" (focus trap, Esc, a click on the dimmed map closes, the browser returns focus to the Sheet button). Keys pressed in the drawer stop at the dialog, so the map's window shortcuts (Escape drops the selected token, WASD moves it) don't fire behind it: the first e2e run caught Esc deselecting the token and hiding the GM's Sheet button. The body (and its query) renders only while open; the page keeps the dialog mounted, so the map behind is never remounted. Header with ✕ (44 px), scrolling body in a `DrawerBoundary`, footer "Full sheet" → `sheetHref`. `DrawerBody`: `combatFeatures.drawer`, loading line, the character's name, the GM's switch, greyed wrapper. |
| `src/components/combat-map/drawer/boundary.tsx` | `DrawerBoundary`: the drawer's error boundary (rule 11) with Try again. |
| `src/components/combat-map/drawer/drawer.css` | Drawer, trackers, sections, badges, switch (CA6's look), controls; full screen at ≤ 760 px; 44 px targets. Only `--cm-*` tokens of `combat-map.css`. |
| `src/components/combat-map/drawer/trackers/` | `Trackers`: four groups with pips, − / value / + (44 px), `characters.adjustResource` intents (±1) with an optimistic update on the drawer query (`applyTrackerDelta`: the sheet's limits, Stress past full marks a Hit Point, CB p.106); the D5 counters and held dice as chips; refusals as an alert. |
| `src/components/combat-map/drawer/list/model.ts` | Sections in plan order (`sectionsOf`), kind badges (Use / Reaction / With an attack / Automatic / Passive / Text), cost and limit badges, `usableUses` (automated combat actions and reactions), subclass rank locks (`lockedCards`, no multiclass mastery), rest-time features, `D5_USES`, `activeForm`. |
| `src/components/combat-map/drawer/list/index.tsx` | `FeatureList`: Flying toggle, sections, feature rows (name, badges, state, text, uses with Use / React), lock rows, the Beastform and stance controls, D5 Use, `FeatureUse` for the picked use. |
| `src/components/combat-map/drawer/list/controls.tsx` | `FlyingToggle`, `StanceControls`, `BeastformControl`, `D5Use`. |
| `tests/unit/sheet-drawer.test.tsx` | 24 tests: models, and the drawer with Convex mocked (dialog, loading, boundary, intents and optimistic update, GM greyed until the switch, Flying, Drop out, D5 Use, stances, keys kept from the map's window shortcuts, Esc → onClose). |
| `tests/e2e/sheet-drawer.spec.ts` | GM at 1280: zoom, select Mira, scroll; drawer greyed → Play → Mark 1 Stress (server shows 1); Esc → focus on the Sheet button and the same zoom / scroll / selection; again with ✕. Player at 390: the bottom-bar button, drawer fills the screen, no sideways scroll, Gain 1 Hope, 44 px targets, ✕ → focus back. Axe on both. |
| `tests/e2e/visual/SD-SD6.spec.ts` | Shots at 1280, 1024x768, 768x1024, 390 (player, player scrolled to the end, the class section after Rally, the GM's greyed view). |

## Checks

- `pnpm lint`, `pnpm typecheck`: pass. `pnpm test`: 8418 pass; `schema-guard.test.ts` timed out once under machine
  load (load ~30) and passes alone (SD6 changes no Convex code).
- `tests/e2e/sheet-drawer.spec.ts` (2 tests) and `tests/e2e/visual/SD-SD6.spec.ts`: pass. Shots looked at for every width:
  docked 440 px panel at 1280 / 1024 / 768, full screen at 390 with two tracker columns (one under 360 px); the exhausted
  Rally greyed with "Used · Back next session"; the GM's view greyed with the switch off.
- `pnpm tracer:guard sheet-drawer SD6`: pass.

## QUESTIONS

1. **"Play for this character" is the drawer's own switch.** CA6's switch is local state of the Hand
   (`actions/hand/index.tsx`, not in SD6's `owns`), so the drawer has its own switch with the same name and look. It
   starts off on every open. Should the two be one shared switch (a follow-up in `actions/`)?
2. **Drop out of Beastform ends only the `beastform` effect.** Evolution's "+1 trait until you drop out of it" is a
   separate D5 effect (`evolution`) that stays until its own End on the Party sheet. Should Drop out end both?
   Drop out shows only when a form was chosen (a "Reminder only" Beastform has no form features to detect).
3. **D5 Uses under Other features**: only Commune and Get In & Get Out have one today (both without inputs). The drawer
   does not show Commune's once-per-long-rest state (the drawer read model marks out-of-combat features `outOfCombat`,
   not exhausted); a second use is refused by the server with its message.
4. **Armor maximum**: the drawer's `armor.max` (SD3's `drawerOf`) ignores installed augments, which
   `characters.adjustResource` counts; with an armor augment the drawer's + may stop one slot early. A fix belongs in
   `convex/lib/featureDrawer.ts` (SD3).
5. **Title**: the dialog is labelled "Character sheet" with the character's name under it (no board for the drawer).

## Follow-ups (for beads)

- SD7 fills `FeatureUse`; the drawer already mounts it with `featureId` / `useId` and closes it via `onClose`.
- QUESTIONS 1, 2 and 4 if the user wants them changed.
