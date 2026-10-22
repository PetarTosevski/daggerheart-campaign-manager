# TASK AA4: Player side - incoming-hit prompt (armor choice, ally reactions) on the map and the sheet

Plan `.omc/plans/combat-actions.yaml`, tracer AA4 (wave 6, depends on AA2 and CA6). Server API: `docs/tasks/TASK-CA-AA2.md`.
Status: Review.

## What landed

| File | What |
|------|------|
| `src/components/combat-map/actions/reactions/model.ts` | Pure model: `promptMode` (armorOne / armorMany / ok / ally / waiting), `damageLine` ("14 damage: Major (2 HP)."), `armorQuestion` ("Mark an Armor Slot to make it Minor?"), `hitLine` ("Bandit hit Mira"), `stepText`, `stepFor`, `reactionCard` (SRD leaf module), `playableCards`, `afterAnswer` (the optimistic `pending`). |
| `reactions/prompt.tsx` | `PendingHits` (one character's open hits, shared by map and sheet), `HitBoundary` (rule 11), `useRespond` (`adversaryActions.respond` once per tap, fresh idempotency key, `.withOptimisticUpdate` on `adversaryActions.pending`). |
| `reactions/index.tsx` | `IncomingHit` (the page's player-column slot): for each of the player's own characters (`characters.listByCampaign`, `mine`) the open hits, plus the sheet's `DeathMoveModal` mounted while a death move is due. Nothing for the GM. |
| `reactions/reactions.css` | Map variant (the board's dark `cm-card` palette, Cinzel heading, letter-spaced label); sheet variant (parchment, wine buttons, gold rule); at <=760 px on the map the owed prompts dock as a fixed bottom sheet above CA5's actions sheet (z-index 80 over 70); all buttons 44 px. |
| `party/[characterId]/incoming-hit.tsx` | `SheetIncomingHit`: the same prompt at the top of the Sheet page, for the player and the GM (`canEdit`). |
| `party/[characterId]/page-one.tsx` | Mounts `SheetIncomingHit` first in the page. |
| `actions/index.tsx` | Re-exports `IncomingHit`; the AA5 slot comment in `Resolutions` (below). |
| `tests/unit/incoming-hit.test.tsx` | 18 tests (model, prompt with Convex mocked, map slot, sheet slot). |
| `tests/e2e/incoming-hit.spec.ts` | 3 specs in up to three browsers (GM, Mira's player at 1440, Tabby's player at 390); axe on each prompt; shots in `test-results/visual/CA-AA4/`. |

No server file, schema or validator changed.

## Player vs GM

- **Hit PC's player** (`pending` role `target`): "You were hit", "Bandit hit Mira", "13 damage: Severe (3 HP).", "Mark an Armor
  Slot to make it Major?", Mark / Don't. Direct damage or no free slot: OK only. `maxSlots > 1` (after I Am Your Shield):
  one button per count, "Mark 2 · No damage", and "Don't · Major (2 HP)". Their own reaction cards (Shrug It Off,
  Unyielding Armor) show with Use above the armor answer. Never the roll, Evasion, or adversary numbers.
- **Ally with an eligible card** (role `ally`, `cardIds`): "Tabby can react", "Bandit hit Mira", the card's name, domain,
  level and text with Use, and Pass. No damage number.
- **Nothing owed** (answered, released by a redirect): the single line "Bandit hit Tabby · waiting for the others".
  Other players get nothing from `pending` (the server returns no view) and see only the feed's public row "Bandit hit Mira".
- **GM**: the map slot renders nothing (the GM's open-hit list and "Resolve now" belong to AA5 / AA3). On a character
  sheet the GM can edit, the GM sees and can answer the same prompt (`respond` accepts the GM).
- **Death move** (user answer 2026-10-22): on the map, while `deathMoves.state` says a move is due (`awaitingMove` or a
  pending move) the sheet's `DeathMoveModal` is mounted for that character, so it opens at once after the hit that marked
  the last HP. On the sheet the existing `SheetDeathMoves` already does this. When AA2b's server flag lands nothing here
  needs to change, since the modal reads `deathMoves.state`.
- **Riders moving with I Am Your Shield** (AA2b): server-side; the prompt shows whatever `pending` says.

## User answers implemented (quoted from the plan)

- **Q13** "The hit PC's player chooses whether to mark an Armor Slot; the damage waits for that choice. Allies may respond
  with their abilities (e.g. 'I Am Your Shield', CB p.341)."
- **Q14** "Players see that they were hit, not the attack roll." Decision B0: the hit PC sees their damage and severity
  against their own thresholds; others see "Bandit hit Mira".
- **Q17 (a)** "the reaction window closes when the target chose armor and every eligible ally answered Use/Pass; the GM
  can 'Resolve now' anytime; no timer." No timer in the prompt.
- **Q11** phone: a bottom sheet with 44 px buttons.

## Rules (printed pages)

- CB p.114: "you can negate some (or all) of it by marking an available Armor Slot … reducing the severity of the damage
  by one threshold … Each time your character takes damage, you can only mark 1 Armor Slot."
- CB p.99: "Direct damage is … damage that Armor Slots can't be used to reduce." (OK only.)
- CB p.341 I Am Your Shield: "When an ally within Very Close range would take damage, you can mark a Stress to stand in
  the way and make yourself the target of the attack instead. When you take damage from this attack, you can mark any
  number of Armor Slots."
- CB p.91: "When you mark your last Hit Point, you must make a death move."

## For AA5: the adversary panel slot

The page (`src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx`, `GmColumn`) already mounts `AdversaryPanel` from
`src/components/combat-map/actions/adversary/` in its own boundary under the token card, so AA5 needs **no line** for
the panel. If AA5 also wants something inside the GM Resolutions wrapper, the place is marked in
`src/components/combat-map/actions/index.tsx`, function `Resolutions`, comment `ADVERSARY PANEL SLOT (AA5)`, between
`GmHand`'s boundary and `<GmResolutions {...props} />`. The one line is:

```tsx
<PartBoundary label="Adversary actions"><AdversaryPanel {...props} /></PartBoundary>
```

plus `import { AdversaryPanel } from "./adversary";` (that file is AA4's; the orchestrator or a follow-up adds it).

## Visual check (1440 and 390)

The boards have no incoming-hit prompt. The map card follows `combat:player-day`'s player column (360 px `cm-card`, gold
rim as `cm-card-me`, Cinzel `cm-h`, letter-spaced `cm-lbl`, the gold `cm-go` fill); the sheet card follows Party.dc.html's
parchment boxes (gold line, Cinzel caps, wine primary like the sheet's tabs). Shots checked by eye:
`map-target-1440` (prompt first in the column above the Hand), `prompt-target-1440`, `map-ally-390` (bottom sheet over
the column, card with Use, Pass full width), `map-shield-390` (Mark 1..4 with their results, Don't), `sheet-target-1440`,
`sheet-target-390`. No horizontal scroll at 390.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 278 files, 7509 passed, 1 expected fail (before the last prompt
  tweak; `tests/unit/incoming-hit.test.tsx` 18 passed after it).
- e2e (ports 3156 / 3424): `incoming-hit.spec.ts` 3 passed (axe: no serious or critical violation on each prompt;
  `expectTouchTargets` 44 px at 390 and on the sheet); `combat-*.spec.ts` + `character-sheet.spec.ts` + `death.spec.ts`:
  31 passed.
- `pnpm tracer:guard .omc/plans/combat-actions.yaml AA4`: OK.

## QUESTIONS

1. **Played card still listed after a redirect.** After Tabby plays I Am Your Shield, `pending` for Tabby (now `target`)
   still lists `cardIds: ["i-am-your-shield"]` (the responder entry keeps its offered cards). The client hides
   ally-only cards for the target (`playableCards`), but `hitView` should drop answered cards (AA2's
   `convex/lib/incomingHits.ts`).
2. **Original target in `pending`.** After a redirect Mira's view reads "Bandit hit Tabby · waiting for the others". An
   `originalTargetName` in the view would let it say "Tabby stepped in". Wanted?
3. **GM on the map.** The map slot shows nothing for the GM, even for a PC the GM owns. Should the GM's own PCs get the
   prompt in the GM column too, or is "Resolve now" / the sheet enough?
