# TASK-HUD-PRE-W9: GM "Play for" weapon attack in the HUD; End on lasting effects for the GM and the caster

Status: Review. Feature agent before HUD wave 9 (which deletes the classic combat screen). Beads dcm-bxp.99.32.36 and
dcm-bxp.99.32.37 (user decisions 2026-11-02). Branch `hud-pre-w9` from `rebuild`.

## 1. dcm-bxp.99.32.36: the GM's "Play for" weapon attack through the HUD attack picker

- `hud/pick-attack/use-attack.tsx`: `useAttackPicker(state, playFor?)`. With the GM and a PC id, the picker is that
  PC's: the session's `actor` is the PC's token (`combatTokens.list`, the GM's read, as `pick-feature` and the hand
  already do for Play for), names / bands / extra-target chips come from the map's tokens, and `combatActions.attack` is
  sent with that `characterId` (the same server path the player uses; `attacker()` is `loadCharacter(..., "edit")`,
  so the GM may act for any PC). Off the live map: "Not on the live map"; no token: "Not on the map". The picker's state
  argument is now `AttackState` (campaign, role, mode, map, previewCharacterId), so the sheet panel can call it. It
  also returns `weapons` (slot + name). Player behaviour unchanged.
- `hud/pick-attack/model.ts`: `AttackInput.actor` / `others` (optional); `attackSession` passes `actor` on.
  `rows.tsx` reads `input.others` before the player's own view for rider extra-target chips.
- `hud/sheet/panel.tsx`: an **Attack** section on a PC's sheet for the GM while "Play for this character" is on: one
  gold button per equipped weapon ("Attack · Broadsword", name "Attack with Broadsword for Brannoc") → `open({ slot })`.
  The player-style panel (not the GM's purple adversary picker) opens with weapon tiles, chips and riders.
- **Action ring**: player-only (H3.4: it opens on a click on your own token; the GM's token clicks open sheets, in
  `tokens/tokens-layer.tsx`, which this task must not touch). So the sheet is the GM's entry; no ring change.
- **Spotlight**: `hud/pick/panel.tsx` no longer greys the primary with "The GM has the spotlight" for a GM session
  (`state.role === "player" && spotlightBlocks(...)`): the server never refuses the GM (`assertMayAct`), also while
  playing for a PC. One line.
- **Out of range for a GM attack**: the server does not exempt the GM. `combatActions.attack` turns any out-of-range
  target into a `pending` sanction for the GM (no `gm` check on that path), so the GM's own attack for a PC waits in
  the GM's Resolutions / queue like a player's, and the panel says "the GM approves first". Kept as is (see Questions).

## 2. dcm-bxp.99.32.37: End on lasting effects in the HUD sheet

- **Server, permission widened** (`convex/classFeatures.ts` `endEffect`): was `editable()` (the bearer's editors: its
  player, the GM, edit grantees). Now `loadCharacter(..., "view", "edit")`, then, for a non-editor, the new
  `editsCaster` (`convex/lib/characterSheet.ts`): the effect's stored `casterId` (E6.4) normalised to a character of the
  same campaign, and `findCharacter(..., "edit")` (`permissionFor`) on it. Otherwise FORBIDDEN (also for an effect
  that is gone, so a non-editor learns nothing); outsiders NOT_FOUND as before. Bearer editors keep their End
  (classic Party sheet unchanged).
- **`combatHud.sheet`**: each effect gains `canEnd: boolean` (returns validator widened; it's a query result, not a
  stored shape): `true` for gm / own mode, else `editsCaster` (one permission read per distinct caster).
- **HUD** (`hud/sheet/panel.tsx`, `sheet.css`): an "End" chip after the duration of every effect with `canEnd`
  (name "End Rune Ward on Brannoc"), one `classFeatures.endEffect` intent with a fresh idempotency key and an
  optimistic update that drops the row from `combatHud.sheet`; a refusal shows under the section.
- **E2E seed**: `classFeatures.seedEffectForE2e` (internal, refused outside the local e2e backend, as
  `seedForcedAttackForE2e`): one effect, optionally with a caster.

## Tests

- `tests/convex/hud-end-effect.test.ts` (new, 5): `canEnd` per role (GM, bearer, grantee all; the caster's player only
  the effect they cast); the caster's player ends theirs, FORBIDDEN on others and on a gone effect, outsider
  NOT_FOUND; GM and bearer as before; a non-character `casterId`; the seed's refusal.
- `tests/convex/hud-sheet.test.ts`: effects now carry `canEnd` (false for a view-mode reader without a caster).
- `tests/convex/authz/play.entries.ts`: `classFeatures.endEffect` row seeds an effect on characterA cast by
  characterB, so playerB (otherPlayer) is `ok` (the caster rule); the other roles unchanged.
- `tests/unit/hud/attack-pick.test.tsx` (+2): the GM opens Moss's picker with Moss as the actor (player-style panel,
  Moss not a row), not held back by the GM's spotlight, sends Moss's `characterId`; the reasons off the live map / with
  no token.
- `tests/unit/hud/sheet-panel.test.tsx` (+1, 1 extended): Attack only with Play for on, opens the picker for the PC
  and slot; End only where `canEnd`, the intent and the optimistic drop.
- `tests/e2e/hud-gm-playfor.spec.ts` (new, 2): the GM plays for Brannoc and attacks the Bandit through the picker
  (result row); End: the GM ends any, Vex's player (third browser) sees no End, Moss's player ends the effect Moss cast.

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest focused: `tests/unit/hud` + `tests/convex/hud-end-effect.test.ts` 31 files, 410 passed; `hud-sheet`,
  `authz/play`, `authz/hud`, `class-features` 260 passed. Full suite (`--maxWorkers=2 --testTimeout=120000`): 478 files,
  10595 passed + 1 expected fail.
- e2e (ports 3185 / 3482): `hud-gm-playfor.spec.ts` 2 / 2. All `tests/e2e/hud-*.spec.ts` (47): 34 passed on a machine
  at load 15-20 (the 13 failures were Convex 1 s timeouts, sign-in aborts and test timeouts, none in this task's
  spec); `--last-failed` on a quieter machine: 13 / 13 passed.

## Merge-time actions

- Codegen: no new module; `classFeatures.seedEffectForE2e` (internal) is new in an existing module and the
  `combatHud.sheet` return type gained `canEnd`. Run `npx convex codegen` after merging (types are inferred, so the
  generated files should not change).
- No schema change, no migration.

## QUESTIONS (defaults taken, reversible)

1. **The bearer's own player keeps End** on every effect on their character (the server allowed it before; the classic
   Party sheet shows it). The user's words were "the GM and the effect's caster"; hiding End from the bearer would
   need `canEnd` narrowed to gm || caster (one line in `combatHud.sheet`) and, to match, the server too.
2. **GM out-of-range attack for a PC** opens a sanction the GM then approves. Should the GM's own Play-for attack skip
   the sanction (as an adversary's does, H5.2)? That is a server change in `combatActions.attack` (a `loaded.gm` check
   before `openSanction`).
3. **Ring for the GM**: the action ring could open for the GM on a played-for PC's token; that needs the token layer
   (`tokens-layer.tsx`, the spotlight agent's) to route the GM's click to the ring while Play for is on.
