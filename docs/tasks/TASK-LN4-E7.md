# TASK-LN4-E7: adversary engine, round 4 (lanes-2 wave 10, tracer E7.4)

Branch `lane4-e7`. Lane `lane:w1-e7-adversary-engine`. Built on V4 (commit 7769fa95). Work was done in the brief's
priority order; the list from item (8) onwards is mostly left, with notes.

## What landed

- **Condition markers on PCs (dcm-1alq).** The touched-PC loop in `convex/lib/adversaryActions.ts` now calls
  `withAdversaryConditionMarkers` (cardRows.ts) after `writeSheetChanges`. A PC's Restrained / Vulnerable from Encumber,
  Hold Them Down, Envelop, or a Slowed / Rattled with `endsOnRoll`, carries its `ac:<n>` marker. A PC with a hit still
  open gets the marker as an `effect` rider of the hit. The GM line "X on Y ends when ..." stays: nothing calls
  `endAdversaryConditionsForCaster` / `endAdversaryConditionsOnRoll` yet (dcm-wli0 is E1.4a / E1.4b this wave). Drop
  it once those callers are merged.
- **Instance condition ends (dcm-thwj).** These are new pure helpers in `convex/lib/adversaryFeatures.ts`:
  - `instanceEffectEnds`: a stored modifier's ends, read as `EffectEnds`;
  - `endInstanceConditions(state, occ, { role, casterId })`: the modifiers that end, plus their condition or tag,
    unless another modifier still holds it;
  - `adversaryEndRoll`.

  The adversary engine calls them through `Work.settleEnds` before each commit:
  - **On its own roll:** an attack or a feature's action roll. Bearer `endsOnRoll` on itself; caster `endsOnRoll` on
    what it gave other instances and on the `ac:` markers it gave PCs.
  - **On the HP its plans marked on an instance:** itself or an ally, including bearer-rider damage. Bearer `endsOn`
    (`takeDamage`, `majorDamage`, ...) on that instance; caster `endsOnCaster` on what it gave other instances and on
    the markers it gave PCs.

  The automatic uses after a hit and the escape path settle too. Instance conditions that a non-ally loses are
  written by `commit`, and undo puts them back through `adversaryBefore`. Not done here: PC attacks and card damage
  on an instance (follow-up dcm-h9e4).
- **pcEscapes (dcm-0hlq).** The parts:
  - `matchesTrigger` has a real `pcEscapes` case: token name and condition name compared by name, within range.
  - The escape server is the new GM mutation `adversaryActions.pcEscape { characterId, name }`. The table rolls
    Encumber's Finesse Roll (CB p.218: "12 + the number of bramble tokens") and the GM records the success.
  - It clears the tokens from the sheet and fires `pcEscapes` on the running encounter's instances, with
    `trigger.amount` = the tokens removed. Automatic uses run and are committed. Reactions are returned as `offers`
    and named on the GM row. Everything goes in one undo group.
  - INVALID when the PC holds no such tokens; NOT_FOUND outside the party.
- **creatures into runCard (dcm-eg6h).** `src/lib/domain/adversary-effects/run.ts` passes `context.creatures` to
  `runCard`. `creatureCount` in steps that the card runner resolves (fear gain, damage, Stress) now reads the map:
  Hive Mind (HF p.65), Pack Fury.
- **Forced PC attack request (dcm-uxsd opener).** New `convex/lib/forcedAttacks.ts`:
  - `openForcedAttacks` writes the V4 `forcedAttack` row per PC, in the forcing use's group.
  - Locked `targetTokenIds` are the live map's tokens of the creatures named, never the attacker itself. The list is
    empty without a map.
  - A newer forced attack from the same adversary declines the PC's older open one.

  `adversaryAction` opens them after the commit, in place of E7.3's manual prompt. The GM row says "must make an
  attack against ... (roll request sent)". The player half is E1.4b's.
- **Hope before forced HP with no hit (dcm-spj0).** A `markHp` with `reduceWith: "hope"` on a PC with no hit waiting
  (Doom, HF p.75) now opens an incoming hit of its own: 0 damage, direct, with the HP as an
  `{ kind: "hp", reduceWithHope: true }` rider. E2.3 makes its target a responder, so the Hope is always offered. The
  plan's other marks on that PC land at once.
- **Hope / Stress / HP splits in the GM's ask (dcm-mvgc).** `featureAsk.splits` also lists `what: "hope"` (a split
  Hope gain, Stone of Omens HF p.62), `"stress"` (Mind Meld HF p.74) and `"hp"`. The returns validator is widened. The
  tracker dialog (`choices.tsx`) labels them ("Divide the Hope gained").
