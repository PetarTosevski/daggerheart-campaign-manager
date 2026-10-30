# TASK DA9: Beastform integration

Plan `.omc/plans/drawer-answers.yaml`, tracer DA9 (depends on DA0, DA7). Beads `dcm-bxp.99.19.19` (B1),
`dcm-bxp.99.19.6` (2) (3) (4) (5) and `dcm-bxp.99.19.20` (B2). Status: Review. Book pages are printed pages (CB = Core
Book).

## User answers implemented

- **B1** (user 2026-10-29, dcm-bxp.99.19.19). CB p.30 Beastform: "you gain the Beastform's features, add their Evasion
  bonus to your Evasion, and use the trait specified in their statistics for your attack." The drawer's feature table
  owns the form's trait and Evasion:
  - D5's `beastform` (`classes/druid.ts`) no longer puts `mods` on its effect. The Party sheet's Beastform button still
    transforms (the effect, the Stress) and End still drops out.
  - `owned()` holds the form's attack and statistics line `beastform:<form>:attack` (usage `combat`; SD2 follow-up 2).
  - `passiveMods` sums its passive `form` use: Evasion, trait (new `traits` total), the `noWeaponsOrSpells` flag and
    advantage on attacks for an "attack" verb. The `advantage` rider stays the drawer's (it is not a roll option).
  - `derivedDefense` gets the Evasion through `passiveMods`. The new `derivedTraits` / `withPassiveTraits`
    (`derived.ts`) give the traits.
  - Older sheets: when the `beastform` effect still carries mods, `withEffects` adds those and the stat line skips its
    trait and Evasion (`legacyBeastformMods`), so nothing is counted twice.
- **B2** (user 2026-10-29, dcm-bxp.99.19.20). Aquatic Predator's Vicious Maul (CB p.34: "make them Vulnerable") is
  temporary, like Great Predator's ("temporarily Vulnerable").
- **Drop out ends Evolution**: DA7's `endEffect` already does this. DA9 keeps `beastformEndsOn` as the one source of the
  form's end events. Ending the form on those events is DA10's job.

## dcm-bxp.99.19.6 items

- **(2)** One source for the form's statistics: B1 above.
- **(3) Evolved forms.** CB p.34 Legendary Beast: "Pick a Tier 1 Beastform option and become a larger, more powerful
  version of that creature. While you're in this form, you retain all traits and features from the original form and
  gain the following bonuses: • A +6 bonus to damage rolls • A +1 bonus to the trait used by this form • A +2 bonus to
  Evasion". CB p.35 Mythic Beast: Tier 1 or 2, +9, +2, +3, and the die one size up.
  - D5's choice names the base form: `legendary-beast/agile-scout`. The Party sheet's select lists each Evolved form once
    per base form.
  - The effect text reads "Legendary Beast (Agile Scout): …", and `activeBeastform` reads it back.
  - `owned()` holds three things:
    - the Evolved attack line and the `Evolved` entry, restricted to the use keyed by the base (`OwnedFeature.uses`);
    - the base form's statistics line, restricted to `form` and `advantage` (its own attack is replaced);
    - the base form's features.
  - D5 refuses an Evolved form without a valid base.
