# TASK-HUD-H4.2: the hit window ("You were hit")

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 5 batch A, tracer H4.2 (boards Main 'You're hit',
CmpPromptsPlayer 'Pay something else?', CmpCards 'Reaction · shows in the hit window'). Briefs:
`.omc/plans/combat-hud-briefs.md` "Wave 5", answers 1c and 2. Parent bead dcm-bxp.99.32. Mode: add; renders only
inside the HUD shell (switch on, Play). No server change.

## What landed

All in `src/components/combat-map/hud/hit/` (fills H0's `HudHit` stub, already mounted in the pop region):

| File | What |
|---|---|
| `model.ts` | Pure: the window's mode (the classic `promptMode` plus `afterHit`), title ("You were hit"; on the GM view "<Name> was hit"; an ally "<Name> can react"; "Before the roll"; "After the hit"), sub line ("Brute hit Moss", a redirect "(instead of Mira)"), threshold tiles ("Minor" / "Major 9+" / "Severe 16+", the engine's severity lit with the engine's HP), the question ("Mark an Armor Slot to drop it to **Minor**?", "No Armor Slot left to mark.", direct damage), the HP / Armor preview ("2 → 3 of 6 marked"), the footer labels ("Take 2 HP", "Mark Armor · take 1 HP"), the counts stepper under I Am Your Shield, the grants' nouns, and the owed / waiting split. |
| `index.tsx` | `HudHit`: for every character the viewer owns (`characters.listByCampaign` `mine`: a player's own, the GM's own PCs, as the classic `GmOwnHits`), each in the classic `HitBoundary` (quiet retries), the oldest owed hit from `adversaryActions.pending` ("n more after this" in the sub line), else a "Waiting for the others" card. Thresholds and trackers from `combatHud.sheet` (HD2). Every answer is one `adversaryActions.respond` with a fresh idempotency key and the classic optimistic `afterAnswer` on `pending` (CL4). The window is keyed on the request id only. |
| `parts.tsx` | Tiles, the preview (pips show HP / slots left, the ones this answer marks hollow; the text says marked: answer 2), the reactions that answer (features with steppers / radio rows / box rows for what their Use asks; cards with domain colour, level, text and Use; I Am Your Shield is never offered to the hit PC, as classic `playableCards`), and "Pay something else?". |
| `spot.ts` | Stands the window beside the hit PC's token (42 px right, left near the screen edge, kept on screen), measured per frame like the picking panel. |
| `hit.css` | Board `.hitc` / `.hc-*` values on the `--hud-*` tokens; a bottom sheet at ≤ 760 px. |

### Behaviour

- **Target, a free slot** (`armorOne`): damage, tiles, question, HP and Armor rows, footer "Take n HP" (noArmor) and the
  primary "Mark Armor · take n HP" (armor 1).
- **Several slots** (`armorMany`, I Am Your Shield; Armor Eater's whole steps only): a stepper "Armor Slots to mark"
  over the server's counts; the primary names the count.
- **No Armor Slot left / direct damage** (`ok`): no Mark Armor, no Armor row; "Take n HP" is the primary.
- **After the armor answer** (`afterArmor`) and the after-hit offer (Unbreakable): the reactions that still fit, Done
  (`pass`).
- **An ally** and **before the roll**: the reactions with Use, and Pass. No damage number for an ally (Q14).
- **"Pay something else?"**: folded under the reactions; the engine's grants as radio rows with the engine's own label
  (the rates are in it: "1 handful per HP") and "up to n" (the engine's most), a stepper, "Spend n Hope" / "Spend n
  handfuls of gold" → `grant { id, amount }`. The board's "1 Hope = 1 HP" is sample text and is not shown.
- **Spotlight** (answer 1c): the window never reads the spotlight; `respond` is a reaction and the server lets it through
  while the GM holds it. The e2e spec runs with the GM holding it.

## Board states matched

Main 'You're hit' (`.hitc`): red header with the icon, "You were hit" and who hit whom (no weapon name: the engine
gives the attacker's label only), the big damage, three tiles with the active one, the gold question, HP / Armor pips
with the lost pip hollow and "before → after" (as "n of 6 marked", answer 2), footer "Take 2 HP" / "Mark Armor · take
1 HP". CmpPromptsPlayer 'Pay something else?' folded into the same window (sub "2 HP coming"; radio rows, stepper,
"Spend 1 Hope"; the board's own footer "Take the HP" is the window's "Take n HP"). CmpCards 'Reaction · shows in the hit
window': reaction cards as compact rows in the window (name, domain, level, text, Use), not full card faces (the window
is 320 px wide).

Shots (`E2E_VISUAL=1 … tests/e2e/visual/HUD-H4.2.spec.ts`, and the functional spec): `test-results/visual/HUD-H4.2/`
`youre-hit-{1440,1024,390}.png`, `youre-hit-window-*.png`, `gm-own-pc-1440.png`. Compare with
`reference/designs/combat-hud/preview/Main.dc.html` (state "You're hit").

Deviations: damage reads "n damage" (the pending view carries no damage type, so not "physical damage"); the tiles' HP
on inactive tiles are the core 1 / 2 / 3 (CB p.91), the lit one is the engine's.

## What moved out of the old column

Nothing removed (mode add). The classic prompt stays in Map tools (the drawer) and on the sheet; with the drawer open
both show the same hit and either answers it. The death move after a hit stays the classic `MapDeathMove` (in the
drawer) until H4.3.

## Tests

- `tests/unit/hud/hit-model.test.tsx`: modes, titles, tiles, question, preview, footer labels, counts, grants, ordering.
- `tests/unit/hud/hit-window.test.tsx`: You were hit (all elements, both answers with keys), no armor left hides the
  option, I Am Your Shield counts stepper, reactions (cards + feature with a situation), Pay something else (both grants,
  no sample rate), waiting line, GM's own PC on the GM view, usable while the GM holds the spotlight, ally Use / Pass,
  Done after armor and after the hit, no map.
- `tests/e2e/hud-hit.spec.ts`: GM holds the spotlight; Brute hits Moss → window beside Moss's token, tiles, question,
  "n of 6 marked", no enemy numbers, axe → Mark Armor → armor marked on the server; every slot marked → the engine
  resolves the hit at once (nothing to answer) and no window opens, HP marked; Brute hits Brannoc (GM-owned) → "Brannoc
  was hit" on the GM view only, axe, Take n HP. Note: with no Armor Slot left the window only appears when something
  else is owed (a reaction, a feature or a grant): the engine auto-resolves otherwise. That "No Armor Slot left to mark"
  window state is covered by the unit test, as the e2e seed has no such reaction.
- `tests/e2e/visual/HUD-H4.2.spec.ts` (`E2E_VISUAL=1`): the three sizes.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean. tracer-guard: all files owned, no out-of-owns edit.
- vitest focused: `tests/unit/hud/hit-*.test.tsx` 2 files, 20 passed. Full suite (`--maxWorkers=2 --testTimeout=120000`):
  462 files, 10378 passed + 1 expected fail.
- e2e (ports 3161 / 3434): first run of all `tests/e2e/hud-*.spec.ts` + the visual spec under Playwright's own servers:
  18 passed, 6 failed (hud-attack-pick ×2, hud-banners, hud-card-pick ×2, hud-tokens) on "Function execution timed out
  (maximum duration: 1s)" / slow live updates on a loaded host. Rerun of those 6 + `hud-hit` + `visual/HUD-H4.2` with the
  servers started by hand (`E2E_REUSE_SERVERS=1`): 10 / 10 passed. `hud-hit` and the visual spec passed in both runs.
- Phone: the footer pads 76 px at ≤ 760 px so "Ask the Lorekeeper" doesn't cover it (pick.css does the same).

## Beads

None filed; none closed (orchestrator).

## Merge-time actions

None: no Convex change, no codegen, no schema, no authz entry, no shell edit (the stub's mount is H0's).

## QUESTIONS (safest reversible defaults taken)

1. **Which tile HP to show on the inactive tiles.** CB p.91 "Marking Hit Points": "Severe damage is equal to or above
   your Severe threshold; you mark 3 HP. Major damage is equal to or above your Major threshold but below Severe; you
   mark 2 HP. Minor damage is anything below your Major threshold; you mark 1 HP." Default: 1 / 2 / 3, the lit tile the engine's own count (they differ only when a
   feature changes the count).
2. **Several open hits at once.** Default: the oldest first, "n more after this" in the sub line; the next opens when
   it is answered.