- **Creature tokens on PCs (dcm-wiwi writer).** A `creatureTokens` step on a PC writes the sheet's V4
  `creatureTokens` (`withSheetCreatureTokens`, capped). The run context's `creatureTokens` now also reads the PCs'
  sheets (`sheetCreatureTokensOf`), so Encumber's "3 or more bramble tokens" checks see them.
  - New GM query `adversaryActions.pcTokens` lists the party's tokens.
  - Plain UI: the tracker's reaction-window box (`windows.tsx`, shown on the Encounter tab and the map controls) lists
    "Tokens on the PCs" with an **Escaped** button that calls `pcEscape`.
- **Adversary-side bearer steps (dcm-mm0f adversary half, dcm-0wj1, dcm-f0m, dcm-bxp.99.19.3).** New helper
  `selfRiderSteps` (adversaryFeatures.ts). A bearer rider whose steps all land on the bearer, with fixed numbers
  (damage dice, Stress, HP) and no costs or roll, now runs when the instance acts or attacks:
  - On Fire's "extra 2d6 magic damage if they are still On Fire at the end of their action" (CB p.328; `timing:
    "after"` checks the tag is still held);
  - Poisoned's 1d10 direct physical (CB p.32-33).

  The GM row names the damage. Anything else stays a manual prompt: the d6 before each action roll, Shadow Shackles'
  Hope cost.
- **Typed added damage (dcm-i55, engine half).** An opted-in before-damage reaction's `modifyDamage add` with a `type`
  different from the hit makes the hit `both` (CB p.99).

Tests:
- `tests/convex/lane4-e7-round4.test.ts` (9 cases): Encumber writes the token, Restrained and its marker; pcTokens;
  pcEscape clears the tokens and runs a `pcEscapes` auto use with trigger amount = tokens, and gives INVALID when
  nothing is left; an instance's own attack roll ends its `endsOnRoll` condition; the caster's roll ends what it gave
  an ally; On Fire damages the acting instance; the Doom-style forced-HP window and its rider; the forced-attack rows;
  the Hope split ask.
- `tests/unit/adversary-effects/lane4-e7-round4.test.ts` (6 cases): `matchesTrigger` pcEscapes, `endInstanceConditions`
  on bearer and caster, a condition still held by another modifier, and the roll filter.
- The convex tests add test-only entries to `ADVERSARY_EFFECTS` and restore it after each test. This is because no SRD
  data yet has a Doom-style `reduceWith`, a Hope split or a pcEscapes trigger (S-lane data).

## Beads

| Bead | State |
|---|---|
| dcm-1alq | done (already closed by the bookkeeping; the call is now in) |
| dcm-thwj | closable for the adversary engine's events. The PC-attack / card-damage callers are follow-up dcm-h9e4 |
| dcm-0hlq | closable (trigger case + escape server). Restrained / Vulnerable going with the tokens: dcm-d3nj |
| dcm-j63t | closable (was closed) |
| dcm-eg6h | closable |
| dcm-uxsd | opener done; open for E1.4b's player half. Undo decline: dcm-xnmf |
| dcm-spj0 | closable (engine). Data: Doom / Tentacle-style `reduceWith: "hope"` (S4.4 / S3.4) |
| dcm-mvgc | closable (ask + UI). Data: Stone of Omens hope split (S3.4) |
| dcm-wiwi | closable (writer, reader in the run context, GM list + Escaped button) |
| dcm-mm0f | adversary half done for fixed self steps; the PC-roll half is E1's (dcm-l1er) |
| dcm-0wj1, dcm-f0m | closable: On Fire's 2d6 runs on the adversary's action |
| dcm-bxp.99.19.3 | closable for an adversary bearer (Poisoned's 1d10 on its action). A PC bearer is E1's |
| dcm-kti | partly: self steps with fixed numbers run; a d6 before each action roll (Venomous Stinger), Thorny Cage and the disadvantage mods stay manual |
| dcm-i55 | partly: before-damage folds merge the type. Slash and Burn is a GM-tapped `onHit` reaction (`useFeature` after the hit) whose fold into the open hit is not done; the data `type: "magic"` is S4.4's |
| dcm-63j | partly: a markStress split is asked (mvgc). The "would mark Stress" hook (Mind Meld's in-place move) is not done |
| dcm-ehgy (+ nsqo, k4x5, sos), dcm-wqgs, dcm-zi3k rest, dcm-b77, dcm-8rh, dcm-4yg4, dcm-va0f | not started (budget) |
| tail (702, icd, 51s, 1jg, 145, 1ch, 346, 4dc, e75, xobk, 5jyp, cdz, 2gn, yea, pgfr) | not started |

## Follow-ups (filed)

- dcm-h9e4 (`lane:w1-e1-triggers-rolls`): PC attacks and card damage on an instance call `endInstanceConditions`
  (bearer on the damaged instance, caster with the PC's id), in the attack's undo group.
- dcm-xnmf (`lane:w1-e1-triggers-rolls`): `declineGroupOffers` (convex/lib/combatRequests.ts) declines an undone group's
  open `forcedAttack` row.
- dcm-d3nj (`lane:w1-e7-adversary-engine`): escaping the bramble tokens also ends Encumber's Restrained / Vulnerable (a
  condition tied to a token count); a player-side escape roll.

## Data switches ready (S3.4 / S4.4, wave 11)

- `src/lib/srd/adversary-effects/t1-core.ts`:
  - Tangle Bramble Swarm Drain and Multiply: an `auto` use on `{ kind: "pcEscapes", name: "bramble" }` with a summon
    count of `triggerAmount`. The GM's Escaped button fires it.
  - Encumber's manual Finesse line: rewrite it to "the GM records the escape (Escaped)". Keep the Restrained /
    Vulnerable note (dcm-d3nj).
- `t1-hf.ts`: Stone of Omens, hope `distribution: "split"` (asked now).
- `t1-hf.ts` Hive Mind / `t2-hf.ts` Pack Fury: `creatureCount` in card-runner steps (dcm-eg6h live).
- `t2-hf.ts` Tentacle Rays:
  - Doom: `markHp` `reduceWith: "hope"` (dcm-spj0 live).
  - Beguile: `forcedAttack` with the PC as attacker. The request is written; the player's locked Attack bar is E1.4b's.
    Switch once E1.4b is merged.
- `t2-hf.ts` Mind Meld: the split Stress to allies is asked; the in-place "would mark" move is not built (keep the
  reminder).
- `t3-hf.ts` Slash and Burn: `change.type: "magic"` only helps the opted-in before-damage path. Keep the reminder for
  the GM-tapped reaction.
- Poisoned (beastforms.ts) / On Fire (arcana.ts) riders on an adversary bearer need no data change: they now run.

## QUESTIONS

1. **Who records an escape from bramble tokens?** Encumber (CB p.218): "All bramble tokens can be removed by
   succeeding on a Finesse Roll (12 + the number of bramble tokens) ... If bramble tokens are removed from a target
   using a Finesse Roll, a number of Tangle Bramble Minions spawn within Melee range equal to the number of tokens
   removed." I built a GM button (Escaped): the table rolls, the GM records the success. Should the player instead
   roll the Finesse Roll from their sheet, and the server judge it against 12 + tokens?
2. **Severity of HP an adversary's plan marks on an instance** (for "takes Severe damage" ends on instances). I read it
   from the HP marked (1 Minor, 2 Major, 3+ Severe), as the user's 2026-10-31 answer does for PCs: "severity follows
   the HP actually marked after armor". Is that also right for adversaries?

## Merge-time actions

- Authz: two new public functions, both entries added in my file `tests/convex/authz/adversary-actions.entries.ts`:
  `adversaryActions.pcEscape` (GM, okCodes INVALID) and `adversaryActions.pcTokens` (GM query). `featureAsk`'s returns
  validator is widened (`splits.what` adds hope / stress / hp).
- Codegen: a new lib module `convex/lib/forcedAttacks.ts` and two new functions in `convex/adversaryActions.ts`.
  Regenerate `convex/_generated` (I couldn't: no deployment in the worktree).
- Outside owns (reported, not edited): the `declineGroupOffers` line (dcm-xnmf). The GM line on PC condition ends in
  `adversaryActions.ts` can go once E1.4a / E1.4b's dcm-wli0 callers are merged.
- No stored shape changed. The sheet's `creatureTokens` and `forcedAttack` rows are V4's shapes, and the Convex
  mirror lines are already on rebuild.

## Checks

- `pnpm lint`: clean.
- `pnpm typecheck`: clean.
- Focused: lane4-e7-round4 (convex 9, unit 6), lane3-e7-round3, tracker-actions, tracker-held-attack, adversary-actions
  features: pass.
- Full suite (`pnpm vitest run --maxWorkers=1 --testTimeout=120000`): 421 files, 9867 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E7.4 rebuild HEAD`: OK.