- **(4) Hybrid forms.** CB p.34 Legendary Hybrid: "To transform into this creature, mark an additional Stress. Choose any
  two Beastform options from Tiers 1–2. Choose a total of four advantages and two features from those options." CB p.35
  Mythic Hybrid: "mark 2 additional Stress", three options from Tiers 1–3, three features.
  - D5's choice carries the picks: `legendary-hybrid/agile-scout:agile+armored-sentry:cannonball`. The effect text
    reads "Legendary Hybrid (Agile Scout: Agile + Armored Sentry: Cannonball): …".
  - `owned()` holds the Hybrid's own statistics line, its marker and the chosen features.
  - D5 refuses the wrong count, a source form above the tier, an Evolved or Hybrid source, a repeat, or too many source
    forms.
  - D5 marks `HYBRID_EXTRA_STRESS` through `applyResourceDelta`, so a full Stress track marks a Hit Point. This holds on
    the Party sheet and through the drawer's Beastform and Evolution delegates.
  - A Hybrid without picks (the Party sheet's select) holds its statistics and marker only.
- **(5) The form attack is an attack.** `formRoll` sets `attack: true` (DA0). This covers the form attack, Trample,
  Takedown, Venomous Strike and Demolish ("make an attack"). `rollMatches("attack")` then holds, so Rampage's
  `beforeYouRoll` attack rider (CB p.33: "before you make an attack roll, you can mark a Stress to gain a +1 bonus to your
  Proficiency for that attack") is offered on them. Webslinger stays a Finesse Roll.

## What changed

| File | What |
|---|---|
| `src/lib/domain/class-features/classes/druid.ts` | Beastform: no mods; choice `parseBeastformChoice`; Evolved and Hybrid checks; Hybrid extra Stress; select lists Evolved per base; effect text from the table's numbers. |
| `src/lib/domain/feature-effects/owned.ts` | `BeastformHolding`, `activeBeastform`, `beastformLabel`, `parseBeastformChoice`, `beastformChoice`, `hybridPick`, `isEvolvedForm`, `isHybridForm`, `isStatLine`; `OwnedFeature.uses`; the stat line, Evolved and Hybrid holdings. |
| `src/lib/domain/feature-effects/passives.ts` | `traits` total; the stat line's passive use summed; `uses` honoured; `legacyBeastformMods`. |
| `src/lib/domain/characters/derived.ts` | `derivedTraits`, `withPassiveTraits`; doc. |
| `src/lib/srd/feature-effects/beastforms.ts` | `formRoll` `attack: true`; Vicious Maul temporary for both forms; comments. |
| `src/components/party/extras/beastform-panel.tsx` | The note names a Hybrid's additional Stress (`HYBRID_EXTRA_STRESS`). |
| Tests | `tests/unit/beastform-integration.test.ts` (13), `tests/convex/beastform-integration.test.ts` (4), additions to `beastforms.test.ts`, `derived.test.ts`, `feature-passives.test.ts`, `extras-beastform.test.ts`. |

## Follow-ups for the orchestrator (outside DA9's owns)

1. **Traits in rolls (needed for B1).** Every roll path reads `withEffects(sheet).traits`, and D5's effect no longer
   carries the trait, so the form's trait bonus reaches only callers of `derivedTraits`. Pick one fix:
   - (a) wrap the call sites in `withPassiveTraits(withEffects(sheet))`: `convex/lib/cardRunner.ts` (`cardActor`:
     traits and spellcast), `convex/lib/rolls.ts` (lines 169 and 346), `convex/rolls.ts:171`, `convex/lib/featureDrawer.ts`,
     `src/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet-context.tsx` and `convex/combatFeatures.ts:367`;
   - (b) add `passiveMods(sheet).traits` inside `withEffects` (`src/lib/domain/characters/effects.ts`). Import it from
     `feature-effects/passives`, not from `derived.ts`: `derived.ts` → `class-features/hooks` → `witch.ts` → `effects.ts`
     would be an import cycle.
   Evasion needs no wiring: every `derivedDefense` call already adds it.
2. **An old pin outside owns that B1 changes** (dcm-bxp.99.19.19): `tests/unit/class-features-core.test.ts:300-301`
   expects `withEffects(sheet).evasion` 12 and `.traits.agility` 3 after D5's Beastform. Replace the two lines with:
   ```ts
   // B1 (user 2026-10-29, dcm-bxp.99.19.19): the drawer's table adds the form's Evasion and trait, not D5's effect.
   expect(sheet.effects[0]?.mods).toBeUndefined();
   expect(derivedDefense(withEffects(sheet)).evasion).toBe(derivedDefense(withEffects(druid)).evasion + 2);
   expect(derivedTraits(withEffects(sheet)).agility).toBe(druid.traits.agility + 1);
   ```
   The new code imports `derivedDefense` and `derivedTraits` from `@/lib/domain/characters/derived`.
3. **`OwnedFeature.uses` in the drawer and the runner.** `convex/lib/featureDrawer.ts` and `pickFeature`
   (`convex/lib/featureRunner.ts`) do not read it yet. Under Legendary Beast the drawer still lists all six per-base attack
   uses and the base form's own `main` attack. Each should drop uses not in `feature.uses`, and `pickFeature` should refuse
   them.
4. **Hybrid picks on the Party sheet.** D5's select takes one value, so it cannot choose a Hybrid's features. The
   Beastform extras panel (frame tracker `characterExtras.setBeastform`) records picks but does not touch D5's effect. To
   hold the picks, a client sends the composed choice (`beastformChoice`). SD7's drawer Use flow or the extras panel can
   do that (UX decision).

## QUESTIONS

1. **A Hybrid through Evolution: is the additional Stress still marked?** CB p.30 Evolution: "Spend 3 Hope to transform
   into a Beastform without marking a Stress." CB p.34 Legendary Hybrid: "To transform into this creature, mark an
   additional Stress" (CB p.35 Mythic Hybrid: "mark 2 additional Stress"). Built: Evolution waives only the Beastform's
   own Stress, and the Hybrid's additional Stress is still marked. The alternative is that Evolution waives all of it.

## Checks

- `pnpm lint` and `pnpm typecheck`: pass.
- `node scripts/tracer-guard.mjs .omc/plans/drawer-answers.yaml DA9`: pass.
- `pnpm exec vitest run`: 8736 pass, 1 fail. The failure is the old pin outside owns (follow-up 2).
- e2e `tests/e2e/character-sheet.spec.ts` (3) and `tests/e2e/sheet-drawer.spec.ts` (2): pass.
