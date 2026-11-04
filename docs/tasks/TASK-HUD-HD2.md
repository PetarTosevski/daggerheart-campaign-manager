# TASK-HUD-HD2: the sheet query for any party member

Plan `.omc/plans/combat-hud.yaml`, wave 3 batch A, tracer HD2 (boards Main, GMDesktop, CmpTokens). Bead dcm-bxp.99.32.9.
User answer 4a (2026-11-01): any party member views any PC's sheet; only the cards in hand follow hand sharing.
Server only: no UI, so no board shots (H2.1 draws the panel from this query).

## What landed

- `convex/combatHud.ts`: `combatHud.sheet({ characterId })`, a `userQuery` that loads the character with
  `loadCharacter(ctx, ctx.user, characterId, "view", "owner")` (`permissionFor` underneath; the permission is exact up to
  owner, for the mode). Every member of the character's campaign reads it; an outsider, an unknown or deleted character,
  or a deleted campaign is `NOT_FOUND`. It does not look at `playersSeeHands` / `handHidden` and never returns a card
  (domain cards, loadout, vault): the hand stays `combatCards.hand`, which keeps following hand sharing.
  Exports `hudSheetValidator`, `hudSheetFeatureValidator`, `HudSheet`, `HudSheetFeature`.
- `convex/lib/combatHud.ts`: `className(classId)` (shared with `partyMemberOf`), `effectUntilLabel(effect)` (an effect's
  duration in words; a manual effect's own `ends when ...` text first), `bareConditionUntil(id)` (Hidden's core-rule end).

### The returned shape (for H2.1)

```ts
{
  characterId: Id<"characters">,
  mode: "own" | "gm" | "view",      // gm: campaign owner; own: edit permission (the player, an edit grant); view: any other member
  name, className, level,           // header: "Moss · Druid · Level 3"
  evasion: number,                  // derivedDefense(withEffects(sheet), augments, featureScope) — active effects count
  armorScore: number,               // = trackers.armor.max
  thresholds: { major, severe },    // derivedThresholds(sheet, featureScope); Minor is below major
  experiences: [{ id, name, value }],
  trackers: { hp: { marked, max }, stress: { marked, max }, hope: { value, max }, armor: { marked, max } },  // as combatHud.party
  features: [{
    featureId, name, text, source,  // source: hope / class / subclass / ancestry / community / beastform / transformation / stance
    kind,                           // action | reaction | rider | auto | passive | outOfCombat | narrative
    cost: string | null,            // "3 Hope", "1 Stress + 1 Hope"
    limit: string | null,           // "Once per long rest"
    used: boolean, resetLabel: string | null,   // exhausted or active (Rogue's Dodge) + "Back after a rest"
    usesLeft: number | null, tokens: number, automated: boolean,
    uses: DrawerUse[] | null,       // combatFeatures.drawer's use rows (for FeatureUse): own / gm only, null in view mode
  }],
  conditions: [{ id, label, source: string | null, until: string | null }],
  effects: [{ id, source, text, until: string, ends: "rest" | "longRest" | "session" | "hit" | "scene" | "manual" }],
}
```

- `features` is `drawerOf`'s list (the classic drawer's read model) projected: the same features and states, so the panel
  and the classic drawer agree. `kind` is the first non-passive use's activation, else `passive`; the drawer's
  `outOfCombat` / `narrative` usage wins. `auto` is a feature that applies by itself (Combat Training): the board's
  "Passive" badge. `uses` uses `drawerUseValidator` unchanged, so H2.1 can hand it to the classic `FeatureUse` until H3.3.
- `conditions`: `source` / `until` come from the condition's marker effect when the sheet records one (lane C2: Vanishing
  Act's Cloaked); a bare Hidden gets the core rule's end (CB p.102); any other bare condition `until: null`. Marker
  effects are not repeated in `effects`.
