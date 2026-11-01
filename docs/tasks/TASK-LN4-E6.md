# TASK-LN4-E6: endings round 4 (plan lanes-2 wave 10, tracer E6.4)

Branch `lane4-e6`, lane `w1-e6-endings-durations`. Built on V4's sheet effect fields `casterId` and `targetInstanceId`
(docs/tasks/TASK-LN4-V4.md).

## What landed

- **Caster-tied ends read the stored caster** (dcm-lztq, reader side). Two Skykin can each put Eye of the Storm (HF
  p.23) on the same ally, and each one's Severe damage now ends only their own.
  - Pure: `madeByCaster` in `src/lib/domain/characters/expiry.ts`. If the effect has a `casterId`, that decides: it
    must equal the caster's id when the caller knows it. When the caller doesn't, the effect is the caster's unless it
    names another listed party member, and only if the caster holds the source. An effect stored without `casterId`
    falls back to the old single-holder guess (two holders: the GM ends it by hand).
  - `convex/lib/cardRows.ts`: `casterMade` builds that test from a party list. It is used by `endForCasterOnSheets`,
    which gets an optional 5th arg `casterId`; without it the id comes from the party entry holding the caster's
    sheet. It is also used by `endOnTokensGone` and `endOnSpellCast`. All existing callers stay unchanged and get the
    new behaviour:
    - `incomingHits.hitEndEvents`: the caster is under key null.
    - `combatActions.partyEndsFromAttack`: the attacker is not in the list.
- **D5 writer** (dcm-lztq). `convex/classFeatures.ts` `use` stamps `casterId` (the user's character) on every effect
  the class action writes or rewrites, on the user's sheet and on the others' sheets (Life Support, Witch's Charm). It
  uses `withCasterOnNew` in expiry.ts. Cards (E1.4a) and features (E8.4) stamp their own this wave.
- **Backfill migration** `convex/migrations/sheetEffectCaster.ts` `backfillCaster`. It is batched and self-continuing
  (`migrations.define` on `characters`), idempotent and widen only: no narrow follows. An effect gets a `casterId` only
  when:
  - it has no caster yet;
  - it names its source (`effectSource`: card, feature, or the D5 Marked for Death alias);
  - exactly one character of the campaign holds that source (`holdsSource`).

  Everything else is left. A campaign with an unreadable sheet or more than 50 characters is skipped. Written and
  tested (dry run, one-holder case, two-holder case, rerun with `reset` changes nothing). **Not run.**
- **Marked for Death names its target** (dcm-qxb6). `endOnDefeat`: an effect with `targetInstanceId` ends only on that
  instance's defeat. One without it keeps the tag link, as before. `endOnDefeat` reads `_id` when the caller passes
  the row: both callers (combatCards, combatActions) already pass whole rows, so no edit was needed there. The writer
  `withEffectTarget(sheet, MARKED_FOR_DEATH_EFFECT, casterId, instanceId)` is exported for the attack path (follow-up
  dcm-gfi0).
- **Ending the D5 effect lifts the tag** (dcm-mvoo engine note). `liftTargetTags` in cardRows: when an ended sheet
  effect has a `targetInstanceId` and comes from a condition step, the tag (or condition) and that step's markers come
  off that instance. One GM row (`adversaryBefore`) is written in the caller's undo group. The tag stays while another
  party sheet still names the same instance with the same label (two assassins on one target). It is called from:
  - `classFeatures.endEffect`: the End button. It now writes a group when it lifts, so undo restores both.
  - `combatEffects.endByFear`, character branch: the GM's tier-Fear clear.
- Tests:
  - `tests/unit/lane4-e6-caster.test.ts`: `madeByCaster`, `defeatEnds`, `withCasterOnNew`.
  - `tests/convex/lane4-e6-endings.test.ts`: two-Skykin ends for each caller shape, tokensGone with two Flight holders,
    two assassins' defeat, `withEffectTarget`, the End button lifting and undoing the tag, a second assassin keeps the
    tag, no target lifts nothing, the GM Fear spend lifts, the D5 stamp (No Mercy), and the migration.

No UI change: nothing new to show, and the token panel's Fear buttons already list Marked for Death. No public
function was added and no args changed.

## Beads

| Bead | Status |
|---|---|
| dcm-lztq | Closable once E1.4a (cards) and E8.4 (features) merge their writers. Reader side, the D5 writer and the migration are done; the migration still needs the user's run. |
| dcm-qxb6 | Engine done (reader, writer helper, tag lift). Left: the attack path must call `withEffectTarget` (dcm-gfi0, E1 lane). Until then, combat marks have no target and use the old tag rule. |
| dcm-mvoo | Engine note done (End button and GM Fear spend lift the tag). Left: the data switch (`endsOn` `targetDefeated`, S2.4: assassin-brawler.ts has only `gmSpendsFear`) and the rest path (dcm-2n1l). |
| dcm-3ea | Closable. The roll-kind end has worked since wave 9. "In conversation" is dcm-hqk1 (E1.4b / S2.4). |
| dcm-46q4, dcm-iedr | E6 halves done since wave 9. Closable once dcm-1alq (E7.4) and dcm-wli0 (E1.4a/b) merge. |
| dcm-v17 | Closable if "can't be Vulnerable" stays a reminder (wave-9 note). The `cannotBeVulnerable` flag is read by `refusedConditions`. |
| dcm-b77 | Not E6's. It belongs to E7.4 this wave. |

## Follow-ups filed

- dcm-gfi0 (lane:w1-e1-triggers-rolls, P2): the Marked for Death rider stamps the D5 effect with `withEffectTarget`
  (combatActions runRiderPart / featureRunner's delegated sheet).
- dcm-2n1l (lane:w1-e8-session-features-rests, P3): a rest that ends Marked for Death calls `liftTargetTags`.
- dcm-wf5j (lane:w1-e2-damage-window, P4): pass the caster's id to `endForCasterOnSheets` in incomingHits and
  combatActions. Optional: the derivation already covers both; this only fixes a caster missing from the party list.

## Data switches ready for wave 11 / S2.4

- feature-effects/assassin-brawler.ts Marked for Death condition step: add `"targetDefeated"` to `endsOn` (now
  `["gmSpendsFear"]`). With dcm-gfi0 merged, only the killing assassin's mark ends. Without it, the tag rule still
  ends every assassin whose mark has no target.

## QUESTIONS

1. Two assassins mark the same adversary, and one assassin's mark ends (End button or GM Fear). I keep the
   "Marked for Death" tag on the adversary while the other assassin's mark names it. HF p.8: "You can have only one
   adversary Marked for Death at a time. This condition lasts until you take a rest, the current adversary Marked for
   Death is defeated, or the GM spends a number of Fear equal to your tier to clear it." The book doesn't say whether
   a GM Fear spend clears every assassin's mark on that target, or only one (I clear only the one paid for). Which is
   right?

## Merge-time actions

- Codegen: new module `convex/migrations/sheetEffectCaster.ts`. Regenerate `convex/_generated` (the tests call it by
  name through `migrations/run:run`).
- Authz: none (no public function added or changed; the migration is internal).
- Run, when the user approves (dev, then prod after deploy):
  `npx convex run migrations/run:run '{fn: "migrations/sheetEffectCaster:backfillCaster", dryRun: true}'`, then
  the same command without `dryRun`.
- No fallback lines in other files.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Focused: lane4-e6-caster, lane4-e6-endings, lane-e6-endings, lane3-e6-endings: 56 passed.
- Full suite (`pnpm vitest run --maxWorkers=1 --testTimeout=120000`): 421 files, 9859 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E6.4 rebuild HEAD`: OK.
