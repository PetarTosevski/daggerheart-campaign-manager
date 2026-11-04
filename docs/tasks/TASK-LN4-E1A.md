# TASK-LN4-E1A: card and feature use paths round 4 (lanes-2 wave 10, tracer E1.4a)

Branch `lane4-e1a`, lane `w1-e1-triggers-rolls`. Tests: `tests/convex/lane4-e1a-use-paths.test.ts`,
`tests/unit/lane4-e1a-hand.test.ts`, `tests/e2e/lane4-cloak-prompt.spec.ts`; authz entries in
`tests/convex/authz/prompts.entries.ts`.

## What landed

- **Card plan hand-offs (dcm-tn8u, dcm-svnq, dcm-9l9g)**, `convex/combatCards.ts`:
  - `resolveUse` applies what the runner leaves to the caller, as the feature path does: gifts from manual `inventory`
    prompts (`giftsOf` / `giveTo`) and from the runner's own `inventory` plan steps (`inventoryGifts`: `giveGold`,
    named `giveItem` to a PC; any other op is a feed line "… (by hand)"), a `setStance` step (`stancesOf` + `setStance`,
    the dropped stance's instance befores on the GM row), and one public row with `planHandoff`'s feed words.
  - `afterUse` (cards and features) runs the hand-offs last (`runHandoffs`): an adversary forced to attack makes its
    standard attack now (`forcedStandardAttack`, its own log group) against the picked creatures; none picked, or a
    refusal, is a manual prompt "X must make its standard attack against a target the GM picks"; a PC forced to attack
    is a manual prompt. `changeForm` writes the `form` modifier (`formInstanceEffect`) with `adversaryBefore` in the
    use's group.
  - `castWrites`: each `condition` step on an enemy stores its entry fields (`conditionInstanceEffect`: mods,
    `endsOnRoll`, `escape`, `recorded`, `endFear`), merged into the end marker cardRows left when there is one.
  - `useCard` passes `point` / `points` to the runner as `CardRequest.points` when the use's targets name points
    (`usesPoints`); the GM's approval passes the stored `point`.
  - The Hand's after-the-roll dialog shows the new asks plainly: per-chooser `choose` asks (legend names the chooser,
    answer `by:<step>:<chooser>`) and chain links (`followUp`: check boxes, answer `chain:<link>`) (`askKey`,
    `answerChoices` in hand/model.ts).