- `effects`: every sheet effect except condition markers; `id` for an End button (GM / own), `until` in words
  ("until the next rest", "until you are hit", "until the end of the scene", a manual effect's "until they break free
  ..."), `ends` the stored kind (the classic panel's "Got hit" reads `ends === "hit"`).
- Not included (already elsewhere, or not in the acceptance): portrait (`combatHud.party`), the hand and the hand-sharing
  switch state (`combatCards.hand`, `combatCards.handSharing` → `{ playersSeeHands, hidden }` for "Hide my hand"), the
  Play-for switch, D5 counters, held dice, the Martial Artist's stances and Flying (`combatFeatures.drawer`, own / gm).

## Tests

- `tests/convex/hud-sheet.test.ts` (6): modes own / view / gm / own (edit grant) with identical numbers and features and
  `uses: null` only in view mode; warrior badges (No Mercy 3 Hope, Combat Training `auto`); with the hand hidden and the
  GM's switch off the drawer is FORBIDDEN for another player while the sheet reads, and no card id or name, `loadout`,
  `vault` or `domainCards` appears in any mode; conditions (Hidden's rule text, bare Vulnerable null) and effects'
  durations, Evasion counting an effect; Vanishing Act's Cloaked names its source and its marker is not an effect;
  outsider and deleted character `NOT_FOUND` (asserted on `ConvexError.data.code`).
- Authz: `tests/convex/authz/hud.entries.ts` adds `combatHud.sheet`, access `own` (a `userQuery`) with otherPlayer and
  grantee `ok`.

## Checks

- `pnpm typecheck`: clean, with a local `npx convex codegen` AND a local, uncommitted composition of
  `combatSpotlightTables` into `convex/schema.ts` (see below). `pnpm lint`: clean.
- vitest `--maxWorkers=1 --testTimeout=120000`: focused (hud-sheet, hud-party, authz hud, authz-matrix guard) 4 files /
  42 tests pass. Full suite (with the local schema composition): 448 / 450 files, 10207 tests pass, 1 expected fail; the
  2 failures are `cleanup.test.ts` "covers every campaign-scoped table" and `schema-guard.test.ts` "every table has a
  retention decision", both about `combatSpotlight` (H1.S's purge step / retention row are missing on `rebuild` too).
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml HD2 rebuild HEAD`: OK.

## Beads

- dcm-bxp.99.32.9: done by this tracer; left open for the orchestrator to close at merge.

## Merge-time actions

- **`rebuild` does not typecheck as it stands:** H1.S's merge (1f3361a8) says it composed `combatSpotlightTables` into
  `convex/schema.ts`, but `schema.ts` on `rebuild` has no `combatSpotlightTables`, so `convex/combatSpotlight.ts`,
  `convex/lib/spotlight.ts` and `tests/convex/hud-spotlight.test.ts` fail `tsc` (27 errors) and the generated data model
  lacks the table. I composed it locally to check my work and did not commit it (outside my owns). The orchestrator
  should add `import { combatSpotlightTables } from "./tables/combatSpotlight"` and `...combatSpotlightTables` to
  `convex/schema.ts`, then regenerate.
- Regenerate `convex/_generated` (new export `combatHud.sheet`; not committed from this branch).
- No schema change of my own.

## QUESTIONS

1. Bare conditions' "until" (Main board: "Hidden until Vex attacks or is seen"). The sheet stores a condition as a bare
   id unless its source ends it on an event (lane C2's markers). CB p.102: "After an adversary moves to where they would
   see you, you move into their line of sight, or you make an attack, you are no longer Hidden." and "Clearing
   Conditions": a temporary condition is cleared by an action roll, "Special conditions are cleared only when specific
   requirements are met ... stated in the text when the condition is applied." Built: Hidden gets the rule text, other
   bare conditions `until: null` (H2.1 shows no duration). Should a bare Restrained / Vulnerable
   a) show nothing (as built), or
   b) show "until cleared" (CB p.102 temporary condition)?
2. `auto` features (Combat Training): reported as `kind: "auto"`; the board labels them "Passive". H2.1 maps `auto` →
   "Passive" unless you want a separate badge.