- **Cloaked GM prompt (dcm-vx5n card / feature half)**: `convex/lib/cloakPrompts.ts` `openCloakPrompt` (exported for
  E1.4b's roll paths) opens V4's `cloakPrompt` request when a use's action roll targets an enemy, is not an attack
  (`isAttackUse` false), and the actor has an ordinary Cloaked (Vanishing Act's sourced Cloaked: no prompt).
  `convex/cloakPrompts.ts`: `pending` (gmQuery: character, use and enemy names) and `answer { requestId, ends }`
  (keyed GM mutation: yes ends Cloaked with `withoutCondition`, one public row in the use's group, so the use's undo
  puts Cloaked back; no declines; an undone use, an ended encounter or a character no longer Cloaked is `stale`). The
  GM's Resolutions column lists them (`requests/cloak.tsx`, rendered by `DifficultyRequests` when unfiltered): plain
  "Yes, it ends" / "No" buttons, optimistic removal.
- **Feature sanction riders (dcm-mcgj)**: `useFeature` stores the sent riders in the sanction payload (V4 field);
  `combatFeatures.sanction` replays them (`ridesWith` + `featureWithRiders`).
- **pcRolls on card / feature rolls (dcm-m7tm card / feature half)**: `foldPcRolls` calls E7's `pcRollAdversaryUses` on
  a resolving use's action roll (never on a dry run that waits for the GM; the approval runs it). Bonuses go into the
  roll by running the use again with the same dice, the Hope / Fear Die raised (so success, Hope, Fear and hits follow
  it); a critical stays a critical (records only); a tie after the bonus runs with the Fear Die one higher and the
  modifier one lower (WITH FEAR, same total). The rows show the true dice (`withDieBonuses`). The adversary lines go on a
  GM row in the use's group. Plain path (`cardPcRolls`, `featurePcRolls`) and the rider path (`runWithRiders`, before
  the after-roll riders read the result; `RiderUse.resolving` for the GM's approval).
- **Adversary-given condition ends (dcm-wli0 card / feature half)**: `afterUse` calls `endAdversaryConditionsForCaster`
  for each instance the use's damage marked HP on (severity and HP from the plan's damage steps), and
  `endAdversaryConditionsOnRoll` on the actor's sheet for the use's roll (attack kind from the roll spec).
- **Caster on what a card gives (dcm-j5aw writer half, dcm-lztq card writer)**: `stampCaster` puts `casterId` (the
  user's character id) on every sheet effect the card adds to its user or an ally; `castWrites` puts it on every
  instance modifier the use adds (so E1.4b can exclude the placing PC: Lead by Example, CB p.342).
- **Hand point picking**: a use whose area goes on a picked square (`areaPickOf`: a `point` area, one square; a wall,
  two) closes the dialog and starts `startAreaPick` (two picks for a wall), then sends `useCard` with `point` /
  `points`; the banner shows the result line.
- **Vault to the dialog (dcm-8e4c, dcm-u4pq)**: the Hand passes the vault cards at or under the character's level to
  `UseDialog` (Codex-Touched's swap).

## Beads

- dcm-tn8u: closable (handoffs applied, points passed, asks shown).
- dcm-svnq: closable for cards (forced attack to `forcedStandardAttack`, conditions via `conditionInstanceEffect`). The
  feature resolver's instance writes are E8's: follow-up dcm-zu5r.
- dcm-9l9g: closable (forcedAttack and changeForm handoffs run from card and feature plans, in `afterUse`).
- dcm-vx5n: card / feature half closable. The attack / roll paths' half (rolls.duality, resolveAttack) is E1.4b's
  (they can call `openCloakPrompt`).
- dcm-mcgj: closable.
- dcm-m7tm: card / feature half done; the roll / attack half is E1.4b's. Undo of the adversary use's own writes: dcm-9lvv.
- dcm-wli0 (already closed by bookkeeping): the card / feature half now runs.
- dcm-j5aw: writer half done (instance modifiers carry `casterId`); reader half E1.4b.
- dcm-lztq: card writer done; feature writer (E8.4) and readers / migration (E6.4) left.
- dcm-8e4c, dcm-u4pq: closable.
- dcm-79v1 card half: NOT done (still no roll path records which effect's benefit it used; `endGrantedBenefit` has no
  caller from cards). Left for wave 11 with the data.
- dcm-dgu (3) line / front / path / between shapes: NOT done (tail).

## Follow-ups filed

- dcm-zu5r (lane:w1-e8-session-features-rests): `resolveFeatureUse` should call `inventoryGifts`, `castWrites` and
  `stampCaster` (exported from convex/combatCards.ts) as `resolveUse` does; take / takeGold / damageWeapon steps have no
  writer anywhere.
- dcm-9lvv (lane:w1-e7-adversary-engine): `pcRollAdversaryUses` writes instance Stress / HP and Fear without returning a
  before, so the use's undo leaves them.

## Data switches ready (wave 11 / S tracers)

- grace.ts Words of Discord: the forced attack now runs (`forcedStandardAttack` against the picked adversary); the
  manual line "The target makes an attack against another adversary … (the GM runs it)" can go once the Hand sends a
  `picked` victim (today the dialog does not ask for it: without one it is the GM's prompt). Keep the line until then.
- Any card `inventory` `giveGold` / named `giveItem` step: written for cards (features after dcm-zu5r).
- codex.ts Mysterious Mist, midnight.ts Eclipse / Veil of Night: the Hand now picks the point (one square; a wall two)
  and sends it; the area places from `useCard`.
- t4-hf.ts Ill Omen / Backhanded Guidance (S4.4): a `modifyRoll dieBonus` step now folds into card and feature rolls
  (the attack / duality paths are E1.4b's).
- Lead by Example (valor.ts, S1.4): instance modifiers carry the placing PC's `casterId` (reader E1.4b).

## QUESTIONS

- None new. Built to the 2026-10-31 answers (Cloaked prompt, bonus tie WITH FEAR). One reading to confirm: the prompt
  label is the card's (or feature's) name, not the use part's name ("Deft Maneuvers", not "Hex").

## Merge-time actions

1. **Fallback line, convex/lib/combatRequests.ts (no owner this wave)**: `declineGroupOffers` should close an open
   Cloaked prompt when its use is undone. Add to the loop:
   ```ts
   else if (p.kind === "cloakPrompt" && p.groupId === groupId) await closeRequest(ctx, row._id, "declined", by);
   ```
   Until then `cloakPrompts.pending` still lists the prompt after an undo; `answer` treats it as `stale`.
2. **Edit outside owns forced by an existing test**: `tests/convex/combat-cards.test.ts` lines 366 and 383 assert the
   exact instance modifiers of Glyph of Nightfall and Blighting Strike; they now carry `casterId: a.w.characterA`
   (dcm-j5aw). The two assertions gained that field; nothing else changed.
3. Authz: new module `convex/cloakPrompts.ts` (`pending`, `answer`): entries added in prompts.entries.ts.
   `combatCards.useCard` / `combatFeatures.useFeature` args unchanged.
4. Regenerate `convex/_generated` (new modules `cloakPrompts`, `lib/cloakPrompts`).

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Focused: lane4-e1a-use-paths (10), lane4-e1a-hand (3), authz matrix + unauthenticated sweep (931), the card / feature /
  Cloaked suites (269) pass.
- Full suite (`pnpm vitest run --maxWorkers=1 --testTimeout=120000`): 421 files, 9865 passed, 1 expected fail.
- `tests/e2e/lane4-cloak-prompt.spec.ts`: passed (servers started by hand, `E2E_REUSE_SERVERS=1`; the managed web server
  timed out building on the loaded machine).
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E1.4a rebuild HEAD`: everything owned except
  `tests/convex/combat-cards.test.ts` (merge-time action 2).
